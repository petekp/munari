// The outline law's contract (logoContour.ts). These are the clauses the
// slab builder relies on, and each one is a shape a wordmark actually
// contains: a plain stroke, the counter of an 'a', the two pieces of an
// 'i', a swash that runs off the capture box.
//
// Everything here is stated in NORMALIZED coordinates — u and v across
// the sample box, v up — because that is what the law returns and what
// logoSlab consumes. The mapping from a sample to a coordinate is
// itself load-bearing (a half-texel shift would put every wall half a
// pixel off its own glyph), so it gets pinned with exact numbers.
//
// The bitmaps here are deliberately tiny, which puts their blobs near
// the speckle floor a real 384-texel readback never approaches. So the
// structural clauses lower that floor and one clause owns it alone —
// otherwise every test would be secretly testing the filter.

import { describe, expect, it } from 'vitest'
import {
  pointInRing,
  ringArea,
  simplifyRing,
  traceContour,
  type ContourOptions,
} from './logoContour'

/** A readable bitmap. Row 0 of the literal is the TOP row; the samples
 *  come back from GL bottom-up, so the literal is flipped on the way
 *  in — which is exactly the flip the real readback carries. */
function trace(rows: string[], options: ContourOptions = {}) {
  const h = rows.length
  const w = rows[0].length
  const a = new Array<number>(w * h).fill(0)
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) a[(h - 1 - r) * w + c] = rows[r][c] === '#' ? 1 : 0
  }
  return traceContour(a, w, h, { minArea: 1, ...options })
}

function bounds(ring: number[]) {
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (let i = 0; i < ring.length; i += 2) {
    x0 = Math.min(x0, ring[i])
    x1 = Math.max(x1, ring[i])
    y0 = Math.min(y0, ring[i + 1])
    y1 = Math.max(y1, ring[i + 1])
  }
  return { x0, x1, y0, y1 }
}

describe('the outline (traceContour)', () => {
  it('traces one ring around one blob, at the half-coverage isoline', () => {
    const islands = trace(['......', '......', '..##..', '..##..', '......', '......'])
    expect(islands).toHaveLength(1)
    expect(islands[0].holes).toHaveLength(0)
    // The blob covers samples 2..3 on both axes. Half coverage falls
    // half a sample outside it, which normalizes to exactly a third and
    // two thirds of the box.
    const b = bounds(islands[0].outer)
    expect(b.x0).toBeCloseTo(1 / 3, 6)
    expect(b.x1).toBeCloseTo(2 / 3, 6)
    expect(b.y0).toBeCloseTo(1 / 3, 6)
    expect(b.y1).toBeCloseTo(2 / 3, 6)
  })

  it('winds an outer ring counter-clockwise', () => {
    // logoSlab builds each wall face from the ring's direction of
    // travel, so a reversed ring would point every face into the letter
    // instead of out of it. Positive signed area IS the guarantee.
    const islands = trace(['.....', '.###.', '.###.', '.###.', '.....'])
    expect(islands).toHaveLength(1)
    expect(ringArea(islands[0].outer)).toBeGreaterThan(0)
  })

  it('gives a counter its own ring, wound the other way', () => {
    const islands = trace([
      '.........',
      '.#######.',
      '.#######.',
      '.#.....#.',
      '.#.....#.',
      '.#.....#.',
      '.#######.',
      '.#######.',
      '.........',
    ])
    expect(islands).toHaveLength(1)
    expect(islands[0].holes).toHaveLength(1)
    expect(ringArea(islands[0].outer)).toBeGreaterThan(0)
    expect(ringArea(islands[0].holes[0])).toBeLessThan(0)
    // A hole is enclosed by its own outer ring — the nesting test, not
    // just a naming convention.
    const hole = islands[0].holes[0]
    expect(pointInRing(islands[0].outer, hole[0], hole[1])).toBe(true)
  })

  it('keeps disjoint pieces apart (the dot and the stem of an i)', () => {
    const islands = trace([
      '.......',
      '..##...',
      '..##...',
      '.......',
      '..##...',
      '..##...',
      '.......',
    ])
    expect(islands).toHaveLength(2)
    expect(islands.every((s) => s.holes.length === 0)).toBe(true)
    expect(islands.every((s) => ringArea(s.outer) > 0)).toBe(true)
  })

  it('closes a ring around ink that runs off the box', () => {
    // A swash can overhang its capture box. Without the zero pad the
    // contour would run off the grid and never close, and an open ring
    // is not a shape.
    const islands = trace(['####', '####', '....', '....'])
    expect(islands).toHaveLength(1)
    const b = bounds(islands[0].outer)
    expect(b.x0).toBeCloseTo(0, 6)
    expect(b.x1).toBeCloseTo(1, 6)
  })

  it('returns the whole box when everything is ink, and nothing when nothing is', () => {
    const full = trace(['####', '####', '####', '####'])
    expect(full).toHaveLength(1)
    const b = bounds(full[0].outer)
    expect(b.x0).toBeCloseTo(0, 6)
    expect(b.y0).toBeCloseTo(0, 6)
    expect(b.x1).toBeCloseTo(1, 6)
    expect(b.y1).toBeCloseTo(1, 6)

    expect(trace(['....', '....', '....', '....'])).toHaveLength(0)
  })

  it('drops speckle below the minimum area', () => {
    // One stray antialiased sample encloses half a texel. The floor the
    // app runs (6) drops it; only a floor under that half texel keeps
    // it, which is the knob and not an accident of the tracer.
    const speck = ['.....', '.....', '..#..', '.....', '.....']
    expect(trace(speck, { minArea: 6 })).toHaveLength(0)
    expect(trace(speck, { minArea: 0.25 })).toHaveLength(1)
  })

  it('places a crossing between samples, not on one', () => {
    // Sub-texel accuracy is the whole reason a traced outline is
    // smoother than the grid it came from. A column at quarter coverage
    // pulls the isoline two thirds of the way across its cell.
    const w = 4
    const h = 3
    const a: number[] = []
    for (let r = 0; r < h; r++) a.push(0, 1, 0.25, 0)
    const islands = traceContour(a, w, h, { simplify: 0, minArea: 1 })
    expect(islands).toHaveLength(1)
    const b = bounds(islands[0].outer)
    // Left edge: 0 → 1 crosses halfway between the two samples.
    expect(b.x0).toBeCloseTo(0.25, 6)
    // Right edge: 1 → 0.25 crosses two thirds of the way along.
    expect(b.x1).toBeCloseTo((1 + 2 / 3 + 0.5) / 4, 6)
  })

  it('reads the threshold in the samples own units', () => {
    // The app hands over bytes; these tests hand over 0..1 masks. One
    // level, whatever the scale.
    const w = 4
    const h = 3
    const bytes: number[] = []
    for (let r = 0; r < h; r++) bytes.push(0, 255, 255, 0)
    expect(traceContour(bytes, w, h, { threshold: 128, minArea: 1 })).toHaveLength(1)
    expect(traceContour(bytes, w, h, { threshold: 0.5, minArea: 1 })).toHaveLength(1)
    expect(traceContour(bytes, w, h, { threshold: 300, minArea: 1 })).toHaveLength(0)
  })
})

describe('thinning an outline (simplifyRing)', () => {
  it('drops points that sit on a straight run and keeps the corners', () => {
    const square = [0, 0, 1, 0, 2, 0, 2, 1, 2, 2, 1, 2, 0, 2, 0, 1]
    const thin = simplifyRing(square, 0.25)
    expect(thin).toHaveLength(8)
    expect(ringArea(thin)).toBeCloseTo(ringArea(square), 6)
  })

  it('keeps a corner that sticks out further than the tolerance', () => {
    const spike = [0, 0, 1, 0, 2, 0, 2, 1, 2, 2, 1, 4, 0, 2, 0, 1]
    const thin = simplifyRing(spike, 0.25)
    const has = (x: number, y: number) => {
      for (let i = 0; i < thin.length; i += 2) {
        if (thin[i] === x && thin[i + 1] === y) return true
      }
      return false
    }
    expect(has(1, 4)).toBe(true)
  })

  it('leaves a ring alone when the tolerance is zero', () => {
    const square = [0, 0, 1, 0, 2, 0, 2, 2, 0, 2]
    expect(simplifyRing(square, 0)).toEqual(square)
  })
})

describe('ring arithmetic', () => {
  it('signs the area by winding', () => {
    expect(ringArea([0, 0, 2, 0, 2, 2, 0, 2])).toBeCloseTo(4, 9)
    expect(ringArea([0, 0, 0, 2, 2, 2, 2, 0])).toBeCloseTo(-4, 9)
  })

  it('tells inside from outside regardless of winding', () => {
    const ccw = [0, 0, 2, 0, 2, 2, 0, 2]
    const cw = [0, 0, 0, 2, 2, 2, 2, 0]
    expect(pointInRing(ccw, 1, 1)).toBe(true)
    expect(pointInRing(cw, 1, 1)).toBe(true)
    expect(pointInRing(ccw, 3, 1)).toBe(false)
    expect(pointInRing(cw, -1, 1)).toBe(false)
  })
})
