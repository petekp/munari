// One live form through page and scene ownership, including inset canvas placement.
// The counter and fields own their state below Surface; a duplicate React mount fails this fixture.
import { createRoot } from 'react-dom/client'
import { StrictMode, useEffect, useState } from 'react'
import { SurfaceCanvas, Surface, useSurfaceHandle, useSurfaceStatus } from '@petepetrash/munari'
import '@petepetrash/munari/style.css'

interface Proof { mounts:number;unmounts:number;state:ReturnType<typeof useSurfaceStatus>|null;request:(value:boolean)=>void;host:(value:boolean)=>void;errors:string[] }
const proof:Proof={mounts:0,unmounts:0,state:null,request:()=>{},host:()=>{},errors:[]}
const query=new URLSearchParams(location.search)
const layout=query.get('layout') ?? 'fullscreen'
const orthographic=query.get('camera') === 'orthographic'
function Content() {
  const [count,setCount]=useState(0)
  const [value,setValue]=useState('controlled')
  useEffect(()=>{proof.mounts++;return()=>{proof.unmounts++}},[])
  return <form data-form style={{boxSizing:'border-box',width:440,height:280,display:'grid',gap:12,padding:20,background:'#147ccc',color:'white'}} onSubmit={event=>event.preventDefault()}>
    <button id="counter" data-counter type="button" onClick={()=>setCount(n=>n+1)}>Count {count}</button>
    <label>Controlled <input id="controlled" value={value} onChange={event=>setValue(event.target.value)}/></label>
    <label>Uncontrolled <input id="uncontrolled" defaultValue="uncontrolled"/></label>
    <div id="editable" contentEditable suppressContentEditableWarning>editable</div>
    <label><input id="choice-a" type="radio" name="choice" defaultChecked/> A</label>
    <label><input id="choice-b" type="radio" name="choice"/> B</label>
  </form>
}
function App() {
  const handle=useSurfaceHandle('stateful-content')
  const [selected,setSelected]=useState(false)
  const [host,setHost]=useState(!query.has('lateHost'))
  proof.host=setHost
  const [narrow,setNarrow]=useState(false)
  const [shifted,setShifted]=useState(false)
  proof.state=useSurfaceStatus(handle)
  proof.request=setSelected
  return <main style={{padding:24,fontFamily:'system-ui'}}>
    <h1>One stateful component</h1>
    <div style={{display:'flex',gap:12,marginBottom:20}}>
      <button id="toggle" onClick={()=>setSelected(value=>!value)}>Toggle scene</button>
      <button id="resize" onClick={()=>setNarrow(value=>!value)}>Resize canvas</button>
      <button id="move" onClick={()=>setShifted(value=>!value)}>Move slot</button>
    </div>
    <div id="scroller" style={{height:650,overflow:'auto',width:'100%'}}>
      <div style={{height:80}} />
      <div id="stage" style={{position:'relative',width:narrow?560:680,height:460,transform:layout==='scaled'?'scale(1.2, 0.85)':undefined,transformOrigin:'top left'}}>
        {host&&<SurfaceCanvas id="stateful" flat pointerMode="surfaces" frameloop="demand"
          orthographic={orthographic} camera={{position:[0,0,5],near:0.1,far:100}}
          style={{position:layout==='fullscreen'?'fixed':'absolute',inset:0,zIndex:5}}
          onCreated={state=>Object.assign(window,{__statefulRenderer:state})}/>}
        <div style={{height:shifted?110:40}} />
        <div id="slot" style={{marginLeft:24,width:440}}>
          <Surface surface={handle} canvas="stateful" inScene={selected} onError={error=>proof.errors.push(error.message)}><Content/></Surface>
        </div>
      </div>
      <div style={{height:500}} />
    </div>
  </main>
}
Object.assign(window,{__stateful:proof})
createRoot(document.getElementById('root')!).render(query.has('strict')?<StrictMode><App/></StrictMode>:<App/>)
