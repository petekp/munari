// Support — the one question a consumer asks before deciding which tree to
// render at all.
//
// Without a capture engine that can run here, a declared page presentation
// stays visible. A scene can still arm a gesture that the canvas cannot
// finish, because the transition it armed can only be finished by a renderer
// that will never arrive, and no further input can leave that state.
//
// The fault, 2026-08-23: three lab scenes each hit that in a different
// shape — the knobs panel's carry and resize had no consumer, genie's
// minimize waited on `air[id]`, flight's drag waited on `flight.current`.
// All three had a correct capability answer available to them already, on
// `useSurfaceState(handle).supported`, seeded at store creation. All three
// reached past it and wrote `useMemo(() => detectHtmlInCanvas()
// .drawElementImage, [])` instead, because the branch is decided ABOVE the
// Surface and reading it through a handle's state did not look like where
// that answer lived. Three scenes, three misses.
//
// The split: `detectHtmlInCanvas()` in core stays the raw platform
// measurement and reports both trial entry points. This asks the INSTALLED
// CAPTURE ENGINE, which is the question a Surface actually has — a browser
// with no trial and snapDOM installed answers `false` to the probe and
// `true` here, and the Surface works.

import { useSyncExternalStore } from 'react'
import { captureAvailable } from '@munari/core'

/**
 * Can a Surface hand its DOM to WebGL in this browser?
 *
 * Safe anywhere, including Node — every engine's `available()` answers
 * `false` rather than throwing when there is no DOM at all.
 *
 * For events, effects and diagnostics. Branching a RENDER on this is a
 * hydration mismatch on any server-rendered page; use the hook.
 */
export function supportsSurfaces(): boolean {
  return captureAvailable()
}

// The server and the first client render must agree, and the server's
// answer is always `false`. `useSyncExternalStore` is what buys that: React
// takes `getServerSnapshot` for both, then re-renders with the real
// snapshot once mounted. A `useMemo` or a plain call in the render body
// would answer `true` on the client's first pass and tear the hydration.
const subscribe = () => () => {}
const unsupported = () => false

/**
 * The render-safe reading: `false` on the server and through hydration,
 * then the real answer.
 *
 * A capability cannot change under a mounted page — an engine installed
 * after a Surface mounts does not reach it (`setCaptureEngine`) — so this
 * never updates more than once.
 */
export function useSurfaceSupport(): boolean {
  return useSyncExternalStore(subscribe, supportsSurfaces, unsupported)
}
