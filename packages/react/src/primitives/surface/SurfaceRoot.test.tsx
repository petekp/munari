// @vitest-environment happy-dom
// A scene-side declaration cannot silently name a different renderer.
import { Fragment, StrictMode, createElement, use } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { Surface, SceneSurface } from '../Surface'
import { SurfaceRoot } from './SurfaceRoot'
import { createSurfaceStore, type SurfaceStore } from './surfaceHandle'
import { SurfaceRootContext } from './surfaceContext'
import { SurfaceHostContext } from './surfaceHostContext'
import { createSurfaceHost, mountSurfaceHost, resetSurfaceHosts, type SurfaceHost } from './surfaceHostRegistry'

afterEach(()=>{resetSurfaceHosts();document.body.innerHTML='';vi.unstubAllGlobals()})
it('accepts a matching host and refuses a conflicting host inside the scene',()=>{
 const enclosing=createSurfaceHost('one'),container=document.createElement('div');document.body.append(container)
 const root=createRoot(container),errors:Error[]=[]
 let resolved:SurfaceHost|null=null
 function Read(){resolved=use(SurfaceRootContext)?.host??null;return null}
 const render=(canvasId:string)=>flushSync(()=>root.render(createElement(SurfaceHostContext,{value:enclosing},createElement(SurfaceRoot,{canvasId,onError:error=>errors.push(error)},createElement(Read)))))
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

function liveHost() {
  class WithTrial { drawElementImage() {} }
  vi.stubGlobal('CanvasRenderingContext2D', WithTrial)
  const mounted = mountSurfaceHost(createSurfaceHost())
  mounted.host.setRuntime({ invalidate() {}, setBusy() {} })
  return mounted
}

it('a rejected declaration leaves the incumbent request and callbacks intact', () => {
  const mounted = liveHost(), store = createSurfaceStore('panel')
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container), ownerErrors: Error[] = [], duplicateErrors: Error[] = []
  const owner = <Surface.Root key="owner" surface={store.handle} inScene={false} onError={error => ownerErrors.push(error)}>owner</Surface.Root>
  const duplicate = <Surface.Root key="duplicate" surface={store.handle} inScene onError={error => duplicateErrors.push(error)}>duplicate</Surface.Root>
  const render = (includeDuplicate: boolean) => flushSync(() => root.render(createElement(Fragment, null, owner, includeDuplicate ? duplicate : null)))
  try {
    render(false)
    render(true)
    expect(duplicateErrors.some(error => error.message.includes('already has a controller'))).toBe(true)
    expect(store.getState().requested).toBe('page')
    expect(store.getStatus().requestedInScene).toBe(false)
    expect(mounted.host.ticks()).toHaveLength(1)
    render(false)
    const error = new Error('owner callback remains')
    store.reportError(error)
    expect(ownerErrors).toContain(error)
    expect(store.getStatus().requestedInScene).toBe(false)
    expect(mounted.host.ticks()).toHaveLength(1)
  } finally { flushSync(() => root.unmount()); mounted.release() }
})

it('Strict Mode retains one controller loop and releases it on unmount', () => {
  const mounted = liveHost(), store = createSurfaceStore()
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container), errors: Error[] = []
  try {
    flushSync(() => root.render(<StrictMode>
      <Surface.Root surface={store.handle} inScene={false} onError={error => errors.push(error)}>owner</Surface.Root>
    </StrictMode>))
    expect(store.hasController()).toBe(true)
    expect(container.textContent).toBe('owner')
    expect(mounted.host.ticks()).toHaveLength(1)
    expect(errors).toEqual([])
    flushSync(() => root.unmount())
    expect(store.hasController()).toBe(false)
    expect(mounted.host.ticks()).toHaveLength(0)
  } finally { mounted.release() }
})

it('switching handles leaves only the selected controller and protocol loop active', () => {
  const mounted = liveHost(), first = createSurfaceStore(), second = createSurfaceStore()
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const render = (store: SurfaceStore) => flushSync(() => root.render(<Surface.Root surface={store.handle} inScene={false}>{null}</Surface.Root>))
  try {
    render(first)
    render(second)
    expect(first.hasController()).toBe(false)
    expect(second.hasController()).toBe(true)
    expect(mounted.host.ticks()).toHaveLength(1)
    flushSync(() => root.unmount())
    expect(second.hasController()).toBe(false)
    expect(mounted.host.ticks()).toHaveLength(0)
  } finally { mounted.release() }
})

it('a rejected declaration keeps its native HTML without replacing the incumbent source', () => {
  vi.stubGlobal('CanvasRenderingContext2D', undefined)
  const store = createSurfaceStore('owner'), container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container), errors: Error[] = []
  const owner = <Surface.Root key="owner" surface={store.handle} inScene={false} onError={error => errors.push(error)}>
    <Surface.HTML><button data-owner="owner">owner content</button></Surface.HTML>
  </Surface.Root>
  const duplicate = <Surface.Root key="duplicate" surface={store.handle} inScene={false} onError={error => errors.push(error)}>
    <Surface.HTML>loser content</Surface.HTML>
  </Surface.Root>
  try {
    flushSync(() => root.render(createElement(Fragment, null, owner)))
    expect(store.parts()).toHaveLength(1)
    const source = store.parts()[0]!.captureRoot
    const button = container.querySelector('[data-owner="owner"]')
    expect(source?.textContent).toBe('owner content')
    flushSync(() => root.render(createElement(Fragment, null, owner, duplicate)))
    expect(errors.some(error => error.message.includes('already has a controller'))).toBe(true)
    expect(store.parts()[0]!.captureRoot).toBe(source)
    expect(container.querySelector('[data-owner="owner"]')).toBe(button)
    expect(container.textContent).toContain('loser content')
    flushSync(() => root.render(createElement(Fragment, null, owner)))
    expect(store.parts()[0]!.captureRoot).toBe(source)
    expect(container.querySelector('[data-owner="owner"]')).toBe(button)
  } finally { flushSync(() => root.unmount()) }
})
