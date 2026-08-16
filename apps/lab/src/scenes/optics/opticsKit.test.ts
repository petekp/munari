import { describe, expect, it } from 'vitest'
import { CHIP, KIT, collarRange, railSlot, specFor, tierOf } from './opticsKit'
import { CAP_MARGIN, apertureOf, capIsValid, footprint, landOffset, magnification } from './opticsLaw'
import { BENCH_H, RAIL_ROOM, RAIL_Y, SHEET } from './opticsSheet'

/**
 * The sizes an instrument can be. A fixed disc has exactly one; a sheet is
 * checked at its extremes and in between, because its cap bound moves with
 * every drag and only the corners of that space can be reasoned about.
 */
const clamp = (v: number, r: { min: number; max: number }) =>
  Math.min(Math.max(v, r.min), r.max)

function sizesOf(inst: (typeof KIT)[number]): Array<readonly [number, number] | undefined> {
  const s = inst.sheet
  if (!s) return [undefined]
  return [
    s.min,
    s.start,
    s.max,
    [s.min[0], s.max[1]], // wide-short and tall-narrow: the corner distance
    [s.max[0], s.min[1]], // is what binds, and it is not either extent alone
  ]
}

describe('the kit — four instruments, one law', () => {
  it('grinds each collar reading into the power it is marked with', () => {
    for (const inst of KIT) {
      for (const v of [inst.collar.min, inst.collar.start, inst.collar.max]) {
        const expected = inst.mode === 'scope' ? 1 : v
        expect(magnification(specFor(inst, v))).toBeCloseTo(expected, 9)
      }
    }
  })

  it('gives the loupe a convex face and the reducing glass a concave one', () => {
    const loupe = KIT.find((i) => i.id === 'loupe')!
    const reducer = KIT.find((i) => i.id === 'reducer')!
    expect(specFor(loupe, loupe.collar.start).curvature).toBeGreaterThan(0)
    expect(specFor(reducer, reducer.collar.start).curvature).toBeLessThan(0)
  })

  it('leaves the scope a true window — what it shows is where things are', () => {
    const scope = KIT.find((i) => i.id === 'scope')!
    const spec = specFor(scope, scope.collar.start)
    expect(spec.curvature).toBe(Infinity)
    expect(landOffset(60, -30, [0, 0, -1], spec)).toEqual([60, -30])
  })

  it('asks the page for a tier that matches what the glass does to it', () => {
    // The pairing is the argument of the scene: magnify and you need MORE
    // raster than the screen has, reduce and you need less, measure and
    // you need exactly what was already there.
    const tiers = Object.fromEntries(KIT.map((i) => [i.id, i.tier]))
    expect(tiers.loupe).toBeGreaterThan(1)
    expect(tiers.reducer).toBeLessThan(1)
    expect(tiers.scope).toBe(1)
  })

  it('starts every collar inside its own range', () => {
    for (const c of KIT.map((i) => i.collar)) {
      expect(c.start).toBeGreaterThanOrEqual(c.min)
      expect(c.start).toBeLessThanOrEqual(c.max)
    }
  })

  it('keeps every collar range inside the cap its own geometry can hold', () => {
    // The bug this pins, measured 2026-08-11: the loupe was marked to 4× on
    // an aperture that runs out of sphere at 2.33×, and the reducing glass
    // was marked to 0.35× on one that bottoms out at 0.68×. Both kept
    // rendering. What gave them away was the reading span, which grew when
    // the power did — 101 px at 1.65× became 201 px at 2.35×.
    for (const inst of KIT) {
      if (inst.mode === 'scope') continue
      for (const half of sizesOf(inst)) {
        const range = collarRange(inst, half)
        expect(range.max).toBeGreaterThan(range.min)
        for (let i = 0; i <= 40; i++) {
          const v = range.min + ((range.max - range.min) * i) / 40
          const spec = specFor(inst, v, half)
          expect(capIsValid(spec)).toBe(true)
          expect(Math.abs(spec.curvature)).toBeGreaterThanOrEqual(CAP_MARGIN * spec.aperture)
        }
      }
    }
  })

  it('takes power away from the sheet as the sheet is made larger', () => {
    // The whole reason the sheet is worth having. Its corner is what
    // strains the cap, and dragging it out moves the corner — so the
    // reachable band closes in from both ends, and the track drawn on the
    // frame is showing this number.
    const sheet = KIT.find((i) => i.id === 'sheet')!
    const small = collarRange(sheet, sheet.sheet!.min)
    const start = collarRange(sheet, sheet.sheet!.start)
    const large = collarRange(sheet, sheet.sheet!.max)

    expect(small.max).toBeGreaterThan(start.max)
    expect(start.max).toBeGreaterThan(large.max)
    expect(small.min).toBeLessThan(start.min)
    expect(start.min).toBeLessThan(large.min)
    // It must still be worth picking up at its widest: a band that closed
    // to nothing would be a sheet you can only look through.
    expect(large.min).toBeLessThan(1)
    expect(large.max).toBeGreaterThan(1)
  })

  it('lets the sheet be a true flat window, which no other instrument can', () => {
    const sheet = KIT.find((i) => i.id === 'sheet')!
    for (const half of [sheet.sheet!.min, sheet.sheet!.start, sheet.sheet!.max]) {
      const range = collarRange(sheet, half)
      expect(range.min).toBeLessThan(1)
      expect(range.max).toBeGreaterThan(1)
      const spec = specFor(sheet, 1, half)
      expect(spec.curvature).toBe(Infinity)
      expect(landOffset(half[0], -half[1], [0, 0, -1], spec)).toEqual([half[0], -half[1]])
    }
  })

  it('moves the sheet up a raster rung as its power crosses one', () => {
    const sheet = KIT.find((i) => i.id === 'sheet')!
    // Fixed instruments do not chase their power; the sheet does.
    for (const inst of KIT) {
      if (inst.sheet) continue
      expect(tierOf(inst, inst.collar.start)).toBe(inst.tier)
    }
    const rungs = [0.5, 0.8, 1.2, 1.9, 2.6].map((v) => tierOf(sheet, v))
    expect(rungs).toEqual([0.5, 1, 1, 2, 3])
    // Monotone, so a slow turn of the collar never steps backward.
    let prev = 0
    for (let v = 0.5; v <= 3; v += 0.05) {
      const t = tierOf(sheet, v)
      expect(t).toBeGreaterThanOrEqual(prev)
      prev = t
    }
  })

  it('reads less page the harder it magnifies, across the whole collar', () => {
    // The monotonicity the bug broke. It holds only inside the cap bound, so
    // it is the reading that proves the bound is doing its job.
    const down = (): [number, number, number] => [0, 0, -1]
    const spanAt = (inst: (typeof KIT)[number], v: number, half?: readonly [number, number]) =>
      footprint({ x: 0, y: 0 }, specFor(inst, v, half), down).r

    for (const inst of KIT) {
      if (inst.mode === 'scope') continue
      for (const half of sizesOf(inst)) {
      const range = collarRange(inst, half)
      // More power must read a smaller disc. This is the reading the bug
      // inverted, and it holds only while the cap stays a cap.
      expect(spanAt(inst, range.max, half)).toBeLessThan(spanAt(inst, range.min, half))

      for (const v of [range.min, clamp(inst.collar.start, range), range.max]) {
        const aperture = specFor(inst, v, half).aperture
        const paraxial = aperture / v
        const actual = spanAt(inst, v, half)
        // Spherical aberration, and it points opposite ways on the two
        // sides: a convex cap bends its rim harder than its axis, pulling
        // the footprint IN under the paraxial figure; a concave cap throws
        // its rim wider, pushing it OUT. Both are the real thing. What marks
        // the degeneracy is the gap being a multiple rather than a fraction,
        // so these bounds are what CAP_MARGIN was set to buy.
        // The 0.998 on the concave floor is not slack: `footprint` samples
        // the rim at aperture × 0.999, so a face flat enough to have no
        // aberration left reports that factor short of paraxial and nothing
        // more.
        if (v > 1) {
          expect(actual).toBeLessThanOrEqual(paraxial)
          expect(actual).toBeGreaterThan(paraxial * 0.77)
        } else {
          expect(actual).toBeGreaterThanOrEqual(paraxial * 0.998)
          expect(actual).toBeLessThan(paraxial * 1.05)
        }
      }
      }
    }
  })

  it('parks the four instruments on distinct rail slots', () => {
    const slots = KIT.map((i) => railSlot(i.id))
    expect(new Set(slots).size).toBe(KIT.length)
  })

  it('fits the whole rack on the bench, at 1:1, without touching the page', () => {
    // The clipping bug this pins, measured 2026-08-11: rail previews stood
    // at their working standoff, where perspective pushes them outward and
    // down, and the rack was cut off at every viewport height anyone would
    // use. Previews now lie flat at z = 0, so world units ARE screen px and
    // this arithmetic is the whole check.
    const half = BENCH_H / 2
    expect(SHEET.h / 2).toBeLessThan(half) // the page fits

    for (const inst of KIT) {
      const chipW = (inst.sheet ? apertureOf(inst.sheet.start) : inst.aperture) * CHIP
      const chipH = inst.sheet ? inst.sheet.start[1] * CHIP : inst.aperture * CHIP
      expect(chipH).toBeLessThanOrEqual(RAIL_ROOM)
      // Clear of the bottom edge…
      expect(Math.abs(RAIL_Y) + chipH).toBeLessThanOrEqual(half)
      // …and clear of the page above it.
      expect(RAIL_Y + chipH).toBeLessThan(-SHEET.h / 2)
      // Wide enough not to run off the sides.
      expect(Math.abs(railSlot(inst.id)) + chipW).toBeLessThan(SHEET.w / 2)
    }

    // Neighbours must not overlap, or the rack reads as one shape.
    const sorted = [...KIT].sort((a, b) => railSlot(a.id) - railSlot(b.id))
    for (let i = 1; i < sorted.length; i++) {
      const gap = railSlot(sorted[i].id) - railSlot(sorted[i - 1].id)
      const reach =
        (sorted[i].sheet ? apertureOf(sorted[i].sheet!.start) : sorted[i].aperture) * CHIP +
        (sorted[i - 1].sheet
          ? apertureOf(sorted[i - 1].sheet!.start)
          : sorted[i - 1].aperture) * CHIP
      expect(gap).toBeGreaterThan(reach)
    }
  })
})
