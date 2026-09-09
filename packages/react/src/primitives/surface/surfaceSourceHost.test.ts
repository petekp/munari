// @vitest-environment happy-dom
// Source ownership — each host retains its DOM and releases its own publication.
// Duplicate names are invalid, but removing either duplicate must recover
// without rebuilding the survivor. The 2026-09-07 regression covered both
// removal orders, including Strict Mode's setup/cleanup cycle.

import { Fragment, StrictMode, createElement, useLayoutEffect, useSyncExternalStore } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { surfaceChromeElement } from './surfaceChromeElement'
import { createSurfaceStore } from './surfaceHandle'
import { SurfacePart } from './SurfacePart'
import { SurfaceRootContext, useSurfacePart, type SurfacePartValue, type SurfaceRootValue } from './surfaceContext'
import { resetSurfaceHosts, surfaceHost, type SurfaceHost } from './surfaceHostRegistry'

describe('surface chrome element', () => {
  it('reads the one authored React root rather than its square capture container', () => {
    const capture = document.createElement('div')
    const card = document.createElement('article')
    capture.appendChild(card)
    expect(surfaceChromeElement(capture, false)).toBe(card)
  })

  it('keeps the container when React authored several roots', () => {
    const capture = document.createElement('div')
    capture.append(document.createElement('article'), document.createElement('aside'))
    expect(surfaceChromeElement(capture, false)).toBe(capture)
  })

  it('measures an adopted element itself', () => {
    const adopted = document.createElement('article')
    adopted.appendChild(document.createElement('button'))
    expect(surfaceChromeElement(adopted, true)).toBe(adopted)
  })
})

interface TrialCanvas extends HTMLCanvasElement {
  requestPaint(): void
  onpaint: (() => void) | null
  layoutSubtree: boolean
}

function SourcePortals({ host }: { host: SurfaceHost }) {
  const sources = useSyncExternalStore(host.subscribeSources, host.sources, host.sources)
  return sources.map(entry => createPortal(entry.content, entry.container, entry.key))
}

describe('duplicate source host recovery', () => {
  const roots: Root[] = []

  beforeEach(() => {
    class Context2D { drawElementImage() {} }
    vi.stubGlobal('CanvasRenderingContext2D', Context2D)
    // SAFETY: these are the three trial members consumed by the source;
    // happy-dom supplies the canvas and DOM lifecycle, but no rasterizer.
    const prototype = HTMLCanvasElement.prototype as TrialCanvas
    prototype.requestPaint = () => {}
    prototype.onpaint = null
    prototype.layoutSubtree = false
    const context = { setTransform() {}, clearRect() {}, drawElementImage() {} }
    // SAFETY: the source requests only 2D and calls these three methods.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      (id => id === '2d' ? context : null) as typeof HTMLCanvasElement.prototype.getContext,
    )
  })

  afterEach(() => {
    for (const root of roots.splice(0)) flushSync(() => root.unmount())
    resetSurfaceHosts()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  function fixture(wiring: 'page' | 'canvas', strict: boolean, duplicate: boolean) {
    const store = createSurfaceStore('recovery')
    const host = surfaceHost('recovery')
    const errors: Error[] = []
    store.setCallbacks({ onError: error => errors.push(error) })
    const rootValue: SurfaceRootValue = {
      store, handle: store.handle, host, canvasId: host.id, name: store.name,
      instanceId: 'same-root', wiring, exclusive: false,
      reportMeasuredSize() {},
      measuredSize: () => null,
      partRuntime: id => store.part(id)?.runtime ?? null,
    }
    const observed = new Map<string, SurfacePartValue>()
    const mounts = new Map<string, number>()
    function Content({ name }: { name: string }) {
      useLayoutEffect(() => {
        mounts.set(name, (mounts.get(name) ?? 0) + 1)
      }, [name])
      return createElement('input', { 'data-owner': name, defaultValue: name })
    }
    function ReadPart({ name }: { name: string }) {
      const part = useSurfacePart('ReadPart')
      useLayoutEffect(() => { observed.set(name, part) }, [name, part])
      return null
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    const render = (names: readonly string[]) => flushSync(() => root.render(
      createElement(strict ? StrictMode : Fragment, null,
        createElement(SourcePortals, { host }),
        createElement(SurfaceRootContext, { value: rootValue },
          names.map(name => createElement(SurfacePart, {
            key: name,
            name: duplicate ? 'panel' : name,
            size: [200, 100],
            resolution: 1,
            source: createElement(Content, { name }),
          }, createElement(ReadPart, { name }))),
        ),
      ),
    ))
    return { store, host, observed, mounts, errors, render }
  }

  const cases = (['page', 'canvas'] as const).flatMap(wiring =>
    [false, true].flatMap(strict => (['first', 'last'] as const).map(removed => ({ wiring, strict, removed }))),
  )

  it.each(cases)('keeps the survivor after $removed leaves ($wiring, strict=$strict)', async ({ wiring, strict, removed }) => {
    const test = fixture(wiring, strict, true)
    test.render(['first', 'last'])
    await new Promise<void>(resolve => queueMicrotask(resolve))
    expect(test.errors.some(error => error.message.includes('two parts named "panel"'))).toBe(true)

    const survivor = removed === 'first' ? 'last' : 'first'
    const part = test.observed.get(survivor)
    if (!part || !part.runtime || !part.captureRoot) throw new Error('The surviving source is not ready')
    const input = part.captureRoot.querySelector('input')
    expect(input).toBeInstanceOf(HTMLInputElement)
    const sourceId = part.runtime.source.sourceId
    const texture = part.runtime.texture()
    const mounts = test.mounts.get(survivor)
    if (!input) throw new Error('The surviving source has no input')
    input.value = 'edited before removing duplicate'
    if (wiring === 'canvas') expect(test.host.sources()).toHaveLength(2)

    test.render([survivor])
    const publication = test.store.part('panel')
    if (!publication || !publication.runtime || !publication.captureRoot) throw new Error('The surviving source was unpublished')
    expect(publication.runtime).toBe(part.runtime)
    expect(publication.runtime.source.sourceId).toBe(sourceId)
    expect(publication.runtime.texture()).toBe(texture)
    expect(publication.size).toEqual([200, 100])
    expect(publication.captureRoot.querySelector('input')).toBe(input)
    expect(input.value).toBe('edited before removing duplicate')
    expect(test.mounts.get(survivor)).toBe(mounts)
    if (wiring === 'canvas') {
      expect(test.host.sources()).toHaveLength(1)
      expect(test.host.sources()[0]?.container).toBe(publication.captureRoot)
    }

    test.render([])
    expect(test.store.parts()).toEqual([])
    expect(test.host.sources()).toEqual([])
  })

  it.each(['page', 'canvas'] as const)('preserves unique parts when a sibling leaves (%s)', (wiring) => {
    const test = fixture(wiring, false, false)
    test.render(['first', 'last'])
    const last = test.store.part('last')
    test.render(['last'])
    expect(test.store.part('first')).toBeNull()
    expect(test.store.part('last')?.runtime).toBe(last?.runtime)
    expect(test.store.part('last')?.captureRoot).toBe(last?.captureRoot)
  })
})
