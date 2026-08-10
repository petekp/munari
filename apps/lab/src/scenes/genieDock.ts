// The dock law — what the tile does with the window it holds.
//
// The tile stopped being a frame around a thumbnail: it is now the
// container the sheet pours into. Two effects, both the same family
// of mechanism as the settle wobble in genieLaw.ts, but aimed at the
// CONTAINER instead of the thing landing in it:
//
//   swell   the tile's own size tracks the drive's progress: it grows
//           as the mouth eats the sheet, and rests slightly larger
//           than empty once the pour finishes — a container that has
//           swallowed something reads as still holding it. Progress
//           IS the drive's midline t, in every mode (clock, grab,
//           spring), so scrubbing the drag breathes the tile live —
//           there is no separate tween chasing the drive.
//
//   ring    the arrival speed of whatever just landed rings the
//           container: a decaying sine, same shape as genieSettle,
//           read as squash-and-stretch on a rigid box rather than a
//           wobble on a hanging edge. A small stiff box rings faster
//           and settles sooner than the sheet does (ringHz, ringDecay
//           vs. SETTLE_DEFAULTS.hz, .decay).
//
// Both are pure functions of progress/time — nothing here owns a
// clock, a ref, or a frame. The scene samples once per frame and
// writes the result straight to a transform; genieDock.test.ts pins
// the identities that keep that transform exact at rest and at dock,
// and the perceptual floor that keeps the ring honest at a real
// hand's landing speed.

export interface DockPose {
  sx: number
  sy: number
}

export interface DockParams {
  /** Docked rest scale, above 1 — the container holds a window now. */
  swell: number
  /** Drive progress at which growth begins (= GENIE_DEFAULTS.stretchEnd:
   *  the mouth is not eating anything before the stretch reaches it). */
  absorbStart: number
  /** Ring frequency, Hz — small stiff box rings faster than the big
   *  sheet (SETTLE_DEFAULTS.hz = 3.2). */
  ringHz: number
  /** Ring envelope time constant, seconds to 1/e. */
  ringDecay: number
  /** Squash amplitude per px/s of arrival speed. */
  ringGain: number
  /** Amplitude clamp — what keeps a hard flick from turning the tile
   *  inside out. */
  maxSquash: number
}

export const DOCK_DEFAULTS: DockParams = {
  // 0.34, not the 0.1 this shipped with first: on the lab's 52px tile a
  // tenth is five pixels, which is under the threshold where a size
  // change reads as a size change at all rather than as an edge
  // shimmer. The container has to end up plainly bigger than the bays
  // beside it — that IS the effect, so it gets a perceptual floor of
  // its own in genieDock.test.ts, pinned in pixels at the tile size.
  swell: 0.34,
  absorbStart: 0.45,
  ringHz: 9,
  ringDecay: 0.06,
  ringGain: 0.00012,
  // The ring rides ON the swell, so its amplitude is spent against a
  // box a third larger than it used to be; 0.14 keeps the peak throw
  // roughly where 0.18 put it on the old rest size.
  maxSquash: 0.14,
}

function smoothstep(e0: number, e1: number, x: number): number {
  const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return k * k * (3 - 2 * k)
}

/**
 * The tile's own size, as a scale factor. 1 exactly at and before
 * absorbStart — the tile is still its own size while the mouth is only
 * stretching, not yet eating — then smoothsteps to 1 + swell exactly
 * at progress = 1. `progress` is the drive's midline t; the tile has
 * no clock of its own, so this is the ENTIRE state, not an animation
 * chasing it — scrubbing the drag breathes the tile live for free.
 */
export function dockSwell(progress: number, d: DockParams = DOCK_DEFAULTS): number {
  return 1 + d.swell * smoothstep(d.absorbStart, 1, progress)
}

/**
 * The container's squash-and-stretch: a decaying sine whose amplitude
 * is set by the arrival speed (px/s, always ≥ 0 — a landing has a
 * speed, not a direction) and clamped so no flick can turn the box
 * inside out. Positive in the first half-cycle: arriving mass presses
 * the container wider and shorter before it rings back past rest.
 */
export function dockRing(t: number, v: number, d: DockParams = DOCK_DEFAULTS): number {
  const amplitude = Math.min(d.maxSquash, v * d.ringGain)
  // Exact by construction, not by float luck (genieLaw's phrase for the
  // same discipline): a zero amplitude times a sine that has swung
  // negative is IEEE754 -0, and "no speed rings nothing" has to hold as
  // an identity, not an "≈ 0".
  if (amplitude === 0) return 0
  return amplitude * Math.sin(2 * Math.PI * d.ringHz * t) * Math.exp(-t / d.ringDecay)
}

/**
 * Done when the ring's ENVELOPE — not the oscillation itself, which
 * crosses zero every half-cycle — is beneath a threshold too small to
 * read as motion. The envelope is monotone decreasing in t, so once
 * this is true it stays true; the scene uses it to stop paying for
 * frames, not to gate a single sample.
 */
export function dockRingDone(t: number, v: number, d: DockParams = DOCK_DEFAULTS): boolean {
  const amplitude = Math.min(d.maxSquash, v * d.ringGain)
  return amplitude * Math.exp(-t / d.ringDecay) < 0.004
}

/**
 * The tile's transform for one frame: the swell sets the overall size,
 * the ring perturbs x and y in opposite directions around it — a
 * cartoon-volume linearization, so sx/s + sy/s is conserved at 2 and
 * the ring never reads as a size CHANGE on top of the swell, only a
 * shape change. `ringT`/`ringV` at 0 makes sx = sy = dockSwell(progress)
 * the resting case, with no branch needed for "nothing is ringing".
 */
export function dockPose(
  progress: number,
  ringT: number,
  ringV: number,
  d: DockParams = DOCK_DEFAULTS,
): DockPose {
  const s = dockSwell(progress, d)
  const a = dockRing(ringT, ringV, d)
  return { sx: s * (1 + a), sy: s * (1 - a) }
}
