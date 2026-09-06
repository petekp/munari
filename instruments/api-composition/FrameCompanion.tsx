// A later pose writer deliberately defeats an independent useFrame follower.
// The Surface callback must place the companion before its earlier draw order runs.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { WebGLRenderTarget, type Mesh } from 'three'
import { Surface, useSurfaceBeforeRender } from '@petepetrash/munari'

interface CompanionRecord {frames:number;mismatches:number;naiveMismatches:number;expected:number;naive:number;callbacks:number;drawX:number;maxPoseShiftPixels:number;passes:{camera:string;target:string|null}[];matrixSamples:number[];nodeCount:number}
const record: CompanionRecord = { frames: 0, mismatches: 0, naiveMismatches: 0, expected: 0, naive: 0, callbacks: 0, drawX:0, maxPoseShiftPixels:0, passes: [], matrixSamples: [], nodeCount:0 }
function Follow({ companion }: { companion: React.RefObject<Mesh | null> }) {
  useFrame(() => { record.naive = record.expected })
  useSurfaceBeforeRender(frame => {
    record.callbacks++
    record.drawX=frame.mesh.matrixWorld.elements[12]!
    const raw=frame.mesh.position.clone().applyMatrix4(frame.mesh.parent!.matrixWorld).project(frame.camera)
    const shown=frame.mesh.position.clone().set(0,0,0).applyMatrix4(frame.mesh.matrixWorld).project(frame.camera)
    const width=frame.renderTarget?.width??frame.canvas.width,height=frame.renderTarget?.height??frame.canvas.height
    record.maxPoseShiftPixels=Math.max(record.maxPoseShiftPixels,Math.hypot((raw.x-shown.x)*width/2,(raw.y-shown.y)*height/2))
    record.passes.push({camera:frame.camera.uuid,target:frame.renderTarget?.texture.uuid??null})
    if (companion.current) companion.current.position.x = frame.mesh.matrixWorld.elements[12]!
  })
  return null
}
function LatePose({ mesh }: { mesh: React.RefObject<Mesh | null> }) {
  const invalidate = useThree(root => root.invalidate)
  useFrame(() => {
    record.expected = record.expected === 40 ? 80 : 40
    if (mesh.current) mesh.current.position.x = record.expected
    invalidate()
  })
  return null
}
function RenderPasses() {
  const {gl,scene,camera} = useThree()
  const target = useMemo(()=>new WebGLRenderTarget(320,240),[])
  const secondCamera = useMemo(()=>camera.clone(),[camera])
  useEffect(()=>{
    const update = scene.updateMatrixWorld
    scene.updateMatrixWorld = function(force) {
      const start = performance.now()
      update.call(this,force)
      record.matrixSamples.push(performance.now()-start)
    }
    record.nodeCount=0;scene.traverse(()=>record.nodeCount++)
    return()=>{scene.updateMatrixWorld=update;target.dispose()}
  },[scene,target])
  useFrame(()=>{
    gl.setRenderTarget(target);gl.render(scene,secondCamera)
    gl.setRenderTarget(null);gl.render(scene,camera)
  },1)
  return null
}

function Pair() {
  const primary = useRef<Mesh>(null)
  const companion = useRef<Mesh>(null)
  return <>
    <Surface.Mesh ref={primary} placement="manual" pointerEvents="none" position={[40, 0, 0]} geometry={<planeGeometry args={[80, 40]} />}>
      <Follow companion={companion} />
    </Surface.Mesh>
    <mesh ref={companion} renderOrder={-1} position={[0, -50, 0]} onBeforeRender={() => {
      record.frames++
      if (companion.current?.matrixWorld.elements[12] !== record.drawX) record.mismatches++
      if (record.naive !== record.expected) record.naiveMismatches++
    }}>
      <planeGeometry args={[80, 20]} />
      <meshBasicMaterial color="blue" />
    </mesh>
    <LatePose mesh={primary} />
    <RenderPasses/>
    {Array.from({length:Number(new URLSearchParams(location.search).get('nodes')??0)},(_,index)=><group key={`matrix-${index}`}/>)}
  </>
}
export function FrameCompanion() {
  const [inScene, setInScene] = useState(false)
  return <section>
    <h2>Companion frame order</h2>
    <button id="companion-toggle" onClick={() => setInScene(value => !value)}>Toggle moving pair</button>
    <Surface.Root canvas="composed" inScene={inScene} timing={{settleMs:0,durationMs:1}}>
      <Surface.HTML><div style={{width:80,height:40,background:'red'}}>Pose</div></Surface.HTML>
      <Surface.Scene><Pair /></Surface.Scene>
    </Surface.Root>
  </section>
}
Object.assign(window, { __frameCompanion: record })
