import { describe, expect, it } from 'vitest'
import { unrollCloseGate } from './candidateUnrollGate'

// The close edge for the unroll sheet, pinned two ways. The pure unit cases
// hold the gate's own contract (exactly-once fire, the abandoned-open fix).
// The simulation drives the gate through a frame-by-frame model of the
// candidate's `drive`/`presentedView` pair — the same model the report's
// `instruments/unroll_abandon.mjs` used to show the leak — and asserts the
// abandoned cycle reclaims the view instead of stranding it on 'webgl'.

describe('unrollCloseGate — pure contract', () => {
  it('starts at rest and stays there while nothing is asked', () => {
    // The menu starts closed. A closed, idle frame must not fire — every
    // closed frame looks like this one, so the edge flag has to hold.
    const a = unrollCloseGate({ target: 0, t: 0, open: false, rested: true })
    expect(a).toEqual({ rested: true, close: false })
    const b = unrollCloseGate({ target: 0, t: 0, open: false, rested: a.rested })
    expect(b).toEqual({ rested: true, close: false })
  })

  it('marks the sheet not at rest the moment an open is wanted, before the canvas presents', () => {
    // The abandoned-open fault (c7f78067): `drive.target` is held at 0
    // until the lift lands, so a just-requested open looks idle to
    // `target`. Reading `open` is what catches it: the first frame of an
    // open in flight flips `rested` to false even with `target` still 0.
    const out = unrollCloseGate({ target: 0, t: 0, open: true, rested: true })
    expect(out).toEqual({ rested: false, close: false })
  })

  it('stays not at rest once the canvas has presented (target 1) too', () => {
    const out = unrollCloseGate({ target: 1, t: 0.5, open: true, rested: false })
    expect(out).toEqual({ rested: false, close: false })
  })

  it('does not fire while the close is still in flight', () => {
    // `open` is false and `target` is 0, but `t` has not reached 0 yet —
    // the sheet is still rolling up. Hold the flag; the close has not
    // landed.
    const out = unrollCloseGate({ target: 0, t: 0.37, open: false, rested: false })
    expect(out).toEqual({ rested: false, close: false })
  })

  it('fires onClosed exactly once when the close lands, and returns to rest', () => {
    // The landing frame: open false, target 0, t just reached 0, and the
    // sheet was not at rest. Fire once and flip the flag back to true.
    const out = unrollCloseGate({ target: 0, t: 0, open: false, rested: false })
    expect(out).toEqual({ rested: true, close: true })
    // The very next frame looks identical to rest, and must NOT fire
    // again — exactly once per open/close cycle.
    const next = unrollCloseGate({ target: 0, t: 0, open: false, rested: out.rested })
    expect(next).toEqual({ rested: true, close: false })
  })

  it('never fires from a closed, at-rest frame even if it arrived at one', () => {
    // A stray frame that finds t already 0 and rested already true is a
    // no-op, not a close — the flag is the edge, not the value.
    expect(unrollCloseGate({ target: 0, t: 0, open: false, rested: true })).toEqual({
      rested: true,
      close: false,
    })
  })

  it('treats an open request as not at rest even when t is already at 0', () => {
    // Same shape as the abandoned open at the instant of the click: the
    // ease has not moved (t 0) because the lift has not presented, but the
    // user did ask. `rested` must flip so a following close can land.
    const out = unrollCloseGate({ target: 0, t: 0, open: true, rested: true })
    expect(out).toEqual({ rested: false, close: false })
  })
})

// A frame-by-frame model of the candidate's `drive` + `presentedView` pair,
// the same shape the report traced: the open is fire-and-forget (the lift
// lands after `nLift` host frames regardless of `open`), `drive.target` is
// gated on `presentedView === 'webgl'`, and only an `onClosed`-driven
// `piece.show('dom')` reclaims the view. The ease matches the real one
// (`unrollTuning.tau = 0.085`) at a 60Hz clamp.
const TAU = 0.085
const FRAME = 1 / 60

type View = 'dom' | 'webgl'

interface SimState {
  target: number
  t: number
  rested: boolean
  presentedView: View
  showDomCalls: number
}

/**
 * Step one frame. `open` is the user's ask this frame. The protocol's
 * forward crossing takes `lift.frames` frames to flip `presentedView` to
 * `'webgl'` (line-referenced in the report: `'lifting'` needs every
 * presenter to prove plus `settleMs`). `lifting` counts down from the
 * first `show('webgl')` request; the lift proceeds independently of the
 * ask, exactly as the fire-and-forget open does.
 */
function step(state: SimState, open: boolean, lift: { frames: number }): SimState {
  // drive.target = open && presentedView === 'webgl' ? 1 : 0
  const target = open && state.presentedView === 'webgl' ? 1 : 0
  // The ease, clamped to 1/30 the way the candidate clamps delta.
  const dt = Math.min(FRAME, 1 / 30)
  let t = state.t + (target - state.t) * (1 - Math.exp(-dt / TAU))
  if (Math.abs(target - t) < 0.001) t = target

  const gate = unrollCloseGate({ target, t, open, rested: state.rested })

  let showDomCalls = state.showDomCalls
  let presentedView = state.presentedView
  if (gate.close) {
    // onClosed() → piece.show('dom') reclaims the view.
    showDomCalls += 1
    presentedView = 'dom'
  }

  // The fire-and-forget lift: if a show('webgl') is in flight, count it
  // down; it lands on 'webgl' regardless of `open`. A `close` above
  // reclaims before the lift lands (crossingRequest(false) on 'lifting'
  // reverses to 'page' cleanly), so cancel any in-flight lift.
  if (gate.close) {
    lift.frames = 0
  } else if (lift.frames > 0) {
    lift.frames -= 1
    if (lift.frames === 0) presentedView = 'webgl'
  }

  return { target, t, rested: gate.rested, presentedView, showDomCalls }
}

function fresh(): SimState {
  return { target: 0, t: 0, rested: true, presentedView: 'dom', showDomCalls: 0 }
}

describe('unrollCloseGate — abandoned-open simulation', () => {
  it('scenario A (normal): open → lift → close releases the view once', () => {
    const lift = { frames: 0 }
    const nLift = 5
    let s = fresh()
    // open
    lift.frames = nLift
    for (let i = 0; i < 60; i++) s = step(s, true, lift)
    expect(s.presentedView).toBe('webgl')
    expect(s.t).toBeCloseTo(1, 3)
    // close
    for (let i = 0; i < 60; i++) s = step(s, false, lift)
    expect(s.showDomCalls).toBe(1)
    expect(s.presentedView).toBe('dom')
    expect(s.t).toBe(0)
  })

  it('scenario B (abandoned): close before the lift lands still releases the view', () => {
    // The bug: open then close again while presentedView is still 'dom'.
    // The cancelled open must still mark the sheet not at rest, so when
    // the close settles, onClosed fires and the view comes home. With the
    // pre-fix gate (target-only) this is the LEAK: showDomCalls 0 and the
    // view stranded on 'webgl'.
    const lift = { frames: 0 }
    const nLift = 5
    let s = fresh()
    // open for one frame (the click) — the lift begins but does not land
    lift.frames = nLift
    s = step(s, true, lift)
    expect(s.presentedView).toBe('dom')
    // close immediately, before the lift lands. Drive long enough for the
    // ease to settle (t was 0 throughout, so it settles immediately) and
    // for any in-flight lift to either land or be cancelled by the close.
    for (let i = 0; i < 40; i++) s = step(s, false, lift)
    expect(s.showDomCalls).toBe(1)
    expect(s.presentedView).toBe('dom')
    expect(s.t).toBe(0)
    // No second fire while it sits abandoned-then-closed afterwards.
    for (let i = 0; i < 30; i++) s = step(s, false, lift)
    expect(s.showDomCalls).toBe(1)
  })

  it('scenario C: a second full open/close after an abandoned cycle does not double-fire', () => {
    // The report's recovery path — a second full open/close — is now a
    // no-op as a *recovery* because the first cycle already came home,
    // and the gate must not fire twice for one user-visible cycle.
    const lift = { frames: 0 }
    const nLift = 5
    let s = fresh()
    // abandoned open/close (scenario B)
    lift.frames = nLift
    s = step(s, true, lift)
    for (let i = 0; i < 40; i++) s = step(s, false, lift)
    expect(s.showDomCalls).toBe(1)
    // a second, full open/close
    lift.frames = nLift
    for (let i = 0; i < 60; i++) s = step(s, true, lift)
    for (let i = 0; i < 60; i++) s = step(s, false, lift)
    // exactly two releases for two open/close cycles, view home.
    expect(s.showDomCalls).toBe(2)
    expect(s.presentedView).toBe('dom')
  })
})
