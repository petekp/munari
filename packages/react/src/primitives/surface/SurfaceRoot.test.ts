// @vitest-environment happy-dom
// A scene-side declaration cannot silently name a different renderer.
import { createElement, use } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { Surface, SceneSurface } from '../Surface'
import { SurfaceRoot } from './SurfaceRoot'
import { SurfaceRootContext } from './surfaceContext'
import { SurfaceHostContext } from './surfaceHostContext'
import { createSurfaceHost, mountSurfaceHost, resetSurfaceHosts, type SurfaceHost } from './surfaceHostRegistry'

afterEach(()=>{resetSurfaceHosts();document.body.innerHTML='';vi.unstubAllGlobals()})
it('accepts a matching host and refuses a conflicting host inside the scene',()=>{
 const enclosing=createSurfaceHost('one'),container=document.createElement('div');document.body.append(container)
 const root=createRoot(container),errors:Error[]=[]
 let resolved:SurfaceHost|null=null
 function Read(){resolved=use(SurfaceRootContext)?.host??null;return null}
 const render=(canvasId:string)=>flushSync(()=>root.render(createElement(SurfaceHostContext,{value:enclosing},createElement(SurfaceRoot,{canvasId,renderIn:'none',onError:error=>errors.push(error)},createElement(Read)))))
 try {
  render('one');expect(resolved).toBe(enclosing);expect(errors).toHaveLength(0)
  render('two');expect(resolved).toBeNull();expect(errors).toHaveLength(1)
  expect(errors[0]?.message).toContain('conflicts with its enclosing')
  expect(errors[0]?.message).toContain('canvasId="two"')
 }finally{flushSync(()=>root.unmount())}
})

it.each(['Surface', 'Surface.Root', 'SceneSurface.Root'] as const)('%s selects named hosts with canvasId and still accepts an omitted ID', kind => {
 vi.stubGlobal('CanvasRenderingContext2D',undefined)
 const first=mountSurfaceHost(createSurfaceHost('one')),second=mountSurfaceHost(createSurfaceHost('two'))
 const container=document.createElement('div');document.body.append(container)
 const root=createRoot(container),errors:Error[]=[]
 let resolved:SurfaceHost|null=null,unnamed:ReturnType<typeof mountSurfaceHost>|undefined
 function Read(){resolved=use(SurfaceRootContext)?.host??null;return null}
 const render=(canvasId?:string)=>{
  const props={canvasId,children:createElement(Read),onError:(error:Error)=>errors.push(error)}
  const element=kind==='Surface'?createElement(Surface,{...props,inScene:false})
   :kind==='Surface.Root'?createElement(Surface.Root,{...props,inScene:false})
   :createElement(SceneSurface.Root,props)
  flushSync(()=>root.render(element))
 }
 try {
  render('two');expect(resolved).toBe(second.host)
  render('one');expect(resolved).toBe(first.host)
  first.release();second.release();unnamed=mountSurfaceHost(createSurfaceHost())
  render();expect(resolved).toBe(unnamed.host)
  expect(errors).toEqual([])
 }finally{flushSync(()=>root.unmount());first.release();second.release();unnamed?.release()}
})
