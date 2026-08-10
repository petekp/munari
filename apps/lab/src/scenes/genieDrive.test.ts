import { describe, expect, it } from 'vitest'
import {
  DRIVE_DEFAULTS,
  driveCommit,
  driveGrabStep,
  driveSpringStep,
  easeInCubic,
  easeInOutCubic,
  pourOut,
} from './genieDrive'

// The drive's contracts. The warp law (genieLaw) owns SHAPE; this file
// owns TIME: how t moves when a clock, a hand, or a release owns it.
// The perceptual floor here is the release budget — a flung sheet must
// come to rest fast enough to read as an object with mass, not a tween
// that was interrupted: settled within 400ms from ANY reachable state.

const P = DRIVE_DEFAULTS
const DT = 1 / 120

describe('easings', () => {
  it('easeInOutCubic pins its endpoints and its symmetry', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12)
  })

  it('pourOut leaves gently and ARRIVES WITH SPEED — the pour-out ease exists so the restore lands with momentum for the settle to consume', () => {
    expect(pourOut(0)).toBe(0)
    expect(pourOut(1)).toBeCloseTo(1, 12)
    // Strictly monotone: the pour never pauses or backs up.
    let prev = 0
    for (let i = 1; i <= 200; i++) {
      const f = pourOut(i / 200)
      expect(f).toBeGreaterThan(prev)
      prev = f
    }
    // End slope in [0.6, 1.0] of linear speed: real arrival velocity,
    // not an ease-out kiss (0) and not a cliff (>1.6).
    const h = 1e-3
    const endSlope = (pourOut(1) - pourOut(1 - h)) / h
    expect(endSlope).toBeGreaterThan(0.6)
    expect(endSlope).toBeLessThan(1.0)
    // Start slope near zero: it peels out of the mouth, not jumps.
    const startSlope = pourOut(h) / h
    expect(startSlope).toBeLessThan(0.2)
  })

  it('easeInCubic pins its endpoints and its end slope — the minimize now ARRIVES WITH SPEED, feeding the dock ring', () => {
    expect(easeInCubic(0)).toBe(0)
    expect(easeInCubic(1)).toBe(1)
    // Strictly monotone: the minimize never pauses or backs up.
    let prev = 0
    for (let i = 1; i <= 200; i++) {
      const f = easeInCubic(i / 200)
      expect(f).toBeGreaterThan(prev)
      prev = f
    }
    // Flat start (slope 0): a slow-motion catch still finds the titlebar
    // near rest a beat into the flight.
    const h = 1e-3
    const startSlope = easeInCubic(h) / h
    expect(startSlope).toBeLessThan(0.01)
    // End slope is EXACTLY 3 (closed form: d/dp[p^3] = 3p^2, at p = 1),
    // unlike pourOut's finite difference — MIN_END_SLOPE in Genie.tsx
    // hands this same constant to the ring's velocity conversion.
    const endSlope = (easeInCubic(1) - easeInCubic(1 - h)) / h
    expect(endSlope).toBeCloseTo(3, 2)
  })
})

describe('commit rule', () => {
  it('a strong flick decides, wherever the sheet is', () => {
    expect(driveCommit(0.1, P.commitV + 0.1, P)).toBe(1)
    expect(driveCommit(0.9, -(P.commitV + 0.1), P)).toBe(0)
  })

  it('a gentle release falls to the nearer fate by position', () => {
    expect(driveCommit(P.commitT - 0.05, 0, P)).toBe(0)
    expect(driveCommit(P.commitT + 0.05, 0, P)).toBe(1)
  })

  it('a sub-threshold drift does not override position', () => {
    expect(driveCommit(0.9, -(P.commitV - 0.1), P)).toBe(1)
    expect(driveCommit(0.1, P.commitV - 0.1, P)).toBe(0)
  })
})

describe('release spring', () => {
  it('settles within the 400ms budget from any grab state, never leaving [0, 1]', () => {
    for (let t0 = 0; t0 <= 1.0001; t0 += 0.1) {
      for (const v0 of [-P.vMax, -2, 0, 2, P.vMax]) {
        for (const target of [0, 1] as const) {
          let s = { t: t0, v: v0 }
          let elapsed = 0
          let done = false
          while (elapsed < 0.5 && !done) {
            const next = driveSpringStep(s, target, DT, P)
            expect(next.t).toBeGreaterThanOrEqual(0)
            expect(next.t).toBeLessThanOrEqual(1)
            s = { t: next.t, v: next.v }
            done = next.done
            elapsed += DT
          }
          expect(done).toBe(true)
          expect(elapsed).toBeLessThanOrEqual(0.4)
          expect(s.t).toBe(target)
        }
      }
    }
  })

  it('done means AT the target exactly — the swap frame reads t, and identity is only exact at 0', () => {
    let s = { t: 0.3, v: 0 }
    for (let i = 0; i < 200; i++) {
      const next = driveSpringStep(s, 0, DT, P)
      s = { t: next.t, v: next.v }
      if (next.done) break
    }
    expect(s.t).toBe(0)
    expect(s.v).toBe(0)
  })

  it('reaching the target wall IS the landing: momentum crosses into arrivalV, in proportion to the fling', () => {
    // Spring until contact, wobble after contact — the drive reports the
    // crossing speed once, and the settle law decides whether that much
    // momentum is even perceptible.
    const run = (t0: number, v0: number) => {
      let s = { t: t0, v: v0 }
      let handoff = 0
      for (let i = 0; i < 400; i++) {
        const next = driveSpringStep(s, 0, DT, P)
        handoff = Math.max(handoff, next.arrivalV)
        s = { t: next.t, v: next.v }
        if (next.done) break
      }
      return handoff
    }
    const flung = run(0.5, -P.vMax)
    const gentle = run(0.05, 0)
    expect(flung).toBeGreaterThan(0)
    expect(gentle).toBeGreaterThanOrEqual(0)
    expect(gentle).toBeLessThan(flung * 0.2)
  })

  it('is step-size honest: 60fps and 240fps trace the same trajectory (analytic, not Euler)', () => {
    // A window short enough that neither run reaches the wall: pure
    // spring, where an Euler integrator would diverge between rates.
    const run = (dt: number) => {
      let s = { t: 0.5, v: 0 }
      for (let elapsed = 0; elapsed + dt <= 0.1; elapsed += dt) {
        const next = driveSpringStep(s, 1, dt, P)
        s = { t: next.t, v: next.v }
      }
      return s
    }
    const coarse = run(1 / 60)
    const fine = run(1 / 240)
    expect(coarse.t).toBeCloseTo(fine.t, 3)
    expect(coarse.v).toBeCloseTo(fine.v, 2)
  })
})

describe('grab tracking', () => {
  it('the sheet is wherever the hand says, clamped to the drain', () => {
    expect(driveGrabStep({ t: 0.5, v: 0 }, 0.62, DT).t).toBe(0.62)
    expect(driveGrabStep({ t: 0.5, v: 0 }, -0.2, DT).t).toBe(0)
    expect(driveGrabStep({ t: 0.5, v: 0 }, 1.4, DT).t).toBe(1)
  })

  it('velocity estimate converges on a steady drag within five frames', () => {
    // A hand moving at a constant 2 t/s: the estimate must be usable by
    // the commit rule almost immediately, or a quick flick reads as 0.
    let s = { t: 0, v: 0 }
    for (let i = 1; i <= 5; i++) {
      s = driveGrabStep(s, i * 2 * DT, DT)
    }
    expect(s.v).toBeGreaterThan(1.2)
    expect(s.v).toBeLessThan(2.8)
  })
})
