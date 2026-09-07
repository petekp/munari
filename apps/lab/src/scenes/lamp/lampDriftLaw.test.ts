import { describe, expect, it } from 'vitest'
import { lampDriftOffset } from './lampDriftLaw'

describe('Lamp release continuity', () => {
  it('starts at the release point', () => {
    expect(lampDriftOffset(0)).toEqual({ x: 0, y: 0 })
  })

  it('moves less than one pixel in the first frame, including a 30Hz frame', () => {
    // The previous ellipse added 34px regardless of elapsed time. These
    // bounds test release continuity at actual frame intervals.
    for (const hz of [30, 60, 120, 240]) {
      const offset = lampDriftOffset(1000 / hz)
      expect(Math.hypot(offset.x, offset.y)).toBeLessThan(1)
    }
  })

  it('returns to the release point without a step when the 22-second cycle repeats', () => {
    const before = lampDriftOffset(22000 - 1000 / 60)
    const after = lampDriftOffset(22000 + 1000 / 60)
    const end = lampDriftOffset(22000)
    expect(end.x).toBeCloseTo(0, 10)
    expect(end.y).toBeCloseTo(0, 10)
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1)
  })
})
