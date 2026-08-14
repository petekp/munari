// The custody crossing — the library's threshold guarantee.
//
// A crossing moves content between the two renderers that both believe
// they own the pixels: the compositor (the DOM at rest) and the canvas
// (meshes wearing the DOM's capture). Three scenes hand-rolled this
// protocol before it became law — Flight gated its swap on the weaker
// upload receipt, Genie on the presentation boundary, the logo
// playground on presentation plus a settle dwell — and each met the same
// fault on the way: hide the DOM before the canvas has PROVEN it can
// present, and the content spends a frame in nobody's custody. That
// frame is the flicker a viewer reads as a seam. This law exists so no
// scene can reach that frame.
//
// The protocol is a four-phase machine:
//
//   dom ──request──▶ lifting ──evidence──▶ renderer
//    ▲                                        │
//    └── landing ◀──────────request───────────┘
//
// with one invariant, pinned by tests/conformance/transfer/crossing:
// AT EVERY PHASE, SOMEONE PRESENTS. 'dom' is compositor custody.
// 'lifting' is both drawing at once — the canvas warms UNSEEN,
// pixel-aligned with the page, while the DOM alone is composited
// (crossingPresentation owns that distinction). 'renderer' and
// 'landing' are canvas custody. No reachable state leaves both sides
// dark.
//
// Two rules do the guarding:
//
// - The DOM releases on EVIDENCE, never on hope: every incoming
//   presenter has fired its post-draw presentation boundary
//   (a color-writing draw completed — Surface.onFirstPresented — not
//   merely an upload queued), AND the settle dwell has elapsed, so the
//   page's autonomous idle motion has eased flat and the overlap is
//   pixel-identical (docs/authoring.md: idle motion rides a registered
//   custom property exactly so it CAN ease to zero before a crossing).
// - A request that arrives mid-crossing REVERSES the crossing; it never
//   skips to the far side. Skipping forward past the lift gate would
//   release the DOM without evidence; skipping back past the landing
//   would drop the canvas at nonzero amplitude. Both are custody gaps.
//
// The kernel owns the machine because the machine is renderer-agnostic:
// phases, evidence, reversal, and the amplitude that scene motion must
// scale by. The React binding owns the timing of the swap itself
// (commit order, microtasks, r3f frames) and reports evidence in.

export type CrossingPhase = 'dom' | 'lifting' | 'renderer' | 'landing'

export interface CrossingTiming {
  /**
   * ms the page gets to ease its autonomous motion flat before the DOM
   * may release, counted from the moment lifting begins (which is when
   * a consumer zeroes its motion amplitude). Evidence cannot shorten
   * this: six presenters proving in 80ms must still wait for the ease.
   */
  settleMs: number
  /** ms the custody amplitude takes to traverse 0..1, either direction. */
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
   * Custody amplitude, 0..1 linear. Zero in 'dom' and 'lifting' — the
   * canvas must overlap the page pixel-identically until the DOM has
   * released — rising only in 'renderer', falling through 'landing'.
   * Scenes read it through crossingAmplitude, not raw.
   */
  ramp: number
  /** ms spent in 'lifting' so far — the settle-dwell clock. */
  heldMs: number
}

/** The rest pose: compositor custody, no excursion, no dwell. */
export function crossingAtRest(): CrossingState {
  return { phase: 'dom', ramp: 0, heldMs: 0 }
}

/**
 * A user's ask: true wants the renderer to hold the content, false wants
 * the page back. Mid-crossing asks reverse — 'lifting' abandons the warm-up
 * (the DOM never released, so there is nothing to hand back) and 'landing'
 * climbs again from the amplitude it had (the canvas never released, so
 * there is nothing to re-prove). Asks that change nothing return the SAME
 * state reference, so a caller can detect a no-op by identity.
 */
export function crossingRequest(state: CrossingState, wantRenderer: boolean): CrossingState {
  const { phase } = state
  if (wantRenderer) {
    if (phase === 'dom') return { phase: 'lifting', ramp: 0, heldMs: 0 }
    if (phase === 'landing') return { ...state, phase: 'renderer' }
  } else {
    if (phase === 'lifting') return { phase: 'dom', ramp: 0, heldMs: 0 }
    if (phase === 'renderer') return { ...state, phase: 'landing' }
  }
  return state
}

/**
 * One renderer frame of protocol. dtMs is the frame's honest delta —
 * the binding clamps pathological deltas (a background tab must not
 * teleport the ramp), the law just integrates what it is given.
 *
 * 'lifting' accumulates the dwell and releases the DOM only when the
 * evidence is whole: every required presenter proven AND the settle
 * dwell served. 'renderer' raises the ramp to 1; 'landing' lowers it,
 * and at exactly zero returns custody to the page — the one frame where
 * the reverse swap happens, and it happens at zero amplitude so the
 * mesh being replaced is geometrically the page it reveals.
 */
export function crossingFrame(
  state: CrossingState,
  evidence: CrossingEvidence,
  dtMs: number,
  timing: CrossingTiming = CROSSING_DEFAULTS,
): CrossingState {
  const { phase } = state
  if (phase === 'dom') return state
  if (phase === 'lifting') {
    const heldMs = state.heldMs + dtMs
    const proven = evidence.presented >= evidence.required
    if (proven && heldMs >= timing.settleMs) return { phase: 'renderer', ramp: 0, heldMs }
    return { ...state, heldMs }
  }
  if (phase === 'renderer') {
    if (state.ramp >= 1) return state
    return { ...state, ramp: Math.min(1, state.ramp + dtMs / timing.rampMs) }
  }
  const ramp = Math.max(0, state.ramp - dtMs / timing.rampMs)
  if (ramp <= 0) return { phase: 'dom', ramp: 0, heldMs: 0 }
  return { ...state, ramp }
}

/** Who DRAWS pixels in a phase. The custody accounting theorem —
 *  `dom || renderer` for every phase — is the guarantee in law form,
 *  and the conformance contract walks every phase to pin it. Drawing is
 *  not showing: see crossingPresentation for who may be SEEN. */
export function crossingCustody(phase: CrossingPhase): { dom: boolean; renderer: boolean } {
  return {
    dom: phase === 'dom' || phase === 'lifting',
    renderer: phase !== 'dom',
  }
}

/**
 * Who is COMPOSITED — shown to the eye — in a phase. Custody says who
 * must draw; presentation says who may be seen, and the two differ in
 * exactly one place: 'lifting', where the renderer draws warm and
 * UNSEEN while it earns its receipts. Compositing it there puts two
 * copies of the same content on screen at once, and the moment the
 * page's motion displaces it off its twin the viewer sees both — a
 * ghost trailing or leading every animated element through the whole
 * settle dwell (the logo, 2026-08-14). So the theorem here is exclusive
 * where custody's is inclusive: EXACTLY ONE side presents in every
 * phase, and visibility changes hands only at the two swap edges. A
 * consumer wires this to the canvas's own visibility, never to mount —
 * an unmounted canvas cannot draw, an uncomposited one still can.
 */
export function crossingPresentation(phase: CrossingPhase): { dom: boolean; renderer: boolean } {
  return {
    dom: phase === 'dom' || phase === 'lifting',
    renderer: phase === 'renderer' || phase === 'landing',
  }
}

/**
 * The eased read of the ramp — smoothstep, so an excursion leaves rest
 * and arrives at full depth with zero velocity. Scene motion (bob,
 * wobble, dodge — anything that would break pixel-identity with the
 * page) multiplies by this, which is what makes lift-off a growth
 * instead of a jump and landing an exhale instead of a cut.
 */
export function crossingAmplitude(ramp: number): number {
  return ramp * ramp * (3 - 2 * ramp)
}
