// Support — the one question a consumer asks before deciding which tree to
// render at all.
//
// The law: a Surface without the HTML-in-canvas trial keeps its DOM
// visible and never leaves `presentedView: 'dom'`. Nothing breaks. What
// does break is a scene that ARMS a gesture on that Surface, because the
// transition it armed can only be finished by a renderer that will never
// arrive, and no further input can leave that state.
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
// The split: `detectHtmlInCanvas()` in core stays the measurement and
// reports both trial entry points. This names the one that a Surface
// actually needs, and adds the render-safe reading of it.

import { useSyncExternalStore } from 'react'
import { detectHtmlInCanvas } from '@munari/core'

/**
 * Can a Surface hand its DOM to WebGL in this browser?
 *
 * Safe anywhere, including Node — it reads two prototypes and never
 * throws, so it answers `false` on a server rather than crashing.
 *
 * For events, effects and diagnostics. Branching a RENDER on this is a
 * hydration mismatch on any server-rendered page; use the hook.
 */
export function supportsDOMSurfaces(): boolean {
  return detectHtmlInCanvas().drawElementImage
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
 * A capability cannot change under a mounted page, so this never updates
 * more than once.
 */
export function useSupportsDOMSurfaces(): boolean {
  return useSyncExternalStore(subscribe, supportsDOMSurfaces, unsupported)
}
