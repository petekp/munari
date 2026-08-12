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
//   ζ ≈ 0.3  — a thrown bat switch: one hard overshoot, a visible
//              wobble or two, dead in half a second.
//   ζ ≈ 0.8  — a weighty knob: follows the hand with a whisper of
//              lag and the barest overshoot, never springy.

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
 *  decaying at this rate for every spring below (ωn ≤ ~35 rad/s). */
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

/** The bat switch: fast, underdamped, rings once or twice and dies. */
export const LEVER_SPRING: SpringParams = { stiffness: 900, damping: 19 }

/** Angular velocity (rad/s) a thumb-flick donates at the moment of a
 *  throw — the lever is thrown, not placed. */
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

/** How hard the slab leans into its own travel: radians of tilt per
 *  (px/s) of glide velocity, and the hard stop that keeps a flick from
 *  folding the panel over. */
export const DRAG_TILT = 0.00028
export const DRAG_TILT_MAX = 0.3

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
