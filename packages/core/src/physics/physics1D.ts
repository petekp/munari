// The physics core of the control kit: one 1-DOF body, one
// integrator, and control "feel" expressed as composable force fields. A
// dial IS detentField + damping. No easing curves, no durations — release
// velocity flows into the field and the field decides where things land.
//
// q is the generalized coordinate (an angle for rotary controls, travel for
// linear ones); fields return acceleration for a unit mass. Semi-implicit
// (symplectic) Euler with substeps: velocity first, then position with the
// NEW velocity — this is what keeps stiff spring fields from gaining energy
// and exploding at coarse timesteps, where naive Euler does.

/** The generalized coordinate: an angle for rotary controls, travel for linear ones. */
export interface Body1D {
  q: number
  v: number
}

/** Acceleration as a function of state. Compose by summation. */
export type Field = (q: number, v: number) => number

export const composeFields = (...fields: Field[]): Field => {
  return (q, v) => {
    let a = 0
    for (const f of fields) a += f(q, v)
    return a
  }
}

/** Viscous damping — every real control has some. */
export const damping = (c: number): Field => {
  return (_q, v) => -c * v
}

/**
 * Periodic detents: n wells per revolution at q = 2πj/n (the dial).
 * Near a well the effective stiffness is k·n.
 */
export const detentField = (n: number, k: number): Field => {
  return (q) => -k * Math.sin(n * q)
}

/**
 * Advance the body by dt. Substeps split dt for stability — a field with
 * effective stiffness K needs h well under 2/√K; substeps=2 at 30fps holds
 * for everything in the kit's tuning range.
 */
export function step(body: Body1D, field: Field, dt: number, substeps = 2): void {
  const h = dt / substeps
  for (let i = 0; i < substeps; i++) {
    body.v += field(body.q, body.v) * h
    body.q += body.v * h
  }
}

// The bisection harness: double to bound the threshold, then close in. The
// predicate runs the actual integrator.
function minImpulse(margin: number, succeeds: (v0: number) => boolean): number {
  let lo = 0
  let hi = 1
  while (!succeeds(hi) && hi < 1024) hi *= 2
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (succeeds(mid)) hi = mid
    else lo = mid
  }
  return hi * margin
}

/**
 * The minimum impulse that carries a body from one well center past the
 * barrier into the next well (the dial's keyboard ratchet — one arrow press,
 * one detent), found by bisection against the actual integrator so the
 * strength adapts to any tuning. Returns a positive speed; the caller signs it.
 * margin keeps single presses decisive; key-repeat compounds impulses into
 * momentum by design, so margin stays small enough not to skip a second
 * well from rest (pinned by test).
 */
export function hopImpulse(field: Field, wellSpacing: number, margin = 1.25): number {
  return minImpulse(margin, (v0) => {
    const body: Body1D = { q: 0, v: v0 }
    for (let i = 0; i < 4 * 120; i++) step(body, field, 1 / 120, 2)
    return body.q > wellSpacing / 2
  })
}
