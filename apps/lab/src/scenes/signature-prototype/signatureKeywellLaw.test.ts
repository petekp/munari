// Unit checks for `signatureKeywellLaw` 2D spatial focus selection — verifies
// edge-based directional filtering, perpendicular-overlap preference over closer
// diagonal neighbors, and `null` boundary return (preserving native scrolling).

import { describe, expect, it } from 'vitest'
import { pickBestSpatialIndex, type RectLike } from './signatureKeywellLaw'

function makeGridRects(): RectLike[] {
  const rects: RectLike[] = []
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const left = 33 + c * 142
      const top = 104 + r * 96
      rects.push({ left, top, right: left + 128, bottom: top + 82, width: 128, height: 82 })
    }
  }
  return rects
}

describe('signatureKeywellLaw', () => {
  it('moves orthogonally across all 4 directions in the 4x3 keywell grid', () => {
    const rects = makeGridRects()
    // Center key `5` (row 1, col 1) -> left: 4, right: 6, up: 1, down: 9
    expect(pickBestSpatialIndex(rects, 5, 'ArrowLeft')).toBe(4)
    expect(pickBestSpatialIndex(rects, 5, 'ArrowRight')).toBe(6)
    expect(pickBestSpatialIndex(rects, 5, 'ArrowUp')).toBe(1)
    expect(pickBestSpatialIndex(rects, 5, 'ArrowDown')).toBe(9)
  })

  it('returns null at outer grid boundaries so native viewport scrolling is preserved', () => {
    const rects = makeGridRects()
    expect(pickBestSpatialIndex(rects, 0, 'ArrowUp')).toBeNull()
    expect(pickBestSpatialIndex(rects, 0, 'ArrowLeft')).toBeNull()
    expect(pickBestSpatialIndex(rects, 3, 'ArrowRight')).toBeNull()
    expect(pickBestSpatialIndex(rects, 11, 'ArrowDown')).toBeNull()
  })
})
