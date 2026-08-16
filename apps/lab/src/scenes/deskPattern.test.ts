import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The genie desk carries a tiled pattern, and that pattern is not
// decoration as far as the rest of the repo is concerned: it is the
// GROUND every instrument in instruments/genie-drain measures ink
// against. Those probes find a sheet's edge by asking how far a pixel
// sits from the desk, and they find the shadow by asking how far it
// sits below it. Both questions have an answer only while the desk's
// own tones stay in a known place.
//
// The probes were taught to compare each pixel against the bench AT ITS
// OWN PHASE in the tile (a median per residue class, shadow-travels and
// mouth-anchor), which is what lets a patterned desk be measured at
// all — before that, every scan found the desk's rules and called them
// the sheet, and a held funnel came back the full width of the scan
// region on every row. But a per-phase ground removes the pattern from
// the arithmetic, not from the pixels. Two clearances still have to
// hold, and neither is visible from inside a stylesheet:
//
//   1. THE LIT SIDE MUST STAY UNDER THE PAPER. Window stock is
//      --bench-hi. A scan walks outward through a sheet while each
//      pixel is unlike the desk, and stops at the first pixel that is
//      the desk — so if the desk's brightest tone climbs to meet the
//      paper's, a scan stops inside the sheet it was measuring. This
//      very nearly happened on the first tuning: at 0.28 alpha the lip
//      composited 12 luma under stock, against a walk that continued
//      only above 12. The measurement survived on the accident that a
//      sheet squeezed to 59px is mostly text and darker than its own
//      paper. That is not a margin, so this file exists.
//
//   2. THE CUT MUST STAY ABOVE THE SHADOW. The shade is 0.15 of near
//      black over the bench, ~29 luma down (shadow-travels leg 1 pins
//      the separation). If the desk's darkest tone reaches down into
//      that band, a rule and a shadow become the same reading and the
//      leg that asks whether the shadow LEFT gets told it is still
//      there, by the desk.
//
// Both are stated here as arithmetic on the tokens rather than as a
// number someone measured once, so a retune of the pattern — a darker
// groove, a hotter highlight, a different bench — is checked in CI at
// the moment it is written instead of turning up as a probe that
// mysteriously reads 897px rows.

const ROOT = join(__dirname, '..', '..', '..', '..')
const APP_CSS = readFileSync(join(ROOT, 'apps/lab/src/app.css'), 'utf8')
const GENIE_CSS = readFileSync(join(ROOT, 'apps/lab/src/scenes/genie.css'), 'utf8')

/** sRGB luma, the same weights every probe in instruments/ uses. */
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

function hex(css: string, name: string): [number, number, number] {
  const m = new RegExp(`${name}:\\s*#([0-9a-f]{6})\\b`, 'i').exec(css)
  if (!m) throw new Error(`${name} is not declared as a 6-digit hex — this test cannot read it`)
  const v = parseInt(m[1], 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

function rgba(css: string, name: string): [number, number, number, number] {
  const m = new RegExp(`${name}:\\s*rgba?\\(([^)]+)\\)`, 'i').exec(css)
  if (!m) throw new Error(`${name} is not declared as an rgba() — this test cannot read it`)
  const p = m[1].split(',').map((s) => parseFloat(s.trim()))
  return [p[0], p[1], p[2], p[3] ?? 1]
}

/** Source-over: what the eye gets when `over` is laid on `under`. */
function composite(
  under: [number, number, number],
  over: [number, number, number, number],
): number {
  const a = over[3]
  return luma(
    over[0] * a + under[0] * (1 - a),
    over[1] * a + under[1] * (1 - a),
    over[2] * a + under[2] * (1 - a),
  )
}

/** Two layers of the same tone, as they land where the rules cross.
 *
 *  The pattern is two gradients, one per axis, and at every crossing
 *  BOTH of them paint — so the corner of a cell is not the tone the
 *  token names, it is that tone composited over itself. The difference
 *  is not small and it is in the dangerous direction: at 0.2 alpha the
 *  lit lip reads 224 along an edge and 230 at a crossing, and it is the
 *  230 that a scan meets. This test asserted the edge value first and
 *  cleared window stock by a comfortable-looking 15 luma while the real
 *  clearance was 9, against a walk that separates at 8. A probe caught
 *  it (2026-08-09) by reading a pixel the arithmetic said could not
 *  exist. So the extremes are computed the way the compositor makes
 *  them, and the edge tones are not what anything here is checked on. */
const twice = (under: [number, number, number], over: [number, number, number, number]) => {
  const a = over[3]
  return composite(under, [over[0], over[1], over[2], 1 - (1 - a) * (1 - a)])
}

describe('the desk pattern stays measurable', () => {
  const bench = hex(APP_CSS, '--bench')
  const stock = luma(...hex(APP_CSS, '--bench-hi'))
  const field = luma(...bench)
  const cut = twice(bench, rgba(GENIE_CSS, '--tile-lo'))
  const lip = twice(bench, rgba(GENIE_CSS, '--tile-hi'))

  it('reads as a groove at all — a light edge and a dark one', () => {
    // Below about six luma on a field this pale the pair stops reading
    // as a bevel and the desk goes back to being a flat colour, which
    // is the thing the pattern was added to fix. Stated as a floor so
    // the clearances below cannot be satisfied by deleting the pattern.
    expect(field - cut).toBeGreaterThan(6)
    expect(lip - field).toBeGreaterThan(6)
  })

  it('keeps its lit side clear of window stock', () => {
    // The edge walks in instruments/genie-drain ran at 8 (mouth-anchor,
    // removed 2026-08-15) and 6 (shadow-travels). A pixel of paper
    // sitting over a lip column has to still test as NOT-desk against
    // the lip's own ground, so the gap has to clear the larger of the
    // two with room. 8 is why this number is 12, and nothing walks at 8
    // any more.
    expect(stock - lip).toBeGreaterThan(12)
  })

  it('keeps its dark side clear of the shadow’s own tone', () => {
    // Not "the groove must be shallower than the drop is deep" — that
    // was the first spelling here and it compared quantities that do
    // not compete: a 1px rule and a 5px band of shade are not the same
    // mark at the same swing. What is worth pinning is the SEPARATION.
    // The shadow is the scene's delicate object, and the one thing that
    // must never happen is a pixel of desk reading as dark as a pixel
    // of shadow — because then the leg that asks whether the shadow has
    // left the funnel can be answered by the desk behind it. The
    // margin is the same 8 the edge walks separate at.
    const shadow = composite(bench, rgba(GENIE_CSS, '--shade'))
    expect(field - shadow).toBeGreaterThan(20) // the shadow itself still reads
    expect(cut - shadow).toBeGreaterThan(8)
  })

  it('is periodic, and says so in a property the probes can read', () => {
    // --tile is not a comment: shadow-travels asks the page for it and
    // builds its residue classes at that period. A
    // pattern whose real period stopped matching this number would be
    // measured against a ground averaged across phases, which is the
    // scalar ground all over again.
    const tile = parseFloat(/--tile:\s*([\d.]+)px/.exec(GENIE_CSS)?.[1] ?? 'NaN')
    expect(tile).toBeGreaterThanOrEqual(2)
    // Every gradient that draws the pattern has to end its cycle at
    // var(--tile) rather than at a literal, or the period the probes
    // are handed is not the period on screen — and a ground built at
    // the wrong period is a ground averaged across phases, which is the
    // scalar all over again with extra steps. Counted rather than
    // matched pair by pair: a gradient's own value contains rgba(...),
    // so there is no cheap regex for "one whole gradient", but the two
    // counts agreeing says every one of them carries the token.
    const decl = /background-image:([\s\S]*?);/.exec(GENIE_CSS)?.[1] ?? ''
    const cycles = decl.split('repeating-linear-gradient').length - 1
    expect(cycles).toBeGreaterThan(0)
    expect(decl.split('var(--tile)').length - 1).toBe(cycles)
  })
})
