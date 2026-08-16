// The calibration, and the one place that is allowed to know it.
//
// The premise: one world unit is one CSS pixel, which is true on
// EXACTLY ONE PLANE: z = 0. Every other plane is magnified by
// perspective, and forgetting that is how a drag stops tracking the
// hand. Vector parameters are structural so THREE.Vector3 passes
// through unchanged (decisions.md #4).

import type { Vec3Like, Vec3Readonly } from '../math/vec3'

/**
 * How far back the camera has to sit for the plane z = 0 to be the
 * viewport, pixel for pixel. Half the viewport height subtends half
 * the vertical fov.
 */
export function cameraDistance(viewportHeight: number, fovDeg: number): number {
  return viewportHeight / 2 / Math.tan((fovDeg * Math.PI) / 360)
}

/**
 * How much bigger something on the plane `z` appears than the same
 * thing on z = 0. Similar triangles from the eye: 1 at z = 0, > 1
 * nearer, < 1 further.
 */
export function planeScale(camZ: number, z: number): number {
  return camZ / (camZ - z)
}

/**
 * Backing texels per CSS px that make a plane at z texel-for-pixel
 * with the display: exactly dpr × planeScale — no more (wasted
 * upload), no less (soup). "Born at the display's density" is this
 * identity at z = 0. A consumer can evaluate the same identity at any
 * target plane.
 */
export function texelDemand(dpr: number, camZ: number, z: number): number {
  return dpr * planeScale(camZ, z)
}

/**
 * The world point on the plane `z` that the cursor is pointing AT —
 * i.e. the point whose projection lands exactly under the cursor.
 *
 * This is "intersect the ray with the drag plane, never take the hit
 * point" in its cheapest possible form. Because the
 * camera is calibrated and looking down −z, the ray intersection is a
 * single division: a client offset from the screen centre is a z = 0
 * world offset by construction, and on any other plane it shrinks by
 * the same similar-triangle ratio that makes things on that plane
 * look bigger.
 *
 * Using the z = 0 mapping for an object on another plane creates a gain
 * error, not an offset. The object then moves faster or slower than the
 * pointer, and the error grows with distance from the screen center.
 */
export function screenToPlane<V extends Vec3Like>(
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number,
  camZ: number,
  z: number,
  out: V,
): V {
  const k = 1 / planeScale(camZ, z)
  out.set(
    (clientX - viewportWidth / 2) * k,
    (viewportHeight / 2 - clientY) * k,
    z,
  )
  return out
}

/**
 * Move a world point onto the plane `z` along its own line of sight:
 * the carried point projects to exactly the same screen position as
 * the original. Similar triangles once more — world x/y scale by the
 * ratio of the two magnifications.
 *
 * This lets a consumer move an anchor to a new depth without changing its
 * screen position. It is useful when a texture is prepared for one plane
 * but its anchor was captured on another; leaving the anchor on the wrong
 * plane would keep the texture minified or magnified.
 */
export function carryToPlane<V extends Vec3Like>(p: V, camZ: number, z: number): V {
  const k = planeScale(camZ, p.z) / planeScale(camZ, z)
  p.x *= k
  p.y *= k
  p.z = z
  return p
}

/**
 * Where a world point lands on screen, in client px. The inverse of
 * `screenToPlane`, and only used to prove that it is one.
 */
/** A position on the screen, in client px — the units `getBoundingClientRect`
 *  and pointer events already speak. */
export interface ScreenPoint {
  x: number
  y: number
}

export function planeToScreen(
  p: Vec3Readonly,
  viewportWidth: number,
  viewportHeight: number,
  camZ: number,
): ScreenPoint {
  const s = planeScale(camZ, p.z)
  return {
    x: viewportWidth / 2 + p.x * s,
    y: viewportHeight / 2 - p.y * s,
  }
}
