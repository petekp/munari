// The crossing — the library's threshold guarantee.
//
// A crossing moves content between the two renderers that both believe
// they own the pixels: the compositor (the page at rest) and the canvas
// (meshes wearing the page's capture). Three scenes hand-rolled this
// protocol before it became law — Flight gated its swap on the weaker
// upload receipt, Genie on the presentation boundary, the logo
// playground on presentation plus a settle dwell — and each met the same
// fault on the way: hide the page before the canvas has PROVEN it can
// present, and the content spends a frame in nobody's hands. That
// frame is the flicker a viewer reads as a seam. This law exists so no
// scene can reach that frame.
//
// The protocol is a four-phase machine:
//
//   page ──request──▶ lifting ──evidence──▶ gl
//    ▲                                      │
//    └── landing ◀───────request────────────┘
//
// with one invariant, pinned by tests/conformance/transfer/crossing:
// AT EVERY PHASE, SOMEONE DRAWS. 'page' is the page holding alone.
// 'lifting' is both drawing at once — the canvas warms UNSEEN,
// pixel-aligned with the page, while the page alone is composited
// (crossingPresentation owns that distinction). 'gl' and 'landing'
// are the canvas holding. No reachable state leaves both sides dark.
//
// Two rules do the guarding:
//
// - The page releases on EVIDENCE, never on hope: every incoming
//   presenter has fired its post-draw presentation boundary
//   (a color-writing draw completed — Surface.onFirstPresented — not
//   merely an upload queued), AND the settle dwell has elapsed, so the
//   page's autonomous idle motion has eased flat and the overlap is
//   pixel-identical (docs/authoring.md: idle motion rides a registered
//   custom property exactly so it CAN ease to zero before a crossing).
// - A request that arrives mid-crossing REVERSES the crossing; it never
//   skips to the far side. Skipping forward past the lift gate would
//   release the page without evidence; skipping back past the landing
//   would drop the canvas at nonzero progress. Both leave the pixels
//   in nobody's hands.
//
// The kernel owns the machine because the machine is renderer-agnostic:
// phases, evidence, reversal, and the progress that scene motion must
// scale by. The React binding owns the timing of the swap itself
// (commit order, microtasks, r3f frames) and reports evidence in.

export type CrossingPhase = 'page' | 'lifting' | 'gl' | 'landing'

export interface CrossingTiming {
  /**
   * ms the page gets to ease its autonomous motion flat before it may
   * release, counted from the moment lifting begins (which is when
   * a consumer zeroes its motion amplitude). Evidence cannot shorten
   * this: six presenters proving in 80ms must still wait for the ease.
   */
  settleMs: number
  /** ms the flight ramp takes to traverse 0..1, either direction. */
  rampMs: number
}

/**
 * settleMs covers the ~400ms ease a registered custom property needs to
 * reach zero plus a compositor frame of slack; rampMs is the excursion
 * ramp the eye reads as "the page grew depth" rather than "it cut".
 */
export const CROSSING_DEFAULTS: CrossingTiming = {
  settleMs: 450,
  rampMs: 600,
}

/** What the canvas has proven so far. `required` is the number of
 *  incoming presenters this crossing waits on; `presented` counts those
 *  whose first post-draw presentation boundary has fired. */
export interface CrossingEvidence {
  presented: number
  required: number
}

export interface CrossingState {
  phase: CrossingPhase
  /**
   * The flight ramp, 0..1 linear. Zero in 'page' and 'lifting' — the
   * canvas must overlap the page pixel-identically until the page has
   * released — rising only in 'gl', falling through 'landing'.
   * Scenes read it through crossingProgress, not raw.
   */
  ramp: number
  /** ms spent in 'lifting' so far — the settle-dwell clock. */
  heldMs: number
}

/** The rest pose: the page holds, no excursion, no dwell. */
export function crossingAtRest(): CrossingState {
  return { phase: 'page', ramp: 0, heldMs: 0 }
}

/**
 * A user's ask: true wants the canvas to hold the content, false wants
 * the page back. Mid-crossing asks reverse — 'lifting' abandons the warm-up
 * (the page never released, so there is nothing to hand back) and 'landing'
 * climbs again from the ramp it had (the canvas never released, so
 * there is nothing to re-prove). Asks that change nothing return the SAME
 * state reference, so a caller can detect a no-op by identity.
 */
export function crossingRequest(state: CrossingState, wantGl: boolean): CrossingState {
  const { phase } = state
  if (wantGl) {
    if (phase === 'page') return { phase: 'lifting', ramp: 0, heldMs: 0 }
    if (phase === 'landing') return { ...state, phase: 'gl' }
  } else {
    if (phase === 'lifting') return { phase: 'page', ramp: 0, heldMs: 0 }
    if (phase === 'gl') return { ...state, phase: 'landing' }
  }
  return state
}

/**
 * One renderer frame of protocol. dtMs is the frame's honest delta —
 * the binding clamps pathological deltas (a background tab must not
 * teleport the ramp), the law just integrates what it is given.
 *
 * 'lifting' accumulates the dwell and releases the page only when the
 * evidence is whole: every required presenter proven AND the settle
 * dwell served. 'gl' raises the ramp to 1; 'landing' lowers it,
 * and at exactly zero hands the pixels back to the page — the one frame
 * where the reverse handoff happens, and it happens at zero progress so
 * the mesh being replaced is geometrically the page it reveals.
 */
export function crossingFrame(
  state: CrossingState,
  evidence: CrossingEvidence,
  dtMs: number,
  timing: CrossingTiming = CROSSING_DEFAULTS,
): CrossingState {
  const { phase } = state
  if (phase === 'page') return state
  if (phase === 'lifting') {
    const heldMs = state.heldMs + dtMs
    const proven = evidence.presented >= evidence.required
    if (proven && heldMs >= timing.settleMs) return { phase: 'gl', ramp: 0, heldMs }
    return { ...state, heldMs }
  }
  if (phase === 'gl') {
    if (state.ramp >= 1) return state
    return { ...state, ramp: Math.min(1, state.ramp + dtMs / timing.rampMs) }
  }
  const ramp = Math.max(0, state.ramp - dtMs / timing.rampMs)
  if (ramp <= 0) return { phase: 'page', ramp: 0, heldMs: 0 }
  return { ...state, ramp }
}

/** One yes/no per side — the page's compositor and the canvas. Both
 *  theorems below answer in this shape, which is why they can be
 *  compared phase by phase. */
export interface SideFlags {
  page: boolean
  gl: boolean
}

/** Who DRAWS pixels in a phase. The accounting theorem —
 *  `page || gl` for every phase — is the guarantee in law form,
 *  and the conformance contract walks every phase to pin it. Drawing is
 *  not showing: see crossingPresentation for who may be SEEN. */
export function crossingDraws(phase: CrossingPhase): SideFlags {
  return {
    page: phase === 'page' || phase === 'lifting',
    gl: phase !== 'page',
  }
}

/**
 * Who is COMPOSITED — shown to the eye — in a phase. Drawing says who
 * must keep pixels warm; presentation says who may be seen, and the two
 * differ in exactly one place: 'lifting', where the canvas draws warm
 * and UNSEEN while it earns its receipts. Compositing it there puts two
 * copies of the same content on screen at once, and the moment the
 * page's motion displaces it off its twin the viewer sees both — a
 * ghost trailing or leading every animated element through the whole
 * settle dwell (the logo, 2026-08-14). So the theorem here is exclusive
 * where the drawing one is inclusive: EXACTLY ONE side presents in every
 * phase, and visibility changes hands only at the two handoff edges. A
 * consumer wires this to the canvas's own visibility, never to mount —
 * an unmounted canvas cannot draw, an uncomposited one still can.
 */
export function crossingPresentation(phase: CrossingPhase): SideFlags {
  return {
    page: phase === 'page' || phase === 'lifting',
    gl: phase === 'gl' || phase === 'landing',
  }
}

/**
 * The eased read of the ramp — smoothstep, so an excursion leaves rest
 * and arrives at full depth with zero velocity. Scene motion (bob,
 * wobble, dodge — anything that would break pixel-identity with the
 * page) multiplies by this, which is what makes lift-off a growth
 * instead of a jump and landing an exhale instead of a cut.
 */
export function crossingProgress(ramp: number): number {
  return ramp * ramp * (3 - 2 * ramp)
}

/**
 * A choreography window over the progress: how far through
 * [from, from + distance] the flight is, clamped to 0..1 and linear
 * inside — the same shape as drei's useScroll().range, because our
 * users' hands already know it. Staggering effects is nothing but
 * giving each its own window; every window evaluates to 0 at progress 0
 * and the progress itself eases, so an effect that multiplies a range
 * is zero — with zero velocity — at both handoff edges by construction.
 */
export function crossingRange(progress: number, from: number, distance: number): number {
  if (distance <= 0) return progress >= from ? 1 : 0
  return Math.min(1, Math.max(0, (progress - from) / distance))
}

/**
 * The bell over the same window — 0 → 1 → 0, drei's useScroll().curve —
 * for effects that should exist only MID-flight (streaks, an extra
 * bloom): zero at both ends of its window wherever the window sits, so
 * it can never violate the handoff-identity law even at full width.
 */
export function crossingCurve(progress: number, from: number, distance: number): number {
  return Math.sin(crossingRange(progress, from, distance) * Math.PI)
}
