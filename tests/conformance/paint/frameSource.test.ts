// @vitest-environment happy-dom

// Frame identity — a name for pixels, not a proof of pixels.
//
// createCanvasFrameSource gives a caller-owned canvas a stable sourceId
// and a generation that advances only on publish() (decisions.md #24).
// These cases pin the identity discipline the binding's receipts stand
// on: format frozen at birth (the GPU alpha representation is fixed at
// first upload), the generation incremented before subscribers are
// notified (a subscriber sampling inside the notification must see the
// published frame, or a merged upload gets misattributed), cleanup
// idempotent. Structural custom-producer acceptance is checked by the
// compile-only API suite.

import { describe, expect, it } from 'vitest'

import {
  createCanvasFrameSource,
  type FrameId,
} from '@munari/core'

describe('createCanvasFrameSource', () => {
  it('keeps the caller canvas and fixes its pixel format at birth', () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180

    const source = createCanvasFrameSource(canvas, { premultiplyAlpha: true })

    expect(source.canvas).toBe(canvas)
    expect([canvas.width, canvas.height]).toEqual([320, 180])
    expect(source.format).toEqual({ colorSpace: 'srgb', premultiplyAlpha: true })
    expect(Object.isFrozen(source.format)).toBe(true)
    expect(Object.isFrozen(source)).toBe(true)
  })

  it('requires and preserves straight-alpha metadata too', () => {
    const source = createCanvasFrameSource(document.createElement('canvas'), {
      premultiplyAlpha: false,
    })

    expect(source.format).toEqual({ colorSpace: 'srgb', premultiplyAlpha: false })
  })

  it('starts at generation zero with a stable, unique numeric source id', () => {
    const first = createCanvasFrameSource(document.createElement('canvas'), {
      premultiplyAlpha: true,
    })
    const second = createCanvasFrameSource(document.createElement('canvas'), {
      premultiplyAlpha: true,
    })

    const born = first.currentFrame()
    expect(born).toEqual({ sourceId: expect.any(Number), generation: 0 })
    expect(second.currentFrame().sourceId).not.toBe(born.sourceId)

    first.publish()
    first.publish()
    expect(first.currentFrame()).toEqual({ sourceId: born.sourceId, generation: 2 })
  })

  it('increments before it notifies and returns the frame it published', () => {
    const source = createCanvasFrameSource(document.createElement('canvas'), {
      premultiplyAlpha: true,
    })
    const seen: FrameId[] = []
    source.subscribe(() => seen.push(source.currentFrame()))

    const first = source.publish()
    const second = source.publish()

    expect(first).toEqual({ sourceId: second.sourceId, generation: 1 })
    expect(second).toEqual({ sourceId: first.sourceId, generation: 2 })
    expect(seen).toEqual([first, second])
  })

  it('stops notifying after cleanup, including repeated cleanup', () => {
    const source = createCanvasFrameSource(document.createElement('canvas'), {
      premultiplyAlpha: true,
    })
    const seen: FrameId[] = []
    const unsubscribe = source.subscribe(() => seen.push(source.currentFrame()))

    source.publish()
    unsubscribe()
    unsubscribe()
    source.publish()

    expect(seen.map(frame => frame.generation)).toEqual([1])
    expect(source.currentFrame().generation).toBe(2)
  })
})
