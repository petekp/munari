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
// idempotent, and the contract structural so a custom producer needs no
// factory.

import { describe, expect, it, vi } from 'vitest'

import {
  createCanvasFrameSource,
  type FrameSource,
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
    const seen = vi.fn(() => source.currentFrame())
    source.subscribe(seen)

    const first = source.publish()
    const second = source.publish()

    expect(first).toEqual({ sourceId: second.sourceId, generation: 1 })
    expect(second).toEqual({ sourceId: first.sourceId, generation: 2 })
    expect(seen.mock.results.map((result) => result.value)).toEqual([first, second])
    expect(seen).toHaveBeenNthCalledWith(1)
    expect(seen).toHaveBeenNthCalledWith(2)
  })

  it('stops notifying after cleanup, including repeated cleanup', () => {
    const source = createCanvasFrameSource(document.createElement('canvas'), {
      premultiplyAlpha: true,
    })
    const notify = vi.fn()
    const unsubscribe = source.subscribe(notify)

    source.publish()
    unsubscribe()
    unsubscribe()
    source.publish()

    expect(notify).toHaveBeenCalledTimes(1)
    expect(source.currentFrame().generation).toBe(2)
  })
})

describe('FrameSource', () => {
  it('is structural so a custom producer does not need the factory', () => {
    const frame = { sourceId: 84, generation: 12 }
    const custom = {
      canvas: document.createElement('canvas'),
      format: { colorSpace: 'srgb', premultiplyAlpha: false },
      currentFrame: () => frame,
      subscribe: (_notify: () => void) => () => {},
    } satisfies FrameSource

    expect(custom.currentFrame()).toBe(frame)
  })
})
