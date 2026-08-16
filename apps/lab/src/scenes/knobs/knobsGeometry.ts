// The measurements of the hardware standing off the panel face — and the
// pure shape math the scene lathes and knurls it from.
//
// The panel face itself is flat, captured live DOM (KnobsPanel via a
// SurfaceApp). Everything three-dimensional about the controls is REAL
// geometry built from these numbers: knurled skirt cylinders, lathed
// caps, bat levers, collar bezels, lamp domes. That split is the scene's
// claim: the DOM owns the truth (state, text, glow, input), the mesh
// owns the matter, and neither is a painting of the other.
//
// Pure functions and constants only — no THREE import — so a test can
// pin the machining without constructing a scene.

/** Corner radius of the slab face, CSS px. One number for both
 *  renderers: KnobsPanel inline-styles it onto the captured root (which
 *  is where Surface's `radius: 'auto'` reads it back from), and the rim
 *  mesh extrudes the same arc. */
export const PANEL_RADIUS = 18

/** How deep the slab is, px — the side wall the rim mesh extrudes. */
export const SLAB_DEPTH = 14

/** How far the rim's front lip shows around the captured face, px. */
export const BEZEL_LIP = 3

export const KNOB = {
  /** Knurled skirt: the part the fingers grab. */
  skirtRadius: 26,
  skirtHeight: 15,
  /** Spun cap seated on the skirt. */
  capRadius: 16.5,
  capHeight: 5,
  /** Knurl: ridge count around the skirt, and ridge depth in px. A
   *  fine pitch — many shallow ridges — is the machinist's tell of a
   *  precision grip; coarse deep teeth read as molded plastic. */
  knurlCount: 64,
  knurlAmp: 0.4,
} as const

export const TOGGLE = {
  /** Collar bezel the lever throws through. */
  collarRadius: 10,
  collarHeight: 6,
  /** The bat: shaft length and radius, ball tip radius. */
  leverLength: 19,
  leverRadius: 2.6,
  tipRadius: 5,
  /** Full throw each side of neutral, radians. */
  throw: 0.62,
} as const

export const LAMP = {
  domeRadius: 8,
  /** The dome is a squashed hemisphere — its height off the face. */
  domeHeight: 4.5,
  /** Turned bezel ring around the glass: centerline radius and tube
   *  radius of the torus. The tube overlaps the dome's foot
   *  (rimRadius − rimTube < domeRadius) so glass meets metal with no
   *  gap ring between them. */
  rimRadius: 9.5,
  rimTube: 1.6,
  /** The emissive die inside the glass, as a scale of the dome. */
  coreScale: 0.62,
} as const

export const SCREW = {
  headRadius: 5.5,
  headHeight: 2.8,
  /** The driver slot: its width, and how deep it cuts into the head. */
  slotWidth: 1.6,
  slotDepth: 1.2,
} as const

/**
 * Lathe profile for a pan-head screw, center → rim, as [radius, height]
 * pairs. Domed crown rolling over to a chamfered edge — the section a
 * fastener head is actually formed to.
 */
export function screwProfile(r: number, h: number): [number, number][] {
  return [
    [0.0001, h],
    [0.45 * r, 0.97 * h],
    [0.8 * r, 0.78 * h],
    [0.96 * r, 0.4 * h],
    [r, 0],
  ]
}

/**
 * The knurl: a serrated grip circumference. Radius at angle `theta` for
 * a skirt of base radius `base`, ridge depth `amp`, ridge count `count`.
 * Period is exactly 2π/count, so a full turn meets itself seamlessly.
 */
export function knurlRadius(theta: number, base: number, amp: number, count: number): number {
  return base + amp * Math.sin(theta * count)
}

/**
 * Lathe profile for the spun cap, center → rim, as [radius, height]
 * pairs (the y axis is the spin axis). Flat crown, rolled shoulder,
 * chamfered seat — the section a knob cap is actually turned to.
 */
export function capProfile(r: number, h: number): [number, number][] {
  return [
    [0.0001, h],
    [0.55 * r, h],
    [0.78 * r, 0.92 * h],
    [0.92 * r, 0.62 * h],
    [r, 0],
  ]
}
