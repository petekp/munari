// @vitest-environment happy-dom
// Moving a layout slot must not remount the Surface's stateful content.
import { act, createElement, Fragment, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { Surface } from './Surface'
import { usePageTarget } from './pageTarget'
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
