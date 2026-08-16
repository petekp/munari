// The choreography contract.
//
// A consumer scripts its crossing as pure functions of progress — windows
// (crossingRange) and bells (crossingCurve) — never as timelines. The
// shape is drei's useScroll().range/.curve, because our users' hands
// already know it; the law is what the shape buys: any composition of
// windows over the eased progress is zero, with zero velocity, at both
// handoff edges. Reversal-safety and handoff-identity are properties of
// the functions, not disciplines asked of the consumer, and this
// contract pins them.

import { describe, expect, it } from 'vitest'
import { crossingCurve, crossingProgress, crossingRange } from '@munari/core'

describe('the window (crossingRange)', () => {
  it('is zero before its window opens and one after it closes', () => {
    expect(crossingRange(0.0, 0.3, 0.4)).toBe(0)
    expect(crossingRange(0.29, 0.3, 0.4)).toBe(0)
    expect(crossingRange(0.71, 0.3, 0.4)).toBe(1)
    expect(crossingRange(1.0, 0.3, 0.4)).toBe(1)
  })

  it('is linear inside the window — the stagger is even, not eased twice', () => {
    expect(crossingRange(0.3, 0.3, 0.4)).toBe(0)
    expect(crossingRange(0.4, 0.3, 0.4)).toBeCloseTo(0.25, 12)
    expect(crossingRange(0.5, 0.3, 0.4)).toBeCloseTo(0.5, 12)
    expect(crossingRange(0.6, 0.3, 0.4)).toBeCloseTo(0.75, 12)
    expect(crossingRange(0.7, 0.3, 0.4)).toBeCloseTo(1, 12)
  })

  it('clamps to 0..1 for any progress, window, or overshoot', () => {
    for (const p of [-1, 0, 0.25, 0.5, 0.75, 1, 2]) {
      for (const from of [0, 0.2, 0.9]) {
        for (const distance of [0.1, 0.5, 1, 3]) {
          const r = crossingRange(p, from, distance)
          expect(r).toBeGreaterThanOrEqual(0)
          expect(r).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('degenerates to a step at `from` when the distance is zero or negative', () => {
    expect(crossingRange(0.29, 0.3, 0)).toBe(0)
    expect(crossingRange(0.3, 0.3, 0)).toBe(1)
    expect(crossingRange(0.31, 0.3, -1)).toBe(1)
  })

  it('the full-width window is the identity over progress', () => {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      expect(crossingRange(p, 0, 1)).toBe(p)
    }
  })
})

describe('the bell (crossingCurve)', () => {
  it('is zero at both ends of its window and peaks at 1 in the middle', () => {
    expect(crossingCurve(0.3, 0.3, 0.4)).toBeCloseTo(0, 12)
    expect(crossingCurve(0.5, 0.3, 0.4)).toBeCloseTo(1, 12)
    expect(crossingCurve(0.7, 0.3, 0.4)).toBeCloseTo(0, 12)
  })

  it('stays zero outside its window — a middle effect never leaks to the edges', () => {
    expect(crossingCurve(0, 0.3, 0.4)).toBeCloseTo(0, 12)
    expect(crossingCurve(0.1, 0.3, 0.4)).toBeCloseTo(0, 12)
    expect(crossingCurve(0.9, 0.3, 0.4)).toBeCloseTo(0, 12)
    expect(crossingCurve(1, 0.3, 0.4)).toBeCloseTo(0, 12)
  })

  it('even at full width, the bell is zero at both handoff edges', () => {
    expect(crossingCurve(0, 0, 1)).toBeCloseTo(0, 12)
    expect(crossingCurve(1, 0, 1)).toBeCloseTo(0, 12)
    expect(crossingCurve(0.5, 0, 1)).toBeCloseTo(1, 12)
  })
})

describe('composition with the eased progress', () => {
  // The identity law: at rest (ramp 0) and only trivially at full
  // progress, every window agrees with the phase it composes into. An
  // effect scaled by any range is exactly absent on the page side of
  // the forward handoff and exactly absent again at touchdown —
  // pixel-identity with the page cannot be broken by choreography.
  it('every window is zero at ramp zero: choreography cannot precede the handoff', () => {
    const p = crossingProgress(0)
    for (const from of [0, 0.1, 0.5, 0.9]) {
      for (const distance of [0.1, 0.5, 1]) {
        expect(crossingRange(p, from, distance)).toBe(0)
        expect(crossingCurve(p, from, distance)).toBeCloseTo(0, 12)
      }
    }
  })

  it('every window that closes by 1 is fully open at ramp one', () => {
    const p = crossingProgress(1)
    expect(crossingRange(p, 0, 1)).toBe(1)
    expect(crossingRange(p, 0.6, 0.4)).toBeCloseTo(1, 12)
    expect(crossingRange(p, 0.3, 0.2)).toBe(1)
  })

  it('a windowed effect leaves rest with zero velocity, inherited from the eased progress', () => {
    // The chain d(range∘progress)/d(ramp) at ramp≈0: smoothstep's flat
    // start multiplies into every window, so even a window opening at
    // from=0 cannot jerk the first transition frame.
    const eps = 1e-4
    const slope = crossingRange(crossingProgress(eps), 0, 0.5) / eps
    expect(slope).toBeLessThan(0.01)
  })

  it('reversal is free: the same progress always yields the same window value', () => {
    // Rising through 0.4 and falling back through 0.4 read identically —
    // choreography holds no state to unwind.
    const rising = crossingRange(crossingProgress(0.4), 0.2, 0.6)
    const falling = crossingRange(crossingProgress(0.4), 0.2, 0.6)
    expect(rising).toBe(falling)
  })
})
