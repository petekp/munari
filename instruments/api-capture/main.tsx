import { inspectCapture } from '@petepetrash/munari/advanced'
// Disposable integration proof: real Controls plus two hosts sharing one Capture.
import { createRoot } from 'react-dom/client'
import { useLayoutEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SurfaceCanvas, CaptureContent, useCaptureHandle, useCaptureFrame,  type CaptureHandle, type CaptureFrame } from '@petepetrash/munari'
import { ControlsApp } from '../../apps/lab/src/scenes/controls/Controls'
import '../../apps/lab/src/app.css'

interface Sample { sourceId:number;generation:number;revision:number;width:number;height:number;uuid:string;pixel:number[];anchor:CaptureFrame['anchors'][string]|undefined }
interface Records { renders:{a:number;b:number};draws:{a:number;b:number};latest:Record<string,Sample|{empty:true}>;samples:(Sample&{name:'a'|'b'})[];disposal:number }
const records:Records = { renders:{a:0,b:0}, draws:{a:0,b:0}, latest:{}, samples:[], disposal:0 }
let setSecond:(value:boolean)=>void=()=>{}
let setSource:(value:boolean)=>void=()=>{}
let setDimensions:(value:readonly[number,number])=>void=()=>{}
let replaceSource:()=>void=()=>{}
let invalidSource:()=>void=()=>{}
let source:HTMLElement
let capture:CaptureHandle
let observedTexture:THREE.Texture|null=null

function makeSource() {
  const node=document.createElement('div')
  node.style.cssText='position:relative;width:200px;height:120px;background:rgb(36,96,192);font:18px system-ui;color:white'
  node.innerHTML='<span data-munari-anchor="label" style="position:absolute;left:12px;top:8px">Frame one</span>'
  return node
}

function Reader({name,capture}:{name:'a'|'b';capture:CaptureHandle}) {
  records.renders[name]++
  const reader=useCaptureFrame(capture)
  const mesh=useRef<THREE.Mesh>(null)
  const material=useRef<THREE.MeshBasicMaterial>(null)
  const current=useRef<CaptureFrame|null>(null)
  const renderer=useThree(state=>state.gl)
  useFrame(()=>{
    const frame=reader.get();current.current=frame
    if(mesh.current)mesh.current.visible=frame!==null
    if(material.current&&material.current.map!==(frame?.texture??null)){
      material.current.map=frame?.texture??null;material.current.needsUpdate=true
    }
    if(!frame)records.latest[name]={empty:true}
    if(frame&&observedTexture!==frame.texture){observedTexture=frame.texture;frame.texture.addEventListener('dispose',()=>records.disposal++)}
  })
  return <mesh ref={mesh} visible={false} onAfterRender={()=>{
    const frame=current.current;if(!frame)return
    const pixels=new Uint8Array(4),gl=renderer.getContext(),size=renderer.getDrawingBufferSize(new THREE.Vector2())
    gl.readPixels(Math.floor(size.x/2),Math.floor(size.y/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels)
    records.draws[name]++
    const entry={sourceId:frame.sourceId,generation:frame.generation,revision:frame.revision,width:frame.width,height:frame.height,uuid:frame.texture.uuid,pixel:Array.from(pixels),anchor:frame.anchors.label}
    records.latest[name]=entry;records.samples.push({name,...entry});if(records.samples.length>1000)records.samples.shift()
  }}><planeGeometry args={[2,2]}/><meshBasicMaterial ref={material} toneMapped={false} premultipliedAlpha/></mesh>
}

function App() {
  const handle=useCaptureHandle()
  const [root,changeRoot]=useState(makeSource)
  const [dimensions,changeDimensions]=useState<readonly[number,number]>([200,120])
  const [second,changeSecond]=useState(true)
  const [mounted,changeMounted]=useState(true)
  useLayoutEffect(()=>{capture=handle;source=root;setSecond=changeSecond;setSource=changeMounted;setDimensions=changeDimensions;replaceSource=()=>{changeRoot(makeSource);changeDimensions([200,120])};invalidSource=()=>{const node=makeSource();node.id='parented-source';document.body.append(node);changeRoot(node)}},[handle,root])
  return <>
    <ControlsApp/>
    {mounted&&<CaptureContent capture={handle} element={root} size={dimensions}/>}
    <div style={{position:'fixed',left:16,bottom:12,zIndex:20000,display:'flex',gap:12,pointerEvents:'none'}}>
      <div style={{width:160,height:100,background:'#ddd'}}><SurfaceCanvas id="proof-a" frameloop="demand" camera={{position:[0,0,2]}}><Reader name="a" capture={handle}/></SurfaceCanvas></div>
      {second&&<div style={{width:160,height:100,background:'#ddd'}}><SurfaceCanvas id="proof-b" frameloop="demand" camera={{position:[0,0,2]}}><Reader name="b" capture={handle}/></SurfaceCanvas></div>}
    </div>
  </>
}

Object.assign(window,{__captureProbe:{
  records,
  read:()=>{const d=inspectCapture(capture);return {...records,status:d.status,consumers:d.consumers,frame:d.frame&&{sourceId:d.frame.sourceId,generation:d.frame.generation,revision:d.frame.revision,width:d.frame.width,height:d.frame.height,uuid:d.frame.texture.uuid}}},
  paint:(color:string,text:string)=>{source.style.background=color;source.querySelector('span')!.textContent=text},
  resize:(w:number,h:number)=>{source.style.width=`${w}px`;source.style.height=`${h}px`;source.querySelector<HTMLElement>('span')!.style.left='24px';setDimensions([w,h])},
  showSecond:(value:boolean)=>setSecond(value),showSource:(value:boolean)=>setSource(value),replace:()=>replaceSource(),invalid:()=>invalidSource(),
}})
// SAFETY: this optional property is owned only by this instrument's entry module.
const page = window as Window & { __integrationRoot?: ReturnType<typeof createRoot> }
page.__integrationRoot?.unmount()
page.__integrationRoot = createRoot(document.getElementById('root')!)
page.__integrationRoot.render(<App />)
