// Lamp — an article page lit by one movable lantern, whose headline glyphs
// stand off the paper and cast the only shadows in the scene.
//
// The law: WebGL owns light and shadow, nothing else. The headline and its
// body prose stay plain, selectable DOM; the multiply canvas above them
// only darkens the pixels already there. The lantern itself needs normal
// (non-multiply) blending to read as a lit object rather than a silhouette,
// so it lives in a second, separate canvas layered above the multiply one.
//
// Ownership: this component owns the DOM article, the lamp's anchor point,
// both canvases' renderers, and the shared draw loop. lampShaders.ts owns
// the 2D light/shadow math; lampMask.ts owns reading the headline into ink;
// lampLantern.ts owns the 3D lantern model and its flicker.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { buildHeadlineMask, type HeadlineMask } from './lampMask'
import { createLampLightMaterial, setLampLightFrame, setLampMaskFrame, setLampTuningUniforms } from './lampShaders'
import { createLampLantern, LANTERN_TOTAL_HEIGHT, type LampLantern } from './lampLantern'
import { lampTuning, type LampTuning } from './lampTuning'
import { LampTweaks } from './lampTweaks'
import './lamp.css'

const PIXEL_RATIO_CAP = 2
export const DRIFT_RADIUS_X = 34
export const DRIFT_RADIUS_Y = 20
export const DRIFT_PERIOD_MS = 22000
// Camera-to-page-plane distance for the lantern's perspective camera, CSS
// px. A camera bore-sighted straight down the lantern's own height axis
// (which any position on this z=0-mapped plane necessarily is) shows no
// side profile near viewport center regardless of distance — tried at 1100
// and 750, both read as a blob or a leaning dumbbell rather than a lantern
// (2026-08-31/09-01 captures). The fixed 3/4 tilt on the model itself (see
// LANTERN_TILT_DEG in lampLantern.ts) is what makes the form legible now;
// this distance only needs to keep the *residual* positional parallax
// subtle — at 1400 an anchor near a viewport edge leans at most ~25deg off
// the center-anchor pose, reading as "photographed from slightly off-axis"
// rather than distorting the model.
const LANTERN_CAMERA_DISTANCE = 1400
// Extra clearance beyond the lantern's own measured on-screen reach (see
// measureLanternMargins) — keeps the drag handle's hover/active affordance
// clear of the edge too, not just the model's own silhouette.
const MARGIN_BUFFER = 24
// Used only for the very first paint, before the lantern canvas has run its
// first resize and measured a real margin from the model's own projected
// geometry (see measureLanternMargins) — generous enough that a placement
// against these doesn't clip while that measurement is pending.
const FALLBACK_FIXTURE_MARGIN_TOP = LANTERN_TOTAL_HEIGHT + 40
const FALLBACK_FIXTURE_MARGIN = 90

interface Point {
  x: number
  y: number
}

interface LampState {
  renderer: THREE.WebGLRenderer | null
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  width: number
  height: number
  maskTexture: THREE.CanvasTexture | null
  /** lampPos: the flame's own projected screen position (drives light falloff and shadow direction). basePos: the drag anchor (drives the contact shadow only). flicker: the light pool's brightness multiplier for this frame. tuning: this frame's live tuning values. */
  draw: (lampPos: Point, basePos: Point, flicker: number, tuning: LampTuning) => void
  start: () => void
  stop: () => void
}

function createLampState(): LampState {
  const scene = new THREE.Scene()
  // The quad spans the whole clip volume; this camera never moves.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), createLampLightMaterial())
  mesh.frustumCulled = false
  scene.add(mesh)
  return {
    renderer: null,
    scene,
    camera,
    mesh,
    width: 0,
    height: 0,
    maskTexture: null,
    draw: () => {},
    start: () => {},
    stop: () => {},
  }
}

interface LanternState {
  renderer: THREE.WebGLRenderer | null
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  lantern: LampLantern
  width: number
  height: number
  /** Renders the frame and returns the flame's own projected screen position, for the shadow shader's uLampPos. */
  draw: (lamp: Point, tuning: LampTuning) => Point
}

function createLanternState(): LanternState {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 4000)
  const lantern = createLampLantern()
  scene.add(lantern.group)
  // The PMREMGenerator/RoomEnvironment map (set on scene.environment once
  // the renderer exists, see the mount effect below) is what now gives the
  // blackened-steel MeshPhysicalMaterials their directional highlights and
  // makes them read as metal rather than flat color — this hemisphere is
  // only a very dim, cool fill so the underside of the model (which the
  // room env's own lights don't reach at every drag angle) never goes to
  // pure black (round 5: replaces the previous warm hemisphere+directional
  // pair, whose job the IBL now does).
  scene.add(new THREE.HemisphereLight(0x9fb4c9, 0x0c0c0d, 0.25))
  return {
    renderer: null,
    scene,
    camera,
    lantern,
    width: 0,
    height: 0,
    draw: () => ({ x: 0, y: 0 }),
  }
}

// A PerspectiveCamera sitting at (w/2, h/2, D) looking straight down -Z at
// the page plane, with fov = 2*atan(h/(2D)), maps that z=0 plane 1:1 onto
// CSS pixels — so the lantern's base (which rests at z=0) always renders
// exactly at its anchor point regardless of camera distance, while
// everything above the base leans with real perspective as the anchor
// nears a viewport edge.
function fitLanternCamera(camera: THREE.PerspectiveCamera, width: number, height: number) {
  camera.aspect = width / height
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(height / (2 * LANTERN_CAMERA_DISTANCE)))
  camera.position.set(width / 2, height / 2, LANTERN_CAMERA_DISTANCE)
  camera.up.set(0, 1, 0)
  camera.lookAt(width / 2, height / 2, 0)
  camera.updateProjectionMatrix()
}

interface LanternMargins {
  readonly top: number
  readonly side: number
}

// Derives the drag-clamp margins from an actual projection of the model's
// tallest point rather than a guessed pixel budget, so a future change to
// LANTERN_TILT_DEG or LANTERN_CAMERA_DISTANCE can't silently reopen the
// clipping this was built to prevent (2026-09-01). Parks the group at world
// (0, height, 0) — CSS (0, 0), the viewport's own top-left corner and the
// worst case for both axes at once — projects the handle-top marker, and
// reads off how far it lands beyond that corner in each direction. Mutates
// and leaves lantern.group.position; every caller re-sets it before the
// next render, so this never reaches the screen.
function measureLanternMargins(
  lantern: LampLantern,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): LanternMargins {
  lantern.group.position.set(0, height, 0)
  const top = lantern.getTopWorldPosition(new THREE.Vector3())
  top.project(camera)
  const topCssX = (top.x * 0.5 + 0.5) * width
  const topCssY = (1 - (top.y * 0.5 + 0.5)) * height
  return {
    top: Math.max(0, -topCssY) + MARGIN_BUFFER,
    side: Math.max(0, -topCssX) + MARGIN_BUFFER,
  }
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) return
    const change = () => setReduced(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  return reduced
}

export function ellipseOffset(elapsedMs: number): Point {
  const angle = (elapsedMs / DRIFT_PERIOD_MS) * Math.PI * 2
  // Phase 0 is the release point itself: the orbit is centered at
  // (0, DRIFT_RADIUS_Y), so its bottom touches the drag anchor. The
  // pointer-up handler re-seeds the drift clock to now(), making the
  // first post-release frame evaluate at elapsed ≈ 0; this parameterization
  // returns (0, 0) there, so the lamp stays where the user let go and
  // drifts from it instead of jumping to the ellipse's rightmost point.
  return { x: Math.sin(angle) * DRIFT_RADIUS_X, y: (1 - Math.cos(angle)) * DRIFT_RADIUS_Y }
}

function clampToViewport(point: Point, margins: LanternMargins): Point {
  const maxX = Math.max(margins.side, window.innerWidth - margins.side)
  const maxY = Math.max(margins.top, window.innerHeight - margins.side)
  return {
    x: Math.min(Math.max(point.x, margins.side), maxX),
    y: Math.min(Math.max(point.y, margins.top), maxY),
  }
}

export function LampApp() {
  const host = useRef<HTMLDivElement>(null)
  const lanternHost = useRef<HTMLDivElement>(null)
  const fixture = useRef<HTMLDivElement>(null)
  const headline = useRef<HTMLHeadingElement>(null)
  const lineOne = useRef<HTMLSpanElement>(null)
  const lineTwo = useRef<HTMLSpanElement>(null)
  const state = useMemo(createLampState, [])
  const state2 = useMemo(createLanternState, [])
  const [degraded, setDegraded] = useState(false)
  const [lanternDegraded, setLanternDegraded] = useState(false)
  const reducedMotion = useReducedMotion()
  const reducedMotionRef = useRef(reducedMotion)
  reducedMotionRef.current = reducedMotion

  // Read inside the rAF loop via the ref, not the state value directly —
  // wiring `tuning` itself into redraw's own deps would recreate it (and
  // tear down/remount both canvases, see the mount effects below) on every
  // slider move instead of just changing what the next frame draws.
  const [tuning, setTuning] = useState<LampTuning>(lampTuning)
  const tuningRef = useRef(tuning)
  tuningRef.current = tuning

  // The lamp's own position lives in refs: it moves on every idle-drift
  // frame and every pointermove of a drag, and neither needs a React
  // render to reach the shaders or the fixture's own transform.
  const anchor = useRef<Point>({ x: 160, y: 160 })
  const placed = useRef(false)
  const dragging = useRef(false)
  const driftEpoch = useRef(performance.now())
  // Replaced by a real projection on the lantern canvas's first resize (see
  // measureLanternMargins) — these values only matter for the brief window
  // before that first measurement lands.
  const margins = useRef<LanternMargins>({
    top: FALLBACK_FIXTURE_MARGIN_TOP,
    side: FALLBACK_FIXTURE_MARGIN,
  })

  // Stable identities: every one of these reads only refs and the memoized
  // state objects, so they never need to change across renders, and an
  // effect that lists one as a dependency still runs only when it means to.
  const currentLamp = useCallback((): Point => {
    if (dragging.current || reducedMotionRef.current) return anchor.current
    const offset = ellipseOffset(performance.now() - driftEpoch.current)
    return { x: anchor.current.x + offset.x, y: anchor.current.y + offset.y }
  }, [])

  const paintFixture = useCallback((lamp: Point) => {
    const element = fixture.current
    if (element) element.style.transform = `translate(${lamp.x}px, ${lamp.y}px)`
  }, [])

  // Drives both canvases from the one loop. The 3D canvas renders first and
  // reports back where its flame actually landed on screen — offset from
  // the anchor once the model's tilt and camera parallax are in play — so
  // the 2D shadow shader's light position and the visible flame can't drift
  // apart the way they would if the shader assumed the flame sat exactly
  // at the anchor.
  const redraw = useCallback(() => {
    const lamp = currentLamp()
    const tuning = tuningRef.current
    const flamePos = state2.draw(lamp, tuning)
    // state2.draw() just ran the lantern's update(), which set this frame's
    // flicker value — read it back rather than recomputing the signal, so
    // the page's light pool and the flame's own brightness always agree.
    const flicker = 1 + (state2.lantern.getFlickerIntensity() - 1) * tuning.pageFlicker
    state.draw(flamePos, lamp, flicker, tuning)
    paintFixture(lamp)
  }, [state, state2, currentLamp, paintFixture])

  // Mount: the multiply shadow canvas, built with the same discipline as
  // the marble-hand background field — the canvas is created outside
  // React, and a lost context degrades to plain paper rather than an
  // unlit black overlay.
  useLayoutEffect(() => {
    const box = host.current
    if (!box) return
    const canvas = document.createElement('canvas')
    canvas.className = 'lamp-canvas'
    box.append(canvas)
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false })
    } catch {
      canvas.remove()
      setDegraded(true)
      return
    }
    // The shader writes calibrated multiplier values and includes no
    // colorspace_fragment chunk, so they reach the canvas unencoded; setting
    // outputColorSpace to NoColorSpace throws in three r180.
    state.renderer = renderer
    // A fresh canvas measures 300x150 until the first resize; skip past it.
    state.width = 0
    state.height = 0
    renderer.setClearColor(0x000000, 1)

    let raf = 0
    state.draw = (lampPos, basePos, flicker, tuning) => {
      setLampLightFrame(
        state.mesh.material,
        state.width,
        state.height,
        lampPos.x,
        lampPos.y,
        basePos.x,
        basePos.y,
        flicker,
      )
      setLampTuningUniforms(state.mesh.material, tuning)
      renderer.render(state.scene, state.camera)
    }
    const frame = () => {
      raf = requestAnimationFrame(frame)
      redraw()
    }
    state.start = () => {
      if (raf) return
      frame()
    }
    state.stop = () => {
      cancelAnimationFrame(raf)
      raf = 0
    }

    const resize = () => {
      const rect = box.getBoundingClientRect()
      const width = Math.max(1, Math.round(rect.width))
      const height = Math.max(1, Math.round(rect.height))
      if (width === state.width && height === state.height) return
      state.width = width
      state.height = height
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO_CAP))
      renderer.setSize(width, height, false)
      redraw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(box)
    resize()

    // A lost context leaves the page intact: the loop stops and CSS hides
    // the canvas until the browser restores it.
    const lost = (event: Event) => {
      event.preventDefault()
      setDegraded(true)
      state.stop()
    }
    const restored = () => {
      setDegraded(false)
      state.width = 0
      resize()
    }
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', restored)

    return () => {
      state.stop()
      observer.disconnect()
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', restored)
      state.draw = () => {}
      state.start = () => {}
      state.stop = () => {}
      state.mesh.material.dispose()
      state.maskTexture?.dispose()
      state.renderer = null
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    }
  }, [state, redraw])

  // Mount: the lantern's own normal-blend canvas, same lifecycle
  // discipline as the multiply one above. A lost or unavailable context
  // here only drops the 3D model — the shadow canvas and the drag handle
  // keep working, so the fixture falls back to a small CSS marker instead
  // of going fully invisible.
  useLayoutEffect(() => {
    const box = lanternHost.current
    if (!box) return
    const canvas = document.createElement('canvas')
    canvas.className = 'lamp-lantern-canvas'
    box.append(canvas)
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, depth: true })
    } catch {
      canvas.remove()
      setLanternDegraded(true)
      return
    }
    state2.renderer = renderer
    state2.width = 0
    state2.height = 0
    renderer.setClearColor(0x000000, 0)
    // ACES + sRGB output is what makes the flame's high-intensity emissive
    // core roll off toward white instead of clipping to flat orange, and
    // is the conventional pairing with a PMREM-generated environment map
    // (round 5: "actual PBR level graphics").
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.outputColorSpace = THREE.SRGBColorSpace

    // RoomEnvironment is a small synthetic room (no external asset) baked
    // once into a PMREM map and left on scene.environment for the model's
    // lifetime — this, not any direct light, is what gives the blackened
    // steel a specular highlight and lets it read as metal rather than
    // flat color (round 5). Generated after the renderer exists (PMREM
    // needs a live GL context) and disposed once baked; only the resulting
    // texture needs to live on past this effect's setup.
    const pmremGenerator = new THREE.PMREMGenerator(renderer)
    const environmentTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture
    state2.scene.environment = environmentTexture
    pmremGenerator.dispose()

    // Reused across frames rather than allocated per call.
    const flameWorld = new THREE.Vector3()
    const draw = (lamp: Point, tuning: LampTuning): Point => {
      state2.lantern.group.position.set(lamp.x, state2.height - lamp.y, 0)
      state2.lantern.group.scale.setScalar(tuning.modelScale)
      state2.lantern.update(performance.now(), reducedMotionRef.current, {
        flameScale: tuning.flameScale,
        flickerRate: tuning.flickerRate,
        flickerAmplitude: tuning.flickerAmplitude,
        coreBrightness: tuning.coreBrightness,
        lampHeight: tuning.lampHeight,
      })
      state2.lantern.getFlameWorldPosition(flameWorld)
      flameWorld.project(state2.camera)
      const flameScreen: Point = {
        x: (flameWorld.x * 0.5 + 0.5) * state2.width,
        y: (1 - (flameWorld.y * 0.5 + 0.5)) * state2.height,
      }
      renderer.render(state2.scene, state2.camera)
      return flameScreen
    }
    state2.draw = draw

    const resize = () => {
      const rect = box.getBoundingClientRect()
      const width = Math.max(1, Math.round(rect.width))
      const height = Math.max(1, Math.round(rect.height))
      if (width === state2.width && height === state2.height) return
      state2.width = width
      state2.height = height
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO_CAP))
      renderer.setSize(width, height, false)
      fitLanternCamera(state2.camera, width, height)
      margins.current = measureLanternMargins(state2.lantern, state2.camera, width, height)
      redraw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(box)
    resize()

    const lost = (event: Event) => {
      event.preventDefault()
      setLanternDegraded(true)
      state2.draw = () => ({ x: 0, y: 0 })
    }
    const restored = () => {
      setLanternDegraded(false)
      state2.draw = draw
      state2.width = 0
      resize()
    }
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', restored)

    return () => {
      observer.disconnect()
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', restored)
      state2.draw = () => ({ x: 0, y: 0 })
      state2.renderer = null
      state2.scene.environment = null
      environmentTexture.dispose()
      state2.lantern.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    }
  }, [state2, redraw])

  // Read the headline into ink after fonts settle, and again whenever its
  // layout changes. The lab loads Bodoni Moda with display=block, so an
  // early build only redraws the ambient pool — the mask arrives a beat
  // later at document.fonts.ready and every draw after that is exact.
  useEffect(() => {
    let alive = true
    const build = () => {
      if (!alive) return
      const one = lineOne.current
      const two = lineTwo.current
      let mask: HeadlineMask | null = null
      if (one && two) mask = buildHeadlineMask([one, two])

      state.maskTexture?.dispose()
      state.maskTexture = null
      if (mask) {
        const texture = new THREE.CanvasTexture(mask.canvas)
        texture.colorSpace = THREE.NoColorSpace
        texture.minFilter = THREE.LinearFilter
        texture.magFilter = THREE.LinearFilter
        texture.wrapS = THREE.ClampToEdgeWrapping
        texture.wrapT = THREE.ClampToEdgeWrapping
        texture.needsUpdate = true
        state.maskTexture = texture
        setLampMaskFrame(state.mesh.material, texture, mask.rect)
        if (!placed.current) {
          placed.current = true
          anchor.current = clampToViewport({ x: mask.rect.x - 44, y: mask.rect.y - 40 }, margins.current)
          driftEpoch.current = performance.now()
        }
      } else {
        setLampMaskFrame(state.mesh.material, null, null)
      }
      redraw()
    }

    build()
    void document.fonts.ready.then(build)

    const observer = new ResizeObserver(build)
    if (headline.current) observer.observe(headline.current)
    window.addEventListener('resize', build)
    return () => {
      alive = false
      observer.disconnect()
      window.removeEventListener('resize', build)
    }
  }, [state, redraw])

  // The idle drift loop runs continuously while motion is allowed — it is
  // the scene's whole point of being alive at rest — and stops dead under
  // prefers-reduced-motion, holding the lamp at its last dragged position.
  useEffect(() => {
    if (degraded) return
    if (reducedMotion) {
      state.stop()
      redraw()
      return
    }
    state.start()
    return () => state.stop()
  }, [state, reducedMotion, degraded, redraw])

  // Dragging: a pointer-captured element, updated on every move. Releasing
  // it re-seeds the drift clock so the ellipse resumes from where the drag
  // let go, instead of jumping back to wherever its phase would otherwise be.
  useEffect(() => {
    const element = fixture.current
    if (!element) return
    const move = (event: PointerEvent) => {
      if (!dragging.current) return
      anchor.current = clampToViewport({ x: event.clientX, y: event.clientY }, margins.current)
      if (reducedMotionRef.current) redraw()
    }
    const down = (event: PointerEvent) => {
      dragging.current = true
      element.setPointerCapture(event.pointerId)
      element.classList.add('is-dragging')
      // Without this a fast drag selects the headline and body text under
      // the pointer, which fights the drag instead of moving the lantern.
      document.body.style.userSelect = 'none'
      move(event)
    }
    const up = (event: PointerEvent) => {
      dragging.current = false
      element.releasePointerCapture(event.pointerId)
      element.classList.remove('is-dragging')
      document.body.style.userSelect = ''
      driftEpoch.current = performance.now()
    }
    element.addEventListener('pointerdown', down)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', up)
    return () => {
      element.removeEventListener('pointerdown', down)
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', up)
      document.body.style.userSelect = ''
    }
  }, [redraw])

  return (
    <main
      className="lamp-page"
      data-degraded={degraded || undefined}
      data-lantern-degraded={lanternDegraded || undefined}
    >
      <div ref={host} className="lamp-overlay-host" aria-hidden="true" />
      <div ref={lanternHost} className="lamp-lantern-host" aria-hidden="true" />
      <div ref={fixture} className="lamp-fixture" aria-hidden="true">
        <span className="lamp-fixture__fallback" />
      </div>

      <LampTweaks tuning={tuning} onTuningChange={setTuning} onReset={() => setTuning(lampTuning)} />

      <article className="lamp-article">
        <h1 ref={headline} className="lamp-headline">
          <span ref={lineOne}>Light reads</span>
          <br />
          <span ref={lineTwo}>the page.</span>
        </h1>
        <div className="lamp-columns">
          <p className="lamp-column">
            A screen has always been a light source pretending to be paper. This page
            drops the pretense: the words underneath are ordinary text, selectable and
            searchable like any other, and everything that looks like lighting is a
            second, separate layer that only ever darkens what is already there.
          </p>
          <p className="lamp-column">
            Move the lamp and the headline's own letters throw the shadow — not a
            drawn effect standing in for one, but a real occlusion computed from where
            the light sits, how high it hangs, and how far each glyph stands off the
            page beneath it.
          </p>
        </div>
      </article>

      <p className="lamp-hint">Drag the lamp.</p>
    </main>
  )
}
