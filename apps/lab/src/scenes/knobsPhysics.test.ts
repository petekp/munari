import { describe, expect, it } from 'vitest'
import {
  BOUNCE_TILT,
  BOUNCE_TILT_MAX,
  DRAG_TILT,
  DRAG_TILT_MAX,
  KNOB_FLICK_MIN,
  KNOB_SPIN_MIN,
  KNOB_SPIN_TAU,
  KNOB_SPRING,
  LEVER_SPRING,
  LEVER_THROW,
  PANEL_GLIDE_SPRING,
  PANEL_RESTITUTION,
  PANEL_SPRING,
  type SpringParams,
  type SpringState,
  dampingRatio,
  reflect,
  springSettled,
  stepSpin,
  stepSpring,
} from './knobsPhysics'

/** Run a spring from rest at 0 toward `target` for `seconds`, at a fixed
 *  frame rate, recording every frame's position. */
function simulate(
  p: SpringParams,
  target: number,
  seconds: number,
  fps = 120,
  v0 = 0,
): number[] {
  const s: SpringState = { x: 0, v: v0 }
  const frames: number[] = []
  const dt = 1 / fps
  const count = Math.round(seconds * fps)
  for (let i = 0; i < count; i++) {
    stepSpring(s, target, p, dt)
    frames.push(s.x)
  }
  return frames
}

/** Count how many times the trajectory crosses its target. */
function crossings(frames: number[], target: number): number {
  let n = 0
  for (let i = 1; i < frames.length; i++) {
    if (Math.sign(frames[i] - target) !== Math.sign(frames[i - 1] - target)) n++
  }
  return n
}

describe('stepSpring', () => {
  it('is deterministic — same inputs walk the same trajectory', () => {
    expect(simulate(LEVER_SPRING, 1, 1)).toEqual(simulate(LEVER_SPRING, 1, 1))
  })

  it('integrates the same trajectory at 30Hz and 120Hz (fixed substep)', () => {
    const slow = simulate(KNOB_SPRING, 1, 1, 30)
    const fast = simulate(KNOB_SPRING, 1, 1, 120)
    // Compare the two rates at the frames they share (every 4th fast frame).
    for (let i = 0; i < slow.length; i++) {
      expect(slow[i]).toBeCloseTo(fast[i * 4 + 3], 6)
    }
  })

  it('never spends a background-tab absence in one step', () => {
    const s: SpringState = { x: 0, v: 0 }
    stepSpring(s, 1, LEVER_SPRING, 10)
    const capped: SpringState = { x: 0, v: 0 }
    stepSpring(capped, 1, LEVER_SPRING, 1 / 20)
    expect(s.x).toBeCloseTo(capped.x, 9)
  })

  it('settles every tuned spring within two seconds', () => {
    for (const p of [LEVER_SPRING, KNOB_SPRING, PANEL_SPRING]) {
      const s: SpringState = { x: 0, v: 0 }
      for (let i = 0; i < 240; i++) stepSpring(s, 1, p, 1 / 120)
      expect(springSettled(s, 1)).toBe(true)
    }
  })
})

describe('the lever — thrown, not placed', () => {
  it('is underdamped enough to ring: ζ in (0.25, 0.4)', () => {
    const z = dampingRatio(LEVER_SPRING)
    expect(z).toBeGreaterThan(0.25)
    expect(z).toBeLessThan(0.4)
  })

  it('overshoots and wobbles — crosses its target at least twice', () => {
    expect(crossings(simulate(LEVER_SPRING, 1, 1.5), 1)).toBeGreaterThanOrEqual(2)
  })

  it('with the thumb-flick kick, lands its first crossing within 150ms', () => {
    const frames = simulate(LEVER_SPRING, 1, 0.5, 120, LEVER_THROW * 0.1)
    const first = frames.findIndex((x) => x >= 1)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first / 120).toBeLessThan(0.15)
  })
})

describe('the knob — weight, not bounce', () => {
  it('is near-critical: ζ in (0.7, 0.95)', () => {
    const z = dampingRatio(KNOB_SPRING)
    expect(z).toBeGreaterThan(0.7)
    expect(z).toBeLessThan(0.95)
  })

  it('overshoot is a whisper — under 3% of the travel', () => {
    const peak = Math.max(...simulate(KNOB_SPRING, 1, 2))
    expect(peak).toBeGreaterThanOrEqual(1 - 1e-9)
    expect(peak - 1).toBeLessThan(0.03)
  })
})

describe('the slab — sway, not shake', () => {
  it('is mostly damped: ζ in (0.6, 0.9)', () => {
    const z = dampingRatio(PANEL_SPRING)
    expect(z).toBeGreaterThan(0.6)
    expect(z).toBeLessThan(0.9)
  })
})

describe('the carry — momentum you can see', () => {
  it('glides underdamped: ζ in (0.5, 0.7)', () => {
    const z = dampingRatio(PANEL_GLIDE_SPRING)
    expect(z).toBeGreaterThan(0.5)
    expect(z).toBeLessThan(0.7)
  })

  it('overshoots the drop point — the slab arrives with momentum', () => {
    const frames = simulate(PANEL_GLIDE_SPRING, 300, 3)
    expect(Math.max(...frames)).toBeGreaterThan(300)
  })

  it('settles a 400px carry within two and a half seconds', () => {
    const s: SpringState = { x: 0, v: 0 }
    for (let i = 0; i < 300; i++) stepSpring(s, 400, PANEL_GLIDE_SPRING, 1 / 120)
    expect(springSettled(s, 400, 0.5, 1)).toBe(true)
  })

  it('leans visibly at hand speed, and the clamp stays under a fold-over', () => {
    // A moderate 800 px/s carry reads as a lean…
    expect(800 * DRAG_TILT).toBeGreaterThan(0.05)
    // …a violent flick cannot exceed the stop…
    expect(DRAG_TILT_MAX).toBeLessThan(0.5)
    // …and the stop engages within reachable hand speeds.
    expect(DRAG_TILT_MAX / DRAG_TILT).toBeLessThan(2000)
  })
})

describe('the free spin — a flicked knob coasts on its bearing', () => {
  it('total travel of a flick is exactly v·τ', () => {
    const s = { v: 2 }
    let travel = 0
    for (let i = 0; i < 2400; i++) travel += stepSpin(s, 1 / 120)
    expect(travel).toBeCloseTo(2 * KNOB_SPIN_TAU, 4)
  })

  it('walks the same trajectory at 30Hz and 120Hz — the decay is exact', () => {
    const slow = { v: 1.5 }
    const fast = { v: 1.5 }
    let slowTravel = 0
    let fastTravel = 0
    for (let i = 0; i < 30; i++) slowTravel += stepSpin(slow, 1 / 30)
    for (let i = 0; i < 120; i++) fastTravel += stepSpin(fast, 1 / 120)
    expect(slowTravel).toBeCloseTo(fastTravel, 9)
    expect(slow.v).toBeCloseTo(fast.v, 9)
  })

  it('only ever slows down, and never reverses', () => {
    const s = { v: 3 }
    let prev = s.v
    for (let i = 0; i < 300; i++) {
      stepSpin(s, 1 / 60)
      expect(s.v).toBeGreaterThan(0)
      expect(s.v).toBeLessThan(prev)
      prev = s.v
    }
  })

  it('a hard flick dies below the dead threshold within two seconds', () => {
    const s = { v: 2 }
    for (let i = 0; i < 240; i++) stepSpin(s, 1 / 120)
    expect(Math.abs(s.v)).toBeLessThan(KNOB_SPIN_MIN)
  })

  it('the flick gate sits well above the dead threshold', () => {
    expect(KNOB_FLICK_MIN).toBeGreaterThan(KNOB_SPIN_MIN * 5)
  })
})

describe('the edge bounce — the slab bumps, it does not pass through', () => {
  it('leaves a spring inside the walls untouched', () => {
    const s: SpringState = { x: 100, v: 50 }
    expect(reflect(s, -200, 200, PANEL_RESTITUTION)).toBe(0)
    expect(s).toEqual({ x: 100, v: 50 })
  })

  it('folds an overshoot back inside and reverses the velocity', () => {
    const s: SpringState = { x: 230, v: 400 }
    const impact = reflect(s, -200, 200, PANEL_RESTITUTION)
    expect(impact).toBe(400)
    expect(s.x).toBe(170)
    expect(s.v).toBe(-400 * PANEL_RESTITUTION)
  })

  it('signs the impact by the wall: min wall reports negative', () => {
    const s: SpringState = { x: -230, v: -400 }
    expect(reflect(s, -200, 200, PANEL_RESTITUTION)).toBe(-400)
    expect(s.v).toBe(400 * PANEL_RESTITUTION)
  })

  it('every bounce loses energy', () => {
    expect(PANEL_RESTITUTION).toBeGreaterThan(0)
    expect(PANEL_RESTITUTION).toBeLessThan(1)
  })

  it('a dead wall (e = 0) absorbs the hit — pressed, not bounced', () => {
    const s: SpringState = { x: 230, v: 400 }
    reflect(s, -200, 200, 0)
    expect(Math.abs(s.v)).toBe(0)
    expect(s.x).toBeLessThanOrEqual(200)
  })

  it('a wall pair narrower than the slab declines to act', () => {
    const s: SpringState = { x: 50, v: 100 }
    expect(reflect(s, 200, -200, PANEL_RESTITUTION)).toBe(0)
    expect(s).toEqual({ x: 50, v: 100 })
  })

  it('the flinch is visible at a throw, and capped under a fold-over', () => {
    expect(500 * BOUNCE_TILT).toBeGreaterThan(0.05)
    expect(BOUNCE_TILT_MAX).toBeLessThan(0.5)
  })
})
