import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { deformSurfaceGeometry } from '@petepetrash/munari'
import {
  BOX_DEPTH,
  BOX_H,
  BOX_W,
  DIELINE_H,
  DIELINE_W,
  createDielineCrossGeometry,
  foldDielinePoint,
} from './beyondDielineLaw'

describe('beyondDielineLaw', () => {
  it('preserves exact flat content coordinates at foldT = 0', () => {
    expect(foldDielinePoint(80, 220, 0, 4)).toEqual({ x: 80, y: 220, z: 0 })
    expect(foldDielinePoint(244, 264, 0, 0)).toEqual({ x: 244, y: 264, z: 0 })
  })

  it('folds Float32Array UVs via deformSurfaceGeometry into a centered, planar 216x216x112 prism without diagonal shear', () => {
    const geo = createDielineCrossGeometry()
    deformSurfaceGeometry(geo, [DIELINE_W, DIELINE_H], (x, y, idx) =>
      foldDielinePoint(x, y, 1, idx),
    )
    geo.computeVertexNormals()
    geo.computeBoundingBox()

    const bb = geo.boundingBox!
    expect(bb.max.x - bb.min.x).toBeCloseTo(BOX_W, 3)
    expect(bb.max.y - bb.min.y).toBeCloseTo(BOX_H, 3)
    expect(bb.max.z - bb.min.z).toBeCloseTo(BOX_DEPTH, 3)
    expect((bb.min.x + bb.max.x) * 0.5).toBeCloseTo(0, 3)
    expect((bb.min.y + bb.max.y) * 0.5).toBeCloseTo(0, 3)
    expect((bb.min.z + bb.max.z) * 0.5).toBeCloseTo(0, 3)

    // SAFETY: createDielineCrossGeometry attaches a plain THREE.BufferAttribute for 'normal'.
    const norm = geo.getAttribute('normal') as THREE.BufferAttribute
    // Panel 4 (bottom, vertices 16..19) must all share the exact downward normal (0, -1, 0)
    for (let v = 16; v < 20; v++) {
      expect(norm.getX(v)).toBeCloseTo(0, 4)
      expect(norm.getY(v)).toBeCloseTo(-1, 4)
      expect(norm.getZ(v)).toBeCloseTo(0, 4)
    }
    // Panel 5 (top lid, vertices 20..23) must all share the exact upward normal (0, +1, 0)
    for (let v = 20; v < 24; v++) {
      expect(norm.getX(v)).toBeCloseTo(0, 4)
      expect(norm.getY(v)).toBeCloseTo(1, 4)
      expect(norm.getZ(v)).toBeCloseTo(0, 4)
    }
    geo.dispose()
  })
})
