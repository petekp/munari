// @vitest-environment happy-dom
import { Component, Suspense, act, createElement as h, use, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SceneLitMaterial, SurfaceSceneComponentsContext, createSceneModuleCache } from './surfaceSceneLookup'
import type { SurfaceSceneComponents } from './surfaceSceneComponents'

interface LoaderPlan {
  failures?: number
  delayMs?: number
}

function drawnComponents(label: string): SurfaceSceneComponents {
  const Drawn = () => h('i', null, label)
  return { Presenter: Drawn, LitMaterial: Drawn, Prewarm: Drawn, AnchorGroup: Drawn }
}

function countedLoader({ failures = 0, delayMs = 0 }: LoaderPlan) {
  const loader = {
    imports: 0,
    async load() {
      loader.imports++
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs))
      if (loader.imports <= failures) throw new Error('scene chunk failed to load')
      return drawnComponents('loaded')
    },
  }
  return loader
}

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? h('b', null, 'failed') : this.props.children
  }
}

async function mountLoadedMaterial(sceneComponentsLoad: () => Promise<SurfaceSceneComponents>) {
  function LoadedMaterial() {
    const { LitMaterial } = use(sceneComponentsLoad())
    return h(LitMaterial)
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(h(ErrorBoundary, null, h(Suspense, { fallback: h('s', null, 'waiting') }, h(LoadedMaterial))))
  })
  for (let tick = 0; tick < 10; tick++) await act(() => new Promise(resolve => setTimeout(resolve, 10)))
  return { container, unmount: () => act(() => root.unmount()) }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('scene component lookup', () => {
  it('draws the components a SurfaceCanvas provides', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    flushSync(() => root.render(h(SurfaceSceneComponentsContext, { value: drawnComponents('provided') }, h(SceneLitMaterial))))
    expect(container.textContent).toBe('provided')
    flushSync(() => root.unmount())
  })

  it('suspends until the scene module loads', async () => {
    const loader = countedLoader({ delayMs: 20 })
    const view = await mountLoadedMaterial(createSceneModuleCache(loader.load))
    expect(view.container.textContent).toBe('loaded')
    expect(loader.imports).toBe(1)
    await view.unmount()
  })

  it.each([0, 20])('sends a failed load to the error boundary once, with a %i ms failure', async (delayMs) => {
    const loader = countedLoader({ failures: Infinity, delayMs })
    const view = await mountLoadedMaterial(createSceneModuleCache(loader.load))
    expect(view.container.textContent).toBe('failed')
    expect(loader.imports).toBe(1)
    await view.unmount()
  })

  it('loads again on a later mount after a failed load', async () => {
    const loader = countedLoader({ failures: 1, delayMs: 5 })
    const sceneComponentsLoad = createSceneModuleCache(loader.load)
    const failed = await mountLoadedMaterial(sceneComponentsLoad)
    expect(failed.container.textContent).toBe('failed')
    await failed.unmount()
    const retried = await mountLoadedMaterial(sceneComponentsLoad)
    expect(retried.container.textContent).toBe('loaded')
    expect(loader.imports).toBe(2)
    await retried.unmount()
  })
})
