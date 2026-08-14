import { describe, expect, it } from 'vitest'
import {
  ART_U,
  CAMERA_U,
  artPixel,
  envPixel,
  equirectUV,
  parseArtPoints,
  pathBounds,
  projectArtPolygon,
  projectViewportOutline,
} from './knobsEnvironment'

/** A 1440×900 glass, the art plane where the scene puts it. */
const W = 256
const H = 128
const DEPTH = 48
const VW = 1440
const VH = 900
/** The SVG letterbox: a −100..100 box into the shorter axis. */
const SCALE = Math.min(VW, VH) / 200

describe("the equirect mapping — three's own, so the paint lands where the shader looks", () => {
  it('puts the zenith at v = 1 and the nadir at v = 0', () => {
    expect(equirectUV(0, 1, 0).v).toBeCloseTo(1, 12)
    expect(equirectUV(0, -1, 0).v).toBeCloseTo(0, 12)
    expect(equirectUV(0, 0, -1).v).toBeCloseTo(0.5, 12)
  })

  it('puts the artwork dead astern at u = 0.25, and the camera at 0.75', () => {
    expect(equirectUV(0, 0, -1).u).toBeCloseTo(ART_U, 12)
    expect(equirectUV(0, 0, 1).u).toBeCloseTo(CAMERA_U, 12)
  })

  it('splits the sphere at ±x: the meridian is +x, the seam is −x', () => {
    expect(equirectUV(1, 0, 0).u).toBeCloseTo(0.5, 12)
    // −x is the wrap itself, 0 and 1 at once: cross it from the art's
    // side and u comes out near 0, from the camera's side near 1. The
    // artwork never reaches it — every art point has z strictly below
    // zero, which is the open half (0, 0.5).
    expect(equirectUV(-1, 0, -1e-9).u).toBeCloseTo(0, 6)
    expect(equirectUV(-1, 0, 1e-9).u).toBeCloseTo(1, 6)
  })

  it('does not care about the direction’s length', () => {
    expect(equirectUV(0, 300, -400)).toEqual(equirectUV(0, 3, -4))
  })

  it('flips into canvas rows: the zenith is row 0, because CanvasTexture uploads flipY', () => {
    expect(envPixel({ u: ART_U, v: 1 }, W, H)).toEqual({ x: W / 4, y: 0 })
    expect(envPixel({ u: ART_U, v: 0 }, W, H)).toEqual({ x: W / 4, y: H })
  })
})

describe('the law — the artwork may light only the hemisphere it stands in', () => {
  it('never paints on the viewer’s side, anywhere on the page, at any depth', () => {
    // The whole page, corner to corner, at depths from a hair behind the
    // slab to a room away. Not one sample may cross the meridian.
    for (const depth of [1, 14, 48, 200, 2000]) {
      for (let ix = -12; ix <= 12; ix++) {
        for (let iy = -12; iy <= 12; iy++) {
          const p = artPixel((ix / 12) * (VW / 2), (iy / 12) * (VH / 2), depth, W, H)
          expect(p.x).toBeGreaterThan(0)
          expect(p.x).toBeLessThan(W / 2)
        }
      }
    }
  })

  it('keeps a whole hemisphere between the artwork and the camera column', () => {
    // The nearest the picture can come to the direction a camera-facing
    // knob top samples is the ±x meridian — a quarter turn away.
    const far = artPixel(VW / 2, 0, 1, W, H)
    expect(CAMERA_U * W - far.x).toBeGreaterThan(W / 4 - 1)
  })

  it('lands the page’s center dead astern', () => {
    const p = artPixel(0, 0, DEPTH, W, H)
    expect(p.x).toBeCloseTo(ART_U * W, 10)
    expect(p.y).toBeCloseTo(H / 2, 10)
  })

  it('keeps up up: the top of the picture is the top of the room', () => {
    const above = artPixel(0, 300, DEPTH, W, H)
    const middle = artPixel(0, 0, DEPTH, W, H)
    const below = artPixel(0, -300, DEPTH, W, H)
    expect(above.y).toBeLessThan(middle.y)
    expect(middle.y).toBeLessThan(below.y)
  })

  it('mirrors left and right about the artwork’s own column', () => {
    const left = artPixel(-400, 120, DEPTH, W, H)
    const right = artPixel(400, 120, DEPTH, W, H)
    expect(ART_U * W - left.x).toBeCloseTo(right.x - ART_U * W, 10)
    expect(left.y).toBeCloseTo(right.y, 10)
  })

  it('spreads the near picture wide and the far picture narrow', () => {
    // A plane a hair behind the slab fills its hemisphere; the same
    // plane a room away shrinks to a patch. Both are correct, and the
    // reflection should change with it.
    const near = artPixel(200, 0, 4, W, H).x - ART_U * W
    const far = artPixel(200, 0, 900, W, H).x - ART_U * W
    expect(near).toBeGreaterThan(far * 4)
  })
})

describe('projection — a straight edge on the plane is a curve through the room', () => {
  it('subdivides every edge, and returns the samples in order', () => {
    const square: [number, number][] = [
      [-50, -50],
      [50, -50],
      [50, 50],
      [-50, 50],
    ]
    expect(projectArtPolygon(square, SCALE, DEPTH, W, H, 6)).toHaveLength(24)
    expect(projectArtPolygon(square, SCALE, DEPTH, W, H, 1)).toHaveLength(4)
  })

  it('the curve is worth paying for — the chord misses badly', () => {
    // One edge of a facet, projected two ways: as a straight line
    // between its endpoints, and through the plane. If the two agreed,
    // subdivision would be waste; the gap is why it is not.
    const edge: [number, number][] = [
      [-90, 0],
      [90, 0],
    ]
    const fine = projectArtPolygon(edge, SCALE, DEPTH, W, H, 64)
    const a = fine[0]
    const b = fine[32]
    const mid = fine[16]
    const chordX = (a.x + b.x) / 2
    expect(Math.abs(mid.x - chordX)).toBeGreaterThan(W * 0.02)
  })

  it('holds the law along every subdivided edge, not just at the corners', () => {
    const wide: [number, number][] = [
      [-100, -100],
      [100, -100],
      [100, 100],
      [-100, 100],
    ]
    for (const p of projectArtPolygon(wide, SCALE, 6, W, H, 32)) {
      expect(p.x).toBeGreaterThan(0)
      expect(p.x).toBeLessThan(W / 2)
    }
  })

  it('declines a degenerate polygon rather than drawing a spike', () => {
    expect(projectArtPolygon([], SCALE, DEPTH, W, H)).toEqual([])
    expect(projectArtPolygon([[0, 0]], SCALE, DEPTH, W, H)).toEqual([])
  })

  it('reads the art’s own points format, and drops what it cannot parse', () => {
    expect(parseArtPoints('1,2 3,4')).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(parseArtPoints('1,2  ,, 3,4 nope')).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(parseArtPoints('')).toEqual([])
  })
})

describe('the picture is a window, not a wall', () => {
  const outline = projectViewportOutline(VW, VH, DEPTH, W, H)

  it('stops inside its own hemisphere on every side', () => {
    const b = pathBounds(outline)
    expect(b.minX).toBeGreaterThan(0)
    expect(b.maxX).toBeLessThan(W / 2)
    expect(b.minY).toBeGreaterThan(0)
    expect(b.maxY).toBeLessThan(H)
  })

  it('leaves the poles to the room — the page has no ceiling', () => {
    // A viewport-sized page 48px away reaches high, but the zenith
    // itself belongs to the overhead the bake paints separately.
    const b = pathBounds(outline)
    expect(b.minY).toBeGreaterThan(H * 0.01)
  })

  it('is a closed ring of samples, four edges deep', () => {
    expect(projectViewportOutline(VW, VH, DEPTH, W, H, 10)).toHaveLength(40)
  })

  it('a page far enough away is a patch, not a hemisphere', () => {
    const b = pathBounds(projectViewportOutline(VW, VH, 4000, W, H))
    expect(b.maxX - b.minX).toBeLessThan(W * 0.12)
  })
})
