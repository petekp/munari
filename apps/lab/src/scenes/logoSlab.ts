// The letter's body. Two experiments live in this one mesh, and they
// were built together because they turned out to be the same mesh.
//
// RELIEF: the sheet — the flat rectangle every lifted letter has always
// been — is subdivided finely enough that the height field can actually
// PUSH it (logoShaders' vertex stage). Until now that field only tilted
// normals: the letter was lit like a dome and shaped like a decal, which
// is exactly the tell that a surface is painted on. Displacing the same
// field costs a denser grid and nothing else, and it buys parallax —
// the interior slides against its own outline as the letter wobbles.
//
// EXTRUSION: the letter's traced outline (logoContour) grows WALLS,
// dropping back from the sheet to a flat back face. That is what gives a
// letter an edge to catch the studio light, and it is the difference
// between a lit picture of a thing and a thing.
//
// The two compose because the wall's top ring carries the SHEET'S uv, so
// the vertex stage lifts the wall tops by the same height field that
// puffs the sheet. The wall stays welded to the surface it hangs from,
// however hard the surface domes.
//
// Three constructions worth stating plainly:
//
//   · The sheet is UNCHANGED — same rectangle, same uv, same full
//     coverage including the glyph's antialiased fringe. So at zero
//     thickness the walls are zero-area and this mesh renders precisely
//     what the plain sheet rendered. That is not a nicety: the crossing
//     hands off at progress exactly 0, and the letter has to be its own
//     pixels there. The handoff identity survives the slab because the
//     slab degenerates INTO the sheet, rather than replacing it.
//   · There IS a back cap, once there are walls to close. The first
//     version argued one could only ever be culled — true of a slab
//     seen head-on, false of one a hand has tilted, and false the
//     moment a letter's counter (the hole in an 'o') lets the eye look
//     straight down the tube. What it found there was the plate. The
//     cap is the sheet again at the back of the slab, wound the other
//     way so it faces the viewer who can see it, and it costs nothing
//     in the common pose: back-facing, culled before it rasterizes.
//   · Walls are indexed FIRST. Index order is draw order, and the walls
//     are opaque while the sheet has a soft edge: walls down, sheet
//     blended over them, no rim where the fringe meets the wall.
//
// Winding: rings arrive counter-clockwise for outer, clockwise for
// holes (logoContour's contract), and one triangle order serves both —
// reversing a hole's direction is exactly what turns its wall to face
// into the hole instead of out of it.

import * as THREE from 'three'
import type { ContourShape } from './logoContour'

/** A sane ceiling on wall detail, counted AFTER subdivision. A traced,
 *  simplified, subdivided letter lands in the low hundreds of points;
 *  anything past this is a pathological capture (noise traced as a
 *  coastline) and is not worth the vertices. */
const MAX_WALL_POINTS = 4000

/** CSS px between wall vertices along the outline. The wall's top edge
 *  rides the same height field as the sheet — the vertex stage lifts
 *  every wall vertex by the field at its uv — and a chord can only
 *  follow a curve as closely as its endpoints are spaced. The tracer
 *  hands back long straight segments on straight glyph edges (that is
 *  what simplification is FOR), so without this step a wall's top edge
 *  cut straight across a doming surface and the wall detached from the
 *  face mid-segment — a crack wherever the letter was most inflated.
 *  Twice the sheet's own step keeps the chord within a fraction of a
 *  px of the surface at a quarter of the vertices. */
export const WALL_STEP_PX = 8

/** The ring with every segment longer than WALL_STEP_PX split into
 *  equal pieces. Collinear pieces inherit the parent segment's normal
 *  by construction — the normal comes from the direction of travel. */
function subdivideRing(ring: number[], boxW: number, boxH: number): number[] {
  const n = ring.length / 2
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const u0 = ring[i * 2]
    const v0 = ring[i * 2 + 1]
    const u1 = ring[j * 2]
    const v1 = ring[j * 2 + 1]
    const len = Math.hypot((u1 - u0) * boxW, (v1 - v0) * boxH)
    const k = Math.max(1, Math.ceil(len / WALL_STEP_PX))
    for (let s = 0; s < k; s++) {
      const t = s / k
      out.push(u0 + (u1 - u0) * t, v0 + (v1 - v0) * t)
    }
  }
  return out
}

/**
 * The letter's mesh in local CSS pixels, centered on its capture box.
 *
 * `shapes` may be empty or null — then this is the plain sheet, which is
 * what a letter runs until its outline has been traced.
 *
 * Positions carry the slab in a form the vertex stage can scale: the
 * sheet and every wall top sit at z 0, every wall bottom at z -1. The
 * shader multiplies z by the live thickness, so thickness animates
 * without rebuilding a single vertex.
 */
export function buildLetterMesh(
  boxW: number,
  boxH: number,
  segX: number,
  segY: number,
  shapes: ContourShape[] | null,
): THREE.BufferGeometry {
  const rings: number[][] = []
  let wallPts = 0
  for (const s of shapes ?? []) {
    for (const r of [s.outer, ...s.holes]) {
      if (r.length / 2 < 3) continue
      const sub = subdivideRing(r, boxW, boxH)
      const n = sub.length / 2
      if (wallPts + n > MAX_WALL_POINTS) continue
      rings.push(sub)
      wallPts += n
    }
  }

  const sheetCols = segX + 1
  const sheetRows = segY + 1
  const sheetVerts = sheetCols * sheetRows
  const wallVerts = wallPts * 4
  // The cap exists only where walls do: with no outline there is no
  // slab, and a second copy of the sheet at the same z is z-fighting
  // with extra steps.
  const capped = rings.length > 0
  const total = sheetVerts + wallVerts + (capped ? sheetVerts : 0)

  const position = new Float32Array(total * 3)
  const normal = new Float32Array(total * 3)
  const uv = new Float32Array(total * 2)
  const index = new Uint32Array(segX * segY * 6 * (capped ? 2 : 1) + wallPts * 6)

  // ── the back cap, then the walls, then the sheet ──
  // Index order is draw order, and it runs back to front: the cap is
  // behind everything, the walls are opaque, and the sheet has a soft
  // edge that must blend over what it stands on.
  let v = 0
  let f = 0
  const capBase = v
  if (capped) {
    for (let iy = 0; iy < sheetRows; iy++) {
      const fy = iy / segY
      for (let ix = 0; ix < sheetCols; ix++) {
        const fx = ix / segX
        position[v * 3] = (fx - 0.5) * boxW
        position[v * 3 + 1] = (fy - 0.5) * boxH
        position[v * 3 + 2] = -1
        normal[v * 3] = 0
        normal[v * 3 + 1] = 0
        normal[v * 3 + 2] = -1
        uv[v * 2] = fx
        uv[v * 2 + 1] = fy
        v++
      }
    }
    // The sheet's triangles with two corners swapped: same surface,
    // wound the other way, so the cap faces the viewer exactly when the
    // sheet has turned away.
    for (let iy = 0; iy < segY; iy++) {
      for (let ix = 0; ix < segX; ix++) {
        const a = capBase + iy * sheetCols + ix
        const b = a + 1
        const c = a + sheetCols
        const d = c + 1
        index[f++] = a
        index[f++] = d
        index[f++] = b
        index[f++] = a
        index[f++] = c
        index[f++] = d
      }
    }
  }
  for (const ring of rings) {
    const n = ring.length / 2
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const u0 = ring[i * 2]
      const v0 = ring[i * 2 + 1]
      const u1 = ring[j * 2]
      const v1 = ring[j * 2 + 1]
      const x0 = (u0 - 0.5) * boxW
      const y0 = (v0 - 0.5) * boxH
      const x1 = (u1 - 0.5) * boxW
      const y1 = (v1 - 0.5) * boxH
      // Out of the material is to the RIGHT of the direction of travel,
      // which the ring's winding already decided.
      const dx = x1 - x0
      const dy = y1 - y0
      const len = Math.hypot(dx, dy)
      const nx = len > 1e-6 ? dy / len : 1
      const ny = len > 1e-6 ? -dx / len : 0
      // Four corners: top pair on the sheet (z 0, so the height field
      // lifts them with it), bottom pair on the back face (z -1).
      const quad = [
        [x0, y0, 0, u0, v0],
        [x1, y1, 0, u1, v1],
        [x0, y0, -1, u0, v0],
        [x1, y1, -1, u1, v1],
      ]
      const base = v
      for (const [x, y, z, qu, qv] of quad) {
        position[v * 3] = x
        position[v * 3 + 1] = y
        position[v * 3 + 2] = z
        normal[v * 3] = nx
        normal[v * 3 + 1] = ny
        normal[v * 3 + 2] = 0
        uv[v * 2] = qu
        uv[v * 2 + 1] = qv
        v++
      }
      const [t0, t1, b0, b1] = [base, base + 1, base + 2, base + 3]
      index[f++] = t0
      index[f++] = b0
      index[f++] = b1
      index[f++] = t0
      index[f++] = b1
      index[f++] = t1
    }
  }

  // ── the sheet ──
  const sheetBase = v
  for (let iy = 0; iy < sheetRows; iy++) {
    const fy = iy / segY
    for (let ix = 0; ix < sheetCols; ix++) {
      const fx = ix / segX
      position[v * 3] = (fx - 0.5) * boxW
      position[v * 3 + 1] = (fy - 0.5) * boxH
      position[v * 3 + 2] = 0
      normal[v * 3] = 0
      normal[v * 3 + 1] = 0
      normal[v * 3 + 2] = 1
      uv[v * 2] = fx
      uv[v * 2 + 1] = fy
      v++
    }
  }
  for (let iy = 0; iy < segY; iy++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = sheetBase + iy * sheetCols + ix
      const b = a + 1
      const c = a + sheetCols
      const d = c + 1
      index[f++] = a
      index[f++] = b
      index[f++] = d
      index[f++] = a
      index[f++] = d
      index[f++] = c
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geometry.setIndex(new THREE.BufferAttribute(index, 1))
  // Computed, NOT stated — and the difference is measurable.
  //
  // The vertex stage moves these points (relief, thickness, gel waves),
  // so the honest bound is a generous one; this first stated a sphere of
  // radius hypot(w,h), twice the tight fit. Every triangle, uv and normal
  // still matched PlaneGeometry exactly, and the crossing gate still
  // failed: the wider sphere survives frustum culling in poses the tight
  // one loses, and the letters that stayed drawn carried the lifted word
  // ~0.1pp of ink over the page — past the carry clause's +0.15pp settled
  // band, which left it no quiet frame to fit against (2026-08-14, three
  // bisected runs).
  //
  // So the wider sphere is arguably the more correct one, and the plane
  // this replaced has always under-bounded its own gel wave. But that is
  // a latent culling question with its own look and its own budget. This
  // mesh's job is to be the sheet where it degenerates to the sheet, down
  // to what gets culled, so it takes the bound the sheet always had.
  geometry.computeBoundingSphere()
  return geometry
}
