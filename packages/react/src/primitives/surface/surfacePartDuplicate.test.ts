// @vitest-environment happy-dom
//
// The publication slot under a duplicate name: one entry per HOST, not per
// name.
//
// The fault, traced from `SurfaceSourceHost` (2026-08-18, "Implement
// compound Surface API"): `publishPart` keyed its slot by the part NAME and
// used a plain `Map.set`/`Map.delete` with no refcount — the odd one out
// beside the refcounted `expectPart`/`registerPartPresenter` ledgers. Two
// `<Surface.Part>`s sharing a name published under one slot, so the second
// mount overwrote the first; when EITHER unmounted, its cleanup deleted the
// shared slot and took the survivor's pixels with it for good (the survivor's
// publish effect never re-runs on a sibling unmount). The fix keys the slot
// per host (`sourceContentKey`), and `part(id)` reads by name — finding the
// publication whose `id` matches — so one host unmounting only deletes its
// own entry and a same-named survivor keeps its publication.
//
// No JSX here: the runner only discovers `.test.ts` (surfaceHandle.test.ts
// carries the same note). These tests stand at the store level (the bug
// lives in `publishPart`/`part`) and the React read side, because the
// defect and its remedy are both about whose hands the publication is in.
import { createElement } from 'react'
import * as THREE from 'three'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SurfaceHandle } from './surfaceHandle'
import { createSurfaceStore } from './surfaceHandle'
import { useSurfaceTextureOf } from './surfaceContext'
import type { SurfacePartPublication, SurfaceSourceRuntime } from './surfaceSourceRuntime'
import type { SurfacePartId } from '@munari/core'

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  container.remove()
})

/** Two hosts publishing under the same NAME each pass their own per-host key. */
const keyA = 'host-a:dup' as const
const keyB = 'host-b:dup' as const

/** A publication whose identity is all that is asserted here. */
function pub(id: SurfacePartId): SurfacePartPublication {
  return { id, runtime: null, size: [0, 0], captureRoot: null, pageRoot: null }
}

describe('publishPart — one entry per host, read by name', () => {
  it('a same-named sibling unmounting leaves the survivor published', () => {
    const store = createSurfaceStore()
    store.acquire(1)

    const pubA = pub('dup')
    const pubB = pub('dup')

    store.publishPart(keyA, pubA) // host A mounts
    store.publishPart(keyB, pubB) // host B mounts — owns its own entry now

    // While both are mounted, the last-published host wins the name — the
    // one-slot-per-name contract a duplicate name already pays for.
    expect(store.part('dup')).toBe(pubB)

    // Host B unmounts. Its cleanup deletes only its own entry.
    store.publishPart(keyB, null)

    // The survivor (host A) keeps its pixels: read by name finds pubA, where
    // before the fix the slot was empty and pubA was gone for good.
    expect(store.part('dup')).toBe(pubA)
    // The snapshot the presenters read carries only the surviving host's
    // publication — never a disposed runtime left by the unmounting one.
    expect(store.parts()).toEqual([pubA])
  })

  it('the FIRST-published host unmounting also leaves the survivor published', () => {
    const store = createSurfaceStore()
    store.acquire(1)

    const pubA = pub('dup')
    const pubB = pub('dup')

    store.publishPart(keyA, pubA)
    store.publishPart(keyB, pubB)
    expect(store.part('dup')).toBe(pubB)

    // Host A (first-published) unmounts — only its entry is deleted.
    store.publishPart(keyA, null)

    // Host B's publication is still live and reachable by name, not disposed.
    expect(store.part('dup')).toBe(pubB)
    expect(store.parts()).toEqual([pubB])
  })

  it('unique names read back their own publication (no regression)', () => {
    const store = createSurfaceStore()
    store.acquire(1)

    const pubM = pub('m')
    const pubU = pub('u')

    store.publishPart('host-m', pubM)
    store.publishPart('host-u', pubU)

    expect(store.part('m')).toBe(pubM)
    expect(store.part('u')).toBe(pubU)
    expect(store.parts()).toEqual([pubM, pubU])

    // Removing one unique part does not disturb the other.
    store.publishPart('host-u', null)
    expect(store.part('u')).toBe(null)
    expect(store.part('m')).toBe(pubM)
  })
})

// The React read side: `useSurfaceTextureOf` reads `store.part(id)` through a
// `useSyncExternalStore`, so a same-named sibling unmounting must rebind the
// material to the survivor's texture in the same commit.

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

/** Render the hook against one named part and collect every answer, in order. */
function renderReads(handle: SurfaceHandle, part: SurfacePartId) {
  const reads: unknown[] = []
  const root = createRoot(container)
  const Probe = () => {
    reads.push(useSurfaceTextureOf(handle, part))
    return null
  }
  flushSync(() => root.render(createElement(Probe)))
  return {
    reads,
    unmount: () => flushSync(() => root.unmount()),
  }
}

describe('useSurfaceTextureOf rebinds to the survivor of a same-named unmount', () => {
  it('returns the survivor texture after the overlapping host unmounts', () => {
    const store = createSurfaceStore('dup')
    const textureA = stubTexture()
    const textureB = stubTexture()
    const probe = renderReads(store.handle, 'dup')
    expect(probe.reads.at(-1)).toBe(null)

    flushSync(() => {
      store.publishPart(keyA, {
        id: 'dup',
        runtime: runtimeWith(textureA),
        size: [0, 0],
        captureRoot: null,
        pageRoot: null,
      })
    })
    expect(probe.reads.at(-1)).toBe(textureA)

    flushSync(() => {
      store.publishPart(keyB, {
        id: 'dup',
        runtime: runtimeWith(textureB),
        size: [0, 0],
        captureRoot: null,
        pageRoot: null,
      })
    })
    // During the overlap the last-published host wins the name.
    expect(probe.reads.at(-1)).toBe(textureB)

    flushSync(() => {
      store.publishPart(keyB, null) // host B unmounts
    })
    // The survivor rebinds the material in the same commit, where before
    // the fix the slot went null and the material sampled nothing forever.
    expect(probe.reads.at(-1)).toBe(textureA)
    probe.unmount()
  })
})
