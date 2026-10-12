// UV sampling — where a texture coordinate lands on the geometry carrying
// that texture.
//
// The law: an anchor names a box in the SOURCE, and an object placed on it
// stands wherever the geometry put those texels. On a flat plane that is a
// linear remap and nobody needs this module. On a deformed sheet the same
// UV is somewhere the plane math cannot name, and an object placed by the
// plane math floats off the sheet it is supposed to be resting on.
//
// The fault, 2026-08-17: anchors were placed by treating the UV square as
// the mesh's local box. Correct for the default unit plane and wrong for
// every geometry that bends, in a way that reads as a physics bug — the
// controls slide across a panel as it deforms, then settle back into place
// when it flattens.
//
// Arrays in, plain numbers out: the kernel has no renderer types, and a
// triangle is three positions and three texture coordinates whoever
// allocated them.

export interface UvSample {
  /** Interpolated position, in the geometry's own coordinates. */
  readonly x: number
  readonly y: number
  readonly z: number
  /** The containing triangle's face normal, unit length. */
  readonly nx: number
  readonly ny: number
  readonly nz: number
  /** False when no triangle contained the point and the nearest was used. */
  readonly inside: boolean
}

// A short array means a malformed geometry, not a hole to propagate: zero
// keeps the barycentric math finite so the caller still gets a triangle.
const at = (source: ArrayLike<number>, i: number): number => source[i] ?? 0

interface TriangleWeights {
  a: number
  b: number
  c: number
  ka: number
  kb: number
  kc: number
  inside: boolean
}

function closestUvWeights(au: number, av: number, bu: number, bv: number, cu: number, cv: number, u: number, v: number) {
  let best = { ka: 0, kb: 0, kc: 0, distance: Number.POSITIVE_INFINITY }
  for (let edge = 0; edge < 3; edge++) {
    const startU = edge === 0 ? au : edge === 1 ? bu : cu
    const startV = edge === 0 ? av : edge === 1 ? bv : cv
    const endU = edge === 0 ? bu : edge === 1 ? cu : au
    const endV = edge === 0 ? bv : edge === 1 ? cv : av
    const du = endU - startU
    const dv = endV - startV
    const along = Math.max(0, Math.min(1, ((u - startU) * du + (v - startV) * dv) / (du * du + dv * dv)))
    const distance = (u - startU - along * du) ** 2 + (v - startV - along * dv) ** 2
    if (distance >= best.distance) continue
    best = {
      ka: edge === 0 ? 1 - along : edge === 2 ? along : 0,
      kb: edge === 1 ? 1 - along : edge === 0 ? along : 0,
      kc: edge === 2 ? 1 - along : edge === 1 ? along : 0,
      distance,
    }
  }
  return best
}

function findTriangleWeights(
  uv: ArrayLike<number>,
  index: ArrayLike<number> | null,
  u: number,
  v: number,
  nearest: boolean,
): TriangleWeights | null {
  const triangles = Math.floor((index ? index.length : uv.length / 2) / 3)
  let best: TriangleWeights | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (let t = 0; t < triangles; t++) {
    const a = index ? index[t * 3] : t * 3
    const b = index ? index[t * 3 + 1] : t * 3 + 1
    const c = index ? index[t * 3 + 2] : t * 3 + 2
    if (a === undefined || b === undefined || c === undefined) continue
    const au = at(uv, a * 2)
    const av = at(uv, a * 2 + 1)
    const bu = at(uv, b * 2)
    const bv = at(uv, b * 2 + 1)
    const cu = at(uv, c * 2)
    const cv = at(uv, c * 2 + 1)
    const area = (bv - cv) * (au - cu) + (cu - bu) * (av - cv)
    if (area === 0) continue
    const ka = ((bv - cv) * (u - cu) + (cu - bu) * (v - cv)) / area
    const kb = ((cv - av) * (u - cu) + (au - cu) * (v - cv)) / area
    const kc = 1 - ka - kb
    if (Math.min(ka, kb, kc) >= 0) return { a, b, c, ka, kb, kc, inside: true }
    if (!nearest) continue
    const closest = closestUvWeights(au, av, bu, bv, cu, cv, u, v)
    if (closest.distance >= bestDistance) continue
    bestDistance = closest.distance
    best = { a, b, c, ka: closest.ka, kb: closest.kb, kc: closest.kc, inside: false }
  }
  return best
}

/**
 * Where `(u, v)` lands on the surface described by `position` and `uv`.
 *
 * `index` is the element index, or null for a non-indexed geometry. Null
 * comes back only when there is no triangle at all — a caller that gets it
 * has no defined position for an attached object, so the sample is withheld.
 *
 * The nearest triangle is used when none contains the point. UV layouts
 * have seams and gutters, and an anchor half a texel outside every triangle
 * is a rounding accident, not a request to disappear.
 */
export function sampleUvPosition(
  position: ArrayLike<number>,
  uv: ArrayLike<number>,
  index: ArrayLike<number> | null,
  u: number,
  v: number,
): UvSample | null {
  // Most anchors are inside a triangle. Search containment first so they
  // avoid edge projections and normals for triangles that cannot hold them.
  const weights = findTriangleWeights(uv, index, u, v, false) ?? findTriangleWeights(uv, index, u, v, true)
  if (!weights) return null
  const { a, b, c, ka, kb, kc, inside } = weights
  const ax = at(position, a * 3)
  const ay = at(position, a * 3 + 1)
  const az = at(position, a * 3 + 2)
  const bx = at(position, b * 3)
  const by = at(position, b * 3 + 1)
  const bz = at(position, b * 3 + 2)
  const cx = at(position, c * 3)
  const cy = at(position, c * 3 + 1)
  const cz = at(position, c * 3 + 2)
  const e1x = bx - ax
  const e1y = by - ay
  const e1z = bz - az
  const e2x = cx - ax
  const e2y = cy - ay
  const e2z = cz - az
  let nx = e1y * e2z - e1z * e2y
  let ny = e1z * e2x - e1x * e2z
  let nz = e1x * e2y - e1y * e2x
  const length = Math.hypot(nx, ny, nz)
  if (length > 0) {
    nx /= length
    ny /= length
    nz /= length
  } else {
    nz = 1
  }
  return Object.freeze({
    x: ax * ka + bx * kb + cx * kc,
    y: ay * ka + by * kb + cy * kc,
    z: az * ka + bz * kb + cz * kc,
    nx,
    ny,
    nz,
    inside,
  })
}
