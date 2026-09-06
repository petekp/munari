// Disposable browser probe: one portal container moved between page and capture.
import { createPortal, flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

interface InstanceLog { mounts:number;unmounts:number;paints:number;events:{trusted:boolean;count:number}[] }
interface TrialCanvas extends HTMLCanvasElement { requestPaint():void }
interface TrialContext extends CanvasRenderingContext2D { drawElementImage(element:Element,x:number,y:number):void }
const log:InstanceLog = { mounts: 0, unmounts: 0, paints: 0, events: [] }
let originalButton: HTMLElement | null = null
let originalInput: HTMLElement | null = null
let changeMode: (value: boolean) => void = () => {}

function Content() {
  const [count, setCount] = useState(0)
  const [controlled, setControlled] = useState('controlled')
  useEffect(() => { log.mounts++; return () => { log.unmounts++ } }, [])
  return <div className="card">
    <button id="counter" onClick={event => { log.events.push({ trusted: event.nativeEvent.isTrusted, count }); setCount(n => n + 1) }}>Count {count}</button>
    <label>Controlled <input id="controlled" value={controlled} onChange={event => setControlled(event.target.value)} /></label>
    <label>Uncontrolled <input id="uncontrolled" defaultValue="uncontrolled" /></label>
    <div id="editable" contentEditable suppressContentEditableWarning>editable text</div>
  </div>
}

function App() {
  const [container] = useState(() => document.createElement('div'))
  const page = useRef<HTMLDivElement>(null)
  const canvas = useRef<TrialCanvas>(null)
  const [capturing, setCapturing] = useState(false)
  useLayoutEffect(() => {
    const holder = page.current
    const target = canvas.current
    if (!holder || !target) return
    container.id = 'live-content'
    holder.append(container)
    Object.assign(target, { layoutSubtree: true })
    // SAFETY: the probe only requests capture when Chrome exposes drawElementImage.
    const ctx = target.getContext('2d') as TrialContext | null
    Object.assign(target, { onpaint: () => {
      if (container.parentElement !== target || !ctx) return
      ctx.clearRect(0, 0, 440, 210)
      // Prototype-only access to Chrome's experimental API.
      ctx.drawElementImage(container, 0, 0)
      log.paints++
    } })
    changeMode = value => flushSync(() => setCapturing(value && 'drawElementImage' in CanvasRenderingContext2D.prototype))
    return () => { changeMode = () => {} }
  }, [container])
  useLayoutEffect(() => {
    const holder = page.current
    const target = canvas.current
    if (!holder || !target) return
    if (capturing) {
      // SAFETY: container is an HTMLElement, and cloneNode preserves its element type.
      const placeholder = container.cloneNode(true) as HTMLElement
      placeholder.id = 'placeholder'
      placeholder.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'))
      holder.append(placeholder)
      target.moveBefore(container, null)
      target.requestPaint()
    } else {
      holder.moveBefore(container, null)
      holder.querySelector('#placeholder')?.remove()
    }
  }, [capturing, container])
  return <main>
    <h1>Single React instance: page ↔ capture</h1>
    <p id="mode">{capturing ? 'capture' : 'page'}</p>
    <div className="columns"><section><h2>Page</h2><div ref={page} className="holder" /></section><section><h2>Capture</h2><canvas ref={canvas} width={440} height={210} /></section></div>
    {createPortal(<Content />, container)}
  </main>
}

const style = document.createElement('style')
style.textContent = 'body{font:16px system-ui;background:#f2eee7;color:#171717;margin:30px}h1{font-size:24px}.columns{display:flex;gap:40px}.holder,canvas{width:440px;height:210px}.card{box-sizing:border-box;width:440px;height:210px;padding:20px;background:#147ccc;color:white;display:grid;gap:8px}button,input{font:inherit}button{width:130px}label{display:flex;justify-content:space-between}#editable{background:#fff3;padding:5px}'
document.head.append(style)
createRoot(document.getElementById('root')!).render(<App />)
function input(id:string) { const element=document.getElementById(id);return element instanceof HTMLInputElement?element:null }
Object.assign(window, { __instanceProbe: {
  log,
  setCapture: (value: boolean) => changeMode(value),
  remember: () => { originalButton = document.getElementById('counter'); originalInput = document.getElementById('uncontrolled') },
  read: () => ({
    ...log, mode: document.getElementById('mode')?.textContent,
    count: document.getElementById('counter')?.textContent,
    controlled: input('controlled')?.value,
    uncontrolled: input('uncontrolled')?.value,
    editable: document.getElementById('editable')?.textContent,
    active: document.activeElement?.id,
    selection: [input('uncontrolled')?.selectionStart, input('uncontrolled')?.selectionEnd],
    sameButton: originalButton === document.getElementById('counter'), sameInput: originalInput === document.getElementById('uncontrolled'),
  }),
} })
