// Postcard motion — flexible lift, independent curls and a quiet return.
// Geometry is updated on the CPU so the live form remains hit-testable. The
// last frame is exactly flat before the protocol returns to native HTML (#51).
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { deformSurfaceGeometry, Surface, useSurfaceBeforeRender, type SurfaceHandle } from '@petepetrash/munari'
import { cameraDistance, readSurfaceFrameState } from '@petepetrash/munari/advanced'
import type { HolderRef, LandRef } from './HomeHero'
import { PAPER_WIDTH as HERO_W, PAPER_HEIGHT as HERO_H, PAPER_COLUMNS, PAPER_ROWS, paperPoint, stepPaperSpring, type PaperInteraction, type PaperShape } from './homePaperLaw'
import { createPaperDrawFrame, writePaperDrawFrame } from './homePaperFrame'
import { setHomeFlyer } from './homeFlyer'
import { POSTCARD_STANDOFF } from './homeLightLaw'
import { HomePostcardMaterial } from './HomePostcardMaterial'

// ── the canvas half ───────────────────────────────────────────────────

// Cruise height above the slot, px. Low on purpose: the empty slot stays
// visible under the floating card, which is the hold half of the story.
const HOVER_LIFT = 34
// A short lift keeps the form in reach. Lateral travel is also capped to
// half the spare viewport width, so narrow screens cannot lose the card.
const LAUNCH_MS = 1100
const LAND_MS = 650
// Centre standoff during flight. The shadow frame adds the curved vertices'
// own height to this value (decision #51).
const FLY_HEIGHT = 40

function liftProgress(st: FlightState): number {
  if (st.phase === 'launch') return easeInOut(st.t)
  if (st.phase === 'afloat') return 1
  if (st.phase === 'landing') return 1-easeInOut(st.t)
  return 0
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
  vx: number
}

interface FramePose {
  X: number
  Y: number
  RX: number
  RY: number
  RZ: number
}

interface PointerBend { x: number; y: number; amp: number; target: number; focused: boolean }

function createPaperModes() {
  const spring=()=>({value:0,velocity:0})
  return {bow:spring(),a:spring(),b:spring(),twist:spring(),ripple:spring(),seen:0,time:0,quiet:0}
}

function updatePaperGeometry(mesh: THREE.Mesh, st: FlightState, aim: PointerBend, modes: ReturnType<typeof createPaperModes>, interaction: PaperInteraction, dt: number) {
  const amount=st.phase==='launch' ? easeInOut(Math.min(1,st.t*2)) : st.phase==='afloat' ? 1 : st.phase==='landing' ? 1-easeInOut(Math.max(0,(st.t-.2)/.8)) : 0
  if (!amount) {
    if (!st.flat) deformSurfaceGeometry(mesh.geometry,[HERO_W,HERO_H],(x,y)=>({x,y}))
    st.flat=true
    return
  }
  st.flat=false
  modes.time+=dt
  if (interaction.impulses!==modes.seen) {
    modes.ripple.velocity+=24*Math.min(2,interaction.impulses-modes.seen)
    modes.a.velocity+=2
    modes.b.velocity-=1
    modes.seen=interaction.impulses
    modes.time=0
  }
  const x=(aim.x/HERO_W-.5)*2, y=(aim.y/HERO_H-.5)*2
  const nearA=Math.max(0,Math.min(1,(.8*x-.6*y-.55)/.65)),nearB=Math.max(0,Math.min(1,(-.8*x+.6*y-.55)/.65))
  const reading=aim.focused||(aim.target>0&&Math.max(nearA,nearB)<.45) ? 1 : 0
  modes.quiet+=(reading-modes.quiet)*(1-Math.exp(-8*dt))
  const loose=1-modes.quiet,edgeA=nearA*aim.amp,edgeB=nearB*aim.amp
  const peel=st.phase==='launch' ? Math.sin(Math.PI*st.t) : 0
  stepPaperSpring(modes.bow,.6-.32*modes.quiet+.08*Math.sin(st.clock*.8)*loose,dt)
  stepPaperSpring(modes.a,2.65-2.25*modes.quiet+.10*Math.sin(st.clock*1.1)*loose+.18*peel+.2*edgeA,dt)
  stepPaperSpring(modes.b,.78-.40*modes.quiet+.11*Math.sin(st.clock*.7+1)*loose+.12*peel+.25*edgeB,dt)
  stepPaperSpring(modes.twist,.25*Math.sin(st.clock*1.2+.5)*loose+THREE.MathUtils.clamp(st.vx/250,-.5,.5),dt)
  stepPaperSpring(modes.ripple,0,dt)
  const shape:PaperShape={amount,bow:modes.bow.value,curlA:modes.a.value,curlB:modes.b.value,twist:modes.twist.value,ripple:THREE.MathUtils.clamp(modes.ripple.value+.08*loose,-1,1),time:modes.time}
  deformSurfaceGeometry(mesh.geometry,[HERO_W,HERO_H],(x,y)=>paperPoint(x,y,shape))
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
    const X = sx + Math.sin(u * Math.PI) * travel * (1 - 0.25 * u)
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
    }
  }
  if (st.phase === 'afloat') {
    // Bob and sway, fading to dead-still as the cursor approaches so the
    // card is an easy target to stamp and address.
    const loose = 1 - st.still
    return {
      X: sx + Math.sin(st.clock * 0.9) * 8 * loose,
      Y: sy + HOVER_LIFT + Math.sin(st.clock * 1.3) * 6 * loose,
      RX: -0.22 * loose,
      RY: (-.06+.02*Math.sin(st.clock*.55)) * loose,
      RZ: 0.045 * Math.sin(st.clock * 0.6) * loose,
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
    }
  }
  return { X: sx, Y: sy, RX: 0, RY: 0, RZ: 0 }
}

function FlyerFrame({ group, mesh, holder, flight, reduced }: { group: React.RefObject<THREE.Group | null>; mesh: React.RefObject<THREE.Mesh | null>; holder: HolderRef; flight: React.RefObject<FlightState>; reduced:boolean }) {
  const paper=useMemo(createPaperDrawFrame,[])
  useSurfaceBeforeRender(frame => {
    if (!frame.canvasMayDraw || !group.current || !mesh.current || !holder.current) return
    writePaperDrawFrame(paper,mesh.current,group.current,frame.camera,frame.canvas,holder.current,POSTCARD_STANDOFF+(reduced ? 0 : liftProgress(flight.current)*FLY_HEIGHT))
    setHomeFlyer({kind:'scene',corners:paper.corners,paper})
  })
  return null
}

export function HeroMesh({
  surface,
  paper,
  holderRef,
  reduced,
  landRef,
  onLanded,
}: {
  surface: SurfaceHandle
  paper: PaperInteraction
  holderRef: HolderRef
  reduced: boolean
  landRef: LandRef
  onLanded: () => void
}) {
  const canvas = useThree((s) => s.gl.domElement)
  const groupRef = useRef<THREE.Group>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  const aim = useRef({ x: HERO_W / 2, y: HERO_H / 2, amp: 0, target: 0, focused: false })
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
    vx: 0,
  })
  const lastRequest = useRef<boolean | null>(null)
  const modes = useMemo(createPaperModes,[])

  const raycast = useMemo(() => function (this: THREE.Mesh, ray: THREE.Raycaster, hits: THREE.Intersection[]) {
    const first = hits.length
    THREE.Mesh.prototype.raycast.call(this, ray, hits)
    const candidates=hits.splice(first).sort((a,b)=>a.distance-b.distance)
    for (const hit of candidates) {
      // The rolled lip shows unprinted stock. It must not activate hidden
      // front-side content, including a farther intersection of the same sheet.
      if (hit.face && hit.face.normal.clone().transformDirection(this.matrixWorld).dot(ray.ray.direction)>=0) return
      hits.push(hit)
      return
    }
  }, [])


  // Read the pointer against a stable box. A raycast hover would flap when
  // curling geometry moves away from a stationary pointer (#51).
  useEffect(() => {
    const move=(event:PointerEvent)=>{
      if (!event.isTrusted || f.current.phase!=='afloat' || !holderRef.current) return
      const r=holderRef.current.getBoundingClientRect(),scale=r.width/HERO_W
      const x=(event.clientX-r.left)/scale,y=(event.clientY-r.top+HOVER_LIFT)/scale,pad=24/scale
      aim.current.x=THREE.MathUtils.clamp(x,0,HERO_W)
      aim.current.y=THREE.MathUtils.clamp(y,0,HERO_H)
      aim.current.target=x>=-pad&&x<=HERO_W+pad&&y>=-pad&&y<=HERO_H+pad ? 1 : 0
    }
    const down=(event:PointerEvent)=>{
      move(event)
      if (!event.isTrusted || event.button!==0 || f.current.phase!=='afloat' || !aim.current.target) return
      const {x,y}=aim.current
      const nx=(x/HERO_W-.5)*2,ny=(y/HERO_H-.5)*2
      if (Math.abs(.8*nx-.6*ny)>.95) paper.impulses++
    }
    const up=(event:PointerEvent)=>{if(event.pointerType!=='mouse')aim.current.target=0}
    const leave=(event:PointerEvent)=>{if(!event.relatedTarget)aim.current.target=0}
    window.addEventListener('pointermove',move,{capture:true,passive:true})
    window.addEventListener('pointerdown',down,{capture:true,passive:true})
    window.addEventListener('pointerup',up,{capture:true,passive:true})
    window.addEventListener('pointerout',leave,{capture:true,passive:true})
    return()=>{
      window.removeEventListener('pointermove',move,true)
      window.removeEventListener('pointerdown',down,true)
      window.removeEventListener('pointerup',up,true)
      window.removeEventListener('pointerout',leave,true)
    }
  },[holderRef,paper])

  useFrame((_, delta) => {
    const group = groupRef.current
    const mesh = meshRef.current
    const holder = holderRef.current
    if (!group || !mesh || !holder) return

    const frameState = readSurfaceFrameState(surface)
    if (lastRequest.current !== frameState.targetInScene) {
      const st = f.current
      st.phase = 'ground'; st.t = 0; st.rx = st.ry = st.rz = 0
      Object.assign(modes,createPaperModes(),{seen:paper.impulses})
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
    a.focused = holder.contains(document.activeElement)
    const engaged = a.target > 0 || a.focused
    st.still += ((engaged ? 1 : 0) - st.still) * Math.min(1, delta * 6)
    a.amp += (a.target - a.amp) * Math.min(1, delta * 8)

    advancePhase(st, landRef, frameState.presentation === 'scene' && frameState.targetInScene, onLanded, sx, sy)

    const travel = Math.max(0, Math.min(32, r.left - 12, window.innerWidth - r.right - 12))
    const { X, Y, RX, RY, RZ } = flightPose(st, sx, sy, delta, travel)
    if (st.phase === 'landing' && st.t >= 1 && !st.landed) {
      st.landed = true
      st.phase = 'ground'
      st.rx = st.ry = st.rz = 0
      onLanded()
    }
    st.vx = THREE.MathUtils.clamp((X-st.px)/Math.max(delta,.001),-300,300)
    st.px = X
    st.py = Y

    const k = Math.min(1, delta * 9)
    st.rx += (RX - st.rx) * k
    st.ry += (RY - st.ry) * k
    st.rz += (RZ - st.rz) * k
    group.position.set(X, Y, 0)
    group.rotation.set(st.rx, st.ry, st.rz)

    updatePaperGeometry(mesh, st, a, modes, paper, delta)
  })

  return (
    <group ref={groupRef}>
      <Surface.Mesh
        ref={meshRef}
        surface={surface}
        placement="manual"
        alpha="source"
        frustumCulled={false}
        geometry={<planeGeometry args={[HERO_W, HERO_H, PAPER_COLUMNS, PAPER_ROWS]} />}
        material={<HomePostcardMaterial />}
        raycast={raycast}
      >
        <FlyerFrame group={groupRef} mesh={meshRef} holder={holderRef} flight={f} reduced={reduced} />
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
