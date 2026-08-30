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
import { MarbleHandMaterial } from './marbleHandMaterial'
import { MarbleHandEnvironment } from './marbleHandEnvironment'
import { MarbleHandPageCapture, createMarblePageCaptureState, type MarblePageCaptureState } from './marbleHandPageCapture'
import { buildMarbleHandSupport, marbleHandSafeHeight } from './marbleHandPose'
import { MarbleHandTweaks } from './marbleHandTweaks'
import { marbleHandTuning, type MarbleHandTuning } from './marbleHandTuning'
import './marbleHand.css'

const FOV = 42
const IGNORE_RAYCAST: THREE.Object3D['raycast'] = () => {}
const PIXEL_CAMERA = { fov: FOV, position: new THREE.Vector3(0, 0, 1000) }

// The receiver carries only shadow alpha. A partial density leaves the
// actual paper colour visible beneath it, rather than painting a black cutout.
const PAGE_SHADOW_OPACITY = 0.28

interface PointerDrive {
  x: number
  y: number
  pressed: boolean
}

const SPECIMENS = [
  { id: 'carta', name: 'Carta', note: 'warm fibre', color: '#e9e2cf' },
  { id: 'nero', name: 'Nero', note: 'litho ink', color: '#171812' },
  { id: 'cobalto', name: 'Cobalto', note: 'mineral blue', color: '#24479a' },
  { id: 'rosso', name: 'Rosso', note: 'signal red', color: '#d94934' },
] as const

type SpecimenId = (typeof SPECIMENS)[number]['id']

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
  contacts,
  enhanced,
  pointer,
  finish,
  reflection,
  onSelect,
}: {
  page: React.RefObject<HTMLElement | null>
  width: number
  height: number
  selected: SpecimenId
  contacts: number
  enhanced: boolean
  pointer: boolean
  finish: MarbleHandTuning['materialMode']
  reflection: MarblePageCaptureState['status']
  onSelect: (id: SpecimenId) => void
}) {
  return (
    <main ref={page} className="mh-sheet" data-marble-hand-pointer={pointer || undefined} style={{ width, height }}>
      <header className="mh-masthead">
        <span>Munari · pointer studies</span>
        <span>Study M–07</span>
      </header>

      <section className="mh-intro">
        <p className="mh-kicker">A classical hand for the machine age</p>
        <h1>The cursor<br />has weight now.</h1>
        <p className="mh-deck">
          Move across the specimens. The page stays native HTML.
          Only the hand and its shadow are drawn above it.
        </p>
        <div className="mh-status" aria-live="polite">
          <i data-enhanced={enhanced || undefined} />
          {enhanced ? `Native page · ${finish} hand` : 'Native page · browser pointer'}
        </div>
        {reflection === 'unsupported' || reflection === 'error' ? (
          <p className="mh-capture-notice" role="status">
            {reflection === 'unsupported'
              ? 'Full-page reflections need Chrome with HTML-in-canvas enabled. The native page still works here.'
              : 'Page capture is unavailable. Reload to restore full-page reflections.'}
          </p>
        ) : null}
      </section>

      <section className="mh-specimens" aria-label="stone and print specimens">
        {SPECIMENS.map((specimen, index) => (
          <button
            key={specimen.id}
            type="button"
            className="mh-specimen"
            data-specimen={specimen.id}
            data-selected={selected === specimen.id || undefined}
            aria-pressed={selected === specimen.id}
            onClick={() => onSelect(specimen.id)}
          >
            <span className="mh-swatch" style={{ background: specimen.color }} aria-hidden />
            <span className="mh-specimen-copy">
              <b>{String(index + 1).padStart(2, '0')}</b>
              <strong>{specimen.name}</strong>
              <small>{specimen.note}</small>
            </span>
          </button>
        ))}
      </section>

      <footer className="mh-footer">
        <p>
          selected <strong>{selected}</strong>
        </p>
        <p>
          contacts <strong>{String(contacts).padStart(2, '0')}</strong>
        </p>
        <p>Move · press · watch the shadow tighten</p>
      </footer>
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

function MarblePointer({
  drive,
  reducedMotion,
  tuning,
  parked,
  previewPressed,
  origin,
  onMount,
}: {
  drive: React.RefObject<PointerDrive>
  reducedMotion: boolean
  tuning: MarbleHandTuning
  parked: boolean
  previewPressed: boolean
  origin: THREE.Vector3
  onMount: (mesh: THREE.Mesh | null) => void
}) {
  const geometry = useMarbleHandGeometry()
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
  })

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
      >
        <MarbleHandMaterial tuning={tuning} />
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

export function MarbleHandApp({ chips }: { chips?: React.ReactNode }) {
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
  const [box, setBox] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const [selected, setSelected] = useState<SpecimenId>('cobalto')
  const [contacts, setContacts] = useState(0)
  const drive = useRef<PointerDrive>({
    x: window.innerWidth * 0.7,
    y: window.innerHeight * 0.48,
    pressed: false,
  })
  const lastPointer = useRef({ x: window.innerWidth * 0.7, y: window.innerHeight * 0.48 })
  const park = useCallback((next: boolean) => {
    drive.current.pressed = false
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
    }
    const down = (event: PointerEvent) => {
      if (!event.isTrusted) return
      lastPointer.current.x = event.clientX
      lastPointer.current.y = event.clientY
      if (parked || (event.target instanceof Element && event.target.closest('[data-marble-hand-controls]'))) return
      drive.current.x = event.clientX
      drive.current.y = event.clientY
      drive.current.pressed = true
    }
    const release = () => {
      drive.current.pressed = false
    }
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
    }
  }, [parked])

  const choose = useCallback((id: SpecimenId) => {
    setSelected(id)
    setContacts((value) => value + 1)
  }, [])

  const handReady = hand !== null && !contextLost && !overlayFailed
  const content = useMemo(
    () => (
      <CataloguePage
        page={page}
        width={box.width}
        height={box.height}
        selected={selected}
        contacts={contacts}
        enhanced={handReady}
        pointer={handReady && !parked}
        finish={tuning.materialMode}
        reflection={reflection}
        onSelect={choose}
      />
    ),
    [box.height, box.width, choose, contacts, selected, handReady, parked, tuning.materialMode, reflection],
  )
  const controls = showChrome ? (
    <MarbleHandTweaks
      tuning={tuning}
      onChange={setTuning}
      ready={handReady}
      unavailable={overlayFailed || contextLost}
      parked={parked}
      onParked={park}
      previewPressed={previewPressed}
      onPreviewPressed={setPreviewPressed}
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
        <MarbleHandEnvironment page={page} origin={origin} tuning={tuning} capture={capture} />
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
              onMount={setHand}
            />
        </Suspense>
      </SurfaceCanvas>
      </MarbleOverlayBoundary>

      {chips}
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
