// The marble-hand scene — a classical marble hand made into a live pointer.
//
// The law: THE FINGERTIP OWNS THE CLICK. The hand's local origin is the
// tip, and that origin is written directly from the trusted screen pointer
// every frame. Depth and tilt may lag; the hotspot may not.
//
// The fault this scene presses on, 2026-08-30: custom cursor followers are
// often eased as one object. At ordinary hand speed their visible hotspot
// trails the native event by tens of pixels, so the browser activates a
// control that the drawn cursor never touched. This scene damps only pose.
//
// Ownership: the catalogue stays native HTML. The transparent overlay owns
// only the sculpture and its shadow; no page pixels change renderer. The
// 2026-08-30 first version captured the whole page and lit that texture,
// which changed its colour and replaced native input with a relay. Like
// Knobs, the page now supplies the light model without surrendering pixels.

import {
  Suspense,
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SurfaceCanvas } from '@petepetrash/munari'
import { cameraDistance } from '@petepetrash/munari/advanced'
import { showChrome } from '../../bareMode'
import { useMarbleHandGeometry } from './marbleHandGeometry'
import { MarbleHandMaterial, useMarbleHandDepthMaterial } from './marbleHandMaterial'
import { MarbleHandEnvironment } from './marbleHandEnvironment'
import { MarbleHandStroke } from './marbleHandStroke'
import { MarbleHandBackground } from './marbleHandBackground'
import { MARBLE_HAND_THEMES, type MarbleHandThemeId } from './marbleHandThemes'
import { MarbleHandPageCapture, createMarblePageCaptureState, type MarblePageCaptureState } from './marbleHandPageCapture'
import { buildMarbleHandSupport, marbleHandSafeHeight } from './marbleHandPose'
import {
  MARBLE_HAND_TAP_PHASE,
  marbleHandTapEnvelope,
  stepMarbleHandSpring,
  type MarbleHandSpring,
} from './marbleHandTapLaw'
import { createMarbleHandTapUniforms, type MarbleHandTapUniforms } from './marbleHandTapShaders'
import { MarbleHandTweaks } from './marbleHandTweaks'
import { marbleHandTuning, type MarbleHandTuning } from './marbleHandTuning'
import './marbleHand.css'

const FOV = 42
const IGNORE_RAYCAST: THREE.Object3D['raycast'] = () => {}
const PIXEL_CAMERA = { fov: FOV, position: new THREE.Vector3(0, 0, 1000) }

// The receiver carries only shadow alpha. A partial density leaves the
// actual paper colour visible beneath it, rather than painting a black cutout.
const PAGE_SHADOW_OPACITY = 0.28

// The tap arrives over 300ms so the first lift grows out of stillness, and
// leaves over 120ms so the hand is already flat by the time a 40px move has
// carried the fingertip anywhere a reader is looking.
const TAP_FADE_IN_MS = 300
const TAP_FADE_OUT_MS = 120

interface PointerDrive {
  x: number
  y: number
  pressed: boolean
  /** True from a press that landed on text until that press releases —
   *  the window in which a selection drag makes the hand pinch. */
  pinching: boolean
  /** performance.now() of the last trusted pointer event. Drives the idle tap. */
  movedAt: number
}

/** Whether a press at client (x, y) lands on visible text — the gesture
 *  that starts a selection, and so the one that starts the pinch. */
function pressOnText(x: number, y: number): boolean {
  const caret = document.caretPositionFromPoint?.(x, y)
  const node = caret?.offsetNode
  return node?.nodeType === Node.TEXT_NODE && /\S/.test(node.textContent ?? '')
}

function subscribeReducedMotion(change: () => void) {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)')
  query.addEventListener('change', change)
  return () => query.removeEventListener('change', change)
}

function readReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false)
}

// ── page retained by the DOM ──────────────────────────────────────────

function CataloguePage({
  page,
  width,
  height,
  selected,
  pointer,
  colorMotion,
  reducedMotion,
  tuning,
  onSelect,
}: {
  page: React.RefObject<HTMLElement | null>
  width: number
  height: number
  selected: MarbleHandThemeId
  pointer: boolean
  colorMotion: boolean
  reducedMotion: boolean
  tuning: MarbleHandTuning
  onSelect: (id: MarbleHandThemeId) => void
}) {
  return (
    <main ref={page} className="mh-sheet" data-theme={selected} data-motion={colorMotion ? 'running' : 'paused'} data-marble-hand-pointer={pointer || undefined} style={{ width, height }}>
      <div className="mh-atmosphere" aria-hidden="true">
        {/* No key: remounting would drop the WebGL context on every theme. */}
        <MarbleHandBackground theme={selected} motion={colorMotion} reducedMotion={reducedMotion} tuning={tuning} />
      </div>
      <section className="mh-themes" aria-label="Background themes">
        {MARBLE_HAND_THEMES.map((theme) => (
          <button
            key={theme.id}
            type="button"
            className="mh-theme-button"
            data-theme-option={theme.id}
            data-selected={selected === theme.id || undefined}
            aria-pressed={selected === theme.id}
            onClick={() => onSelect(theme.id)}
          >
            <span className="mh-theme-preview" data-preview={theme.id} style={{ backgroundColor: theme.color }} aria-hidden="true" />
            <span className="mh-theme-copy">
              <strong>{theme.name}</strong>
              <small>{theme.note}</small>
            </span>
            <span className="mh-theme-state" aria-hidden="true">{selected === theme.id ? '●' : '↗'}</span>
          </button>
        ))}
      </section>

      <section className="mh-intro">
        <h1>Point<br />of view.</h1>
      </section>

    </main>
  )
}

// ── pixel camera and sculptural pointer ───────────────────────────────

function PixelPerfect() {
  // SAFETY: SurfaceCanvas creates a perspective camera unless it is passed
  // `orthographic`; this canvas is not. The cast exposes the fov contract
  // that makes one world unit one CSS pixel at the page plane.
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera
  const size = useThree((state) => state.size)
  useLayoutEffect(() => {
    camera.fov = FOV
    camera.position.set(0, 0, cameraDistance(size.height, FOV))
    camera.near = 1
    camera.far = camera.position.z * 3
    camera.updateProjectionMatrix()
  }, [camera, size.width, size.height])
  return null
}

interface MarbleHandTapState {
  clockMs: number
  gain: number
  springs: MarbleHandSpring[]
}

// uTapBend order (marbleHandTapLaw MARBLE_HAND_HINGES): drum fingers
// first, then index, then thumb.
const PINCH_INDEX_FINGER = MARBLE_HAND_TAP_PHASE.length

/**
 * Advances the drum and pinch targets and writes all five bend angles.
 * The drum clock only runs while the tap is audible, so a fresh idle
 * always starts on the first finger's rest rather than wherever a
 * free-running clock happened to be. Every joint reaches its target
 * through a slightly underdamped spring: the overshoot-and-settle is
 * what separates flesh arriving from a servo stopping.
 */
/** Which gestures may animate this frame, from one place, so the drum and
 *  the pinch cannot disagree about what "at rest" means. */
function marbleHandGestures(
  tuning: MarbleHandTuning,
  motion: boolean,
  pressed: boolean,
  pointer: PointerDrive,
  idleFor: number,
) {
  return {
    drumming: tuning.tapEnabled && motion && !pressed && idleFor >= tuning.tapIdleDelayMs,
    pinching: tuning.pinchEnabled && motion && pointer.pinching,
  }
}

function driveMarbleHandTap(
  state: MarbleHandTapState,
  tap: MarbleHandTapUniforms,
  tuning: MarbleHandTuning,
  stepMs: number,
  drumming: boolean,
  pinching: boolean,
) {
  state.gain = drumming
    ? Math.min(1, state.gain + stepMs / TAP_FADE_IN_MS)
    : Math.max(0, state.gain - stepMs / TAP_FADE_OUT_MS)
  state.clockMs = state.gain > 0 ? state.clockMs + stepMs : 0
  const cycle = state.clockMs / tuning.tapPeriodMs
  const bend = tap.uTapBend.value
  for (let finger = 0; finger < bend.length; finger++) {
    let target = 0
    if (finger < MARBLE_HAND_TAP_PHASE.length) {
      target = tuning.tapLiftRad * state.gain
        * marbleHandTapEnvelope(cycle + MARBLE_HAND_TAP_PHASE[finger])
    } else if (pinching) {
      target = finger === PINCH_INDEX_FINGER ? tuning.pinchIndexRad : tuning.pinchThumbRad
    }
    stepMarbleHandSpring(state.springs[finger], target, stepMs)
    bend[finger] = state.springs[finger].bend
  }
}

function MarblePointer({
  drive,
  reducedMotion,
  tuning,
  parked,
  previewPressed,
  origin,
  tap,
  onMount,
}: {
  drive: React.RefObject<PointerDrive>
  reducedMotion: boolean
  tuning: MarbleHandTuning
  parked: boolean
  previewPressed: boolean
  origin: THREE.Vector3
  tap: MarbleHandTapUniforms
  onMount: (mesh: THREE.Mesh | null) => void
}) {
  const geometry = useMarbleHandGeometry()
  const depthMaterial = useMarbleHandDepthMaterial(tap)
  const support = useMemo(() => buildMarbleHandSupport(geometry), [geometry])
  const supportTransform = useMemo(() => new THREE.Matrix4(), [])
  const sculptureTransform = useMemo(() => new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(tuning.sculptureRoll, tuning.sculpturePitch, 0, 'YXZ'),
  ), [tuning.sculptureRoll, tuning.sculpturePitch])
  const group = useRef<THREE.Group>(null)
  const size = useThree((state) => state.size)
  // SAFETY: PixelPerfect narrows and configures this same authored
  // perspective camera. The z position is the scale term that compensates
  // the raised fingertip back onto its page-plane pointer coordinate.
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera
  const pose = useRef<{ rx: number; ry: number; rz: number; z: number; x: number; y: number }>({
    rx: 0,
    ry: 0,
    rz: 0,
    z: tuning.heightPx,
    x: drive.current.x,
    y: drive.current.y,
  })
  // The drum keeps its own clock rather than reading the frame clock, so a
  // tap always begins on the first finger's rest rather than mid-roll.
  const tapState = useRef<MarbleHandTapState>({
    clockMs: 0,
    gain: 0,
    springs: tap.uTapBend.value.map(() => ({ bend: 0, velocity: 0 })),
  })

  useFrame((_, delta) => {
    const node = group.current
    if (!node) return
    const pointer = drive.current
    const state = pose.current
    const mobilePreview = size.width <= 700
    const previewX = mobilePreview ? size.width * 0.4 : Math.min(size.width * 0.48, size.width - 520)
    const x = parked ? previewX : pointer.x
    // Short in-app panes leave only the upper 40% above the mobile panel.
    // Keep the parked fragment's wrist in that space, not behind the controls.
    const previewY = mobilePreview
      ? Math.max(20, Math.min(size.height * 0.2, size.height * 0.4 - 140))
      : size.height * 0.4
    const y = parked ? previewY : pointer.y
    const pressed = previewPressed || (!parked && pointer.pressed)
    const dx = x - state.x
    const dy = y - state.y
    state.x = x
    state.y = y
    const motion = tuning.motionEnabled && !reducedMotion && !parked

    const targetRx = motion
      ? THREE.MathUtils.clamp(dy * tuning.velocityTilt, -tuning.maxTilt, tuning.maxTilt)
      : 0
    const targetRy = motion
      ? THREE.MathUtils.clamp(-dx * tuning.velocityTilt, -tuning.maxTilt, tuning.maxTilt)
      : 0
    const targetRz = motion
      ? THREE.MathUtils.clamp((dx - dy) * tuning.velocityTilt * 0.35, -tuning.maxSpin, tuning.maxSpin)
      : 0
    state.rx = THREE.MathUtils.damp(
      state.rx,
      targetRx + (pressed ? tuning.pressPitch : 0),
      tuning.poseDamping,
      delta,
    )
    state.ry = THREE.MathUtils.damp(state.ry, targetRy, tuning.poseDamping, delta)
    state.rz = THREE.MathUtils.damp(state.rz, targetRz, tuning.poseDamping, delta)
    state.z = THREE.MathUtils.damp(
      state.z,
      pressed ? tuning.pressHeightPx : tuning.heightPx,
      tuning.poseDamping,
      delta,
    )
    node.rotation.set(state.rx, state.ry, tuning.baseRotation + state.rz)
    supportTransform.makeRotationFromEuler(node.rotation).scale(node.scale).multiply(sculptureTransform)
    const height = tuning.keepAbovePage
      ? marbleHandSafeHeight(support, supportTransform, state.z)
      : state.z

    // Position is not damped. The geometry origin is the fingertip, so this
    // write is also the visible hotspot invariant.
    // PixelPerfect maps CSS pixels on z=0. The fingertip floats at state.z,
    // where perspective would push it away from the viewport centre. Pull
    // the world offset inward by the matching camera ratio so the projected
    // tip stays on the trusted pointer rather than merely near it.
    const pageToDepth = (camera.position.z - height) / camera.position.z
    node.position.set(
      (x - size.width / 2) * pageToDepth,
      (size.height / 2 - y) * pageToDepth,
      height,
    )
    origin.copy(node.position)

    const idleFor = performance.now() - pointer.movedAt
    const gestures = marbleHandGestures(tuning, motion, pressed, pointer, idleFor)
    driveMarbleHandTap(tapState.current, tap, tuning, delta * 1000,
      gestures.drumming, gestures.pinching)
  }, -1)

  const responsiveScale = size.width <= 700 ? tuning.scale * tuning.mobileScale : tuning.scale

  return (
    <group ref={group} name="marble-hand-pointer" scale={responsiveScale}>
      <mesh
        ref={onMount}
        name="marble-hand-sculpture"
        geometry={geometry}
        rotation={[tuning.sculptureRoll, tuning.sculpturePitch, 0, 'YXZ']}
        castShadow={tuning.shadowsEnabled}
        receiveShadow
        frustumCulled={false}
        raycast={IGNORE_RAYCAST}
        customDepthMaterial={depthMaterial}
        // Three copies patched uniforms into the program, never back onto
        // the material, so the gate has no other way to read the live bend.
        userData={{ marbleHandTap: tap }}
      >
        <MarbleHandMaterial tuning={tuning} tap={tap} />
      </mesh>
    </group>
  )
}

// A failed decorative renderer must not unmount a working HTML catalogue.
class MarbleOverlayBoundary extends Component<{
  children: ReactNode
  onFailure: () => void
}, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onFailure() }
  render() { return this.state.failed ? null : this.props.children }
}

function MarbleLighting({ tuning, width, height }: {
  tuning: MarbleHandTuning
  width: number
  height: number
}) {
  const light = useRef<THREE.DirectionalLight>(null)
  const renderer = useThree((state) => state.gl)
  const shadowFar = Math.max(1400,
    Math.hypot(tuning.lightX, tuning.lightY, tuning.lightZ) + Math.hypot(width, height))
  useLayoutEffect(() => {
    renderer.toneMappingExposure = tuning.exposure
    renderer.shadowMap.enabled = tuning.shadowsEnabled
    renderer.shadowMap.needsUpdate = true
  }, [renderer, tuning.exposure, tuning.shadowsEnabled])
  useLayoutEffect(() => {
    const shadow = light.current?.shadow
    if (!shadow) return
    // Three allocates the target only while map is null. Changing mapSize
    // alone leaves the previous GPU allocation in use.
    shadow.map?.dispose()
    shadow.mapPass?.dispose()
    shadow.map = null
    shadow.mapPass = null
    shadow.needsUpdate = true
  }, [tuning.shadowMapSize])
  useLayoutEffect(() => {
    light.current?.shadow.camera.updateProjectionMatrix()
  }, [width, height, shadowFar])
  return (
    <>
      <ambientLight intensity={tuning.ambientIntensity} />
      <directionalLight
        ref={light}
        name="marble-hand-key-light"
        castShadow={tuning.shadowsEnabled}
        color={tuning.lightColor}
        intensity={tuning.keyIntensity}
        position={[tuning.lightX, tuning.lightY, tuning.lightZ]}
        shadow-mapSize-width={tuning.shadowMapSize}
        shadow-mapSize-height={tuning.shadowMapSize}
        shadow-intensity={tuning.shadowIntensity}
        shadow-radius={tuning.shadowRadius}
        shadow-camera-left={-width * 0.55}
        shadow-camera-right={width * 0.55}
        shadow-camera-top={height * 0.58}
        shadow-camera-bottom={-height * 0.58}
        shadow-camera-near={20}
        shadow-camera-far={shadowFar}
        shadow-normalBias={0.8}
      />
    </>
  )
}

// ── scene ─────────────────────────────────────────────────────────────

export function MarbleHandApp() {
  const reducedMotion = useReducedMotion()
  const page = useRef<HTMLElement>(null)
  const origin = useMemo(() => new THREE.Vector3(0, 0, marbleHandTuning.heightPx), [])
  const capture = useMemo(createMarblePageCaptureState, [])
  const [reflection, setReflection] = useState<MarblePageCaptureState['status']>('waiting')
  const [renderer, setRenderer] = useState<THREE.WebGLRenderer | null>(null)
  const [hand, setHand] = useState<THREE.Mesh | null>(null)
  const [contextLost, setContextLost] = useState(false)
  const [overlayFailed, setOverlayFailed] = useState(false)
  const failOverlay = useCallback(() => setOverlayFailed(true), [])
  const [tuning, setTuning] = useState<MarbleHandTuning>(marbleHandTuning)
  const [parked, setParked] = useState(showChrome)
  const [previewPressed, setPreviewPressed] = useState(false)
  const [colorPaused, setColorPaused] = useState(false)
  const toggleColorMotion = useCallback(() => setColorPaused((paused) => !paused), [])
  const colorMotion = !reducedMotion && !colorPaused
  const [box, setBox] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const [selected, setSelected] = useState<MarbleHandThemeId>('waves')
  const tap = useMemo(createMarbleHandTapUniforms, [])
  const drive = useRef<PointerDrive>({
    x: window.innerWidth * 0.7,
    y: window.innerHeight * 0.48,
    pressed: false,
    pinching: false,
    movedAt: performance.now(),
  })
  const lastPointer = useRef({ x: window.innerWidth * 0.7, y: window.innerHeight * 0.48 })
  const park = useCallback((next: boolean) => {
    drive.current.pressed = false
    drive.current.pinching = false
    drive.current.movedAt = performance.now()
    if (!next) {
      drive.current.x = lastPointer.current.x
      drive.current.y = lastPointer.current.y
    }
    setParked(next)
  }, [])

  useLayoutEffect(() => {
    const measure = () => setBox({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => {
    if (!renderer) return
    const canvas = renderer.domElement
    const lost = () => setContextLost(true)
    const restored = () => setContextLost(false)
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', restored)
    return () => {
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', restored)
    }
  }, [renderer])

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!event.isTrusted) return
      lastPointer.current.x = event.clientX
      lastPointer.current.y = event.clientY
      if (parked || (event.target instanceof Element && event.target.closest('[data-marble-hand-controls]'))) return
      drive.current.x = event.clientX
      drive.current.y = event.clientY
      drive.current.movedAt = event.timeStamp
    }
    const down = (event: PointerEvent) => {
      if (!event.isTrusted) return
      lastPointer.current.x = event.clientX
      lastPointer.current.y = event.clientY
      if (parked || (event.target instanceof Element && event.target.closest('[data-marble-hand-controls]'))) return
      drive.current.x = event.clientX
      drive.current.y = event.clientY
      drive.current.pressed = true
      drive.current.pinching = pressOnText(event.clientX, event.clientY)
      drive.current.movedAt = event.timeStamp
    }
    const release = () => {
      drive.current.pressed = false
      drive.current.pinching = false
      drive.current.movedAt = performance.now()
    }
    // A drag that starts beside a headline still selects its words; the
    // moment a real range exists, the fingers close on it.
    const selection = () => {
      if (drive.current.pressed && !(document.getSelection()?.isCollapsed ?? true)) {
        drive.current.pinching = true
      }
    }
    document.addEventListener('selectionchange', selection)
    window.addEventListener('pointermove', move, { capture: true, passive: true })
    window.addEventListener('pointerdown', down, { capture: true, passive: true })
    window.addEventListener('pointerup', release, { capture: true, passive: true })
    window.addEventListener('pointercancel', release, { capture: true, passive: true })
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('pointermove', move, { capture: true })
      window.removeEventListener('pointerdown', down, { capture: true })
      window.removeEventListener('pointerup', release, { capture: true })
      window.removeEventListener('pointercancel', release, { capture: true })
      window.removeEventListener('blur', release)
      document.removeEventListener('selectionchange', selection)
    }
  }, [parked])

  const choose = useCallback((id: MarbleHandThemeId) => {
    setSelected(id)
  }, [])

  const handReady = hand !== null && !contextLost && !overlayFailed
  const content = useMemo(
    () => (
      <CataloguePage
        page={page}
        width={box.width}
        height={box.height}
        selected={selected}
        pointer={handReady && !parked}
        colorMotion={colorMotion}
        reducedMotion={reducedMotion}
        tuning={tuning}
        onSelect={choose}
      />
    ),
    [box.height, box.width, choose, selected, handReady, parked, colorMotion, reducedMotion, tuning],
  )
  const controls = showChrome ? (
    <MarbleHandTweaks
      tuning={tuning}
      theme={selected}
      onChange={setTuning}
      ready={handReady}
      unavailable={overlayFailed || contextLost}
      parked={parked}
      onParked={park}
      previewPressed={previewPressed}
      onPreviewPressed={setPreviewPressed}
      colorMotion={colorMotion}
      reducedMotion={reducedMotion}
      onToggleColorMotion={toggleColorMotion}
      reflection={reflection}
    />
  ) : null

  return (
    <div className="mh-app" data-live={handReady || undefined} data-reflection-source={reflection}>
      {content}
      <MarbleOverlayBoundary onFailure={failOverlay}>
      <SurfaceCanvas
        id="marble-hand-overlay"
        aria-hidden="true"
        pointerMode="surfaces"
        shadows={tuning.shadowsEnabled ? 'percentage' : false}
        dpr={[1, 2]}
        style={{ position: 'fixed', inset: 0, zIndex: 40 }}
        gl={{ alpha: true, antialias: true }}
        camera={PIXEL_CAMERA}
        onCreated={(state) => {
          state.gl.setClearAlpha(0)
          state.gl.toneMapping = THREE.ACESFilmicToneMapping
          state.gl.toneMappingExposure = tuning.exposure
          window.__r3f = state
          setRenderer(state.gl)
        }}
      >
        <PixelPerfect />
        <MarbleHandPageCapture page={page} target={capture} />
        <ReflectionStatus capture={capture} onStatus={setReflection} />
        <MarbleLighting tuning={tuning} width={box.width} height={box.height} />
        <MarbleHandEnvironment page={page} origin={origin} tuning={tuning} capture={capture} theme={selected} />
        <mesh
          name="marble-hand-shadow-receiver"
          visible={tuning.shadowsEnabled}
          receiveShadow
          raycast={IGNORE_RAYCAST}
        >
          <planeGeometry args={[box.width, box.height]} />
          <shadowMaterial transparent opacity={PAGE_SHADOW_OPACITY} depthWrite={false} toneMapped={false} />
        </mesh>
        <Suspense fallback={null}>
            <MarblePointer
              drive={drive}
              reducedMotion={reducedMotion}
              tuning={tuning}
              parked={parked}
              previewPressed={previewPressed}
              origin={origin}
              tap={tap}
              onMount={setHand}
            />
        </Suspense>
        {hand ? <MarbleHandStroke hand={hand} tuning={tuning} tap={tap} /> : null}
      </SurfaceCanvas>
      </MarbleOverlayBoundary>

      {controls}
    </div>
  )
}

function ReflectionStatus({ capture, onStatus }: {
  capture: MarblePageCaptureState
  onStatus: (status: MarblePageCaptureState['status']) => void
}) {
  const previous = useRef(capture.status)
  useFrame(() => {
    if (capture.status === previous.current) return
    previous.current = capture.status
    onStatus(capture.status)
  })
  return null
}
