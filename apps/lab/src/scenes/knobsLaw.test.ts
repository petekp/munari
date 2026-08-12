import { describe, expect, it } from 'vitest'
import {
  ART_ANCHOR_FRACTION,
  ART_MAX_RADIUS,
  KNOBS_LAMPS,
  KNOBS_ROTARY,
  KNOBS_TOGGLES,
  KNOB_ANGLE_MIN,
  KNOB_ANGLE_SWEEP,
  OVERDRIVE_SPEED,
  type KnobsValues,
  artGlow,
  backlightAmount,
  generateArt,
  glowPoint,
  knobAngle,
  lampLit,
  slabOcclusion,
  stepFade,
  veilProfile,
} from './knobsLaw'

const DEFAULTS: KnobsValues = {
  hue: 210,
  palette: 150,
  layers: 5,
  complexity: 6,
  speed: 0.6,
  spread: 0.85,
  power: true,
  mirror: true,
}

function points(p: string): [number, number][] {
  return p
    .trim()
    .split(' ')
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number)
      return [x, y]
    })
}

describe('generateArt', () => {
  it('is a pure function of (values, t) — same inputs draw the same frame', () => {
    const a = generateArt(DEFAULTS, 12.5)
    const b = generateArt({ ...DEFAULTS }, 12.5)
    expect(a).toEqual(b)
  })

  it('draws a different frame once time advances (speed > 0)', () => {
    const a = generateArt(DEFAULTS, 0)
    const b = generateArt(DEFAULTS, 5)
    expect(a).not.toEqual(b)
  })

  it('clamps layers to [2, 8] regardless of an out-of-range knob value', () => {
    expect(generateArt({ ...DEFAULTS, layers: 0 }, 0).layers).toHaveLength(2)
    expect(generateArt({ ...DEFAULTS, layers: 3 }, 0).layers).toHaveLength(3)
    expect(generateArt({ ...DEFAULTS, layers: 99 }, 0).layers).toHaveLength(8)
  })

  it('clamps facet count to [3, 12] — every layer has that many drawn points', () => {
    for (const complexity of [0, 3, 7, 99]) {
      const scene = generateArt({ ...DEFAULTS, complexity }, 0)
      const expected = Math.max(3, Math.min(12, complexity))
      for (const layer of scene.layers) {
        expect(points(layer.points)).toHaveLength(expected)
      }
    }
  })

  it('never draws a point farther than ART_MAX_RADIUS from the origin, across the full knob ranges', () => {
    for (const hue of [0, 90, 210, 359]) {
      for (const layers of [2, 5, 8]) {
        for (const complexity of [3, 6, 12]) {
          for (const speed of [0, 1, 2]) {
            for (const spread of [0.4, 0.7, 1]) {
              for (const mirror of [true, false]) {
                const scene = generateArt(
                  { hue, palette: 150, layers, complexity, speed, spread, power: true, mirror },
                  3.7,
                )
                for (const layer of scene.layers) {
                  for (const [x, y] of points(layer.points)) {
                    expect(Number.isFinite(x)).toBe(true)
                    expect(Number.isFinite(y)).toBe(true)
                    expect(Math.hypot(x, y)).toBeLessThanOrEqual(ART_MAX_RADIUS + 0.01)
                  }
                }
              }
            }
          }
        }
      }
    }
  })

  it('produces valid, in-range hsl(a) colors for every layer and the backdrop', () => {
    const scene = generateArt(DEFAULTS, 8.25)
    const hueOf = (color: string) => Number(color.match(/hsla?\(([\d.]+)/)?.[1])
    for (const layer of scene.layers) {
      expect(layer.fill).toMatch(/^hsla\(/)
      expect(layer.stroke).toMatch(/^hsla\(/)
      expect(hueOf(layer.fill)).toBeGreaterThanOrEqual(0)
      expect(hueOf(layer.fill)).toBeLessThan(360)
      expect(layer.opacity).toBeGreaterThan(0)
      expect(layer.opacity).toBeLessThanOrEqual(1)
    }
    expect(scene.backdropFrom).toMatch(/^hsl\(/)
    expect(scene.backdropTo).toMatch(/^hsl\(/)
  })

  it('palette 0 paints every layer the base hue; a wide palette fans them out', () => {
    const hueOf = (fill: string) => Number(fill.match(/hsla\(([\d.]+)/)?.[1])
    const mono = generateArt({ ...DEFAULTS, palette: 0 }, 2.5)
    for (const layer of mono.layers) {
      expect(hueOf(layer.fill)).toBeCloseTo(DEFAULTS.hue)
    }
    const fanned = generateArt({ ...DEFAULTS, palette: 300 }, 2.5)
    const hues = new Set(fanned.layers.map((l) => hueOf(l.fill)))
    expect(hues.size).toBe(fanned.layers.length)
  })

  it('clamps palette to [0, 360] — an out-of-range knob value cannot fold the fan negative', () => {
    const under = generateArt({ ...DEFAULTS, palette: -90 }, 0)
    const zero = generateArt({ ...DEFAULTS, palette: 0 }, 0)
    expect(under).toEqual(zero)
    const over = generateArt({ ...DEFAULTS, palette: 900 }, 0)
    const full = generateArt({ ...DEFAULTS, palette: 360 }, 0)
    expect(over).toEqual(full)
  })

  it('wraps hue into [0, 360) even when the knob value is negative or huge', () => {
    for (const hue of [-30, 720, 359.5]) {
      const scene = generateArt({ ...DEFAULTS, hue }, 0)
      const first = scene.layers[0]
      const h = Number(first.fill.match(/hsla?\(([\d.]+)/)?.[1])
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(360)
    }
  })

  it('registers every KnobsValues numeric field as a rotary knob, and every boolean as a toggle', () => {
    expect(KNOBS_ROTARY.map((k) => k.key).sort()).toEqual(
      ['complexity', 'hue', 'layers', 'palette', 'speed', 'spread'].sort(),
    )
    expect(KNOBS_TOGGLES.map((k) => k.key).sort()).toEqual(['mirror', 'power'].sort())
    for (const k of KNOBS_ROTARY) {
      expect(k.min).toBeLessThan(k.max)
      expect(k.step).toBeGreaterThan(0)
    }
  })
})

describe('knobAngle', () => {
  const hue = KNOBS_ROTARY.find((k) => k.key === 'hue')!

  it('spans exactly the shared sweep: min value at one stop, max at the other', () => {
    expect(knobAngle(hue, hue.min)).toBeCloseTo(KNOB_ANGLE_MIN)
    expect(knobAngle(hue, hue.max)).toBeCloseTo(KNOB_ANGLE_MIN + KNOB_ANGLE_SWEEP)
  })

  it('points straight up at mid-travel', () => {
    expect(knobAngle(hue, (hue.min + hue.max) / 2)).toBeCloseTo(0)
  })

  it('clamps an out-of-range value to the physical stops', () => {
    expect(knobAngle(hue, hue.min - 100)).toBeCloseTo(KNOB_ANGLE_MIN)
    expect(knobAngle(hue, hue.max + 100)).toBeCloseTo(KNOB_ANGLE_MIN + KNOB_ANGLE_SWEEP)
  })
})

describe('lampLit — one annunciator law for both renderers', () => {
  const DEFAULTS: KnobsValues = {
    hue: 210,
    palette: 150,
    layers: 5,
    complexity: 6,
    speed: 0.6,
    spread: 0.85,
    power: true,
    mirror: true,
  }
  const lamp = (key: 'power' | 'drive' | 'mirror') => KNOBS_LAMPS.find((l) => l.key === key)!

  it('registers three lamps with distinct keys, tones and valid hex colors', () => {
    expect(KNOBS_LAMPS.map((l) => l.key).sort()).toEqual(['drive', 'mirror', 'power'])
    expect(new Set(KNOBS_LAMPS.map((l) => l.tone)).size).toBe(KNOBS_LAMPS.length)
    for (const l of KNOBS_LAMPS) expect(l.color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('the power and mirror lamps follow their switches', () => {
    expect(lampLit(lamp('power'), DEFAULTS)).toBe(true)
    expect(lampLit(lamp('power'), { ...DEFAULTS, power: false })).toBe(false)
    expect(lampLit(lamp('mirror'), DEFAULTS)).toBe(true)
    expect(lampLit(lamp('mirror'), { ...DEFAULTS, mirror: false })).toBe(false)
  })

  it('the drive lamp strikes exactly at the overdrive threshold', () => {
    expect(lampLit(lamp('drive'), { ...DEFAULTS, speed: OVERDRIVE_SPEED - 0.01 })).toBe(false)
    expect(lampLit(lamp('drive'), { ...DEFAULTS, speed: OVERDRIVE_SPEED })).toBe(true)
    expect(lampLit(lamp('drive'), { ...DEFAULTS, speed: 2 })).toBe(true)
  })
})

describe('stepFade — the picture dies dark, it does not blink off', () => {
  it('is pure and frame-rate independent — one 0.5s step equals thirty 1/60 steps', () => {
    let lit = 1
    for (let i = 0; i < 30; i++) lit = stepFade(lit, 0, 1 / 60)
    expect(lit).toBeCloseTo(stepFade(1, 0, 0.5), 9)
  })

  it('falls monotonically toward a dropped power switch', () => {
    let lit = 1
    let prev = lit
    for (let i = 0; i < 60; i++) {
      lit = stepFade(lit, 0, 1 / 60)
      expect(lit).toBeLessThan(prev)
      expect(lit).toBeGreaterThanOrEqual(0)
      prev = lit
    }
  })

  it('is effectively dark within a second and a half', () => {
    let lit = 1
    for (let i = 0; i < 90; i++) lit = stepFade(lit, 0, 1 / 60)
    expect(lit).toBeLessThan(0.02)
  })

  it('relights along the same curve', () => {
    let lit = 0
    for (let i = 0; i < 90; i++) lit = stepFade(lit, 1, 1 / 60)
    expect(lit).toBeGreaterThan(0.98)
  })
})

describe('slabOcclusion — a glint slides behind the slab, it does not snap', () => {
  const panel = { x: 0, y: 0, w: 320, h: 600 }

  it('is 1 deep behind the slab and 0 well clear of it', () => {
    expect(slabOcclusion(0, 0, panel)).toBe(1)
    expect(slabOcclusion(600, 0, panel)).toBe(0)
    expect(slabOcclusion(0, 800, panel)).toBe(0)
  })

  it('crosses one half exactly at the slab edge', () => {
    expect(slabOcclusion(160, 0, panel)).toBeCloseTo(0.5, 9)
    expect(slabOcclusion(0, 300, panel)).toBeCloseTo(0.5, 9)
  })

  it('ramps monotonically across the soft band', () => {
    let prev = slabOcclusion(120, 0, panel)
    for (const x of [140, 160, 180, 200]) {
      const occ = slabOcclusion(x, 0, panel)
      expect(occ).toBeLessThan(prev)
      prev = occ
    }
  })
})

describe('glowPoint — one orbit mapping for the light and its bloom', () => {
  const DEFAULTS: KnobsValues = {
    hue: 210,
    palette: 150,
    layers: 5,
    complexity: 6,
    speed: 0.6,
    spread: 0.85,
    power: true,
    mirror: true,
  }

  it('anchors the orbit left of viewport center', () => {
    const src = { hue: 0, angle: 0, reach: 0, weight: 0.5 }
    expect(glowPoint(src, 1000)).toEqual({ x: -100 + 90, y: 0 })
  })

  it('orbits wider as a layer reaches farther', () => {
    const near = glowPoint({ hue: 0, angle: 0, reach: 0.3, weight: 0.5 }, 1000)
    const far = glowPoint({ hue: 0, angle: 0, reach: 0.9, weight: 0.5 }, 1000)
    expect(far.x).toBeGreaterThan(near.x)
  })

  it('every default glint orbits within the art disc', () => {
    for (const t of [0, 1.7, 4.2]) {
      for (const src of artGlow(DEFAULTS, t)) {
        const p = glowPoint(src, 1440)
        expect(Math.hypot(p.x - 1440 * ART_ANCHOR_FRACTION, p.y)).toBeLessThanOrEqual(90 + 260)
      }
    }
  })
})

describe('backlightAmount — light the slab hides is light the scene loses', () => {
  const DEFAULTS: KnobsValues = {
    hue: 210,
    palette: 150,
    layers: 5,
    complexity: 6,
    speed: 0.6,
    spread: 0.85,
    power: true,
    mirror: true,
  }
  const VIEW_W = 1440
  const panel = (x: number, y = 0, w = 320, h = 600) => ({ x, y, w, h })

  it('is pure and stays in [0, 1]', () => {
    expect(backlightAmount(panel(100), DEFAULTS, 3.3, VIEW_W)).toBe(
      backlightAmount(panel(100), { ...DEFAULTS }, 3.3, VIEW_W),
    )
    for (const x of [-144, 0, 200, 500, 900]) {
      const b = backlightAmount(panel(x), DEFAULTS, 3.3, VIEW_W)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThanOrEqual(1)
    }
  })

  it('is zero with the slab clear of every glint', () => {
    expect(backlightAmount(panel(900), DEFAULTS, 0, VIEW_W)).toBe(0)
  })

  it("covering a glint blocks that glint's weight", () => {
    const outer = artGlow(DEFAULTS, 0)[0]
    const p = glowPoint(outer, VIEW_W)
    const level = backlightAmount(panel(p.x, p.y), DEFAULTS, 0, VIEW_W)
    expect(level).toBeGreaterThan(0.25)
  })

  it('falls monotonically as the slab slides off the glints', () => {
    const outer = artGlow(DEFAULTS, 0)[0]
    const p = glowPoint(outer, VIEW_W)
    const over = backlightAmount(panel(p.x, p.y), DEFAULTS, 0, VIEW_W)
    const edge = backlightAmount(panel(p.x + 150, p.y), DEFAULTS, 0, VIEW_W)
    const clear = backlightAmount(panel(p.x + 500, p.y), DEFAULTS, 0, VIEW_W)
    expect(over).toBeGreaterThan(edge)
    expect(edge).toBeGreaterThan(clear)
    expect(clear).toBe(0)
  })

  it('a brighter picture backlights a covering slab harder', () => {
    const cover = panel(VIEW_W * ART_ANCHOR_FRACTION, 0, 900, 900)
    const wide = backlightAmount(cover, { ...DEFAULTS, spread: 1, layers: 8 }, 0, VIEW_W)
    const thin = backlightAmount(cover, { ...DEFAULTS, spread: 0.4, layers: 2 }, 0, VIEW_W)
    expect(wide).toBeGreaterThan(thin)
    expect(wide).toBeGreaterThan(0.8)
  })
})

describe('artGlow — the picture and its light share one phase', () => {
  const DEFAULTS: KnobsValues = {
    hue: 210,
    palette: 150,
    layers: 5,
    complexity: 6,
    speed: 0.6,
    spread: 0.85,
    power: true,
    mirror: true,
  }

  it('is pure: same (values, t), same light', () => {
    expect(artGlow(DEFAULTS, 4.2)).toEqual(artGlow({ ...DEFAULTS }, 4.2))
  })

  it('casts up to three sources, never more than there are layers', () => {
    expect(artGlow(DEFAULTS, 0)).toHaveLength(3)
    expect(artGlow({ ...DEFAULTS, layers: 2 }, 0)).toHaveLength(2)
    expect(artGlow({ ...DEFAULTS, layers: 8 }, 0)).toHaveLength(3)
  })

  it('each source carries the hue its layer is drawn with', () => {
    const scene = generateArt(DEFAULTS, 2.5)
    const sources = artGlow(DEFAULTS, 2.5)
    const layerHue = (i: number) => Number(scene.layers[i].fill.match(/hsla\(([\d.]+)/)?.[1])
    // Outermost layer first.
    expect(sources[0].hue).toBeCloseTo(layerHue(scene.layers.length - 1), 0)
    expect(sources[1].hue).toBeCloseTo(layerHue(scene.layers.length - 2), 0)
  })

  it('orbits with time when the art spins, and freezes when speed is zero', () => {
    const early = artGlow(DEFAULTS, 1)
    const late = artGlow(DEFAULTS, 2)
    expect(late[0].angle).not.toBeCloseTo(early[0].angle)
    const still = artGlow({ ...DEFAULTS, speed: 0 }, 1)
    const stillLater = artGlow({ ...DEFAULTS, speed: 0 }, 9)
    expect(stillLater[0].angle).toBeCloseTo(still[0].angle)
  })

  it('keeps reach and weight in (0, 1] across the full knob ranges', () => {
    for (const layers of [2, 5, 8]) {
      for (const spread of [0.4, 0.7, 1]) {
        for (const src of artGlow({ ...DEFAULTS, layers, spread }, 3.3)) {
          expect(src.reach).toBeGreaterThan(0)
          expect(src.reach).toBeLessThanOrEqual(1)
          expect(src.weight).toBeGreaterThan(0)
          expect(src.weight).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})

describe('veilProfile — a falloff that can actually end', () => {
  it('starts at full strength and dies exactly at the end of its reach', () => {
    expect(veilProfile(0)).toBe(1)
    expect(veilProfile(1)).toBe(0)
    expect(veilProfile(1.5)).toBe(0)
    expect(veilProfile(-0.5)).toBe(1)
  })

  it('ends with zero slope — no Mach band where the support runs out', () => {
    const h = 1e-4
    const slopeAtEnd = (veilProfile(1) - veilProfile(1 - h)) / h
    expect(Math.abs(slopeAtEnd)).toBeLessThan(1e-3)
  })

  it('only ever falls', () => {
    let prev = veilProfile(0)
    for (let t = 0.05; t <= 1.001; t += 0.05) {
      const v = veilProfile(t)
      expect(v).toBeLessThanOrEqual(prev)
      prev = v
    }
  })
})
