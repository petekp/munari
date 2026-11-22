// Hearing-gated raycast — a mesh that is a pointer target only while its
// canvas hears the pointer.
//
// Ownership: FrameSurface installs it on a mesh joined to a Surface; the
// Surface's store answers whether the canvas hears the pointer.

import * as THREE from 'three'

/**
 * A raycast that exists only while `hears()` answers true. Declining at the
 * raycast rather than in handlers means no raycaster — r3f's or a scene's
 * own — ever counts the mesh as a pointer target while the page copy is the
 * presented one.
 */
export function hearingGatedRaycast(
  hears: () => boolean,
): (this: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) => void {
  return function raycast(raycaster, intersects) {
    if (!hears()) return
    THREE.Mesh.prototype.raycast.call(this, raycaster, intersects)
  }
}
