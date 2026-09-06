import { inspectCapture } from '@petepetrash/munari/advanced'
// Whole-document capture uses an explicit source and excludes its own preview.
import { createRoot } from 'react-dom/client'
import { useLayoutEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  SurfaceCanvas, useElementCapture, useCaptureFrame, useCaptureStatus,
   type CaptureHandle, type CaptureFrame,
} from '@petepetrash/munari'
interface WholeRecord {
  kind: 'html' | 'body'
  count: number
  capture: CaptureHandle | null
  sample: {width:number;height:number;sourceId:number;top:number[];bottom:number[]} | null
}
const record: WholeRecord = {kind:'html',count:0,capture:null,sample:null}
function Preview({ capture }: { capture: CaptureHandle }) {
  const frames = useCaptureFrame(capture)
  const mesh = useRef<THREE.Mesh>(null)
  const material = useRef<THREE.MeshBasicMaterial>(null)
  const current = useRef<CaptureFrame | null>(null)
  const gl = useThree(state => state.gl)
  const viewport = useThree(state => state.viewport)
  useFrame(() => {
    current.current = frames.get()
    if (mesh.current) mesh.current.visible = Boolean(current.current)
    if (material.current && material.current.map !== (current.current?.texture ?? null)) {
      material.current.map = current.current?.texture ?? null
      material.current.needsUpdate = true
    }
  })
  return <mesh ref={mesh} visible={false} scale={[viewport.width / 2, viewport.height / 2, 1]} onAfterRender={() => {
    const frame = current.current
    if (!frame) return
    const context = gl.getContext()
    const size = gl.getDrawingBufferSize(new THREE.Vector2())
    const top = new Uint8Array(4), bottom = new Uint8Array(4)
    context.readPixels(Math.floor(size.x * 0.9), Math.floor(size.y * 0.9), 1, 1, context.RGBA, context.UNSIGNED_BYTE, top)
    context.readPixels(Math.floor(size.x * 0.9), Math.floor(size.y * 0.1), 1, 1, context.RGBA, context.UNSIGNED_BYTE, bottom)
    record.sample = {width:frame.width,height:frame.height,sourceId:frame.sourceId,top:Array.from(top),bottom:Array.from(bottom)}
  }}><planeGeometry args={[2,2]}/><meshBasicMaterial ref={material} premultipliedAlpha toneMapped={false}/></mesh>
}
function App() {
  const [kind, setKind] = useState<'html' | 'body'>('html')
  const [count, setCount] = useState(0)
  const capture = useElementCapture({exclude:'.capture-preview'})
  const status = useCaptureStatus(capture)
  useLayoutEffect(() => {
    capture.ref(kind === 'html' ? document.documentElement : document.body)
    record.capture = capture
    record.kind = kind
    return () => capture.ref(null)
  }, [capture, kind])
  useLayoutEffect(() => { record.count = count }, [count])
  return <>
    <style>{'body{margin:0;font:20px system-ui;color:white}section{height:900px;box-sizing:border-box;padding:32px}button,input{font:inherit}'}</style>
    <section style={{background:'rgb(36,96,192)'}}>
      <h1>The source stays native</h1>
      <input aria-label="Page note" id="native-note" defaultValue="Editable original"/>
      <button id="increment" onClick={() => setCount(value => value + 1)}>Count {count}</button>
    </section>
    <section style={{background:'rgb(180,40,80)'}}><h2>Content below the viewport</h2></section>
    <aside className="capture-preview" style={{position:'fixed',right:20,top:20,width:240,background:'#222',padding:12}}>
      <button id="target-kind" onClick={() => setKind(value => value === 'html' ? 'body' : 'html')}>Capture {kind === 'html' ? 'body' : 'html'}</button>
      <p>{kind}: {status.status} {status.reason}</p>
      <div style={{width:240,height:400}}><SurfaceCanvas id="whole-preview" frameloop="demand" camera={{position:[0,0,1]}}><Preview capture={capture}/></SurfaceCanvas></div>
    </aside>
  </>
}
Object.assign(window, {__wholeCapture:{record,read:()=>record.capture ? inspectCapture(record.capture) : null}})
createRoot(document.getElementById('root')!).render(<App/>)
