// CONFORMANCE — transfer (flipped 2026-08-02)
// New contract (owed by seed manifest): the two load-bearing conductor timing subtleties (archive#17)
//
// useAnimationConductor seizes a CSS animation on `animationstart`, scrubs
// it by hand, and replays the sampled curve on a mesh — the scrubbing math
// itself is the ported motionSamples contract, this same layer (archive#17).
// This file is the seed manifest's other half: two behaviors that live in
// how the hook drives its OWN timing and its OWN refs, not in the curve
// math, that the oracle's decisions.md #17 names explicitly as things a
// refactor must not simplify away.
//
// (a) Never scrub to the exact end (useAnimationConductor.ts line 59 defines
// `END_EPSILON_MS = 0.5`; line 127 spends it: `Math.max(0, durationMs -
// END_EPSILON_MS)`). A paused Animation whose currentTime reaches its end
// enters the *finished* state, and finishing dispatches `animationend` on
// the spot — a Web Animations API rule, not a choice the hook makes. The
// last scrub sample would otherwise announce, one frame in, that a 150ms
// exit was already over; Radix's Presence unmounts on hearing that event,
// tearing exiting content out 130ms early (measured: animationend at
// +17ms, mesh still flying to +150ms).
//
// (b) cancel-holds-last-pose — the `animationcancel` handler, lines
// 159-163. Two things are load-bearing. First, the handler is GUARDED:
// with no flight in progress (`flightRef.current` already null) it
// returns before calling `apply` at all — nothing is resolved or
// reported, whatever the caller last had simply stands, untouched, by
// inaction. Second, when a flight WAS in progress, it replays
// `lastValueRef.current` exactly — never `REST` (line 41's identity pose)
// and never either endpoint of the curve. That ref is seeded to REST at
// line 100 and written in exactly one other place, the per-frame flight
// loop (lines 175-183): every tick samples the curve at the flight's
// current progress (line 181) and stores it (line 182) before handing it
// to `apply`. "Hold the last pose" means precisely that: whatever the
// most recent frame happened to sample. The comment directly above
// onCancel (lines 154-158) names why: snapping to REST made a dismissed
// popover flash back to fully opaque on its last visible frame, because
// REST *is* opaque.
import { describe, expect, it } from 'vitest'
import {
  CONDUCTOR_REST,
  END_EPSILON_MS,
  conductorCancel,
  conductorScrubEnd,
  conductorTick,
  type ConductorPoseState,
  type MotionValue,
} from '@anamorph/core'

describe('END_EPSILON_MS / conductorScrubEnd', () => {
  it('pins END_EPSILON_MS to the value the oracle measured', () => {
    expect(END_EPSILON_MS).toBe(0.5)
  })

  it('scrubs a 300ms flight to 299.5, never to the exact duration', () => {
    expect(conductorScrubEnd(300)).toBe(299.5)
  })

  it('clamps at 0 rather than going negative for a flight shorter than the epsilon', () => {
    expect(conductorScrubEnd(0.2)).toBe(0)
  })

  it('is always strictly less than a positive duration, so scrubbing can never reach the finished state', () => {
    // A spread of real and boundary durations: sub-frame, one frame at
    // 60Hz, the archive's measured 149ms popover, the hook's own-comment
    // 150ms exit, the 300ms above, and both sides of END_EPSILON_MS itself.
    for (const durationMs of [0.5001, 0.6, 1, 16.67, 50, 149, 150, 299.5, 300, 1000, 5000]) {
      expect(conductorScrubEnd(durationMs)).toBeLessThan(durationMs)
    }
  })
})

describe('cancel-holds-last-pose', () => {
  it('a cancel with no flight in progress is a no-op, not a resolve to REST', () => {
    const state: ConductorPoseState = { flightActive: false, lastValue: CONDUCTOR_REST }
    expect(conductorCancel(state)).toBeNull()
  })

  it('a cancel mid-flight holds the last ticked sample — not REST, not either endpoint', () => {
    const midFlight: MotionValue = { opacity: 0.837099, scale: 0.988364, x: 0, y: 2.79259 }
    const state = conductorTick({ flightActive: false, lastValue: CONDUCTOR_REST }, midFlight)
    const held = conductorCancel(state)
    expect(held).toEqual(midFlight)
    expect(held).not.toEqual(CONDUCTOR_REST)
  })

  it('later ticks overwrite earlier ones — cancel always holds the most recent sample', () => {
    let state: ConductorPoseState = { flightActive: false, lastValue: CONDUCTOR_REST }
    state = conductorTick(state, { opacity: 0.3, scale: 0.95, x: 0, y: 12 })
    state = conductorTick(state, { opacity: 0.837099, scale: 0.988364, x: 0, y: 2.79259 })
    state = conductorTick(state, { opacity: 0.962256, scale: 0.997304, x: 0, y: 0.647046 })
    expect(conductorCancel(state)).toEqual({ opacity: 0.962256, scale: 0.997304, x: 0, y: 0.647046 })
  })

  it('reading the cancelled pose twice reports the same value — a resolve, not a consuming read', () => {
    const state = conductorTick(
      { flightActive: false, lastValue: CONDUCTOR_REST },
      { opacity: 0.5, scale: 0.96, x: 0, y: 6 },
    )
    expect(conductorCancel(state)).toEqual(conductorCancel(state))
  })
})
