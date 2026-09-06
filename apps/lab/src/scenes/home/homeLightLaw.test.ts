// Home light law — a shadow falls away from the light, grows with standoff,
// and a well's floor is shaded on the side nearest the light.

import { describe, expect, it } from 'vitest'
import { GLYPH_STANDOFF, LIGHT_HEIGHT, WELL_DEPTH, occluderPoint, throwLength, wellRimPoint } from './homeLightLaw'

const light = { x: 0, y: 0 }

describe('occluderPoint', () => {
  it('pulls a raised occluder toward the light, so the shadow falls away from it', () => {
    const p = { x: 100, y: 0 }
    const q = occluderPoint(light, p, GLYPH_STANDOFF)
    expect(q.x).toBeGreaterThan(0)
    expect(q.x).toBeLessThan(p.x)
    expect(q.x).toBeCloseTo(100 * (1 - GLYPH_STANDOFF / LIGHT_HEIGHT), 6)
  })

  it('crosses the page on the light side of a well-floor point, so the rim nearest the light shades it', () => {
    const p = { x: 100, y: 0 }
    const q = wellRimPoint(light, p, WELL_DEPTH)
    expect(q.x).toBeGreaterThan(0)
    expect(q.x).toBeLessThan(p.x)
    expect(q.x).toBeCloseTo((100 * LIGHT_HEIGHT) / (LIGHT_HEIGHT + WELL_DEPTH), 6)
  })

  it('throws longer shadows for taller matter and for lower lights', () => {
    const p = { x: 200, y: 150 }
    expect(throwLength(light, p, GLYPH_STANDOFF)).toBeGreaterThan(throwLength(light, p, 4))
    expect(throwLength(light, p, GLYPH_STANDOFF, 60)).toBeGreaterThan(throwLength(light, p, GLYPH_STANDOFF, 240))
  })

  it('casts nothing directly under the light', () => {
    expect(throwLength(light, light, GLYPH_STANDOFF)).toBe(0)
  })
})
