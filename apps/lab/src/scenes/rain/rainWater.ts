// Rain water — a per-column height field for water pooling in glyph ink.
//
// The law: a headline's terrain is one number per CSS-px column — the
// topmost opaque pixel's y, or RAIN_NO_SURFACE where the column has no ink
// at all. Water lives on top of that terrain as a depth per column. A
// fixed step trades depth between adjacent ink columns toward equal
// surface height (topInk - depth), the way a shallow basin levels itself;
// a column open to a gap or to the terrain's own edge has no wall on that
// side, so depth past a thin wetting film there is excess, and comes back
// to the caller as a spill to be reborn as a falling drop.
//
// Ownership: this module owns the terrain and water types and their pure
// evolution. It knows nothing about the DOM (rainGlyphMask.ts turns a live
// h1 into a GlyphTerrain) or about the rest of the drop world (rainLaw.ts
// calls depositWater when a falling drop lands here and folds spills back
// into its own drop list).

/** A column with no ink anywhere — larger than any real viewport y, so it
 * always fails a "does this crossing land" comparison. */
export const RAIN_NO_SURFACE = Number.POSITIVE_INFINITY

/** One number per CSS-px column across a headline's rect. */
export interface GlyphTerrain {
  /** Viewport x of column 0 — column i sits at left + i. */
  readonly left: number
  /** Topmost opaque pixel's viewport y per column, or RAIN_NO_SURFACE. */
  readonly topInk: readonly number[]
}

export interface WaterField {
  readonly terrain: GlyphTerrain
  /** Standing water depth per column, px, 0..RAIN_WATER_DEPTH_CAP_PX. */
  readonly depth: readonly number[]
}

export interface WaterSpill {
  readonly x: number
  readonly y: number
  readonly volume: number
}

// Deep enough that a bowl in the 110px display face visibly fills toward
// its rim before spilling — at 10px the "filled letter" moment read as a
// hairline film (2026-09-01 capture). The cap is a flood guard, not the
// look; open bowls should reach their own rims first and spill there.
export const RAIN_WATER_DEPTH_CAP_PX = 34
// A column left with this little water reads as a wetted rim rather than a
// bead — spills stop taking volume below it so an open edge does not
// perpetually leak its last trace every step.
export const RAIN_WATER_FILM_PX = 0.6
// Exchange rate between two neighboring columns per pixel of surface
// difference. At the fixed 1/60s step this is a coefficient of 0.1 per
// step — a difference decays by roughly two-thirds within 0.15s, quick
// enough to read as settling water, far under the ~0.5 coefficient where
// this explicit scheme would start to overshoot and oscillate.
export const RAIN_WATER_FLOW_RATE = 6
// A landed drop's volume spreads across this many ink columns centered on
// where it lands, so one bead becomes a wetted patch instead of a
// single-column spike.
export const RAIN_WATER_DEPOSIT_SPREAD = 3
// Combined depth across every column — the unit is px·columns, so one
// filled letter bowl (~60 columns × 30px deep) alone holds ~1800. At the
// old 700 the total cap bound before a single bowl could fill, which is
// why no amount of per-drop volume ever showed pooling (2026-09-01
// capture). Five bowls' worth, so the headline can visibly fill without
// the whole face flooding.
export const RAIN_WATER_TOTAL_CAP_PX = 9000

export function createWaterField(terrain: GlyphTerrain): WaterField {
  return { terrain, depth: terrain.topInk.map(() => 0) }
}

/** The terrain column under a viewport x, or -1 if x falls outside it. */
export function terrainColumn(terrain: GlyphTerrain, x: number): number {
  const column = Math.round(x - terrain.left)
  if (column < 0 || column >= terrain.topInk.length) return -1
  return column
}

function totalDepth(depth: readonly number[]): number {
  let sum = 0
  for (const d of depth) sum += d
  return sum
}

/** Spread a landed drop's volume across a few ink columns around one column index. */
export function depositWater(field: WaterField, column: number, volumePx: number): WaterField {
  const { terrain } = field
  const topInk = terrain.topInk
  const half = Math.floor(RAIN_WATER_DEPOSIT_SPREAD / 2)
  const columns: number[] = []
  for (let i = column - half; i <= column + half; i++) {
    if (i < 0 || i >= topInk.length) continue
    if (topInk[i] === RAIN_NO_SURFACE) continue
    columns.push(i)
  }
  if (columns.length === 0) return field

  const depth = field.depth.slice()
  const room = Math.max(0, RAIN_WATER_TOTAL_CAP_PX - totalDepth(depth))
  const applied = Math.min(volumePx, room)
  const share = applied / columns.length
  for (const i of columns) depth[i] = Math.min(RAIN_WATER_DEPTH_CAP_PX, depth[i] + share)
  return { terrain, depth }
}

interface WaterStepResult {
  readonly field: WaterField
  readonly spills: readonly WaterSpill[]
}

/** Advance the water field one fixed step: level within basins, then spill past open edges. */
export function stepWaterField(field: WaterField, dt: number): WaterStepResult {
  const { terrain } = field
  const topInk = terrain.topInk
  const depth = field.depth.slice()

  // Level: every adjacent pair of ink columns trades volume toward equal
  // surface height, whether or not either currently holds water — this is
  // what lets a full basin push water over a dry, taller neighbor and on
  // toward the next basin, one step at a time, rather than needing a
  // special case for crossing an interior wall.
  for (let i = 0; i < topInk.length - 1; i++) {
    const a = topInk[i]
    const b = topInk[i + 1]
    if (a === RAIN_NO_SURFACE || b === RAIN_NO_SURFACE) continue
    const surfaceA = a - depth[i]
    const surfaceB = b - depth[i + 1]
    // Positive flow moves volume from i toward i+1. A smaller surface
    // number is a physically higher water line (less y is further up the
    // page), so column i is the fuller one, and should be the source,
    // exactly when its surface is smaller than i+1's — i.e. flow tracks
    // (surfaceB - surfaceA), not the other way around.
    let flow = (surfaceB - surfaceA) * RAIN_WATER_FLOW_RATE * dt
    flow = Math.max(-depth[i + 1], Math.min(depth[i], flow))
    depth[i] -= flow
    depth[i + 1] += flow
  }

  // Spill: a column open to a gap, or to the terrain's own edge, has no
  // wall on that side. Depth there past the wetting film is excess.
  const spills: WaterSpill[] = []
  for (let i = 0; i < topInk.length; i++) {
    const top = topInk[i]
    if (top === RAIN_NO_SURFACE) continue
    const leftOpen = i === 0 || topInk[i - 1] === RAIN_NO_SURFACE
    const rightOpen = i === topInk.length - 1 || topInk[i + 1] === RAIN_NO_SURFACE
    if (!leftOpen && !rightOpen) continue
    const excess = depth[i] - RAIN_WATER_FILM_PX
    if (excess <= 0) continue
    depth[i] -= excess
    spills.push({ x: terrain.left + i, y: top - RAIN_WATER_FILM_PX, volume: excess })
  }

  return { field: { terrain, depth }, spills }
}
