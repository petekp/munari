import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  createCanvasFrameSource,
  type PresentationRequirement,
} from '@munari/core'
import {
  assertFrameMaterialSupported,
  createFrameSurfaceRuntime,
  resolveFrameSurfaceDevelopment,
} from './FrameSurface'

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

    expect(runtime.texture).toBeInstanceOf(THREE.CanvasTexture)
    expect(runtime.texture.image).toBe(el)
    expect(runtime.texture.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(runtime.texture.premultiplyAlpha).toBe(true)
    expect(runtime.texture.generateMipmaps).toBe(true)
    expect(runtime.texture.minFilter).toBe(THREE.LinearMipmapLinearFilter)
    expect(runtime.texture.anisotropy).toBe(8)
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
    runtime.beginPresentationPass(requested, true, true)
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
    runtime.beginPresentationPass(requested, false, true, warn)
    expect(runtime.takePresentationReceipt(warn)).toBeNull()
    runtime.beginPresentationPass(requested, true, false, warn)
    expect(runtime.takePresentationReceipt(warn)).toBeNull()

    expect(runtime.takeDrawReceipt()).toEqual({ surfaceEpoch: 30, frame: uploaded })
    expect(runtime.rejectedPresentationDraws(requested.transferId)).toBe(2)
    expect(warn).toHaveBeenCalledTimes(1)

    runtime.dispose()
  })

  it('emits each accepted presentation tuple once', () => {
    const source = createCanvasFrameSource(canvas(), { premultiplyAlpha: false })
    const runtime = createFrameSurfaceRuntime(source, 33, false, () => {})
    const first = source.publish()
    const requested = requirement(first.sourceId, first.generation)

    runtime.texture.onUpdate?.(runtime.texture)
    runtime.beginPresentationPass(requested, true, true)
    expect(runtime.takePresentationReceipt()?.frame).toEqual(first)
    runtime.beginPresentationPass(requested, true, true)
    expect(runtime.takePresentationReceipt()).toBeNull()

    const second = source.publish()
    runtime.texture.onUpdate?.(runtime.texture)
    runtime.beginPresentationPass(requested, true, true)
    expect(runtime.takePresentationReceipt()?.frame).toEqual(second)
    runtime.beginPresentationPass(requested, true, true)
    expect(runtime.takePresentationReceipt()).toBeNull()

    runtime.dispose()
  })

  it('rejects a requirement that the retained source frame cannot satisfy', () => {
    const source = createCanvasFrameSource(canvas(), { premultiplyAlpha: false })
    const runtime = createFrameSurfaceRuntime(source, 35, false, () => {})
    const uploaded = source.publish()
    runtime.texture.onUpdate?.(runtime.texture)

    runtime.beginPresentationPass(
      requirement(uploaded.sourceId + 1, uploaded.generation),
      true,
      true,
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
    const versionAtDispose = runtime.texture.version

    source.publish()
    runtime.dispose()
    source.publish()
    staleUpload?.(runtime.texture)

    expect(runtime.texture.version).toBe(versionAtDispose + 1)
    expect(invalidations).toBe(1)
    expect(runtime.texture.onUpdate).toBeNull()
    expect(runtime.takeDrawReceipt()).toBeNull()
    const current = source.currentFrame()
    runtime.beginPresentationPass(requirement(current.sourceId, current.generation), true, true)
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
      'ONE / ONE_MINUS_SRC_ALPHA',
    )
    expect(() => assertFrameMaterialSupported(premultiplied, 'none')).not.toThrow()
    expect(() => assertFrameMaterialSupported(straight, 'standard')).not.toThrow()
    expect(() => assertFrameMaterialSupported(straight, 'unlit')).not.toThrow()
  })
})
