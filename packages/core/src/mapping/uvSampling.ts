// UV sampling — where a texture coordinate lands on the geometry carrying
// that texture.
//
// The law: an anchor names a box in the SOURCE, and matter parked on it
// stands wherever the geometry put those texels. On a flat plane that is a
// linear remap and nobody needs this module. On a deformed sheet the same
// UV is somewhere the plane math cannot name, and matter placed by the
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

/**
 * Where `(u, v)` lands on the surface described by `position` and `uv`.
 *
 * `index` is the element index, or null for a non-indexed geometry. Null
 * comes back only when there is no triangle at all — a caller that gets it
 * has nothing to place matter on, and withholding is the honest answer.
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
  const triangles = (index ? index.length : uv.length / 2) / 3
  let bestPenalty = Number.POSITIVE_INFINITY
  let bestX = 0
  let bestY = 0
  let bestZ = 0
  let bestNx = 0
  let bestNy = 0
  let bestNz = 1
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
    // Barycentric coordinates in UV space. A degenerate triangle — a
    // collapsed quad on a folded sheet — divides by zero, and skipping it
    // is right: it covers no area, so nothing is inside it.
    const area = (bv - cv) * (au - cu) + (cu - bu) * (av - cv)
    if (area === 0) continue
    const wa = ((bv - cv) * (u - cu) + (cu - bu) * (v - cv)) / area
    const wb = ((cv - av) * (u - cu) + (au - cu) * (v - cv)) / area
    const wc = 1 - wa - wb
    const penalty = -Math.min(wa, wb, wc, 0)
    if (penalty >= bestPenalty) continue
    bestPenalty = penalty
    const clampA = Math.max(wa, 0)
    const clampB = Math.max(wb, 0)
    const clampC = Math.max(wc, 0)
    const total = clampA + clampB + clampC || 1
    const ka = clampA / total
    const kb = clampB / total
    const kc = clampC / total
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
    bestX = ax * ka + bx * kb + cx * kc
    bestY = ay * ka + by * kb + cy * kc
    bestZ = az * ka + bz * kb + cz * kc
    bestNx = nx
    bestNy = ny
    bestNz = nz
    if (penalty === 0) break
  }
  if (bestPenalty === Number.POSITIVE_INFINITY) return null
  return Object.freeze({
    x: bestX,
    y: bestY,
    z: bestZ,
    nx: bestNx,
    ny: bestNy,
    nz: bestNz,
    inside: bestPenalty === 0,
  })
}
