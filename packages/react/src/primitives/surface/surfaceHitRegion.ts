// The Surface hit region — which ray hits on a presented Surface count as
// pointer input.
//
// Declining HERE rather than inside the handlers is the whole point: an
// intersection r3f never sees is one it never counts as a hover, so the
// Surface behind keeps the pointer instead of being told it lost it. That
// is what makes a floating layer possible — its slab is full panel size
// and stands in front of the panel it belongs to, so with `'geometry'`
// the moment a popover opened the layer caught every ray, the panel
// behind went dead, and — hearing `pointerOut` — dismissed the very thing
// that had just opened.
//
// Ownership: SurfaceMesh installs the raycast and supplies its current
// state through the readers below. Every relay consumer asks through it:
// CanvasPointerGate, R3F delivery and the arrival move.

import * as THREE from 'three'
import { deepestElementAt, surfaceRadiusSd } from '@munari/core'
import type { SurfacePointerEvents } from './SurfaceMesh'
import { sceneMeshCovers } from './surfaceOcclusion'

/** The presenter state the hit region reads at each ray. */
export interface SurfaceHitRegionState {
  readonly hears: () => boolean
  readonly riding: () => boolean
  readonly authoredRaycast: () => THREE.Object3D['raycast'] | undefined
  readonly pointerEvents: () => SurfacePointerEvents
  readonly element: () => HTMLElement | null
  readonly radii: () => [number, number, number, number]
  readonly size: () => readonly [number, number]
}

export function surfaceHitRegion(state: SurfaceHitRegionState): THREE.Object3D['raycast'] {
  return function (this: THREE.Mesh, raycaster, intersects) {
    // Input follows the eye (crossingPointer, decisions.md #33). While
    // the canvas is not the presented side this mesh is not pointer
    // geometry: the gate never goes solid, so a lifting-phase click
    // reaches the page copy the viewer is actually looking at instead
    // of relaying to the parked one.
    if (!state.hears()) return
    // While the parked canvas rides over the renderer the browser owns
    // the pointer, and a hit here would relay a synthetic copy of an
    // event the DOM already received natively. Asked of the rig itself,
    // not of route state, so it cannot be a frame stale.
    if (state.riding()) return
    const cast = state.authoredRaycast() ?? THREE.Mesh.prototype.raycast
    const mode = state.pointerEvents()
    if (mode === 'none') return
    const el = state.element()
    if (mode === 'content' && !el) return
    const hits: THREE.Intersection[] = []
    cast.call(this, raycaster, hits)
    if (hits.length === 0) return
    const radii = state.radii()
    const rounded = radii.some((r) => r > 0)
    const rect = mode === 'content' && el ? el.getBoundingClientRect() : null
    for (const hit of hits) {
      if (rect && el) {
        if (!hit.uv) continue
        const x = rect.left + hit.uv.x * rect.width
        const y = rect.top + (1 - hit.uv.y) * rect.height
        if (!deepestElementAt(el, x, y)) continue
      } else if (rounded && hit.uv) {
        // A rounded surface's corners are not surface. The same SDF as
        // the material mask, on the RAW uv, so a ray and a fragment
        // agree about where the corner ends.
        const [width, height] = state.size()
        if (surfaceRadiusSd(hit.uv.x, hit.uv.y, width, height, radii) > 0) continue
      }
      if (sceneMeshCovers(this, raycaster, hit.distance)) continue
      intersects.push(hit)
    }
  }
}
