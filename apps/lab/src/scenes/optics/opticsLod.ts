// Which blocks sharpen, and for how long.
//
// A Surface has one resolution tier, so a page that wants detail only
// under the glass has to be several Surfaces. The instrument reads a disc
// of page (opticsLaw's `footprint`); every block that disc touches gets
// pinned to the instrument's tier, and everything else stays at 'auto'.
// That contrast is the entire demonstration — a page pinned high
// throughout would be sharp beside the glass too, and there would be
// nothing to see.
//
// The hysteresis is not a nicety. A tier change is a re-raster, which
// platform.md item 6 measures at exactly one paint, and a loupe dragged
// along a row of blocks crosses edges continuously. Without a hold, a
// block on the boundary re-rasters on alternate frames. With one, it
// sharpens once on arrival and stays sharp for `holdMs` after the glass
// leaves — so a hand that wanders back pays nothing, and the paint scope
// shows a single flash per block instead of a stutter.

import type { Disc } from './opticsLaw'

export interface Block {
  id: string
  /** Page coordinates of the block's top-left corner, px. */
  x: number
  y: number
  w: number
  h: number
}

/**
 * Disc/rectangle overlap, by nearest point.
 *
 * The nearest point of the rectangle to the disc's centre is the centre
 * clamped into the rectangle; the two overlap when that point is within
 * the radius. Testing bounding boxes instead would claim every block
 * diagonally past a corner — which is how a loupe ends up pinning a block
 * it cannot see.
 *
 * Tangency counts as covering. Pinning one block too many costs one paint
 * of a tier nobody looks at; pinning one too few puts a soft patch under
 * the glass, which is the failure the scene exists to avoid.
 */
export function discCoversRect(disc: Disc, rect: Block): boolean {
  const nx = Math.min(Math.max(disc.x, rect.x), rect.x + rect.w)
  const ny = Math.min(Math.max(disc.y, rect.y), rect.y + rect.h)
  return Math.hypot(disc.x - nx, disc.y - ny) <= disc.r
}

export function coveredBlocks(blocks: readonly Block[], disc: Disc | null): string[] {
  if (!disc) return []
  return blocks.filter((b) => discCoversRect(disc, b)).map((b) => b.id)
}

/**
 * A block's claim on a high tier. `until` is Infinity while the glass is
 * still over it, and a wall-clock deadline once the glass has left.
 */
export interface Hold {
  id: string
  until: number
}

/**
 * Advance the holds by one frame.
 *
 * Covered blocks are held open. Uncovered ones keep whatever deadline they
 * already had — the clock starts when the glass leaves and does not
 * restart on later frames, or a slow drag along an edge would extend the
 * hold forever. Expired ones fall off.
 *
 * Sorted by id, so the caller can join the result into a key and compare
 * it: React state should change when the pinned SET changes, not every
 * frame the deadlines tick.
 */
export function updateHolds(
  prev: readonly Hold[],
  covered: readonly string[],
  now: number,
  holdMs: number,
): Hold[] {
  const live = new Set(covered)
  const next: Hold[] = covered.map((id) => ({ id, until: Infinity }))
  for (const h of prev) {
    if (live.has(h.id)) continue
    const until = h.until === Infinity ? now + holdMs : h.until
    if (until > now) next.push({ id: h.id, until })
  }
  return next.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** The pinned set as a stable, comparable key. */
export function holdKey(holds: readonly Hold[]): string {
  return holds.map((h) => h.id).join(' ')
}
