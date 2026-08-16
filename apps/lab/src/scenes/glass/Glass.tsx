import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { MeshTransmissionMaterial, useFBO } from '@react-three/drei'
import { SurfaceApp, useSurfaceTexture } from '@petepetrash/munari'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  GLASS_DEFAULTS,
  GlassSdfCompositor,
  MAX_BLOBS,
  MAX_GLOWS,
  MAX_RIPPLES,
  SdfGlassPanel,
  sdRoundRect,
  sdRoundRectGrad,
  sdfPanelLabels,
  sdfPanelParams,
  type GlassBlob,
  type GlassGlow,
  type GlassParams,
  type GlassRipple,
} from './glassSdf'
import { glassTuning } from './glassTuning'
import { animate, motionValue } from 'motion'

// The glass scene — the glass spike, and then the compositor that replaced it.
//
// Question under test: can a Surface wear a physically-based glass material
// (the "liquid glass" direction) while its DOM stays legible and live, and
// does refraction survive MULTIPLE levels of depth — glass in front of glass
// in front of a bright wall?
//
// TWO ANSWERS, both live. `?glass=mtm` (or `__glass.setMode('mtm')`) runs
// the mesh path: real extruded geometry wearing drei's MeshTransmissionMaterial,
// one scene render per panel. `?glass=sdf` (the default) runs the SDF path: no glass
// geometry at all — one scene render, then one screen-space pass per panel
// that intersects the eye ray with the panel's plane and evaluates a rounded
// rect as a distance field there. See glassSdf.tsx / glassSdfShader.ts. The
// switch exists so the comparison is a console call, not a git checkout.
//
// Architecture per MTM glass panel, all through the material-slot seam:
//   - `material="none"` Surface wearing drei's MeshTransmissionMaterial on
//     an extruded rounded-rect (flat faces, rounded corner EDGES — a card,
//     not a soap bar). The glass body never samples the DOM.
//   - The DOM rides a hair-lifted transparent quad reading
//     `useSurfaceTexture()` at true UV — the world bends THROUGH the glass,
//     the ink sits ON it and never distorts.
//   - `.ui-root:has(> [data-glass-root])` (app CSS) clears the opaque
//     bg-background so the texture rasterizes with real alpha.
//
// Depth ladder, back to front: wall (DOM refraction target) → glass sign-in
// form → glass CTA surfacing out of the form's face. The CTA's refraction
// must show the form's glass AND its ink AND the wall behind both — that's
// the multi-level verdict.
//
// The scene is framed as a PAGE, not a room: a 22° lens dead on axis, no
// floor, no fog, no props, the form centred at the origin (see the framing
// note above CAM_FOV for why the focal length does more of that work than
// the camera's position does). What is left moving is the one thing CSS
// could not do — orbs crossing the field and merging with the form as they
// pass through it, and light struck into the CTA where a real DOM click
// landed.
//
// Tuning: every transmission parameter is live on `window.__glass`
// (`set('ior', 1.4)` hits every panel; `setFor('glass-pill', ...)` one;
// `setResolution('glass-card', 512)` forces a square refraction buffer,
// no arg returns it to viewport-matched).

const PX = 200
const WALL_W = 1700
const WALL_H = 950
const CARD_W = 360
const CARD_H = 460
const PILL_W = 232
const PILL_H = 68
const CARD_HX = CARD_W / PX / 2
const CARD_HY = CARD_H / PX / 2
const CARD_R = GLASS_DEFAULTS.radius

// ---- the framing --------------------------------------------------------
//
// A long lens, dead on axis. Both halves of that matter and they are not the
// same lever: standing the camera square to the panel is what centres the
// form, but it is the NARROW fov that makes the thing read as a web app
// rather than a rectangle photographed in a room. At 45° the card's own
// edges diverge — the near corners splay, the far ones converge — and the eye
// reads a solid in perspective no matter where the camera stands. At 22° the
// convergence falls under the width of the hairline rim and the panel reads
// flat, like a surface you are looking AT instead of a slab you are looking
// ACROSS. The 3D is still entirely real; it has simply stopped announcing
// itself, which leaves the refraction as the only thing on screen that could
// not be CSS.
const CAM_FOV = 22
const CAM_Z = 10
// Where the wall sits behind the glass. This gap IS the refraction budget:
// the shader bends the eye ray and re-projects it, so what a pixel of glass
// shows depends on how far the wall is from where the ray started. Flat
// against the card there would be nothing to displace.
const WALL_Z = -1.5

// The neon is `--signal` from the lab's token set (app.css). It doubles as
// the renderer's clear colour so the wall never has to reach the corners of
// an unusually wide viewport to look continuous.
const NEON = '#e8402a'

// The CTA, in the panel's own units. It sits over the card's lower third
// rather than beside it, and only 0.14 off its face — near enough that its
// own glass still refracts the card's ink underneath, which is what sells it
// as something surfacing out of the form instead of a second card parked in
// front. (The compositor already handles glass-through-glass: it sorts by
// view-space z and each pass reads what the last one wrote.)
const PILL_Y = -0.8
const PILL_Z = 0.14
// Hysteresis on the contact test, borrowed from the smooth-min's own blend
// radius: inside this band the two surfaces are already fusing, so it is
// also the honest width of "the moment of contact".
const RIPPLE_BAND = GLASS_DEFAULTS.smooth * 0.5
const RIPPLE_LIFE = GLASS_DEFAULTS.rippleLife

// DOM textures ride the default auto LOD. We tried `resolution="max"` here
// and measured it SOFTER up close: a pinned tier oversupplies at most
// distances, and its mip chain trilinear-blends toward a box-filtered
// half-res level whenever the view is even partially minified. Auto's
// density-matched re-raster samples one sharp level by construction —
// nothing beats re-running the vector paint record at the density the
// screen actually needs. (Pin only for memory determinism / no mid-shot
// re-rasters, and accept the trade.) The refraction buffers are a separate,
// viewport-matched resolution (see GlassPanel).

// ---- geometry: an extruded rounded rect --------------------------------

function roundedRectGeometry(w: number, h: number, r: number, depth: number) {
  const outline = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  outline.moveTo(x + r, y)
  outline.lineTo(x + w - r, y)
  outline.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false)
  outline.lineTo(x + w, y + h - r)
  outline.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false)
  outline.lineTo(x + r, y + h)
  outline.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false)
  outline.lineTo(x, y + r)
  outline.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false)
  const geo = new THREE.ExtrudeGeometry(outline, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 4,
    curveSegments: 24,
  })
  geo.translate(0, 0, -depth / 2)
  return geo
}

// ---- the glass panel ----------------------------------------------------

const BEVEL = 0.02
// The front face sits at depth/2 + BEVEL (bevels extend past the extrusion);
// the ink floats just above it.
const INK_LIFT = 0.012

// Every knob the console addresses is a number. The two strings in a panel's
// params (`tint`, `glowColor`) are set through their own colour entries.
type GlassKnobs = Record<string, number>
type NumericParams = Omit<GlassParams, 'tint' | 'glowColor'>

/**
 * The transmission knobs this scene tunes. `Pick` keeps them welded to drei's
 * own types instead of restating them, and a mapped type indexes by name —
 * which is what lets the console address one by string with no assertion.
 */
type MtmKnobs = Pick<
  TransmissionMaterial,
  | 'transmission'
  | 'thickness'
  | 'roughness'
  | 'ior'
  | 'chromaticAberration'
  | 'anisotropicBlur'
  | 'distortion'
>

/**
 * Write one named knob onto a live object, and report whether it landed.
 *
 * The caller is a person at a console, so the name is untrusted and this is
 * the boundary that checks it. A name the target does not already carry is
 * refused rather than installed — otherwise a typo leaves a dead property on
 * an object the renderer reads every frame, and the console says it worked.
 */
function pokeKnob(bag: GlassKnobs, key: string, value: number): boolean {
  // `in` walks the REAL object, which carries names this type never listed:
  // a material's `name` and `uuid` are there and are strings. The second
  // guard is what refuses those, even though the index type says otherwise.
  if (!(key in bag)) return false
  if (!Number.isFinite(bag[key])) return false
  bag[key] = value
  return true
}

/**
 * drei's transmission material — a physical material plus the knobs its own
 * shader adds. Taken from the component's own ref type rather than restated,
 * so the tweak panel and drei cannot drift apart.
 */
type TransmissionMaterial = NonNullable<React.ComponentRef<typeof MeshTransmissionMaterial>>

const glassMaterials = new Map<string, TransmissionMaterial>()

// ---- the refraction buffers --------------------------------------------
//
// MTM's default mode hides ONLY the host mesh from its own buffer (a
// DiscardMaterial swap on `parent.material`) — children keep rendering, so
// the ink quad ghosted behind its own glass (measured: every label doubled,
// one crisp copy + one refracted). The documented escape hatch is the
// `buffer` prop: hand MTM a texture and it renders nothing itself. So a
// scene-level coordinator renders one FBO per panel with that panel's WHOLE
// group hidden (glass + ink), leaving every OTHER panel — glass, ink and
// all — visible in it. Glass-through-glass survives (a rear panel renders
// into a front panel's buffer with its own material, sampling its own
// last-frame buffer — one frame stale, invisible in practice), and nobody
// refracts their own ink. Tone mapping must be OFF during buffer renders,
// exactly as MTM's internal pass does it, or glass double-tonemaps.

interface GlassPass {
  group: React.RefObject<THREE.Group | null>
  fbo: THREE.WebGLRenderTarget
}

const glassPasses = new Map<string, GlassPass>()

// A second constraint, browser-bought: these are SCREEN-SPACE buffers,
// rendered from the camera, so a naive "hide only yourself" pass leaves a
// panel that is IN FRONT of you inside your buffer — and your refraction
// then shows the front panel's image through itself (measured: ghost
// "Continue" copies inside the pill, via the card's refraction of it).
// Physically a panel's refraction contains only what is BEHIND it. So:
// sort near→far and hide cumulatively — when panel P's buffer renders, P
// and every panel nearer than P are hidden. The rear panel still appears
// in the front panel's buffer (glass-through-glass survives); the front
// panel never appears in the rear one's.
const worldPos = new THREE.Vector3()

function GlassBufferCoordinator() {
  useFrame((state) => {
    if (glassPasses.size === 0) return
    const { gl, scene, camera } = state
    const entries = [...glassPasses.values()].filter((e) => e.group.current)
    if (entries.length === 0) return
    const dist = (e: GlassPass) =>
      camera.position.distanceTo(e.group.current!.getWorldPosition(worldPos))
    entries.sort((a, b) => dist(a) - dist(b))
    const oldTone = gl.toneMapping
    gl.toneMapping = THREE.NoToneMapping
    for (const e of entries) {
      // Hide, render, and STAY hidden for the farther panels' passes.
      e.group.current!.visible = false
      gl.setRenderTarget(e.fbo)
      gl.render(scene, camera)
    }
    for (const e of entries) e.group.current!.visible = true
    gl.setRenderTarget(null)
    gl.toneMapping = oldTone
  })
  return null
}

function GlassInk({ w, h, depth }: { w: number; h: number; depth: number }) {
  const texture = useSurfaceTexture()
  // The glass root rasterizes with real alpha, and GPU bilinear filtering
  // averages RAW rgb across texels — straight-alpha data mixes the white of
  // near-transparent pixels (bg-white/10 is white rgb at α≈0.1) into every
  // boundary with opaque content: a light halo around the text-selection
  // rectangle, measured in the glass scene. Premultiplying at upload makes the
  // filtering average premultiplied values; the blend factors below stop
  // the already-multiplied rgb from being multiplied by alpha again. Exact
  // for an unlit passthrough material — and under material="none" the ink
  // is this texture's only consumer, so the upload flag can't skew anyone
  // else.
  useEffect(() => {
    if (!texture) return
    texture.premultiplyAlpha = true
    texture.needsUpdate = true
  }, [texture])
  if (!texture) return null
  return (
    <mesh position={[0, 0, depth / 2 + BEVEL + INK_LIFT]}>
      <planeGeometry args={[w / PX, h / PX]} />
      <meshBasicMaterial
        map={texture}
        transparent
        toneMapped={false}
        depthWrite={false}
        blending={THREE.CustomBlending}
        blendEquation={THREE.AddEquation}
        blendSrc={THREE.OneFactor}
        blendDst={THREE.OneMinusSrcAlphaFactor}
      />
    </mesh>
  )
}

interface MtmGlassPanelProps {
  label: string
  width: number
  height: number
  radius?: number
  depth?: number
  /** Square buffer override in px; omit for viewport×dpr-matched (sharpest). */
  resolution?: number
  content: React.ReactNode
  position: [number, number, number]
  rotation?: [number, number, number]
}

function MtmGlassPanel({
  label,
  width,
  height,
  radius = 0.09,
  depth = 0.12,
  resolution,
  content,
  position,
  rotation,
}: MtmGlassPanelProps) {
  const geo = useMemo(
    () => roundedRectGeometry(width / PX, height / PX, radius, depth),
    [width, height, radius, depth],
  )
  useEffect(() => () => geo.dispose(), [geo])

  const group = useRef<THREE.Group | null>(null)
  // The refraction buffer is PER PANEL — sharpness is an individual budget,
  // not a scene setting. Default: match the drawing buffer (CSS size × dpr),
  // so a refracted edge carries the same pixel density as the direct view.
  // The spike's square 768/512 targets were stretched across a widescreen
  // viewport (MTM samples them with screen-space UVs), which halved the
  // horizontal detail — that was most of the "fuzzy edges". 4× MSAA on top,
  // because geometry edges inside the buffer otherwise alias and the frost
  // blur smears the jaggies into mush. `resolution` overrides with a square
  // target for cost experiments (`__glass.setResolution`); useFBO re-sizes
  // the same render target in place, so the registered pass and the MTM
  // `buffer` binding both survive the change.
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  const fbo = useFBO(
    resolution || Math.round(size.width * dpr),
    resolution || Math.round(size.height * dpr),
    { samples: 4 },
  )
  useEffect(() => {
    glassPasses.set(label, { group, fbo })
    return () => {
      glassPasses.delete(label)
    }
  }, [label, fbo])

  return (
    <group ref={group} position={position} rotation={rotation}>
      <SurfaceApp
        label={label}
        width={width}
        height={height}
        material="none"
        content={content}
      >
        <primitive object={geo} attach="geometry" />
        <MeshTransmissionMaterial
          ref={(m: TransmissionMaterial | null) => {
            if (m) glassMaterials.set(label, m)
            else glassMaterials.delete(label)
          }}
          buffer={fbo.texture}
          transmission={1}
          thickness={depth * 2.5}
          roughness={0.08}
          ior={1.5}
          chromaticAberration={0.06}
          anisotropicBlur={0.2}
          distortion={0}
          samples={6}
          // MTM still allocates its internal fboMain/fboBack even though the
          // `buffer` prop short-circuits its render pass; keep them tiny so
          // the only real buffer is ours.
          resolution={32}
        />
        <GlassInk w={width} h={height} depth={depth} />
      </SurfaceApp>
    </group>
  )
}

// ---- the liquid part ----------------------------------------------------
//
// Three circles sharing the sign-in card's plane, smooth-min-unioned into
// its distance field (glassSdfShader.ts). They orbit on an ellipse whose radii
// BREATHE, so each bead cycles through the whole interesting range: tucked
// inside the card (the union is just the card, with a faint swell where the
// bead pushes the rim out), grazing it (a neck forms and stretches), and
// free (a lone glass bead refracting the wall on its own).
//
// The merge is the point. Two meshes in the same plane can only overlap —
// you would see two rims crossing. Two distances MERGE: one coverage, one
// bezel, one refraction, and a rim that flows continuously around the neck,
// because the bezel normal is the gradient of the unioned field rather than
// of either shape. That is not an effect layered on the glass; it is what
// the glass being an equation instead of a mesh buys.
//
// Mutated in place, never through state: the array identity is what the
// compositor registered, and nothing here should cost a React render.
// Contact is a SIGN CHANGE OVER TIME, and a fragment shader has no memory of
// last frame — so it is detected here, on the CPU, at three SDF evaluations
// per frame. The shader gets the conclusion (an origin and an age) rather
// than the state machine.
// The numbers this law runs on live in glassTuning, not here, because every one
// of them is something you have to SEE to judge — how sparse is sparse, how
// hard is a hit, how far apart wake fronts want to be. They are read fresh
// each frame from a mutable object the tweak panel writes to, so a drag
// retunes the running simulation without remounting it.

function OrbDrift({
  blobs,
  ripples,
}: {
  blobs: GlassBlob[]
  ripples: GlassRipple[]
}) {
  const touching = useRef<boolean[]>([])
  const lastGap = useRef<number[]>([])
  // Where each orb last laid down a wake front, so the train is spaced by
  // DISTANCE TRAVELLED rather than by a timer. A timer would make a slow orb
  // stack fronts on top of each other and a fast one leave gaps; spacing by
  // travel lays them along the path at even intervals whatever the speed,
  // which is what a wake actually is.
  const lastWake = useRef<[number, number][]>([])
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime
    const k = glassTuning
    // Resized in place: the compositor holds this exact array and reads its
    // length every frame, so growing or shrinking it is the whole operation.
    const want = Math.max(0, Math.min(MAX_BLOBS, Math.round(k.orbCount)))
    while (blobs.length > want) blobs.pop()
    while (blobs.length < want) blobs.push({ x: 0, y: 0, r: 0 })
    const n = blobs.length
    for (let i = 0; i < n; i++) {
      const b = blobs[i]
      // ── the frequency ladder, which is the whole hypnotic effect ────────
      //
      // Crossing rates are consecutive integers over a common base:
      // (n+i)/(n·CYCLE). Every rate is therefore an exact integer multiple of
      // 1/(n·CYCLE), so the ensemble is strictly periodic with that base —
      // 78 seconds here — while no two orbs ever hold a fixed relationship
      // inside it. This is the pendulum-wave construction, and the reason to
      // reach for it is that it produces order the eye can feel but not
      // predict: the orbs fan out of alignment, sweep through every phase
      // relationship in turn, braid, and re-form exactly. Six orbs on six
      // arbitrary speeds would only ever look like six orbs on six arbitrary
      // speeds — pattern requires commensurability, and drift requires that
      // the ratios not be small integers with each other.
      //
      // The per-orb phase offset is golden-angle rather than a neat i/n
      // stagger: an even stagger reads as a marching column, and the point is
      // scattered arrivals. It shifts WHERE in the cycle each orb sits, not
      // its rate, so the exact recurrence above survives untouched.
      const rate = (n + i) / (n * k.orbCycle)
      const u = (t * rate + ((i * 0.381966) % 1)) % 1
      b.x = (u - 0.5) * 2 * k.orbSpan
      // Lanes, scattered by golden angle so no two sit at the same height and
      // the set doesn't stripe. The slow bob on top is what keeps an orb from
      // taking the same path twice: which lanes actually intersect the card
      // changes over a period incommensurate with the crossings, so the
      // pattern of hits and misses never quite repeats within a loop.
      const lane = k.orbLane * Math.sin(i * 2.39996323)
      b.y = lane + 0.28 * Math.sin(t * 0.37 + i * 1.31)
      b.r = (0.1 + 0.06 * (0.5 + 0.5 * Math.sin(i * 1.7 + 0.9))) *
        (1 + 0.12 * Math.sin(t * 0.4 + i)) * k.orbSize

      // The gap between the two SURFACES, not the two centres. Crossing it
      // is the event; the hysteresis band (the smooth-min's own blend
      // radius) stops a bead that grazes the boundary from machine-gunning
      // ripples on consecutive frames.
      const gap = sdRoundRect(b.x, b.y, CARD_HX, CARD_HY, CARD_R) - b.r
      const was = touching.current[i] ?? false
      const isNow = was ? gap < RIPPLE_BAND : gap < -RIPPLE_BAND
      // Closing speed, in world units per second — a bead that drifts in
      // slowly must not hit as hard as one that arrives fast. Momentum is
      // the impulse, so it scales with radius too: the wave a big bead makes
      // is not the wave a small one makes at the same speed.
      const closing = Math.abs(gap - (lastGap.current[i] ?? gap)) / Math.max(dt, 1e-4)
      lastGap.current[i] = gap
      // The orb's velocity, analytic rather than differenced. Differencing
      // would be simpler but x wraps from +SPAN to -SPAN at the end of each
      // crossing, and a one-frame velocity spike there would fire a wake
      // front at Mach clamp on the wrong side of the panel.
      const vx = 2 * k.orbSpan * rate
      const vy = 0.28 * 0.37 * Math.cos(t * 0.37 + i * 1.31)

      if (isNow !== was) {
        touching.current[i] = isNow
        const impulse = Math.min(closing / 0.5, 2.2) * (b.r / 0.18)
        // Emit AT the contact point — one bead radius back along the
        // outward normal — so the wave starts where the surfaces met and
        // not at the bead's centre, which by then is inside the card.
        const [gx, gy] = sdRoundRectGrad(b.x, b.y, CARD_HX, CARD_HY, CARD_R)
        // Both events are born on the panel's own surface, INSET a little way
        // into live glass — and the inset is a bug fix, not a nicety.
        //
        // The hysteresis band is asymmetric by construction: entry latches at
        // gap < -BAND (the bead is already biting) but release latches at
        // gap >= +BAND (the bead has fully cleared). So a release used to be
        // stamped a whole band OUTSIDE the outline, and the shader multiplies
        // every ripple by `e`, which is zero at the outline and only reaches
        // one a bezel-width inside. The recoil was being emitted into the dead
        // zone and absorbed before it could travel anywhere. It was not that
        // the exit was too quiet — it was that it was never really there.
        //
        // Projecting onto the boundary via the signed distance puts entry and
        // release on the same footing, and the inset guarantees both start
        // where the sheet can actually carry them.
        const dc = sdRoundRect(b.x, b.y, CARD_HX, CARD_HY, CARD_R)
        const inset = dc + GLASS_DEFAULTS.bezel * 0.75
        ripples.push({
          x: b.x - gx * inset,
          y: b.y - gy * inset,
          t0: t,
          // A release recoils — surface tension letting go pulls the sheet
          // back rather than pushing it out — and it recoils WEAKLY. An impact
          // spends the bead's kinetic energy; a pinch-off only releases the
          // surface energy stored in the neck, which is the far smaller
          // budget. Making the release loud was the wrong correction: the
          // reason exits read as nothing happening was that they were being
          // emitted outside the outline (see the inset above), not that they
          // were too quiet.
          amp: isNow ? impulse * k.impactAmp : -k.exitAmp * impulse,
          vx,
          vy,
          // The real difference between the two events, and it is a spectrum,
          // not a volume. Entry loads the sheet across the bead's contact
          // patch, so the source is bead-sized and the ring is broad and low.
          // Exit launches from the NECK of the liquid bridge at the instant it
          // pinches off, which is a small fraction of the bead — so the same
          // machinery radiates a much finer, tighter disturbance that
          // viscosity then eats quickly. Small and fine, not big and quiet.
          src: isNow ? b.r * 0.85 : b.r * k.exitSource,
        })
        if (isNow) lastWake.current[i] = [b.x, b.y]
        if (ripples.length > MAX_RIPPLES) ripples.shift()
      }

      // ── the wake ────────────────────────────────────────────────────────
      // Contact is not an event, it is an interval. Firing once on entry and
      // once on release gave two isolated rings per crossing with nothing
      // between them, which is why the surface read as struck rather than
      // ploughed: an orb spent a second and a half inside the card leaving no
      // evidence of its passage. A source in continuous contact radiates
      // continuously, so it lays a front down every WAKE_SPACING of travel
      // and the overlapping train IS the wake.
      if (isNow) {
        const [wx, wy] = lastWake.current[i] ?? [b.x, b.y]
        if (Math.hypot(b.x - wx, b.y - wy) >= k.wakeSpacing) {
          lastWake.current[i] = [b.x, b.y]
          // At the orb's CENTRE, not the boundary: a submerged bead disturbs
          // the sheet around itself, and the gradient's nearest-edge point
          // would drag the whole train sideways to the rim as it passes.
          ripples.push({
            x: b.x,
            y: b.y,
            t0: t,
            // Weaker than the impact — a steady plough displaces less than
            // a sudden slap — and scaled by the same momentum the impulse
            // uses, so a big fast orb still writes a heavier line.
            amp: k.wakeAmp * Math.min(Math.hypot(vx, vy) / 0.9, 1.6) * (b.r / 0.18),
            vx,
            vy,
            // A submerged bead displaces the sheet across its whole girth, so
            // the wake's source is the bead itself — broad, like the impact.
            src: b.r,
          })
          if (ripples.length > MAX_RIPPLES) ripples.shift()
        }
      }
    }
    // A ripple pushed from the console (or anywhere without this clock)
    // arrives with t0 < 0 meaning "stamp me": the array's owner knows the
    // time base, the emitter shouldn't have to.
    for (const rp of ripples) if (rp.t0 < 0) rp.t0 = t
    // Retire the dead, oldest first — the array is chronological.
    while (ripples.length && t - ripples[0].t0 > RIPPLE_LIFE) ripples.shift()

    // Glows are NOT stamped here. They arrive the same way — a click handler
    // runs on the DOM's schedule and has no access to this clock — but there
    // is more than one glow array now (the CTA's strike and the card's spill),
    // and a scene component only ever sees the ones it was handed. The
    // compositor stamps every array that reaches it; see the note beside the
    // glow upload in glassSdf.tsx for what wiring it up here cost.
  })
  return null
}

// ---- DOM content --------------------------------------------------------

function SignInForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  return (
    <div
      data-glass-root
      className="flex flex-col gap-5 text-white"
      // The bottom padding is not styling — it is clearance. The CTA is a
      // separate panel floating over this card's lower third, so the form has
      // to stop above where that panel lands or the two would print on top of
      // each other. PILL_Y/PILL_Z are world units; this is the same distance
      // expressed in the DOM's own.
      style={{
        width: CARD_W,
        height: CARD_H,
        padding: '28px 28px 122px',
        // A scrim, and it is doing more work here than it would in a flat UI.
        // Everything behind this card — a neon wall, a black glyph, orbs
        // crossing — arrives through a refracting lens that MOVES, so type
        // laid straight onto it has a background whose luminance changes from
        // frame to frame and from glyph to glyph. Contrast against a moving
        // ground is not a number, it is a range, and the only way to bound it
        // is to put a floor under the type. Kept translucent enough that the
        // glyph and the orbs still read through the card, because losing that
        // would cost the scene its whole point.
        background:
          'linear-gradient(180deg, rgba(6,8,12,0.62) 0%, rgba(6,8,12,0.44) 55%, rgba(6,8,12,0.30) 100%)',
        // Separation for the same reason: where the scrim is thinnest the type
        // still has to hold an edge against a bright refracted orange.
        textShadow: '0 1px 3px rgba(0,0,0,0.55)',
      }}
    >
      <div className="flex flex-col gap-1">
        <span className="text-[22px] font-bold tracking-tight text-white">
          Welcome back
        </span>
        <span className="text-sm font-medium text-white/75">Sign in to continue</span>
      </div>
      <div className="flex flex-col gap-2">
        <Label
          htmlFor="l12-email"
          className="text-[13px] font-semibold uppercase tracking-wider text-white/90"
        >
          Email
        </Label>
        <Input
          id="l12-email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@lab.dev"
          // A DARK fill, not a light one. white/10 over a bright refracted
          // background is barely a field at all — it reads as a slightly
          // paler patch of whatever is behind it, which is exactly what made
          // the inputs vanish when an orb passed under them.
          className="border-white/30 bg-black/45 font-medium text-white placeholder:text-white/45"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label
          htmlFor="l12-password"
          className="text-[13px] font-semibold uppercase tracking-wider text-white/90"
        >
          Password
        </Label>
        <Input
          id="l12-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="border-white/30 bg-black/45 font-medium text-white placeholder:text-white/45"
        />
      </div>
    </div>
  )
}

/**
 * The CTA — its own panel, its own glass, 0.14 world units off the form's
 * face.
 *
 * `onStrike` reports WHERE it was pressed, in panel-local world units. The
 * conversion runs off a live `getBoundingClientRect` and the event's own
 * client coordinates, which works for a reason worth stating: this subtree is
 * re-rendered inside a parked canvas hanging off <body>, so it has a real
 * layout at real coordinates, and the pointer events the library forwards
 * into it are synthesized in that same space. The rect and the event agree
 * because they are both measuring the parked copy. Reading `offsetX` instead
 * would be wrong — that is relative to whatever element is under the pointer,
 * which is the label as often as the button.
 */
function CtaChip({
  onStrike,
  onRelease,
}: {
  onStrike?: (x: number, y: number) => void
  onRelease?: () => void
}) {
  return (
    <div
      data-glass-root
      className="flex h-full w-full items-center justify-center"
      style={{ width: PILL_W, height: PILL_H }}
    >
      <button
        type="button"
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          onStrike?.(e.clientX - r.left, e.clientY - r.top)
        }}
        // Release on leave as well as up. A press that ends outside the button
        // still ends, and without this the panel would stay sunk whenever the
        // pointer slid off before lifting — the classic stuck-button.
        onPointerUp={() => onRelease?.()}
        onPointerLeave={() => onRelease?.()}
        onPointerCancel={() => onRelease?.()}
        className="flex h-full w-full items-center justify-center gap-2 text-[15px] font-semibold tracking-tight text-white"
      >
        Sign in
        <span aria-hidden>→</span>
      </button>
    </div>
  )
}

/**
 * The press: how far down the CTA is, from 0 (resting) to 1 (fully sunk).
 *
 * One motion value drives everything the press does — the panel's depth toward
 * the form, the liquid bulge raised under the finger, and the weight of the
 * strike's spill. Deriving them all from a single spring is what keeps them
 * from disagreeing: three independently animated properties would arrive at
 * slightly different times and the button would look like it was assembled
 * from separate effects rather than pushed.
 *
 * The spring is imperative (`animate` on a plain motion value) rather than
 * `useSpring`, and that is deliberate: the stiffness and damping live in the
 * tweak knobs, which by design never re-render anything. A declarative hook
 * would capture whatever config existed at mount and quietly ignore the
 * sliders; reading them at the moment of the press is what makes them live.
 */
function usePressSpring() {
  const press = useMemo(() => motionValue(0), [])
  const set = useCallback(
    (to: number) => {
      animate(press, to, {
        type: 'spring',
        stiffness: glassTuning.pressStiffness,
        damping: glassTuning.pressDamping,
      })
    },
    [press],
  )
  return { press, set }
}

// The refraction target: one enormous black glyph on a neon field, live DOM.
//
// It replaced a wall of radial gradients and a 44px grid, and the swap was a
// legibility argument rather than a taste one. Refraction is only visible as
// the DISPLACEMENT of something whose true position you already know. A soft
// gradient has no position — bending it produces another soft gradient — so
// the old wall's grid was carrying the entire proof on its own, and a grid
// proves the weakest version of it: straight lines bending. A glyph is the
// strong version. Its curves have known curvature, its counters have known
// shape, and its stems have known width, so the eye catches the lens
// stretching a bowl or pinching a stem instantly, with nothing to compare
// against but its own memory of the letterform.
//
// The glyph is `@`, and the first pass used `&`. The ampersand had the better
// anatomy on paper — two counters, a crossing, real thick-to-thin — and lost
// anyway, for a reason only the assembled scene could show: the form is
// centred, the glyph is centred, so the form lands squarely on the crossing,
// and the crossing is precisely where an ampersand keeps its identity. What
// was left around the edges read as an abstract mass, which forfeits the one
// property the glyph was brought in for. `@` survives the same occlusion
// because its identity is its OUTER RING, and the ring is exactly the part a
// centred panel cannot cover. It also happens to be the sign-in glyph, which
// is a bonus and was not the argument.
function WallArt() {
  return (
    <div
      className="relative overflow-hidden"
      style={{
        width: WALL_W,
        height: WALL_H,
        background: NEON,
        fontFamily: 'var(--display)',
      }}
    >
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          color: '#000',
          // Flex centring centres the LINE BOX, and `@` does not sit centred
          // inside its own: it carries a descender, so the ink lands low and
          // the tail was clipping the bottom of the wall. Padding the box
          // lifts the ink without a transform — which also keeps this clear
          // of the authoring rule about transforms inside a drawn subtree,
          // even though a static one on a descendant would have been legal.
          paddingBottom: 96,
          // Sized so the ring runs nearly the full height of the wall and
          // still clears the frame, leaving neon on all four sides. Measured,
          // not guessed, and RE-measured when the face changed: Bodoni's `@`
          // is a far wider ring on a far taller body than the grotesque's,
          // so the 940px that fit one clipped the other top and bottom. At
          // 620px this face lays a 1700 x 946 line box in the 1700 x 950
          // wall, and the visible slice of that wall at this camera is
          // 1430 x 926.
          fontSize: 620,
          fontWeight: 900,
          // A didone resolves `opsz` from the rendered size unless told
          // otherwise, and at 940px that lands on the display cut — where
          // the thins go to a hairline. Which is correct typography and
          // ruinous here: refraction is only visible as the displacement of
          // ink, and the display cut had almost none to displace. Forcing
          // the TEXT optical size at display SIZE is the deliberate abuse
          // that gets the mass back, and it keeps what the didone was
          // brought in for — the thick-to-thin is itself a ruler, so a lens
          // fattening a hairline or pinching a stem reads instantly.
          fontVariationSettings: "'opsz' 11, 'wght' 900",
          lineHeight: 0.78,
          letterSpacing: '-0.04em',
        }}
      >
        @
      </div>
    </div>
  )
}

// An unlit wall. `material="none"` plus a basic-material quad reading the
// same texture, exactly as the ink quads do — because the moment a
// DOM-sourced colour goes through a lit material it stops being the colour
// the CSS asked for. The neon is a token (`--signal`), and a token that
// arrives on screen multiplied by whatever the scene's lights happen to sum
// to is not a token any more. `toneMapped={false}` for the pipeline's own
// reason: the composite is graded exactly once, at the blit.
function WallInk() {
  const texture = useSurfaceTexture()
  useEffect(() => {
    if (!texture) return
    texture.premultiplyAlpha = true
    texture.needsUpdate = true
  }, [texture])
  if (!texture) return null
  return (
    <mesh>
      <planeGeometry args={[WALL_W / PX, WALL_H / PX]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  )
}

// ---- the framing --------------------------------------------------------

function WebAppFraming() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)

  useLayoutEffect(() => {
    camera.position.set(0, 0, CAM_Z)
    camera.up.set(0, 1, 0)
    camera.lookAt(0, 0, 0)
    // SAFETY: asserted only to reach `isPerspectiveCamera` — three's own
    // brand, which holds across duplicate module copies where instanceof
    // does not — and the next line tests it before any perspective-only
    // field is read. r3f types the store's camera as the base class, so
    // there is nothing narrower to ask first.
    const cam = camera as THREE.PerspectiveCamera
    if (cam.isPerspectiveCamera) {
      cam.fov = CAM_FOV
      cam.updateProjectionMatrix()
    }
  }, [camera])

  // Tone mapping is a scene-level decision here, not a global one, and the
  // default is wrong for this scene specifically. r3f ships ACES, which was
  // built to make rendered light look photographic — and one of the things it
  // does to earn that is rotate saturated oranges toward yellow as they
  // brighten. Run a neon token through it and what lands on screen is not the
  // token. Neutral (Khronos PBR Neutral) exists for exactly this complaint:
  // it leaves in-gamut colour where the author put it and only rolls off the
  // highlights. So the DOM's colours arrive as CSS specified them while the
  // glass's speculars and the strike still shoulder off instead of clipping
  // to white. Restored on unmount — the other five scenes never asked for it.
  useLayoutEffect(() => {
    const prev = gl.toneMapping
    gl.toneMapping = THREE.NeutralToneMapping
    return () => {
      gl.toneMapping = prev
    }
  }, [gl])

  // ── parallax, from real depth rather than per-layer fudge ───────────────
  //
  // The camera moves; nothing else does. Everything in this scene already sits
  // at a different z — wall at -1.5, form at 0, CTA at +0.14 — so translating
  // the eye makes them separate by exactly the amount perspective says they
  // should, with no layer needing to be told how fast to slide. Faking it with
  // per-layer offsets would have meant three numbers to keep consistent with a
  // geometry that already knows the answer.
  //
  // lookAt stays on the origin, which nails the FORM to the middle of the
  // frame and lets the wall swing behind it. That choice is what makes the
  // motion read as looking around the page rather than as the page sliding:
  // the subject holds still and its surroundings give way, which is what
  // happens when you move your head.
  const eased = useRef(new THREE.Vector2())
  useFrame((s, dt) => {
    const k = glassTuning
    const tx = k.parallax > 0 ? s.pointer.x * k.parallax : 0
    const ty = k.parallax > 0 ? s.pointer.y * k.parallax : 0
    // Exponential approach written against dt, so the feel of the easing is
    // the same on a 60Hz panel and a 120Hz one. A raw lerp factor per frame
    // would silently double the speed on the faster display.
    const a = 1 - Math.exp(-dt / Math.max(k.parallaxEase, 1e-3))
    eased.current.x += (tx - eased.current.x) * a
    eased.current.y += (ty - eased.current.y) * a
    s.camera.position.set(eased.current.x, eased.current.y, CAM_Z)
    s.camera.lookAt(0, 0, 0)
  })

  return null
}

// ---- the scene ----------------------------------------------------------

type GlassMode = 'mtm' | 'sdf'

export function Glass() {
  // Per-panel square-buffer overrides (0/absent = viewport-matched). State,
  // not a ref: a change must re-render the panel so useFBO can resize.
  const [resOverride, setResOverride] = useState<Record<string, number>>({})
  const [mode, setMode] = useState<GlassMode>(() =>
    new URLSearchParams(window.location.search).get('glass') === 'mtm' ? 'mtm' : 'sdf',
  )
  // Six, and "sparse" is a consequence of the span rather than the count:
  // each orb is off screen for most of its cycle (see ORB_SPAN), so six in
  // the array is three or four on screen, arriving at uneven intervals.
  const blobs = useMemo<GlassBlob[]>(
    () => Array.from({ length: 6 }, () => ({ x: 0, y: 0, r: 0 })),
    [],
  )
  const ripples = useMemo<GlassRipple[]>(() => [], [])
  // The CTA's strikes. Owned here, mutated by a DOM click handler, read by
  // the compositor — the same stable-array contract as the blobs.
  const glows = useMemo<GlassGlow[]>(() => [], [])
  // The strike's spill, in the CARD's coordinates. A second array rather than
  // a second term on the same glow, because a glow belongs to exactly one
  // panel: the compositor evaluates it in that panel's local frame, and light
  // landing on the form is a different surface's event.
  const cardGlows = useMemo<GlassGlow[]>(() => [], [])
  // The liquid raised under the finger — one blob, unioned into the pill's own
  // field, so the SILHOUETTE swells at the contact point. Drawing a highlight
  // there instead would have been easier and would have read as a decal; this
  // is the same smooth-min the orbs use to fuse with the form, pointed at the
  // press.
  const pillBlobs = useMemo<GlassBlob[]>(() => [], [])
  const pressPt = useRef(new THREE.Vector2())
  const pillGroup = useRef<THREE.Group>(null)
  const { press, set: setPress } = usePressSpring()

  const strike = useCallback(
    (px: number, py: number) => {
      const k = glassTuning
      // DOM px within the chip → panel-local world units. The y axis flips:
      // the DOM counts down from the top, the panel counts up from its centre.
      const x = (px - PILL_W / 2) / PX
      const y = (PILL_H / 2 - py) / PX
      glows.push({ x, y, t0: -1, amp: 1 })
      if (glows.length > MAX_GLOWS) glows.shift()

      // Light that leaves the button has to land on something, and the
      // something is the form's face 0.14 behind it. So the same strike is
      // pushed a second time into the card's array — offset by the pill's own
      // position, which is all it takes to change frames because the two
      // panels are coplanar in x/y — weaker, and WIDER. The width is the part
      // that matters: a spill carrying the button's own tight radius reads as
      // a copy of the button, not as light that travelled a gap. Opening the
      // card's reach at the moment of the strike is also what keeps the knob
      // live, since every glow the card ever gets is born here.
      const card = sdfPanelParams('glass-card')
      if (card) card.glowReach = GLASS_DEFAULTS.glowReach * k.spillReach
      cardGlows.push({ x, y: PILL_Y + y, t0: -1, amp: k.spillAmp })
      if (cardGlows.length > MAX_GLOWS) cardGlows.shift()

      pressPt.current.set(x, y)
      setPress(1)
    },
    [glows, cardGlows, setPress],
  )
  const release = useCallback(() => setPress(0), [setPress])

  // One spring, read three ways. Depth is the whole panel sinking toward the
  // form; the bulge is the local swell under the contact. They cannot disagree
  // because there is only one number.
  useFrame(() => {
    const k = glassTuning
    const p = press.get()
    if (pillGroup.current) pillGroup.current.position.z = -p * k.pressDepth

    const r = p * k.pressBulge
    // A resting blob of zero radius is NOT nothing: smin still pulls the
    // outline toward its centre, so the pill would wear a permanent dent where
    // it was last touched. The array's LENGTH is what carries "no press".
    if (r > 1e-4) {
      if (!pillBlobs.length) pillBlobs.push({ x: 0, y: 0, r: 0 })
      pillBlobs[0].x = pressPt.current.x
      pillBlobs[0].y = pressPt.current.y
      pillBlobs[0].r = r
    } else if (pillBlobs.length) {
      pillBlobs.length = 0
    }
  })

  useEffect(() => {
    window.__glass = {
      mode: () => mode,
      setMode: (next: GlassMode) => {
        setMode(next === 'mtm' ? 'mtm' : 'sdf')
        return `glass mode: ${next}`
      },
      // One verb, two backends: in `sdf` mode the knobs are plain numbers on
      // a per-panel params object the compositor reads each frame; in `mtm`
      // mode they are properties on a MeshTransmissionMaterial. Same call.
      set: (key: string, value: GlassKnobs[string]) => {
        let n = 0
        if (mode === 'sdf') {
          for (const label of sdfPanelLabels()) {
            const p: NumericParams | null = sdfPanelParams(label)
            if (p && pokeKnob(p, key, value)) n++
          }
          return n === 0
            ? `no sdf panel takes ${key}=${value}`
            : `set ${key}=${value} on ${n} sdf panels`
        }
        for (const m of glassMaterials.values()) {
          const knobs: MtmKnobs = m
          if (pokeKnob(knobs, key, value)) n++
        }
        return n === 0
          ? `no material takes ${key}=${value}`
          : `set ${key}=${value} on ${n} materials`
      },
      setFor: (label: string, key: string, value: GlassKnobs[string]) => {
        if (mode === 'sdf') {
          const p: NumericParams | null = sdfPanelParams(label)
          if (!p) return `no sdf panel: ${label}`
          return pokeKnob(p, key, value)
            ? `set ${key}=${value} on ${label}`
            : `${label} does not take ${key}=${value}`
        }
        const m = glassMaterials.get(label)
        if (!m) return `no material: ${label}`
        const knobs: MtmKnobs = m
        return pokeKnob(knobs, key, value)
          ? `set ${key}=${value} on ${label}`
          : `${label} does not take ${key}=${value}`
      },
      // Resized in place — the compositor holds this exact array, and reads
      // its length every frame. 0 turns the merge off entirely (and with it
      // the numeric-gradient branch in the shader), which is the A/B.
      setBlobs: (n: number) => {
        const next = Math.max(0, Math.min(MAX_BLOBS, Math.round(n)))
        while (blobs.length > next) blobs.pop()
        while (blobs.length < next) blobs.push({ x: 0, y: 0, r: 0 })
        return `${blobs.length} blobs`
      },
      blobs: () => blobs.map((b) => ({ ...b })),
      // Fire one by hand, in panel-local units, to tune the wave without
      // waiting for a bead to arrive.
      ripple: (x = 0, y = 0, amp = 1) => {
        ripples.push({ x, y, t0: -1, amp })
        return `ripple at ${x},${y}`
      },
      ripples: () => ripples.map((r) => ({ ...r })),
      // Strike the CTA without aiming at it — same escape hatch as `ripple`,
      // and the same `t0: -1 means stamp me` convention.
      glow: (x = 0, y = 0, amp = 1) => {
        glows.push({ x, y, t0: -1, amp })
        if (glows.length > MAX_GLOWS) glows.shift()
        return `glow at ${x},${y}`
      },
      glows: () => glows.map((g) => ({ ...g })),
      setResolution: (label: string, px?: number) => {
        setResOverride((s) => ({ ...s, [label]: px ?? 0 }))
        return px
          ? `square ${px}px buffer for ${label}`
          : `viewport-matched buffer for ${label}`
      },
      labels: () => (mode === 'sdf' ? sdfPanelLabels() : [...glassMaterials.keys()]),
      params: (label?: string) => {
        const l = label ?? 'glass-card'
        if (mode === 'sdf') return sdfPanelParams(l)
        const m = glassMaterials.get(l)
        if (!m) return null
        return {
          transmission: m.transmission,
          thickness: m.thickness,
          roughness: m.roughness,
          ior: m.ior,
          chromaticAberration: m.chromaticAberration,
          anisotropicBlur: m.anisotropicBlur,
          distortion: m.distortion,
        }
      },
    }
  }, [mode, blobs, ripples, glows])

  return (
    <>
      <WebAppFraming />
      {/* The compositor's passes end in an opaque blit, so the canvas can no
          longer show the page through it — the clear colour IS the backdrop.
          Painting it the wall's own neon means an unusually wide viewport
          shows more field instead of a seam where the wall stops. */}
      <color attach="background" args={[NEON]} />
      {/* No floor, no fog, no props. Every one of them was a cue that the
          subject sits in a ROOM, and this scene's claim is that it sits on a
          PAGE. What's left lights the glass and nothing else. */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 7, 5]} intensity={1.1} />
      <pointLight position={[-3, 2.5, 3]} intensity={8} color="#f2f0ea" distance={14} />

      {/* Layer 0 — the wall, itself live DOM, unlit so the neon lands exact */}
      <SurfaceApp
        label="glass-wall"
        width={WALL_W}
        height={WALL_H}
        material="none"
        position={[0, 0, WALL_Z]}
        content={<WallArt />}
      >
        <planeGeometry args={[WALL_W / PX, WALL_H / PX]} />
        <meshBasicMaterial visible={false} />
        <WallInk />
      </SurfaceApp>

      {/* Layers 1 and 2 — the form, and the CTA surfacing out of its face.
          The CTA's refraction must show the form's glass AND its ink AND the
          wall behind both: that is the multi-level verdict, and it is the one
          thing both backends have to agree on. */}
      {mode === 'sdf' ? (
        <>
          <SdfGlassPanel
            label="glass-card"
            width={CARD_W}
            height={CARD_H}
            px={PX}
            blobs={blobs}
            ripples={ripples}
            glows={cardGlows}
            position={[0, 0, 0]}
            content={<SignInForm />}
          />
          <OrbDrift blobs={blobs} ripples={ripples} />
          {/* The press moves this OUTER group, leaving the panel's own
              position as the layout fact it always was. Nesting is what lets
              the two coexist: the compositor sorts and unprojects off the
              world matrix, so a parent that slides in z is indistinguishable
              from a panel that was authored there. */}
          <group ref={pillGroup}>
            <SdfGlassPanel
              label="glass-pill"
              width={PILL_W}
              height={PILL_H}
              px={PX}
              // A pill is all corner: radius = half its height. Everything
              // else here is where a BUTTON has to disagree with the sheet it
              // sits on — the card's values are GLASS_DEFAULTS, and anything
              // not named below is inherited from them deliberately.
              //
              // It is nearly all bezel (0.3) over almost no thickness (0.035):
              // a thin, strongly-curved lozenge, so it catches light around
              // its whole rim without darkening the form underneath the way
              // the card's long refractive throw would at this size. The
              // shorter throw and lower ior follow from the same constraint —
              // a control has to stay readable at a glance. `smooth` stays at
              // the old 0.14 because the only thing merging into a button is
              // its own press bulge, and that wants a tighter neck than the
              // card's satellite arrivals do.
              params={{
                radius: PILL_H / PX / 2,
                bezel: 0.3,
                thickness: 0.035,
                spread: 0.75,
                ior: 1.78,
                roughness: 0.1,
                tintAmount: 0.05,
                smooth: 0.14,
                // The strike is a local bloom on a small object; the card's
                // 1.9 across a button this size is a blown highlight rather
                // than a place the finger landed.
                glowAmp: 0.45,
              }}
              blobs={pillBlobs}
              glows={glows}
              position={[0, PILL_Y, PILL_Z]}
              content={<CtaChip onStrike={strike} onRelease={release} />}
            />
          </group>
          <GlassSdfCompositor lightDir={[4, 7, 5]} />
        </>
      ) : (
        <>
          <MtmGlassPanel
            label="glass-card"
            width={CARD_W}
            height={CARD_H}
            resolution={resOverride['glass-card'] || undefined}
            position={[0, 0, 0]}
            content={<SignInForm />}
          />
          {/* The mesh path gets the same layout so the two backends stay
              pixel-comparable, but not the strike: a glow is a term in the
              SDF compositor's own shader and MeshTransmissionMaterial has
              nowhere to put it. `onStrike` is simply absent here, which is
              why CtaChip takes it optionally. */}
          <MtmGlassPanel
            label="glass-pill"
            width={PILL_W}
            height={PILL_H}
            radius={PILL_H / PX / 2}
            depth={0.1}
            resolution={resOverride['glass-pill'] || undefined}
            position={[0, PILL_Y, PILL_Z]}
            content={<CtaChip />}
          />
          <GlassBufferCoordinator />
        </>
      )}
    </>
  )
}
