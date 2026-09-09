// PR #83 regressions — keyed targets, shared readers, resizing and page preparation.
// Each fixture uses the published API; the runner checks pixels and retained state.
import {createRoot} from 'react-dom/client'
import {memo,useEffect,useLayoutEffect,useRef,useState} from 'react'
import {useFrame,useThree} from '@react-three/fiber'
import {Vector2,type MeshBasicMaterial} from 'three'
import {Surface,SceneSurface,SurfaceCanvas,CaptureContent,createPageTarget,useCaptureHandle,useCaptureFrame,useSurfaceHandle,useSurfaceStatus,useSurfaceAnchorRects,useSurfacePaintedSize,type CaptureHandle,type PageTarget,type SourceUvRect,type SurfaceStatus} from '@petepetrash/munari'
import {inspectCapture} from '@petepetrash/munari/advanced'
import '@petepetrash/munari/style.css'

type RowId='a'|'b'
interface RegressionProbe {
  errors:string[]
  frames:{a:number;b:number}
  revisions:{a:number|null;b:number|null}
  pixels:{a:number[];b:number[]}
  mounts:{a:number;b:number}
  status:SurfaceStatus|null
  width:number
  anchor:SourceUvRect|null
  painted:()=>readonly[number,number]
  capture:()=>{consumers:number;revision:number|null}
  prepend:()=>void
  reorder:()=>void
  remove:()=>void
  request:(value:boolean)=>void
  swap:()=>void
  setWidth:(value:number)=>void
  setClipHeight:(value:number)=>void
  setAttribute:(value:string)=>void
  paint:()=>void
  wake:()=>void
  insideClicks:number
  outsideClicks:number
  activeHandle:RowId
}
const probe:RegressionProbe={errors:[],frames:{a:0,b:0},revisions:{a:null,b:null},pixels:{a:[],b:[]},mounts:{a:0,b:0},status:null,width:200,anchor:null,painted:()=>[0,0],capture:()=>({consumers:0,revision:null}),prepend:()=>{},reorder:()=>{},remove:()=>{},request:()=>{},swap:()=>{},setWidth:()=>{},setClipHeight:()=>{},setAttribute:()=>{},paint:()=>{},wake:()=>{},insideClicks:0,outsideClicks:0,activeHandle:'a'}
declare global {interface Window {__apiRegression:RegressionProbe}}
window.__apiRegression=probe

const TargetRow=memo(function TargetRow({id,target}:{id:RowId;target:PageTarget}){
  const [count,setCount]=useState(0)
  useEffect(()=>{probe.mounts[id]++},[id])
  return <Surface.Root inScene={false}><Surface.HTML target={target}><button type="button" data-item={id} onClick={()=>setCount(value=>value+1)}>Count {count}</button></Surface.HTML></Surface.Root>
})
function Targets({reordered=false}:{reordered?:boolean}){
  const [targets]=useState(()=>({a:createPageTarget(),b:createPageTarget()}))
  const [items,setItems]=useState<RowId[]>(reordered?['a','b']:['a'])
  probe.prepend=()=>setItems(['b','a']);probe.reorder=()=>setItems(reordered?['b','a']:['a','b']);probe.remove=()=>setItems(['b'])
  return <main><section id="target-a" ref={targets.a.ref}/><section id="target-b" ref={targets.b.ref}/><div id="target-homes">{items.map(id=><TargetRow key={id} id={id} target={targets[id]}/>)}</div></main>
}

function CaptureReader({capture,id}:{capture:CaptureHandle;id:RowId}){
  const read=useCaptureFrame(capture),renderer=useThree(state=>state.gl),invalidate=useThree(state=>state.invalidate)
  const material=useRef<MeshBasicMaterial>(null),[size]=useState(()=>new Vector2()),[pixel]=useState(()=>new Uint8Array(4))
  probe.wake=invalidate
  useFrame(()=>{
    probe.frames[id]++;const frame=read.get();probe.revisions[id]=frame?.revision??null
    if(material.current&&material.current.map!==(frame?.texture??null)){material.current.map=frame?.texture??null;material.current.needsUpdate=true}
  })
  return <mesh position={[id==='a'?-110:110,0,0]} onAfterRender={()=>{
    renderer.getDrawingBufferSize(size)
    const context=renderer.getContext(),x=size.x/2+(id==='a'?-110:110)*renderer.getPixelRatio()
    context.readPixels(Math.round(x),Math.round(size.y/2),1,1,context.RGBA,context.UNSIGNED_BYTE,pixel)
    probe.pixels[id]=[...pixel]
  }}><planeGeometry args={[200,100]}/><meshBasicMaterial ref={material} toneMapped={false} premultipliedAlpha/></mesh>
}
function Capture(){
  const capture=useCaptureHandle(),[first,setFirst]=useState(true)
  probe.remove=()=>setFirst(false)
  probe.capture=()=>{const value=inspectCapture(capture);return {consumers:value.consumers,revision:value.frame?.revision??null}}
  probe.paint=()=>{const element=document.getElementById('reader-source')!;element.style.background='rgb(20,70,230)';element.textContent='Updated capture'}
  return <><CaptureContent capture={capture} size={[200,100]}><div id="reader-source" style={{width:200,height:100,background:'rgb(230,20,20)'}}>Shared capture</div></CaptureContent><SurfaceCanvas orthographic camera={{position:[0,0,1000],zoom:1}} frameloop="demand" flat style={{height:400}}>{first&&<CaptureReader id="a" capture={capture}/>}<CaptureReader id="b" capture={capture}/></SurfaceCanvas></>
}

const ANCHORS=['edge'] as const
function AnchorRead(){
  const anchors=useSurfaceAnchorRects(ANCHORS),painted=useSurfacePaintedSize()
  useLayoutEffect(()=>{probe.anchor=anchors?.edge??null;probe.painted=painted},[anchors,painted])
  return null
}
function Resize(){
  const surface=useSurfaceHandle('resize-regression'),[width,setWidth]=useState(200)
  probe.status=useSurfaceStatus(surface);probe.width=width;probe.setWidth=setWidth
  return <SurfaceCanvas orthographic camera={{position:[0,0,1000],zoom:1}} frameloop="always" flat style={{height:400}}><SceneSurface.Root surface={surface}><SceneSurface.HTML size={[width,100]}><div id="resize-source" style={{width,height:100,position:'relative',background:'white'}}><div data-munari-anchor="edge" style={{position:'absolute',left:width-30,top:20,width:10,height:10,background:'red'}}/></div></SceneSurface.HTML><SceneSurface.Mesh placement="manual" geometry={<planeGeometry args={[width,100]}/>}><AnchorRead/></SceneSurface.Mesh></SceneSurface.Root></SurfaceCanvas>
}

function Focus(){
  const a=useSurfaceHandle('focus-a'),b=useSurfaceHandle('focus-b'),[changed,setChanged]=useState(false),[inScene,setInScene]=useState(false),surface=changed?b:a
  probe.status=useSurfaceStatus(surface);probe.request=setInScene;probe.swap=()=>setChanged(true);probe.activeHandle=changed?'b':'a'
  return <><SurfaceCanvas id="focus" pointerMode="surfaces" frameloop="demand" flat style={{position:'fixed',inset:0}}/><Surface.Root surface={surface} canvasId="focus" inScene={inScene} timing={{settleMs:0,durationMs:1}}><Surface.HTML><form style={{margin:40,width:300,height:150,background:'white'}}><label>Retained field <input id="focus-input" defaultValue="preserved focus"/></label></form></Surface.HTML><Surface.Mesh/></Surface.Root></>
}

function Clipping({nested,rounded,scaled,margin,border,longhand,preserve}:{nested?:boolean;rounded?:boolean;scaled?:boolean;margin?:boolean;border?:boolean;longhand?:boolean;preserve?:boolean}){
  const surface=useSurfaceHandle('clipping-regression'),[inScene,setInScene]=useState(false),[height,setHeight]=useState(180)
  probe.status=useSurfaceStatus(surface);probe.request=setInScene;probe.setClipHeight=setHeight
  return <><SurfaceCanvas id="clip-canvas" frameloop="demand" pointerMode="surfaces" flat style={{position:'fixed',inset:0}}/><div id="clip-outer" style={{position:'relative',overflow:margin?'clip':'hidden',overflowClipMargin:margin?'20px':undefined,margin:40,width:320,height,background:'white',border:border?'8px solid black':undefined,padding:border?8:0,borderRadius:rounded?28:0,transform:scaled?'scale(1.2,0.85)':undefined,scale:longhand?'1.2 0.85':undefined,transformStyle:preserve?'preserve-3d':undefined,transformOrigin:'top left'}}><div id="clip-inner" style={{position:'relative',marginLeft:nested?30:0,width:nested?210:320,height:300,overflow:nested?'hidden':'visible',borderRadius:rounded&&nested?18:0}}><div style={{height:110}}/><Surface.Root surface={surface} canvasId="clip-canvas" inScene={inScene} timing={{settleMs:2000,durationMs:1}}><Surface.HTML><div id="clipped-source" style={{position:'relative',width:300,height:160,background:'rgb(230,20,20)'}}><button id="clip-inside" type="button" style={{position:'absolute',left:40,top:12}} onClick={()=>probe.insideClicks++}>Inside</button><button id="clip-outside" type="button" style={{position:'absolute',left:30,top:120}} onClick={()=>probe.outsideClicks++}>Outside</button></div></Surface.HTML><Surface.Mesh pointerRoute="auto"/></Surface.Root></div></div></>
}

function Attribute(){
  const surface=useSurfaceHandle(),[name,setName]=useState('onboarding')
  probe.status=useSurfaceStatus(surface);probe.setAttribute=setName
  const html=name==='onclick'?'<button onclick="void 0">Inline handler</button>':`<div ${name}="hello">Ordinary attribute</div>`
  return <><SurfaceCanvas id="attributes" pointerMode="surfaces" frameloop="demand" flat style={{position:'fixed',inset:0}}/><Surface.Root surface={surface} canvasId="attributes" inScene={true} timing={{settleMs:0,durationMs:1}}><Surface.HTML><div style={{width:240,height:100}} dangerouslySetInnerHTML={{__html:html}}/></Surface.HTML><Surface.Mesh/></Surface.Root></>
}
const scenario=new URLSearchParams(location.search).get('case')
function Fixture(){
  switch(scenario){
    case 'targets':return <Targets/>
    case 'reorder':return <Targets reordered/>
    case 'capture':return <Capture/>
    case 'resize':return <Resize/>
    case 'focus':return <Focus/>
    case 'clip':case 'clip-dynamic':return <Clipping/>
    case 'clip-nested':return <Clipping nested/>
    case 'clip-rounded':return <Clipping rounded/>
    case 'clip-scaled':return <Clipping nested rounded scaled/>
    case 'clip-border':return <Clipping rounded border/>
    case 'clip-margin':return <Clipping margin/>
    case 'clip-longhand':return <Clipping nested rounded longhand/>
    case 'clip-preserve':return <Clipping rounded preserve/>
    case 'attribute':return <Attribute/>
    default:throw new Error('Unknown API regression case')
  }
}
createRoot(document.getElementById('root')!,{onUncaughtError:error=>probe.errors.push(String(error))}).render(<Fixture/>)
