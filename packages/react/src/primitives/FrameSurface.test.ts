import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createCanvasFrameSource } from '@munari/core'
import {
  assertFrameMaterialSupported,
  createFrameSurfaceRuntime,
} from './FrameSurface'

const canvas = () => ({ width: 4, height: 4 }) as HTMLCanvasElement

describe('FrameSurface runtime', () => {
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
