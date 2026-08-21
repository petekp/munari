import { describe, expect, it } from 'vitest'
import {
  FISHEYE_DEFAULTS,
  fisheyeDisplace,
  fisheyeDisplaceX,
  fisheyeScale,
  fisheyeSource,
  fisheyeSourceX,
} from './fisheyeLaw'

const P = FISHEYE_DEFAULTS
const A = P.amplitude
const R = P.radius

describe('the lens is anchored at its focus', () => {
  it('the focus is a fixed point at any amplitude', () => {
    for (const focus of [0, 57, 176, 352]) {
      for (const amp of [1, 1.5, 2, 3]) {
        expect(fisheyeDisplace(focus, focus, amp, P)).toBeCloseTo(focus, 10)
      }
    }
  })

  it('amplitude 1 is the identity everywhere', () => {
    for (let y = -50; y <= 400; y += 13) {
      expect(fisheyeDisplace(y, 176, 1, P)).toBeCloseTo(y, 10)
    }
  })

  it('the inserted height splits evenly above and below the focus', () => {
    const focus = 176
    const up = focus - fisheyeDisplace(focus - R, focus, A, P)
    const down = fisheyeDisplace(focus + R, focus, A, P) - focus
    expect(up).toBeCloseTo(R + ((A - 1) * R) / 2, 8)
    expect(down).toBeCloseTo(R + ((A - 1) * R) / 2, 8)
  })

  it('beyond the rim, displacement is pure translation by (A−1)·R/2', () => {
    const focus = 176
    const shift = ((A - 1) * R) / 2
    // 60px at the defaults — MORE than one 44px row of the scene's list,
    // which is what makes the gate's flat-pose counter-click land on a
    // different row. This is the teeth of instruments/fisheye-pointer;
    // changing radius or amplitude means re-deriving that margin.
    expect(shift).toBe(60)
    for (const y of [focus - R - 1, focus - 300, focus + R + 1, focus + 300]) {
      const expected = y + (y > focus ? shift : -shift)
      expect(fisheyeDisplace(y, focus, A, P)).toBeCloseTo(expected, 8)
    }
  })
})

describe('the lens preserves order and magnifies what it claims', () => {
  it('is strictly increasing across the whole span', () => {
    const focus = 176
    let prev = fisheyeDisplace(-200, focus, A, P)
    for (let y = -199; y <= 552; y++) {
      const next = fisheyeDisplace(y, focus, A, P)
      expect(next).toBeGreaterThan(prev)
      prev = next
    }
  })

  it('local magnification at the focus is the amplitude', () => {
    const focus = 176
    const eps = 1e-4
    const slope =
      (fisheyeDisplace(focus + eps, focus, A, P) -
        fisheyeDisplace(focus - eps, focus, A, P)) /
      (2 * eps)
    expect(slope).toBeCloseTo(A, 5)
    expect(fisheyeScale(focus, focus, A, P)).toBeCloseTo(A, 10)
  })

  it('reaches the rim at scale 1 with no kink', () => {
    const focus = 176
    expect(fisheyeScale(focus + R, focus, A, P)).toBe(1)
    // C¹ at the rim: the slope just inside matches the slope outside.
    const eps = 1e-3
    const inside =
      (fisheyeDisplace(focus + R - eps, focus, A, P) -
        fisheyeDisplace(focus + R - 2 * eps, focus, A, P)) /
      eps
    expect(inside).toBeCloseTo(1, 4)
  })
})

describe('the x spread keeps magnification uniform', () => {
  const center = 170
  const focus = 176

  it('the centerline is a fixed column at any amplitude and any y', () => {
    for (const y of [0, 100, 176, 300]) {
      for (const amp of [1, 1.5, 2]) {
        expect(fisheyeDisplaceX(center, y, center, focus, amp, P)).toBeCloseTo(center, 10)
      }
    }
  })

  it('horizontal scale equals vertical scale at every y — the legibility law', () => {
    const eps = 1e-4
    for (const y of [focus, focus + 40, focus + 100, focus + 119]) {
      const hScale =
        (fisheyeDisplaceX(center + 50 + eps, y, center, focus, A, P) -
          fisheyeDisplaceX(center + 50 - eps, y, center, focus, A, P)) /
        (2 * eps)
      const vScale =
        (fisheyeDisplace(y + eps, focus, A, P) - fisheyeDisplace(y - eps, focus, A, P)) /
        (2 * eps)
      expect(hScale).toBeCloseTo(vScale, 4)
    }
  })

  it('beyond the rim, x is untouched', () => {
    for (const y of [focus - R - 1, focus + R + 1, focus + 400]) {
      expect(fisheyeDisplaceX(300, y, center, focus, A, P)).toBe(300)
    }
  })

  it('round-trips through fisheyeSourceX at the source row', () => {
    for (const y of [focus, focus + 30, focus + 110]) {
      for (const x of [0, 40, center, 290, 340]) {
        const dx = fisheyeDisplaceX(x, y, center, focus, A, P)
        expect(fisheyeSourceX(dx, y, center, focus, A, P)).toBeCloseTo(x, 8)
      }
    }
  })
})

describe('the inverse', () => {
  it('round-trips through the forward map to sub-pixel precision', () => {
    const focus = 176
    for (let y = -100; y <= 452; y += 7) {
      const screen = fisheyeDisplace(y, focus, A, P)
      expect(fisheyeSource(screen, focus, A, P)).toBeCloseTo(y, 4)
    }
  })
})
