import { describe, expect, it } from 'vitest'
import { PANEL_RADIUS } from './knobsGeometry'
import {
  PANEL_EDGE_INSET,
  PANEL_MAX_W,
  PANEL_MIN_W,
  PANEL_W_STEP,
  nineSlice,
  resizeWidth,
  sliceCoord,
  straightHalf,
} from './knobsResize'

describe('the width a corner drag may ask for', () => {
  const GLASS = 1440

  it('follows the hand', () => {
    expect(resizeWidth(320, 80, GLASS)).toBe(400)
    expect(resizeWidth(320, -80, GLASS)).toBe(240)
  })

  it('lands on the step, always — a fractional width relayouts forever', () => {
    for (let dx = -200; dx <= 200; dx += 7) {
      expect(resizeWidth(320, dx, GLASS) % PANEL_W_STEP).toBe(0)
    }
  })

  it('stops at both ends', () => {
    expect(resizeWidth(320, -9999, GLASS)).toBe(PANEL_MIN_W)
    expect(resizeWidth(320, 9999, GLASS)).toBe(PANEL_MAX_W)
  })

  it('never outgrows the glass that has to hold it', () => {
    const narrow = 420
    const w = resizeWidth(320, 9999, narrow)
    expect(w).toBeLessThanOrEqual(narrow - PANEL_EDGE_INSET * 2)
    expect(w).toBeLessThan(PANEL_MAX_W)
  })

  it('keeps the floor even on a glass narrower than the panel', () => {
    // A phone-width window may not produce a negative panel.
    expect(resizeWidth(320, -50, 200)).toBe(PANEL_MIN_W)
  })

  it('never moves backwards as the hand moves forwards', () => {
    let last = 0
    for (let dx = -400; dx <= 400; dx += 3) {
      const w = resizeWidth(320, dx, GLASS)
      expect(w).toBeGreaterThanOrEqual(last)
      last = w
    }
  })

  it('leaves room for two corner arcs at the narrowest width', () => {
    // Below this the rim's straight spans invert and the chamfer folds
    // through itself. The bound is why PANEL_MIN_W is not a taste knob.
    expect(PANEL_MIN_W).toBeGreaterThan(PANEL_RADIUS * 2)
    expect(straightHalf(PANEL_MIN_W / 2, PANEL_RADIUS)).toBeGreaterThan(0)
  })
})

describe('the straight span — one threshold for every ring of the extrusion', () => {
  it('is the outline’s half-extent less its corner radius', () => {
    expect(straightHalf(160, 18)).toBe(142)
  })

  it('is the SAME for a ring the bevel pushed outward', () => {
    // An ExtrudeGeometry bevel offsets the outline along its normal, so
    // half-extent and radius both grow by the offset. If this ever
    // stopped holding, one threshold could not classify every ring and
    // corner vertices would be stretched like straight ones.
    const half = 160
    const r = 18
    for (const offset of [0, 3, 4.2, 12]) {
      expect(straightHalf(half + offset, r + offset)).toBeCloseTo(straightHalf(half, r), 12)
    }
  })

  it('never goes negative on a panel narrower than its own corners', () => {
    expect(straightHalf(10, 18)).toBe(0)
  })
})

describe('one coordinate, moved from the built size to the live size', () => {
  const SH = 142

  it('translates a corner rigidly', () => {
    // Two vertices of the same arc must keep their exact separation, or
    // the chamfer reads as an oval instead of a machined radius.
    const a = sliceCoord(150, SH, 40)
    const b = sliceCoord(158, SH, 40)
    expect(b - a).toBeCloseTo(8, 12)
    expect(a).toBeCloseTo(190, 12)
  })

  it('stretches the span between the corners', () => {
    expect(sliceCoord(SH, SH, 40)).toBeCloseTo(SH + 40, 12)
    expect(sliceCoord(0, SH, 40)).toBeCloseTo(0, 12)
    expect(sliceCoord(-SH, SH, 40)).toBeCloseTo(-(SH + 40), 12)
  })

  it('is continuous where the arc meets the span', () => {
    // A seam here would open a crack in the rim at four places.
    const inside = sliceCoord(SH - 1e-9, SH, 40)
    const outside = sliceCoord(SH + 1e-9, SH, 40)
    expect(Math.abs(outside - inside)).toBeLessThan(1e-6)
  })

  it('changes nothing when the size does not', () => {
    for (const v of [-200, -142, -50, 0, 50, 142, 200]) {
      expect(sliceCoord(v, SH, 0)).toBeCloseTo(v, 12)
    }
  })

  it('is symmetric about the middle', () => {
    expect(sliceCoord(-77, SH, 40)).toBeCloseTo(-sliceCoord(77, SH, 40), 12)
  })
})

describe('re-fitting a built extrusion — the rim follows without re-machining', () => {
  const W0 = 320
  const H0 = 600
  const R = PANEL_RADIUS

  /** A stand-in for the machined buffer: the four corner arcs, the four
   *  straight spans, and a second ring the way a bevel would leave one. */
  const build = (w: number, h: number, offset = 0): Float32Array => {
    const hw = w / 2 + offset
    const hh = h / 2 + offset
    const r = R + offset
    const pts: number[] = []
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2
      const sx = Math.cos(a) >= 0 ? 1 : -1
      const sy = Math.sin(a) >= 0 ? 1 : -1
      // A corner arc, then the straight spans it terminates.
      pts.push(sx * (hw - r) + Math.cos(a) * r, sy * (hh - r) + Math.sin(a) * r, 7)
    }
    for (let i = 0; i <= 8; i++) {
      const t = -1 + (i / 8) * 2
      pts.push(t * (hw - r), hh, 0, t * (hw - r), -hh, 14)
    }
    return new Float32Array(pts)
  }

  const extent = (a: Float32Array, axis: 0 | 1) => {
    let lo = Infinity
    let hi = -Infinity
    for (let i = axis; i < a.length; i += 3) {
      if (a[i] < lo) lo = a[i]
      if (a[i] > hi) hi = a[i]
    }
    return hi - lo
  }

  it('lands the outline exactly on the asked-for size', () => {
    const base = build(W0, H0)
    const out = new Float32Array(base.length)
    nineSlice(base, out, W0, H0, 480, 700)
    expect(extent(out, 0)).toBeCloseTo(480, 8)
    expect(extent(out, 1)).toBeCloseTo(700, 8)
  })

  it('carries a bevel ring to the same place as the outline it belongs to', () => {
    // The two rings must stay a constant offset apart, or the chamfer
    // widens on the long edges and pinches at the corners.
    const a = build(W0, H0, 0)
    const b = build(W0, H0, 4.2)
    const oa = new Float32Array(a.length)
    const ob = new Float32Array(b.length)
    nineSlice(a, oa, W0, H0, 512, 640)
    nineSlice(b, ob, W0, H0, 512, 640)
    // Tolerances here are float32's, not the law's: a position buffer
    // holds ~7 digits, so at a 256 px magnitude 1e-4 is the floor.
    expect(extent(ob, 0) - extent(oa, 0)).toBeCloseTo(8.4, 3)
    expect(extent(ob, 1) - extent(oa, 1)).toBeCloseTo(8.4, 3)
  })

  it('keeps every corner radius exactly as machined', () => {
    const base = build(W0, H0)
    const out = new Float32Array(base.length)
    nineSlice(base, out, W0, H0, 520, 420)
    // Arc samples that are corner samples on BOTH axes keep their
    // mutual distances exactly — that pair is what a rigid translation
    // has to preserve. (A vertex past the corner in x but inside the
    // span in y is on a straight edge, and is meant to stretch.)
    const shX = straightHalf(W0 / 2, R)
    const shY = straightHalf(H0 / 2, R)
    const corner = (i: number) => Math.abs(base[i]) > shX && Math.abs(base[i + 1]) > shY
    let checked = 0
    for (let i = 3; i < base.length; i += 3) {
      if (!corner(i) || !corner(i - 3)) continue
      const d0 = Math.hypot(base[i] - base[i - 3], base[i + 1] - base[i - 2])
      const d1 = Math.hypot(out[i] - out[i - 3], out[i + 1] - out[i - 2])
      expect(d1).toBeCloseTo(d0, 3)
      checked++
    }
    expect(checked).toBeGreaterThan(4)
  })

  it('leaves depth alone — aluminum does not get thinner because a panel got wider', () => {
    const base = build(W0, H0)
    const out = new Float32Array(base.length)
    nineSlice(base, out, W0, H0, 560, 300)
    for (let i = 2; i < base.length; i += 3) expect(out[i]).toBe(base[i])
  })

  it('is the identity at the size it was machined', () => {
    const base = build(W0, H0)
    const out = new Float32Array(base.length)
    nineSlice(base, out, W0, H0, W0, H0)
    for (let i = 0; i < base.length; i++) expect(out[i]).toBeCloseTo(base[i], 10)
  })

  it('does not compound: remapping always starts from the machined buffer', () => {
    const base = build(W0, H0)
    const once = new Float32Array(base.length)
    const twice = new Float32Array(base.length)
    nineSlice(base, once, W0, H0, 400, 500)
    nineSlice(base, twice, W0, H0, 400, 500)
    for (let i = 0; i < base.length; i++) expect(twice[i]).toBe(once[i])
  })

  it('holds at the narrowest width the drag can reach', () => {
    const base = build(W0, H0)
    const out = new Float32Array(base.length)
    nineSlice(base, out, W0, H0, PANEL_MIN_W, H0)
    expect(extent(out, 0)).toBeCloseTo(PANEL_MIN_W, 8)
    // No fold-through: the straight span kept its sign.
    expect(sliceCoord(straightHalf(W0 / 2, R), straightHalf(W0 / 2, R), (PANEL_MIN_W - W0) / 2)).toBeGreaterThan(0)
  })
})
