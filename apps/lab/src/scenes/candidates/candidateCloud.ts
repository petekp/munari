// The grain buffer — one captured element, rebuilt as loose quads.
//
// A cloud of billboarded quads rather than `THREE.Points`, for a reason
// that is about this library and not about taste: `Surface.Mesh` presents
// a Surface as a mesh, and there is no seam for presenting one as a point
// cloud. Quads cost four vertices where a point costs one, and they buy
// back the two things points would have cost — `gl_PointSize` is capped by
// the driver (63px on some Intel parts), and a point sprite cannot be
// rotated. Neither limit is one a scene should have to discover.
//
// Ownership: this module owns the buffer's layout. It has no opinion about
// how the grains move; that is the shader's, and the seeds here are the
// only randomness in the whole effect.

import * as THREE from 'three'

/** The corner offsets of one grain, in units of grain size. */
const CORNERS: readonly (readonly [number, number])[] = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
]

export interface CloudSpec {
  /** The captured element's size, CSS px. */
  width: number
  height: number
  /** Grains across and down. Their product is the draw's whole cost. */
  cols: number
  rows: number
}

/**
 * A grid of grains covering the capture, each carrying the uv it samples.
 *
 * Positions are the grain's HOME — where the DOM put it — in the mesh's own
 * pixel coordinates. Everything the flight does is expressed as a departure
 * from home, so a cloud at rest is bit-identical to the element it came
 * from and the landing needs no separate reassembly step.
 */
export function buildCloud({ width, height, cols, rows }: CloudSpec): THREE.BufferGeometry {
  const cells = cols * rows
  const position = new Float32Array(cells * 4 * 3)
  const corner = new Float32Array(cells * 4 * 2)
  const uv = new Float32Array(cells * 4 * 2)
  const seed = new Float32Array(cells * 4 * 3)
  const index = new Uint32Array(cells * 6)

  let v = 0
  let f = 0
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u = (i + 0.5) / cols
      const w = (j + 0.5) / rows
      const x = (u - 0.5) * width
      const y = (0.5 - w) * height
      // One seed per grain, copied to its four corners: a seed that varied
      // across a quad would tear it into a triangle pair going two ways.
      const s0 = Math.random()
      const s1 = Math.random()
      const s2 = Math.random()
      const base = v
      for (const [cx, cy] of CORNERS) {
        position[v * 3] = x
        position[v * 3 + 1] = y
        position[v * 3 + 2] = 0
        corner[v * 2] = cx
        corner[v * 2 + 1] = cy
        // The texture is flipped relative to content coordinates, which is
        // why this is 1 − w and the position above is 0.5 − w.
        uv[v * 2] = u
        uv[v * 2 + 1] = 1 - w
        seed[v * 3] = s0
        seed[v * 3 + 1] = s1
        seed[v * 3 + 2] = s2
        v++
      }
      index[f++] = base
      index[f++] = base + 1
      index[f++] = base + 2
      index[f++] = base
      index[f++] = base + 2
      index[f++] = base + 3
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geometry.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2))
  geometry.setAttribute('aUv', new THREE.BufferAttribute(uv, 2))
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3))
  geometry.setIndex(new THREE.BufferAttribute(index, 1))
  // The grains leave the element's box by design, so a bounding sphere
  // fitted to the box would cull the cloud exactly when it is interesting.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4000)
  return geometry
}

/** Grain size, in px, for a cloud that tiles its capture exactly at rest. */
export function grainSize({ width, height, cols, rows }: CloudSpec): number {
  return Math.max(width / cols, height / rows)
}
