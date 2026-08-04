// The instrument's own contract. An instrument nobody tests is a
// measurement nobody can cite, and this one has already convicted and
// exonerated real code — it has to be right about a blur before it is
// allowed to be right about a card.
import { describe, expect, it } from 'vitest'

import { gradientEnergy, luma, sharpnessRatio, type Picture } from './gradientEnergy'

/** A checkerboard of `cell`-sized squares: maximum edge energy. */
function checker(width: number, height: number, cell: number): Picture {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0
      const v = on ? 255 : 0
      const i = (y * width + x) * 4
      data[i] = data[i + 1] = data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return { data, width, height }
}

/** A 3×3 box blur — a low-pass, which is what every defect here is. */
function blur(pic: Picture): Picture {
  const out = new Uint8ClampedArray(pic.data.length)
  const px = (x: number, y: number, c: number) => {
    const cx = Math.min(pic.width - 1, Math.max(0, x))
    const cy = Math.min(pic.height - 1, Math.max(0, y))
    return pic.data[(cy * pic.width + cx) * 4 + c]
  }
  for (let y = 0; y < pic.height; y++) {
    for (let x = 0; x < pic.width; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) s += px(x + dx, y + dy, c) ?? 0
        out[(y * pic.width + x) * 4 + c] = s / 9
      }
      out[(y * pic.width + x) * 4 + 3] = 255
    }
  }
  return { data: out, width: pic.width, height: pic.height }
}

function flat(width: number, height: number, v: number): Picture {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v
  }
  return { data, width, height }
}

describe('luma', () => {
  it('is Rec. 709, so a hue change alone is not an edge', () => {
    expect(luma(255, 255, 255)).toBeCloseTo(255, 6)
    expect(luma(0, 0, 0)).toBe(0)
    expect(luma(0, 255, 0)).toBeGreaterThan(luma(255, 0, 0))
  })
})

describe('gradientEnergy', () => {
  it('is zero on a picture with nothing in it', () => {
    expect(gradientEnergy(flat(16, 16, 128))).toBe(0)
  })

  /** The whole premise: a low-pass takes energy away, monotonically. */
  it('falls under blur, which is the only thing it has to be right about', () => {
    const sharp = checker(32, 32, 4)
    const once = blur(sharp)
    const twice = blur(once)
    const a = gradientEnergy(sharp)
    const b = gradientEnergy(once)
    const c = gradientEnergy(twice)
    expect(b).toBeLessThan(a)
    expect(c).toBeLessThan(b)
  })

  it('reads the band it was given and not the picture around it', () => {
    // Half checkerboard, half flat. The instrument has to be able to say
    // "over THIS rect", because the live pill that is present in the DOM
    // and not yet in the mesh contaminated a whole-card ratio by more
    // than the defect being hunted.
    const pic = checker(32, 32, 2)
    for (let y = 0; y < 32; y++) {
      for (let x = 16; x < 32; x++) {
        const i = (y * 32 + x) * 4
        pic.data[i] = pic.data[i + 1] = pic.data[i + 2] = 128
      }
    }
    expect(gradientEnergy(pic, { x: 0, y: 0, width: 15, height: 32 })).toBeGreaterThan(0)
    expect(gradientEnergy(pic, { x: 17, y: 0, width: 14, height: 32 })).toBe(0)
  })

  it('is normalized, so two bands of different sizes are comparable', () => {
    // A one-pixel checker: every neighbouring pair is an edge, so the
    // per-difference mean is exactly the same whatever rect you take —
    // which is the property that lets a small card and a large one be
    // compared to their own DOM and then to each other.
    const pic = checker(64, 64, 1)
    const small = gradientEnergy(pic, { x: 8, y: 8, width: 16, height: 16 })
    const large = gradientEnergy(pic, { x: 8, y: 8, width: 48, height: 48 })
    expect(small).toBeCloseTo(large, 9)
  })

  it('clips a band that runs off the edge instead of reading zeros', () => {
    // A band derived from a page rect can overhang a canvas by a pixel
    // when dpr rounding disagrees. Reading the off-picture pixels as
    // black would invent edges at the boundary — a fake sharpening.
    const pic = checker(32, 32, 4)
    const inside = gradientEnergy(pic, { x: 0, y: 0, width: 32, height: 32 })
    const over = gradientEnergy(pic, { x: 0, y: 0, width: 64, height: 64 })
    expect(over).toBeCloseTo(inside, 6)
  })

  it('answers zero for a band too small to have a difference in it', () => {
    expect(gradientEnergy(checker(32, 32, 4), { x: 0, y: 0, width: 1, height: 8 })).toBe(0)
  })
})

describe('sharpnessRatio', () => {
  it('is 1 when the mesh is showing exactly what the page is', () => {
    const dom = checker(32, 32, 3)
    expect(sharpnessRatio({ ...dom }, dom).ratio).toBe(1)
  })

  it('is below 1 when the mesh is softer — the reportable direction', () => {
    const dom = checker(32, 32, 3)
    const r = sharpnessRatio(blur(dom), dom)
    expect(r.ratio).toBeLessThan(1)
    expect(r.mesh).toBeLessThan(r.dom)
  })

  /**
   * The live numbers this instrument was built out of. A route
   * transition's small endpoint, held at t = 0, typography band only:
   * DOM 900.90, mesh 758.02 before the phase fix (0.841), 902.19 after
   * (1.001). The pass floor sits between those two, which is the only
   * reason a floor is meaningful at all.
   */
  it('separates the two live readings it was built from', () => {
    const FLOOR = 0.93
    expect(758.02 / 900.9).toBeLessThan(FLOOR)
    expect(902.19 / 900.9).toBeGreaterThan(FLOOR)
  })

  /**
   * A reference with no edges is a broken measurement — the wrong rect,
   * or a capture taken before the page painted — and reporting infinite
   * sharpness for it would read as a spectacular pass.
   */
  it('refuses to divide by a reference that has no edges in it', () => {
    const r = sharpnessRatio(checker(16, 16, 2), flat(16, 16, 200))
    expect(Number.isNaN(r.ratio)).toBe(true)
  })

  it('carries the band it measured, so a report can say where it looked', () => {
    const band = { x: 4, y: 4, width: 8, height: 8 }
    expect(sharpnessRatio(checker(16, 16, 2), checker(16, 16, 2), band).band).toEqual(band)
  })
})
