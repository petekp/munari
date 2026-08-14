import { describe, expect, it, vi } from 'vitest'
import type {
  DomPaintReceipt,
  DomTextureSource,
  PresentationRequirement,
} from '@munari/core'
import { createDomSurfaceRuntime } from './DomSurfaceRuntime'

function sourceHarness(sourceId = 70) {
  let receipt: DomPaintReceipt | null = null
  let generation = 0
  const listeners = new Set<(next: DomPaintReceipt) => void>()
  const canvas = { width: 80, height: 40 } as HTMLCanvasElement
  const source: DomTextureSource = {
    sourceId,
    canvas,
    element: {} as HTMLElement,
    repaint: () => {},
    scale: () => 1,
    size: () => [80, 40],
    paintedSize: () => receipt?.paintedSize ?? [0, 0],
    currentPaint: () => receipt,
    subscribePaint(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setScale: () => {},
    setSize: () => {},
    resettle: () => {},
    painted: () => receipt !== null,
    paintCount: () => generation,
    dispose: () => listeners.clear(),
  }
  return {
    source,
    publish() {
      receipt = Object.freeze({
        frame: Object.freeze({ sourceId, generation: ++generation }),
        paintedSize: Object.freeze([80, 40] as const),
        storeSize: Object.freeze([canvas.width, canvas.height] as const),
      })
      for (const listener of listeners) listener(receipt)
      return receipt
    },
    subscribers: () => listeners.size,
  }
}

const requirement = (
  sourceId: number,
  generation: number,
): PresentationRequirement => ({
  transferId: 5,
  frame: { sourceId, generation },
  presentationRevision: 9,
})

describe('DOM Surface runtime', () => {
  it('publishes paint before invalidating and samples the latest receipt at upload', () => {
    const harness = sourceHarness()
    const order: string[] = []
    const runtime = createDomSurfaceRuntime(
      harness.source,
      11,
      () => order.push('invalidate'),
      (receipt) => order.push(`paint:${receipt.frame.generation}`),
    )

    harness.publish()
    const latest = harness.publish()
    expect(order).toEqual(['paint:1', 'invalidate', 'paint:2', 'invalidate'])
    expect(runtime.takeDrawReceipt()).toBeNull()

    expect(runtime.recordUpload()).toBe(latest)
    expect(runtime.takeDrawReceipt()).toEqual({ surfaceEpoch: 11, frame: latest.frame })
    expect(runtime.takeDrawReceipt()).toBeNull()
    // A trailing upload of the same DOM paint does not duplicate its draw receipt.
    runtime.recordUpload()
    expect(runtime.takeDrawReceipt()).toBeNull()
    runtime.dispose()
  })

  it('closes the possible first-paint subscription race', () => {
    const harness = sourceHarness()
    const existing = harness.publish()
    const painted = vi.fn()
    const invalidate = vi.fn()
    const runtime = createDomSurfaceRuntime(
      harness.source,
      12,
      invalidate,
      painted,
    )
    expect(painted).toHaveBeenCalledWith(existing)
    expect(invalidate).toHaveBeenCalledTimes(1)
    runtime.dispose()
  })

  it('retains an uploaded paint for qualified, deduplicated presentation', () => {
    const harness = sourceHarness()
    const runtime = createDomSurfaceRuntime(harness.source, 13, () => {}, () => {})
    const paint = harness.publish()
    runtime.recordUpload()
    const requested = requirement(paint.frame.sourceId, paint.frame.generation)

    runtime.beginPresentationPass(requested, true, true)
    expect(runtime.takePresentationReceipt()).toEqual({
      ...requested,
      frame: paint.frame,
      surfaceEpoch: 13,
    })
    runtime.beginPresentationPass(requested, true, true)
    expect(runtime.takePresentationReceipt()).toBeNull()
    runtime.dispose()
  })

  it('rejects ineligible draws and source-mismatched requirements', () => {
    const harness = sourceHarness()
    const runtime = createDomSurfaceRuntime(harness.source, 14, () => {}, () => {})
    const paint = harness.publish()
    runtime.recordUpload()
    const requested = requirement(paint.frame.sourceId, paint.frame.generation)
    const warn = vi.fn()

    runtime.beginPresentationPass(requested, false, true, warn)
    expect(runtime.takePresentationReceipt(warn)).toBeNull()
    runtime.beginPresentationPass(requested, true, false, warn)
    expect(runtime.takePresentationReceipt(warn)).toBeNull()
    runtime.beginPresentationPass(requirement(paint.frame.sourceId + 1, 1), true, true, warn)
    expect(runtime.takePresentationReceipt(warn)).toBeNull()
    expect(runtime.rejectedPresentationDraws(5)).toBe(3)
    expect(warn).toHaveBeenCalledTimes(1)
    runtime.dispose()
  })

  it('stops publications and receipts after disposal', () => {
    const harness = sourceHarness()
    const painted = vi.fn()
    const invalidate = vi.fn()
    const runtime = createDomSurfaceRuntime(
      harness.source,
      15,
      invalidate,
      painted,
    )
    const first = harness.publish()
    runtime.recordUpload()
    runtime.dispose()
    harness.publish()

    expect(harness.subscribers()).toBe(0)
    expect(painted).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(runtime.recordUpload()).toBeNull()
    expect(runtime.takeDrawReceipt()).toBeNull()
    runtime.beginPresentationPass(requirement(first.frame.sourceId, 1), true, true)
    expect(runtime.takePresentationReceipt()).toBeNull()
  })
})
