// The still-handed-release guard for use1DOF, pinned.
//
// The bug: onPointerMove is the only writer of `b.v` while a drag is
// active, useFrame skips the integrator during a drag, and endDrag never
// cleared `b.v` — so a hand held still after its last move left the smoothed
// velocity frozen at a stale estimate, and release handed that estimate to
// the field as a synthesized fling. A drag that paused then released
// ratcheted the body across wells (each crossing firing onDetent) and the
// consumer readout ticked live to the wrong, settled value.
//
// The guard is a pure decision — releaseVelocity — gated on the gap since
// the last pointermove, plus the threshold (STILL_RELEASE_S). Both are the
// real exports and are exercised directly below. The drag/release lifecycle
// is traced against the REAL @munari/core integrator and the REAL Dial
// field (detentField(8,50)+damping(6), Dial.tsx:52-55) so the post-release
// settle is the field's actual verdict, not a closed-form estimate.
// @react-three/fiber's useFrame/useThree can't be mounted in the node runner
// (no WebGL, and tests/boundary.test.ts forbids module mocks), so the
// per-event/per-frame glue is copied from use1DOF.ts with line cites;
// releaseVelocity, wrapAngle, STILL_RELEASE_S, step and the field are the
// real exports, not copies. The frozen-velocity value pinned below
// (-36.26875) is the bug report's measured evidence, which anchors the
// copied arithmetic to the real handler.

import { describe, expect, it } from 'vitest'
import { MathUtils } from 'three'
import { composeFields, damping, detentField, step, type Body1D } from '@munari/core'
import { STILL_RELEASE_S, releaseVelocity, wrapAngle } from './use1DOF'

// use1DOF.ts:113 — the lerp smoothing factor on gesture velocity.
const VEL_LERP = 0.35

// Dial.tsx:42,52-55 — the dial's default feel.
const STEP = (Math.PI * 2) / 8
const field = composeFields(detentField(8, 50), damping(6))
// Dial.tsx:49-50 — the dial's index-from-q readout.
const indexOf = (q: number) => ((Math.round(-q / STEP) % 8) + 8) % 8

// Trace use1DOF's drag/release lifecycle for a flick-then-(maybe)-hold
// gesture, returning the release-time state and the post-release settle.
// `guard` toggles the fix: with false, endDrag leaves `b.v` frozen (the
// bug); with true, it applies releaseVelocity (the fix).
interface DragState {
  active: boolean
  offset: number
  lastT: number
}
interface GestureResult {
  qAtRelease: number
  vBeforeRelease: number
  vAtRelease: number
  idxAtEndOfMoves: number
  idxAtRelease: number
  finalIdx: number
  crossings: number
  detentChanges: number[]
  atRest: boolean
}
function gesture(opts: {
  moveRadPerS: number
  moves: number
  moveDtMs: number
  holdMs: number
  guard: boolean
  postFrames: number
}): GestureResult {
  const b: Body1D = { q: 0, v: 0 }
  const d: DragState = { active: false, offset: 0, lastT: 0 }
  let t = 0
  // onPointerDown (use1DOF.ts:84-100): couple the body to the hand at q=0.
  d.active = true
  d.offset = wrapAngle(b.q - 0)
  d.lastT = t
  b.v = 0
  // onPointerMove (use1DOF.ts:102-116): lerp `b.v` toward the instantaneous
  // velocity, advance `b.q` to the hand, refresh d.lastT.
  for (let i = 0; i < opts.moves; i++) {
    t += opts.moveDtMs
    const raw = -((t / 1000) * opts.moveRadPerS)
    const delta = wrapAngle(raw + d.offset - b.q)
    const dt = Math.max((t - d.lastT) / 1000, 1e-4)
    b.v = MathUtils.lerp(b.v, delta / dt, VEL_LERP)
    b.q += delta
    d.lastT = t
  }
  const idxAtEndOfMoves = indexOf(b.q)
  // useFrame (use1DOF.ts:143-146): while d.active it skips step(), so the
  // hold bleeds no energy and `b.v` stays frozen at its last move value.
  const releaseT = t + opts.holdMs
  const vBeforeRelease = b.v
  // endDrag (use1DOF.ts:124-135): hand the body to the field.
  d.active = false
  if (opts.guard) {
    b.v = releaseVelocity(b.v, (releaseT - d.lastT) / 1000, STILL_RELEASE_S)
  }
  const vAtRelease = b.v
  const qAtRelease = b.q
  const idxAtRelease = indexOf(b.q)
  // useFrame post-release: step the real field. 1/60 lies inside the real
  // hook's Math.min(delta, 1/30) clamp (use1DOF.ts:146), so this is identical
  // to a 60Hz display. Dial's onFrame fires onDetent on each index change
  // (Dial.tsx:65-77); the readout consumer (Workspace.tsx:255-257) writes
  // the value text on each of these.
  const detentChanges: number[] = []
  let lastIdx = idxAtRelease
  for (let i = 0; i < opts.postFrames; i++) {
    step(b, field, 1 / 60, 2)
    const idx = indexOf(b.q)
    if (idx !== lastIdx) {
      detentChanges.push(idx)
      lastIdx = idx
    }
  }
  return {
    qAtRelease,
    vBeforeRelease,
    vAtRelease,
    idxAtEndOfMoves,
    idxAtRelease,
    finalIdx: indexOf(b.q),
    crossings: detentChanges.length,
    detentChanges,
    atRest: Math.abs(b.v) < 1e-3,
  }
}

describe('releaseVelocity (the still-handed-release decision)', () => {
  it('pins the threshold at 0.1s — the contract a retune must change', () => {
    expect(STILL_RELEASE_S).toBe(0.1)
  })

  it('a release older than the threshold carries no momentum', () => {
    expect(releaseVelocity(36.27, 0.5, STILL_RELEASE_S)).toBe(0)
    expect(releaseVelocity(36.27, 0.101, STILL_RELEASE_S)).toBe(0)
    expect(releaseVelocity(1, 10, STILL_RELEASE_S)).toBe(0)
  })

  it('a release within the threshold keeps its tracked velocity', () => {
    expect(releaseVelocity(36.27, 0, STILL_RELEASE_S)).toBe(36.27)
    expect(releaseVelocity(36.27, 0.099, STILL_RELEASE_S)).toBe(36.27)
    expect(releaseVelocity(36.27, 0.016, STILL_RELEASE_S)).toBe(36.27)
  })

  it('the threshold is a strict greater-than: a gap of exactly stillS flings', () => {
    expect(releaseVelocity(36.27, STILL_RELEASE_S, STILL_RELEASE_S)).toBe(36.27)
    expect(releaseVelocity(36.27, STILL_RELEASE_S + 1e-3, STILL_RELEASE_S)).toBe(0)
  })

  it('preserves a reverse flick and zeroes it past the gate', () => {
    expect(releaseVelocity(-50, 0.05, STILL_RELEASE_S)).toBe(-50)
    expect(releaseVelocity(-50, 0.2, STILL_RELEASE_S)).toBe(0)
  })

  it('a zero velocity is unchanged on either branch', () => {
    expect(releaseVelocity(0, 0.5, STILL_RELEASE_S)).toBe(0)
    expect(releaseVelocity(0, 0, STILL_RELEASE_S)).toBe(0)
  })

  it('a negative gap (clock skew / coalesced events) keeps the velocity', () => {
    expect(releaseVelocity(40, -1, STILL_RELEASE_S)).toBe(40)
  })
})

describe('end-to-end settle against the real Dial field', () => {
  // The bug report's evidence gesture: down → 3 moves at 50 rad/s →
  // release. The frozen estimate (vBeforeRelease) is the report's measured
  // -36.26875; pinning it anchors the copied handler arithmetic to the real
  // handler.
  const flick = {
    moveRadPerS: 50,
    moves: 3,
    moveDtMs: 10,
    postFrames: 300,
  }

  it('the harness reproduces the reported frozen-velocity estimate', () => {
    const r = gesture({ ...flick, holdMs: 0, guard: false })
    expect(r.vBeforeRelease).toBe(-36.26875)
    expect(r.qAtRelease).toBe(-1.5)
    expect(r.idxAtEndOfMoves).toBe(2)
  })

  it('without the guard, a still-handed release flings across wells (the bug)', () => {
    const r = gesture({ ...flick, holdMs: 1000, guard: false })
    // The hold froze `b.v` at the stale estimate (useFrame skipped step).
    expect(r.vAtRelease).toBe(r.vBeforeRelease)
    expect(r.vAtRelease).not.toBe(0)
    // The fling ratchets the body across wells and lands on a wrong detent.
    expect(r.crossings).toBeGreaterThan(0)
    expect(r.idxAtRelease).not.toBe(r.finalIdx)
    // The consumer readout ticked live and stays on the wrong, settled value.
    expect(r.detentChanges[r.detentChanges.length - 1]).toBe(r.finalIdx)
  })

  it('with the guard, a still-handed release settles where it was released', () => {
    const r = gesture({ ...flick, holdMs: 1000, guard: true })
    expect(r.vAtRelease).toBe(0)
    expect(r.crossings).toBe(0)
    expect(r.idxAtRelease).toBe(r.finalIdx)
    expect(r.atRest).toBe(true)
    // The consumer readout never ticks post-release — it stays at the value
    // the hand released at.
    expect(r.detentChanges).toEqual([])
  })

  it('a genuine flick (no hold) still flings — "flicks are real momentum"', () => {
    const r = gesture({ ...flick, holdMs: 0, guard: true })
    expect(r.vAtRelease).toBe(r.vBeforeRelease)
    expect(r.vAtRelease).not.toBe(0)
    expect(r.crossings).toBeGreaterThan(0)
  })

  it('a pause shorter than the threshold still flings', () => {
    const r = gesture({ ...flick, holdMs: 50, guard: true })
    expect(r.vAtRelease).toBe(r.vBeforeRelease)
    expect(r.crossings).toBeGreaterThan(0)
  })

  it('a pause of exactly the threshold still flings (strict greater-than)', () => {
    const r = gesture({ ...flick, holdMs: STILL_RELEASE_S * 1000, guard: true })
    expect(r.vAtRelease).toBe(r.vBeforeRelease)
    expect(r.crossings).toBeGreaterThan(0)
  })

  it('a pause just past the threshold settles exactly as a still hand does', () => {
    const r = gesture({ ...flick, holdMs: STILL_RELEASE_S * 1000 + 1, guard: true })
    expect(r.vAtRelease).toBe(0)
    expect(r.crossings).toBe(0)
    expect(r.idxAtRelease).toBe(r.finalIdx)
  })

  it('a weaker flick that pauses still settles rather than crawling to a neighbor', () => {
    // Below the wrong-detent threshold but with a real stale estimate: a
    // smaller flick still leaves `b.v` nonzero, and the guard must zero it.
    const r = gesture({ moveRadPerS: 8, moves: 3, moveDtMs: 10, holdMs: 1000, guard: true, postFrames: 300 })
    expect(r.vBeforeRelease).not.toBe(0)
    expect(r.vAtRelease).toBe(0)
    expect(r.crossings).toBe(0)
    expect(r.idxAtRelease).toBe(r.finalIdx)
  })

  it('a down with no move, held then released, settles with no fling', () => {
    // pointerdown set b.v = 0 (use1DOF.ts:99); a still hand at release keeps
    // zero — the guard must not introduce motion where there was none.
    const r = gesture({ moveRadPerS: 0, moves: 0, moveDtMs: 10, holdMs: 1000, guard: true, postFrames: 60 })
    expect(r.vAtRelease).toBe(0)
    expect(r.crossings).toBe(0)
    expect(r.idxAtRelease).toBe(r.finalIdx)
  })
})
