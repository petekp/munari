import { inspectCapture } from '@petepetrash/munari/advanced'
// Complete callers for grouped handoffs, different-content landing, and attached-element capture.
import { PageTargets } from './PageTargets'
import { FrameCompanion } from './FrameCompanion'
import { SampledParts } from './SampledParts'
import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  Surface, SurfaceCanvas, useSurfaceHandle, useSurfaceStatus,
  useSurfaceMotion, useSurfaceTexture, useElementCapture,
  useCaptureFrame, useCaptureStatus,
  type CaptureHandle, type CaptureFrame, type SurfaceHandle,
} from '@petepetrash/munari'
import '@petepetrash/munari/style.css'

type ViewKey = 'a' | 'b'
interface Trip { from: ViewKey; to: ViewKey; epoch: number }
interface CaptureSample { sourceId: number; generation: number; width: number; height: number; pixel: number[] }
interface CompositionRecords {
  mounts: Record<string, number>
  unmounts: Record<string, number>
  group: ReturnType<typeof useSurfaceStatus> | null
  transition: ReturnType<typeof useSurfaceStatus> | null
  holds: {group:string;presentation:string|null;t:number}[]
  errors: string[]
  activePage: ViewKey
  blend: number
  motionCalls: number
  renderFrames: number
  motionLast: unknown
  capture: CaptureHandle | null
  samples: Record<string, CaptureSample | null>
}
const records: CompositionRecords = {
  mounts: {}, unmounts: {}, group: null, transition: null,
  holds: [], errors: [], activePage: 'a', blend: 0, motionCalls: 0, renderFrames: 0, motionLast: null, capture: null, samples: {},
}
function Content({ id, color }: { id: string; color: string }) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    records.mounts[id] = (records.mounts[id] ?? 0) + 1
    return () => { records.unmounts[id] = (records.unmounts[id] ?? 0) + 1 }
  }, [id])
  return <form data-content={id} onSubmit={event => event.preventDefault()}
    style={{width:300,height:180,boxSizing:'border-box',padding:20,background:color,color:'white',display:'grid',gap:12}}>
    <strong>{id}</strong>
    <label>Note <input defaultValue={`${id} note`} /></label>
    <button type="button" onClick={() => setCount(value => value + 1)}>Count {count}</button>
  </form>
}
function Status({ surface, group }: { surface: SurfaceHandle; group: 'group' | 'transition' }) {
  const state = useSurfaceStatus(surface)
  useLayoutEffect(() => { records[group] = state }, [group, state])
  return <output>{state.presentation}{state.isTransitioning ? ' (moving)' : ''}</output>
}
function PixelCamera() {
  const { camera, size } = useThree()
  useLayoutEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.position.z = size.height / (2 * Math.tan(camera.fov * Math.PI / 360))
      camera.updateProjectionMatrix()
    }
  }, [camera, size])
  return null
}
function Grouped() {
  const surface = useSurfaceHandle('grouped')
  const [requested, setRequested] = useState(false)
  const [secondReady, setSecondReady] = useState(false)
  return <section>
    <h2>Two parts, one handoff</h2>
    <button id="group-toggle" onClick={() => setRequested(value => !value)}>Toggle both</button>
    <button id="group-ready" onClick={() => setSecondReady(true)}>Prepare second mesh</button>
    <Status surface={surface} group="group" />
    <Surface.Root surface={surface} canvas="composed" inScene={requested}
      onError={error => records.errors.push(error.message)}
      onPresentationChange={presentation => records.holds.push({group:'group',presentation,t:performance.now()})}>
      <div style={{display:'flex',gap:16,marginTop:12}}>
        <Surface.HTML part="first"><Content id="first" color="#1554bd"/></Surface.HTML>
        <Surface.HTML part="second"><Content id="second" color="#7d36a4"/></Surface.HTML>
      </div>
      <Surface.Scene>
        <Surface.Mesh part="first"/>
        {secondReady && <Surface.Mesh part="second"/>}
      </Surface.Scene>
    </Surface.Root>
  </section>
}

function FadeMaterial({ weight }: { weight: React.RefObject<number> }) {
  const texture = useSurfaceTexture()
  const material = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(() => { if (material.current) material.current.opacity = weight.current })
  return <meshBasicMaterial ref={material} map={texture} transparent depthWrite={false} toneMapped={false} premultipliedAlpha/>
}
function Crossfade({ from, to, bounds, finish, cancelled }: {
  from: 'a' | 'b'; to: 'a' | 'b'; bounds: React.RefObject<HTMLDivElement | null>; finish(): void; cancelled: boolean
}) {
  const outgoing = useRef(1)
  const incoming = useRef(0)
  const group = useRef<THREE.Group>(null)
  const finished = useRef(false)
  const presented = useRef(false)
  useSurfaceMotion(({position, target, dtMs, scenePresented}) => {
    presented.current = scenePresented
    records.motionCalls++
    records.motionLast = {position,target,dtMs,scenePresented}
    // Returning the renderer to the page must retain the final image of the incoming view.
    if (target === 0) return 0
    const next = scenePresented ? Math.max(0, Math.min(1, position + (cancelled ? -1 : 1) * dtMs / 650)) : 0
    incoming.current = next
    outgoing.current = 1
    records.blend = next
    return next
  })
  useFrame(() => {
    records.renderFrames++
    const box = bounds.current?.getBoundingClientRect()
    if (box && group.current) group.current.position.set(box.left + 150 - innerWidth / 2, innerHeight / 2 - box.top - 90, 0)
    if (presented.current && incoming.current === (cancelled ? 0 : 1) && !finished.current) { finished.current = true; finish() }
  })
  return <group ref={group}>
    <Surface.Mesh part={from} placement="manual" pointerEvents="none"
      geometry={<planeGeometry args={[300,180]}/>} material={<FadeMaterial weight={outgoing}/>}/>
    <Surface.Mesh part={to} placement="manual" pointerEvents="none"
      geometry={<planeGeometry args={[300,180]}/>} material={<FadeMaterial weight={incoming}/>}/>
  </group>
}
function DifferentContent() {
  const surface = useSurfaceHandle('different-content')
  const [active, setActive] = useState<'a' | 'b'>('a')
  const [requested, setRequested] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const [trip, setTrip] = useState<Trip>({ from:'a', to:'b', epoch:0 })
  const box = useRef<HTMLDivElement>(null)
  const finish = useCallback(() => { const destination = cancelled ? trip.from : trip.to; setActive(destination); records.activePage = destination; setRequested(false) }, [trip.from, trip.to, cancelled])
  return <section>
    <h2>Land on different content</h2>
    <button id="transition-toggle" disabled={requested} onClick={() => {
      setTrip({from:active,to:active === 'a' ? 'b' : 'a',epoch:trip.epoch+1})
      setCancelled(false)
      setRequested(true)
    }}>Switch view</button>
    <button id="transition-cancel" disabled={!requested} onClick={() => setCancelled(value => !value)}>{cancelled ? 'Continue transition' : 'Cancel transition'}</button>
    <Status surface={surface} group="transition" />
    <Surface.Root surface={surface} canvas="composed" inScene={requested}
      onError={error => records.errors.push(error.message)}
      onPresentationChange={presentation => records.holds.push({group:'transition',presentation,t:performance.now()})}>
      <div ref={box} style={{display:'grid',width:300,height:180,marginTop:12}}>
        <Surface.HTML part="a" hidden={active !== 'a'} size={[300,180]} pageStyle={{gridArea:'1 / 1'}}>
          <Content id="view-a" color="#226851"/>
        </Surface.HTML>
        <Surface.HTML part="b" hidden={active !== 'b'} size={[300,180]} pageStyle={{gridArea:'1 / 1'}}>
          <Content id="view-b" color="#a64049"/>
        </Surface.HTML>
      </div>
      <Surface.Scene><Crossfade key={trip.epoch} from={trip.from} to={trip.to} bounds={box} finish={finish} cancelled={cancelled}/></Surface.Scene>
    </Surface.Root>
  </section>
}

function CaptureReader({capture, name}:{capture:CaptureHandle;name:string}) {
  const frames = useCaptureFrame(capture)
  const mesh = useRef<THREE.Mesh>(null)
  const material = useRef<THREE.MeshBasicMaterial>(null)
  const frame = useRef<CaptureFrame | null>(null)
  const gl = useThree(state => state.gl)
  useFrame(() => {
    frame.current = frames.get()
    if (mesh.current) mesh.current.visible = Boolean(frame.current)
    if (material.current && material.current.map !== (frame.current?.texture ?? null)) {
      material.current.map = frame.current?.texture ?? null
      material.current.needsUpdate = true
    }
    if (!frame.current) records.samples[name] = null
  })
  return <mesh ref={mesh} visible={false} onAfterRender={() => {
    const value = frame.current
    if (!value) return
    const context = gl.getContext()
    const pixel = new Uint8Array(4)
    const size = gl.getDrawingBufferSize(new THREE.Vector2())
    context.readPixels(Math.floor(size.x * 0.85),Math.floor(size.y * 0.15),1,1,context.RGBA,context.UNSIGNED_BYTE,pixel)
    records.samples[name] = {sourceId:value.sourceId,generation:value.generation,width:value.width,height:value.height,pixel:Array.from(pixel)}
  }}><planeGeometry args={[2,2]}/><meshBasicMaterial ref={material} premultipliedAlpha toneMapped={false}/></mesh>
}
function ElementCapture() {
  const capture = useElementCapture()
  const status = useCaptureStatus(capture)
  const [version, setVersion] = useState(0)
  const [shown, setShown] = useState(false)
  const [second, setSecond] = useState(true)
  useLayoutEffect(() => { records.capture = capture }, [capture])
  return <section>
    <h2>Capture an attached element</h2>
    <button id="source-toggle" onClick={() => setShown(value => !value)}>Toggle source</button>
    <button id="source-replace" onClick={() => setVersion(value => value + 1)}>Replace source</button>
    <button id="consumer-toggle" onClick={() => setSecond(value => !value)}>Toggle second consumer</button>
    <output>{status.status} {status.reason}</output>
    {shown && <div key={version} ref={capture.ref} id="capture-original" style={{width:300,height:180,background:'rgb(36,96,192)',marginTop:12}}>
      <input aria-label="Capture source note" defaultValue={`source-${version}`} style={{margin:20}}/>
      <p data-munari-anchor="caption">Native element {version}</p>
    </div>}
    <div style={{display:'flex',gap:12,marginTop:12}}>
      <div style={{width:240,height:144}}><SurfaceCanvas id="capture-a" frameloop="demand" camera={{position:[0,0,1]}}><CaptureReader capture={capture} name="a"/></SurfaceCanvas></div>
      {second && <div style={{width:240,height:144}}><SurfaceCanvas id="capture-b" frameloop="demand" camera={{position:[0,0,1]}}><CaptureReader capture={capture} name="b"/></SurfaceCanvas></div>}
    </div>
  </section>
}
function App() {
  return <>
    <style>{'body{margin:24px;background:#f1f0eb;font:15px system-ui;color:#222}section{margin-bottom:24px}h2{font-size:18px;margin:12px 0}button{padding:6px 10px;margin-right:8px}input{min-width:0}output{margin-left:8px}'}</style>
    <h1>Explicit HTML and scene composition</h1>
    <Grouped/><SampledParts/><FrameCompanion/>
    <DifferentContent/>
    <ElementCapture/>
    <PageTargets/>
    <SurfaceCanvas id="composed" pointerMode="surfaces" frameloop="demand" style={{position:'fixed',inset:0,zIndex:10}}
      camera={{position:[0,0,1000],fov:45}}><PixelCamera/></SurfaceCanvas>
  </>
}
Object.assign(window, {__composition:{records,capture:() => records.capture ? inspectCapture(records.capture) : null}})
createRoot(document.getElementById('root')!).render(<App/>)
