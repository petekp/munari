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
  PANEL_CENTER_YAW,
  PANEL_GLIDE_SPRING,
  PANEL_RESTITUTION,
  PANEL_SPRING,
  type SpringParams,
  type SpringState,
  berthPinned,
  centerFacingYaw,
  dampingRatio,
  rampLag,
  reflect,
  springSettled,
  stepSpin,
  stepSpring,
} from './knobsPhysics'
import { KNOB, TOGGLE } from './knobsGeometry'

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

describe('the lever — thrown, and it stops dead', () => {
  /** One real flip, in the scene's own terms: the bat rests at +throw,
   *  the target moves to −throw, and the thumb donates LEVER_THROW at
   *  that instant. Mirrors ToggleHardware in Knobs.tsx. */
  function flip(seconds = 1, fps = 120, reflipAt = -1): number[] {
    const s: SpringState = { x: TOGGLE.throw, v: -LEVER_THROW }
    const frames: number[] = []
    let target = -TOGGLE.throw
    for (let i = 0; i < Math.round(seconds * fps); i++) {
      if (i === reflipAt) {
        target = TOGGLE.throw
        s.v += LEVER_THROW
      }
      stepSpring(s, target, LEVER_SPRING, 1 / fps)
      // Distance past the stop, signed so positive is always overshoot.
      frames.push((s.x - target) * Math.sign(target))
    }
    return frames
  }

  /** Half a pixel swept by the bat tip. Below this there is nothing to
   *  see, whatever the radians say — so it is the unit the feel is
   *  judged in, and the floor every claim below is measured against. */
  const HALF_PX = 0.5 / TOGGLE.leverLength

  it('is critically damped: ζ = 1', () => {
    expect(dampingRatio(LEVER_SPRING)).toBeCloseTo(1, 6)
  })

  it('never crosses its target — no overshoot, no ring', () => {
    const past = flip(1.5)
    expect(Math.max(...past)).toBeLessThanOrEqual(0)
    expect(crossings(past, 0)).toBe(0)
  })

  it('the no-bounce is structural: the thumb cannot beat the spring', () => {
    // At ζ = 1 a spring overshoots only when the donated velocity
    // exceeds ωn × the distance left to travel. Keep LEVER_THROW under
    // that and the dead stop holds by construction, not by tuning.
    const wn = Math.sqrt(LEVER_SPRING.stiffness)
    expect(LEVER_THROW).toBeLessThan(wn * 2 * TOGGLE.throw)
  })

  it('not one moment of a re-flip can shake a wobble out of it', () => {
    // The abuse case: thrown, then thrown back mid-flight, so the second
    // flick lands on whatever velocity is already there.
    for (let at = 0; at < 36; at++) {
      expect(Math.max(...flip(1.5, 120, at))).toBeLessThanOrEqual(0)
    }
  })

  it('arrives as fast as a ringing lever did — inside 150ms', () => {
    // Killing the bounce must not cost speed. The switch looks arrived
    // when the tip is within half a pixel of its stop.
    const past = flip(0.5)
    const arrived = past.findIndex((d) => Math.abs(d) < HALF_PX)
    expect(arrived).toBeGreaterThanOrEqual(0)
    expect(arrived / 120).toBeLessThan(0.15)
  })

  it('the thumb still owns the launch — it is thrown, not placed', () => {
    // The spring decides where the bat stops; the flick decides how hard
    // it leaves. Strip the flick and the bat is visibly slower over
    // centre, which is the whole reason LEVER_THROW still exists.
    const centre = (v0: number) => {
      const s: SpringState = { x: TOGGLE.throw, v: v0 }
      for (let i = 0; i < 120; i++) {
        stepSpring(s, -TOGGLE.throw, LEVER_SPRING, 1 / 120)
        if (s.x <= 0) return i / 120
      }
      return Infinity
    }
    expect(centre(-LEVER_THROW)).toBeLessThan(centre(0))
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

describe('the standing yaw — the slab faces the middle of the glass', () => {
  it('parked right of center, the LEFT edge drops away from the camera', () => {
    // rotation.y = θ sends the left edge (x = −w) to z = w·sin θ, so a
    // negative yaw is what recedes it. The sign IS the requirement.
    expect(centerFacingYaw(534, 720)).toBeLessThan(0)
  })

  it('mirrored on the left, dead-on at dead center', () => {
    expect(centerFacingYaw(-534, 720)).toBeGreaterThan(0)
    expect(centerFacingYaw(-534, 720)).toBeCloseTo(-centerFacingYaw(534, 720), 12)
    expect(Math.abs(centerFacingYaw(0, 720))).toBe(0)
  })

  it('the wall is the maximum: a bumped slab cannot ask for more lean', () => {
    expect(centerFacingYaw(720, 720)).toBeCloseTo(-PANEL_CENTER_YAW, 12)
    expect(centerFacingYaw(2000, 720)).toBeCloseTo(-PANEL_CENTER_YAW, 12)
  })

  it('slight, not a fold: visible at the berth, under the drag tilt cap', () => {
    // The berth on a 1440 px glass parks the center ~534 px right. The
    // standing lean there must clear the pointer sway (±0.055 rad) so
    // the pose reads as aim rather than jitter, and stay a lean.
    const berth = Math.abs(centerFacingYaw(534, 720))
    expect(berth).toBeGreaterThan(0.07)
    expect(PANEL_CENTER_YAW).toBeLessThan(DRAG_TILT_MAX)
  })
})

describe('the resize — the hand is not a glide either', () => {
  /** Drive a spring against a target that slides at a steady rate, the
   *  way the berth slides under a hand dragging the grip. Three seconds
   *  is long past the ζ = 0.6 transient, so what comes back is the
   *  standing gap, not a swing. */
  function trail(p: SpringParams, rate: number, seconds = 3, fps = 120): number {
    const s: SpringState = { x: 0, v: 0 }
    let target = 0
    for (let i = 1; i <= seconds * fps; i++) {
      target -= rate / fps
      stepSpring(s, target, p, 1 / fps)
    }
    return Math.abs(s.x - target)
  }

  it('rampLag is c/k, and it is what the integrator really does', () => {
    // The closed form is continuous; the shipping integrator is
    // semi-implicit Euler at a fixed substep, and it runs a little
    // under. What matters is that the shortfall is a scale-free bias —
    // the same ratio at every rate — and not drift.
    const ratios = [100, 300, 700].map((r) => rampLag(PANEL_GLIDE_SPRING, r) / trail(PANEL_GLIDE_SPRING, r))
    for (const q of ratios) expect(q).toBeLessThan(1.05)
    expect(ratios[0]).toBeCloseTo(ratios[2], 6)
  })

  it('a glided resize would trail the hand by more than a knob', () => {
    // This is why the pin exists, stated in the units of the panel
    // itself. A resize slides the berth at HALF the hand's speed,
    // because the berth is written in terms of w/2.
    const ordinary = trail(PANEL_GLIDE_SPRING, 600 / 2)
    expect(ordinary).toBeGreaterThan(KNOB.skirtRadius)
    // And it is not a corner case: even a slow, careful hand is out by
    // several pixels.
    expect(trail(PANEL_GLIDE_SPRING, 200 / 2)).toBeGreaterThan(8)
  })

  it('and it would still be swinging long after the hand stopped', () => {
    const s: SpringState = { x: 0, v: 0 }
    let berth = 0
    for (let i = 0; i < 60; i++) {
      berth -= 300 / 120
      stepSpring(s, berth, PANEL_GLIDE_SPRING, 1 / 120)
    }
    // The hand lets go here, tens of pixels from the berth.
    expect(Math.abs(s.x - berth)).toBeGreaterThan(20)
    let last = 0
    for (let i = 1; i <= 240; i++) {
      stepSpring(s, berth, PANEL_GLIDE_SPRING, 1 / 120)
      if (Math.abs(s.x - berth) > 0.5) last = i / 120
    }
    expect(last).toBeGreaterThan(0.5)
  })

  it('a hand on the grip pins the slab; a hand on the slab does not', () => {
    expect(berthPinned(true, false)).toBe(true)
    // Carried and then resized: the hand chose where this panel stands,
    // so the resize must not haul it back to the berth.
    expect(berthPinned(true, true)).toBe(false)
    // No resize, no pin — an idle or carried slab glides as before.
    expect(berthPinned(false, false)).toBe(false)
    expect(berthPinned(false, true)).toBe(false)
  })

  it('pinned, the slab IS its berth — no gap, and no lean to give away', () => {
    const s: SpringState = { x: 0, v: 0 }
    let berth = 0
    for (let i = 1; i <= 120; i++) {
      berth -= 300 / 120
      if (berthPinned(true, false)) {
        s.x = berth
        s.v = 0
      } else {
        stepSpring(s, berth, PANEL_GLIDE_SPRING, 1 / 120)
      }
    }
    expect(s.x).toBe(berth)
    // The tilt reads glide velocity. A pinned slab has none, so a
    // resize cannot make the panel lean as if it were being flown.
    expect(s.v * DRAG_TILT).toBe(0)
  })
})
