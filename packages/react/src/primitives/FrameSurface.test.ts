import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  createCanvasFrameSource,
  type PresentationRequirement,
} from '@munari/core'
import {
  assertFrameMaterialSupported,
  createFrameSurfaceRuntime,
  geometryDraws,
  hearingGatedRaycast,
  resolveFrameSurfaceDevelopment,
} from './FrameSurface'

// SAFETY: a stub, not a canvas. The code under test reads `width` and
// `height` and nothing else — a real element would drag a DOM into a test
// that is about arithmetic.
const canvas = () => ({ width: 4, height: 4 }) as HTMLCanvasElement

const requirement = (
  sourceId: number,
  generation: number,
  transferId = 5,
  presentationRevision = 9,
): PresentationRequirement => ({
  transferId,
  frame: { sourceId, generation },
  presentationRevision,
})

// A draw that can reach the canvas, writes color, and has something to draw.
const SHOWN = { outputEligible: true, colorWrite: true, drawable: true }

describe('FrameSurface runtime', () => {
  it('warns only in an explicit development or test environment', () => {
    expect(resolveFrameSurfaceDevelopment(false, 'development')).toBe(false)
    expect(resolveFrameSurfaceDevelopment(undefined, 'production')).toBe(false)
    expect(resolveFrameSurfaceDevelopment(undefined, undefined)).toBe(false)
    expect(resolveFrameSurfaceDevelopment(true, 'production')).toBe(true)
    expect(resolveFrameSurfaceDevelopment(undefined, 'test')).toBe(true)
  })

  it('configures the exact caller canvas before exposing the texture', () => {
    const el = canvas()
    const source = createCanvasFrameSource(el, { premultiplyAlpha: true })
    const runtime = createFrameSurfaceRuntime(source, 17, false, () => {})

    expect(runtime.texture.image).toBe(el)
    expect(runtime.texture.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(runtime.texture.premultiplyAlpha).toBe(true)
    expect(runtime.surfaceEpoch).toBe(17)

    runtime.dispose()
  })

  it('samples at upload, coalesces publications, and releases each receipt once', () => {
    const source = createCanvasFrameSource(canvas(), { premultiplyAlpha: false })
    const invalidations: number[] = []
    const runtime = createFrameSurfaceRuntime(source, 23, false, () => {
      invalidations.push(runtime.texture.version)
    })

    source.publish()
    const uploaded = source.publish()
    expect(invalidations).toHaveLength(2)
    expect(runtime.takeDrawReceipt()).toBeNull()

    runtime.texture.onUpdate?.(runtime.texture)
    const publishedAfterUpload = source.publish()

    expect(runtime.takeDrawReceipt()).toEqual({ surfaceEpoch: 23, frame: uploaded })
    expect(runtime.takeDrawReceipt()).toBeNull()

    runtime.texture.onUpdate?.(runtime.texture)
    expect(runtime.takeDrawReceipt()).toEqual({
      surfaceEpoch: 23,
      frame: publishedAfterUpload,
    })

    runtime.dispose()
  })

  it('retains the uploaded frame for a later eligible presentation draw', () => {
    const source = createCanvasFrameSource(canvas(), { premultiplyAlpha: false })
    const runtime = createFrameSurfaceRuntime(source, 29, false, () => {})
    const uploaded = source.publish()

    runtime.texture.onUpdate?.(runtime.texture)
    expect(runtime.takeDrawReceipt()).toEqual({ surfaceEpoch: 29, frame: uploaded })
    expect(runtime.takeDrawReceipt()).toBeNull()

    const requested = requirement(uploaded.sourceId, uploaded.generation)
    runtime.beginPresentationPass(requested, SHOWN)
    expect(runtime.takePresentationReceipt()).toEqual({
      ...requested,
      frame: uploaded,
      surfaceEpoch: 29,
    })
    // The presentation path neither recreates nor consumes a frame receipt.
    expect(runtime.takeDrawReceipt()).toBeNull()

    runtime.dispose()
  })

  it('rejects off-screen and color-disabled draws without losing the frame receipt', () => {
    const source = createCanvasFrameSource(canvas(), { premultiplyAlpha: false })
    const runtime = createFrameSurfaceRuntime(source, 30, false, () => {})
    const uploaded = source.publish()
    const requested = requirement(uploaded.sourceId, uploaded.generation)
    const warn = vi.fn()

    runtime.texture.onUpdate?.(runtime.texture)
    runtime.beginPresentationPass(requested, { ...SHOWN, outputEligible: false }, warn)
    expect(runtime.takePresentationReceipt(warn)).toBeNull()
    runtime.beginPresentationPass(requested, { ...SHOWN, colorWrite: false }, warn)
    expect(runtime.takePresentationReceipt(warn)).toBeNull()
    runtime.beginPresentationPass(requested, { ...SHOWN, drawable: false }, warn)
    expect(runtime.takePresentationReceipt(warn)).toBeNull()

    expect(runtime.takeDrawReceipt()).toEqual({ surfaceEpoch: 30, frame: uploaded })
    expect(runtime.rejectedPresentationDraws(requested.transferId)).toBe(3)
    expect(warn).toHaveBeenCalledTimes(1)

    runtime.dispose()
  })

  it('delivers each accepted presentation tuple once', () => {
    const source = createCanvasFrameSource(canvas(), { premultiplyAlpha: false })
    const runtime = createFrameSurfaceRuntime(source, 33, false, () => {})
    const first = source.publish()
    const requested = requirement(first.sourceId, first.generation)

    runtime.texture.onUpdate?.(runtime.texture)
    runtime.beginPresentationPass(requested, SHOWN)
    const firstReceipt = runtime.takePresentationReceipt()
    expect(firstReceipt?.frame).toEqual(first)
    expect(runtime.deliverPresentation(firstReceipt!)).toBe(true)
    expect(runtime.deliverPresentation(firstReceipt!)).toBe(false)
    runtime.beginPresentationPass(requested, SHOWN)
    expect(runtime.takePresentationReceipt()).toBeNull()

    const second = source.publish()
    runtime.texture.onUpdate?.(runtime.texture)
    runtime.beginPresentationPass(requested, SHOWN)
    const secondReceipt = runtime.takePresentationReceipt()
    expect(secondReceipt?.frame).toEqual(second)
    expect(runtime.deliverPresentation(secondReceipt!)).toBe(true)

    runtime.dispose()
  })

  it('keeps a taken but undelivered tuple available to the next draw', () => {
    // The host discards a deferred receipt whose frame never reached the
    // screen; the next eligible draw must still present that tuple.
    const source = createCanvasFrameSource(canvas(), { premultiplyAlpha: false })
    const runtime = createFrameSurfaceRuntime(source, 34, false, () => {})
    const uploaded = source.publish()
    const requested = requirement(uploaded.sourceId, uploaded.generation)

    runtime.texture.onUpdate?.(runtime.texture)
    runtime.beginPresentationPass(requested, SHOWN)
    expect(runtime.takePresentationReceipt()).not.toBeNull()
    runtime.beginPresentationPass(requested, SHOWN)
    const retried = runtime.takePresentationReceipt()
    expect(retried?.frame).toEqual(uploaded)
    expect(runtime.deliverPresentation(retried!)).toBe(true)

    runtime.dispose()
  })

  it('issues no receipt for a source over the renderer texture limit', () => {
    // WebGPU rejects the oversized upload after Three reports it updated.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const source = createCanvasFrameSource(canvas(), { premultiplyAlpha: false })
    let invalidations = 0
    const runtime = createFrameSurfaceRuntime(source, 36, false, () => invalidations++, 2)
    const published = source.publish()

    runtime.texture.onUpdate?.(runtime.texture)
    expect(invalidations).toBe(0)
    expect(runtime.takeDrawReceipt()).toBeNull()
    runtime.beginPresentationPass(requirement(published.sourceId, published.generation), SHOWN)
    expect(runtime.takePresentationReceipt()).toBeNull()
    expect(error).toHaveBeenCalledTimes(1)

    runtime.dispose()
    error.mockRestore()
  })

  it('rejects a requirement that the retained source frame cannot satisfy', () => {
    const source = createCanvasFrameSource(canvas(), { premultiplyAlpha: false })
    const runtime = createFrameSurfaceRuntime(source, 35, false, () => {})
    const uploaded = source.publish()
    runtime.texture.onUpdate?.(runtime.texture)

    runtime.beginPresentationPass(
      requirement(uploaded.sourceId + 1, uploaded.generation),
      SHOWN,
    )
    expect(runtime.takePresentationReceipt()).toBeNull()
    expect(runtime.rejectedPresentationDraws(5)).toBe(1)

    runtime.dispose()
  })

  it('rejects queued upload and draw work after disposal', () => {
    const source = createCanvasFrameSource(canvas(), { premultiplyAlpha: true })
    let invalidations = 0
    const runtime = createFrameSurfaceRuntime(source, 31, false, () => invalidations++)
    const staleUpload = runtime.texture.onUpdate
    source.publish()
    runtime.dispose()
    const versionAtDispose = runtime.texture.version
    source.publish()
    staleUpload?.(runtime.texture)

    expect(runtime.texture.version).toBe(versionAtDispose)
    expect(invalidations).toBe(1)
    expect(runtime.texture.onUpdate).toBeNull()
    expect(runtime.takeDrawReceipt()).toBeNull()
    const current = source.currentFrame()
    runtime.beginPresentationPass(requirement(current.sourceId, current.generation), SHOWN)
    expect(runtime.takePresentationReceipt()).toBeNull()
  })

  it('releases stale GL storage before a resized canvas uploads', () => {
    const el = canvas()
    const source = createCanvasFrameSource(el, { premultiplyAlpha: true })
    const runtime = createFrameSurfaceRuntime(source, 37, false, () => {})
    let disposals = 0
    runtime.texture.addEventListener('dispose', () => disposals++)

    el.width = 8
    el.height = 6
    source.publish()

    expect(disposals).toBe(1)
    runtime.dispose()
    expect(disposals).toBe(2)
  })

  it('keeps receipts from replaced sources in separate surface epochs', () => {
    const oldSource = createCanvasFrameSource(canvas(), { premultiplyAlpha: false })
    let oldInvalidations = 0
    const oldRuntime = createFrameSurfaceRuntime(
      oldSource,
      41,
      false,
      () => oldInvalidations++,
    )
    const staleUpload = oldRuntime.texture.onUpdate
    oldSource.publish()
    oldRuntime.dispose()

    const nextSource = createCanvasFrameSource(canvas(), { premultiplyAlpha: false })
    let nextInvalidations = 0
    const nextRuntime = createFrameSurfaceRuntime(
      nextSource,
      42,
      false,
      () => nextInvalidations++,
    )
    const nextFrame = nextSource.publish()
    staleUpload?.(oldRuntime.texture)
    nextRuntime.texture.onUpdate?.(nextRuntime.texture)

    expect(oldRuntime.takeDrawReceipt()).toBeNull()
    expect(nextRuntime.takeDrawReceipt()).toEqual({ surfaceEpoch: 42, frame: nextFrame })
    expect(oldInvalidations).toBe(1)
    expect(nextInvalidations).toBe(1)

    nextRuntime.dispose()
  })

  it('rejects premultiplied input on both built-in materials', () => {
    const premultiplied = createCanvasFrameSource(canvas(), { premultiplyAlpha: true })
    const straight = createCanvasFrameSource(canvas(), { premultiplyAlpha: false })

    expect(() => assertFrameMaterialSupported(premultiplied, 'standard')).toThrow(
      'material="none"',
    )
    expect(() => assertFrameMaterialSupported(premultiplied, 'unlit')).toThrow(
      'premultiplied frames',
    )
    expect(() => assertFrameMaterialSupported(premultiplied, 'none')).not.toThrow()
    expect(() => assertFrameMaterialSupported(straight, 'standard')).not.toThrow()
    expect(() => assertFrameMaterialSupported(straight, 'unlit')).not.toThrow()
  })

  // Input follows the eye (decisions.md #33): a crossing-participating mesh
  // must not be pointer matter while the page copy is the presented one.
  // The gate lives in the raycast so no raycaster — r3f's or a scene's own
  // Raycaster — ever counts an intersection the law forbids.
  it('the hearing gate silences the raycast, and only the raycast', () => {
    const geometry = new THREE.PlaneGeometry(2, 2)
    const material = new THREE.MeshBasicMaterial()
    try {
      let hears = false
      const mesh = new THREE.Mesh(geometry, material)
      mesh.raycast = hearingGatedRaycast(() => hears)
      mesh.updateMatrixWorld()
      const ray = new THREE.Raycaster(new THREE.Vector3(0.2, 0.1, 1), new THREE.Vector3(0, 0, -1))
      const hits: THREE.Intersection[] = []
      mesh.raycast(ray, hits)
      expect(hits).toHaveLength(0)
      hears = true
      mesh.raycast(ray, hits)
      expect(hits).toHaveLength(1)
      expect(hits[0]?.object).toBe(mesh)
    } finally {
      geometry.dispose()
      material.dispose()
    }
  })
})

describe('geometryDraws', () => {
  it('is false when the vertices or the draw range leave nothing to draw', () => {
    expect(geometryDraws(new THREE.PlaneGeometry(1, 1))).toBe(true)

    const empty = new THREE.BufferGeometry()
    empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
    expect(geometryDraws(empty)).toBe(false)

    const ranged = new THREE.PlaneGeometry(1, 1)
    ranged.setDrawRange(0, 0)
    expect(geometryDraws(ranged)).toBe(false)
    // The plane's index has 6 entries; a range starting past them is empty.
    ranged.setDrawRange(6, 3)
    expect(geometryDraws(ranged)).toBe(false)
    ranged.setDrawRange(3, 3)
    expect(geometryDraws(ranged)).toBe(true)
  })
})
