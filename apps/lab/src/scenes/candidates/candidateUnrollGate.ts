// The close edge for the unroll candidate's sheet — when to fire `onClosed`.
//
// `RollSheet`'s `useFrame` eases a phase `t` toward `drive.target` and must
// hand the Surface back to the page (`piece.show('dom')`) exactly once when
// the sheet settles back to 0. The fire has to be an edge — every frame the
// menu spends closed looks like `t === 0` — so it is gated by a `rested`
// flag that flips to false the moment an open is wanted and back to true
// the moment the close lands.
//
// This is pure on purpose. The `useFrame` callback that calls it runs inside
// a react-three-fiber host, which needs a Canvas to exercise; the decision
// it owns does not. Lifting it out lets the abandoned-open fault be pinned
// by a plain test, the way `candidateCurlLaw` is.
//
// The fault (c7f78067): an open cancelled before the Surface protocol has
// lifted leaves `presentedView` on `'dom'`, so `drive.target` stays `0` for
// the whole cycle. Reading only `drive.target` leaves `rested` true through
// such a cycle — the close then looks exactly like rest, `onClosed` never
// fires, and the view is stranded on `'webgl'` with `useFrame` still
// warping vertices nobody sees. The user's intent (`open`) is the signal
// that an open is in flight even when the canvas has not presented yet, so
// the cancelled open still marks the sheet not at rest and the settling
// close still reclaims the view.

export interface UnrollCloseGateInput {
  /** The eased-toward goal: 1 open, 0 closed. Held at 0 while the lift is in flight. */
  target: number
  /** The eased phase, 0..1. Reaches 0 when the close lands. */
  t: number
  /** The user's ask: an open is wanted. True even before the canvas presents. */
  open: boolean
  /** The current edge flag. Starts true — the menu starts closed. */
  rested: boolean
}

export interface UnrollCloseGateResult {
  /** The next edge flag. */
  rested: boolean
  /** Fire `onClosed` this frame, exactly once per open/close cycle. */
  close: boolean
}

/**
 * One frame of the close edge. Pure and allocation-free to call every
 * `useFrame`: the two reachable answers are returned inline and the
 * carry-over answer hands the input flag back unchanged.
 */
export function unrollCloseGate(input: UnrollCloseGateInput): UnrollCloseGateResult {
  // An open in flight — whether the canvas has presented (`target` 1) or
  // is still lifting (`target` 0) — marks the sheet not at rest. Reading
  // `open` rather than only `target` is what catches the abandoned open:
  // `drive.target` is held at 0 until the lift lands, so a cancelled open
  // looks idle to `target` but wanted to `open`.
  if (input.target !== 0 || input.open) return { rested: false, close: false }
  // The close lands at `t === 0`. Fire once: the not-at-rest flag flips
  // back to true in the same step, so the next closed frame does not fire
  // again.
  if (input.t === 0 && !input.rested) return { rested: true, close: true }
  // Closing in progress (`t` still on its way down) or already at rest.
  // Hold the flag; nothing fires.
  return { rested: input.rested, close: false }
}
