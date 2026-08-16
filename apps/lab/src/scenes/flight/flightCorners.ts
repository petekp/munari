// Flight plate geometry. `corners` writes into the THREE.Vector3 tuples
// owned by this scene.
import * as THREE from 'three'
import type { Plate } from './flightPhysicsLaw'

/**
 * The plate's four corners in world space — what the shadow needs, and the
 * honest way to ask "how far off the page is this thing" for a body that is
 * tilted. Written into `out`.
 */
export function corners(
  plate: Plate,
  w: number,
  h: number,
  out: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3],
) {
  const hw = w / 2
  const hh = h / 2
  const sx = [-hw, hw, hw, -hw]
  const sy = [hh, hh, -hh, -hh]
  for (let i = 0; i < 4; i++) {
    out[i].set(sx[i], sy[i], 0).applyQuaternion(plate.q).add(plate.p)
  }
  return out
}
