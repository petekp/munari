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
  ROOM_SAMPLE,
  roomCover,
  roomLight,
  solidAngleField,
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

describe('the room bounce is measured by area, not by angle', () => {
  // The load-bearing measurement. It is the reason `roomLight` takes a
  // FLAT raster of the picture and not the equirect the scene already
  // has in hand — which was the obvious thing to do, and wrong.
  it('the equirect magnifies the picture center, so it cannot be the space the color is averaged in', () => {
    const R = 102 // the outermost blade, art units
    let inner = 0
    let total = 0
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W / 2; px++) {
        const theta = ((px + 0.5) / W - 0.5) * 2 * Math.PI
        const phi = ((py + 0.5) / H - 0.5) * Math.PI
        const dz = Math.cos(phi) * Math.sin(theta)
        if (dz >= 0) continue // the plane stands at −z
        const t = -DEPTH / dz
        const x = ((Math.cos(phi) * Math.cos(theta)) * t) / SCALE
        const y = (Math.sin(phi) * t) / SCALE
        const rho = Math.hypot(x, y)
        if (rho > R) continue
        if (Math.abs(x * SCALE) > VW / 2 || Math.abs(y * SCALE) > VH / 2) continue
        total++
        if (rho <= R / 2) inner++
      }
    }
    // Half the radius is a quarter of the picture. In the equirect it is
    // five sixths of the pixels — a 3.3x over-count of the middle, which
    // is what made the bounce come out the color of the center.
    expect(inner / total).toBeGreaterThan(0.8)
    expect(inner / total).toBeLessThan(0.87)
    expect(inner / total / 0.25).toBeGreaterThan(3)
  })
})

describe('roomLight — the color a picture throws', () => {
  /** A flat RGBA raster: a field, with a square patch at its center. */
  function raster(
    field: [number, number, number],
    patch: [number, number, number],
    patchSide: number,
    side = ROOM_SAMPLE,
  ): Uint8ClampedArray {
    const px = new Uint8ClampedArray(side * side * 4)
    const lo = Math.round((side - patchSide) / 2)
    const hi = lo + patchSide
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const inPatch = x >= lo && x < hi && y >= lo && y < hi
        const c = inPatch ? patch : field
        const i = (y * side + x) * 4
        px[i] = c[0]
        px[i + 1] = c[1]
        px[i + 2] = c[2]
        px[i + 3] = 255
      }
    }
    return px
  }

  it('one flat color bounces itself back', () => {
    const { r, g, b } = roomLight(raster([180, 60, 200], [180, 60, 200], 0))
    expect(r).toBeCloseTo(180 / 255, 5)
    expect(g).toBeCloseTo(60 / 255, 5)
    expect(b).toBeCloseTo(200 / 255, 5)
  })

  it('an empty picture throws no light', () => {
    expect(roomLight(new Uint8ClampedArray(ROOM_SAMPLE * ROOM_SAMPLE * 4))).toEqual({
      r: 0,
      g: 0,
      b: 0,
    })
  })

  it('a bright speck at the center cannot outvote the field around it', () => {
    // This is the whole complaint, as a test. The innermost blades are a
    // few percent of the picture and they are the LIGHTEST ones the
    // palette draws, so brightness alone must not hand them the room.
    const px = raster([170, 40, 30], [250, 250, 255], 4) // patch is 1.6% of the area
    const { r, g, b } = roomLight(px)
    expect(r).toBeGreaterThan(g * 2)
    expect(r).toBeGreaterThan(b * 2)
  })

  it('but a brighter region does count for more than its area', () => {
    // Weighting by cover alone would make these two identical. Light is
    // not paint: the bright half throws more of it.
    const dim = roomLight(raster([120, 0, 0], [0, 0, 120], 22))
    const lit = roomLight(raster([120, 0, 0], [0, 0, 250], 22))
    expect(lit.b / lit.r).toBeGreaterThan(dim.b / dim.r)
  })

  it('opposed hues do not average to gray', () => {
    // A complementary palette is half the point of the wide schemes. A
    // plain RGB mean of red against cyan is a neutral, which is the one
    // answer that cannot be right.
    const px = raster([200, 40, 40], [40, 200, 200], 22)
    const { r, g, b } = roomLight(px)
    const mx = Math.max(r, g, b)
    const sat = (mx - Math.min(r, g, b)) / mx
    expect(sat).toBeGreaterThan(0.5)
  })

  it('never invents chroma a flat picture did not have', () => {
    // The restoration only ever pushes UP to the mean saturation of the
    // texels. A gray picture stays gray.
    const { r, g, b } = roomLight(raster([90, 90, 90], [200, 200, 200], 10))
    expect(r).toBeCloseTo(g, 6)
    expect(g).toBeCloseTo(b, 6)
  })

  it('ignores what the picture does not cover', () => {
    const px = raster([200, 40, 40], [0, 0, 0], 0)
    for (let i = 0; i < px.length; i += 8) px[i + 3] = 0 // punch half of it out
    const { r, g, b } = roomLight(px)
    expect(r).toBeCloseTo(200 / 255, 5)
    expect(g).toBeCloseTo(40 / 255, 5)
    expect(b).toBeCloseTo(40 / 255, 5)
  })
})

describe('how much of the room the picture fills', () => {
  const field = solidAngleField(VW, VH, DEPTH)
  const full = new Uint8ClampedArray(ROOM_SAMPLE * ROOM_SAMPLE * 4).fill(255)

  it('a page this close fills most of its hemisphere', () => {
    // 1440x900 standing 48 px behind the slab: 0.918 of the half-sphere.
    // The readback this replaced said 1.0000 against a true 0.8137 — a
    // 1x1 drawImage downscale samples the middle, it does not average.
    expect(roomCover(full, field)).toBeCloseTo(0.918, 2)
  })

  it('the middle of the page subtends more than its corner', () => {
    // The same fact that made the equirect the wrong place to average a
    // COLOR makes it the right shape for a coverage weight.
    const n = ROOM_SAMPLE
    const mid = field[(n / 2) * n + n / 2]
    expect(mid).toBeGreaterThan(field[0] * 5)
  })

  it('a page pushed further back fills less of the room', () => {
    const near = roomCover(full, solidAngleField(VW, VH, DEPTH))
    const far = roomCover(full, solidAngleField(VW, VH, DEPTH * 6))
    expect(far).toBeLessThan(near)
    expect(far).toBeGreaterThan(0)
  })

  it('an unpainted picture fills nothing, and a half-painted one half', () => {
    expect(roomCover(new Uint8ClampedArray(ROOM_SAMPLE * ROOM_SAMPLE * 4), field)).toBe(0)
    const half = new Uint8ClampedArray(full)
    for (let i = 3; i < half.length; i += 4) half[i] = 128
    expect(roomCover(half, field)).toBeCloseTo(roomCover(full, field) * (128 / 255), 3)
  })

  it('never reports more room than there is', () => {
    // A fraction cannot exceed 1, and a bounce scaled by one that did
    // would blow past the tuned brightness.
    const over = new Float32Array(ROOM_SAMPLE * ROOM_SAMPLE).fill(1)
    expect(roomCover(full, over)).toBe(1)
  })

  it('32 texels a side already resolves the page', () => {
    // The weights are a quadrature, and a quadrature too coarse for its
    // integrand quietly reports a smaller room than there is. At the
    // scene's own geometry 32 lands within a third of a percent of a
    // grid eight times finer, which is what makes ROOM_SAMPLE safe to
    // share with the color raster.
    const total = (f: Float32Array) => f.reduce((a, b) => a + b, 0)
    const coarse = total(solidAngleField(VW, VH, DEPTH, ROOM_SAMPLE))
    const fine = total(solidAngleField(VW, VH, DEPTH, ROOM_SAMPLE * 8))
    expect(Math.abs(coarse - fine) / fine).toBeLessThan(0.01)
  })
})
