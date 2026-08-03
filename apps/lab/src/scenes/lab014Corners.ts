// Scene-local twin of the kernel's plate geometry: `corners` writes into
// THREE.Vector3 tuples, and the kernel is zero-dep and shape-typed
// (decisions.md #4), so the helper lives with the consumer that owns the
// THREE objects. Verbatim from three-ui@362c5a1 app/scenes/lab014Plate.ts.
import * as THREE from 'three'
import type { Plate } from 'anamorph'

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
