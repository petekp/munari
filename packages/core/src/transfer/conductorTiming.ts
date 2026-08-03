// The two conductor-timing subtleties a refactor must not simplify away.
// `useAnimationConductor` seizes a CSS animation on `animationstart`,
// scrubs it by hand, and replays the sampled curve on a mesh — the
// scrubbing math itself is the sibling motionSamples module,
// this same layer. The hook ITSELF stays out of core: it closes over refs
// and a react-three-fiber `useFrame` callback, and CLAUDE.md bans React
// from the kernel. What belongs here is the pure law underneath its own
// timing and its own refs — the part a react binding must reuse exactly,
// never reinvent.

import type { MotionValue } from './motionSamples'

/**
 * useAnimationConductor.ts line 59. Never scrub to the exact end: a paused
 * Animation whose currentTime reaches its end enters the *finished* state,
 * and finishing dispatches `animationend` on the spot — a Web Animations
 * API rule, not a choice the hook makes. The last scrub sample would
 * otherwise announce, one frame in, that a 150ms exit was already over;
 * Radix's Presence unmounts on hearing that event, tearing exiting content
 * out 130ms early (measured: animationend at +17ms, mesh still flying to
 * +150ms).
 */
export const END_EPSILON_MS = 0.5

/**
 * Pure extraction of line 127's `Math.max(0, durationMs -
 * END_EPSILON_MS)`. Not exported by the hook — inlined in the closure
 * that builds `samples` — pulled out here because the kernel is where a
 * number this load-bearing gets to be tested on its own, independent of
 * the DOM plumbing that surrounds it in the hook.
 */
export function conductorScrubEnd(durationMs: number): number {
  return Math.max(0, durationMs - END_EPSILON_MS)
}

/** useAnimationConductor.ts line 41 — the identity pose a mesh wears when
 * nothing has ever flown. */
export const CONDUCTOR_REST: MotionValue = { opacity: 1, scale: 1, x: 0, y: 0 }

/**
 * Mirrors the two refs the hook closes over (lines 99-100). `flightActive`
 * stands in for `flightRef.current`'s truthiness — only whether a flight
 * is being driven matters here, never its contents — and `lastValue`
 * stands in for `lastValueRef.current`.
 */
export interface ConductorPoseState {
  flightActive: boolean
  lastValue: MotionValue
}

/**
 * One frame of an in-progress flight: the sample-and-remember half of the
 * `useFrame` callback (lines 181-182). Ticking only ever happens while a
 * flight is active — the callback returns early at line 177 otherwise —
 * so the result always carries `flightActive: true`.
 */
export function conductorTick(
  state: ConductorPoseState,
  sampledValue: MotionValue,
): ConductorPoseState {
  return { ...state, flightActive: true, lastValue: sampledValue }
}

/**
 * The `animationcancel` handler in full, guard included (lines 159-163).
 * `null` models the early return at line 160 — no flight, no call to
 * `apply`, no pose reported: whatever the caller last had simply stands,
 * untouched, by inaction. A non-null result is exactly `state.lastValue`,
 * unconditionally — never `CONDUCTOR_REST`, never either endpoint of
 * whatever curve was in flight. The comment directly above onCancel
 * (lines 154-158) names why: snapping to REST made a dismissed popover
 * flash back to fully opaque on its last visible frame, because REST *is*
 * opaque.
 */
export function conductorCancel(state: ConductorPoseState): MotionValue | null {
  if (!state.flightActive) return null
  return state.lastValue
}
