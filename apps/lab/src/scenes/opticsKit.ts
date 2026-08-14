// The kit: four instruments, one law.
//
// The loupe and the reducing glass are the same lens with the curvature's
// sign flipped, the paint scope is the same lens ground flat, and the free
// sheet is the same lens cut to a rectangle you resize. Nothing here is a
// special case in the shader or in the pointer path — an instrument is a
// set of numbers, and `specFor` turns the collar reading into the
// `LensSpec` that both halves of `opticsLaw` consume.
//
// What each one asks of the page is the `tier`, and it is the whole
// argument of the scene. The loupe asks for 3 because a magnified view of
// a 1× raster is a magnified view of decisions already made. The reducing
// glass asks for 0.5 for the mirror-image reason: shrinking a raster
// throws away hairlines that a re-raster at the smaller size would have
// kept. The scope asks for 1, because an instrument that changes what it
// measures is not an instrument. The sheet, alone, asks for whatever its
// current power needs — see `tierOf`.

import {
  apertureOf,
  curvatureFor,
  powerLimit,
  type LensSpec,
} from './opticsLaw'

export type InstrumentId = 'loupe' | 'reducer' | 'scope' | 'sheet'

export interface Collar {
  /** What the ring is measuring, for the readout. */
  label: string
  min: number
  max: number
  start: number
  format: (v: number) => string
}

/** A rectangular face, and the sizes it may be dragged between. */
export interface SheetShape {
  start: readonly [number, number]
  min: readonly [number, number]
  max: readonly [number, number]
}

export interface Instrument {
  id: InstrumentId
  name: string
  /** One line, in the readout, saying what this piece of glass claims. */
  claim: string
  /**
   * Radius of the disc face. For a sheet this is the corner distance at
   * its starting size — a nominal figure, since the live one comes from
   * whatever size the sheet has been dragged to.
   */
  aperture: number
  standoff: number
  ior: number
  /** The resolution tier this instrument asks of whatever it covers. */
  tier: number
  mode: 'glass' | 'scope'
  /** Present when the face is a rectangle you resize. */
  sheet?: SheetShape
  collar: Collar
  /** Rim and collar finish. */
  metal: string
  /** How bright a glint the curved face throws. */
  tint: number
}

const power = (v: number) => `${v.toFixed(2)}×`

// Every collar range below is bounded by `powerLimit` for that instrument's
// own aperture, standoff and index — not chosen and then hoped for. The
// standoffs differ for that reason and no other: strong glass needs a
// long-radius cap over a small disc, so the loupe sits low over the page and
// the reducing glass is held high, exactly as the real pair are. The
// conformance for this is in opticsKit.test.ts, which walks each range.
export const KIT: readonly Instrument[] = [
  {
    id: 'loupe',
    name: "printer's loupe",
    claim: 'magnifies the document, not the screenshot',
    // Small disc, held low. High power needs a long-radius cap over a narrow
    // aperture — which is why real printer's loupes are the size they are.
    aperture: 60,
    standoff: 240,
    ior: 1.52,
    tier: 3,
    mode: 'glass',
    // Limit for this geometry is 3.08×; at 3.00 the rim reads 3.83×.
    collar: { label: 'power', min: 1.2, max: 3, start: 1.8, format: power },
    metal: '#b7913f',
    tint: 0.07,
  },
  {
    id: 'reducer',
    name: 'reducing glass',
    claim: 'shrinks by re-rastering, not by dropping pixels',
    // Wide disc, held high — the way you actually hold one.
    aperture: 90,
    standoff: 360,
    ior: 1.52,
    tier: 0.5,
    mode: 'glass',
    // Limit for this geometry is 0.59×; the concave side stays within 4%.
    collar: { label: 'power', min: 0.6, max: 0.95, start: 0.7, format: power },
    metal: '#9ba2ab',
    tint: 0.05,
  },
  {
    id: 'scope',
    name: 'paint scope',
    claim: 'reads the paint ledger, and disturbs nothing',
    aperture: 100,
    // Flat, so the cap bound does not apply and the height is free; this one
    // parks between the other two so the rail does not read as an accident.
    standoff: 300,
    ior: 1,
    tier: 1,
    mode: 'scope',
    collar: {
      label: 'window',
      min: 0.25,
      max: 4,
      start: 1,
      format: (v) => `${v.toFixed(2)} s`,
    },
    metal: '#4a4d54',
    tint: 0,
  },
  {
    id: 'sheet',
    name: 'free sheet',
    claim: 'any rectangle of the page, at any power the glass can hold',
    // Nominal only — `specFor` measures the live corner. Held high, because
    // a face this wide needs a long-radius cap to stay a cap.
    aperture: apertureOf([110, 68]),
    standoff: 460,
    ior: 1.52,
    tier: 1,
    mode: 'glass',
    sheet: { start: [110, 68], min: [55, 34], max: [260, 155] },
    // The only collar that crosses 1.00×, where the sheet is a true flat
    // window. Both ends are bounded further by the live size — see
    // `collarRange`, which is what the track on the frame draws.
    collar: { label: 'power', min: 0.5, max: 3, start: 1, format: power },
    metal: '#8d8f97',
    tint: 0.06,
  },
]

export const INSTRUMENT: Record<InstrumentId, Instrument> = Object.fromEntries(
  KIT.map((i) => [i.id, i]),
) as Record<InstrumentId, Instrument>

/**
 * The collar reading, as glass.
 *
 * A dial marked "2.40×" is a dial choosing a radius of curvature — that
 * inversion is `curvatureFor`, and it is why the readout can print a
 * power without the shader ever being told one. The scope looks through a
 * flat face, which is the same formula at power exactly 1.
 */
export function specFor(
  inst: Instrument,
  collar: number,
  half?: readonly [number, number],
): LensSpec {
  const h = inst.sheet ? (half ?? inst.sheet.start) : undefined
  return {
    aperture: h ? apertureOf(h) : inst.aperture,
    half: h,
    standoff: inst.standoff,
    ior: inst.mode === 'scope' ? 1 : inst.ior,
    curvature:
      inst.mode === 'scope' ? Infinity : curvatureFor(collar, inst.standoff, inst.ior),
  }
}

/**
 * The powers this instrument can actually be set to right now.
 *
 * For the fixed instruments this is just what is engraved on the collar —
 * their geometry never changes, so the range was checked once and holds.
 * The sheet's corner moves every time you drag it, so its range is the
 * engraved one intersected with what `powerLimit` allows at the current
 * size: grow the sheet and the collar loses power at both ends.
 */
export function collarRange(
  inst: Instrument,
  half?: readonly [number, number],
): { min: number; max: number } {
  const c = inst.collar
  if (!inst.sheet) return { min: c.min, max: c.max }
  const limit = powerLimit(apertureOf(half ?? inst.sheet.start), inst.standoff, inst.ior)
  return { min: Math.max(c.min, limit.min), max: Math.min(c.max, limit.max) }
}

/**
 * The raster tier an instrument wants for what it covers.
 *
 * Fixed for the ground instruments, because their power barely moves and a
 * tier that chased it would repaint the page for nothing. The sheet spans
 * 0.5× to 3×, so its tier has to follow — snapped to a ladder, and snapped
 * in log2 because that is the spacing raster tiers actually have. One paint
 * per rung crossed, which is the cost this scene exists to show.
 */
const LADDER = [0.5, 1, 2, 3]

export function tierOf(inst: Instrument, collar: number): number {
  if (!inst.sheet) return inst.tier
  let best = LADDER[0]
  for (const step of LADDER) {
    if (Math.abs(Math.log2(step / collar)) < Math.abs(Math.log2(best / collar))) best = step
  }
  return best
}

/**
 * Where each instrument rests when it is not in hand.
 *
 * The row is centred, so adding a fifth piece of glass re-spaces the rack
 * rather than pushing the last one off the bench.
 */
export function railSlot(id: InstrumentId): number {
  return (KIT.findIndex((i) => i.id === id) - (KIT.length - 1) / 2) * 150
}

/**
 * How much a rail preview is shrunk from the instrument's working size.
 *
 * Previews lie flat in the rack at z = 0, where a world unit is a screen
 * px, so this factor alone decides whether the rack fits under the page.
 * The largest piece of glass sets it and the rest keep their proportions,
 * which is what makes the rack read as a rack rather than as four chips.
 */
export const CHIP = 52 / Math.max(...KIT.map((i) => i.aperture))
