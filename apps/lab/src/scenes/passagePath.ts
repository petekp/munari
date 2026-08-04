// The passage — the pure half: where a card is, how big it is, and how it
// gets from one box to another.
//
// Split out from the scene for the ordinary reason (this part is arithmetic
// and can be tested without a browser) and one specific one: the claim the
// whole lab makes is that the destination is MEASURED, never authored. Every
// function here takes rects that came from `getBoundingClientRect` and
// returns something derived from them. There is not one tuned constant that
// describes where a card ends up, because nothing here is allowed to have an
// opinion about that — the page's own layout already answered.

/** A box in page coordinates, as `getBoundingClientRect` hands it over. */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** A pose on the pixel-perfect plane, plus the size the DOM should lay out at. */
export interface Pose {
  x: number
  y: number
  z: number
  rotX: number
  rotY: number
  width: number
  height: number
}

export function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/**
 * A page rect, as a world pose on the plane z = 0.
 *
 * This is the entire coordinate system of the lab and it is three lines,
 * because `PixelPerfect` puts the camera exactly far enough back that the
 * frustum IS the viewport at z = 0. A CSS pixel is a world unit; the origin
 * is the viewport centre; y is up. So a rect does not need converting into a
 * pose — it already is one, and this function only re-centres it.
 */
export function centreOf(box: Box, viewW: number, viewH: number): { x: number; y: number } {
  return {
    x: box.left + box.width / 2 - viewW / 2,
    y: viewH / 2 - (box.top + box.height / 2),
  }
}

/**
 * One step of a critically damped spring, implicit (unconditionally stable at
 * any dt — an explicit one blows up the first time a tab is backgrounded and
 * hands you a 400 ms frame).
 *
 * A spring rather than a duration-and-easing because this transition must be
 * REVERSIBLE MID-FLIGHT. Pressing back while the card is still on its way out
 * moves the target, not the clock: the card carries its momentum through the
 * turn and comes home. A scripted ease has to be cancelled and restarted from
 * wherever it happened to be, which is where the seam always shows.
 */
export function springStep(
  x: number,
  v: number,
  target: number,
  omega: number,
  dt: number,
): [x: number, v: number] {
  const f = 1 + 2 * dt * omega
  const oo = omega * omega
  const hoo = dt * oo
  const hhoo = dt * hoo
  const detInv = 1 / (f + hhoo)
  const detX = f * x + dt * v + hhoo * target
  const detV = v + hoo * (target - x)
  return [detX * detInv, detV * detInv]
}

/** Settled means both: near the target AND no longer moving. */
export function atTarget(x: number, v: number, target: number): boolean {
  return Math.abs(target - x) < 0.0015 && Math.abs(v) < 0.02
}

/**
 * The pose at progress `t` along a passage from one page box to another.
 *
 * `width`/`height` are the interesting return values. They are not a scale
 * factor and they are not a texture size — they are the size the element's
 * DOM is laid out at on this frame, and the component answers them with a
 * container query (platform.md #11). Interpolating the BOX is what makes the
 * layout engine, rather than an interpolator, decide what the card looks like
 * halfway.
 *
 * The lift is a half-sine: on the plane at both ends, so the departure and
 * the arrival are pixel-for-pixel copies of the DOM they replace, and nearest
 * the eye in the middle, where the tilt is also widest. The tilt leans into
 * the direction of travel — a card crossing to the right banks right, which
 * is the only cue that says "this is a solid thing moving through a room"
 * rather than "this is a rectangle being tweened".
 */
export function poseAt(
  from: Box,
  to: Box,
  t: number,
  viewW: number,
  viewH: number,
  lift: number,
  tilt: number,
  measuredHeight?: number | null,
): Pose {
  const clamped = Math.min(1, Math.max(0, t))
  const arc = Math.sin(Math.PI * clamped)

  // Position and size travel on DIFFERENT curves, and the reason is the
  // viewport rather than taste. A card that grows at the same rate it moves
  // is at its widest exactly when it is also furthest from its destination
  // and nearest the eye — three magnifications at once — and it walks off the
  // edge of the screen (measured at lift 300: the midpoint overhung the left
  // edge by a third of the card). Moving early and growing late keeps the
  // whole path on screen. Both exponents are identity at 0 and 1, so the ends
  // are still exact.
  const tPos = Math.pow(clamped, 0.72)
  const tSize = Math.pow(clamped, 1.5)

  const width = from.width + (to.width - from.width) * tSize
  // The HEIGHT IS NOT INTERPOLATED when the caller can measure it, and this
  // is the correction that mattered most. How tall a responsive component is
  // at width w is decided by its layout, not by a straight line between two
  // known heights — it steps at every container breakpoint, and a two-column
  // shape is far shorter than the stacked one it came from. Interpolating it
  // meant the Surface was routinely taller than the card inside it, and the
  // empty strip of parked canvas below showed as a pale band under the card
  // for the whole flight.
  //
  // So: interpolate the INPUT (width), measure the OUTPUT (height). Which is
  // also the more honest version of the claim this lab is making.
  const height =
    measuredHeight != null && measuredHeight > 0
      ? measuredHeight
      : from.height + (to.height - from.height) * tSize

  // Interpolate the TOP-LEFT rather than the centre, so a measured height
  // grows the card downward the way a taller box grows on a page — a card
  // whose centre was pinned would push its own header upward as it opened.
  const left = from.left + (to.left - from.left) * tPos
  const top = from.top + (to.top - from.top) * tPos
  const centre = centreOf({ left, top, width, height }, viewW, viewH)

  const a = centreOf(from, viewW, viewH)
  const b = centreOf(to, viewW, viewH)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const span = Math.hypot(dx, dy) || 1
  return {
    x: centre.x,
    y: centre.y,
    z: lift * arc,
    // Pitch reads as the card leaning back as it rises; yaw as it banking
    // into the turn. Both are proportional to how much of the move is on
    // that axis, so a card that only moves down does not mysteriously twist.
    rotX: (-tilt * arc * dy) / span,
    rotY: (tilt * arc * dx) / span,
    width,
    height,
  }
}

/**
 * Texel density for a card at depth `z`, given the page's own device ratio.
 *
 * A card on the plane is 1 CSS px to 1 device px × dpr, full stop. Lifted
 * toward the eye it covers more of the display and needs proportionally more
 * texels to stay 1 : 1 — `camZ / (camZ - z)` is that magnification exactly.
 *
 * Following z continuously is normally an expensive thing to want (every
 * change re-rasterizes). Here it is FREE, and for a reason specific to this
 * lab: the card is being resized every frame anyway, so it is already
 * re-rasterizing every frame. The density may as well be right.
 *
 * The clamp is the texture guard, not taste: `Surface` warns past a 4096 px
 * long edge, and a warning per frame is its own kind of bug.
 */
export function densityAt(dpr: number, camZ: number, z: number, w: number, h: number): number {
  const magnified = dpr * (camZ / Math.max(1, camZ - z))
  const ceiling = 4000 / Math.max(1, w, h)
  return Math.max(0.5, Math.min(magnified, ceiling))
}
