// The corner mask in TSL — the shader half of the corner SDF. The JS half,
// `surfaceRadiusSd` and the radii it enforces, lives in @munari/core, which
// stays renderer-free. The two are twins by contract: the conformance suite
// pins the JS SDF, and this node must compute the same distance so a ray and
// a fragment agree about where a corner ends.

import type { Node } from 'three/webgpu'
import { float, smoothstep, vec2 } from 'three/tsl'

/**
 * Signed distance in source CSS px from `coordinates` to the rounded
 * rectangle's edge, negative inside. `radii` is (top-left, top-right,
 * bottom-right, bottom-left) in CSS px; `size` is the source's CSS size.
 */
export function surfaceRadiusDistance(
  coordinates: Node<'vec2'>,
  size: Node<'vec2'>,
  radii: Node<'vec4'>,
): Node<'float'> {
  // +y is the content's top, because the capture uploads with flipY.
  const point = coordinates.sub(0.5).mul(size)
  const left = point.y.greaterThan(0).select(radii.x, radii.w)
  const right = point.y.greaterThan(0).select(radii.y, radii.z)
  const radius = point.x.lessThan(0).select(left, right)
  const distance = point.abs().sub(size.mul(0.5)).add(vec2(radius))
  return distance.x.max(distance.y).min(0).add(distance.max(0).length()).sub(radius)
}

/**
 * Corner coverage for a Surface: 1 inside, 0 outside, with one fragment of
 * antialiased edge. Analytic, so a corner stays crisp at every capture
 * density; the capture's own corner texels hold page background.
 *
 * Read it with the unmirrored mesh UV. Multiply only alpha for straight-alpha
 * output, and the whole vec4 for premultiplied output.
 */
export function surfaceRadiusMask(
  coordinates: Node<'vec2'>,
  size: Node<'vec2'>,
  radii: Node<'vec4'>,
): Node<'float'> {
  const distance = surfaceRadiusDistance(coordinates, size, radii)
  const edge = distance.fwidth().max(1e-4)
  return float(1).sub(smoothstep(edge.negate(), edge, distance))
}
