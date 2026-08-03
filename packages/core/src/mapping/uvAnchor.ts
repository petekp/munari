// UV→surface inversion: given a (u, v) texture coordinate, find the
// point on a geometry's surface that the texture maps to. This is the
// inverse of what a raycaster gives (hit → UV); anchors need the other
// direction (UV → position + normal) so floating layers can attach to
// a spot on a Surface's skin, whatever shape that skin is.
//
// The trick that makes this cheap for deforming geometry: the search —
// which triangle contains (u, v), and where inside it (barycentric
// weights) — only depends on the UV attribute, which is static even
// when vertices move. So an anchor resolves its triangle ONCE, then
// each sample() is three attribute reads and a weighted sum against
// the LIVE position/normal buffers. O(1) per frame; the anchor rides
// the deformation for free.
//
// Known limits (deliberate): GPU/shader displacement is invisible here
// (same limit as raycast forwarding — CPU-side positions only), and if
// a UV point is covered by multiple triangles (overlapping UV islands)
// the first found wins.
//
// Geometry parameters are structural (decisions.md #4): anything shaped
// like a BufferGeometry — indexed or not — works; THREE.BufferGeometry
// satisfies GeometryLike with no adapter.

import { Vec3, type SampleVec } from '../math/vec3'

/** Three floats per vertex, read by index. THREE.BufferAttribute qualifies. */
export interface AttributeLike {
  readonly count: number
  getX(index: number): number
  getY(index: number): number
  getZ(index: number): number
}

/** The slice of BufferGeometry the anchor reads. */
export interface GeometryLike {
  readonly attributes: { readonly [name: string]: AttributeLike }
  readonly index: { readonly count: number; getX(index: number): number } | null
}

/** A caller-provided sample target; THREE.Vector3 pairs qualify. */
export interface SurfaceSampleLike {
  position: SampleVec
  normal: SampleVec
}

/** What sample() allocates when no target is supplied. */
export interface SurfaceSample {
  position: Vec3
  normal: Vec3
}

interface TrianglePick {
  ia: number
  ib: number
  ic: number
  wa: number
  wb: number
  wc: number
}

// Tolerance for "inside the triangle": lets exact edge/corner hits
// (u=0, u=1) pass despite floating-point noise.
const EDGE_EPS = 1e-6

function pickTriangle(geometry: GeometryLike, u: number, v: number): TrianglePick | null {
  const uv = geometry.attributes['uv']
  const position = geometry.attributes['position']
  if (!uv || !position) return null
  const index = geometry.index
  const triCount = (index ? index.count : position.count) / 3

  for (let t = 0; t < triCount; t++) {
    const ia = index ? index.getX(t * 3) : t * 3
    const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1
    const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2

    const ua = uv.getX(ia)
    const va = uv.getY(ia)
    const ub = uv.getX(ib)
    const vb = uv.getY(ib)
    const uc = uv.getX(ic)
    const vc = uv.getY(ic)

    // Barycentric coordinates of (u, v) in the UV-space triangle: solve
    // the 2×2 linear system (u,v) = wa·A + wb·B + wc·C with wa+wb+wc = 1.
    const denom = (vb - vc) * (ua - uc) + (uc - ub) * (va - vc)
    if (Math.abs(denom) < 1e-12) continue // degenerate UV triangle (zero area)
    const wa = ((vb - vc) * (u - uc) + (uc - ub) * (v - vc)) / denom
    const wb = ((vc - va) * (u - uc) + (ua - uc) * (v - vc)) / denom
    const wc = 1 - wa - wb

    if (wa >= -EDGE_EPS && wb >= -EDGE_EPS && wc >= -EDGE_EPS) {
      return { ia, ib, ic, wa, wb, wc }
    }
  }
  return null
}

/**
 * A (u, v) point pinned to a geometry's surface. Construct once
 * (topology search), then sample() every frame — it reads the live
 * attributes, so CPU deformation carries the anchor with it.
 */
export class UVAnchor {
  readonly valid: boolean
  private pick: TrianglePick | null
  private geometry: GeometryLike

  constructor(geometry: GeometryLike, u: number, v: number) {
    this.geometry = geometry
    this.pick = pickTriangle(geometry, u, v)
    this.valid = this.pick !== null
  }

  /** Local-space position + unit normal at the anchor, or null if invalid. */
  sample(): SurfaceSample | null
  sample<S extends SurfaceSampleLike>(target: S): S | null
  sample(target?: SurfaceSampleLike): SurfaceSampleLike | null {
    const p = this.pick
    if (!p) return null
    const pos = this.geometry.attributes['position']
    if (!pos) return null
    const out = target ?? { position: new Vec3(), normal: new Vec3() }

    out.position.set(
      p.wa * pos.getX(p.ia) + p.wb * pos.getX(p.ib) + p.wc * pos.getX(p.ic),
      p.wa * pos.getY(p.ia) + p.wb * pos.getY(p.ib) + p.wc * pos.getY(p.ic),
      p.wa * pos.getZ(p.ia) + p.wb * pos.getZ(p.ib) + p.wc * pos.getZ(p.ic),
    )

    const nrm = this.geometry.attributes['normal']
    if (nrm) {
      out.normal.set(
        p.wa * nrm.getX(p.ia) + p.wb * nrm.getX(p.ib) + p.wc * nrm.getX(p.ic),
        p.wa * nrm.getY(p.ia) + p.wb * nrm.getY(p.ib) + p.wc * nrm.getY(p.ic),
        p.wa * nrm.getZ(p.ia) + p.wb * nrm.getZ(p.ib) + p.wc * nrm.getZ(p.ic),
      )
      out.normal.normalize()
    } else {
      // No normal attribute: face normal from the live triangle.
      // Front-face winding (CCW) makes this point out of the rendered
      // side. Scalar cross product — core allocates nothing here.
      const ax = pos.getX(p.ia)
      const ay = pos.getY(p.ia)
      const az = pos.getZ(p.ia)
      const abx = pos.getX(p.ib) - ax
      const aby = pos.getY(p.ib) - ay
      const abz = pos.getZ(p.ib) - az
      const acx = pos.getX(p.ic) - ax
      const acy = pos.getY(p.ic) - ay
      const acz = pos.getZ(p.ic) - az
      out.normal.set(
        aby * acz - abz * acy,
        abz * acx - abx * acz,
        abx * acy - aby * acx,
      )
      out.normal.normalize()
    }

    return out
  }
}

/** One-shot convenience: resolve and sample in a single call. */
export function sampleSurfaceAtUV(geometry: GeometryLike, u: number, v: number): SurfaceSample | null
export function sampleSurfaceAtUV<S extends SurfaceSampleLike>(
  geometry: GeometryLike,
  u: number,
  v: number,
  target: S,
): S | null
export function sampleSurfaceAtUV(
  geometry: GeometryLike,
  u: number,
  v: number,
  target?: SurfaceSampleLike,
): SurfaceSampleLike | null {
  const anchor = new UVAnchor(geometry, u, v)
  return target ? anchor.sample(target) : anchor.sample()
}
