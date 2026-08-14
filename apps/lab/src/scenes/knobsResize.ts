// What happens when a hand changes the panel's size.
//
// Two laws live here, because they are the same question asked at two
// scales: what width a corner drag is allowed to ask for, and how the
// machined rim follows that width without being machined again.
//
// The scene already measures its own layout — the 3D knobs, levers,
// lamps and screws are placed from the captured DOM's own rects, not
// from a duplicated layout (`Knobs.tsx`, `onHost`). So a container
// query that moves a control moves its hardware for free. What does NOT
// come for free is everything sized in world units: the slab plane, the
// corona quad, the capture texture, and the rim's extruded chamfer.
// This module is about those.
//
// The physical rule the whole thing obeys: **hardware does not scale,
// it re-lays-out.** A rotary is 20 mm on a small panel and 20 mm on a
// large one. So no constant in `knobsGeometry` is a function of panel
// width; the width only decides how many controls fit in a row, which
// is exactly the question a container query answers.

import { PANEL_RADIUS } from './knobsGeometry'

/** The narrowest the panel may be dragged. Below roughly this the
 *  single-column layout stops being a machined panel and starts being a
 *  strip; it must also stay clear of `2 × PANEL_RADIUS`, or the rim's
 *  straight spans invert (the suite pins that bound). */
export const PANEL_MIN_W = 232

/** The widest. Beyond this the capture texture costs more than the demo
 *  is worth, and the slab stops reading as a hand-held instrument. */
export const PANEL_MAX_W = 560

/** The drag quantum, px. One, because the step no longer buys anything.
 *
 *  This constant used to be a budget. Each new width restyles the
 *  container-query subtree, re-runs the layout engine inside the
 *  capture, and rasterizes the panel again, and that used to price the
 *  finest steps out (cap-probe33, an 88 px pull):
 *
 *      step   distinct widths   p95 frame   frames > 20ms
 *        1          88            25.3 ms        20
 *        2          44             9.3 ms         2
 *        4          22             9.1 ms         0
 *        8          11             9.3 ms         0
 *
 *  8 was the first value here, and it was too coarse to feel like
 *  dragging. Note what that meant: the frames were already on time at
 *  8, and the MOTION was still steppy. A clean frame graph is not a
 *  smooth gesture, and only one of the two can be felt. So the constant
 *  sat at 2, buying motion with frames.
 *
 *  The trade is gone. Almost all of that per-width cost was one thing:
 *  re-rasterizing 44 blurred tick notches inside the dials, for a
 *  result that cannot differ, because a dial is 20 mm at every panel
 *  width. `.knb-resizing` in knobs.css now says so to the compositor
 *  for the length of the gesture. The same sweep, warm, measured in
 *  both directions (cap-probe45):
 *
 *      step   distinct widths   p95 up / down   frames > 20ms
 *        1          88            8.7 / 10.0        0 / 0
 *        2          44           10.1 /  9.4        0 / 0
 *        4          22            9.5 /  9.2        0 / 0
 *        8          11            8.8 /  8.5        0 / 0
 *
 *  Every step now costs the same, so take the finest. Against a plain
 *  DOM copy of the same panel pulled the same distance — the floor this
 *  was aiming at — the whole path through the Surface runs p95 9.0 ms
 *  to the floor's 8.4 ms, both dropping nothing (cap-probe44).
 *
 *  Read the first table before deleting the second: measure the sweep
 *  cold and step 1 reads 41.6 ms, because the first pull after a load
 *  pays for warm-up and nothing else. That reading is run order, not
 *  the quantum.
 *
 *  The step also protects the idle-zero gate: a fractional width can
 *  leave a layout relaying out forever, and a quiescent Surface must
 *  return to 0 paints/s the instant the hand lets go. An integer step
 *  of 1 still satisfies that; a step of 0.5 would not. */
export const PANEL_W_STEP = 1

/** How close the panel may come to the edge of the glass, px. */
export const PANEL_EDGE_INSET = 26

/**
 * The width a corner drag asks for: the start width plus the hand's
 * travel, quantized, then clamped — against the fixed bounds and
 * against the glass, so a panel can never be dragged wider than the
 * window that has to hold it.
 *
 * `dx` is screen travel. The slab carries a small standing yaw, so a
 * screen pixel is not exactly a panel pixel; at the yaws this scene
 * uses the error is under a percent, and the carry handle already makes
 * the same approximation.
 */
export function resizeWidth(startW: number, dx: number, viewportW: number): number {
  const ceiling = Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, viewportW - PANEL_EDGE_INSET * 2))
  const stepped = Math.round((startW + dx) / PANEL_W_STEP) * PANEL_W_STEP
  return Math.min(ceiling, Math.max(PANEL_MIN_W, stepped))
}

/**
 * Half the panel's straight span on one axis — the part of the outline
 * between the two corner arcs.
 *
 * This is the whole trick of the nine-slice, and it holds for every
 * ring of the extrusion at once. An `ExtrudeGeometry` bevel offsets the
 * outline along its own normal, which grows the half-extent and the
 * corner radius by the SAME amount, so `half − radius` is invariant
 * across rings. One threshold classifies the base outline, the bevel
 * rings, and the front and back caps together — no per-ring bookkeeping,
 * and no vertex near a corner can be misfiled into a straight span.
 */
export function straightHalf(half: number, radius: number): number {
  return Math.max(0, half - radius)
}

/**
 * Move one coordinate from the built size to the live size.
 *
 * Corner arcs translate rigidly; the straight spans between them
 * stretch. That is what keeps the chamfer honest — a corner that
 * stretched would show an oval bevel, and a bevel is a machining fact,
 * not a proportion. It also keeps every normal correct without
 * recomputing one: a rigid translation cannot turn a normal, and
 * stretching a straight edge along its own direction cannot either.
 *
 * `d` is the change in half-extent on this axis.
 */
export function sliceCoord(v: number, sh: number, d: number): number {
  if (v > sh) return v + d
  if (v < -sh) return v - d
  // The straight span has to end where the corner arc now begins.
  return sh > 0 ? (v * (sh + d)) / sh : v
}

/**
 * Re-fit a built extrusion to a new panel size, in place.
 *
 * `base` is the position buffer as machined, kept unchanged so every
 * resize remaps from the original rather than compounding rounding.
 * `out` receives the result; the two may not be the same array.
 * Dimensions are the PANEL's, not the rim's — the bezel lip cancels out
 * of `half − radius`, so the rim's own outset never enters here.
 *
 * z is copied untouched: depth is a property of the aluminum, not of
 * how wide the panel happens to be.
 */
export function nineSlice(
  base: Float32Array,
  out: Float32Array,
  w0: number,
  h0: number,
  w1: number,
  h1: number,
  radius: number = PANEL_RADIUS,
): void {
  const shX = straightHalf(w0 / 2, radius)
  const shY = straightHalf(h0 / 2, radius)
  const dX = (w1 - w0) / 2
  const dY = (h1 - h0) / 2
  for (let i = 0; i < base.length; i += 3) {
    out[i] = sliceCoord(base[i], shX, dX)
    out[i + 1] = sliceCoord(base[i + 1], shY, dY)
    out[i + 2] = base[i + 2]
  }
}
