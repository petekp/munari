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

import { clampScale, pixelGridSnap, texelDemand } from '@petepetrash/munari'

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
 * A passage is over when the card has arrived AND the box it arrived in is the
 * box the page is taking back.
 *
 * Two springs run in a flight — one for where the card is, one for how tall it
 * is (`followHeight`) — and they do not finish together. Measured: the
 * position settles with the height still 1.9 px short, so the mesh unmounts
 * and the DOM reappears 1.9 px taller in the same frame. That is a twitch at
 * the landing, and it is the exact failure `poseAt`'s end-exactness tests
 * exist to prevent — they just could not see it, because they only ever looked
 * at one spring.
 *
 * Cheap to state because `followHeight` snaps rather than converging: settled
 * really is equality.
 */
export function landed(
  x: number,
  v: number,
  target: number,
  height: number,
  natural: number,
): boolean {
  return atTarget(x, v, target) && height === natural
}

/**
 * How fast the card's box chases the height its layout just asked for.
 *
 * Fast enough that the box is never visibly behind the content, slow enough
 * that a breakpoint's step is crossed over frames instead of within one. At
 * 30 the 88 px step this component actually has (measured below) is closed in
 * about 100 ms, peaking near 8 px per frame at 120 Hz.
 */
export const HEIGHT_OMEGA = 30

/**
 * The height the card's box uses, chasing the height its layout wants.
 *
 * Interpolating the height was wrong (a responsive component's height is not
 * a line between two known heights) and so is using the measurement raw,
 * which is what shipped. The layout's honest answer is a STEP FUNCTION of
 * width: swept 1 px at a time in Chrome, this component's height jumps +29 px
 * crossing its 430 px breakpoint, +88 px crossing its 720 px one, and drops
 * about 19 px five separate times as paragraphs lose a line. Rendered
 * faithfully, a card in flight snaps vertically seven times in 700 ms — every
 * frame correct, the whole thing unwatchable.
 *
 * So the box FOLLOWS the measurement rather than equalling it: same critically
 * damped spring as the flight itself, just stiffer. The layout is not being
 * smoothed — the DOM still reflows at every intermediate width, and the height
 * this returns still comes from nothing but what the layout answered. What is
 * smoothed is how fast the BOX is allowed to adopt it.
 *
 * The snap matters as much as the follow. A follower only ever approaches its
 * target, and a card that lands half a pixel off the DOM it is handing back to
 * is a seam at the one moment the whole handoff is judged.
 */
export function followHeight(
  h: number,
  v: number,
  natural: number,
  omega: number,
  dt: number,
): [h: number, v: number] {
  const [x, nv] = springStep(h, v, natural, omega, dt)
  if (Math.abs(natural - x) < 0.5 && Math.abs(nv) < 2) return [natural, 0]
  return [x, nv]
}

/**
 * How far along its SIZE change the card is at flight progress `t`.
 *
 * Exported, and used by `poseAt` itself, because two consumers now need this
 * number and they must not each own a copy. The field's parts interpolate
 * their boxes on it and the card's own box interpolates on it; if those two
 * curves ever disagreed by so much as an exponent, every word would slide
 * against the panel it is printed on for the whole flight (#56: one
 * computation, or they will drift).
 */
export const SIZE_EXP = 1.5

export function sizeProgress(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return Math.pow(c, SIZE_EXP)
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
  const tSize = sizeProgress(clamped)

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
 * How much of the flight, at either end, the pixel-grid snap is arriving over.
 *
 * Small on purpose. Its only job is to keep the last half pixel a drift rather
 * than a jump; over 8% of a 700 ms flight that is under 10 px/s, which is below
 * anything the eye reports as motion.
 */
export const SNAP_FADE = 0.08

export function snapWeight(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  const d = Math.min(c, 1 - c)
  const w = 1 - d / SNAP_FADE
  // `1 - SNAP_FADE` is not exactly `1 - SNAP_FADE` in binary, so the edge of the
  // window comes out a few times 1e-16 rather than zero. A millionth of a snap
  // is not a snap, and callers should be able to test the weight for nothing.
  return w > 1e-6 ? w : 0
}

/** How this scene presents a card once the grid has been consulted. */
export interface Settle {
  /** World offsets to add to the card's centre. */
  dx: number
  dy: number
  /** Multipliers on the card's rendered footprint. */
  sx: number
  sy: number
}

const NO_SETTLE: Settle = { dx: 0, dy: 0, sx: 1, sy: 1 }

/**
 * The phase correction that puts a resting card's texels on the display's
 * pixels — `pixelGridSnap`, faded in over the ends of the flight.
 *
 * The law is the kernel's and the reasoning lives there. What is this scene's
 * is the WHEN, which is the only part that was ever scene-specific: `Flight`
 * decides a card is at rest from its plate speed, and a route transition
 * decides it from how far into the flight it is. `snapWeight` is that
 * judgement — full strength at BOTH endpoints, because the smaller one is a
 * resting place as much as the larger (the start of an open, the end of a
 * close), and off through the middle, where the card is magnified and tilted
 * and there is no phase to be right about. Quantizing a moving card's position
 * is just a way to make it move in steps.
 *
 * Both halves of the correction are taken, which is new: the corner snap alone
 * was correct here only by the luck of two integral card widths, and a 307.6 px
 * endpoint would have drifted its phase across its own width with the corner
 * still nailed down (#21).
 */
export function gridSnap(
  x: number,
  y: number,
  width: number,
  height: number,
  mag: number,
  viewW: number,
  viewH: number,
  dpr: number,
  density: number,
  t: number,
): Settle {
  const weight = snapWeight(t)
  if (weight <= 0) return NO_SETTLE
  const s = pixelGridSnap({ x, y, width, height, mag, viewW, viewH, dpr, density })
  return {
    dx: s.dx * weight,
    dy: s.dy * weight,
    sx: 1 + weight * (s.sx - 1),
    sy: 1 + weight * (s.sy - 1),
  }
}

/**
 * Texel density for a card at depth `z`, given the page's own device ratio.
 *
 * The law itself is `texelDemand`, and this scene has no business owning a
 * copy of it: a card on the plane is 1 CSS px to 1 device px × dpr, full
 * stop, and lifted toward the eye it covers more of the display and needs
 * proportionally more texels to stay 1 : 1. That is the kernel's identity,
 * evaluated at the plate's altitude — the same sentence the density schedule
 * is written in. This function is now only the two clamps around it.
 *
 * Following z continuously is normally an expensive thing to want (every
 * change re-rasterizes). Here it is FREE, and for a reason specific to this
 * lab: the card is being resized every frame anyway, so it is already
 * re-rasterizing every frame. The density may as well be right.
 *
 * `clampScale` is the guard, and it is the SAME CALL `Surface` makes before
 * deciding whether to warn — so a density that has been through it here can
 * never trip the warning there. That is the reason to borrow the function
 * rather than the number: this used to cap at 4000, a margin invented to stay
 * clear of a 4096 boundary it could not cite (#21).
 */
export function densityAt(dpr: number, camZ: number, z: number, w: number, h: number): number {
  return Math.max(0.5, clampScale(texelDemand(dpr, camZ, z), w, h))
}
