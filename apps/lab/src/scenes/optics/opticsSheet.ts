// The proofing sheet: what is laid out on the bench, and where.
//
// Six specimens, each its OWN Surface. That is the load-bearing decision
// of the whole scene and it comes straight from the spike: a Surface has
// one resolution tier, so a page that wants detail only under the glass
// has to be several pages. Authoring the sheet as blocks is what lets an
// instrument sharpen the two it covers and leave the other four cheap.
//
// Two coordinate frames, and it is worth being blunt about which is
// which. PAGE coordinates are what the table below uses: y down, origin
// at the sheet's top-left corner, exactly like CSS. WORLD coordinates are
// what the scene and the shaders use: y up, origin at the sheet's centre,
// one unit per CSS px because the camera is pixel-calibrated. Everything
// crosses the seam here and nowhere else.

import type { Block } from './opticsLod'

export const SHEET = { w: 940, h: 540 }

// ── the bench ──────────────────────────────────────────────────────────
//
// The rack of glass sits below the page, and it has to be ON SCREEN, which
// is less obvious than it sounds. The camera is pixel-calibrated at z = 0
// only: a thing parked at z = 460 is a third again as far from the axis on
// screen as its world coordinates say, so an instrument shown at its
// working height sits far lower than where it was placed.
//
// Measured 2026-08-11, before the rack was flattened: at a 1100 px
// viewport the reducing glass and the paint scope were cut off by 88 and
// 67 px, and at 950 all three were — the whole rack, clipped, at every
// height anyone would use. Two things fix it and both are needed. Previews
// lie flat at z = 0 (`CHIP` shrinks them to fit), which is also where a
// rack of glass belongs; and BENCH_H reserves room for the rack rather
// than for the page alone.
//
// `opticsKit.test.ts` walks the rack against these numbers.

/** Where the rack sits, world y. */
export const RAIL_Y = -(SHEET.h / 2 + 80)

/** Half-height of the tallest rail preview, plus a little air. */
export const RAIL_ROOM = 62

/**
 * The height the bench needs to show everything at 1:1. Below this the
 * page scales down and the readout says so.
 */
export const BENCH_H = 2 * (Math.abs(RAIL_Y) + RAIL_ROOM)

export interface Specimen extends Block {
  /** What the readout calls it. */
  title: string
  /** Why it is on the bench — the reason it rewards a loupe. */
  note: string
}

export const SPECIMENS: readonly Specimen[] = [
  {
    id: 'aqua',
    x: 24,
    y: 24,
    w: 360,
    h: 176,
    title: 'Aqua sheet, 2001',
    note: '2px pinstripes — an accidental resolution chart',
  },
  {
    id: 'nokia',
    x: 408,
    y: 24,
    w: 224,
    h: 152,
    title: 'monochrome LCD',
    note: 'a pixel grid, and a clock that repaints once a second',
  },
  {
    id: 'luna',
    x: 656,
    y: 24,
    w: 260,
    h: 44,
    title: 'Luna taskbar, 2001',
    note: 'gel gradients and one-pixel bevels',
  },
  {
    id: 'calc',
    x: 656,
    y: 92,
    w: 210,
    h: 330,
    title: 'calculator, after Rams',
    note: 'it still computes with the glass on top of it',
  },
  {
    id: 'type',
    x: 24,
    y: 224,
    w: 360,
    h: 292,
    title: 'type specimen',
    note: '5.5pt text and quarter-pixel rules',
  },
  {
    id: 'ledger',
    x: 408,
    y: 200,
    w: 224,
    h: 300,
    title: 'fine print',
    note: 'tabular figures at the size nobody sets them',
  },
]

/** Page point → world point. */
export function pageToWorld(x: number, y: number): [number, number] {
  return [x - SHEET.w / 2, SHEET.h / 2 - y]
}

/**
 * A specimen's rectangle in world coordinates, bottom-left origin —
 * which is what `discCoversRect` clamps against, and what the scene
 * places the mesh by.
 */
export function worldRect(b: Block): Block {
  const [x, top] = pageToWorld(b.x, b.y)
  return { id: b.id, x, y: top - b.h, w: b.w, h: b.h }
}

/** Centre of a specimen in world coordinates — where its mesh sits. */
export function worldCenter(b: Block): [number, number] {
  return pageToWorld(b.x + b.w / 2, b.y + b.h / 2)
}

export const WORLD_RECTS: readonly Block[] = SPECIMENS.map(worldRect)
