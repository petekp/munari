// The slab's one contract: with no outline to extrude, it IS the plane
// it replaced. The crossing hands off at progress exactly 0, and the
// letter has to be its own pixels there — so a mesh that is "basically"
// the sheet is not good enough. It has to be the sheet.
//
// "The same triangles" turned out to be too weak a reading of that.
// A first version matched PlaneGeometry vertex for vertex, uv for uv,
// and normal for normal, and still failed the crossing gate: it STATED
// a bounding sphere of radius hypot(w,h) instead of computing the tight
// one, which survives frustum culling in poses the plane loses, and the
// letters that stayed drawn carried the lifted word ~0.1pp of ink over
// the page (2026-08-14, three bisected gate runs). Hence the last clause
// here, which looks pedantic and is the one that would have caught it.

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildLetterMesh, WALL_STEP_PX } from './logoSlab'
import type { InkIsland } from './logoContour'

const W = 131
const H = 291
const SX = 28
const SY = 14

/** Every triangle as its three (x,y,z,u,v) corners, corner-sorted and
 *  then list-sorted: identity up to vertex order and diagonal choice,
 *  which is all the rasterizer can tell apart on a planar grid. */
function triangles(g: THREE.BufferGeometry): string[] {
  const p = g.getAttribute('position')
  const uv = g.getAttribute('uv')
  const idx = g.getIndex()
  if (!idx) throw new Error('expected an indexed geometry')
  const out: string[] = []
  for (let t = 0; t < idx.count; t += 3) {
    const corners: string[] = []
    for (let k = 0; k < 3; k++) {
      const i = idx.getX(t + k)
      corners.push(
        [p.getX(i), p.getY(i), p.getZ(i), uv.getX(i), uv.getY(i)]
          .map((n) => n.toFixed(4))
          .join(','),
      )
    }
    out.push(corners.sort().join(' | '))
  }
  return out.sort()
}

describe('buildLetterMesh with no outline', () => {
  const sheet = buildLetterMesh(W, H, SX, SY, null)
  const plane = new THREE.PlaneGeometry(W, H, SX, SY)

  it('covers the plane with the plane’s own triangles', () => {
    expect(triangles(sheet)).toEqual(triangles(plane))
  })

  it('lays each triangle down exactly once', () => {
    const t = triangles(sheet)
    expect(new Set(t).size).toBe(t.length)
  })

  it('references every vertex it allocates', () => {
    const idx = sheet.getIndex()!
    const seen = new Set<number>()
    for (let i = 0; i < idx.count; i++) seen.add(idx.getX(i))
    expect(seen.size).toBe(sheet.getAttribute('position').count)
  })

  it('faces the camera everywhere', () => {
    const n = sheet.getAttribute('normal')
    for (let i = 0; i < n.count; i++)
      expect([n.getX(i), n.getY(i), n.getZ(i)]).toEqual([0, 0, 1])
  })

  it('winds every triangle counter-clockwise', () => {
    const p = sheet.getAttribute('position')
    const idx = sheet.getIndex()!
    let backfacing = 0
    for (let t = 0; t < idx.count; t += 3) {
      const [a, b, c] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)]
      const ax = p.getX(b) - p.getX(a)
      const ay = p.getY(b) - p.getY(a)
      const bx = p.getX(c) - p.getX(a)
      const by = p.getY(c) - p.getY(a)
      if (ax * by - ay * bx <= 0) backfacing++
    }
    expect(backfacing).toBe(0)
  })

  it('is culled on the same sphere as the plane', () => {
    plane.computeBoundingSphere()
    const mine = sheet.boundingSphere!
    const theirs = plane.boundingSphere!
    expect(mine.radius).toBeCloseTo(theirs.radius, 4)
    expect(mine.center.toArray()).toEqual(theirs.center.toArray())
  })
})

describe('buildLetterMesh with an outline', () => {
  // A square ring, counter-clockwise in uv, with a square hole wound the
  // other way — the shape of an 'o', reduced to what the walls care about.
  const islands: InkIsland[] = [
    {
      outer: [0.2, 0.2, 0.8, 0.2, 0.8, 0.8, 0.2, 0.8],
      holes: [[0.4, 0.4, 0.4, 0.6, 0.6, 0.6, 0.6, 0.4]],
    },
  ]
  const slab = buildLetterMesh(W, H, SX, SY, islands)

  it('keeps the sheet intact underneath the walls', () => {
    const sheetOnly = new Set(triangles(buildLetterMesh(W, H, SX, SY, null)))
    const all = new Set(triangles(slab))
    for (const t of sheetOnly) expect(all.has(t)).toBe(true)
  })

  it('grows one wall quad per subdivided outline segment', () => {
    const plain = buildLetterMesh(W, H, SX, SY, null)
    const extra = slab.getIndex()!.count - plain.getIndex()!.count
    // Each ring edge splits into ceil(px / WALL_STEP_PX) pieces: the
    // outer square's horizontals are 78.6px (→10) and its verticals
    // 174.6px (→22); the hole's are 26.2px (→4) and 58.2px (→8).
    // 64 + 24 wall quads, plus the back cap — the sheet's triangles a
    // second time, at the back of the slab.
    const walls = 2 * (10 + 22) + 2 * (4 + 8)
    expect(extra).toBe(walls * 6 + SX * SY * 6)
  })

  it('spaces wall vertices closely enough to track the height field', () => {
    // A wall's top edge is a chord of the surface it hangs from, and
    // the vertex stage bends that surface with the coarse height field.
    // A chord can only follow a curve as closely as its endpoints are
    // spaced: the tracer's long straight segments (simplification's
    // whole point) cut straight across the dome, and the wall detached
    // from the face mid-segment — the hairline gaps along every
    // inflated edge. So no wall edge may span more than WALL_STEP_PX.
    const idx = slab.getIndex()!
    const p = slab.getAttribute('position')
    const n = slab.getAttribute('normal')
    let quads = 0
    // Wall quads index as [t0, b0, b1, t0, b1, t1]: t0 and t1 are the
    // segment's two top corners.
    for (let t = 0; t < idx.count; t += 6) {
      if (n.getZ(idx.getX(t)) !== 0) continue
      const a = idx.getX(t)
      const b = idx.getX(t + 5)
      const len = Math.hypot(p.getX(b) - p.getX(a), p.getY(b) - p.getY(a))
      expect(len).toBeLessThanOrEqual(WALL_STEP_PX + 1e-6)
      quads++
    }
    expect(quads).toBe(2 * (10 + 22) + 2 * (4 + 8))
  })

  it('closes the body with a back cap', () => {
    // Without one, a tilted letter — or the eye looking down a counter,
    // the hole in an 'o' — sees straight through the slab to the plate.
    // The cap is the sheet's own footprint at the back, so the front,
    // the walls and the cap enclose one volume.
    const p = slab.getAttribute('position')
    const n = slab.getAttribute('normal')
    let cap = 0
    for (let i = 0; i < n.count; i++) if (n.getZ(i) === -1) cap++
    expect(cap).toBe((SX + 1) * (SY + 1))
    for (let i = 0; i < p.count; i++) if (n.getZ(i) === -1) expect(p.getZ(i)).toBe(-1)
  })

  it('winds the cap against the sheet, so each faces its own way', () => {
    // The cap is only ever seen from behind. Wound like the sheet it
    // would be culled exactly when it is needed and drawn exactly when
    // it is hidden.
    const p = slab.getAttribute('position')
    const n = slab.getAttribute('normal')
    const idx = slab.getIndex()!
    let capTris = 0
    for (let t = 0; t < idx.count; t += 3) {
      const [a, b, c] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)]
      if (n.getZ(a) !== -1) continue
      capTris++
      const cross =
        (p.getX(b) - p.getX(a)) * (p.getY(c) - p.getY(a)) -
        (p.getY(b) - p.getY(a)) * (p.getX(c) - p.getX(a))
      expect(cross).toBeLessThan(0)
    }
    expect(capTris).toBe(SX * SY * 2)
  })

  it('leaves the cap out when there is no slab to close', () => {
    // Two copies of the sheet in the sheet's own plane is z-fighting
    // with extra steps.
    const plain = buildLetterMesh(W, H, SX, SY, null)
    const n = plain.getAttribute('normal')
    for (let i = 0; i < n.count; i++) expect(n.getZ(i)).toBe(1)
  })

  it('draws the cap, then the walls, then the sheet', () => {
    // Index order is draw order, back to front: the cap is behind
    // everything, the walls are opaque, and the sheet's soft fringe
    // must blend over what it stands on. Every triangle's vertices
    // share a surface class, and the class never runs backward.
    const idx = slab.getIndex()!
    const n = slab.getAttribute('normal')
    let prev = 0
    for (let t = 0; t < idx.count; t += 3) {
      const nz = n.getZ(idx.getX(t))
      const cls = nz === -1 ? 0 : nz === 0 ? 1 : 2
      expect(cls).toBeGreaterThanOrEqual(prev)
      prev = cls
    }
  })

  it('collapses to zero depth in a form the shader can scale', () => {
    const p = slab.getAttribute('position')
    const zs = new Set<number>()
    for (let i = 0; i < p.count; i++) zs.add(p.getZ(i))
    // z is a UNIT, never a distance: 0 on the sheet and wall tops, -1 on
    // the back face. Thickness is therefore a multiply in the vertex
    // stage, and at zero thickness every wall quad has no area.
    expect([...zs].sort()).toEqual([-1, 0])
  })

  it('points every wall out of the material it stands on', () => {
    const p = slab.getAttribute('position')
    const n = slab.getAttribute('normal')
    // The outer ring's left wall (x at 0.2 of the box) must face -x, and
    // a hole's wall must face the other way: into the hole.
    const outerLeft = (0.2 - 0.5) * W
    const holeLeft = (0.4 - 0.5) * W
    let outerSeen = 0
    let holeSeen = 0
    for (let i = 0; i < p.count; i++) {
      if (n.getZ(i) !== 0) continue
      if (Math.abs(p.getX(i) - outerLeft) < 1e-3 && Math.abs(n.getX(i) + 1) < 1e-3) outerSeen++
      if (Math.abs(p.getX(i) - holeLeft) < 1e-3 && Math.abs(n.getX(i) - 1) < 1e-3) holeSeen++
    }
    expect(outerSeen).toBeGreaterThan(0)
    expect(holeSeen).toBeGreaterThan(0)
  })
})
