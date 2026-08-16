import { describe, expect, it } from 'vitest'
import {
  apertureOf,
  curvatureFor,
  footprint,
  inAperture,
  landOffset,
  lensNormal,
  magnification,
  refract,
  type LensSpec,
  type Vec3,
} from './opticsLaw'

// The loupe as it ships: ~1.65× at the axis, hard nonlinearity at the rim.
const LOUPE: LensSpec = { aperture: 90, curvature: 130, standoff: 150, ior: 1.52 }
// The same instrument with one sign flipped.
const REDUCER: LensSpec = { ...LOUPE, curvature: -130 }

const DOWN: Vec3 = [0, 0, -1]
const ortho = () => DOWN

const len = (p: [number, number]) => Math.hypot(p[0], p[1])
const land = (r: number, spec: LensSpec, i: (lx: number, ly: number) => Vec3 = ortho) => {
  const p = landOffset(r, 0, i(r, 0), spec)
  if (!p) throw new Error(`no landing at r=${r}`)
  return p
}

describe('refract — GLSL semantics, transcribed', () => {
  it('passes a normal-incidence ray straight through, at any index', () => {
    for (const ior of [1, 1.33, 1.52, 2.4]) {
      expect(refract(DOWN, [0, 0, 1], 1 / ior)).toEqual([0, 0, -1])
    }
  })

  it('obeys Snell: 30° into n=1.5 leaves at sin θ = 1/3', () => {
    const i: Vec3 = [Math.sin(Math.PI / 6), 0, -Math.cos(Math.PI / 6)]
    const rd = refract(i, [0, 0, 1], 1 / 1.5)!
    expect(rd[0]).toBeCloseTo(1 / 3, 12)
    expect(Math.hypot(...rd)).toBeCloseTo(1, 12)
  })

  it('returns null on total internal reflection', () => {
    // Dense to light at 60°: eta·sin θ exceeds 1 and there is no exit ray.
    const i: Vec3 = [Math.sin(Math.PI / 3), 0, -Math.cos(Math.PI / 3)]
    expect(refract(i, [0, 0, 1], 1.5)).toBeNull()
  })
})

describe('lensNormal — the curved face', () => {
  it('is straight up on the axis, whatever the curvature', () => {
    for (const c of [130, -130, 40, Infinity]) {
      const n = lensNormal(0, 0, c)
      expect(Math.abs(n[0])).toBe(0)
      expect(Math.abs(n[1])).toBe(0)
      expect(n[2]).toBe(1)
    }
  })

  it('tilts outward on a convex face and inward on a concave one', () => {
    const convex = lensNormal(50, 0, 130)
    const concave = lensNormal(50, 0, -130)
    expect(convex[0]).toBeGreaterThan(0)
    expect(concave[0]).toBe(-convex[0])
    // Same face, opposite sign — the two instruments share one formula.
    expect(concave[2]).toBe(convex[2])
  })

  it('is unit length everywhere inside the aperture', () => {
    for (let r = 0; r <= LOUPE.aperture; r += 7.5) {
      expect(Math.hypot(...lensNormal(r, 0, LOUPE.curvature))).toBeCloseTo(1, 12)
    }
  })

  it('clamps rather than producing NaN when the aperture exceeds the curvature', () => {
    const n = lensNormal(200, 0, 130)
    expect(n.every(Number.isFinite)).toBe(true)
  })
})

describe('landOffset — where a ray through the glass reaches the page', () => {
  it('leaves the axis exactly where it found it', () => {
    expect(landOffset(0, 0, DOWN, LOUPE)).toEqual([0, 0])
    expect(landOffset(0, 0, DOWN, REDUCER)).toEqual([0, 0])
  })

  it('declines anything outside the aperture', () => {
    expect(landOffset(LOUPE.aperture + 0.01, 0, DOWN, LOUPE)).toBeNull()
    expect(landOffset(64, 64, DOWN, LOUPE)).toBeNull() // r ≈ 90.5
  })

  it('is a plain projection when the glass is a window (ior 1)', () => {
    const window: LensSpec = { ...LOUPE, ior: 1 }
    expect(landOffset(30, -20, DOWN, window)).toEqual([30, -20])
    // …including under a tilted eye, where the offset is pure parallax:
    // standoff × the ray's run over its rise.
    const tilted: Vec3 = [0.6, 0, -0.8]
    const p = landOffset(0, 0, tilted, window)!
    expect(p[0]).toBeCloseTo((window.standoff * 0.6) / 0.8, 12)
  })

  it('pulls the page inward under a convex face — it magnifies', () => {
    for (const r of [10, 30, 60, 89]) expect(len(land(r, LOUPE))).toBeLessThan(r)
  })

  it('pushes the page outward under a concave face — it reduces', () => {
    for (const r of [10, 30, 60, 89]) expect(len(land(r, REDUCER))).toBeGreaterThan(r)
  })

  it('is radial: no swirl, no astigmatism, under a straight-down eye', () => {
    const p = landOffset(40, 30, DOWN, LOUPE)!
    // Parallel to (40, 30) means the cross product vanishes.
    expect(p[0] * 30 - p[1] * 40).toBeCloseTo(0, 12)
    expect(p[0]).toBeGreaterThan(0)
  })

  it('is monotone in radius, so the rim bounds the footprint', () => {
    let prev = -1
    for (let r = 0; r <= 89; r += 1) {
      const d = len(land(r, LOUPE))
      expect(d).toBeGreaterThan(prev)
      prev = d
    }
  })
})

describe('magnification — the closed form agrees with the ray trace', () => {
  it('matches the paraxial limit at the axis', () => {
    for (const spec of [LOUPE, REDUCER]) {
      const probe = 1e-3
      const traced = probe / len(land(probe, spec))
      expect(traced).toBeCloseTo(magnification(spec), 9)
    }
  })

  it('reads above 1 for the loupe and below 1 for the reducer', () => {
    expect(magnification(LOUPE)).toBeCloseTo(1.652174, 6)
    expect(magnification(REDUCER)).toBeCloseTo(0.716981, 6)
  })

  it('is exactly 1 for a flat face, which is what the scope looks through', () => {
    expect(magnification({ ...LOUPE, curvature: Infinity })).toBe(1)
    expect(landOffset(45, 12, DOWN, { ...LOUPE, curvature: Infinity })).toEqual([45, 12])
  })

  it('round-trips through curvatureFor — a collar sets a radius, not a number', () => {
    for (const power of [0.4, 0.75, 1.2, 2, 4]) {
      const c = curvatureFor(power, LOUPE.standoff, LOUPE.ior)
      expect(magnification({ ...LOUPE, curvature: c })).toBeCloseTo(power, 9)
    }
  })
})

describe('footprint — the patch of page an instrument is reading', () => {
  it('is smaller than the aperture for a magnifier, larger for a reducer', () => {
    const at = { x: 0, y: 0 }
    expect(footprint(at, LOUPE, ortho).r).toBeLessThan(LOUPE.aperture)
    expect(footprint(at, REDUCER, ortho).r).toBeGreaterThan(REDUCER.aperture)
  })

  it('lands on the rim exactly, because the radial map is monotone', () => {
    const f = footprint({ x: 0, y: 0 }, LOUPE, ortho, 64)
    expect(f.r).toBeCloseTo(len(land(LOUPE.aperture * 0.999, LOUPE)), 6)
  })

  it('stays centred on the axis under a straight-down eye', () => {
    const f = footprint({ x: 400, y: 250 }, LOUPE, ortho, 64)
    expect(f.x).toBeCloseTo(400, 9)
    expect(f.y).toBeCloseTo(250, 9)
  })

  it('slides downstream under a tilted eye — the parallax the shader also sees', () => {
    const tilted = (): Vec3 => [0.35, 0, -Math.sqrt(1 - 0.35 * 0.35)]
    const f = footprint({ x: 0, y: 0 }, LOUPE, tilted, 64)
    expect(f.x).toBeGreaterThan(20)
    expect(f.y).toBeCloseTo(0, 6)
  })

  it('never reports a disc the glass can see past', () => {
    // Sixteen rim samples bound a monotone radial map; check against a much
    // denser sweep, since the offscreen framing and the LOD policy both
    // trust this number and a miss would sample an unpinned block.
    const spec = { ...LOUPE, curvature: 110 }
    const coarse = footprint({ x: 0, y: 0 }, spec, ortho, 16)
    for (let i = 0; i < 512; i++) {
      const a = (i / 512) * Math.PI * 2
      const p = landOffset(
        Math.cos(a) * spec.aperture * 0.999,
        Math.sin(a) * spec.aperture * 0.999,
        DOWN,
        spec,
      )!
      expect(Math.hypot(p[0] - coarse.x, p[1] - coarse.y)).toBeLessThanOrEqual(coarse.r + 1e-9)
    }
  })
})

// ── the rectangular face ───────────────────────────────────────────────
//
// The free sheet cuts the same cap to a rectangle. Everything above still
// holds along any radius; what is new is that the edge is no longer one
// distance from the axis, so the corner is what strains the cap and what
// bounds the footprint.

const SHEET: LensSpec = {
  half: [150, 90],
  aperture: apertureOf([150, 90]),
  curvature: 520,
  standoff: 460,
  ior: 1.52,
}

describe('a rectangular face — the same cap, a different cookie-cutter', () => {
  it('measures its aperture to the corner, not to an edge', () => {
    expect(SHEET.aperture).toBeCloseTo(Math.hypot(150, 90), 9)
    expect(SHEET.aperture).toBeGreaterThan(150)
  })

  it('accepts the rectangle and refuses everything outside it', () => {
    expect(inAperture(0, 0, SHEET)).toBe(true)
    expect(inAperture(149, 89, SHEET)).toBe(true)
    // Inside the bounding disc but off the glass — the case a disc test
    // would wave through, and the reason `inAperture` exists.
    expect(inAperture(100, 95, SHEET)).toBe(false)
    expect(Math.hypot(100, 95)).toBeLessThan(SHEET.aperture)
    expect(landOffset(100, 95, DOWN, SHEET)).toBeNull()
  })

  it('refracts a corner harder than an edge midpoint, because it is further out', () => {
    const edge = len(land(150, SHEET))
    const corner = landOffset(150, 90, DOWN, SHEET)!
    expect(len(corner)).toBeGreaterThan(edge)
  })

  it('is a plain rectangular window when the face is flat', () => {
    const flat: LensSpec = { ...SHEET, curvature: Infinity }
    expect(landOffset(120, -70, DOWN, flat)).toEqual([120, -70])
    expect(landOffset(120, 95, DOWN, flat)).toBeNull()
  })

  it('never reports a disc the sheet can see past', () => {
    // The same guarantee the disc instruments get, swept along the real
    // perimeter — corners included, since that is where a uniform walk of
    // the edge would come up short.
    const coarse = footprint({ x: 0, y: 0 }, SHEET, ortho, 16)
    const [hw, hh] = [150, 90]
    for (let i = 0; i < 512; i++) {
      const t = (i / 512) * 4
      const [lx, ly] =
        t < 1 ? [-hw + 2 * hw * t, -hh]
        : t < 2 ? [hw, -hh + 2 * hh * (t - 1)]
        : t < 3 ? [hw - 2 * hw * (t - 2), hh]
        : [-hw, hh - 2 * hh * (t - 3)]
      const p = landOffset(lx, ly, DOWN, SHEET)!
      expect(Math.hypot(p[0] - coarse.x, p[1] - coarse.y)).toBeLessThanOrEqual(coarse.r + 1e-9)
    }
  })

  it('bounds the whole face, not just its edge', () => {
    // The interior is what the glass actually shows. The map is radial and
    // monotone, so the edge bounds it — this is the check that says so.
    const coarse = footprint({ x: 0, y: 0 }, SHEET, ortho, 16)
    for (let i = 0; i <= 24; i++) {
      for (let j = 0; j <= 24; j++) {
        const lx = -150 + (300 * i) / 24
        const ly = -90 + (180 * j) / 24
        const p = landOffset(lx, ly, DOWN, SHEET)
        if (!p) continue
        expect(Math.hypot(p[0] - coarse.x, p[1] - coarse.y)).toBeLessThanOrEqual(coarse.r + 1e-9)
      }
    }
  })
})
