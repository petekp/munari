// @vitest-environment happy-dom
// A scene-side declaration cannot silently name a different renderer.
import { createElement, use } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { afterEach, expect, it } from 'vitest'
import { SurfaceRoot } from './SurfaceRoot'
import { SurfaceRootContext } from './surfaceContext'
import { SurfaceHostContext } from './surfaceHostContext'
import { createSurfaceHost, resetSurfaceHosts, type SurfaceHost } from './surfaceHostRegistry'

afterEach(()=>{resetSurfaceHosts();document.body.innerHTML=''})
it('accepts a matching host and refuses a conflicting host inside the scene',()=>{
 const enclosing=createSurfaceHost('one'),container=document.createElement('div');document.body.append(container)
 const root=createRoot(container),errors:Error[]=[]
 let resolved:SurfaceHost|null=null
 function Read(){resolved=use(SurfaceRootContext)?.host??null;return null}
 const render=(canvas:string)=>flushSync(()=>root.render(createElement(SurfaceHostContext,{value:enclosing},createElement(SurfaceRoot,{canvas,renderIn:'none',onError:error=>errors.push(error)},createElement(Read)))))
 try {
  render('one');expect(resolved).toBe(enclosing);expect(errors).toHaveLength(0)
  render('two');expect(resolved).toBeNull();expect(errors).toHaveLength(1)
  expect(errors[0]?.message).toContain('conflicts with its enclosing')
 }finally{flushSync(()=>root.unmount())}
})
