import { describe, expect, it } from 'vitest'
import { coveredBlocks, discCoversRect, holdKey, updateHolds, type Block } from './opticsLod'

const rect: Block = { id: 'aqua', x: 100, y: 100, w: 200, h: 100 }
const at = (x: number, y: number, r: number) => ({ x, y, r })

describe('discCoversRect — nearest point, not bounding box', () => {
  it('covers when the disc sits inside the rectangle', () => {
    expect(discCoversRect(at(200, 150, 20), rect)).toBe(true)
  })

  it('covers when the rectangle sits inside the disc', () => {
    expect(discCoversRect(at(200, 150, 400), rect)).toBe(true)
  })

  it('covers on an edge approach and stops one pixel past the reach', () => {
    expect(discCoversRect(at(200, 60, 40), rect)).toBe(true)
    expect(discCoversRect(at(200, 59, 40), rect)).toBe(false)
  })

  it('counts tangency, so a block is never left soft on a rounding error', () => {
    expect(discCoversRect(at(200, 50, 50), rect)).toBe(true)
  })

  it('declines a disc past a corner that a bounding-box test would claim', () => {
    // Inside both the x-span-extended and y-span-extended slabs, but 42 px
    // from the corner itself with a 30 px reach.
    const disc = at(rect.x - 30, rect.y - 30, 30)
    expect(disc.x).toBeGreaterThan(rect.x - rect.w)
    expect(discCoversRect(disc, rect)).toBe(false)
    expect(discCoversRect(at(rect.x - 30, rect.y - 30, 43), rect)).toBe(true)
  })

  it('reports nothing covered when no instrument is in hand', () => {
    expect(coveredBlocks([rect], null)).toEqual([])
  })
})

describe('updateHolds — hysteresis, so a drag costs one paint per block', () => {
  const HOLD = 400

  it('pins a covered block immediately, with no deadline', () => {
    expect(updateHolds([], ['aqua'], 0, HOLD)).toEqual([{ id: 'aqua', until: Infinity }])
  })

  it('starts the clock when the glass leaves', () => {
    const held = updateHolds([], ['aqua'], 0, HOLD)
    expect(updateHolds(held, [], 1000, HOLD)).toEqual([{ id: 'aqua', until: 1400 }])
  })

  it('keeps the block pinned until the deadline, then drops it', () => {
    let holds = updateHolds([], ['aqua'], 0, HOLD)
    holds = updateHolds(holds, [], 1000, HOLD)
    expect(updateHolds(holds, [], 1399, HOLD)).toHaveLength(1)
    expect(updateHolds(holds, [], 1400, HOLD)).toHaveLength(0)
  })

  it('does not restart the clock frame after frame while releasing', () => {
    // The bug this pins: recomputing `now + holdMs` on every uncovered
    // frame means a block never expires while the scene keeps drawing.
    let holds = updateHolds([], ['aqua'], 0, HOLD)
    holds = updateHolds(holds, [], 1000, HOLD)
    for (const t of [1100, 1200, 1300]) holds = updateHolds(holds, [], t, HOLD)
    expect(holds[0].until).toBe(1400)
    expect(updateHolds(holds, [], 1400, HOLD)).toHaveLength(0)
  })

  it('cancels a pending release when the glass wanders back', () => {
    let holds = updateHolds([], ['aqua'], 0, HOLD)
    holds = updateHolds(holds, [], 1000, HOLD)
    holds = updateHolds(holds, ['aqua'], 1200, HOLD)
    expect(holds).toEqual([{ id: 'aqua', until: Infinity }])
    // …and the full hold is available again from the new departure.
    expect(updateHolds(holds, [], 1300, HOLD)[0].until).toBe(1700)
  })

  it('holds several blocks independently as the glass crosses a row', () => {
    let holds = updateHolds([], ['a', 'b'], 0, HOLD)
    holds = updateHolds(holds, ['b', 'c'], 100, HOLD)
    expect(holds).toEqual([
      { id: 'a', until: 500 },
      { id: 'b', until: Infinity },
      { id: 'c', until: Infinity },
    ])
  })

  it('sorts by id, so the derived key does not churn on coverage order', () => {
    expect(holdKey(updateHolds([], ['nokia', 'aqua'], 0, HOLD))).toBe('aqua nokia')
    expect(holdKey(updateHolds([], ['aqua', 'nokia'], 0, HOLD))).toBe('aqua nokia')
  })
})
