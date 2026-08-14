// The knobs-and-switches scene — an instrument slab floating over its
// own artwork, lit by it.
//
// The custody split, control by control:
//
//   DOM (captured, KnobsPanel)      WebGL (real geometry, this file)
//   ─────────────────────────       ────────────────────────────────
//   state, ARIA, focus, input       knurled grips, lathed caps
//   engraved text, LED readouts     bat levers on physical springs
//   lamp glow, wells, ticks         collar bezels, lens domes
//   the slab's corner radius        the slab's rim, depth and shadow
//
// Input goes THROUGH the matter: every hardware mesh declines the ray,
// so a drag on a knob lands on the Surface, is forwarded into the real
// DOM control underneath, mutates the live bag — and the hardware's
// springs read that bag next frame. The DOM stays the retained model;
// the geometry is how it stands in the world.
//
// And the light: the artwork on the page is the scene's illuminant.
// `artGlow` (pure, phase-locked to `generateArt`) drives colored lights
// that orbit with the art's layers, and a low-res redraw of the same
// frame is PMREM-filtered into `scene.environment` — so the chrome
// caps carry actual moving reflections of the picture the page is
// drawing. Turn the hue knob and the metal changes color with the art;
// drop the power switch and the light freezes with it.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import { Canvas, flushSync as flushThree, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  CanvasPointerGate,
  SurfaceApp,
  cameraDistance,
  useSurfaceTexture,
} from '@petepetrash/munari'
import { KnobsArt } from './KnobsArt'
import { KnobsPanel } from './KnobsPanel'
import { nineSlice, resizeWidth } from './knobsResize'
import {
  BEZEL_LIP,
  KNOB,
  LAMP,
  PANEL_RADIUS,
  SCREW,
  SLAB_DEPTH,
  TOGGLE,
  capProfile,
  knurlRadius,
  screwProfile,
} from './knobsGeometry'
import {
  KNOBS_LAMPS,
  KNOBS_ROTARY,
  KNOBS_TOGGLES,
  type KnobDef,
  type LampDef,
  artClock,
  artGlow,
  backlightAmount,
  generateArt,
  glowPoint,
  knobAngle,
  knobsValues,
  lampLit,
  panelDrag,
  panelResize,
  slabOcclusion,
} from './knobsLaw'
import {
  type EnvPixel,
  parseArtPoints,
  pathBounds,
  projectArtPolygon,
  projectViewportOutline,
} from './knobsEnvironment'
import {
  BOUNCE_TILT,
  BOUNCE_TILT_MAX,
  DRAG_TILT,
  DRAG_TILT_MAX,
  KNOB_SPRING,
  LEVER_SPRING,
  LEVER_THROW,
  PANEL_GLIDE_SPRING,
  PANEL_KICK,
  PANEL_RESTITUTION,
  PANEL_SPRING,
  berthPinned,
  centerFacingYaw,
  type SpringState,
  reflect,
  stepSpring,
} from './knobsPhysics'
import { getTuningRev, knobsTuning, subscribeTuning } from './knobsTuning'
import { KnobsTweakPanel } from './KnobsTweaks'
import './knobs.css'

const FOV = 42
const OVERLAY_Z = 50
/** The floating slab: side-rail width, inset from the viewport edges. */
const RAIL_W = 320
const INSET = 26

/** The size the rim is machined at, once. Every panel size after that
 *  is a nine-slice re-fit of this buffer (knobsResize), so this number
 *  decides nothing about how the rim looks — only that the extrusion is
 *  built from a fixed reference instead of whatever the first render
 *  happened to be. */
const RIM_BUILD = { w: RAIL_W, h: 600 }
/** Where the captured face sits in front of the rim's front bevel. */
const FACE_Z = 1.4
/** Where hardware bases stand, just proud of the face. */
const HARDWARE_Z = 1.6

/** Hardware is visual matter, not a pointer target: every mesh declines
 *  the ray so input falls through to the Surface — and from there into
 *  the real DOM control standing under it. */
const noRaycast = () => {}

/** Live bag: the slab's footprint on the art plane, and how hard the
 *  artwork backlights it right now. PanelRig writes it each frame; the
 *  light rig occludes its glints against the footprint, and the face
 *  shade and edge halo read the level. */
const backlight = { level: 0, x: 0, y: 0, w: 0, h: 0 }

/** Where the art's emitters stand in depth: AT the artwork, behind the
 *  slab's back face. Two parallel planes facing the viewer cannot light
 *  each other's faces — so the glints rake the slab's rim and the
 *  hardware's silhouettes, and never dance on the captured face. */
const ART_LIGHT_Z = -(SLAB_DEPTH + 34)

// ── the camera: z = 0 is the viewport, 1 world unit = 1 CSS px ──────────

function PixelPerfect() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  useLayoutEffect(() => {
    camera.fov = FOV
    camera.position.set(0, 0, cameraDistance(size.height, FOV))
    // Everything drawn lives within ~200 units of z = 0, and the knob
    // bases sit 0.2 units above the captured face — a near plane of 1
    // would spend nearly all the depth buffer's precision between 1 and
    // 50 and leave the panel z-fighting itself under tilt. Clamping the
    // frustum tight around the scene keeps depth steps far smaller than
    // the tightest mesh separation.
    camera.near = Math.max(1, camera.position.z - 400)
    camera.far = camera.position.z + 400
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [camera, size.width, size.height])
  return null
}

// ── the art as illuminant ───────────────────────────────────────────────

/**
 * `scene.environment` from the artwork itself: the same `generateArt`
 * frame the page is drawing, redrawn tiny, wrapped equirectangular, and
 * PMREM-filtered — so every metal in the scene reflects the picture,
 * blurred by its own roughness. Refreshed every frame the picture
 * changes (the source is 256×128 and the PMREM target is reused, so a
 * refresh is a handful of tiny GPU passes); a still picture — power
 * down, no knob moving — costs nothing.
 *
 * The wrap is a statement about DIRECTION, and it is held to it: the
 * picture is painted only where the picture actually stands, projected
 * through three's own equirect mapping by `knobsEnvironment`, and the
 * rest of the sphere is a dim studio. Camera-facing surfaces therefore
 * mirror a dark room, which is what is behind the viewer. Painting the
 * artwork there instead was a measured bug — the knob faces took the
 * picture's magenta, and which magenta depended on where the slab
 * stood (docs/spikes/knobs-lighting.md).
 */
const ENV_W = 256
const ENV_H = 128

/** Where the picture stands for the room's purposes: the same standoff
 *  behind the slab its emitters use, so "where the artwork is" is one
 *  number in this scene rather than two that can drift apart. */
const ART_ENV_DEPTH = -ART_LIGHT_Z

/** Lay a projected outline into the context as a closed path. Reports
 *  whether there is a path at all: a degenerate polygon must not leave
 *  the PREVIOUS path standing for a clip or a fill. */
function tracePath(ctx: CanvasRenderingContext2D, pts: readonly EnvPixel[]): boolean {
  if (pts.length < 3) return false
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.closePath()
  return true
}

function ArtEnvironment() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const size = useThree((s) => s.size)
  const state = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = ENV_W
    canvas.height = ENV_H
    const ctx = canvas.getContext('2d')!
    const tex = new THREE.CanvasTexture(canvas)
    tex.mapping = THREE.EquirectangularReflectionMapping
    tex.colorSpace = THREE.SRGBColorSpace
    // One pixel wide: the whole picture averaged by the browser's own
    // downscaler, which is how the room learns what color the artwork
    // is spilling onto it.
    const meter = document.createElement('canvas')
    meter.width = 1
    meter.height = 1
    return {
      ctx,
      tex,
      meter: meter.getContext('2d', { willReadFrequently: true })!,
      key: '',
      last: 0,
      pmrem: null as THREE.PMREMGenerator | null,
      rt: null as THREE.WebGLRenderTarget | null,
    }
  }, [])

  useEffect(() => {
    state.pmrem = new THREE.PMREMGenerator(gl)
    return () => {
      scene.environment = null
      state.rt?.dispose()
      state.rt = null
      state.pmrem?.dispose()
      state.pmrem = null
      state.tex.dispose()
    }
  }, [gl, scene, state])

  useFrame(() => {
    if (!state.pmrem) return
    // A reflection blurred by roughness does not need 120 refreshes a
    // second. 20 Hz tracks the orbit invisibly in the metal and hands
    // back the frame budget the every-frame PMREM passes were spending
    // (the clock is in the key, so "picture changed" was every frame).
    const nowMs = performance.now()
    if (nowMs - state.last < 50) return
    const v = knobsValues
    const key = `${artClock.t}|${artClock.lit.toFixed(2)}|${v.hue}|${v.palette}|${v.layers}|${v.complexity}|${v.speed}|${v.spread}|${v.mirror}|${size.width}x${size.height}|${knobsTuning.envArt}|${knobsTuning.envRoom}|${knobsTuning.envSky}`
    if (key === state.key) return
    state.key = key
    state.last = nowMs

    const art = generateArt(knobsValues, artClock.t)
    const { ctx } = state
    const W = ENV_W
    const H = ENV_H
    // The page's own letterbox: the SVG's −100..100 box fitted into the
    // shorter viewport axis, centered. World px per art unit.
    const scale = Math.min(size.width, size.height) / 200

    // The picture first, alone on a clear sphere, so the room can be
    // measured from it and then laid in UNDERNEATH — one pass, no
    // feedback loop between the two.
    //
    // It goes where it is: a plane ART_ENV_DEPTH px behind the slab,
    // projected through the same equirect mapping the shader samples
    // with, clipped to the page's own silhouette. A window, not a wall —
    // and never on the viewer's side of the room.
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, W, H)
    const gain = Math.max(knobsTuning.envArt, 0)
    const outline = projectViewportOutline(size.width, size.height, ART_ENV_DEPTH, W, H)
    if (gain > 0 && tracePath(ctx, outline)) {
      ctx.save()
      ctx.clip()
      const b = pathBounds(outline)
      const bg = ctx.createLinearGradient(0, b.minY, 0, b.maxY)
      bg.addColorStop(0, art.backdropFrom)
      bg.addColorStop(1, art.backdropTo)
      ctx.globalAlpha = Math.min(gain, 1)
      ctx.fillStyle = bg
      ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY)
      for (const layer of art.layers) {
        const path = projectArtPolygon(
          parseArtPoints(layer.points),
          scale,
          ART_ENV_DEPTH,
          W,
          H,
        )
        if (!tracePath(ctx, path)) continue
        ctx.globalAlpha = Math.min(layer.opacity * gain, 1)
        ctx.fillStyle = layer.fill
        ctx.fill()
      }
      ctx.restore()
    }
    ctx.globalAlpha = 1

    // What the picture has done to everything else. A screen this bright
    // in a dark room does not leave the room dark: it paints the walls,
    // and the walls light the panel's FRONT — which is the only way a
    // picture standing BEHIND the slab can reach a face that points at
    // the viewer. So the room is the artwork's own average, dimmed to a
    // bounce. An average, not an image: it is the same in every
    // direction, so it cannot change when the slab moves. That is the
    // whole difference between light and the lie this replaced.
    const { meter } = state
    meter.clearRect(0, 0, 1, 1)
    meter.drawImage(ctx.canvas, 0, 0, W / 2, H, 0, 0, 1, 1)
    const px = meter.getImageData(0, 0, 1, 1).data
    // Flux, not color: the picture covers only part of its own half, and
    // the uncovered part spills nothing. Alpha IS that coverage.
    const cover = px[3] / 255
    const bounce = Math.max(knobsTuning.envRoom, 0) * cover
    // A dark room is not a deleted one: a floor survives a dead picture.
    const ROOM_FLOOR = 4
    const chan = (c: number) => Math.min(255, Math.round(ROOM_FLOOR + c * bounce))
    ctx.globalCompositeOperation = 'destination-over'
    // A soft neutral overhead, so bare metal always keeps one white
    // glint even when the art runs dark — behind the picture, because
    // where both claim a direction, what you see is the picture.
    const sky = Math.min(Math.max(knobsTuning.envSky, 0), 1)
    const ceiling = ctx.createLinearGradient(0, 0, 0, H * 0.2)
    ceiling.addColorStop(0, `rgba(255,255,255,${sky.toFixed(3)})`)
    ceiling.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = ceiling
    ctx.fillRect(0, 0, W, H * 0.2)
    ctx.fillStyle = `rgb(${chan(px[0])}, ${chan(px[1])}, ${chan(px[2])})`
    ctx.fillRect(0, 0, W, H)
    ctx.globalCompositeOperation = 'source-over'
    // The blackout: a dead picture stops filling the room. The same
    // `lit` that darkens the page darkens what the metal reflects.
    if (artClock.lit < 0.999) {
      ctx.fillStyle = `rgba(0, 0, 0, ${(0.94 * (1 - artClock.lit)).toFixed(3)})`
      ctx.fillRect(0, 0, W, H)
    }

    state.tex.needsUpdate = true
    // Reuse one PMREM target for the scene's whole life — a per-frame
    // refresh must not allocate and destroy GPU textures at 60Hz.
    state.rt = state.pmrem.fromEquirectangular(state.tex, state.rt ?? undefined)
    scene.environment = state.rt.texture
  })

  return null
}

/**
 * The punctual half of the art's light: up to three colored point
 * lights, one per big outer layer, orbiting in the layer's own phase
 * (`artGlow` shares `generateArt`'s math and `artClock`'s clock). These
 * move every frame, so a glint they leave travels while the art spins
 * and freezes the instant power drops.
 *
 * They ship at zero candela, and the rig stays anyway. A punctual light
 * behind the slab cannot reach a camera-facing surface, and the one
 * surface that turns away is metal, which has no diffuse term — so the
 * measured contribution is a rounding error (see `lightArt`). The
 * artwork lights the front of the panel through the room's bounce
 * instead. Kept because the dial is how anyone re-tests that claim, and
 * because a rig that is present and honest at zero beats a deleted one
 * whose absence has to be re-derived.
 */
function ArtLightRig() {
  const lights = useRef<(THREE.PointLight | null)[]>([])
  const ambient = useRef<THREE.AmbientLight>(null)
  const key = useRef<THREE.DirectionalLight>(null)
  const fill = useRef<THREE.DirectionalLight>(null)
  const color = useMemo(() => new THREE.Color(), [])

  useFrame(() => {
    const sources = artGlow(knobsValues, artClock.t)
    // The picture's life: everything the artwork casts dies with it.
    const lit = artClock.lit
    sources.forEach((src, i) => {
      const light = lights.current[i]
      if (!light) return
      // The emitter stands where the picture actually glows — behind
      // the slab. A glint the slab's footprint covers is a hidden
      // light: it dies here, and the halo re-emits it around the
      // slab's edges. A glint swinging out past the edge is visible
      // again, and its light comes back.
      const p = glowPoint(src, window.innerWidth)
      const hidden = slabOcclusion(p.x, p.y, backlight)
      light.position.set(p.x, p.y, ART_LIGHT_Z)
      color.setHSL(src.hue / 360, 0.85, 0.6)
      light.color.copy(color)
      // Candela, in a scene whose meter is the CSS pixel — the same
      // unit the window lamps found (lcdReflect). These emitters stand
      // 100–500 px off the hardware and the falloff is inverse-square,
      // so a light you can see costs tens of thousands. The reward is
      // that distance means something: a glint fades as its layer
      // orbits away instead of tracking the picture's hue alone.
      light.intensity = (0.6 + 2.0 * src.weight) * (1 - hidden) * lit * knobsTuning.lightArt
    })
    for (let i = sources.length; i < 3; i++) {
      const light = lights.current[i]
      if (light) light.intensity = 0
    }
    const first = sources[0]
    if (ambient.current && first) {
      color.setHSL(first.hue / 360, 0.45, 0.5)
      ambient.current.color.copy(color)
      // A flat tint under everything. The room's real bounce is
      // `scene.environment`, which already knows which way the picture
      // is; this only lifts the floor, and it dies with the picture.
      ambient.current.intensity = knobsTuning.lightAmbient * (0.08 + 0.92 * lit)
    }
    // The studio pair keeps a floor: in a blackout the hardware stays
    // barely legible — a dark room, not a deleted one. A studio lamp
    // does not dim because a panel moved in front of a screen, so it
    // no longer reads the backlight level: that was a brake on a light
    // the wrap had already made too bright.
    if (key.current) key.current.intensity = knobsTuning.lightKey * (0.12 + 0.88 * lit)
    if (fill.current) fill.current.intensity = knobsTuning.lightFill * (0.12 + 0.88 * lit)
  })

  return (
    <>
      {/* the art's own cast, positioned/colored per frame above */}
      {[0, 1, 2].map((i) => (
        <pointLight
          key={i}
          ref={(el) => {
            lights.current[i] = el
          }}
          intensity={0}
        />
      ))}
      {/* tinted fill so shadow sides drown in the art's color, not black */}
      <ambientLight ref={ambient} intensity={0.3} />
      {/* one neutral warm key for form; the color belongs to the art */}
      <directionalLight ref={key} position={[140, 260, 320]} intensity={0.5} color="#fff3e6" />
      <directionalLight ref={fill} position={[-220, -120, 180]} intensity={0.16} color="#dfe8ff" />
    </>
  )
}

// ── the slab and its hardware ───────────────────────────────────────────

interface RailRect {
  w: number
  h: number
  worldX: number
  worldY: number
}

interface Feature {
  x: number
  y: number
}

/** A measured box on the face, center + size, panel CSS px. */
interface FeatureBox extends Feature {
  w: number
  h: number
}

interface PanelFeatures {
  knobs: Feature[]
  toggles: Feature[]
  lamps: Feature[]
  screws: Feature[]
  /** The LCD windows — the lamps the face shade must be cut around. */
  readouts: FeatureBox[]
  /** The dial circles — each one's tick annulus is an emitter ring. */
  dials: FeatureBox[]
}

/** Stable empty list, so an unmeasured panel doesn't re-cut the shade
 *  geometry on every render. */
const NO_READOUTS: FeatureBox[] = []

function featuresEqual(a: PanelFeatures | null, b: PanelFeatures): boolean {
  if (!a) return false
  const same = (xs: Feature[], ys: Feature[]) =>
    xs.length === ys.length &&
    xs.every((f, i) => Math.abs(f.x - ys[i].x) < 0.5 && Math.abs(f.y - ys[i].y) < 0.5)
  const sameBox = (xs: FeatureBox[], ys: FeatureBox[]) =>
    same(xs, ys) &&
    xs.every((f, i) => Math.abs(f.w - ys[i].w) < 0.5 && Math.abs(f.h - ys[i].h) < 0.5)
  return (
    same(a.knobs, b.knobs) &&
    same(a.toggles, b.toggles) &&
    same(a.lamps, b.lamps) &&
    same(a.screws, b.screws) &&
    sameBox(a.readouts, b.readouts) &&
    sameBox(a.dials, b.dials)
  )
}

/** Everything machined once and shared by every control. The knurl's
 *  pitch and depth are tuning knobs that change the vertex count, so
 *  the whole kit re-machines when the tweak panel bumps the rev — the
 *  dispose effect below retires each superseded kit. */
function useHardwareAssets() {
  const rev = useSyncExternalStore(subscribeTuning, getTuningRev)
  const assets = useMemo(() => {
    void rev // the geometry knobs in knobsTuning changed
    const knurlCount = Math.round(knobsTuning.knurlCount)
    const knurlAmp = knobsTuning.knurlAmp
    // Knurled skirt: a cylinder whose wall is genuinely serrated — the
    // knurl is cut into the vertices, so its ridges catch and release
    // the art's moving lights as the knob turns.
    // Radial segments track the knurl: ≥4 samples per ridge, or the
    // sine aliases into lumps.
    const skirt = new THREE.CylinderGeometry(
      KNOB.skirtRadius,
      KNOB.skirtRadius,
      KNOB.skirtHeight,
      knurlCount * 4,
      1,
      false,
    )
    const pos = skirt.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const r = Math.hypot(x, z)
      if (r < 1e-4) continue
      const theta = Math.atan2(z, x)
      const k = knurlRadius(theta, r, knurlAmp * (r / KNOB.skirtRadius), knurlCount) / r
      pos.setX(i, x * k)
      pos.setZ(i, z * k)
    }
    pos.needsUpdate = true
    skirt.computeVertexNormals()
    skirt.rotateX(Math.PI / 2)

    const cap = new THREE.LatheGeometry(
      capProfile(KNOB.capRadius, KNOB.capHeight).map(([r, h]) => new THREE.Vector2(r, h)),
      96,
    )
    cap.rotateX(Math.PI / 2)

    const index = new THREE.BoxGeometry(3, 10.5, 1.8)

    const collar = new THREE.LatheGeometry(
      [
        new THREE.Vector2(3.4, TOGGLE.collarHeight),
        new THREE.Vector2(7, TOGGLE.collarHeight * 0.9),
        new THREE.Vector2(9.4, TOGGLE.collarHeight * 0.45),
        new THREE.Vector2(TOGGLE.collarRadius + 0.8, 0),
      ],
      48,
    )
    collar.rotateX(Math.PI / 2)

    const shaft = new THREE.CapsuleGeometry(
      TOGGLE.leverRadius,
      TOGGLE.leverLength - TOGGLE.leverRadius * 2,
      6,
      18,
    )
    shaft.rotateX(Math.PI / 2)

    const tip = new THREE.SphereGeometry(TOGGLE.tipRadius, 28, 20)

    const dome = new THREE.SphereGeometry(LAMP.domeRadius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2)
    dome.rotateX(Math.PI / 2)
    dome.scale(1, 1, LAMP.domeHeight / LAMP.domeRadius)

    // Turned bezel ring around each lamp's glass. A torus already faces
    // +Z, which is how the panel faces the camera.
    const lampRim = new THREE.TorusGeometry(LAMP.rimRadius, LAMP.rimTube, 20, 48)

    const screwHead = new THREE.LatheGeometry(
      screwProfile(SCREW.headRadius, SCREW.headHeight).map(([r, h]) => new THREE.Vector2(r, h)),
      48,
    )
    screwHead.rotateX(Math.PI / 2)
    // The driver slot: a dark bar sunk through the crown. Short of the
    // rim so its ends stay buried inside the dome.
    const screwSlot = new THREE.BoxGeometry(SCREW.headRadius * 1.5, SCREW.slotWidth, SCREW.slotDepth)

    const chrome = new THREE.MeshStandardMaterial({
      color: 0xd8dadd,
      metalness: 0.92,
      roughness: 0.6,
    })
    chrome.envMapIntensity = 1.2
    // Painted aluminum, not chrome — a knob top you grip, not jewelry.
    // It mirrors the room like everything else: the cap once had to run
    // at zero environment because the wrap put the artwork behind the
    // viewer, and a camera-facing disc mirrors nothing else. With the
    // room honest, the compensation goes and the material can say what
    // it is (docs/spikes/knobs-lighting.md).
    const capMat = new THREE.MeshStandardMaterial({
      color: 0xc4c7cb,
      metalness: 0.35,
      roughness: 0.8,
    })
    const steelDark = new THREE.MeshStandardMaterial({
      color: 0x82868c,
      metalness: 0.88,
      roughness: 0.34,
    })
    const graphite = new THREE.MeshStandardMaterial({
      color: 0x33363b,
      metalness: 0.78,
      roughness: 0.4,
    })
    const indexMat = new THREE.MeshStandardMaterial({
      color: 0x1a0503,
      emissive: 0xff3b1e,
      emissiveIntensity: 1.8,
      metalness: 0,
      roughness: 0.5,
    })
    // The lamp glass: a clearcoated shell that exists mostly as what it
    // reflects — the environment (which is the artwork) slides across
    // it, over whatever the die inside is doing.
    const lens = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    })
    lens.envMapIntensity = 2.2

    return {
      skirt,
      cap,
      index,
      collar,
      shaft,
      tip,
      dome,
      lampRim,
      screwHead,
      screwSlot,
      chrome,
      capMat,
      steelDark,
      graphite,
      indexMat,
      lens,
    }
  }, [rev])

  useEffect(
    () => () => {
      for (const value of Object.values(assets)) value.dispose()
    },
    [assets],
  )

  return assets
}

type HardwareAssets = ReturnType<typeof useHardwareAssets>

/** Per-frame drip of the scalar tuning values into the shared hardware
 *  materials. Geometry knobs go through the rev/rebuild path instead;
 *  everything here is a cheap property write, and an untouched tweak
 *  panel writes exactly the committed values. Lives inside the Canvas
 *  because useHardwareAssets does not (KnobsApp calls it outside). */
function TuningDrip({ assets }: { assets: HardwareAssets }) {
  useFrame(() => {
    const t = knobsTuning
    assets.chrome.roughness = t.hwRough
    assets.chrome.envMapIntensity = t.hwEnv
    assets.indexMat.emissiveIntensity = t.indexGlow
  })
  return null
}

function KnobHardware({
  def,
  x,
  y,
  assets,
}: {
  def: KnobDef
  x: number
  y: number
  assets: HardwareAssets
}) {
  const grip = useRef<THREE.Group>(null)
  const spring = useRef<SpringState>({
    x: (knobAngle(def, knobsValues[def.key]) * Math.PI) / 180,
    v: 0,
  })

  useFrame((_, dt) => {
    // The DOM wrote the bag (via the relayed drag); the hardware chases
    // it with mass. CSS-clockwise degrees → three's CCW-positive z.
    const target = (knobAngle(def, knobsValues[def.key]) * Math.PI) / 180
    stepSpring(spring.current, target, KNOB_SPRING, dt)
    if (grip.current) grip.current.rotation.z = -spring.current.x
  })

  return (
    <group position={[x, y, HARDWARE_Z]}>
      <group ref={grip}>
        <mesh
          geometry={assets.skirt}
          material={assets.steelDark}
          position={[0, 0, KNOB.skirtHeight / 2]}
          raycast={noRaycast}
        />
        <mesh
          geometry={assets.cap}
          material={assets.capMat}
          position={[0, 0, KNOB.skirtHeight - 0.6]}
          raycast={noRaycast}
        />
        <mesh
          geometry={assets.index}
          material={assets.indexMat}
          position={[0, 10.5, KNOB.skirtHeight + KNOB.capHeight - 1.2]}
          raycast={noRaycast}
        />
      </group>
    </group>
  )
}

function ToggleHardware({
  tKey,
  x,
  y,
  assets,
  kick,
}: {
  tKey: 'power' | 'mirror'
  x: number
  y: number
  assets: HardwareAssets
  kick: React.RefObject<((dir: number) => void) | null>
}) {
  const lever = useRef<THREE.Group>(null)
  // rotation.x tips the +Z lever toward −Y for positive angles, so ON
  // (tip up) is the negative throw.
  const spring = useRef<SpringState>({
    x: knobsValues[tKey] ? -TOGGLE.throw : TOGGLE.throw,
    v: 0,
  })
  const prev = useRef(knobsValues[tKey])

  useFrame((_, dt) => {
    const on = knobsValues[tKey]
    if (on !== prev.current) {
      prev.current = on
      // Thrown, not placed: the flip donates a flick of angular
      // velocity, and the slab takes the counter-thunk.
      spring.current.v += (on ? -1 : 1) * LEVER_THROW
      kick.current?.(on ? 1 : -1)
    }
    stepSpring(spring.current, on ? -TOGGLE.throw : TOGGLE.throw, LEVER_SPRING, dt)
    if (lever.current) lever.current.rotation.x = spring.current.x
  })

  return (
    <group position={[x, y, HARDWARE_Z]}>
      <mesh geometry={assets.collar} material={assets.graphite} raycast={noRaycast} />
      <group ref={lever} position={[0, 0, TOGGLE.collarHeight - 1]}>
        <mesh
          geometry={assets.shaft}
          material={assets.chrome}
          position={[0, 0, TOGGLE.leverLength / 2]}
          raycast={noRaycast}
        />
        <mesh
          geometry={assets.tip}
          material={assets.chrome}
          position={[0, 0, TOGGLE.leverLength + 1]}
          raycast={noRaycast}
        />
      </group>
    </group>
  )
}

/** How hard a lit die drives its emissive, and how hard its point light
 *  pushes onto the bezel and the face around it. The light is candela
 *  against pixel distances under physical falloff (same lesson as
 *  lcdReflect): at the bezel ~12 px away, 350 lands ~2.4, and the old
 *  2.4 landed ~0.02 — a cast that was never visible at all. */
const LAMP_CORE_ON = 3.4
const LAMP_LIGHT_ON = 350

/**
 * One annunciator: a turned chrome rim, a glass shell, and inside it an
 * emissive die that follows `lampLit` — the same law the captured bulb
 * underneath paints with. The die strikes near-instantly and cools a
 * beat slower, the asymmetry a real LED die has; a small point light
 * rides the same level, so a lit lamp genuinely lights its own bezel.
 */
function LampHardware({ def, x, y, assets }: { def: LampDef; x: number; y: number; assets: HardwareAssets }) {
  const coreMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x0b0d0c,
        emissive: new THREE.Color(def.color),
        emissiveIntensity: 0,
        metalness: 0,
        roughness: 0.4,
      }),
    [def.color],
  )
  useEffect(() => () => coreMat.dispose(), [coreMat])

  const light = useRef<THREE.PointLight>(null)
  const level = useRef(0)

  useFrame((_, dt) => {
    const target = lampLit(def, knobsValues) ? 1 : 0
    const tau = target > level.current ? 0.035 : 0.12
    level.current += (target - level.current) * (1 - Math.exp(-dt / tau))
    coreMat.emissiveIntensity = LAMP_CORE_ON * level.current
    if (light.current) light.current.intensity = LAMP_LIGHT_ON * level.current
  })

  return (
    <group position={[x, y, FACE_Z]}>
      <mesh geometry={assets.lampRim} material={assets.chrome} position={[0, 0, 0.9]} raycast={noRaycast} />
      <mesh
        geometry={assets.dome}
        material={coreMat}
        position={[0, 0, 0.3]}
        scale={LAMP.coreScale}
        raycast={noRaycast}
      />
      <mesh geometry={assets.dome} material={assets.lens} position={[0, 0, 0.4]} raycast={noRaycast} />
      <pointLight ref={light} color={def.color} intensity={0} distance={70} decay={2} position={[0, 0, 8]} />
    </group>
  )
}

/** Slot angles, one per corner in DOM order (tl, tr, bl, br) — a
 *  hand-driven screw lands wherever its last quarter-turn left it. */
const SCREW_CLOCK = [24, -52, 71, -13]

/** One corner fastener: a lathed pan head with a sunk driver slot,
 *  standing in the countersink the captured face paints. */
function ScrewHardware({ x, y, clock, assets }: { x: number; y: number; clock: number; assets: HardwareAssets }) {
  return (
    <group position={[x, y, FACE_Z]} rotation={[0, 0, (-clock * Math.PI) / 180]}>
      <mesh geometry={assets.screwHead} material={assets.steelDark} raycast={noRaycast} />
      <mesh
        geometry={assets.screwSlot}
        material={assets.graphite}
        position={[0, 0, SCREW.headHeight - SCREW.slotDepth / 2 + 0.01]}
        raycast={noRaycast}
      />
    </group>
  )
}

/** The panel's rounded rect, centered on the origin — one path builder
 *  for the rim extrusion, the face shade, and anything else that must
 *  wear the corner the DOM authored. */
function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(-w / 2 + r, -h / 2)
  shape.lineTo(w / 2 - r, -h / 2)
  shape.absarc(w / 2 - r, -h / 2 + r, r, -Math.PI / 2, 0, false)
  shape.lineTo(w / 2, h / 2 - r)
  shape.absarc(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2, false)
  shape.lineTo(-w / 2 + r, h / 2)
  shape.absarc(-w / 2 + r, h / 2 - r, r, Math.PI / 2, Math.PI, false)
  shape.lineTo(-w / 2, -h / 2 + r)
  shape.absarc(-w / 2 + r, -h / 2 + r, r, Math.PI, Math.PI * 1.5, false)
  return shape
}

/** The same rounded rect as a Path (for cutting holes), centered at
 *  (cx, cy) in the parent shape's local space. */
function roundedRectPath(cx: number, cy: number, w: number, h: number, r: number): THREE.Path {
  const p = new THREE.Path()
  p.moveTo(cx - w / 2 + r, cy - h / 2)
  p.lineTo(cx + w / 2 - r, cy - h / 2)
  p.absarc(cx + w / 2 - r, cy - h / 2 + r, r, -Math.PI / 2, 0, false)
  p.lineTo(cx + w / 2, cy + h / 2 - r)
  p.absarc(cx + w / 2 - r, cy + h / 2 - r, r, 0, Math.PI / 2, false)
  p.lineTo(cx - w / 2 + r, cy + h / 2)
  p.absarc(cx - w / 2 + r, cy + h / 2 - r, r, Math.PI / 2, Math.PI, false)
  p.lineTo(cx - w / 2, cy - h / 2 + r)
  p.absarc(cx - w / 2 + r, cy - h / 2 + r, r, Math.PI, Math.PI * 1.5, false)
  return p
}

/** Quad margin past the slab: bezel lip + the corona's outward skirt at
 *  the tweak panel's CEILING (uOutReach slides to 28) + AA slack — the
 *  quad must never crop a corona the tuning surface can ask for. */
const CORONA_MARGIN = BEZEL_LIP + 32

/** The corona's screen-mapped picture of the artwork: `generateArt`
 *  drawn small, in the page's own mapping (viewport-filling backdrop,
 *  art square centered, `meet`-scaled), then self-blurred so the flat
 *  polygons arrive with soft edges. NOT the equirectangular environment
 *  canvas — that one is warped for reflections and cannot be sampled by
 *  screen position. */
const LEAK_W = 256
const LEAK_H = 144

/**
 * The backlight, from first principles: the artwork IS the emitter — a
 * lightbox the slab floats in front of. Nothing the slab does can make
 * an emitter brighter, so this material paints NO light outward onto
 * the picture; every prior halo did, and every one read as a sticker,
 * because it was light standing where light cannot go. What a viewer
 * really sees is the opposite: the bright surround blooming over the
 * occluder's edge INWARD — a hot thin corona straddling the silhouette,
 * wearing the local color of the VISIBLE art just beyond it, and a soft
 * veil bleeding a few dozen px onto the dark face before dying into it.
 * The dark face is what retires the falloff problem: additive light
 * fading into black has no visible endpoint left to crop.
 *
 * The falloffs are compact-support and C1 at their ends (`veilProfile`,
 * pinned in knobsLaw) — the session's lesson, learned three ways: an
 * exponential never reaches zero, and whatever is nonzero where the
 * support ends becomes a hard edge. The spill is tone-mapped
 * (1 - exp(-x)), never squared-and-gained into channel clipping — the
 * clipped rim is what turned dusty pink art into a neon tube.
 */
function BacklightCorona({ rect }: { rect: RailRect }) {
  const assets = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = LEAK_W
    canvas.height = LEAK_H
    const ctx = canvas.getContext('2d')!
    const tex = new THREE.CanvasTexture(canvas)
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      // Additive for COLOR only. The scene's canvas is transparent
      // over the DOM artwork, and the page composites it by alpha —
      // stock AdditiveBlending also sums alpha, which turns the whole
      // plane's footprint into an opaque black rectangle over the
      // art. Add the light, leave the coverage untouched.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      uniforms: {
        uHalf: { value: new THREE.Vector2(1, 1) },
        uRadius: { value: PANEL_RADIUS + BEZEL_LIP },
        uArt: { value: tex },
        uView: { value: new THREE.Vector2(1, 1) },
        uCenter: { value: new THREE.Vector2(0, 0) },
        uLit: { value: 1 },
        // The tuned numbers, dripped from knobsTuning each frame. The
        // defaults are the committed look; an untouched tweak panel
        // renders the same corona the constants used to.
        uOutReach: { value: knobsTuning.coronaOut },
        uVeilReach: { value: knobsTuning.coronaVeil },
        uCoreTauOut: { value: knobsTuning.coronaEdgeOut },
        uCoreTauIn: { value: knobsTuning.coronaEdgeIn },
        uCoreGain: { value: knobsTuning.coronaCore },
        uVeilGain: { value: knobsTuning.coronaVeilGain },
        uToneK: { value: knobsTuning.coronaTone },
        uSpill: { value: knobsTuning.coronaSpill },
      },
      vertexShader: /* glsl */ `
        varying vec2 vPos;
        void main() {
          vPos = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vPos;
        uniform vec2 uHalf;
        uniform float uRadius;
        uniform sampler2D uArt;
        uniform vec2 uView;
        uniform vec2 uCenter;
        uniform float uLit;

        // Where the corona lives, in px of signed distance: a small
        // outward skirt (the edge's own brightness, not painted light —
        // it must die inside the quad), and an inward veil onto the
        // dark face. Uniforms, so the tweak panel can slide them live.
        uniform float uOutReach;
        uniform float uVeilReach;
        uniform float uCoreTauOut;
        uniform float uCoreTauIn;
        uniform float uCoreGain;
        uniform float uVeilGain;
        uniform float uToneK;
        uniform float uSpill;

        // Signed distance to the slab's rounded rect — the same
        // corner the DOM authors and the rim extrudes.
        float sdSlab(vec2 p) {
          vec2 q = abs(p) - (uHalf - vec2(uRadius));
          return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - uRadius;
        }

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        // The picture at a WORLD point (scene px, origin mid-viewport,
        // y up): the bake fills the viewport, flipY'd on upload.
        vec3 art(vec2 world) {
          return texture2D(uArt, vec2(0.5) + world / uView).rgb;
        }

        void main() {
          float d = sdSlab(vPos);
          // All the light lives in a band hugging the silhouette.
          if (d > uOutReach || d < -(uVeilReach + 4.0)) {
            gl_FragColor = vec4(0.0);
            return;
          }
          vec2 e = vec2(2.0, 0.0);
          vec2 n = normalize(vec2(
            sdSlab(vPos + e.xy) - sdSlab(vPos - e.xy),
            sdSlab(vPos + e.yx) - sdSlab(vPos - e.yx)));
          // The nearest point of the silhouette, then the VISIBLE art
          // just beyond it: the light actually wrapping this edge. The
          // hidden art is blocked by the slab and contributes nothing.
          vec2 edge = vPos - n * d;
          vec3 spill = art(uCenter + edge + n * (7.0 * uSpill))
                     + art(uCenter + edge + n * (20.0 * uSpill))
                     + art(uCenter + edge + n * (40.0 * uSpill));
          spill *= (1.0 / 3.0);
          float L = dot(spill, vec3(0.2126, 0.7152, 0.0722));

          // The hot line on the boundary. Outward it is compact-support
          // and C1 at uOutReach (veilProfile's shape — an exponential
          // alone never reaches zero, and its leftover becomes an edge);
          // inward it relaxes over uCoreTauIn px onto the face.
          float t0 = clamp(d / uOutReach, 0.0, 1.0);
          float core = d >= 0.0
            ? exp(-d / uCoreTauOut) * (1.0 - t0) * (1.0 - t0)
            : exp(d / uCoreTauIn);
          // The bloom veil, over the dark face only: (1-t)^2 dies at
          // uVeilReach with zero slope — no endpoint to see. Scaled by
          // L: bloom belongs to bright surround, dim surround has none.
          float tv = clamp(-d / uVeilReach, 0.0, 1.0);
          float veil = d < 0.0 ? (1.0 - tv) * (1.0 - tv) * L : 0.0;

          vec3 col = spill * (uCoreGain * core + uVeilGain * veil) * uLit;
          // Tone-map instead of clip: clipping is what rotated dusty
          // pink into a neon tube.
          col = vec3(1.0) - exp(-col * uToneK);
          // Dither before quantization: a smooth falloff on a dark
          // field bands without it, and banding is what reads as a
          // cheap gradient.
          col += (hash(vPos) - 0.5) / 255.0;
          gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
        }
      `,
    })
    return { canvas, ctx, tex, mat, key: '' }
  }, [])
  useEffect(
    () => () => {
      assets.tex.dispose()
      assets.mat.dispose()
    },
    [assets],
  )

  useFrame(() => {
    // Rebake the little picture only when the picture changed — the
    // same key discipline as ArtEnvironment, so a still artwork costs
    // no canvas work and no texture upload.
    const v = knobsValues
    const key = `${artClock.t}|${v.hue}|${v.palette}|${v.layers}|${v.complexity}|${v.speed}|${v.spread}|${v.mirror}`
    if (key !== assets.key) {
      assets.key = key
      const vw = window.innerWidth
      const vh = window.innerHeight
      const { ctx } = assets
      const art = generateArt(v, artClock.t)
      // The page's backdrop: linear-gradient(165deg, from, to) — CSS
      // angles point the way the gradient runs, clockwise from up.
      const dirX = Math.sin((165 * Math.PI) / 180)
      const dirY = -Math.cos((165 * Math.PI) / 180)
      const len = (Math.abs(dirX) * LEAK_W + Math.abs(dirY) * LEAK_H) / 2
      const bg = ctx.createLinearGradient(
        LEAK_W / 2 - dirX * len,
        LEAK_H / 2 - dirY * len,
        LEAK_W / 2 + dirX * len,
        LEAK_H / 2 + dirY * len,
      )
      bg.addColorStop(0, art.backdropFrom)
      bg.addColorStop(1, art.backdropTo)
      ctx.globalAlpha = 1
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, LEAK_W, LEAK_H)
      // The art square, centered and `meet`-scaled exactly as the
      // page's SVG maps its -100..100 viewBox into the viewport.
      const scale = Math.min(vw, vh) / 200
      const sx = LEAK_W / vw
      const sy = LEAK_H / vh
      for (const layer of art.layers) {
        ctx.globalAlpha = layer.opacity
        ctx.fillStyle = layer.fill
        ctx.beginPath()
        layer.points.split(' ').forEach((pair, i) => {
          const [x, y] = pair.split(',').map(Number)
          const cx = (vw / 2 + x * scale) * sx
          const cy = (vh / 2 + y * scale) * sy
          if (i === 0) ctx.moveTo(cx, cy)
          else ctx.lineTo(cx, cy)
        })
        ctx.closePath()
        ctx.fill()
      }
      ctx.globalAlpha = 1
      // Soften the bake over itself: the art is flat polygons with
      // hard edges, and a corona sampled from a hard-edged field
      // inherits the hard edges. Real glare is pre-blurred by the eye.
      ctx.filter = 'blur(2px)'
      ctx.drawImage(assets.canvas, 0, 0)
      ctx.filter = 'none'
      assets.tex.needsUpdate = true
    }

    const u = assets.mat.uniforms
    ;(u.uHalf.value as THREE.Vector2).set(backlight.w / 2, backlight.h / 2)
    ;(u.uView.value as THREE.Vector2).set(window.innerWidth, window.innerHeight)
    ;(u.uCenter.value as THREE.Vector2).set(backlight.x, backlight.y)
    u.uLit.value = artClock.lit
    const t = knobsTuning
    u.uOutReach.value = t.coronaOut
    u.uVeilReach.value = t.coronaVeil
    u.uCoreTauOut.value = t.coronaEdgeOut
    u.uCoreTauIn.value = t.coronaEdgeIn
    u.uCoreGain.value = t.coronaCore
    u.uVeilGain.value = t.coronaVeilGain
    u.uToneK.value = t.coronaTone
    u.uSpill.value = t.coronaSpill
  })

  return (
    // In FRONT of the face: the corona is light wrapping the edge
    // toward the viewer. It draws over the face's rim (and the shade),
    // and the standing hardware still occludes it by depth.
    <mesh material={assets.mat} position={[0, 0, FACE_Z + 0.12]} raycast={noRaycast}>
      <planeGeometry args={[rect.w + CORONA_MARGIN * 2, rect.h + CORONA_MARGIN * 2]} />
    </mesh>
  )
}

/**
 * The silhouette side of the backlight: a rounded shade lying on the
 * captured face (under the standing hardware), darkening exactly as
 * hard as the picture behind is glowing. The metal above it keeps its
 * environment reflections — a backlit chassis still glints; its FACE is
 * what falls dark.
 */
function FaceShade({ rect, readouts }: { rect: RailRect; readouts: FeatureBox[] }) {
  const geometry = useMemo(() => {
    const shape = roundedRectShape(rect.w, rect.h, PANEL_RADIUS)
    // The shade is the face falling dark against its own backlight. The
    // LCD windows are lamps STANDING in that face — a lamp does not
    // fall dark — so the shade is cut around each measured window (the
    // same 4px corner knobs.css authors on .knb-dial-value).
    for (const box of readouts) {
      shape.holes.push(roundedRectPath(box.x - rect.w / 2, rect.h / 2 - box.y, box.w, box.h, 4))
    }
    return new THREE.ShapeGeometry(shape, 24)
  }, [rect.w, rect.h, readouts])
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0x02040a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    [],
  )
  // Two lifetimes, two effects. They were one, and the shared dependency
  // list meant a new GEOMETRY — which a resize produces on every single
  // width — also disposed the material, while that material was still
  // mounted and drawing. three then had to release its shader program
  // and link a replacement at the next draw. Measured: 67 program links
  // across a 100-step drag, none at all when the panel was still. The
  // rule this broke: dispose a thing on the identity of that thing.
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => mat.dispose(), [mat])

  useFrame(() => {
    mat.opacity = knobsTuning.shadeMax * backlight.level
  })

  return <mesh geometry={geometry} material={mat} position={[0, 0, FACE_Z + 0.06]} raycast={noRaycast} />
}

/**
 * The LCD windows, re-rendered as pure emitters. The captured face is lit
 * matter — every authored pixel multiplies the room's light — and a
 * face-wide emissive term lifts ALL the paint, washing the charcoal body
 * gray and driving the windows past their authored color into clipping.
 * A real backlit window is neither of those things: everything visible in
 * it IS emission. So each measured window gets a small unlit mesh standing
 * just off the face, sampling the SAME live capture at the window's own UV
 * rect — the DOM still owns the pixels (measured, not duplicated) — and
 * showing the authored amber exactly: digits dark because the DOM painted
 * them dark, lamp bright because the DOM painted it bright, the room not
 * consulted. `toneMapped: false` keeps the film look off a lamp's face.
 * Children of the Surface mesh, so they ride the rig's tilt and read the
 * capture through the package's own custom-material seam.
 */
/**
 * The one material a family of capture-sampling emitters shares.
 *
 * A `MeshBasicMaterial` with a map and one without are DIFFERENT shader
 * programs, so the arrival of the texture is the one moment this has to
 * recompile. Swapping one texture for another is not: the program is
 * identical, and flagging `needsUpdate` for it would rebuild every
 * program the material touches for nothing.
 */
function useSharedCaptureMaterial(texture: THREE.Texture | null | undefined) {
  const material = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), [])
  useEffect(() => () => material.dispose(), [material])
  useLayoutEffect(() => {
    const had = material.map !== null
    material.map = texture ?? null
    if (had !== (material.map !== null)) material.needsUpdate = true
  }, [material, texture])
  return material
}

/**
 * Point a piece of face hardware at the part of the live capture it
 * stands over. Writes uvs in place — the attribute already exists at
 * the right length, so a move costs one pass over it and no allocation.
 */
function reprojectUVs(geometry: THREE.BufferGeometry, box: FeatureBox | undefined, rect: RailRect) {
  if (!box) return
  const cx = box.x - rect.w / 2
  const cy = rect.h / 2 - box.y
  const pos = geometry.attributes.position
  const uv = geometry.attributes.uv
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) + cx + rect.w / 2) / rect.w, (pos.getY(i) + cy + rect.h / 2) / rect.h)
  }
  uv.needsUpdate = true
}

function ReadoutWindows({ rect, readouts }: { rect: RailRect; readouts: FeatureBox[] }) {
  const texture = useSurfaceTexture()
  // ONE material for every window. They are identical — the same map,
  // the same settings — and differ only in where they sample, which is
  // geometry. Building one apiece cost a shader program per window on
  // every width a drag passed through: 213 ms of compile per second of
  // dragging, the largest single cost in the gesture (cap-probe34).
  const material = useSharedCaptureMaterial(texture)

  // Triangulated per SIZE, not per position. Resizing the panel moves a
  // window; it rarely changes its box. Re-cutting a rounded rect to
  // move it is the expensive way to do nothing, and earcut was the
  // second cost the profile named. The sizes are the whole dependency,
  // so they are the whole key.
  const sizeKey = readouts.map((b) => `${b.w}x${b.h}`).join(',')
  const geoms = useMemo(() => {
    if (!sizeKey) return []
    // The geometry IS the rounded rect (the same 4px corner knobs.css
    // authors), so an opaque material needs no alpha work.
    return sizeKey.split(',').map((s) => {
      const [w, h] = s.split('x').map(Number)
      return new THREE.ShapeGeometry(roundedRectShape(w, h, 4), 8)
    })
  }, [sizeKey])
  useEffect(() => () => geoms.forEach((g) => g.dispose()), [geoms])

  // ShapeGeometry uvs are raw shape coords; rewrite them to sample the
  // capture where this window sits on the face (plane uv space: v = 0
  // at the bottom, flipY on the capture already agrees). This is the
  // only part a move has to redo — a write over existing buffers, no
  // allocation and no re-triangulation.
  useLayoutEffect(() => {
    geoms.forEach((g, i) => reprojectUVs(g, readouts[i], rect))
  }, [geoms, readouts, rect])

  // The emission dial. THREE.Color carries components past 1 without
  // complaint, so >1 overdrives the authored paint and <1 dims it.
  useFrame(() => {
    material.color.setScalar(knobsTuning.lcdEmit)
  })

  if (!texture) return null
  return (
    <>
      {geoms.map((g, i) => {
        const box = readouts[i]
        if (!box) return null
        return (
          <mesh
            key={i}
            geometry={g}
            material={material}
            position={[box.x - rect.w / 2, rect.h / 2 - box.y, 0.04]}
            raycast={noRaycast}
          />
        )
      })}
    </>
  )
}

/**
 * The dial tick rings, on the windows' custody. A lit graduation is a
 * lamp behind a slot, and paint dimmed to the face's ambient floor
 * reads as paint — so each dial's tick annulus gets the same pure-
 * emitter treatment as the LCD windows: an unlit ring just off the
 * face, sampling the live capture at its own UV rect, overdriven by
 * the same lcdEmit the windows ride (one phosphor system, one gain).
 * The ring's edges never print: everything else inside the annulus —
 * unlit notches, the groove floor — is authored near-black, and near-
 * black times any gain is still near-black. The standing grip draws
 * over the ring's inner reach. Radii are derived from the measured
 * dial box: the notches sit at translateY(-29px) of a 66px dial in
 * knobs.css, i.e. from (w/2 - 9) to the dial's own edge.
 */
function DialRings({ rect, dials }: { rect: RailRect; dials: FeatureBox[] }) {
  const texture = useSurfaceTexture()
  // Same two economies as the windows above, for the same measured
  // reasons: one shared material, and an annulus cut once per diameter.
  // A rotary is 66px on every panel width — hardware re-lays-out, it
  // does not scale — so in practice this is cut once and then only
  // ever re-aimed.
  const material = useSharedCaptureMaterial(texture)

  const sizeKey = dials.map((b) => `${b.w}`).join(',')
  const geoms = useMemo(() => {
    if (!sizeKey) return []
    return sizeKey
      .split(',')
      .map((s) => new THREE.RingGeometry(Number(s) / 2 - 9, Number(s) / 2 + 0.5, 48))
  }, [sizeKey])
  useEffect(() => () => geoms.forEach((g) => g.dispose()), [geoms])

  // Same rewrite as the windows: sample the capture where this annulus
  // sits on the face.
  useLayoutEffect(() => {
    geoms.forEach((g, i) => reprojectUVs(g, dials[i], rect))
  }, [geoms, dials, rect])

  useFrame(() => {
    material.color.setScalar(knobsTuning.lcdEmit)
  })

  if (!texture) return null
  return (
    <>
      {geoms.map((g, i) => {
        const box = dials[i]
        if (!box) return null
        return (
          <mesh
            key={i}
            geometry={g}
            material={material}
            position={[box.x - rect.w / 2, rect.h / 2 - box.y, 0.04]}
            raycast={noRaycast}
          />
        )
      })}
    </>
  )
}

/**
 * The windows cast. An emitter that never lands on the metal beside it
 * reads as a sticker; the indicator lamps already answer this with a
 * small point light each, and the LCD windows deserve the same voice.
 * One distance-bound amber light stands at each measured window — the
 * scene-side cast of a DOM-owned lamp. Two probe-settled choices live
 * here: intensity is candela against PIXEL distances under physical
 * falloff, so useful numbers are tens of thousands (see lcdReflect);
 * and a point suffices where an LTC rect light was the obvious
 * upgrade, because the knurling scatters the punctual glint into a
 * curtain of small facets — already how a machined knob sits beside a
 * lamp. Intensity is dripped live from the tuning bag; the lights stay
 * mounted through zero (a shader recompile per dial step would cost
 * more than six idle punctual lights).
 */
function ReadoutLamps({ rect, readouts }: { rect: RailRect; readouts: FeatureBox[] }) {
  const lights = useRef<(THREE.PointLight | null)[]>([])
  useFrame(() => {
    for (const l of lights.current) if (l) l.intensity = knobsTuning.lcdReflect
  })
  return (
    <>
      {readouts.map((box, i) => (
        <pointLight
          key={i}
          ref={(el) => {
            lights.current[i] = el
          }}
          // The window's own committed mid stop (knobsTuning LCD_STOPS,
          // knobs.css var defaults) — the cast is the lamp's color.
          color="#f4980e"
          intensity={knobsTuning.lcdReflect}
          distance={170}
          decay={2}
          // Just proud of the glass, not hovering over the panel: a
          // flush window's light travels ALONG the face, so the flat
          // plate around it catches only grazing incidence (cosine ~0)
          // while knob flanks and bat levers — surfaces facing the
          // window — catch it broadside. The masking is Lambert's law,
          // not a hack.
          position={[box.x - rect.w / 2, rect.h / 2 - box.y, FACE_Z + 1.5]}
        />
      ))}
    </>
  )
}

/** The slab's rim: the same rounded rect the DOM authors (one constant),
 *  extruded into an actual side wall with a chamfered chrome edge — one
 *  flat machined facet (bevelSegments 1), cut INTO the outline
 *  (bevelOffset −size) so the slab's silhouette stays exactly where the
 *  corona's SDF and the bounce walls believe it is. Chrome is the
 *  environment's mirror: the PMREM bake of the artwork is what the
 *  facet actually reflects. */
function SlabRim({ rect }: { rect: RailRect }) {
  // The chamfer's cut is baked into vertices, so those two tuning knobs
  // re-machine the extrusion (rev); the material scalars drip per frame.
  const rev = useSyncExternalStore(subscribeTuning, getTuningRev)
  // Machined once, at the size it happened to be built for. A resize
  // does NOT come back here: extruding a bevelled rounded rect is far
  // too expensive to do per drag tick, so the chamfer is nine-sliced
  // instead — corners translate, straight spans stretch, normals stay
  // as machined (knobsResize).
  const assets = useMemo(() => {
    void rev // the geometry knobs in knobsTuning changed
    // A fixed reference size, not the size it first mounted at: the
    // re-fit is exact for any target, so the machined buffer should be
    // deterministic rather than an accident of first render.
    const built = RIM_BUILD
    const shape = roundedRectShape(built.w + BEZEL_LIP * 2, built.h + BEZEL_LIP * 2, PANEL_RADIUS + BEZEL_LIP)
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: SLAB_DEPTH,
      bevelEnabled: true,
      // Thickness stays under FACE_Z: the captured face must keep
      // standing proud of the chamfer's front lip (the tuning slider's
      // ceiling enforces the same bound).
      bevelThickness: knobsTuning.rimBevelDepth,
      bevelSize: knobsTuning.rimBevelSize,
      bevelOffset: -knobsTuning.rimBevelSize,
      bevelSegments: 1,
      curveSegments: 24,
    })
    geometry.translate(0, 0, -SLAB_DEPTH)
    const position = geometry.getAttribute('position') as THREE.BufferAttribute
    const material = new THREE.MeshStandardMaterial({
      color: 0xe8ebef,
      metalness: knobsTuning.rimMetal,
      roughness: knobsTuning.rimRough,
    })
    // Kept unremapped, so every re-fit starts from the machined shape
    // and rounding cannot compound across a long drag.
    return { geometry, material, built, base: Float32Array.from(position.array as Float32Array) }
  }, [rev])

  useLayoutEffect(() => {
    const position = assets.geometry.getAttribute('position') as THREE.BufferAttribute
    nineSlice(
      assets.base,
      position.array as Float32Array,
      assets.built.w,
      assets.built.h,
      rect.w,
      rect.h,
    )
    position.needsUpdate = true
    // The silhouette moved, so the things that cull and light against it
    // must be told. Normals do not: a rigid corner and a stretched
    // straight span both leave every normal pointing where it did.
    assets.geometry.computeBoundingSphere()
  }, [assets, rect.w, rect.h])
  useEffect(
    () => () => {
      assets.geometry.dispose()
      assets.material.dispose()
    },
    [assets],
  )
  useFrame(() => {
    assets.material.metalness = knobsTuning.rimMetal
    assets.material.roughness = knobsTuning.rimRough
    assets.material.envMapIntensity = knobsTuning.rimEnv
  })
  return <mesh geometry={assets.geometry} material={assets.material} userData={{ matter: true }} />
}

/** The slab on its mount: pointer-follow rake with spring dynamics, and
 *  the counter-thunk a landing lever kicks into it. Real geometry under
 *  a moving vantage is the parallax a flat page cannot counterfeit. */
function PanelRig({
  rect,
  kick,
  children,
}: {
  rect: RailRect
  kick: React.RefObject<((dir: number) => void) | null>
  children: React.ReactNode
}) {
  const group = useRef<THREE.Group>(null)
  const motion = useRef({
    rx: { x: 0, v: 0 } as SpringState,
    ry: { x: 0, v: 0 } as SpringState,
    px: 0,
    py: 0,
    /** Last REAL screen pointer, CSS px — the carry gesture's ruler. */
    client: { x: 0, y: 0 },
    pose: null as { x: SpringState; y: SpringState } | null,
    target: { x: 0, y: 0 },
    grab: null as { dx: number; dy: number } | null,
    carried: false,
  })

  useEffect(() => {
    const finishCarry = () => {
      panelDrag.active = false
      panelDrag.pointerId = null
      motion.current.grab = null
    }
    kick.current = (dir: number) => {
      motion.current.rx.v += PANEL_KICK * dir
    }
    const onMove = (e: PointerEvent) => {
      // Forwarded synthetic moves bubble here too, carrying PANEL
      // coordinates — the very thing this gesture displaces. Only the
      // trusted screen pointer may steer the slab.
      if (!e.isTrusted) return
      const m = motion.current
      m.client.x = e.clientX
      m.client.y = e.clientY
      m.px = (e.clientX / window.innerWidth) * 2 - 1
      m.py = (e.clientY / window.innerHeight) * 2 - 1
      if (panelDrag.active && panelDrag.pointerId === e.pointerId && e.buttons === 0) {
        finishCarry()
      }
    }
    // The handle's forwarded pointerdown arms the carry; the trusted
    // release anywhere — over the art, off the panel — disarms it.
    const onUp = (e: PointerEvent) => {
      if (e.isTrusted && panelDrag.pointerId === e.pointerId) finishCarry()
    }
    const onBlur = () => finishCarry()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') finishCarry()
    }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      kick.current = null
      finishCarry()
    }
  }, [kick])

  // A resize re-berths a panel the user has not carried; a carried one
  // stays where their hand left it.
  useEffect(() => {
    const m = motion.current
    if (!m.carried) {
      m.target.x = rect.worldX
      m.target.y = rect.worldY
    }
  }, [rect])

  useFrame((_, dt) => {
    const m = motion.current
    if (!m.pose) {
      m.pose = {
        x: { x: rect.worldX, v: 0 },
        y: { x: rect.worldY, v: 0 },
      }
      m.target = { x: rect.worldX, y: rect.worldY }
    }
    const pointerX = m.client.x - window.innerWidth / 2
    const pointerY = window.innerHeight / 2 - m.client.y
    if (panelDrag.active) {
      if (!m.grab) {
        // Grab where the hand landed, not the panel center — the slab
        // must not jump into the hand.
        m.grab = { dx: m.pose.x.x - pointerX, dy: m.pose.y.x - pointerY }
        m.carried = true
      }
      m.target.x = pointerX + m.grab.dx
      m.target.y = pointerY + m.grab.dy
    } else {
      m.grab = null
    }
    if (berthPinned(panelResize.active, m.carried)) {
      // A hand on the corner is not a throw. The glide spring is the
      // slab's momentum AFTER a carry; a resize has no travel to have
      // momentum about — the berth shift is bookkeeping on w/2. Run one
      // through the other and the berth runs away from the hand: it
      // moves at half the hand's speed, and a spring this soft trails a
      // ramp by 2ζ/ωn × rate. Measured on this very integrator: 15 px
      // behind at a slow 200 px/s, 46 px at an ordinary 600, 108 px at
      // 1400 — then 0.88 s of swing across the mark 11 times once the
      // hand stops. So while the grip is held, the un-carried slab IS
      // its berth. Same rule the walls already keep: the hand is not a
      // bounce, and it is not a glide either.
      //
      // The berth comes from `rect` here, not from the effect below
      // that mirrors it: the effect runs a commit later, and during a
      // drag every commit is a frame of lag. Zeroing the velocity is
      // not tidiness — `leanY`/`leanX` read it, so a nonzero one would
      // tilt the slab as if it were being flown across the glass.
      m.target.x = rect.worldX
      m.target.y = rect.worldY
      m.pose.x.x = rect.worldX
      m.pose.x.v = 0
      m.pose.y.x = rect.worldY
      m.pose.y.v = 0
    } else {
      stepSpring(m.pose.x, m.target.x, PANEL_GLIDE_SPRING, dt)
      stepSpring(m.pose.y, m.target.y, PANEL_GLIDE_SPRING, dt)
    }

    // The viewport's edges are walls: a thrown slab bumps and keeps
    // most of its speed; a held one is pressed dead against the glass
    // (e = 0 — the hand is not a bounce). Each impact flinches the
    // tilt springs about the axis of the wall it struck.
    const exW = (rect.w + BEZEL_LIP * 2) / 2
    const exH = (rect.h + BEZEL_LIP * 2) / 2
    const e = panelDrag.active ? 0 : PANEL_RESTITUTION
    const clampKick = (n: number) => Math.max(-BOUNCE_TILT_MAX, Math.min(BOUNCE_TILT_MAX, n))
    const hitX = reflect(m.pose.x, exW - window.innerWidth / 2, window.innerWidth / 2 - exW, e)
    const hitY = reflect(m.pose.y, exH - window.innerHeight / 2, window.innerHeight / 2 - exH, e)
    if (hitX) m.ry.v += clampKick(hitX * BOUNCE_TILT)
    if (hitY) m.rx.v += clampKick(hitY * BOUNCE_TILT)

    // The slab leans into its own travel — yaw from sideways speed,
    // pitch from vertical — on top of the resting pointer-follow sway.
    const clampTilt = (n: number) => Math.max(-DRAG_TILT_MAX, Math.min(DRAG_TILT_MAX, n))
    const leanY = clampTilt(m.pose.x.v * DRAG_TILT)
    const leanX = clampTilt(-m.pose.y.v * DRAG_TILT)
    // Wherever it stands, the slab shows its face to the middle of the
    // glass — a standing yaw from its own sprung position, so a carry
    // re-aims it through the same sway spring instead of snapping.
    const facing = centerFacingYaw(m.pose.x.x, window.innerWidth / 2)
    stepSpring(m.ry, facing + m.px * 0.055 + leanY, PANEL_SPRING, dt)
    stepSpring(m.rx, -m.py * 0.04 + leanX, PANEL_SPRING, dt)

    // Publish the slab's footprint on the art plane, then how much
    // luminous energy that footprint is standing in front of — the
    // light rig occludes each glint against it, and the shade and
    // corona scale by the level. A dead picture (`artClock.lit` → 0)
    // has no energy for the slab to block.
    backlight.x = m.pose.x.x
    backlight.y = m.pose.y.x
    backlight.w = rect.w + BEZEL_LIP * 2
    backlight.h = rect.h + BEZEL_LIP * 2
    backlight.level = backlightAmount(backlight, knobsValues, artClock.t, window.innerWidth) * artClock.lit

    const g = group.current
    if (!g) return
    g.position.set(m.pose.x.x, m.pose.y.x, 0)
    g.rotation.x = m.rx.x
    g.rotation.y = m.ry.x
  })

  return (
    <group position={[rect.worldX, rect.worldY, 0]} ref={group}>
      {children}
    </group>
  )
}

/** Panel-local coordinates: the face's centre is the slab's origin. */
const toLocal = (rectNow: RailRect, f: Feature): [number, number] => [
  f.x - rectNow.w / 2,
  rectNow.h / 2 - f.y,
]

interface StageHandle {
  setRect: Dispatch<SetStateAction<RailRect | null>>
  setFeatures: Dispatch<SetStateAction<PanelFeatures | null>>
}

/**
 * Everything the panel is, owned by a component the THREE reconciler
 * renders — and that is the entire point of this component existing.
 *
 * The measurement is synchronous: one pointer event writes `--knb-w`,
 * forces the reflow and reads the arrangement back. Getting that reading
 * to the slab, the rim and the hardware in the SAME event is the whole
 * problem, and where the state lives decides whether it is possible.
 *
 * State held by the component that renders `<Canvas>` reaches the three
 * root through Canvas's own layout effect, which `await`s
 * `root.configure()` before calling `root.render(children)`. That await
 * makes the handover a microtask, so the three root commits a frame later
 * and NOTHING flushed from the DOM side can pull it forward — measured:
 * with `react-dom`'s `flushSync` around the drag, the host's box still
 * ended 21 of 23 pointer events on the previous step. Every consumer
 * below was therefore exactly one drag step behind the face painted for
 * them: a 15px band of the panel cut off the right edge on every frame of
 * every drag, and at a container query breakpoint a whole arrangement
 * (panel 463 tall inside a host still declaring 721) squashed into the
 * top 0.64 of its own texture.
 *
 * State held HERE schedules on the three root directly, where r3f's own
 * `flushSync` commits it inside the event. Measured on the same probe:
 * plain setState async, `flushThree(setState)` synchronous.
 */
function PanelStage({
  handle,
  widthNow,
  assets,
  kick,
  onHost,
}: {
  handle: RefObject<StageHandle | null>
  widthNow: RefObject<number>
  assets: HardwareAssets
  kick: RefObject<((dir: number) => void) | null>
  onHost: (el: HTMLElement | null) => void
}) {
  const [rect, setRect] = useState<RailRect | null>(null)
  const [features, setFeatures] = useState<PanelFeatures | null>(null)
  // Published during render, not from an effect: the drag's very first
  // measurement can arrive before any effect in this tree has run, and a
  // setter's identity never changes, so there is nothing to keep in sync.
  handle.current = { setRect, setFeatures }

  // Seed the box, and follow the window. A DRAG does not come through
  // here — it measures the arrangement it produced and sets the whole
  // rect, worldX included. This is the other two ways the box changes:
  // first paint, and a viewport that resized under a panel of fixed width.
  useLayoutEffect(() => {
    const place = () => {
      const w = widthNow.current
      setRect((prev) => ({
        w,
        h: prev?.h ?? Math.max(430, window.innerHeight - INSET * 2),
        worldX: window.innerWidth / 2 - INSET - w / 2,
        worldY: 0,
      }))
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [widthNow])

  return (
    <>
      {rect && rect.w > 0 && rect.h > 0 && (
        <PanelRig rect={rect} kick={kick}>
          <BacklightCorona rect={rect} />
          <SlabRim rect={rect} />
          <SurfaceApp
            label="knobs-panel"
            width={rect.w}
            height={rect.h}
            roughness={0.5}
            metalness={0.18}
            // DOM light, held to a low floor: enough for the lamp
            // halos and engravings to keep a breath of life when the
            // room dims, low enough that the charcoal body stays
            // charcoal. The LCD windows do NOT ride this term — they
            // are pure emitters (ReadoutWindows, below).
            emissiveIntensity={knobsTuning.lightDom}
            frustumCulled={false}
            userData={{ matter: true }}
            position={[0, 0, FACE_Z]}
            onHost={onHost}
            content={<KnobsPanel />}
          >
            <planeGeometry args={[rect.w, rect.h]} />
            <ReadoutWindows rect={rect} readouts={features?.readouts ?? NO_READOUTS} />
            <DialRings rect={rect} dials={features?.dials ?? NO_READOUTS} />
          </SurfaceApp>
          <FaceShade rect={rect} readouts={features?.readouts ?? NO_READOUTS} />
          <ReadoutLamps rect={rect} readouts={features?.readouts ?? NO_READOUTS} />
          {features && (
            <>
              {features.knobs.map((f, i) => {
                const def = KNOBS_ROTARY[i]
                if (!def) return null
                const [x, y] = toLocal(rect, f)
                return <KnobHardware key={def.key} def={def} x={x} y={y} assets={assets} />
              })}
              {features.toggles.map((f, i) => {
                const def = KNOBS_TOGGLES[i]
                if (!def) return null
                const [x, y] = toLocal(rect, f)
                return (
                  <ToggleHardware key={def.key} tKey={def.key} x={x} y={y} assets={assets} kick={kick} />
                )
              })}
              {features.lamps.map((f, i) => {
                const def = KNOBS_LAMPS[i]
                if (!def) return null
                const [x, y] = toLocal(rect, f)
                return <LampHardware key={def.key} def={def} x={x} y={y} assets={assets} />
              })}
              {features.screws.map((f, i) => {
                const [x, y] = toLocal(rect, f)
                return (
                  <ScrewHardware key={i} x={x} y={y} clock={SCREW_CLOCK[i % SCREW_CLOCK.length]} assets={assets} />
                )
              })}
            </>
          )}
        </PanelRig>
      )}
    </>
  )
}

export function KnobsApp({ chips }: { chips?: React.ReactNode }) {
  const hostCleanup = useRef<(() => void) | null>(null)
  const kick = useRef<((dir: number) => void) | null>(null)
  const assets = useHardwareAssets()
  // The panel's own state lives inside the Canvas — see `PanelStage`. This
  // is the line to it.
  const stage = useRef<StageHandle | null>(null)

  // The panel's WIDTH is what a hand can drag. Its HEIGHT is not: the
  // panel is a container query container, so its width decides its
  // arrangement and its arrangement decides its height. The measure pass
  // below reports what the DOM settled on, and the slab, the capture and
  // the rim take their size from that.
  //
  // A ref, not state. It used to be state so that a commit would re-run
  // the placement effect, but the drag path never needed that commit: it
  // measures the arrangement its own write produced and publishes the
  // whole rect from one reading. The setState was pure latency — a second
  // generation of the same number, arriving a frame later, racing the
  // first.
  const widthNow = useRef(RAIL_W)

  // The hand's line to the DOM. `onHost` fills this in; a drag calls it
  // instead of waiting for React, because the panel lives inside the
  // Surface's OWN root and a prop would need two commits and a reflow to
  // arrive. See the comment on `resize` below for what one call does.
  const resizeNow = useRef<((w: number) => void) | null>(null)

  // Set while a corner is being dragged. See `.knb-resizing` in
  // knobs.css for what the flag buys and why it is not left on.
  const resizingNow = useRef<((on: boolean) => void) | null>(null)

  const finishResize = useCallback(() => {
    panelResize.active = false
    panelResize.pointerId = null
    panelResize.startX = Number.NaN
    panelResize.startW = 0
    resizingNow.current?.(false)
  }, [])

  // The corner grip armed the gesture; the geometry happens here, on the
  // real screen pointer, for the same reason the carry does — the
  // forwarded stream's coordinates live on the panel being resized.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      // Trusted only. The relay dispatches forwarded copies of every
      // move into the parked DOM, and those bubble to this same window
      // carrying CAPTURE coordinates — seeding the origin from one puts
      // the hand 1100px from where it really is, and the panel jumps to
      // its stop on the first twitch. isTrusted is the seam.
      if (
        !e.isTrusted ||
        !panelResize.active ||
        panelResize.pointerId !== e.pointerId
      )
        return
      if (e.buttons === 0) {
        finishResize()
        return
      }
      // The first real move seeds the origin the DOM could not supply,
      // and is also the moment `will-change` stops being a lie.
      if (Number.isNaN(panelResize.startX)) {
        panelResize.startX = e.clientX
        resizingNow.current?.(true)
      }
      const w = resizeWidth(panelResize.startW, e.clientX - panelResize.startX, window.innerWidth)
      if (w === widthNow.current) return
      widthNow.current = w
      // One call, and it finishes the whole step before this event
      // returns: write `--knb-w`, force the reflow, read the arrangement
      // back, and commit it to the slab, the rim and every piece of
      // hardware. There is no second half to keep in step with, which is
      // why there is no `flushSync` here any more — see `resize` below.
      resizeNow.current?.(w)
    }
    const onUp = (e: PointerEvent) => {
      if (!e.isTrusted || panelResize.pointerId !== e.pointerId) return
      finishResize()
    }
    const onBlur = () => finishResize()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') finishResize()
    }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      finishResize()
    }
  }, [finishResize])

  // Where each control sits comes from the captured DOM itself — the
  // layout is measured, not duplicated, so the hardware can only ever
  // stand where the face actually painted its wells.
  const onHost = useCallback((el: HTMLElement | null) => {
    hostCleanup.current?.()
    hostCleanup.current = null
    finishResize()
    if (!el) {
      stage.current?.setFeatures(null)
      return
    }
    let raf = 0
    let watched: Element | null = null
    // The width the panel is being asked for. Written straight onto the
    // host so the cascade carries it — no render, no root, no props.
    el.style.setProperty('--knb-w', `${widthNow.current}px`)

    // The PANEL is watched, never the host. The host's box is now a
    // function of the panel's, written by `measure` below — observing
    // it would make this a callback that resizes the very thing it just
    // heard about, which is a ResizeObserver loop by definition.
    // Watching the panel loses nothing: both ways the arrangement can
    // change, a dragged width and a reflow at a fixed width, move ITS
    // box. It is attached from inside `measure` because the panel
    // belongs to the Surface's own root and does not exist yet here.
    const ro = new ResizeObserver(() => measure())

    const measure = () => {
      const root = el.querySelector('.knb-panel') as HTMLElement | null
      const base = root?.getBoundingClientRect()
      if (!root || !base || base.width === 0) {
        raf = requestAnimationFrame(measure)
        return
      }
      if (watched !== root) {
        if (watched) ro.unobserve(watched)
        ro.observe(root)
        watched = root
      }
      // Measure only. The host's box belongs to the package, which sizes
      // it from `rect` in a layout effect, and `rect` is set below — one
      // writer, one number.
      //
      // This used to write the box here as well, to get ahead of a React
      // commit that ran late. Two writers for one box is a race, and it
      // lost: every drag step wrote the box three times — correct, then
      // the PREVIOUS step's box on top from a commit still carrying the
      // old `rect`, then correct again. At a container query breakpoint
      // the middle write is a whole tier, 835px of host declared around
      // a 721px panel. `drawElementImage` rasterizes the host at its own
      // box and the mesh maps the canvas's, so a short panel in a tall
      // host lands in the top 463/721 = 0.64 of its own texture: the
      // face squashed into the upper two-thirds of the slab with the
      // hardware standing at full-height positions. What made the second
      // writer unnecessary is `flushSync` in the drag above — the commit
      // now happens inside the same pointer event this measurement does,
      // so there is nothing left to get ahead of.
      const w = Math.round(base.width)
      const h = Math.round(base.height)
      const centers = (sel: string): Feature[] =>
        Array.from(root.querySelectorAll(sel)).map((n) => {
          const r = (n as HTMLElement).getBoundingClientRect()
          return { x: r.left + r.width / 2 - base.left, y: r.top + r.height / 2 - base.top }
        })
      const boxes = (sel: string): FeatureBox[] =>
        Array.from(root.querySelectorAll(sel)).map((n) => {
          const r = (n as HTMLElement).getBoundingClientRect()
          return {
            x: r.left + r.width / 2 - base.left,
            y: r.top + r.height / 2 - base.top,
            w: r.width,
            h: r.height,
          }
        })
      const next: PanelFeatures = {
        knobs: centers('.knb-dial'),
        toggles: centers('.knb-toggle-well'),
        lamps: centers('.knb-lamp-bezel'),
        screws: centers('.knb-screw'),
        readouts: boxes('.knb-dial-value'),
        dials: boxes('.knb-dial'),
      }
      // Both, in one commit, on the root that can actually take it now.
      //
      // `flushThree` is r3f's flush, not `react-dom`'s, and the
      // difference is the whole fix: these setters belong to `PanelStage`,
      // which the three reconciler renders, and only that reconciler's
      // flush commits them synchronously. Left to their own schedule they
      // landed a frame later, which put every consumer one drag step
      // behind the face painted for them.
      //
      // The WHOLE rect, from one reading. Width and height used to arrive
      // on separate commits — the height from here, the width from the
      // drag's `setWidth` — and the commit in between handed the Surface
      // a width one step out of date, which the package then wrote onto
      // the host. Measuring both from the same `base` makes that gap
      // unrepresentable.
      //
      // The height cannot oscillate: the panel's height is auto, so it
      // measures its content whatever the host is set to, and the next
      // pass reads the same number back.
      const commit = stage.current
      if (!commit) return
      flushThree(() => {
        commit.setFeatures((prev) => (featuresEqual(prev, next) ? prev : next))
        commit.setRect((prev) =>
          prev && prev.w === w && Math.abs(prev.h - h) < 1
            ? prev
            : { w, h, worldX: window.innerWidth / 2 - INSET - w / 2, worldY: prev?.worldY ?? 0 },
        )
      })
    }

    // One drag step, start to finish, inside the pointer event: ask for
    // the width, read back the arrangement it produced.
    // `getBoundingClientRect` in `measure` forces the reflow, so the
    // read is of the NEW layout, not the last one — which is what stops
    // the dials trailing the hand. The container query resolves inside
    // that same forced layout: swept across both breakpoints, the
    // in-event read matched the settled height at every width, and no
    // dial moved by so much as a pixel afterwards.
    const resize = (w: number) => {
      // `--knb-w` and nothing else. The panel's width is this custom
      // property; the HOST's box is the package's business, and it
      // arrives with the same commit as everything else — which is now
      // THIS commit, because `measure` flushes the three root before it
      // returns.
      //
      // Writing the host's width here as well was tried, on the argument
      // that it is a known number rather than a measurement and so
      // cannot race. It can: the write lands in the event and the
      // package's identical write lands in the commit, and for the two
      // frames in between the host is a step wider than the canvas that
      // scales its replay. Measured, both breakpoints, every run.
      el.style.setProperty('--knb-w', `${w}px`)
      measure()
    }
    resizeNow.current = resize

    // One class, on the capture root, for the length of one gesture.
    const setResizing = (on: boolean) => el.classList.toggle('knb-resizing', on)
    resizingNow.current = setResizing

    raf = requestAnimationFrame(measure)
    hostCleanup.current = () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      resizeNow.current = null
      resizingNow.current = null
    }
  }, [finishResize])

  return (
    <div className="knb-page">
      <KnobsArt />

      <Canvas
        className="knb-overlay"
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: OVERLAY_Z }}
        gl={{ alpha: true, antialias: true }}
        // A held knob drag paints the captured DOM many times a second,
        // and the springs/lights move every frame regardless.
        frameloop="always"
        dpr={[1, 2]}
        camera={{ fov: FOV, position: [0, 0, 1000] }}
        onCreated={(state) => state.gl.setClearAlpha(0)}
      >
        <PixelPerfect />
        <CanvasPointerGate isTarget={(object) => Boolean(object.userData.matter)} />
        <ArtEnvironment />
        <ArtLightRig />
        <TuningDrip assets={assets} />
        <PanelStage handle={stage} widthNow={widthNow} assets={assets} kick={kick} onHost={onHost} />
      </Canvas>

      {chips}
      <KnobsTweakPanel />
    </div>
  )
}

// This scene's shaders live in useMemo caches, and React Fast Refresh
// PRESERVES those through a hot update — an edited GLSL string keeps
// rendering its old compiled program until a full reload, so what's on
// screen silently stops matching the file (a whole review cycle was
// spent on pixels no edit could change). Decline the swap: any edit to
// this module reloads the page it is judged on.
if (import.meta.hot) {
  import.meta.hot.accept(() => import.meta.hot?.invalidate())
}
