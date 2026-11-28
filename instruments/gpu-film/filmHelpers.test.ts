import { describe, expect, it } from 'vitest'
import { computeRegionDiff, verifyTransitionSequence } from './filmHelpers.mjs'

function solidFrame(w: number, h: number, r: number, g: number, b: number) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  }
  return data
}

describe('gpu-film verification helpers', () => {
  it('computes exact zero and non-zero diffs across a padded bounding region', () => {
    const a = solidFrame(16, 16, 200, 100, 50)
    const b = solidFrame(16, 16, 200, 130, 80)
    expect(computeRegionDiff(a, a, 16, 16, { left: 2, top: 2, width: 10, height: 10 })).toEqual({
      meanAbsDiff: 0,
      p95AbsDiff: 0,
      maxAbsDiff: 0,
    })
    expect(computeRegionDiff(a, b, 16, 16, { left: 2, top: 2, width: 10, height: 10 })).toEqual({
      meanAbsDiff: 20,
      p95AbsDiff: 20,
      maxAbsDiff: 30,
    })
  })

  it('passes smooth transitions and rejects frozen, snapping, and spiking sequences', () => {
    expect(verifyTransitionSequence([4.2, 5.1, 3.8], 12.0).ok).toBe(true)
    expect(verifyTransitionSequence([0, 0, 0], 0.1).ok).toBe(false)
    expect(verifyTransitionSequence([0, 11.8, 0], 12.0).ok).toBe(false)
    expect(verifyTransitionSequence([0.3, 11.8, 0.3], 12.0).ok).toBe(false)
    expect(verifyTransitionSequence([3.0, 55.0, 3.0], 12.0, { maxAdjacentDiff: 20 }).ok).toBe(false)
  })
})
