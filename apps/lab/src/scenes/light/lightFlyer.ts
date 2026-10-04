// Flyer — the postcard's current page slot or complete bent draw frame.
// The Surface publishes before drawing so the light sees the same geometry.
//
// The law: the shadow shader only knows page content through masks, and a
// mask is a picture of the DOM. The lifted card is not DOM any more; it is
// a mesh with a pose. Its projected grid crosses over with a height above
// the page; four corners remain available for the planar lighting fallback.
//
// Fault: the holder dropped its raised relief when the card lifted, and
// nothing replaced it, so the card lost its shadow the moment it moved
// (Pete, 2026-09-05). Then the holder's relief and the scene's corners
// changed hands in two React commits, a frame apart, and every landing
// showed one frame with both shadows while the mask repainted for 140 ms
// (probe, 2026-09-05). Now nothing repaints at the handoff.
//
// Ownership: PostcardForm.tsx names the page slot; PostcardMesh.tsx writes the grid; LightLamp.tsx reads each redraw and
// subscribes so a change reaches the shader even when its loop is idle.

import type { PaperDrawFrame } from './lightPaperFrame'

/**
 * The card on the page is named by its element and measured every frame,
 * exactly as the masks are re-framed; in the scene it is a grid and its corners, x/y
 * in viewport px (y down) and z px above the page. The card never enters the
 * relief mask: leaving and returning repaints nothing.
 */
export type LightFlyer =
  | { readonly kind: 'page'; readonly element: HTMLElement }
  | { readonly kind: 'scene'; readonly corners: Float32Array; readonly paper: PaperDrawFrame }

export function createLightFlyerStore() {
  let current: LightFlyer | null = null
  const listeners = new Set<() => void>()
  return {
    read: () => current,
    set(flyer: LightFlyer | null) {
      current = flyer
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

export type LightFlyerStore = ReturnType<typeof createLightFlyerStore>
