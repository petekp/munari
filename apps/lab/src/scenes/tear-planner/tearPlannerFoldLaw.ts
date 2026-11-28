// Tear-off page fold — where a sheet glued along its top perforation goes
// when its corner is pulled toward the hand.
//
// The law: a sheet lifted by its corner rolls into a loop standing out from
// the wall. The loop is a cylinder of radius r on a crease line n·x = s0,
// where n points from the hand to the grabbed point G. G sits at arc length
// L = n·G - s0 from the crease, wrapped by the angle a = L / r, and it
// appears at s0 + r·sin(a) along n, so solving for the hand gives
// r = pull / (a - sin a). The wrap a grows from a quarter turn for a small
// lift to a half turn when the hand has travelled one sheet height, which
// is when the crease reaches the perforation on a straight pull.
//
// Glued points on the top edge (y = 0, left of the tear front) may not be
// lifted, so the crease stops at the perforation and G falls short of the
// hand. That shortfall is the tension. Past PERFORATION_SLACK_PX the
// perforation gives from its right end: the tear front runs left exactly as
// far as keeps the tension at the slack, so a fast hand tears fast and a
// still hand stops the tear. The sheet is free when the front reaches x = 0.
//
// Coordinates are page CSS pixels: origin at the sheet's top-left, +x
// right, +y down, z toward the viewer.

import type { DeformedPoint } from '@petepetrash/munari/gpu'

/** Centre-to-centre pitch of the perforation holes, in page px (1.5 mm at 4 px/mm). */
export const HOLE_PITCH_PX = 6

/** A roll: crease line n·x = s0, radius r. */
export interface Fold {
  readonly nx: number
  readonly ny: number
  readonly s0: number
  readonly r: number
}

export interface FoldSolution {
  /** null when the hand is on the grabbed point: the sheet is flat. */
  readonly fold: Fold | null
  /** How far past the perforation the crease would have to go to reach the hand, in px. */
  readonly tension: number
  /** The tear front after this step: x of the leftmost torn perforation point. */
  readonly tearFront: number
}

/**
 * How far past the perforation the hand can pull before it starts to give,
 * in px. A lab tuning: at 26 px the crease visibly stops at the binding
 * before the first hole goes.
 */
export const PERFORATION_SLACK_PX = 26

/**
 * The tear always runs from the right end, as if the pull leaned at least
 * this much toward it. A straight-up pull then tears across in a quarter of
 * a sheet width of further travel, instead of letting go all at once.
 */
const TEAR_LEAN = 0.25

/** The flap past a half turn lies at least this far above the page, so depth never ties. */
const FLAP_MIN_LIFT = 1.5

function wrapFor(pull: number, sheetHeight: number): number {
  const t = Math.min(1, pull / sheetHeight)
  return Math.PI / 2 + (Math.PI / 2) * t * t * (3 - 2 * t)
}

/**
 * One step of the sheet: grabbed point G, hand P (both page px), the tear
 * front before this step and the sheet's size. Never moves the front right,
 * and moves it left only while `pulling`: a sheet springing back after the
 * hand lets go does not tear itself.
 */
export function solveFold(
  gx: number,
  gy: number,
  px: number,
  py: number,
  tearFront: number,
  sheet: { readonly width: number; readonly height: number },
  pulling: boolean,
): FoldSolution {
  const vx = gx - px
  const vy = gy - py
  const pull = Math.hypot(vx, vy)
  if (pull < 0.5) return { fold: null, tension: 0, tearFront }
  const nx = vx / pull
  const ny = vy / pull
  const wrap = wrapFor(pull, sheet.height)
  const along = nx * gx + ny * gy
  const free = along - (pull / (wrap - Math.sin(wrap))) * wrap

  // The front where the tension at the right end equals the slack. For a
  // pull leaning right (nx >= TEAR_LEAN) this is exactly where the crease
  // meets the glued edge; a steeper pull spreads the same travel over
  // 1 / TEAR_LEAN of perforation. It depends on the hand alone, so a still
  // hand holds the tear where it is.
  const lean = Math.max(nx, TEAR_LEAN)
  const settledFront = sheet.width - (Math.max(0, nx) * sheet.width - free - PERFORATION_SLACK_PX) / lean
  const front = pulling ? Math.max(0, Math.min(tearFront, settledFront)) : tearFront
  const glued = Math.max(0, nx * front)
  const s0 = Math.max(free, glued)
  const r = Math.max(1, (along - s0) / wrap)
  return { fold: { nx, ny, s0, r }, tension: Math.max(0, s0 - free), tearFront: front }
}

/** Where material point (x, y) of the sheet sits under `fold`. */
export function foldPoint(x: number, y: number, fold: Fold | null): DeformedPoint {
  if (!fold) return { x, y, z: 0 }
  const { nx, ny, r } = fold
  const d = x * nx + y * ny - fold.s0
  if (d <= 0) return { x, y, z: 0 }
  const half = Math.PI * r
  if (d <= half) {
    const a = d / r
    const shift = r * Math.sin(a) - d
    return { x: x + shift * nx, y: y + shift * ny, z: Math.max(r * (1 - Math.cos(a)), (FLAP_MIN_LIFT * d) / half) }
  }
  const shift = half - 2 * d
  return { x: x + shift * nx, y: y + shift * ny, z: Math.max(2 * r, FLAP_MIN_LIFT) + (d - half) * 0.01 }
}
