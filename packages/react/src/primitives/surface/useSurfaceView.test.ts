// @vitest-environment happy-dom
//
// The two obligations this hook took off the consumer, pinned.
//
// A request that cannot be honoured must not be recorded: a scene reading
// `view === 'webgl'` on a browser with no trial arms a transition nothing
// will finish. And a mount must outlive the view change that ends it — the
// protocol keeps its presenter through the reclaim linger, so releasing on
// the view instead leaves one frame where neither side draws.
//
// No JSX here: the runner only discovers `.test.ts`.
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { surfaceStoreOf } from './surfaceHandle'
import { useSurfaceView, type SurfaceViewControls } from './useSurfaceView'

let container: HTMLDivElement
let seen: SurfaceViewControls | null = null

const Host = () => {
  seen = useSurfaceView('probe')
  return null
}

const mount = () => {
  const root = createRoot(container)
  flushSync(() => root.render(createElement(Host)))
  return root
}

// The trial as the capability probe reads it: `drawElementImage` on the 2D
// context prototype. Same stub style as the core probe's own suite.
const withTrial = () =>
  vi.stubGlobal(
    'CanvasRenderingContext2D',
    class WithTrial {
      drawElementImage() {}
    },
  )

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  seen = null
})

afterEach(() => {
  vi.unstubAllGlobals()
  container.remove()
})

describe('a view that cannot be honoured', () => {
  it('refuses the request rather than recording it', () => {
    // happy-dom's 2D context has no `drawElementImage`, so this is the
    // no-trial browser without stubbing anything.
    const root = mount()
    expect(seen?.state.supported).toBe(false)
    flushSync(() => seen?.show('webgl'))
    // Both halves matter. A recorded view arms the scene; a mounted WebGL
    // side puts up a Canvas whose frameloop never advances.
    expect(seen?.view).toBe('dom')
    expect(seen?.mounted).toBe(false)
    flushSync(() => root.unmount())
  })

  it('still takes dom, which is the view it is already in', () => {
    const root = mount()
    flushSync(() => seen?.show('dom'))
    expect(seen?.view).toBe('dom')
    flushSync(() => root.unmount())
  })
})

describe('a view that can be honoured', () => {
  it('records it and mounts the WebGL side in the same commit', () => {
    withTrial()
    const root = mount()
    expect(seen?.state.supported).toBe(true)
    flushSync(() => seen?.show('webgl'))
    expect(seen?.view).toBe('webgl')
    // Before any tick: the Canvas has to exist for the protocol to have a
    // renderer to advance from.
    expect(seen?.mounted).toBe(true)
    flushSync(() => root.unmount())
  })

  it('holds the mount through the reclaim linger, not to the view change', () => {
    withTrial()
    const root = mount()
    const store = surfaceStoreOf(seen!.surface)!
    flushSync(() => seen?.show('webgl'))

    // Drive a full forward crossing. `<Surface view={…}>` is what makes
    // this request in a real tree; there is no Surface here, so the test
    // plays that part.
    store.acquire(1)
    store.registerPresenter('a')
    store.prove('a', store.readinessLifetime(), store.epoch())
    store.request('webgl')
    flushSync(() => store.tick(500))
    expect(store.getState().presentedView).toBe('webgl')

    // Now home again. The view flips immediately and the mount does not.
    flushSync(() => seen?.show('dom'))
    store.request('dom')
    flushSync(() => store.tick(500))
    expect(seen?.view).toBe('dom')
    expect(seen?.mounted).toBe(true)

    // RECLAIM_LINGER_MS is 300; one tick past it releases.
    flushSync(() => store.tick(400))
    expect(store.getState().isWebGLMounted).toBe(false)
    expect(seen?.mounted).toBe(false)
    flushSync(() => root.unmount())
  })
})
