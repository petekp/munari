// Surface deformation — bending a presented Surface so the hand and the
// eye agree.
//
// The law: a Surface may be deformed only by moving its geometry's
// vertices. three raycasts CPU geometry, so a vertex moved here is a
// vertex the pointer laws can find — the hit's interpolated uv rides the
// vertices and names the correct source pixel on any bend. A vertex
// shader bends only the pixels: the raycast keeps hitting the flat
// plane, and every relayed event lands off by exactly the displacement
// (measured 2026-08-20, instruments/fisheye-pointer: 60px at that
// scene's lens rim, more than one of its 44px rows). Before this
// helper, the correct pattern lived as a convention copied between two
// lab scenes; a consumer who reached for a shader instead got flat-pose
// hit testing with nothing anywhere saying so.
//
// Ownership: the caller owns the law — where each point of content
// stands, expressed in the content's own coordinates (px, origin
// top-left, y down, the DOM's convention). This helper owns the
// mechanism: the uv→content mapping (a plane's uv.y runs bottom→top,
// content runs top→down — the flip every bespoke copy had to know),
// the write into three's centered y-up local space, the upload flag,
// and the bounds reset (three caches boundingSphere on the first
// raycast and never invalidates it when positions change; a stale
// sphere rejects rays at a deformation's grown edges before uv routing
// even runs). It also stamps `DEFORMED_MARKER`: a scene reaches its
// geometry by a mesh ref, not always by a custom `geometry` prop
// (Slider.tsx deforms the default plane this way), so "was this
// geometry ever deformed" cannot be read off the prop — only off the
// geometry instance itself, which is what the pointer route law
// (`pointerRoute.ts`'s `planar` condition) needs to know a matrix3d can
// no longer express this Surface's pose.

import * as THREE from 'three'

/** Where a point of content stands, in content px. `z` defaults to 0. */
export interface SurfaceDeformPoint {
  x: number
  y: number
  z?: number
}

/** `geometry.userData` key stamped `true` by every `deformSurfaceGeometry`
 *  call, regardless of how the caller reached the geometry. */
export const DEFORMED_MARKER = 'munariDeformed'

/**
 * Move a Surface geometry's vertices to `place`'s answer, per frame.
 *
 * `place` receives each vertex's content position (px, origin top-left,
 * y down) and its index, and returns where that content point stands in
 * the same coordinates. Call it from a frame loop with the current
 * deformation; an identity `place` restores the flat plane. The
 * geometry must carry plain (non-interleaved) `position` and `uv`
 * attributes — every geometry a Surface presents does.
 */
export function deformSurfaceGeometry(
  geometry: THREE.BufferGeometry,
  size: readonly [number, number],
  place: (x: number, y: number, index: number) => SurfaceDeformPoint,
): void {
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  if (!(position instanceof THREE.BufferAttribute) || !(uv instanceof THREE.BufferAttribute)) {
    throw new Error(
      'deformSurfaceGeometry needs plain position and uv attributes — ' +
        'an interleaved or missing attribute cannot be deformed in place',
    )
  }
  const [w, h] = size
  for (let i = 0; i < position.count; i++) {
    const p = place(uv.getX(i) * w, (1 - uv.getY(i)) * h, i)
    position.setXYZ(i, p.x - w / 2, h / 2 - p.y, p.z ?? 0)
  }
  position.needsUpdate = true
  geometry.boundingSphere = null
  geometry.userData[DEFORMED_MARKER] = true
}
