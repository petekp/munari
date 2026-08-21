// The fisheye law — a magnifying lens over a column of content,
// anchored at its own focus.
//
// The law: local magnification is a raised cosine, m(d) = 1 + (A−1)·
// cos²(πd/2R) for |d| < R and 1 outside, and a point's displaced
// position is the integral of m from the top — shifted so the point AT
// the focus does not move. That anchor is what makes a pointer-driven
// lens stable: the pixels under the cursor stay under the cursor, so
// moving the focus to the cursor's own position never re-displaces the
// thing being pointed at. C¹ everywhere (the cosine reaches the rim at
// zero slope), closed form (∫cos²(ax) = x/2 + sin(2ax)/4a), monotone
// for any A ≥ 0 — so screen order is content order and the inverse
// exists.
//
// The x axis spreads about the panel's centerline by the SAME local
// factor m(d) — and m(d) is exactly d(displace)/dy, so the lens scales
// both axes equally at every point. Uniform local scale is the
// legibility law: text under the lens gets BIGGER, never taller. (The
// map is not conformal — ∂x'/∂y shears off-center rows where m
// changes — but m′ is zero at the focus, so the row being read is
// clean and the shear lives at the rim, where the eye reads shape,
// not glyphs.)
//
// This scene exists to pressure-test deformed-pose hit testing
// (core-animation item 2, 2026-08-19): three raycasts CPU geometry, so
// a mesh warped by this law on the CPU routes clicks where the pixels
// are, and a flat-pose mapping misses a rim row by (A−1)·R/2 px —
// 60 px at the defaults, more than a whole row. The gate
// (instruments/fisheye-pointer) clicks real coordinates against both
// predictions.

export interface FisheyeParams {
  /** Lens half-extent in content px: displacement is pure translation beyond it. */
  radius: number
  /** Peak magnification at the focus. 1 is a flat list. */
  amplitude: number
}

// radius spans ~2.7 rows of the scene's 44px list — wide enough that a
// neighbor row visibly swells before the cursor reaches it, narrow
// enough that the rim shift (A−1)·R/2 = 60px exceeds one row, which is
// what gives the gate its teeth (fisheyeLaw.test.ts pins the 60).
export const FISHEYE_DEFAULTS: FisheyeParams = { radius: 120, amplitude: 2 }

/** Local magnification at content position y for a lens at `focus`. */
export function fisheyeScale(
  y: number,
  focus: number,
  amplitude: number,
  p: FisheyeParams,
): number {
  const d = Math.abs(y - focus)
  if (d >= p.radius) return 1
  const c = Math.cos((Math.PI * d) / (2 * p.radius))
  return 1 + (amplitude - 1) * c * c
}

/**
 * Where content position y lands once the lens is applied. The lens
 * inserts (amplitude−1)·radius of extra height, split evenly above and
 * below the focus; the focus itself is the fixed point.
 */
export function fisheyeDisplace(
  y: number,
  focus: number,
  amplitude: number,
  p: FisheyeParams,
): number {
  const s = Math.min(p.radius, Math.max(-p.radius, y - focus))
  // ∫₋ᵣˢ cos²(πu/2R) du, the content the lens has grown between the
  // rim above and here. At s = 0 it is R/2, which is the anchor term.
  const grown =
    (s + p.radius) / 2 + (p.radius / (2 * Math.PI)) * Math.sin((Math.PI * s) / p.radius)
  return y + (amplitude - 1) * (grown - p.radius / 2)
}

/**
 * Where content x lands: spread about `center` by the local scale at
 * content y. The centerline is the fixed column; the local horizontal
 * scale equals the local vertical scale, which is what keeps glyphs
 * undistorted (the preamble's legibility law).
 */
export function fisheyeDisplaceX(
  x: number,
  y: number,
  center: number,
  focus: number,
  amplitude: number,
  p: FisheyeParams,
): number {
  return center + (x - center) * fisheyeScale(y, focus, amplitude, p)
}

/**
 * The content x that lands at displaced `targetX`, given the SOURCE y
 * (recover it with fisheyeSource first — the scale is read at the
 * content row, not the screen row). Closed form: the x map is linear.
 */
export function fisheyeSourceX(
  targetX: number,
  sourceY: number,
  center: number,
  focus: number,
  amplitude: number,
  p: FisheyeParams,
): number {
  return center + (targetX - center) / fisheyeScale(sourceY, focus, amplitude, p)
}

/**
 * The content position that lands at displaced position `target` —
 * the inverse of fisheyeDisplace, by bisection (monotone, no closed
 * form: the forward map mixes y with sin(y)).
 */
export function fisheyeSource(
  target: number,
  focus: number,
  amplitude: number,
  p: FisheyeParams,
): number {
  const spread = ((amplitude - 1) * p.radius) / 2 + 1
  let lo = target - spread
  let hi = target + spread
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2
    if (fisheyeDisplace(mid, focus, amplitude, p) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
