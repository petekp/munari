// @vitest-environment happy-dom
//
// Naming another Surface's texture: the contract `useSurfaceTextureOf` adds.
//
// The law is that a SOURCE is enough. A Surface with no presenter, no
// crossing and nothing composited still rasterizes, uploads and versions
// one texture, so a material may sample content the page shows nowhere —
// which is what lets one shader mix two live captures. Measured
// 2026-08-22 (docs/spikes/cross-surface-sampling.md): a presented-nowhere
// Surface held `texture.version` climbing 175 → 318 over 1.2s under both
// frameloop modes.
//
// Two failures are silent and are why this file exists. A hook that threw
// before the source mounted would make the answer depend on commit order
// between two independent trees — the material would throw on the render
// where it happened to lose the race, and work on the next reload. And a
// snapshot allocated per read re-renders every subscriber forever, because
// `useSyncExternalStore` compares by reference; the symptom is a scene that
// runs hot with nothing moving, never an error.
//
// No JSX here: the runner only discovers `.test.ts` (surfaceHandle.test.ts
// carries the same note).
import { createElement } from 'react'
import * as THREE from 'three'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SurfaceHandle } from './surfaceHandle'
import { createSurfaceStore } from './surfaceHandle'
import { DEFAULT_PART, useSurfaceTextureOf } from './surfaceContext'
import type { SurfaceSourceRuntime } from './surfaceSourceRuntime'

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  container.remove()
})

/** The one member the hook reads. The rest of a runtime is unreachable here. */
type TextureSource = Pick<SurfaceSourceRuntime, 'texture'>

/** A texture with no paint pipeline behind it — identity is all that is asserted. */
function stubTexture(): THREE.CanvasTexture {
  return new THREE.CanvasTexture(document.createElement('canvas'))
}

/**
 * A runtime that answers one question. The hook reads `texture()` and
 * nothing else, so standing up a real source here would test the paint
 * layer instead of this contract.
 */
function runtimeWith(texture: THREE.CanvasTexture): SurfaceSourceRuntime {
  const source: TextureSource = { texture: () => texture }
  // SAFETY: widening a `Pick` back to the interface it came from. Every
  // member left off is unreachable from this file, and a partial stub is
  // what keeps the contract about the lookup rather than about the paint.
  return source as SurfaceSourceRuntime
}

/** Render the hook and collect every answer it gave, in order. */
function renderReads(handle: SurfaceHandle) {
  const reads: unknown[] = []
  const root = createRoot(container)
  const Probe = () => {
    reads.push(useSurfaceTextureOf(handle))
    return null
  }
  flushSync(() => root.render(createElement(Probe)))
  return {
    reads,
    rerender: () => flushSync(() => root.render(createElement(Probe))),
    unmount: () => flushSync(() => root.unmount()),
  }
}

describe('useSurfaceTextureOf', () => {
  it('answers null before the named source has published', () => {
    const store = createSurfaceStore('unmounted')
    const probe = renderReads(store.handle)
    expect(probe.reads).toEqual([null])
    probe.unmount()
  })

  it('answers the texture of a source with zero presenters registered', () => {
    const store = createSurfaceStore('resident')
    const texture = stubTexture()
    store.publishPart(DEFAULT_PART, {
      id: DEFAULT_PART,
      runtime: runtimeWith(texture),
      size: [300, 180],
      captureRoot: null,
      pageRoot: null,
    })
    const probe = renderReads(store.handle)

    expect(probe.reads.at(-1)).toBe(texture)
    // The point of the whole mechanism: nothing presents this Surface, and
    // the readiness ledger is empty, yet its pixels are nameable.
    expect(store.canvasMounted()).toBe(false)
    expect(store.getState().presented).toBe('none')
    probe.unmount()
  })

  it('rebinds when the source arrives after the material rendered', () => {
    const store = createSurfaceStore('late')
    const probe = renderReads(store.handle)
    expect(probe.reads).toEqual([null])

    const texture = stubTexture()
    flushSync(() => {
      store.publishPart(DEFAULT_PART, {
        id: DEFAULT_PART,
        runtime: runtimeWith(texture),
        size: [300, 180],
        captureRoot: null,
        pageRoot: null,
      })
    })
    expect(probe.reads.at(-1)).toBe(texture)
    probe.unmount()
  })

  it('holds one reference across re-renders, so a subscriber never churns', () => {
    const store = createSurfaceStore('stable')
    const texture = stubTexture()
    store.publishPart(DEFAULT_PART, {
      id: DEFAULT_PART,
      runtime: runtimeWith(texture),
      size: [300, 180],
      captureRoot: null,
      pageRoot: null,
    })
    const probe = renderReads(store.handle)
    const before = probe.reads.length
    probe.rerender()
    probe.rerender()

    expect(probe.reads.length).toBeGreaterThan(before)
    expect(new Set(probe.reads)).toEqual(new Set([texture]))
    probe.unmount()
  })

  it('names a part, so one letter of a multi-part Surface is reachable alone', () => {
    const store = createSurfaceStore('word')
    const second = stubTexture()
    store.publishPart('m', {
      id: 'm',
      runtime: runtimeWith(stubTexture()),
      size: [40, 60],
      captureRoot: null,
      pageRoot: null,
    })
    store.publishPart('u', {
      id: 'u',
      runtime: runtimeWith(second),
      size: [40, 60],
      captureRoot: null,
      pageRoot: null,
    })

    const reads: unknown[] = []
    const root = createRoot(container)
    const Probe = () => {
      reads.push(useSurfaceTextureOf(store.handle, 'u'))
      return null
    }
    flushSync(() => root.render(createElement(Probe)))
    expect(reads.at(-1)).toBe(second)
    flushSync(() => root.unmount())

    // The default part is not a fallback: an id nobody published answers
    // null rather than whichever part happened to publish first.
    const unpublished = renderReads(store.handle)
    expect(unpublished.reads.at(-1)).toBeNull()
    unpublished.unmount()
  })
})
