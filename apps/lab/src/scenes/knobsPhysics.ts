// The feel of the hardware — a damped spring integrator and the tuned
// constants that give each moving part its mass.
//
// Same doctrine as every lab law: pure math a test can pin, read every
// frame by the scene, never touching React. The scene owns the state
// objects and calls `stepSpring` with the frame's dt; determinism comes
// from a fixed internal substep, so a 30Hz frame and a 120Hz frame
// integrate the same trajectory.
//
// Tuning vocabulary (pinned by knobsPhysics.test.ts):
//   damping ratio ζ < 1  — underdamped: overshoots, rings, settles.
//   ζ ≈ 0.6  — the slab carried by its handle: momentum you can see.
//   ζ ≈ 0.8  — a weighty knob: follows the hand with a whisper of
//              lag and the barest overshoot, never springy.
//   ζ = 1.0  — critical: the fastest approach that never crosses its
//              target. Sealed hardware — it goes where it is thrown
//              and stops there. Cheap hardware rings; expensive
//              hardware arrives.

export interface SpringState {
  x: number
  v: number
}

export interface SpringParams {
  /** k — pull toward the target, per unit displacement. */
  stiffness: number
  /** c — velocity drain. ζ = c / 2√k. */
  damping: number
}

/** Fixed integration substep. Semi-implicit Euler is stable and energy-
 *  decaying at this rate for every spring below (ωn ≤ 40 rad/s, set by
 *  the lever; the method needs ωn·h < 2 and this is ωn·h = 0.17). */
const SUBSTEP = 1 / 240

/** Longest frame gap we integrate rather than teleport through — a
 *  background tab returning should not spend 10s of spring energy. */
const MAX_FRAME = 1 / 20

/**
 * Advance `s` toward `target` by `dt` seconds, in place, and return it.
 * Mutating is deliberate: this runs per mesh per frame inside useFrame,
 * where allocating a state object every step is churn for nothing.
 */
export function stepSpring(
  s: SpringState,
  target: number,
  p: SpringParams,
  dt: number,
): SpringState {
  let remaining = Math.min(Math.max(dt, 0), MAX_FRAME)
  while (remaining > 0) {
    const h = Math.min(remaining, SUBSTEP)
    const a = p.stiffness * (target - s.x) - p.damping * s.v
    s.v += a * h
    s.x += s.v * h
    remaining -= h
  }
  return s
}

/** True once the spring has visibly stopped — position and velocity both
 *  inside epsilon. The scene may then stop writing the mesh transform. */
export function springSettled(
  s: SpringState,
  target: number,
  eps = 0.001,
  vEps = 0.01,
): boolean {
  return Math.abs(s.x - target) < eps && Math.abs(s.v) < vEps
}

/** ζ for a params pair — the number the tuning vocabulary above pins. */
export function dampingRatio(p: SpringParams): number {
  return p.damping / (2 * Math.sqrt(p.stiffness))
}

/**
 * The bat switch: thrown hard, and it stops dead where it lands.
 *
 * ζ is exactly 1 — critical, the fastest approach that never crosses its
 * target. This replaced { 900, 19 } (ζ = 0.32), which rang: measured at
 * the lever tip, that spring went 10.61 px PAST its stop and crossed the
 * target 11 times before it died. A person reads that wobble as light,
 * hollow plastic. Stiffening it fourfold buys the loss back — both
 * springs look arrived (inside half a pixel at the tip) at 142 ms, so
 * the switch is no slower to use; it simply does not ring.
 *
 * The no-bounce is structural, not tuned to the current numbers. At
 * ζ = 1 a spring only overshoots if the donated velocity beats ωn times
 * the distance left to travel: here 40 × 1.24 rad = 49.6 rad/s, against
 * a LEVER_THROW of 26. The margin holds for a re-flip at any moment of
 * the flight — swept every millisecond of the first 300, worst overshoot
 * 0.00 px — so the lever cannot be abused into a wobble.
 */
export const LEVER_SPRING: SpringParams = { stiffness: 1600, damping: 80 }

/** Angular velocity (rad/s) a thumb-flick donates at the moment of a
 *  throw — the lever is thrown, not placed.
 *
 *  Against a critically damped lever the thumb owns the LAUNCH and the
 *  spring owns the arrival: the flick carries the bat past centre in
 *  25 ms rather than 33, and then has nothing left to say about where it
 *  stops. That split is the point. Raising it past the 49.6 rad/s margin
 *  in LEVER_SPRING would buy the ring back. */
export const LEVER_THROW = 26

/** The knob body: heavy, near-critical, a whisper of lag behind the
 *  hand and almost no ring. */
export const KNOB_SPRING: SpringParams = { stiffness: 420, damping: 34 }

/** The whole slab on its mount: soft, mostly-damped sway. */
export const PANEL_SPRING: SpringParams = { stiffness: 120, damping: 16 }

/** Angular velocity (rad/s) a landing lever kicks into the slab — the
 *  thunk you see rather than hear. */
export const PANEL_KICK = 0.045

/** The slab carried by its handle: it trails the hand, overshoots the
 *  drop point, and swings once before it rests — momentum you can see. */
export const PANEL_GLIDE_SPRING: SpringParams = { stiffness: 70, damping: 10 }

/** How far a spring settles BEHIND a target that keeps moving at a
 *  steady rate. A step response ends on its target; a ramp never does,
 *  and the standing gap is what a hand reads as lag.
 *
 *  The constant is 2ζ/ωn, which reduces to plain c/k — the trailing
 *  distance does not care how the damping was split into a ratio. For
 *  the glide spring that is 10/70 = 0.143 s of hand travel. */
export function rampLag(p: SpringParams, rate: number): number {
  return (p.damping / p.stiffness) * rate
}

/** Does the slab glide, or is it pinned to its berth?
 *
 *  A carry is a journey, and the glide spring is what a journey feels
 *  like. A resize is not a journey: the panel stands still and changes
 *  size, and its berth shifts only because the berth is written in
 *  terms of w/2. Gliding to a berth that is itself being dragged makes
 *  the slab trail the hand by `rampLag` — tens of pixels at ordinary
 *  hand speeds — and then swing for the best part of a second after the
 *  hand stops. So a hand on the grip pins the slab to its berth, the
 *  same way a hand on the slab kills the wall bounce. */
export function berthPinned(resizing: boolean, carried: boolean): boolean {
  return resizing && !carried
}

/** How hard the slab leans into its own travel: radians of tilt per
 *  (px/s) of glide velocity, and the hard stop that keeps a flick from
 *  folding the panel over. */
export const DRAG_TILT = 0.00028
export const DRAG_TILT_MAX = 0.3

/** The slab shows its face to the middle of the glass: standing yaw at
 *  the viewport's edge, scaled down linearly toward dead center. */
export const PANEL_CENTER_YAW = 0.14

/**
 * Standing yaw (three `rotation.y`, radians) for a slab whose center
 * sits `centerX` px right of the viewport center on glass reaching
 * `halfWidth` px to the edge. The sign is the whole law: parked on the
 * right the yaw is negative, which drops the LEFT edge away from the
 * camera (−z) and turns the face toward the center — and mirrored on
 * the left. Clamped at the walls so a bump cannot ask for more lean
 * than the committed maximum.
 */
export function centerFacingYaw(centerX: number, halfWidth: number): number {
  if (halfWidth <= 0) return 0
  const off = Math.min(Math.max(centerX / halfWidth, -1), 1)
  return -off * PANEL_CENTER_YAW
}

// ── the free-spinning knob — flick it and the bearing carries it ────────

/** Bearing friction: seconds for a free spin to drain to 1/e. Total
 *  travel of a flick released at v is exactly v·τ — a hard flick
 *  carries a good arc of the sweep and can never run away. */
export const KNOB_SPIN_TAU = 0.4

/** Release slower than this (as a fraction of the knob's range per
 *  second) and the hand PLACED the knob — no spin. */
export const KNOB_FLICK_MIN = 0.25

/** A spin slower than this (fraction of range per second) is dead: the
 *  value stops moving and the loop may stop scheduling. */
export const KNOB_SPIN_MIN = 0.02

/**
 * Advance a free spin by `dt`: returns the distance traveled this frame
 * and drains the velocity in place. Exponential decay integrated
 * exactly, so a 30Hz frame and a 120Hz frame walk the same trajectory
 * with no substepping at all.
 */
export function stepSpin(s: { v: number }, dt: number): number {
  const clamped = Math.min(Math.max(dt, 0), MAX_FRAME)
  const decay = Math.exp(-clamped / KNOB_SPIN_TAU)
  const travel = s.v * KNOB_SPIN_TAU * (1 - decay)
  s.v *= decay
  return travel
}

// ── the slab meeting a viewport edge ────────────────────────────────────

/** How much of its speed the slab keeps after bumping an edge. */
export const PANEL_RESTITUTION = 0.55

/** Tilt kick per (px/s) of impact speed — the visible flinch of a
 *  bump — and the cap that keeps a violent throw from folding it over. */
export const BOUNCE_TILT = 0.0006
export const BOUNCE_TILT_MAX = 0.3

/**
 * Reflect a gliding spring off walls at `min`/`max`, in place: the
 * position folds back inside the range and the velocity reverses,
 * keeping `e` of itself. Returns the impact speed SIGNED by travel
 * direction (positive = hit the max wall, negative = the min wall),
 * 0 when no wall was touched. With `e = 0` the wall absorbs the hit
 * dead — a hand pressing the slab against the edge, not a bounce.
 */
export function reflect(s: SpringState, min: number, max: number, e: number): number {
  if (min >= max) return 0
  let impact = 0
  if (s.x < min) {
    impact = -Math.abs(s.v)
    s.x = min + (min - s.x)
    if (s.v < 0) s.v = -s.v * e
  } else if (s.x > max) {
    impact = Math.abs(s.v)
    s.x = max - (s.x - max)
    if (s.v > 0) s.v = -s.v * e
  }
  s.x = Math.min(max, Math.max(min, s.x))
  return impact
}
