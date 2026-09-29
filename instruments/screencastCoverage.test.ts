import { describe, expect, it } from 'vitest'
import { IncompleteScreencastError, requirePageFrameCoverage } from './screencastCoverage'

// Each pair is [time in ms, page frame shown].
const frames = (rows: [number, number | null][]) => rows.map(([t, pageFrame]) => ({ t, pageFrame }))

describe('the page frames a recording needs for a visual verdict', () => {
  it('accepts every page frame recorded, however far apart the images are', () => {
    // Hosted recording, 2026-09-28: a 35.8 ms gap with no page frame skipped.
    expect(() => requirePageFrameCoverage(frames([[-11, 0], [4, 1], [20, 2], [56, 3], [74, 4], [85, 5], [110, 5], [153, 5]]), 0, 150))
      .not.toThrow()
  })

  it('ignores page frames skipped outside the requested interval', () => {
    expect(() => requirePageFrameCoverage(frames([[-60, 0], [-8, 4], [8, 5], [24, 6], [40, 7], [90, 12]]), 0, 30))
      .not.toThrow()
  })

  it('refuses a skipped page frame even when the images arrive 16 ms apart', () => {
    expect(() => requirePageFrameCoverage(frames([[-8, 0], [8, 1], [24, 3], [40, 4], [56, 5], [88, 6]]), 0, 80))
      .toThrow(IncompleteScreencastError)
  })

  it('names how many page frames went unrecorded', () => {
    expect(() => requirePageFrameCoverage(frames([[-1, 0], [400, 13]]), 0, 150)).toThrow('skipped 12 page frames after frame 0')
  })

  const unrecordedEnds: { rows: [number, number][] }[] = [
    { rows: [] },
    { rows: [[10, 0], [20, 1], [30, 2]] },
    { rows: [[-10, 0], [10, 1], [20, 2]] },
  ]
  it.each(unrecordedEnds)('refuses an interval with an unrecorded end: $rows', ({ rows }) => {
    expect(() => requirePageFrameCoverage(frames(rows), 0, 30)).toThrow('both ends')
  })

  const disordered: { rows: [number, number][] }[] = [
    { rows: [[0, 0], [0, 1], [20, 2]] },
    { rows: [[0, 0], [20, 1], [10, 2]] },
    { rows: [[0, 0], [NaN, 1], [20, 2]] },
  ]
  it.each(disordered)('refuses invalid timestamp order: $rows', ({ rows }) => {
    expect(() => requirePageFrameCoverage(frames(rows), 0, 20)).toThrow('timestamps')
  })

  it('treats an unreadable page frame as a broken instrument, not a retry', () => {
    const unreadable = () => requirePageFrameCoverage(frames([[0, 0], [10, null], [20, 2]]), 0, 20)
    expect(unreadable).toThrow('no readable page frame')
    expect(unreadable).not.toThrow(IncompleteScreencastError)
  })

  it('treats a page frame that goes backward as a broken instrument', () => {
    expect(() => requirePageFrameCoverage(frames([[0, 3], [10, 2], [20, 3]]), 0, 20)).toThrow('backward')
  })
})
