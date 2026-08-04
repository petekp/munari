import { describe, expect, it } from 'vitest'
import {
  ARRIVE_AT,
  CROSS_DIP,
  CROSS_LIFT,
  FADE,
  RISE,
  SPREAD,
  arrivalSource,
  boxAt,
  crossBump,
  crossedLine,
  departureTarget,
  fadeDelay,
  handoverAt,
  planFlight,
  presenceAt,
  previousWord,
  sharesLine,
  uvOf,
  type Layout,
  type Part,
} from './passageParts'

// The real thing, measured in Chrome 2026-08-04 by walking the card's text
// nodes into `Range`s at each endpoint width and reading `getClientRects()`.
// Positions are card-local px; `fs` is the computed font size, kept because
// the sharpness argument in `handoverAt` is about exactly this ratio.
//
// The card is 308 × 324 at the small end and 940 × 695 at the large one, and
// the same markup produces 27 words in the first and 96 in the second — the
// body copy is `display: none` below the 430 px container breakpoint, so it
// has no source box at all.
const SMALL: [key: string, x: number, y: number, w: number, h: number][] = [
  ['w0:0', 32.1, 145.8, 22, 12],
  ['w0:1', 62.2, 145.8, 41, 12],
  ['w1:0', 13.3, 183.2, 52, 11],
  ['w3:0', 13.3, 199, 210, 22],
  // The word that changes line: last on line two of the head at the small
  // end, last on the ONLY line at the large one.
  ['w3:1', 13.3, 221, 30, 22],
  // The meta line, all of it on one line at both ends. Short words in it are
  // what the first crossing test convicted by mistake.
  ['w4:0', 13.3, 243, 52, 12],
  ['w4:1', 70, 243, 14, 12],
  ['w4:2', 83, 243, 44, 12],
  ['w9:0', 208.6, 276, 44, 10],
  ['w9:1', 208.6, 288.4, 76, 15],
]
const LARGE: [key: string, x: number, y: number, w: number, h: number][] = [
  ['w0:0', 78.1, 207.2, 31, 16.5],
  ['w0:1', 120.6, 207.2, 58, 16.5],
  ['w1:0', 38.6, 299.5, 68, 15],
  ['w3:0', 38.6, 322, 512, 46],
  ['w3:1', 640, 322, 74, 46],
  ['w4:0', 38.6, 394, 76, 16],
  ['w4:1', 115, 394, 14, 16],
  ['w4:2', 131, 394, 62, 16],
  ['w9:0', 636.7, 591.5, 54, 12.5],
  ['w9:1', 636.7, 612.6, 112, 23],
  // The body: no counterpart at the small end.
  ['w5:0', 38.6, 416, 60, 21],
  ['w5:1', 104, 416, 48, 21],
  ['w5:2', 158, 416, 72, 21],
  ['w6:0', 38.6, 458, 66, 21],
]

const layout = (
  width: number,
  height: number,
  rows: [string, number, number, number, number][],
): Layout => ({
  width,
  height,
  parts: rows.map(
    ([key, x, y, w, h], i): Part => ({ key, kind: 'word', box: { x, y, w, h }, order: i }),
  ),
})

const A = layout(308, 324, SMALL)
const B = layout(940, 695, LARGE)

describe('planFlight', () => {
  it('splits the card into travellers and arrivals', () => {
    const plan = planFlight(A, B)
    const matched = plan.filter((p) => p.hasFrom === 1 && p.hasTo === 1)
    const arriving = plan.filter((p) => p.hasFrom === 0)
    const leaving = plan.filter((p) => p.hasTo === 0)
    expect(matched).toHaveLength(10)
    expect(arriving).toHaveLength(4)
    // Nothing leaves on the way out — everything the small card shows, the
    // large one shows too. Which is the shape of this component and not a
    // law; the reverse direction below is where departures come from.
    expect(leaving).toHaveLength(0)
    expect(plan).toHaveLength(14)
  })

  it('is symmetric — a close is an open with the endpoints swapped', () => {
    const out = planFlight(A, B)
    const back = planFlight(B, A)
    expect(back.filter((p) => p.hasTo === 0)).toHaveLength(4)
    expect(back.filter((p) => p.hasFrom === 1 && p.hasTo === 1)).toHaveLength(10)
    expect(back).toHaveLength(out.length)
  })

  it('gives every part a texture window inside the texture', () => {
    for (const p of planFlight(A, B)) {
      for (const uv of [p.uvFrom, p.uvTo]) {
        expect(uv.x).toBeGreaterThanOrEqual(0)
        expect(uv.y).toBeGreaterThanOrEqual(0)
        expect(uv.x + uv.w).toBeLessThanOrEqual(1.001)
        expect(uv.y + uv.h).toBeLessThanOrEqual(1.001)
      }
    }
  })

  it('reads the same word out of both textures', () => {
    // The claim the cross-fade rests on. `t0:1` is the live counter's digits:
    // at (62.2, 145.8) in a 308 × 324 card and at (120.6, 207.2) in a
    // 940 × 695 one. Two very different UV rects — and both of them frame the
    // same characters, which is why blending them shows nothing.
    const p = planFlight(A, B).find((q) => q.key === 'w0:1')!
    expect(p.uvFrom.x).toBeCloseTo(62.2 / 308, 5)
    expect(p.uvTo.x).toBeCloseTo(120.6 / 940, 5)
    expect(p.uvFrom.x).not.toBeCloseTo(p.uvTo.x, 2)
  })

  it('orders arrivals so the buffer is stable across a reversal', () => {
    const one = planFlight(A, B).map((p) => p.key)
    const two = planFlight(A, B).map((p) => p.key)
    expect(one).toEqual(two)
    // Destination reading order first, departures after — so the same key is
    // at the same instance index every time the plan is rebuilt.
    expect(one.slice(0, 3)).toEqual(['w0:0', 'w0:1', 'w1:0'])
  })
})

describe('boxAt', () => {
  it('moves a word to another line without ever jumping', () => {
    // THE claim. `t3:1` starts on the second line of the head at
    // (13.3, 221) and ends on the FIRST line, out to the right, at
    // (560, 322) — a different line box in a different grid regime. A reflow
    // delivers that as one discontinuity; there is no DOM node for a line, so
    // nothing in the document could have carried it across.
    const p = planFlight(A, B).find((q) => q.key === 'w3:1')!
    expect(p.from.y).toBe(221)
    expect(p.to.y).toBe(322)
    expect(p.from.x).toBe(13.3)
    expect(p.to.x).toBe(640)
    let prev = boxAt(p, 0)
    let biggest = 0
    for (let i = 1; i <= 120; i++) {
      const b = boxAt(p, i / 120)
      biggest = Math.max(biggest, Math.hypot(b.x - prev.x, b.y - prev.y))
      prev = b
    }
    const total = Math.hypot(p.to.x - p.from.x, p.to.y - p.from.y)
    expect(total).toBeGreaterThan(500)
    // A reflow moves it all in one frame; this moves it in 120 even steps.
    expect(biggest).toBeLessThan(total / 100)
  })

  it('lands on both endpoints exactly', () => {
    for (const p of planFlight(A, B)) {
      expect(boxAt(p, 0)).toEqual(p.from)
      expect(boxAt(p, 1)).toEqual(p.to)
    }
  })

  it('starts an arrival in the card it is arriving into, not the one it will end in', () => {
    // A part with no source box still has to be SOMEWHERE for the first half
    // of the flight, and "at its destination coordinates" is not somewhere —
    // it is a position in a card that does not exist yet. The body copy sits
    // at y = 416 in a 695 px card; the card is 324 px tall when the flight
    // starts and about 424 px tall when the body begins to fade in, so a word
    // placed at its final coordinates spends the first two thirds of the
    // flight hanging in the air BELOW the card, and fades in there.
    //
    // So an arrival borrows the card's own transform: its box is its
    // destination box carried back into the source card's frame, which is
    // exactly what "this part belongs to this card" means when the part has
    // no history of its own.
    const p = planFlight(A, B).find((q) => q.key === 'w5:0')!
    expect(p.hasFrom).toBe(0)
    expect(p.from.y).toBeLessThan(p.to.y)
    expect(p.from.w).toBeLessThan(p.to.w)
    expect(arrivalSource(p.to, B, A)).toEqual(p.from)
    // Carried, then dropped — and the drop is the only authored number in it.
    expect(p.from.y).toBeCloseTo((p.to.y * A.height) / B.height + RISE, 6)
    // A close is an open backwards: the same part leaving runs the same
    // carry in the other direction.
    const q = planFlight(B, A).find((r) => r.key === 'w5:0')!
    expect(q.hasTo).toBe(0)
    expect(q.to).toEqual(departureTarget(q.from, B, A))
  })

  it('keeps every part inside the card that is carrying it', () => {
    // The whole-card version of the same law, and the one a screenshot shows:
    // nothing may be drawn outside the panel, at any point, in either
    // direction. The card's own box is what the field interpolates
    // (`uCardA` → `uCardB`), so this is the same arithmetic the shader does.
    for (const [from, to] of [
      [A, B],
      [B, A],
    ] as const) {
      for (const p of planFlight(from, to)) {
        for (let i = 0; i <= 40; i++) {
          const t = i / 40
          const w = from.width + (to.width - from.width) * t
          const h = from.height + (to.height - from.height) * t
          const b = boxAt(p, t)
          expect(b.x).toBeGreaterThanOrEqual(-1)
          expect(b.y).toBeGreaterThanOrEqual(-1)
          expect(b.x + b.w).toBeLessThanOrEqual(w + 1)
          expect(b.y + b.h).toBeLessThanOrEqual(h + 1)
        }
      }
    }
  })
})

describe('presenceAt', () => {
  it('never fades a word that is riding the card', () => {
    // The single line that decides whether this reads as objects moving or as
    // a dissolve. A matched part that goes where the card takes it is opaque
    // at every point of the flight — which is almost all of them.
    const p = planFlight(A, B).find((q) => q.key === 'w3:0')!
    expect(p.crossing).toBe(0)
    for (let i = 0; i <= 40; i++) expect(presenceAt(p, i / 40)).toBe(1)
  })

  it('dips only the word that is crossing, and only in the air', () => {
    const plan = planFlight(A, B)
    const crossing = plan.find((q) => q.key === 'w3:1')!
    const riding = plan.filter((q) => q.hasFrom === 1 && q.hasTo === 1 && q.key !== 'w3:1')
    // One word out of ten, and the ones it is not are the short words of the
    // meta line — which a geometric threshold got wrong and a line predicate
    // cannot.
    expect(crossing.crossing).toBe(1)
    for (const q of riding) expect(q.crossing).toBe(0)
    expect(plan.find((q) => q.key === 'w4:1')!.crossing).toBe(0)
    // Zero at both endpoints — the card is flat and opaque at every moment it
    // is being compared with the DOM it replaced.
    expect(presenceAt(crossing, 0)).toBe(1)
    expect(presenceAt(crossing, 1)).toBe(1)
    expect(presenceAt(crossing, 0.5)).toBeCloseTo(1 - CROSS_DIP * crossing.crossing, 6)
    // Legible at its lowest, not a ghost.
    expect(presenceAt(crossing, 0.5)).toBeGreaterThan(0.4)
  })

  it('leaves the surface by exactly as much as it dims', () => {
    // One bump drives both, so the lift and the dip cannot drift apart and
    // leave a word transparent while it is lying flat on the paragraph.
    expect(crossBump(0)).toBe(0)
    expect(crossBump(1)).toBe(0)
    expect(crossBump(0.5)).toBe(1)
    // Flat at both ends: it leaves and rejoins the surface with zero slope.
    expect(crossBump(0.02)).toBeLessThan(0.03)
    expect(crossBump(0.98)).toBeLessThan(0.03)
    expect(CROSS_LIFT).toBeGreaterThan(0)
  })

  it('brings arrivals in after the card has room for them', () => {
    const plan = planFlight(A, B)
    const arriving = plan.filter((p) => p.hasFrom === 0)
    for (const p of arriving) {
      expect(presenceAt(p, 0)).toBe(0)
      expect(presenceAt(p, 1)).toBe(1)
      // Nothing arrives in the first third — there is no line for it to land
      // on yet.
      expect(presenceAt(p, 0.33)).toBe(0)
    }
  })

  it('sweeps them in reading order', () => {
    const arriving = planFlight(A, B).filter((p) => p.hasFrom === 0)
    const delays = arriving.map((p) => p.delay)
    expect(delays).toEqual([...delays].sort((a, b) => a - b))
    expect(delays[0]).toBeCloseTo(ARRIVE_AT, 6)
    expect(delays[delays.length - 1]).toBeCloseTo(ARRIVE_AT + SPREAD, 6)
    // And the last one is fully in before the flight ends, or it lands after
    // the card has already stopped and reads as a straggler.
    expect(ARRIVE_AT + SPREAD + FADE).toBeLessThanOrEqual(1)
  })

  it('is monotonic, so a reversal plays it backwards exactly', () => {
    const p = planFlight(A, B).find((q) => q.key === 'w5:2')!
    let prev = -1
    for (let i = 0; i <= 100; i++) {
      const v = presenceAt(p, i / 100)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
    // Pure in `t`, so the spring turning around costs nothing: the same
    // progress always means the same picture.
    expect(presenceAt(p, 0.7)).toBe(presenceAt(p, 0.7))
  })

  it('fades a departure out instead of in', () => {
    const p = planFlight(B, A).find((q) => q.hasTo === 0)!
    expect(presenceAt(p, 0)).toBe(1)
    expect(presenceAt(p, 1)).toBe(0)
  })
})

describe('handoverAt', () => {
  it('shows one capture or the other for almost the whole flight', () => {
    // THE claim of the short swap, and the fix for the doubled word. The two
    // rasterizations of one word do not register glyph for glyph, so any
    // fraction where both are visible is a fraction where the letters inside
    // the word sit apart. Held across the flight that reads as embossing;
    // confined to a fifth of it, it is a shimmer.
    const g = 39.48 / 16
    let both = 0
    for (let i = 0; i <= 200; i++) {
      const h = handoverAt(i / 200, g)
      if (h > 0.05 && h < 0.95) both++
    }
    expect(both / 201).toBeLessThan(0.2)
  })

  it('swaps before the midpoint when the word grows, and after when it shrinks', () => {
    // The title goes 16 → 39.48 px. Half of that growth in LOG size is
    // reached at t = 0.39, well before the flight's middle — so the source
    // capture is retired while it is still the sharper of the two, and the
    // destination's is in place before the quad is big enough to show that it
    // was ever upscaled.
    const g = 39.48 / 16
    expect(handoverAt(0.39, g)).toBeCloseTo(0.5, 1)
    expect(handoverAt(0.5, g)).toBeGreaterThan(0.9)
    expect(handoverAt(0.25, g)).toBeLessThan(0.1)
    // And a word that shrinks holds its source past the middle, by exactly
    // as much: a close is an open played backwards.
    expect(handoverAt(0.61, 1 / g)).toBeCloseTo(0.5, 1)
  })

  it('degenerates to a swap at the midpoint when neither texture is sharper', () => {
    expect(handoverAt(0.5, 1)).toBeCloseTo(0.5, 6)
    expect(handoverAt(0.3, 1)).toBe(0)
    expect(handoverAt(0.7, 1)).toBe(1)
  })

  it('still lands on both endpoints exactly', () => {
    for (const g of [0.4, 1, 2.47, 6]) {
      expect(handoverAt(0, g)).toBeCloseTo(0, 6)
      expect(handoverAt(1, g)).toBeCloseTo(1, 6)
    }
  })

  it('is monotonic at every growth ratio', () => {
    for (const g of [0.4, 1, 2.47, 6]) {
      let prev = -1
      for (let i = 0; i <= 100; i++) {
        const v = handoverAt(i / 100, g)
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
        prev = v
      }
    }
  })

  it('mirrors itself when the word shrinks instead', () => {
    // Closing the card is the same flight backwards, so a word that grew
    // 2.47× on the way out shrinks by the same ratio on the way home, and the
    // sharper endpoint has to win at the mirrored moment.
    const g = 39.48 / 16
    expect(handoverAt(0.5, 1 / g)).toBeCloseTo(1 - handoverAt(0.5, g), 6)
  })
})

describe('crossedLine', () => {
  const on = (x: number, y: number) => ({ x, y, w: 40, h: 20 })

  it('is a statement about the line break, not about distance', () => {
    // Together, then apart.
    expect(crossedLine(on(0, 100), on(50, 100), on(0, 200), on(0, 230))).toBe(true)
    // Apart, then together — the head's last word joining line one.
    expect(crossedLine(on(0, 100), on(0, 130), on(0, 200), on(600, 200))).toBe(true)
    // Together at both ends, however far the pair has travelled between them.
    expect(crossedLine(on(0, 100), on(50, 100), on(0, 900), on(800, 900))).toBe(false)
  })

  it('reads the line off the type, so half-leading cannot split a line', () => {
    // Two words on one line never share a y exactly — a taller inline, a
    // superscript, a different font in the run all shift the content box by a
    // point or two. Half the shorter word's height is the tolerance, and it is
    // the right one: a real line break moves a word by a whole line.
    expect(sharesLine(on(0, 100), on(50, 108))).toBe(true)
    expect(sharesLine(on(0, 100), on(50, 122))).toBe(false)
  })

  it('has no opinion about the first word of a text node', () => {
    expect(previousWord('w7:0')).toBe(null)
    expect(previousWord('w7:3')).toBe('w7:2')
    expect(previousWord('b0.1.2')).toBe(null)
  })
})

describe('uvOf', () => {
  it('normalises by the endpoint the part was measured in', () => {
    expect(uvOf({ x: 47, y: 100, w: 94, h: 50 }, 940, 200)).toEqual({
      x: 0.05,
      y: 0.5,
      w: 0.1,
      h: 0.25,
    })
  })

  it('cannot divide by a zero-sized endpoint', () => {
    const uv = uvOf({ x: 0, y: 0, w: 10, h: 10 }, 0, 0)
    expect(Number.isFinite(uv.w)).toBe(true)
  })
})

describe('fadeDelay', () => {
  it('puts a lone arrival at the front of the window rather than the middle', () => {
    expect(fadeDelay(0, 1)).toBeCloseTo(ARRIVE_AT, 6)
  })
})
