// @vitest-environment happy-dom
// Frame-ordering law: a tier-change recut and an upload can land in the same
// r3f frame, and GL storage must be correctly sized at render — whatever
// order they arrived in.
//
// r3f drains useFrame subscribers in mount order (the host bridge's tick
// before the presenter's stepLod) and then calls gl.render. When upload()
// runs first, it arms needsUpdate against the canvas at its current size;
// when stepLod runs second, it recuts the canvas to a new size. The renderer
// then texSubImage2Ds the resized canvas into immutable GL storage cut for
// the old size — a shrink writes into one corner leaving stale texels around
// it; a grow is rejected with GL_INVALID_VALUE and the old tier persists one
// frame. reclaimStorage() in applyTier fixes this by disposing the texture
// (forcing fresh texStorage2D at the next render) whenever setScale actually
// re-cut the store, making the behavior ordering-independent.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSurfaceSourceRuntime,
  type SurfaceSourceRuntime,
} from './surfaceSourceRuntime'

interface TrialCanvas extends HTMLCanvasElement {
  requestPaint: () => void
  onpaint: (() => void) | null
  layoutSubtree: boolean
}

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext

beforeEach(() => {
  class Context2D {
    drawElementImage() {}
  }
  vi.stubGlobal('CanvasRenderingContext2D', Context2D)
  // SAFETY: the next three assignments install exactly these trial members
  // on happy-dom's canvas prototype before any source is created.
  const prototype = HTMLCanvasElement.prototype as TrialCanvas
  prototype.requestPaint = () => {}
  prototype.onpaint = null
  prototype.layoutSubtree = false
  originalGetContext = HTMLCanvasElement.prototype.getContext
  const context = {
    setTransform() {},
    clearRect() {},
    drawElementImage() {},
    drawImage() {},
  }
  // SAFETY: the runtime asks only for a 2D context and only calls the four
  // methods above. Other context IDs return null, as a browser may.
  HTMLCanvasElement.prototype.getContext = ((id: string) =>
    id === '2d' ? context : null) as typeof HTMLCanvasElement.prototype.getContext
})

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

/** Drive one compositor paint so source.painted() is true and upload() runs. */
function paint(runtime: SurfaceSourceRuntime) {
  // SAFETY: the source factory installs `onpaint` as an own property on the
  // canvas instance at creation time; the prototype's `null` is shadowed.
  const canvas = runtime.source.canvas as TrialCanvas
  canvas.onpaint!()
}

function createRuntime(overrides: {
  size?: [number, number]
  resolution?: number | 'auto'
  pixelRatio?: number
  paint?: 'auto' | 'always'
}): SurfaceSourceRuntime {
  return createSurfaceSourceRuntime({
    content: document.createElement('section'),
    size: overrides.size ?? [800, 600],
    resolution: overrides.resolution ?? 'auto',
    mirrorU: false,
    paint: overrides.paint ?? 'always',
    pixelRatio: overrides.pixelRatio ?? 1,
    onError: (error) => {
      throw error
    },
  })
}

/** three.js Texture.needsUpdate is a setter-only property — reading it back
 *  returns undefined. The observable side effect is that `texture.version`
 *  increments, so version deltas are the test's upload-armed signal. */
function versionOf(runtime: SurfaceSourceRuntime): number {
  return runtime.texture()!.version
}

describe('a source runtime frame ordering', () => {
  it('reclaims GL storage in the same frame when upload precedes the LOD recut', () => {
    const runtime = createRuntime({})
    const texture = runtime.texture()!
    paint(runtime)
    expect(runtime.source.painted()).toBe(true)
    const disposeSpy = vi.spyOn(texture, 'dispose')

    // --- Frame F, useFrame callback 1 (host bridge, subscribed first) ---
    const versionBeforeUpload = versionOf(runtime)
    runtime.frame()
    // Upload armed against the canvas at its current 800×600 size.
    expect(versionOf(runtime)).toBeGreaterThan(versionBeforeUpload)
    expect(runtime.source.canvas.width).toBe(800)
    expect(runtime.source.canvas.height).toBe(600)
    // The alloc ledger matched at upload-call time, so no realloc yet.
    expect(disposeSpy).not.toHaveBeenCalled()

    // --- Frame F, useFrame callback 2 (presenter stepLod, subscribed second) ---
    const versionBeforeReclaim = versionOf(runtime)
    runtime.proposeTier(1, 0.5)
    // The canvas was re-cut to 400×300 synchronously.
    expect(runtime.source.canvas.width).toBe(400)
    expect(runtime.source.canvas.height).toBe(300)
    // reclaimStorage disposed for fresh GL storage in the same frame, so the
    // armed upload targets correctly-sized storage, not the stale 800×600
    // immutable allocation that would corrupt the render.
    expect(disposeSpy).toHaveBeenCalledTimes(1)
    // needsUpdate re-armed against the fresh storage (version advanced).
    expect(versionOf(runtime)).toBeGreaterThan(versionBeforeReclaim)

    // --- Frame F+1: no self-correction needed ---
    disposeSpy.mockClear()
    runtime.frame()
    expect(disposeSpy).not.toHaveBeenCalled()
  })

  it('reclaims GL storage in the same frame when the LOD recut precedes the upload', () => {
    const runtime = createRuntime({})
    const texture = runtime.texture()!
    paint(runtime)
    const disposeSpy = vi.spyOn(texture, 'dispose')

    // --- Fixed ordering: recut first (presenter), then upload (host) ---
    const versionBeforeReclaim = versionOf(runtime)
    runtime.proposeTier(1, 0.5)
    expect(runtime.source.canvas.width).toBe(400)
    expect(runtime.source.canvas.height).toBe(300)
    // reclaimStorage disposed for fresh storage.
    expect(disposeSpy).toHaveBeenCalledTimes(1)
    // needsUpdate re-armed (version advanced).
    expect(versionOf(runtime)).toBeGreaterThan(versionBeforeReclaim)

    // The host tick's upload() then runs in the same frame. It sees the alloc
    // already matches the recut canvas and does NOT dispose a second time —
    // no double-realloc.
    disposeSpy.mockClear()
    const versionBeforeUpload = versionOf(runtime)
    runtime.frame()
    expect(disposeSpy).not.toHaveBeenCalled()
    // upload() still arms needsUpdate (version advances).
    expect(versionOf(runtime)).toBeGreaterThan(versionBeforeUpload)
  })

  it('does not dispose when the tier change stays inside the density band', () => {
    // storeForBox returns `current` when the new density sits inside the
    // DENSITY_BAND, so the canvas is NOT re-cut and reclaimStorage sees the
    // same dimensions as alloc — no dispose, no spurious storage churn.
    const runtime = createRuntime({})
    const texture = runtime.texture()!
    paint(runtime)
    const disposeSpy = vi.spyOn(texture, 'dispose')

    // First, step to tier 1.5 (ratio 1.5 > 1.4 band → re-cuts to 1200×900).
    runtime.proposeTier(1, 1.5)
    expect(runtime.source.canvas.width).toBe(1200)
    expect(runtime.source.canvas.height).toBe(900)
    expect(disposeSpy).toHaveBeenCalledTimes(1)
    disposeSpy.mockClear()

    // Now step to tier 2 (ratio 2/1.5 ≈ 1.33, inside the [0.71, 1.40] band).
    // storeForBox returns `current`, so the canvas stays 1200×900 and no
    // re-cut happens.
    runtime.proposeTier(1, 2)
    expect(runtime.source.canvas.width).toBe(1200)
    expect(runtime.source.canvas.height).toBe(900)
    // reclaimStorage sees no dimension change → no dispose.
    expect(disposeSpy).not.toHaveBeenCalled()
  })

  it('does not reclaim in the pinned-resolution path', () => {
    // A pinned resolution (fixed number) uses the early-return branch of
    // applyTier, which is reached from layout effects (setResolution/setSize),
    // not from the r3f frame loop — there is no same-frame ordering gap, and
    // the next upload() catches any mismatch. reclaimStorage must not run here.
    const runtime = createRuntime({ resolution: 1 })
    const texture = runtime.texture()!
    paint(runtime)
    const disposeSpy = vi.spyOn(texture, 'dispose')

    // proposeTier is a no-op for pinned resolutions (pinned !== null).
    runtime.proposeTier(1, 0.5)
    expect(disposeSpy).not.toHaveBeenCalled()
    // The scale stayed at the pinned value of 1.
    expect(runtime.source.scale()).toBe(1)
  })

  it('reclaims storage even when no upload was armed in the same frame', () => {
    // paint: 'auto' means upload() only runs when paintCount advances. A
    // tier change can arrive on a frame with no content change, so upload()
    // does not arm — but the canvas is still re-cut, and the old GL storage
    // is still wrong-sized. reclaimStorage must dispose so the renderer does
    // not blit the pre-recut canvas into stale storage.
    const runtime = createRuntime({ paint: 'auto' })
    const texture = runtime.texture()!
    paint(runtime)
    const disposeSpy = vi.spyOn(texture, 'dispose')

    // drive one frame so upload() runs once (paintCount advanced from the
    // paint() call above) and drains the trailing-upload counter.
    runtime.frame()
    disposeSpy.mockClear()

    // A frame with no new paint: upload() does not run (paintCount stalled,
    // extraUploads drained). No needsUpdate is armed by upload().
    runtime.frame()
    expect(disposeSpy).not.toHaveBeenCalled()

    // But the tier change still re-cuts the canvas and reclaims.
    const versionBeforeReclaim = versionOf(runtime)
    runtime.proposeTier(1, 0.5)
    expect(runtime.source.canvas.width).toBe(400)
    expect(runtime.source.canvas.height).toBe(300)
    expect(disposeSpy).toHaveBeenCalledTimes(1)
    // needsUpdate re-armed (version advanced).
    expect(versionOf(runtime)).toBeGreaterThan(versionBeforeReclaim)
  })
})
