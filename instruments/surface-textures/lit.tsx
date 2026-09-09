// Lit alpha proof — equal lighting must preserve the source's coverage.
import {createRoot} from 'react-dom/client'
import {useState} from 'react'
import {useThree} from '@react-three/fiber'
import {SceneSurface,SurfaceCanvas,useSurfaceHandle,useSurfaceStatus} from '@petepetrash/munari'
import '@petepetrash/munari/style.css'

const statuses:Record<string,string|null>={}
interface LitPixels {
  rows:{id:string;opaque:number[];half:number[];quarter:number[]}[]
  edges:{id:string;solid:number[];edge:number[]}[]
  corner:number[]
  sharedLit:number[]
  sharedUnlit:number[]
  error:number
}
const cases=[{id:'white',rgb:'255,255,255',emissive:0},{id:'color',rgb:'100,150,220',emissive:0},{id:'glow',rgb:'100,150,220',emissive:0.4}]
function Swatch({id,x,y,alpha,rgb,emissive=0,edge=false,changed=false}:{id:string;x:number;y:number;alpha:number;rgb:string;emissive?:number;edge?:boolean;changed?:boolean}) {
  const surface=useSurfaceHandle(id)
  statuses[id]=useSurfaceStatus(surface).presentation
  const shared=id==='white-1'
  const width=shared&&changed?176:128
  return <SceneSurface.Root surface={surface}>
    <SceneSurface.HTML size={[width,64]} resolution={edge?1:undefined}><div style={{width,height:64,borderRadius:16,background:edge?`linear-gradient(to right,rgba(${rgb},${alpha}) 50%,transparent 50%)`:`rgba(${rgb},${alpha})`}}/></SceneSurface.HTML>
    <SceneSurface.Mesh name={id} placement="manual" position={[x,y,0]} alpha="source" geometry={<planeGeometry args={[128,64]}/>} material={<SceneSurface.LitMaterial emissiveIntensity={emissive}/>}/>
    {shared&&<>
      <SceneSurface.Mesh placement="manual" position={[-150,170,0]} renderOrder={changed?4:-4} alpha="source" geometry={<planeGeometry args={[128,64]}/>}/>
      <SceneSurface.Mesh placement="manual" position={[150,170,0]} alpha="source" geometry={<planeGeometry args={[128,64]}/>} material={<SceneSurface.LitMaterial/>}/>
    </>}
  </SceneSurface.Root>
}
function Observe({update}:{update:()=>void}) {
  const state=useThree()
  window.__litProof={statuses,update,read:()=>{
    state.gl.render(state.scene,state.camera)
    const gl=state.gl.getContext(),dpr=state.gl.getPixelRatio()
    const pixel=(x:number,y=0)=>{
      const p=new Uint8Array(4)
      gl.readPixels(Math.round(gl.drawingBufferWidth/2+x*dpr),Math.round(gl.drawingBufferHeight/2+y*dpr),1,1,gl.RGBA,gl.UNSIGNED_BYTE,p)
      return [...p]
    }
    return {rows:cases.map((entry,index)=>({id:entry.id,opaque:pixel(-150,90-index*90),half:pixel(0,90-index*90),quarter:pixel(150,90-index*90)})),edges:cases.map((entry,index)=>({id:entry.id,solid:pixel(-150+index*150-20,-180),edge:pixel(-150+index*150,-180)})),corner:pixel(-63,121),sharedLit:pixel(150,170),sharedUnlit:pixel(-150,170),error:gl.getError()}
  }}
  return null
}
declare global {interface Window {__litProof:{statuses:typeof statuses;update:()=>void;read:()=>LitPixels}}}
function Fixture() {
  const [changed,setChanged]=useState(false)
  const palette=cases.map(entry=>({...entry,rgb:changed?'80,190,120':entry.rgb}))
  return <SurfaceCanvas orthographic flat camera={{position:[0,0,1000],zoom:1}} style={{width:500,height:440}}>
    <ambientLight intensity={Math.PI/4}/>{palette.map((entry,row)=>[1,0.5,0.25].map((alpha,col)=><Swatch key={`${entry.id}-${alpha}`} {...entry} id={`${entry.id}-${alpha}`} x={-150+150*col} y={90-90*row} alpha={alpha} changed={changed}/>))}{palette.map((entry,col)=><Swatch key={`${entry.id}-edge`} {...entry} id={`${entry.id}-edge`} x={-150+150*col} y={-180} alpha={1} edge/>)}<Observe update={()=>setChanged(true)}/>
  </SurfaceCanvas>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
