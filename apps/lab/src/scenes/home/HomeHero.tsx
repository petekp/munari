// Postcard example — shared form state shown on the page or a moving mesh.
// The holder owns layout; the mesh follows its measured rectangle. Resizing
// scales the holder rather than the captured root, whose layout stays 420×270.
// Motion returns to an exact flat pose before requesting the page presentation.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import {
  deformSurfaceGeometry,
  Surface,
  useSurfaceBeforeRender,
  type SurfaceHandle,
  useSurfaceStatus,
} from '@petepetrash/munari'
import { cameraDistance, readSurfaceFrameState } from '@petepetrash/munari/advanced'
import { setHomeFlyer } from './homeFlyer'
import { RAISED_STANDOFF } from './homeLightLaw'

export const HERO_W = 420
export const HERO_H = 270

export type HolderRef = React.RefObject<HTMLDivElement | null>
export type LandRef = { current: boolean }

// Postmark spots as card percentages. Deterministic, so the DOM copy and
// the captured copy always agree; clicks past the table revisit spots
// with a small extra rotation instead of stacking pixel-identical marks.
const MARK_SPOTS = [
  { x: 6, y: 52, rot: -12 },
  { x: 58, y: 4, rot: 8 },
  { x: 32, y: 60, rot: -5 },
  { x: 72, y: 54, rot: 14 },
  { x: 20, y: 6, rot: 5 },
  { x: 46, y: 30, rot: -16 },
  { x: 78, y: 20, rot: -8 },
]

function Postcard({
  name,
  onName,
  stamps,
  onStamp,
}: {
  name: string
  onName: (v: string) => void
  stamps: number
  onStamp: () => void
}) {
  const inputId = useId()
  const marks = []
  for (let k = Math.max(0, stamps - MARK_SPOTS.length); k < stamps; k++) {
    const s = MARK_SPOTS[k % MARK_SPOTS.length]
    marks.push(
      <span
        key={k}
        className="home-postmark"
        aria-hidden
        style={{
          left: `${s.x}%`,
          top: `${s.y}%`,
          rotate: `${s.rot + Math.floor(k / MARK_SPOTS.length) * 9}deg`,
        }}
      >
        par avion
      </span>,
    )
  }
  return (
    <div className="home-postcard">
      <div className="home-postcard-msg">
        <h3>Ciao.</h3>
        <p>
          A little HTML, away from the page. Add your name and a stamp.
        </p>
        <button type="button" onClick={onStamp}>
          Add a stamp
        </button>
      </div>
      <div className="home-postcard-addr">
        <span className="home-postcard-stamp" aria-hidden>
          ✈
        </span>
        <label htmlFor={inputId}>To</label>
        <input
          id={inputId}
          value={name}
          placeholder="Your name"
          autoComplete="off"
          onChange={(e) => onName(e.target.value)}
        />
        <p className="home-postcard-line">
          {name ? `For ${name}, with love.` : 'Greetings from the web.'}
        </p>
      </div>
      {marks}
    </div>
  )
}

function PostcardInstructions({ supported, lifted, reduced }: { supported: boolean; lifted: boolean; reduced: boolean }) {
  let text = 'Add your name, then show the postcard in 3D. The controls keep working and your changes stay with it.'
  if (!supported) text = 'The postcard works as regular HTML here. Play the recording to see the 3D interaction in a supported browser.'
  else if (reduced) text = 'Motion is reduced. You can switch the postcard between page and scene without animating it.'
  else if (lifted) text = 'Try the button and name field in 3D. Hover to steady the card, then return it to the page.'
  return <p className="home-note">{text}</p>
}

function PostcardPresentation({surface,preview}:{surface:SurfaceHandle;preview:boolean}) {
  const state = useSurfaceStatus(surface)
  return <span className="home-lamp" data-gl={state.presentation === 'scene'} aria-live="polite">
    {preview ? 'Recorded in Chrome' : state.presentation === 'scene' ? 'In the scene' : 'On the page'}
  </span>
}

export function HeroSection({
  surface,
  inScene,
  setInScene,
  holderRef,
  landRef,
  supported,
  reduced,
}: {
  surface: SurfaceHandle
  inScene: boolean
  setInScene: React.Dispatch<React.SetStateAction<boolean>>
  holderRef: HolderRef
  landRef: LandRef
  supported: boolean
  reduced: boolean
}) {
  const [name, setName] = useState('')
  const [stamps, setStamps] = useState(0)
  const [preview, setPreview] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const lifted = inScene
  // The card's shadow is the flyer's in both worlds (homeFlyer.ts). On the
  // page the holder is named in the same commit that shows it; in the scene
  // the mesh publishes its corners per frame.
  useLayoutEffect(() => {
    const holder = holderRef.current
    if (!holder) return
    setHomeFlyer({ kind: 'page', element: holder })
  }, [holderRef])
  useEffect(() => () => setHomeFlyer(null), [])
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const measure = () => setScale(Math.min(1, viewport.clientWidth / HERO_W))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])
  const content = (
    <Postcard
      name={name}
      onName={setName}
      stamps={stamps}
      onStamp={() => setStamps((n) => n + 1)}
    />
  )
  return (
    <section className="home-section home-hero" id="try" aria-labelledby="try-title">
      <div className="home-hero-copy">
        <p className="home-eyebrow">Try it</p>
        <h2 id="try-title">A postcard that leaves the page and comes back.</h2>
        <p className="home-thesis">
          Add your name, send the card into the scene, and keep typing while it
          floats. The field, the button and the stamps are the same HTML the
          whole way.
        </p>
        <p className="home-hero-status">Built with React and Three.js. Uses experimental browser features. <a href="#support">Browser support</a></p>
      </div>
      <div className="home-hero-stage" data-live={supported}>
        <div className="home-demo-heading">
          <span>Try a live postcard</span>
          <span className="home-demo-tag">HTML + CSS</span>
        </div>
        <div ref={viewportRef} className="home-hero-viewport">
          <div ref={holderRef} className="home-hero-holder" style={{ transform: `scale(${scale})` }} hidden={preview}>
            {supported ? (
              <Surface.Root surface={surface} canvas="home" onPresentationChange={presentation => {
                if (presentation === 'page' && holderRef.current) setHomeFlyer({kind:'page',element:holderRef.current})
              }} timing={{ settleMs: reduced ? 0 : 120, durationMs: reduced ? 0 : 260 }} inScene={inScene}>
                <Surface.HTML size={[HERO_W, HERO_H]}>{content}</Surface.HTML>
              </Surface.Root>
            ) : content}
          </div>
          {preview && (
            <video
              className="home-hero-preview"
              src="/previews/postcard.mp4"
              poster="/previews/postcard.jpg"
              controls
              playsInline
              autoPlay
              muted
              aria-label="Recorded preview of the postcard moving into 3D and returning to the page"
            />
          )}
        </div>
        <div className="home-hero-row">
          {supported ? (
            <button
              type="button"
              className="home-btn"
              data-relief="raised"
              onClick={() => {
                if (!lifted) setInScene(true)
                else if (reduced) setInScene(false)
                else landRef.current = true
              }}
            >
              {lifted ? 'Return to page' : 'Show in 3D'}
            </button>
          ) : (
            <button type="button" className="home-btn" data-relief="raised" onClick={() => setPreview((value) => !value)}>
              {preview ? 'Back to the postcard' : 'Play 3D preview'}
            </button>
          )}
          <PostcardPresentation surface={surface} preview={preview} />
        </div>
        <PostcardInstructions supported={supported} lifted={lifted} reduced={reduced} />
      </div>
    </section>
  )
}

// ── the canvas half ───────────────────────────────────────────────────

// Bend law, in content px: a cosine bump of the pointer's neighborhood,
// lifted toward the camera while the card is afloat.
const BEND_RADIUS = 170
const BEND_HEIGHT = 18
// Cruise height above the slot, px. Low on purpose: the empty slot stays
// visible under the floating card, which is the hold half of the story.
const HOVER_LIFT = 34
// A short lift keeps the form in reach. Lateral travel is also capped to
// half the spare viewport width, so narrow screens cannot lose the card.
const LAUNCH_MS = 1100
const LAND_MS = 650
// How far above the page the card's shadow says it flies, px. The visible
// lift is a screen-space rise, so the shadow's height is the only cue that
// the card left the page; at rest it matches the raised relief exactly.
const FLY_HEIGHT = 40

const FLYER_LOCAL: readonly (readonly [number, number])[] = [
  [-HERO_W / 2, HERO_H / 2],
  [HERO_W / 2, HERO_H / 2],
  [HERO_W / 2, -HERO_H / 2],
  [-HERO_W / 2, -HERO_H / 2],
]
const flyerCorner = new THREE.Vector3()
const flyerCorners = new Float32Array(12)

function liftProgress(st: FlightState): number {
  if (st.phase === 'launch') return easeInOut(st.t)
  if (st.phase === 'afloat') return 1
  if (st.phase === 'landing') return 1 - easeInOut(st.t)
  return 0
}

// World pixels map to canvas pixels at z=0. Include the canvas origin because
// this renderer scrolls with the section rather than filling the viewport.
function publishFlyer(group: THREE.Object3D, canvas: HTMLCanvasElement, lift: number) {
  const rect = canvas.getBoundingClientRect()
  group.updateMatrixWorld(true)
  FLYER_LOCAL.forEach(([x, y], index) => {
    flyerCorner.set(x, y, 0)
    group.localToWorld(flyerCorner)
    flyerCorners[index * 3] = rect.left + flyerCorner.x + rect.width / 2
    flyerCorners[index * 3 + 1] = rect.top + rect.height / 2 - flyerCorner.y
    flyerCorners[index * 3 + 2] = flyerCorner.z + RAISED_STANDOFF + lift * FLY_HEIGHT
  })
  setHomeFlyer({ kind: 'scene', corners: flyerCorners, lift })
}

const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)

type Phase = 'ground' | 'launch' | 'afloat' | 'landing'

interface FlightState {
  phase: Phase
  t: number
  clock: number
  still: number
  px: number
  py: number
  rx: number
  ry: number
  rz: number
  p0: { x: number; y: number; rx: number; ry: number; rz: number }
  landed: boolean
  flat: boolean
}

interface FramePose {
  X: number
  Y: number
  RX: number
  RY: number
  RZ: number
  flutter: number
}

interface PointerBend { x: number; y: number; amp: number; target: number }

function updatePaperGeometry(mesh: THREE.Mesh, st: FlightState, aim: PointerBend, flutter: number) {
  const bendAmp = st.phase === 'afloat' ? aim.amp : 0
  if (bendAmp < 0.004 && flutter < 0.01) {
    if (!st.flat) {
      deformSurfaceGeometry(mesh.geometry, [HERO_W, HERO_H], (x, y) => ({ x, y }))
      st.flat = true
    }
    return
  }
  st.flat = false
  deformSurfaceGeometry(mesh.geometry, [HERO_W, HERO_H], (x, y) => {
    const d = Math.hypot(x - aim.x, y - aim.y)
    const t = Math.max(0, 1 - d / BEND_RADIUS)
    const bend = bendAmp * BEND_HEIGHT * (Math.cos((1 - t) * Math.PI) + 1) * 0.5
    const wave = flutter * Math.sin(x * 0.014 + st.clock * 2.6) * Math.sin(y * 0.008 + st.clock * 1.9)
    return { x, y, z: bend + wave }
  })
}

// Phase changes that come from outside the flight: a launch once the pixels
// are in hand, a landing (or a cancelled lift) once the page calls the card
// home.
function advancePhase(st: FlightState, landRef: LandRef, ready: boolean, onLanded: () => void, sx: number, sy: number) {
  if (st.phase === 'ground') {
    st.px = sx
    st.py = sy
    if (landRef.current) {
      // "call it home" before the pixels ever arrived: cancel the lift.
      landRef.current = false
      if (!st.landed) {
        st.landed = true
        onLanded()
      }
    } else if (ready && !st.landed) {
      st.phase = 'launch'
      st.t = 0
    }
  } else if (landRef.current && st.phase !== 'landing') {
    landRef.current = false
    st.p0 = { x: st.px, y: st.py, rx: st.rx, ry: st.ry, rz: st.rz }
    st.phase = 'landing'
    st.t = 0
  }
}

// One frame of flight: advances st.t/phase and returns the pose target
// (canvas px / radians) for the slot center (sx, sy).
function flightPose(st: FlightState, sx: number, sy: number, delta: number, travel: number): FramePose {
  if (st.phase === 'launch') {
    st.t = Math.min(1, st.t + delta * (1000 / LAUNCH_MS))
    const u = easeInOut(st.t)
    const X = sx + Math.sin(u * Math.PI * 2) * travel * (1 - 0.25 * u)
    const Y = sy + Math.sin(u * Math.PI) * 28 + u * HOVER_LIFT
    // Bank into the turn, with bounds that keep the corners below the
    // caption and inside the preview crop during the fastest part of launch.
    const vx = (X - st.px) / Math.max(delta, 1e-4)
    const vy = (Y - st.py) / Math.max(delta, 1e-4)
    if (st.t >= 1) {
      st.phase = 'afloat'
      st.clock = 0
    }
    return {
      X,
      Y,
      RZ: THREE.MathUtils.clamp(-vx * 0.0007, -0.075, 0.075),
      RY: THREE.MathUtils.clamp(vx * 0.0005, -0.08, 0.08),
      RX: THREE.MathUtils.clamp(vy * 0.0006, -0.06, 0.06),
      flutter: 3,
    }
  }
  if (st.phase === 'afloat') {
    // Bob and sway, fading to dead-still as the cursor approaches so the
    // card is an easy target to stamp and address.
    const loose = 1 - st.still
    return {
      X: sx + Math.sin(st.clock * 0.9) * 8 * loose,
      Y: sy + HOVER_LIFT + Math.sin(st.clock * 1.3) * 6 * loose,
      RX: -0.07 * loose,
      RY: 0,
      RZ: 0.045 * Math.sin(st.clock * 0.6) * loose,
      flutter: 1.8 * (1 - 0.7 * st.still),
    }
  }
  if (st.phase === 'landing') {
    st.t = Math.min(1, st.t + delta * (1000 / LAND_MS))
    const u = easeInOut(st.t)
    return {
      X: st.p0.x + (sx - st.p0.x) * u,
      Y: st.p0.y + (sy - st.p0.y) * u,
      RX: st.p0.rx * (1 - u),
      RY: st.p0.ry * (1 - u),
      RZ: st.p0.rz * (1 - u),
      flutter: 2 * (1 - u),
    }
  }
  return { X: sx, Y: sy, RX: 0, RY: 0, RZ: 0, flutter: 0 }
}

function FlyerFrame({ group, flight, reduced }: { group: React.RefObject<THREE.Group | null>; flight: React.RefObject<FlightState>; reduced:boolean }) {
  useSurfaceBeforeRender(frame => {
    // The soft shadow follows the physical pose. Snapping its footprint with
    // the text raster produced a 0.518-channel jump at the page boundary (#44).
    if (frame.canvasMayDraw && group.current) publishFlyer(group.current, frame.canvas, reduced ? 0 : liftProgress(flight.current))
  })
  return null
}

export function HeroMesh({
  surface,
  holderRef,
  reduced,
  landRef,
  onLanded,
}: {
  surface: SurfaceHandle
  holderRef: HolderRef
  reduced: boolean
  landRef: LandRef
  onLanded: () => void
}) {
  const canvas = useThree((s) => s.gl.domElement)
  const groupRef = useRef<THREE.Group>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  const aim = useRef({ x: HERO_W / 2, y: HERO_H / 2, amp: 0, target: 0 })
  const f = useRef<FlightState>({
    phase: 'ground',
    t: 0,
    clock: 0,
    still: 0,
    px: 0,
    py: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    p0: { x: 0, y: 0, rx: 0, ry: 0, rz: 0 },
    landed: false,
    flat: false,
  })
  const lastRequest = useRef<boolean | null>(null)


  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const a = aim.current
    if (e.uv) {
      a.x = e.uv.x * HERO_W
      a.y = (1 - e.uv.y) * HERO_H
    }
    a.target = 1
  }
  const onOut = () => {
    aim.current.target = 0
  }

  useFrame((_, delta) => {
    const group = groupRef.current
    const mesh = meshRef.current
    const holder = holderRef.current
    if (!group || !mesh || !holder) return

    const frameState = readSurfaceFrameState(surface)
    if (lastRequest.current !== frameState.targetInScene) {
      const st = f.current
      st.phase = 'ground'; st.t = 0; st.rx = st.ry = st.rz = 0
      st.landed = !frameState.targetInScene
      landRef.current = false
      lastRequest.current = frameState.targetInScene
    }
    const r = holder.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    const sx = r.left + r.width / 2 - canvasRect.left - canvasRect.width / 2
    const sy = canvasRect.height / 2 - (r.top + r.height / 2 - canvasRect.top)
    group.scale.setScalar(r.width / HERO_W)

    const st = f.current
    const a = aim.current
    if (reduced) {
      group.position.set(sx, sy, 0)
      group.rotation.set(0, 0, 0)
      if (!st.flat) {
        deformSurfaceGeometry(mesh.geometry, [HERO_W, HERO_H], (x, y) => ({ x, y }))
        st.flat = true
      }
      return
    }
    st.clock += delta
    st.still += ((a.target ? 1 : 0) - st.still) * Math.min(1, delta * 6)
    a.amp += (a.target - a.amp) * Math.min(1, delta * 8)

    advancePhase(st, landRef, frameState.presentation === 'scene' && frameState.targetInScene, onLanded, sx, sy)

    const travel = Math.max(0, Math.min(32, r.left - 12, window.innerWidth - r.right - 12))
    const { X, Y, RX, RY, RZ, flutter } = flightPose(st, sx, sy, delta, travel)
    if (st.phase === 'landing' && st.t >= 1 && !st.landed) {
      st.landed = true
      st.phase = 'ground'
      st.rx = st.ry = st.rz = 0
      onLanded()
    }
    st.px = X
    st.py = Y

    const k = Math.min(1, delta * 9)
    st.rx += (RX - st.rx) * k
    st.ry += (RY - st.ry) * k
    st.rz += (RZ - st.rz) * k
    group.position.set(X, Y, 0)
    group.rotation.set(st.rx, st.ry, st.rz)

    updatePaperGeometry(mesh, st, a, flutter)
    // Only while the scene owns the card. Once landed the page names it
    // again in its own commit, and a late frame here must not overwrite that.
  })

  return (
    <group ref={groupRef}>
      <Surface.Mesh
        ref={meshRef}
        surface={surface}
        placement="manual"
        alpha="source"
        frustumCulled={false}
        geometry={<planeGeometry args={[HERO_W, HERO_H, 24, 16]} />}
        onPointerMove={onMove}
        onPointerOut={onOut}
      >
        <FlyerFrame group={groupRef} flight={f} reduced={reduced} />
      </Surface.Mesh>
    </group>
  )
}

/** Fits the frustum so a CSS px is a world unit at z=0 (Slider's rig). */
export function PixelPerfect({ fov }: { fov: number }) {
  // SAFETY: r3f hands back a PerspectiveCamera unless the Canvas asked for
  // `orthographic`, which the home canvas does not.
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  useFrame(() => {
    const dist = cameraDistance(size.height, fov)
    if (camera.fov !== fov || camera.position.z !== dist) {
      camera.fov = fov
      camera.position.set(0, 0, dist)
      camera.near = 1
      camera.far = dist * 3
      camera.updateProjectionMatrix()
    }
  })
  return null
}
