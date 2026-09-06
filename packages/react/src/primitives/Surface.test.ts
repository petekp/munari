// @vitest-environment happy-dom
// The API proof must hydrate its existing content rather than mount a second copy.
import { act, createElement, useEffect, useId, useState } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { Surface } from './Surface'
import { resetSurfaceHosts } from './surface/surfaceHostRegistry'

afterEach(()=>{vi.unstubAllGlobals();resetSurfaceHosts();document.body.innerHTML=''})

it('renders native HTML on the server and hydrates one stateful instance',async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  const documentBefore=document
  let mounts=0
  function Counter(){const[count,setCount]=useState(0);useEffect(()=>{mounts++},[]);return createElement('button',{onClick:()=>setCount(n=>n+1)},`Count ${count}`)}
  // createElement's props overload requires this field even when children are positional.
  // eslint-disable-next-line react/no-children-prop
  const element=(inScene:boolean)=>createElement(Surface,{inScene,children:createElement(Counter)})
  vi.stubGlobal('document',undefined)
  vi.stubGlobal('CanvasRenderingContext2D',undefined)
  const html=renderToString(element(false))
  expect(html).toContain('Count 0')
  vi.stubGlobal('document',documentBefore)
  const container=document.createElement('div');container.innerHTML=html;document.body.append(container)
  const button=container.querySelector('button')
  const errors:unknown[]=[]
  const root=hydrateRoot(container,element(false),{onRecoverableError:error=>errors.push(error)})
  try {
    await act(async()=>{})
    await act(async()=>button?.dispatchEvent(new MouseEvent('click',{bubbles:true})))
    await act(async()=>root.render(element(true)))
    expect(container.querySelector('[data-api-live] button')).toBe(button)
    expect(button?.textContent).toBe('Count 1')
    expect(mounts).toBe(1)
    expect(errors).toEqual([])
  } finally {await act(async()=>root.unmount())}
})


it('keeps independently server-rendered identities unique with matching hydration prefixes',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 vi.stubGlobal('CanvasRenderingContext2D',undefined)
 const errors:unknown[]=[],containers:HTMLDivElement[]=[]
 function Example(){
  const id=useId()
  // The createElement overload requires the component's required children prop.
  // eslint-disable-next-line react/no-children-prop
  return createElement('section',{'data-canvas-id':id},createElement(Surface,{inScene:false,canvas:id,children:createElement('button',null,'Native')}))
 }
 const roots:Root[]=[]
 try {
  for(const identifierPrefix of ['left-','right-']) {
   const node=document.createElement('div');node.innerHTML=renderToString(createElement(Example),{identifierPrefix});document.body.append(node);containers.push(node)
   roots.push(hydrateRoot(node,createElement(Example),{identifierPrefix,onRecoverableError:error=>errors.push(error)}))
  }
  await act(async()=>{})
  const ids=containers.map(node=>node.querySelector('section')?.dataset.canvasId)
  expect(new Set(ids).size).toBe(2)
  expect(errors).toEqual([])
 }finally{await act(async()=>{for(const root of roots)root.unmount()})}
})
