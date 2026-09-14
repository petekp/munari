import { describe, expect, it } from 'vitest'
import { curlSample, unrolledLength } from './candidateCurlLaw'

const R = 10
const H = 2.5

describe('curlSample', () => {
  it('leaves the flat part exactly where it lies', () => {
    const c = curlSample(40, 100, 300, R, H)
    expect(c).toEqual({ along: 40, lift: 0, normalAlong: 0, normalLift: 1, wind: 0 })
  })

  it('is continuous at the hinge', () => {
    const flat = curlSample(99.999, 100, 300, R, H)
    const wound = curlSample(100.001, 100, 300, R, H)
    expect(wound.along).toBeCloseTo(flat.along, 1)
    expect(wound.lift).toBeCloseTo(0, 1)
  })

  it('lifts toward the camera, never below the page', () => {
    for (let s = 0; s <= 300; s += 7) {
      expect(curlSample(s, 60, 300, R, H).lift).toBeGreaterThanOrEqual(0)
    }
  })

  it('preserves arc length within a percent', () => {
    // Inextensibility is the law. Adjacent samples 1px apart along the
    // sheet must stay ~1px apart after winding.
    for (let s = 61; s < 300; s += 13) {
      const a = curlSample(s, 60, 300, R, H)
      const b = curlSample(s + 1, 60, 300, R, H)
      const d = Math.hypot(a.along - b.along, a.lift - b.lift)
      expect(d).toBeGreaterThan(0.98)
      expect(d).toBeLessThan(1.02)
    }
  })

  it('nests successive turns instead of stacking them on one ring', () => {
    const atWind = (wind: number) => {
      let low = 0
      let high = 280
      for (let step = 0; step < 50; step++) {
        const middle = (low + high) / 2
        if (curlSample(middle, 0, 280, R, H).wind < wind) low = middle
        else high = middle
      }
      return curlSample((low + high) / 2, 0, 280, R, H)
    }
    for (const angle of [0.5, 1.5, 3]) {
      const outer = atWind(angle)
      const inner = atWind(angle + 2 * Math.PI)
      expect(inner.wind - outer.wind).toBeCloseTo(2 * Math.PI, 10)
      expect(Math.hypot(inner.along - outer.along, inner.lift - outer.lift)).toBeCloseTo(H, 9)
    }
  })

  it('keeps the free end at the core, inside the outer turn', () => {
    const end = curlSample(280, 0, 280, R, H)
    const hingeSide = curlSample(1, 0, 280, R, H)
    expect(end.wind).toBeGreaterThan(hingeSide.wind)
    // The core sits within one diameter of the spiral centre.
    expect(Math.abs(end.lift)).toBeLessThan(2 * (R + (H * end.wind) / (2 * Math.PI)))
  })

  it('collapses to the single-turn circle when thickness is zero', () => {
    const c = curlSample(70, 60, 300, R, 0)
    const w = 10 / R
    expect(c.along).toBeCloseTo(60 - R * Math.sin(w), 5)
    expect(c.lift).toBeCloseTo(R * (1 - Math.cos(w)), 5)
  })
})

describe('unrolledLength', () => {
  it('is fully wound when closed', () => {
    expect(unrolledLength(0, 240)).toBe(0)
  })

  it('lies flat when open', () => {
    expect(unrolledLength(1, 240)).toBe(240)
  })

  it('never reports more sheet than there is', () => {
    expect(unrolledLength(1.4, 240)).toBe(240)
    expect(unrolledLength(-0.2, 240)).toBe(0)
  })
})
