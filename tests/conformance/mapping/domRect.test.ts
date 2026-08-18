// The DOM-rect contract — the numbers a matched plane is placed from, and
// the ancestors it must refuse.
//
// The refusals are the load-bearing half. A rotated element still reports a
// perfectly plausible bounding rectangle, so a plane placed from it lands
// somewhere reasonable and merely disagrees more as the angle grows. The
// rejection is what turns that into a message at the seam.
import { describe, expect, it } from 'vitest'
import {
  AFFINE_IDENTITY,
  affineIsMatchable,
  composeMatchableChain,
  parseTransformMatrix,
  rectEquals,
  rectIsMeasurable,
  rectToNdc,
} from '@munari/core'

const viewport = { width: 1000, height: 500 }

describe('client rects in normalized device coordinates', () => {
  it('a centred box is the origin', () => {
    const ndc = rectToNdc({ left: 400, top: 200, width: 200, height: 100 }, viewport)
    expect(ndc.x).toBeCloseTo(0, 12)
    expect(ndc.y).toBeCloseTo(0, 12)
    expect(ndc.halfWidth).toBeCloseTo(0.2, 12)
    expect(ndc.halfHeight).toBeCloseTo(0.2, 12)
  })

  it('y is flipped: the top of the viewport is +1', () => {
    const ndc = rectToNdc({ left: 0, top: 0, width: 0, height: 0 }, viewport)
    expect(ndc.x).toBeCloseTo(-1, 12)
    expect(ndc.y).toBeCloseTo(1, 12)
  })

  it('fractional layout stays fractional', () => {
    // A centred flex child of an odd-width parent is the ordinary case.
    // Rounding here puts the plane a subpixel off its twin for the whole of
    // a handoff, which reads as a one-pixel shiver at the swap.
    const ndc = rectToNdc({ left: 100.5, top: 50.25, width: 99, height: 33 }, viewport)
    expect(ndc.x).toBeCloseTo(((100.5 + 49.5) / 1000) * 2 - 1, 12)
    expect(ndc.y).toBeCloseTo(1 - ((50.25 + 16.5) / 500) * 2, 12)
  })

  it('a zero extent is not measurable', () => {
    expect(rectIsMeasurable({ left: 0, top: 0, width: 0, height: 10 })).toBe(false)
    expect(rectIsMeasurable({ left: 0, top: 0, width: 10, height: 10 })).toBe(true)
  })

  it('rect equality tolerates a hundredth of a pixel and no more', () => {
    const base = { left: 10, top: 10, width: 100, height: 50 }
    expect(rectEquals(base, { ...base, left: 10.005 })).toBe(true)
    expect(rectEquals(base, { ...base, left: 10.02 })).toBe(false)
  })
})

describe('admissible transforms', () => {
  it('none and the empty string are the identity', () => {
    expect(parseTransformMatrix('none')).toEqual(AFFINE_IDENTITY)
    expect(parseTransformMatrix('')).toEqual(AFFINE_IDENTITY)
  })

  it('a 2D matrix is read in css order', () => {
    expect(parseTransformMatrix('matrix(2, 0, 0, 3, 40, 50)')).toEqual({
      a: 2,
      b: 0,
      c: 0,
      d: 3,
      e: 40,
      f: 50,
    })
  })

  it('a 3D matrix is refused rather than flattened', () => {
    // Dropping the third row yields a well-formed 2D affine that describes
    // where the element would be with no perspective — which, for the
    // perspective + rotateY card that raises the question, is not where any
    // of its pixels are.
    expect(
      parseTransformMatrix('matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1)'),
    ).toBeNull()
  })

  it('an unreadable value is refused, not assumed identity', () => {
    expect(parseTransformMatrix('matrix(1, 0, 0, 1)')).toBeNull()
    expect(parseTransformMatrix('matrix(1, 0, 0, 1, 0, nope)')).toBeNull()
    expect(parseTransformMatrix('rotate(10deg)')).toBeNull()
  })

  it('translation and positive scale are matchable', () => {
    expect(affineIsMatchable({ a: 1, b: 0, c: 0, d: 1, e: 12, f: -4 })).toBe(true)
    expect(affineIsMatchable({ a: 0.5, b: 0, c: 0, d: 2, e: 0, f: 0 })).toBe(true)
  })

  it('rotation, skew, mirror, and collapse are not', () => {
    expect(affineIsMatchable({ a: 1, b: 0.3, c: 0, d: 1, e: 0, f: 0 })).toBe(false)
    expect(affineIsMatchable({ a: 1, b: 0, c: 0.3, d: 1, e: 0, f: 0 })).toBe(false)
    expect(affineIsMatchable({ a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 })).toBe(false)
    expect(affineIsMatchable({ a: 1, b: 0, c: 0, d: 0, e: 0, f: 0 })).toBe(false)
  })
})

describe('ancestor chains', () => {
  it('an untransformed chain composes to the identity', () => {
    expect(composeMatchableChain(['none', 'none'])).toEqual(AFFINE_IDENTITY)
  })

  it('nested scale and translation compose outermost-first', () => {
    // The outer scale applies to the inner translation: 2× then +10px is
    // 20px of page movement, not 10.
    expect(
      composeMatchableChain(['matrix(2, 0, 0, 2, 0, 0)', 'matrix(1, 0, 0, 1, 10, 5)']),
    ).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 20, f: 10 })
  })

  it('one unmatchable link refuses the whole chain', () => {
    expect(
      composeMatchableChain(['matrix(1, 0, 0, 1, 10, 0)', 'matrix(0, 1, -1, 0, 0, 0)']),
    ).toBeNull()
  })

  it('two opposed rotations do not cancel into a matchable chain', () => {
    // They compose to the identity. Admitting the pair would admit a chain
    // whose intermediate boxes this law never checked — and a plane matched
    // to the outer box is wrong about every one of them.
    expect(
      composeMatchableChain(['matrix(0, 1, -1, 0, 0, 0)', 'matrix(0, -1, 1, 0, 0, 0)']),
    ).toBeNull()
  })
})
