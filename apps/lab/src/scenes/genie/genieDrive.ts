// The genie drive — the law of TIME for the minimize.
//
// genieLaw owns shape (where a sheet point sits for a given t); this
// file owns how t moves. Three owners, three regimes:
//
//   clock  an untouched flight: eased time, exactly as 2001 shipped it.
//   grab   a hand on the titlebar: t is wherever the hand says, with a
//          velocity estimate riding along so a flick is legible.
//   spring after release: a slightly underdamped spring toward the fate
//          the commit rule chose. Underdamped ON PURPOSE — reaching the
//          target wall is the LANDING (a real object stops at the desk,
//          it does not ease asymptotically into it), and the crossing
//          momentum is handed off in `arrivalV` for the settle wobble
//          (genieLaw's genieSettle) to consume. Spring until contact,
//          wobble after contact.
//
// Everything is pure and analytic. The spring advances by the exact
// closed-form solution, not Euler steps, so frame rate cannot change
// where the sheet goes — genieDrive.test.ts pins 60fps and 240fps to
// the same trajectory, and pins the perceptual floor: released sheets
// come to rest within 400ms from any reachable state.

export interface DriveParams {
  /** Natural frequency of the release spring, rad/s. */
  omega: number
  /** Damping ratio, deliberately just under 1 (see header). */
  zeta: number
  /** Release at or above this t commits to the dock, absent a flick. */
  commitT: number
  /** Release speed (t/s) that overrides position — the flick. */
  commitV: number
  /** Clamp on |v| entering the spring: a wild sample cannot launch it. */
  vMax: number
}

export const DRIVE_DEFAULTS: DriveParams = {
  omega: 28,
  zeta: 0.8,
  commitT: 0.45,
  commitV: 1.2,
  vMax: 6,
}

export interface DriveState {
  t: number
  v: number
}

/**
 * Move the presented progress toward the drive without exceeding the same
 * velocity ceiling used by a released sheet. This only matters when a hand
 * has moved while the texture handoff was still hidden: the drive keeps the
 * real pointer target, while presentation catches it over several frames
 * instead of appearing one large step away from the wall.
 */
export function drivePresentationStep(current: number, target: number, dt: number, maxV: number): number {
  const delta = target - current
  const step = Math.min(Math.abs(delta), maxV * dt)
  return current + Math.sign(delta) * step
}

export function easeInOutCubic(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
}

/**
 * The minimize's ease: starts FLATTER than easeInOutCubic (a plain
 * cubic ramp, slope 0 at p = 0) and ENDS WITH SPEED (slope 3 at p = 1,
 * linear scale) — the flat start is why a slow-motion catch still
 * finds the titlebar near rest partway in, and the end speed is what
 * feeds the dock's landing ring (MIN_END_SLOPE in Genie.tsx).
 */
export function easeInCubic(p: number): number {
  return p * p * p
}

/**
 * The restore's ease: leaves the mouth gently (slope 0), ARRIVES WITH
 * SPEED (slope ~0.8 of linear). The arrival velocity is not a flourish
 * — it is what the settle wobble consumes, so an untouched click-restore
 * lands like matter instead of a tween ending. Half classic in-out,
 * half p^1.6, which is the cheapest curve with those two slopes.
 */
export function pourOut(p: number): number {
  return 0.5 * easeInOutCubic(p) + 0.5 * Math.pow(p, 1.6)
}

/**
 * The fate of a released sheet. A strong flick decides regardless of
 * position; a gentle release falls to the side of `commitT` it was on.
 * v is t/s: positive is toward the dock.
 */
export function driveCommit(t: number, v: number, p: DriveParams): 0 | 1 {
  if (Math.abs(v) >= p.commitV) return v > 0 ? 1 : 0
  return t >= p.commitT ? 1 : 0
}

/**
 * One analytic step of the release spring toward `target` (a wall of
 * the t-domain). Contact with the target wall ends the flight: t snaps
 * to the target, the crossing speed is reported ONCE in `arrivalV`,
 * and `done` is set. Absent contact, `done` fires when both position
 * and velocity are beneath perception (and t snaps then too — the swap
 * frame reads t, and identity is only exact at the walls).
 */
/** One integration step, and what the caller does with it. */
export interface DriveStep {
  t: number
  v: number
  /** Speed at the wall, reported once, on the frame that lands. */
  arrivalV: number
  done: boolean
}

export function driveSpringStep(
  s: DriveState,
  target: 0 | 1,
  dt: number,
  p: DriveParams,
): DriveStep {
  // vMax is an ENTRY guard (its doc string: a wild sample cannot launch
  // it), applied once where the drive switches to 'spring' (Genie.tsx:
  // commitGrab and the Escape handler). Re-clamping here each step would
  // cap the spring's own evolving velocity and make the closed-form
  // trajectory depend on dt — breaking "frame rate cannot change where
  // the sheet goes" wherever the natural peak beats vMax. Trust it.
  const vIn = s.v
  const x0 = s.t - target
  const zw = p.zeta * p.omega
  const wd = p.omega * Math.sqrt(1 - p.zeta * p.zeta)
  const A = x0
  const B = (vIn + zw * x0) / wd
  const decay = Math.exp(-zw * dt)
  const cos = Math.cos(wd * dt)
  const sin = Math.sin(wd * dt)
  const x = decay * (A * cos + B * sin)
  const v = decay * ((B * wd - zw * A) * cos - (A * wd + zw * B) * sin)
  let t = x + target

  // Contact with the target wall: the landing.
  if ((target === 0 && t <= 0) || (target === 1 && t >= 1)) {
    return { t: target, v: 0, arrivalV: Math.abs(v), done: true }
  }
  // The far wall (only reachable by a flick against the chosen fate):
  // stop dead there, keep springing. No handoff — nothing landed.
  if (t < 0) return { t: 0, v: 0, arrivalV: 0, done: false }
  if (t > 1) return { t: 1, v: 0, arrivalV: 0, done: false }

  if (Math.abs(x) < 0.002 && Math.abs(v) < 0.02) {
    return { t: target, v: 0, arrivalV: 0, done: true }
  }
  return { t, v, arrivalV: 0, done: false }
}

// The velocity estimate's memory. Short enough that five frames of a
// steady drag read as that drag's speed (pinned in the tests), long
// enough that one jittery pointer sample cannot fake a flick.
const GRAB_V_TAU = 0.035

/**
 * One grabbed step: the sheet is wherever the hand says (clamped to the
 * drain), and the velocity estimate is an exponential moving average of
 * the hand's own speed — that estimate is what the commit rule reads at
 * release, so a flick mid-gesture survives the final settled samples.
 */
export function driveGrabStep(s: DriveState, targetT: number, dt: number): DriveState {
  const t = Math.max(0, Math.min(1, targetT))
  const raw = (t - s.t) / dt
  const alpha = 1 - Math.exp(-dt / GRAB_V_TAU)
  return { t, v: s.v + alpha * (raw - s.v) }
}
