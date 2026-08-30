// Marble-hand support — the outer vertices that keep stone above paper.
//
// The law: a linear transform reaches its lowest point on the convex hull.
// The 2026-08-30 orientation panel allows complete turns, so a fixed lift
// can put the wrist through the page even though the default pose clears it.
// Build the hull once; test its support points as the pose changes.
//
// Ownership: the asset supplies anatomy. This module supplies the exact
// support height; the scene keeps the fingertip on its screen coordinate.

import { Vector3, type BufferGeometry, type Matrix4 } from 'three'
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js'

export function buildMarbleHandSupport(geometry: BufferGeometry): readonly Vector3[] {
  const positions = geometry.getAttribute('position')
  const points: Vector3[] = []
  const seen = new Set<string>()
  for (let index = 0; index < positions.count; index++) {
    const point = new Vector3().fromBufferAttribute(positions, index)
    const key = `${point.x},${point.y},${point.z}`
    if (seen.has(key)) continue
    seen.add(key)
    points.push(point)
  }
  const hull = new ConvexHull().setFromPoints(points)
  const support = new Set<Vector3>()
  for (const face of hull.faces) {
    let edge = face.edge
    do {
      support.add(edge.head().point)
      edge = edge.next
    } while (edge !== face.edge)
  }
  if (support.size === 0) throw new Error('The marble hand has no three-dimensional support hull.')
  return [...support]
}

export function minimumMarbleHandZ(support: readonly Vector3[], transform: Matrix4): number {
  const elements = transform.elements
  let minimum = Infinity
  for (const point of support) {
    minimum = Math.min(minimum,
      elements[2] * point.x + elements[6] * point.y + elements[10] * point.z + elements[14])
  }
  return minimum
}

export function marbleHandSafeHeight(
  support: readonly Vector3[],
  transform: Matrix4,
  requested: number,
): number {
  // One CSS pixel separates the two surfaces at arbitrary panel angles.
  // The reviewed defaults already clear this floor, so the guard leaves
  // their requested hover and press heights unchanged.
  return Math.max(requested, 1 - minimumMarbleHandZ(support, transform))
}
