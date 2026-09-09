// Home flyer — the postcard's four corners while it is in the scene, handed
// from the hero's frame loop to the light shader so the card keeps casting
// a shadow after it leaves the page.
//
// The law: the shadow shader only knows page matter through masks, and a
// mask is a picture of the DOM. The lifted card is not DOM any more; it is
// a mesh with a pose. So the pose itself crosses over: four corners in
// viewport px with a height above the page, republished every frame.
//
// Fault: the holder dropped its raised relief when the card lifted, and
// nothing replaced it, so the card lost its shadow the moment it moved
// (Pete, 2026-09-05). Then the holder's relief and the scene's corners
// changed hands in two React commits, a frame apart, and every landing
// showed one frame with both shadows while the mask repainted for 140 ms
// (probe, 2026-09-05). Now nothing repaints at the handoff.
//
// Ownership: HomeHero.tsx writes; HomeMasthead.tsx reads each redraw and
// subscribes so a change reaches the shader even when its loop is idle.

/**
 * The card on the page is named by its element and measured every frame,
 * exactly as the masks are re-framed; in the scene it is four corners, x/y
 * in viewport px (y down) and z px above the page, with a lift from 0 on
 * its slot to 1 fully afloat. The card never enters the relief mask: it is
 * always drawn from here, so leaving and returning repaints nothing.
 */
export type HomeFlyer =
  | { readonly kind: 'page'; readonly element: HTMLElement }
  | { readonly kind: 'scene'; readonly corners: Float32Array; readonly lift: number }

let current: HomeFlyer | null = null
const listeners = new Set<() => void>()

export function setHomeFlyer(flyer: HomeFlyer | null) {
  current = flyer
  for (const listener of listeners) listener()
}

export function readHomeFlyer(): HomeFlyer | null {
  return current
}

export function subscribeHomeFlyer(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
