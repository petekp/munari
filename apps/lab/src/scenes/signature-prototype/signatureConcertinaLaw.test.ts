// Conformance & continuity checks for `signatureConcertinaLaw` — verifies that
// `createConcertinaGeometry` + `deformSurfaceGeometry` keep all mountain ridges
// and valley seams `C^0` watertight across heterogeneous per-column pleat states
// while compressing horizontal span monotonically.

import { describe, expect, it } from 'vitest'
import { deformSurfaceGeometry } from '@petepetrash/munari'
import {
  COL_W,
  CONCERTINA_COLS,
  CONCERTINA_H,
  CONCERTINA_W,
  computeBoardSpanPx,
  createConcertinaGeometry,
  foldConcertinaPoint,
} from './signatureConcertinaLaw'

function readVertex(pos: Float32Array | ArrayLike<number>, vIdx: number): [number, number, number] {
  return [
    Number(pos[vIdx * 3]),
    Number(pos[vIdx * 3 + 1]),
    Number(pos[vIdx * 3 + 2]),
  ]
}

describe('signatureConcertinaLaw', () => {
  it('matches exact flat 780x384 planar coordinates when all columns are unpleated', () => {
    const geo = createConcertinaGeometry()
    const flat = [0, 0, 0, 0, 0, 0]
    deformSurfaceGeometry(geo, [CONCERTINA_W, CONCERTINA_H], (x, y, idx) =>
      foldConcertinaPoint(x, y, flat, idx),
    )

    const pos = geo.getAttribute('position').array
    expect(computeBoardSpanPx(flat)).toBeCloseTo(CONCERTINA_W, 5)
    // Far-left top corner (strip 0, corner 0) and far-right bottom corner (strip 11, corner 2)
    expect(readVertex(pos, 0)).toEqual([-CONCERTINA_W / 2, CONCERTINA_H / 2, 0])
    expect(readVertex(pos, 11 * 4 + 2)).toEqual([CONCERTINA_W / 2, -CONCERTINA_H / 2, 0])
    geo.dispose()
  })

  it('keeps every mountain ridge and inter-column valley C^0 watertight under mixed pleating', () => {
    const geo = createConcertinaGeometry()
    // Bookends flat, interior columns pleated at varying angles (including full 1.0 and 0.0)
    const pleats = [0, 0.85, 0.4, 1.0, 0, 0.65]
    deformSurfaceGeometry(geo, [CONCERTINA_W, CONCERTINA_H], (x, y, idx) =>
      foldConcertinaPoint(x, y, pleats, idx),
    )

    const pos = geo.getAttribute('position').array
    const stripCount = CONCERTINA_COLS * 2

    for (let s = 0; s < stripCount - 1; s++) {
      // Strip `s` right edge (`corner 1` top, `corner 2` bottom) must meet strip `s + 1` left edge (`corner 0` top, `corner 3` bottom)
      const rightTop = readVertex(pos, s * 4 + 1)
      const nextLeftTop = readVertex(pos, (s + 1) * 4 + 0)
      const rightBot = readVertex(pos, s * 4 + 2)
      const nextLeftBot = readVertex(pos, (s + 1) * 4 + 3)

      for (let axis = 0; axis < 3; axis++) {
        expect(rightTop[axis]).toBeCloseTo(nextLeftTop[axis]!, 5)
        expect(rightBot[axis]).toBeCloseTo(nextLeftBot[axis]!, 5)
      }
    }

    // Pleated column 1 (`0.85`) ridge rises into +Z while its outer valley edges return to z = 0
    const col1ValleyLeft = readVertex(pos, 2 * 4 + 0)
    const col1Ridge = readVertex(pos, 2 * 4 + 1)
    const col1ValleyRight = readVertex(pos, 3 * 4 + 1)
    expect(col1ValleyLeft[2]).toBeCloseTo(0, 5)
    expect(col1Ridge[2]).toBeGreaterThan(50)
    expect(col1ValleyRight[2]).toBeCloseTo(0, 5)
    geo.dispose()
  })

  it('pulls bookend columns closer together monotonically as middle columns pleat', () => {
    const openSpan = computeBoardSpanPx([0, 0, 0, 0, 0, 0])
    const halfPleatSpan = computeBoardSpanPx([0, 0.5, 0.5, 0.5, 0.5, 0])
    const deepPleatSpan = computeBoardSpanPx([0, 0.9, 0.9, 0.9, 0.9, 0])

    expect(openSpan).toBeCloseTo(6 * COL_W, 5)
    expect(halfPleatSpan).toBeLessThan(openSpan - 80)
    expect(deepPleatSpan).toBeLessThan(halfPleatSpan - 120)
    // Even at deep pleat, both flat 130 px bookends remain full width (>= 260 px)
    expect(deepPleatSpan).toBeGreaterThan(2 * COL_W + 140)
  })
})
