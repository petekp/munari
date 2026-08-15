import { describe, expect, it } from 'vitest'
import {
  ART_ANCHOR_FRACTION,
  ART_MAX_LAYERS,
  ART_MAX_RADIUS,
  DIAL_TICK_MAX,
  KNOBS_FIXED,
  KNOBS_LAMPS,
  KNOBS_ROTARY,
  KNOBS_TOGGLES,
  KNOB_ANGLE_MIN,
  KNOB_ANGLE_SWEEP,
  PALETTE_SCHEMES,
  type KnobsValues,
  type PaletteScheme,
  artGlow,
  backlightAmount,
  dialTicks,
  generateArt,
  glowPoint,
  knobAngle,
  lampLit,
  litGate,
  slabOcclusion,
  stepFade,
  veilProfile,
} from './knobsLaw'
import { knobsTuning } from './knobsTuning'

const DEFAULTS: KnobsValues = {
  hue: 210,
  palette: 4,
  chroma: 0.85,
  layers: 10,
  complexity: 20,
  speed: 1.5,
  spread: 0.85,
  power: true,
  mirror: true,
}

/**
 * The brightest channel of an `hsl()`/`hsla()` color, over `under` —
 * exactly what the corona's shader measures. The art law hands out CSS
 * colors, the bake fills a canvas with them at their own alpha, and the
 * shader reads the bytes back with no colour-space decode, so this is
 * the same number `max(spill.r, spill.g, spill.b)` sees.
 */
function levelOf(color: string, under = 0): number {
  const m = color.match(/hsla?\(([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%(?:,\s*([\d.]+))?/)!
  const [h, s, l] = [Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100]
  const a = m[4] === undefined ? 1 : Number(m[4])
  const chroma = s * Math.min(l, 1 - l)
  const at = (n: number) => {
    const k = (n + h / 30) % 12
    return l - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return a * Math.max(at(0), at(8), at(4)) + (1 - a) * under
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

  it('clamps layers to [2, 16] regardless of an out-of-range knob value', () => {
    expect(generateArt({ ...DEFAULTS, layers: 0 }, 0).layers).toHaveLength(2)
    expect(generateArt({ ...DEFAULTS, layers: 3 }, 0).layers).toHaveLength(3)
    expect(generateArt({ ...DEFAULTS, layers: 99 }, 0).layers).toHaveLength(16)
  })

  // The ceiling is also the count of `<polygon>` elements KnobsArt
  // pre-mounts, and a picture with more layers than elements would drop
  // its outermost rings silently.
  it('never asks for more layers than a consumer pre-mounts', () => {
    expect(generateArt({ ...DEFAULTS, layers: 999 }, 0).layers.length).toBeLessThanOrEqual(
      ART_MAX_LAYERS,
    )
  })

  it('clamps facet count to [6, 24] — every layer has that many drawn points', () => {
    for (const complexity of [0, 6, 7, 99]) {
      const scene = generateArt({ ...DEFAULTS, complexity }, 0)
      const expected = Math.max(6, Math.min(24, complexity))
      for (const layer of scene.layers) {
        expect(points(layer.points)).toHaveLength(expected)
      }
    }
  })

  // The array IS the stacking: both consumers draw it straight through,
  // so a regression here silently buries the small bright cores under
  // the big translucent rings.
  it('returns layers in paint order, widest first', () => {
    const scene = generateArt({ ...DEFAULTS, layers: 6, mirror: false }, 0)
    const reach = scene.layers.map((l) => Math.max(...points(l.points).map(([x, y]) => Math.hypot(x, y))))
    for (let i = 1; i < reach.length; i++) expect(reach[i]).toBeLessThan(reach[i - 1])
  })

  it('never draws a point farther than ART_MAX_RADIUS from the origin, across the full knob ranges', () => {
    for (const hue of [0, 90, 210, 359]) {
      for (const layers of [2, 8, 16]) {
        for (const complexity of [6, 12, 24]) {
          for (const speed of [0, 1, 2]) {
            // `spread` has no dial any more (KNOBS_FIXED), but it is
            // still a parameter of the law, so the sweep still covers it.
            for (const spread of [0.4, 0.7, 1]) {
              for (const mirror of [true, false]) {
                const scene = generateArt(
                  { hue, palette: 4, chroma: 0.85, layers, complexity, speed, spread, power: true, mirror },
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

  const hueOf = (color: string) => Number(color.match(/hsla?\(([\d.]+)/)?.[1])
  const schemeIndex = (key: PaletteScheme['key']) =>
    PALETTE_SCHEMES.findIndex((s) => s.key === key)

  it('chroma 0 paints every layer the base hue, whatever scheme is selected', () => {
    for (let palette = 0; palette < PALETTE_SCHEMES.length; palette++) {
      const scene = generateArt({ ...DEFAULTS, palette, chroma: 0 }, 2.5)
      for (const layer of scene.layers) {
        expect(hueOf(layer.fill)).toBeCloseTo(DEFAULTS.hue)
        // The outline collapses onto the fill too — that is what
        // monochromatic means. It still reads, on lightness.
        expect(hueOf(layer.stroke)).toBeCloseTo(DEFAULTS.hue)
      }
    }
  })

  // Chroma 0 is the only monochrome. The mono SCHEME is monochrome at
  // every chroma, because it has one stop to open toward.
  it('the mono scheme stays one hue however far chroma is opened', () => {
    for (const chroma of [0, 0.5, 1]) {
      const scene = generateArt({ ...DEFAULTS, palette: schemeIndex('mono'), chroma }, 2.5)
      for (const layer of scene.layers) expect(hueOf(layer.fill)).toBeCloseTo(DEFAULTS.hue)
    }
  })

  it('opens each harmony onto its own stops at full chroma', () => {
    const at = (key: PaletteScheme['key'], layers: number) =>
      generateArt({ ...DEFAULTS, palette: schemeIndex(key), chroma: 1, layers }, 0).layers
        // Paint order is widest-first, so read it back inward-out.
        .map((l) => hueOf(l.fill))
        .reverse()
    // Offsets from the base hue of 210, wrapped.
    expect(at('complement', 2)).toEqual([210, 30])
    expect(at('triad', 3)).toEqual([210, 330, 90])
    expect(at('tetrad', 4)).toEqual([210, 300, 30, 120])
    // Fewer stops than layers REPEATS the stops rather than inventing
    // hues between them — a triad has three colors at five layers.
    expect(new Set(at('triad', 5)).size).toBe(3)
    // An analogous scheme is a neighbourhood around the dial's hue, so
    // the base sits in the middle of it and the run is monotone.
    expect(at('analogous', 5)).toEqual([150, 180, 210, 240, 270])
  })

  // The stripe law. A harmony handed out ring-by-ring puts its full
  // separation between every pair of touching layers, and at any real
  // layer count that reads as a barcode rather than as a harmony. Each
  // stop gets a contiguous run instead.
  it('gives each stop one unbroken run of layers, however many layers there are', () => {
    for (const key of ['complement', 'split', 'triad', 'tetrad', 'analogous'] as const) {
      const stops = PALETTE_SCHEMES.find((s) => s.key === key)!.offsets!.length
      for (const layers of [8, 12, 16]) {
        const hues = generateArt({ ...DEFAULTS, palette: schemeIndex(key), chroma: 1, layers }, 0)
          .layers.map((l) => hueOf(l.fill))
          .reverse()
        // Every stop still appears — a run per stop, none skipped.
        expect(new Set(hues).size).toBe(stops)
        // And the hue changes exactly (stops - 1) times. Alternation
        // would change it on nearly every boundary instead.
        const changes = hues.filter((hue, i) => i > 0 && hue !== hues[i - 1]).length
        expect(changes).toBe(stops - 1)
      }
    }
  })

  it('never paints a hue the scheme does not name — runs, not ramps', () => {
    // The fix for stripes must not become a gradient. A triad has three
    // colors at sixteen layers, not sixteen shades between three.
    const scene = generateArt(
      { ...DEFAULTS, palette: schemeIndex('triad'), chroma: 1, layers: 16 },
      0,
    )
    for (const layer of scene.layers) expect([210, 330, 90]).toContain(hueOf(layer.fill))
  })

  it('outlines a layer with the next stop, even in the middle of a run', () => {
    // Inside a run the next LAYER is the same hue, so an edge that read
    // its neighbour would vanish. It reads the next stop in the scheme.
    const scene = generateArt(
      { ...DEFAULTS, palette: schemeIndex('triad'), chroma: 1, layers: 12 },
      0,
    )
    for (const layer of scene.layers) expect(hueOf(layer.stroke)).not.toBeCloseTo(hueOf(layer.fill))
  })

  it('halves a scheme onto half its separation at chroma 0.5', () => {
    const half = generateArt(
      { ...DEFAULTS, palette: schemeIndex('complement'), chroma: 0.5, layers: 2 },
      0,
    )
    // 180° of separation, opened halfway: 210 + 90.
    expect(hueOf(half.layers[0].fill)).toBeCloseTo(300)
  })

  it('clamps palette to the scheme table — no knob value selects off the end', () => {
    const under = generateArt({ ...DEFAULTS, palette: -4 }, 0)
    const first = generateArt({ ...DEFAULTS, palette: 0 }, 0)
    expect(under).toEqual(first)
    const over = generateArt({ ...DEFAULTS, palette: 99 }, 0)
    const last = generateArt({ ...DEFAULTS, palette: PALETTE_SCHEMES.length - 1 }, 0)
    expect(over).toEqual(last)
  })

  it('clamps chroma to [0, 1]', () => {
    expect(generateArt({ ...DEFAULTS, chroma: -3 }, 0)).toEqual(
      generateArt({ ...DEFAULTS, chroma: 0 }, 0),
    )
    expect(generateArt({ ...DEFAULTS, chroma: 9 }, 0)).toEqual(
      generateArt({ ...DEFAULTS, chroma: 1 }, 0),
    )
  })

  // Every scheme's word has to be one the seven-segment window can
  // actually draw — DSEG7-Classic has no k, m, v, w, x or z.
  it('gives every scheme a drawable code and a unique key', () => {
    expect(new Set(PALETTE_SCHEMES.map((s) => s.key)).size).toBe(PALETTE_SCHEMES.length)
    for (const s of PALETTE_SCHEMES) {
      expect(s.code).toMatch(/^[0-9abcdefghijlnopqrstuy]{1,3}$/i)
      expect(s.code).not.toMatch(/[kmvwxz]/i)
    }
  })

  // The palette dial's readout capacity is the widest word in the table.
  it("sizes the palette window's segment grid for its longest code", () => {
    const def = KNOBS_ROTARY.find((k) => k.key === 'palette')!
    const longest = Math.max(...PALETTE_SCHEMES.map((s) => s.code.length))
    expect(def.capacity).toHaveLength(longest)
    for (let v = def.min; v <= def.max; v += def.step) {
      expect(def.format!(v).length).toBeLessThanOrEqual(def.capacity!.length)
    }
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
      ['chroma', 'complexity', 'hue', 'layers', 'palette', 'speed'].sort(),
    )
    expect(KNOBS_TOGGLES.map((k) => k.key).sort()).toEqual(['mirror', 'power'].sort())
    for (const k of KNOBS_ROTARY) {
      expect(k.min).toBeLessThan(k.max)
      expect(k.step).toBeGreaterThan(0)
    }
  })

  // A field with no dial and no entry here is a parameter nobody can
  // reach and nobody declared — the exact thing the test above was
  // written to catch. Hiding `spread` must stay a DECISION, not a
  // silent omission.
  it('accounts for every field in the bag: a dial, a switch, or a declared fixed value', () => {
    const dialed = new Set<string>(KNOBS_ROTARY.map((k) => k.key))
    const switched = new Set<string>(KNOBS_TOGGLES.map((t) => t.key))
    const fixed = new Set<string>(KNOBS_FIXED)
    for (const key of Object.keys(DEFAULTS)) {
      expect(dialed.has(key) || switched.has(key) || fixed.has(key)).toBe(true)
    }
    // …and nothing is declared fixed while still wearing a dial.
    for (const key of KNOBS_FIXED) expect(dialed.has(key)).toBe(false)
  })
})

describe('dialTicks — a graduation means a stop', () => {
  const stopsOf = (def: (typeof KNOBS_ROTARY)[number]) =>
    Math.round((def.max - def.min) / def.step) + 1

  it('cuts one notch per detent on every dial that can hold them', () => {
    for (const def of KNOBS_ROTARY) {
      const stops = stopsOf(def)
      if (stops > DIAL_TICK_MAX) continue
      expect(dialTicks(def)).toHaveLength(stops)
    }
  })

  it('never crowds a face past what a hand can count', () => {
    for (const def of KNOBS_ROTARY) {
      expect(dialTicks(def).length).toBeLessThanOrEqual(DIAL_TICK_MAX)
      expect(dialTicks(def).length).toBeGreaterThanOrEqual(2)
    }
  })

  // The whole point: a dial too fine to draw every detent thins them
  // out, and every surviving notch still stands on a real stop. A notch
  // between two detents would be a lie a hand cannot check.
  it('lands every notch on a value the dial can actually stop at', () => {
    for (const def of KNOBS_ROTARY) {
      for (const deg of dialTicks(def)) {
        const frac = (deg - KNOB_ANGLE_MIN) / KNOB_ANGLE_SWEEP
        const value = def.min + frac * (def.max - def.min)
        const detents = (value - def.min) / def.step
        expect(detents).toBeCloseTo(Math.round(detents), 6)
      }
    }
  })

  it('starts at one end stop and finishes at the other', () => {
    for (const def of KNOBS_ROTARY) {
      const ticks = dialTicks(def)
      expect(ticks[0]).toBeCloseTo(knobAngle(def, def.min))
      expect(ticks[ticks.length - 1]).toBeCloseTo(knobAngle(def, def.max))
    }
  })

  // Lighting is "swept past", so the count of lit notches has to rise
  // with the value and never fall — that arc IS the readout.
  it('lights strictly more notches as a dial is turned up', () => {
    for (const def of KNOBS_ROTARY) {
      const ticks = dialTicks(def)
      const litAt = (v: number) => ticks.filter((deg) => deg <= knobAngle(def, v) + 0.25).length
      expect(litAt(def.min)).toBe(1)
      expect(litAt(def.max)).toBe(ticks.length)
      let prev = 0
      for (let v = def.min; v <= def.max; v += def.step) {
        const lit = litAt(v)
        expect(lit).toBeGreaterThanOrEqual(prev)
        prev = lit
      }
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
    palette: 4,
    chroma: 0.85,
    layers: 10,
    complexity: 20,
    speed: 1.5,
    spread: 0.85,
    power: true,
    mirror: true,
  }
  const lamp = (key: 'power' | 'mirror') => KNOBS_LAMPS.find((l) => l.key === key)!

  // The panel now seats each lamp in the same cell as its switch, and
  // the pairing is by key alone (KnobsPanel's LAMP_BY_KEY). A lamp with
  // no switch would render nowhere at all — silently, with no error and
  // no empty box — so the pairing is the contract, not the count.
  it('gives every lamp a switch to stand under', () => {
    const switches = new Set(KNOBS_TOGGLES.map((t) => t.key))
    for (const l of KNOBS_LAMPS) expect(switches.has(l.key)).toBe(true)
    expect(new Set(KNOBS_LAMPS.map((l) => l.key)).size).toBe(KNOBS_LAMPS.length)
  })

  // The hardware in Knobs.tsx pairs measured `.knb-lamp-bezel` centers
  // with KNOBS_LAMPS BY INDEX, so DOM order and array order have to
  // agree. The DOM order is the switch order, which makes this the
  // assertion that keeps an emissive die over the right lens.
  it('lists lamps in switch order, for the hardware that indexes them', () => {
    expect(KNOBS_LAMPS.map((l) => l.key)).toEqual(
      KNOBS_TOGGLES.filter((t) => KNOBS_LAMPS.some((l) => l.key === t.key)).map((t) => t.key),
    )
  })

  it('gives each lamp its own tone and a valid hex color', () => {
    expect(new Set(KNOBS_LAMPS.map((l) => l.tone)).size).toBe(KNOBS_LAMPS.length)
    for (const l of KNOBS_LAMPS) expect(l.color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('the power and mirror lamps follow their switches', () => {
    expect(lampLit(lamp('power'), DEFAULTS)).toBe(true)
    expect(lampLit(lamp('power'), { ...DEFAULTS, power: false })).toBe(false)
    expect(lampLit(lamp('mirror'), DEFAULTS)).toBe(true)
    expect(lampLit(lamp('mirror'), { ...DEFAULTS, mirror: false })).toBe(false)
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
    palette: 4,
    chroma: 0.85,
    layers: 10,
    complexity: 20,
    speed: 1.5,
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
    palette: 4,
    chroma: 0.85,
    layers: 10,
    complexity: 20,
    speed: 1.5,
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
    palette: 4,
    chroma: 0.85,
    layers: 10,
    complexity: 20,
    speed: 1.5,
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
    // Both lists lead with the outermost layer — artGlow because the big
    // emitters matter most, `scene.layers` because it is in paint order.
    expect(sources[0].hue).toBeCloseTo(layerHue(0), 0)
    expect(sources[1].hue).toBeCloseTo(layerHue(1), 0)
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

describe('litGate — the corona belongs to the picture, not the background', () => {
  const { coronaLitFloor: floor, coronaLitKnee: knee } = knobsTuning
  const gate = (luma: number) => litGate(luma, floor, knee)

  it('is fully shut at the floor and fully open at the knee', () => {
    expect(gate(floor)).toBe(0)
    expect(gate(floor - 1)).toBe(0)
    expect(gate(knee)).toBe(1)
    expect(gate(knee + 1)).toBe(1)
  })

  it('opens with zero slope at both ends — no seam where a blade crosses', () => {
    const h = 1e-4
    expect(Math.abs(gate(floor + h) - gate(floor)) / h).toBeLessThan(1e-2)
    expect(Math.abs(gate(knee) - gate(knee - h)) / h).toBeLessThan(1e-2)
  })

  it('only ever rises', () => {
    let prev = gate(0)
    for (let l = 0.02; l <= 1.001; l += 0.02) {
      const v = gate(l)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  // The load-bearing pair. The gate is only a gate if the art law keeps
  // its backdrop below the floor and its layers above the knee, at every
  // hue — which is why the measure is the brightest channel and not
  // luminance: on luma these two bands OVERLAP (backdrop 0.023..0.145
  // against layers 0.101..0.761), because Rec.709 scores a saturated
  // blue blade under a teal backdrop. Both sides are measured from
  // generateArt itself, so brightening the backdrop or dimming the
  // palette fails HERE, with a number, rather than quietly putting the
  // artificial edge glow back on the panel.
  const sweep = [0, 60, 120, 210, 240, 300]

  it('leaves every backdrop far under the picture, at every hue and scheme', () => {
    // A ratio, not a zero. The floor is tuned to the bottom of its range,
    // which lets the very brightest backdrop carry a trace of halo — and
    // with the corona pulled in to 8 px that trace is wanted. What may
    // never come back is the artificial glow standing off the panel's
    // edge against open background, so what is pinned is the gap: the
    // layers below open the gate to exactly 1, so this number IS the
    // fraction of the halo the background gets. Delete the gate and it
    // goes to 1 and this fails.
    let worst = 0
    for (let palette = 0; palette < PALETTE_SCHEMES.length; palette++) {
      for (const chroma of [0, 0.5, 1]) {
        for (const hue of sweep) {
          const scene = generateArt({ ...DEFAULTS, palette, chroma, hue }, 3.1)
          for (const stop of [scene.backdropFrom, scene.backdropTo]) {
            worst = Math.max(worst, gate(levelOf(stop)))
          }
        }
      }
    }
    expect(worst).toBeLessThan(0.25)
  })

  it('opens on every drawn layer, at every hue and scheme', () => {
    // Not "to exactly 1" any more. With the knee at the top of its range
    // the ramp is still climbing at the dimmest blade, so a faint layer
    // glows a little less than a bright one — which is what an emitter
    // does, and the reason this pins a floor rather than a ceiling. The
    // measured worst case is 0.869 against the brightest backdrop's
    // 0.065: a 13x gap, and the gap is the law.
    let dimmest = 1
    for (let palette = 0; palette < PALETTE_SCHEMES.length; palette++) {
      for (const layers of [2, 10, 16]) {
        for (const hue of sweep) {
          const scene = generateArt({ ...DEFAULTS, palette, chroma: 1, layers, hue }, 3.1)
          // Worst case: a translucent layer over the DARKER backdrop stop.
          const under = Math.min(levelOf(scene.backdropFrom), levelOf(scene.backdropTo))
          for (const layer of scene.layers) dimmest = Math.min(dimmest, gate(levelOf(layer.fill, under)))
        }
      }
    }
    expect(dimmest).toBeGreaterThan(0.75)
  })
})
