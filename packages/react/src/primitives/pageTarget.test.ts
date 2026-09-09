// @vitest-environment happy-dom
// Moving a layout slot must not remount the Surface's stateful content.
import { act, createElement, Fragment, memo, Suspense, useEffect, useState } from 'react'
import { renderToString } from 'react-dom/server'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { Surface } from './Surface'
import { createPageTarget, usePageTarget } from './pageTarget'
import { resetSurfaceHosts } from './surface/surfaceHostRegistry'

it('retains the original component and DOM node across different layout parents', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let mounts = 0
  function Counter() {
    const [count, setCount] = useState(0)
    useEffect(() => { mounts++ }, [])
    return createElement('button', {'data-counter':'',onClick:()=>setCount(value=>value+1)},String(count))
  }
  function Example() {
    const target = usePageTarget()
    const [right, setRight] = useState(false)
    return createElement(Fragment, null,
      createElement('button', {'data-move':'',onClick:()=>setRight(value=>!value)}, 'Move'),
      createElement('section', {'data-left':''}, !right && createElement('div',{ref:target.ref})),
      createElement('section', {'data-right':''}, right && createElement('div',{ref:target.ref})),
      // React's createElement overload requires these declared children in the props type.
      // eslint-disable-next-line react/no-children-prop
      createElement(Surface.Root, {inScene:false,children:createElement(Surface.HTML,{target,children:createElement(Counter)})}),
    )
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(Example)))
    const counter = container.querySelector<HTMLButtonElement>('[data-api-live] [data-counter]')!
    await act(async () => counter.click())
    await act(async () => container.querySelector<HTMLButtonElement>('[data-move]')!.click())
    expect(container.querySelector('[data-right] [data-api-live] [data-counter]')).toBe(counter)
    expect(counter.textContent).toBe('1')
    expect(counter.isConnected).toBe(true)
    expect(mounts).toBe(1)
    await act(async () => container.querySelector<HTMLButtonElement>('[data-move]')!.click())
    expect(container.querySelector('[data-left] [data-api-live] [data-counter]')).toBe(counter)
  } finally {
    await act(async () => root.unmount())
    container.remove()
    resetSurfaceHosts()
    vi.unstubAllGlobals()
  }
})

it('keeps memoized targeted roots in their slots through prepend, reorder and removal', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('CanvasRenderingContext2D', undefined)
  const a = createPageTarget(), b = createPageTarget()
  const errors: unknown[] = []
  const Row = memo(function Row({ id }: { id: 'a' | 'b' }) {
    const [count, setCount] = useState(0)
    // createElement requires the declared children prop on compound components.
    // eslint-disable-next-line react/no-children-prop
    return createElement(Surface.Root, { inScene: false, children:
      // eslint-disable-next-line react/no-children-prop
      createElement(Surface.HTML, { target: id === 'a' ? a : b, children:
        createElement('button', { 'data-item': id, onClick: () => setCount(n => n + 1) }, String(count)),
      }),
    })
  })
  function List({ ids }: { ids: readonly ('a' | 'b')[] }) {
    return createElement(Fragment, null,
      createElement('section', { 'data-slot': 'a', ref: a.ref }),
      createElement('section', { 'data-slot': 'b', ref: b.ref }),
      createElement('div', { 'data-homes': '' }, ids.map(id => createElement(Row, { key: id, id }))),
    )
  }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container, { onUncaughtError: error => errors.push(error) })
  const render = async (ids: readonly ('a' | 'b')[]) => { await act(async () => root.render(createElement(List, { ids }))) }
  const inSlot = (id: string) => container.querySelector(`[data-slot="${id}"] [data-api-live] [data-item="${id}"]`)
  try {
    await render(['a'])
    const original = inSlot('a')!
    await act(async () => original.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await render(['b', 'a'])
    expect(errors).toEqual([])
    expect(inSlot('a')).toBe(original)
    expect(inSlot('b')).not.toBeNull()
    await render(['a', 'b'])
    expect(inSlot('a')).toBe(original)
    expect(original.textContent).toBe('1')
    expect(container.querySelector('[data-homes] [data-item]')).toBeNull()
    await render(['b'])
    expect(inSlot('a')).toBeNull()
    expect(inSlot('b')).not.toBeNull()
  } finally {
    await act(async () => root.unmount()); container.remove(); resetSurfaceHosts(); vi.unstubAllGlobals()
  }
})

it('hydrates targeted HTML without replacing its server-rendered node', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('CanvasRenderingContext2D', undefined)
  const target = createPageTarget(), errors: unknown[] = []
  const element = createElement(Fragment, null,
    createElement('section', { 'data-target': '', ref: target.ref }),
    // createElement requires the declared children prop on compound components.
    // eslint-disable-next-line react/no-children-prop
    createElement(Surface.Root, { inScene: false, children:
      // eslint-disable-next-line react/no-children-prop
      createElement(Surface.HTML, { target, children: createElement('input', { defaultValue: 'Native' }) }),
    }),
  )
  const container = document.createElement('div'); container.innerHTML = renderToString(element); document.body.append(container)
  const original = container.querySelector('input')!
  original.value = 'Typed before hydration'
  const root = hydrateRoot(container, element, { onRecoverableError: error => errors.push(error) })
  try {
    await act(async () => {})
    expect(container.querySelector('[data-target] input')).toBe(original)
    expect(original.value).toBe('Typed before hydration')
    expect(errors).toEqual([])
  } finally {
    await act(async () => root.unmount()); container.remove(); resetSurfaceHosts(); vi.unstubAllGlobals()
  }
})

it('returns targeted content home while Suspense hides its React tree',async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  vi.stubGlobal('CanvasRenderingContext2D',undefined)
  const target=createPageTarget(),waiting=new Promise<void>(()=>{})
  function Content({pending}:{pending:boolean}){
    const [count,setCount]=useState(0)
    if(pending)throw waiting
    return createElement('button',{onClick:()=>setCount(value=>value+1)},String(count))
  }
  function Fixture({pending}:{pending:boolean}){
    return createElement(Fragment,null,createElement('section',{'data-target':'',ref:target.ref}),
      createElement(Suspense,{fallback:createElement('p',{'data-fallback':''},'Waiting')},
        // createElement requires each compound component's declared children prop.
        // eslint-disable-next-line react/no-children-prop
        createElement(Surface.Root,{inScene:false,children:createElement(Surface.HTML,{target,children:createElement(Content,{pending})})}),
      ),
    )
  }
  const container=document.createElement('div');document.body.append(container)
  const root=createRoot(container)
  const render=async(pending:boolean)=>{await act(async()=>root.render(createElement(Fixture,{pending})))}
  try {
    await render(false)
    const original=container.querySelector<HTMLButtonElement>('[data-target] button')!
    await act(async()=>original.click())
    await render(true)
    expect(container.querySelector('[data-fallback]')).not.toBeNull()
    expect(container.querySelector('[data-target] button')).toBeNull()
    await render(false)
    expect(container.querySelector('[data-target] button')).toBe(original)
    expect(original.textContent).toBe('1')
  }finally{await act(async()=>root.unmount());container.remove();resetSurfaceHosts();vi.unstubAllGlobals()}
})
