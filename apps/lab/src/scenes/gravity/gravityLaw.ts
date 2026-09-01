// Gravity poetry's fall — pure rigid-body law for words that left the page.
//
// The law: a pulled word is a circle (radius from its own rect), it falls
// under gravity, and it piles against the floor and its neighbours with a
// little restitution and spin. Nothing here touches the DOM, THREE, or a
// clock of its own — the scene steps this world with real elapsed time and
// paints whatever comes out.
//
// Ownership: this module owns position, velocity, spin, and sleep for every
// fallen word. The scene owns turning a body into pixels.

export interface GravityBody {
  readonly id: number
  x: number
  y: number
  vx: number
  vy: number
  angle: number
  angularVelocity: number
  readonly w: number
  readonly h: number
  readonly radius: number
  asleep: boolean
  /** Pinned to the pointer mid-drag: the scene writes x/y/velocity directly
   *  and the solver treats it as infinite mass, like a sleeping body. */
  held: boolean
  /** Seconds spent under the sleep thresholds while resting; not a clock,
   *  just hysteresis so one slow substep doesn't sleep a body mid-bounce. */
  sleepTimer: number
}

export interface GravityBounds {
  width: number
  height: number
  floorY: number
}

// Every constant below is the value the scene spec asked for, or a small
// hand-picked number that makes the pile read as cloth-soft rather than
// bouncy-ball or concrete. This is a lab spike, not a conformance suite —
// nothing here is pinned by a contract.
export const GRAVITY = 2400 // px/s², spec'd
export const LINEAR_DRAG = 0.15 // 1/s, small air resistance so a hard swipe still arcs
export const RESTITUTION = 0.15 // spec'd: piles settle, they don't bounce
export const FLOOR_FRICTION = 2.5 // 1/s, kills sideways sliding once a word is down
export const SPIN_FROM_IMPACT = 0.012 // rad/s per px/s of tangential contact speed
// Below this closing speed a floor touch is resting contact, not an impact.
// Without the gate, gravity re-adds ~20px/s of vy every substep, the clamp
// sees vy > 0, and the spin impulse fires 120 times a second — a resting
// word winds up and spins in place (2026-09-01 user report).
export const IMPACT_SPEED = 90 // px/s
export const ANGULAR_DAMPING = 3 // 1/s
export const CONTACT_ANGULAR_DAMPING = 8 // 1/s extra while touching the floor
// Restoring torque toward upright while resting, per radian of tilt. Real
// gravity would also let a word rest at 180°, but upside-down poetry reads
// as a glitch (2026-09-01 capture: "thing" settled inverted), so the floor
// rights every word instead.
export const FLAT_TORQUE = 10 // rad/s² per rad
export const SLEEP_LINEAR_SPEED = 6 // px/s
export const SLEEP_ANGULAR_SPEED = 0.05 // rad/s
export const SLEEP_DELAY = 0.15 // s under threshold before a body sleeps
export const SUBSTEP_DT = 1 / 120 // s, fixed step for the collision solver
export const MAX_FRAME_DT = 0.25 // s, caps the catch-up after a stalled tab
export const COLLISION_PASSES = 4 // relaxation passes per substep, keeps piles from sinking
export const FLOOR_MARGIN = 8 // px above the viewport bottom, spec'd
const REST_EPS = 0.5 // px, "touching the floor" tolerance

/** A box collapses to one circle for body-body collision: mostly the box's
 *  half-height with a small width pad. At 0.35w the circle dwarfed the word
 *  — neighbours collided while visually apart and every body hovered off
 *  the floor (2026-09-01 user report). The floor uses the true rotated
 *  extent instead; the circle only spaces words in the pile, where a little
 *  paper-like overlap reads fine. */
export function bodyRadius(w: number, h: number): number {
  return 0.5 * h + 0.2 * w
}

/** Half-height of the rotated rect's vertical footprint — where the word
 *  actually meets the floor, so a flat word lies on its baseline instead of
 *  hovering on an oversized circle. */
export function floorExtent(body: GravityBody): number {
  return 0.5 * (body.w * Math.abs(Math.sin(body.angle)) + body.h * Math.abs(Math.cos(body.angle)))
}

export function boundsFromViewport(width: number, height: number): GravityBounds {
  return { width, height, floorY: height - FLOOR_MARGIN }
}

export function spawnBody(
  id: number,
  rect: { x: number; y: number; w: number; h: number },
  initialVelocity: { vx: number; vy: number },
  initialSpin: number,
): GravityBody {
  return {
    id,
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2,
    vx: initialVelocity.vx,
    vy: initialVelocity.vy,
    angle: 0,
    angularVelocity: initialSpin,
    w: rect.w,
    h: rect.h,
    radius: bodyRadius(rect.w, rect.h),
    asleep: false,
    held: false,
    sleepTimer: 0,
  }
}

function integrate(body: GravityBody, dt: number): void {
  body.vy += GRAVITY * dt
  body.vx -= body.vx * LINEAR_DRAG * dt
  body.vy -= body.vy * LINEAR_DRAG * dt
  body.x += body.vx * dt
  body.y += body.vy * dt
  body.angle += body.angularVelocity * dt
  body.angularVelocity -= body.angularVelocity * ANGULAR_DAMPING * dt
}

function resolveBounds(body: GravityBody, bounds: GravityBounds): void {
  const ext = floorExtent(body)
  const floorContact = body.y + ext >= bounds.floorY - REST_EPS
  if (body.y + ext > bounds.floorY) {
    body.y = bounds.floorY - ext
    if (body.vy > IMPACT_SPEED) {
      body.angularVelocity += body.vx * SPIN_FROM_IMPACT
      body.vy = -body.vy * RESTITUTION
    } else if (body.vy > 0) {
      body.vy = 0
    }
  }
  if (floorContact) {
    body.vx -= body.vx * FLOOR_FRICTION * SUBSTEP_DT
    body.angularVelocity -= body.angularVelocity * CONTACT_ANGULAR_DAMPING * SUBSTEP_DT
    // Right the word by the shorter arc — atan2 wraps the accumulated
    // angle to (-π, π], so a word that flipped keels back past 90° instead
    // of settling inverted.
    const tilt = Math.atan2(Math.sin(body.angle), Math.cos(body.angle))
    body.angularVelocity -= tilt * FLAT_TORQUE * SUBSTEP_DT
  }

  if (body.x - body.radius < 0) {
    body.x = body.radius
    if (body.vx < 0) {
      body.angularVelocity -= body.vy * SPIN_FROM_IMPACT
      body.vx = -body.vx * RESTITUTION
    }
  } else if (body.x + body.radius > bounds.width) {
    body.x = bounds.width - body.radius
    if (body.vx > 0) {
      body.angularVelocity += body.vy * SPIN_FROM_IMPACT
      body.vx = -body.vx * RESTITUTION
    }
  }
}

/** Positional correction plus a velocity impulse along the contact normal,
 *  weighted by radius² (area) so a short word doesn't fling a long one. A
 *  sleeping body acts as infinite mass — it holds the pile up, unmoved. */
function resolveCollision(a: GravityBody, b: GravityBody): void {
  let dx = b.x - a.x
  let dy = b.y - a.y
  let dist = Math.hypot(dx, dy)
  const minDist = a.radius + b.radius
  if (dist >= minDist) return
  if (dist === 0) {
    // Exact overlap: nudge apart along a stable direction derived from the
    // ids so two words spawned on the same spot don't sit locked forever.
    dx = a.id < b.id ? 1 : -1
    dy = 0
    dist = 1
  }
  const nx = dx / dist
  const ny = dy / dist
  const overlap = minDist - dist

  const massA = a.radius * a.radius
  const massB = b.radius * b.radius
  const invA = a.asleep || a.held ? 0 : 1 / massA
  const invB = b.asleep || b.held ? 0 : 1 / massB
  const invSum = invA + invB
  if (invSum === 0) return

  a.x -= (nx * overlap * invA) / invSum
  a.y -= (ny * overlap * invA) / invSum
  b.x += (nx * overlap * invB) / invSum
  b.y += (ny * overlap * invB) / invSum

  const rvx = b.vx - a.vx
  const rvy = b.vy - a.vy
  const velAlongNormal = rvx * nx + rvy * ny
  if (velAlongNormal > 0) return

  const impulse = (-(1 + RESTITUTION) * velAlongNormal) / invSum
  a.vx -= nx * impulse * invA
  a.vy -= ny * impulse * invA
  b.vx += nx * impulse * invB
  b.vy += ny * impulse * invB

  const tx = -ny
  const ty = nx
  const tangentSpeed = rvx * tx + rvy * ty
  a.angularVelocity -= tangentSpeed * SPIN_FROM_IMPACT * (invA / invSum)
  b.angularVelocity += tangentSpeed * SPIN_FROM_IMPACT * (invB / invSum)

  if (!a.asleep && !a.held) a.sleepTimer = 0
  if (!b.asleep && !b.held) b.sleepTimer = 0
}

function updateSleep(body: GravityBody, bounds: GravityBounds, dt: number): void {
  const resting = body.y + floorExtent(body) >= bounds.floorY - REST_EPS
  const slow =
    body.vx * body.vx + body.vy * body.vy < SLEEP_LINEAR_SPEED * SLEEP_LINEAR_SPEED &&
    Math.abs(body.angularVelocity) < SLEEP_ANGULAR_SPEED
  if (resting && slow) {
    body.sleepTimer += dt
    if (body.sleepTimer >= SLEEP_DELAY) {
      body.asleep = true
      body.vx = 0
      body.vy = 0
      body.angularVelocity = 0
    }
  } else {
    body.sleepTimer = 0
  }
}

function substep(bodies: GravityBody[], bounds: GravityBounds, dt: number): void {
  for (const body of bodies) {
    if (body.asleep || body.held) continue
    integrate(body, dt)
    resolveBounds(body, bounds)
  }
  for (let pass = 0; pass < COLLISION_PASSES; pass++) {
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i]
        const b = bodies[j]
        if ((a.asleep || a.held) && (b.asleep || b.held)) continue
        resolveCollision(a, b)
      }
    }
  }
  for (const body of bodies) {
    if (body.asleep || body.held) continue
    updateSleep(body, bounds, dt)
  }
}

/** Advances the whole world by `dt` seconds of real time, in fixed
 *  substeps. Frame time above `MAX_FRAME_DT` (a stalled tab, a debugger
 *  pause) is clamped rather than replayed, so the pile doesn't tunnel
 *  through the floor catching up. */
export function stepWorld(bodies: GravityBody[], bounds: GravityBounds, dt: number): void {
  let remaining = Math.min(dt, MAX_FRAME_DT)
  while (remaining > 0) {
    const h = Math.min(SUBSTEP_DT, remaining)
    substep(bodies, bounds, h)
    remaining -= h
  }
}

/** Drops a body straight to the floor and unwinds any overlap against the
 *  already-settled pile, position only — for prefers-reduced-motion, where
 *  a word must arrive with no visible flight or spin. */
export function settleInstant(
  body: GravityBody,
  bounds: GravityBounds,
  others: readonly GravityBody[],
): void {
  body.x = Math.min(Math.max(body.x, body.radius), bounds.width - body.radius)
  body.y = bounds.floorY - body.h / 2
  body.vx = 0
  body.vy = 0
  body.angularVelocity = 0
  body.angle = 0
  body.asleep = true
  body.held = false
  body.sleepTimer = SLEEP_DELAY

  for (let pass = 0; pass < COLLISION_PASSES; pass++) {
    for (const other of others) {
      if (other.id === body.id || !other.asleep) continue
      let dx = body.x - other.x
      let dy = body.y - other.y
      let dist = Math.hypot(dx, dy)
      const minDist = body.radius + other.radius
      if (dist >= minDist) continue
      if (dist === 0) {
        dx = 0
        dy = -1
        dist = 1
      }
      const overlap = minDist - dist
      body.x += (dx / dist) * overlap
      body.y += (dy / dist) * overlap
      body.y = Math.min(body.y, bounds.floorY - body.radius)
      body.x = Math.min(Math.max(body.x, body.radius), bounds.width - body.radius)
    }
  }
}

/** Keeps every body inside the current viewport after a resize — walls and
 *  floor may have moved inward while a body sat outside the new box. */
export function clampToBounds(bodies: GravityBody[], bounds: GravityBounds): void {
  for (const body of bodies) {
    body.x = Math.min(Math.max(body.x, body.radius), bounds.width - body.radius)
    const ext = floorExtent(body)
    if (body.y + ext > bounds.floorY) body.y = bounds.floorY - ext
  }
}

/** Rect-vs-circle is overkill for a rotated word; the same radius the
 *  physics collides with is close enough to click. */
export function hitTestBody(body: GravityBody, x: number, y: number): boolean {
  const dx = x - body.x
  const dy = y - body.y
  return dx * dx + dy * dy <= body.radius * body.radius
}
