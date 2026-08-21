// The curl law — a flat sheet wound into a spiral at a moving hinge.
//
// Two candidates share it: the dropdown that unrolls, and the peel-away
// deletion. Both are the same sheet with a different anchored edge, so the
// law is written once in one dimension — distance from the edge that never
// moves — and each scene decides whether that axis is the sheet's height
// or its width.
//
// The material is INEXTENSIBLE, which is the whole reason this is a law
// and not a sine wave. Arc length is the parameter: a point 40px along the
// sheet is 40px along the sheet whether that 40px is lying flat or wound
// twice around the roll. Get this wrong by parameterizing on the flat
// coordinate instead and the sheet visibly stretches as it curls.
//
// The roll is a SPIRAL, not a circle, and the thickness term is why. Wind
// more than one turn onto a fixed circle and every turn lands on the same
// ring: the fault, 2026-08-20, was a 430px row wound seven turns onto a
// 9px circle — seven coincident layers of texture, which drew as an
// unreadable tube. Each turn now sits `thickness` px outside the one
// before it, so a fully wound sheet is a nested coil at every wind angle.
//
// Ownership: this module owns the shape of a rolled sheet and nothing
// else. It has no opinion about time, easing, or which edge is anchored.

export interface CurlSample {
  /** Distance from the anchored edge, after winding. Always ≤ the input. */
  along: number
  /** Height off the page plane, toward the camera. */
  lift: number
  /** Unit surface normal, in the same (along, lift) plane. */
  normalAlong: number
  normalLift: number
  /** Radians of wind at this point. 0 anywhere on the flat part. */
  wind: number
}

/**
 * Where the material at arc length `s` ends up when `unrolled` of the
 * sheet is lying flat and the rest is wound into a spiral whose innermost
 * turn has `radius` and whose turns sit `thickness` apart.
 *
 * `total` is the sheet's full length; the wound portion is `total -
 * unrolled`. The sheet feeds onto the OUTSIDE of the roll, so the material
 * just past the hinge rides the outermost turn and the free end sits at
 * the core — which is what a poster does, and what keeps the hinge tangent
 * to the page.
 *
 * The roll curls back OVER the flat part, toward the camera, which puts
 * the lit side of the roll where a viewer can see it.
 */
export function curlSample(
  s: number,
  unrolled: number,
  total: number,
  radius: number,
  thickness: number,
): CurlSample {
  if (s <= unrolled || radius <= 0) {
    return { along: s, lift: 0, normalAlong: 0, normalLift: 1, wind: 0 }
  }
  const wound = Math.max(0, total - unrolled)
  const k = thickness / (2 * Math.PI)

  // Total wind angle W and outer radius: arc length of the spiral from the
  // core out is radius·W + k·W²/2, inverted here for W.
  const W =
    k > 0
      ? (-radius + Math.sqrt(radius * radius + 2 * k * wound)) / k
      : wound / radius
  const outer = radius + k * W

  // Wind angle at this point, measured from the hinge inward: arc length
  // from the hinge is outer·w − k·w²/2. The smaller quadratic root is the
  // physical one — the larger lies past the core.
  const arc = Math.min(s - unrolled, wound)
  const w =
    k > 0
      ? (outer - Math.sqrt(Math.max(0, outer * outer - 2 * k * arc))) / k
      : arc / radius
  const r = outer - k * w

  return {
    along: unrolled - r * Math.sin(w),
    // The spiral's centre sits `outer` above the page so the hinge stays
    // tangent; deeper turns hang from it at their own smaller radius.
    lift: outer - r * Math.cos(w),
    normalAlong: Math.sin(w),
    normalLift: Math.cos(w),
    wind: w,
  }
}

/** t runs 0 (fully rolled) → 1 (fully flat). At t = 0 nothing is flat. */
export function unrolledLength(t: number, total: number): number {
  return total * Math.max(0, Math.min(1, t))
}
