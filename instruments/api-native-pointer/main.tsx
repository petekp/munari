// One retained form, two differently positioned scene presenters, and real browser input.
import { createRoot } from 'react-dom/client'
import { useRef, useState } from 'react'
import { useThree, type RootState } from '@react-three/fiber'
import { SphereGeometry, type Mesh } from 'three'
import { Surface, SceneSurface, SurfaceCanvas, useSurfaceHandle, useSurfaceStatus } from '@petepetrash/munari'
import '@petepetrash/munari/style.css'

const events: { target: string; trusted: boolean; x: number; y: number }[] = []
function Form({swapped}:{swapped:boolean}) {
  const [count, setCount] = useState(0)
  return <form data-form data-swapped={swapped} style={{boxSizing:'border-box',width:320,height:200,padding:20,background:'#dceafb'}} onSubmit={event=>event.preventDefault()}>
    <button data-click="left" style={{width:130,height:48}} onClick={event=>{setCount(value=>value+1);events.push({target:'left',trusted:event.nativeEvent.isTrusted,x:event.clientX,y:event.clientY})}}>Count {count}</button>
    <button data-click="right" style={{width:130,height:48}} onClick={event=>events.push({target:'right',trusted:event.nativeEvent.isTrusted,x:event.clientX,y:event.clientY})}>Right</button>
    <input data-field defaultValue="Retained" style={{display:'block',marginTop:24,width:260,height:32}}/>
  </form>
}
function Presenters({second,disabled}:{second:boolean;disabled:boolean}) {
  const first = useRef<Mesh>(null), other = useRef<Mesh>(null)
  const renderer = useThree()
  Object.assign(window,{__pointerMeshes:{first,other,renderer}})
  return <>
    <Surface.Mesh ref={first} placement="manual" rotation={[0,0.5,0.35]} position={[-200,0,0]} scale={[320,200,1]} pointerRoute="auto" pointerEvents={disabled?'none':'geometry'}/>
    {second&&<Surface.Mesh ref={other} placement="manual" position={[200,40,0]} scale={[320,200,1]} pointerRoute="relay"/>}
  </>
}
function App() {
  const handle=useSurfaceHandle('shared-pointer-source')
  const [inScene,setInScene]=useState(false),[second,setSecond]=useState(false),[disabled,setDisabled]=useState(false),[swapped,setSwapped]=useState(false)
  const status=useSurfaceStatus(handle)
  Object.assign(window,{__pointerProof:{status,events,setInScene,setSecond,setDisabled,setSwapped,replaceGeometry:()=>{
    const mesh=window.__pointerMeshes?.first.current
    if(mesh) { mesh.geometry=new SphereGeometry(0.5); window.__pointerMeshes?.renderer.invalidate() }
  }}})
  return <main style={{padding:30,fontFamily:'system-ui'}}>
    <h1>Shared-source pointer ownership</h1>
    <SurfaceCanvas id="pointer" orthographic camera={{position:[0,0,1000],zoom:1,near:0.1,far:2000}} frameloop="demand" flat pointerMode="surfaces" style={{position:'fixed',inset:0,zIndex:4}}>
      <group name="scene-label-aspect" position={[280,250,0]} scale={80}>
        <SceneSurface size={[240,80]}><div data-scene-label style={{width:240,height:80,background:'#cf5f22'}}>Scene label</div></SceneSurface>
      </group>
    </SurfaceCanvas>
    <Surface.Root surface={handle} canvas="pointer" inScene={inScene} timing={{settleMs:0,durationMs:1}}>
      <Surface.HTML key={swapped?'replacement':'original'}><Form swapped={swapped}/></Surface.HTML>
      <Surface.Scene><Presenters second={second} disabled={disabled}/></Surface.Scene>
    </Surface.Root>
  </main>
}
declare global { interface Window {
  __pointerMeshes?: {first:React.RefObject<Mesh|null>;other:React.RefObject<Mesh|null>;renderer:RootState}
}}
createRoot(document.getElementById('root')!).render(<App/> )
