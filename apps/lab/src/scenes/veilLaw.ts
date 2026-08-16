// The veil — the laws behind the progressive blur.
//
// Pure profiles: distance into the band in, blur radius / opacity /
// sampling level out. The scene samples them per fragment (as GLSL
// twins fed the same constants through uniforms) and per test point
// here; nothing in this file knows about textures or scrolling.
//
// Two constraints carry the hold story, pinned by veilLaw.test.ts:
//
//   radius(0) is EXACTLY zero. The band's near edge is the seam where
//   the compositor's pixels stop and the sampled copy begins, and the
//   two must agree to the pixel there — a veil that starts at half a
//   pixel of blur draws a visible line across the content at its own
//   boundary.
//
//   alpha(0) is EXACTLY zero. The seam row contributes nothing, so
//   continuity at the seam belongs to the compositor alone; the copy
//   reaches full strength only at depths where its own blur swallows
//   small errors.
//
// Everything is in the band's OWN coordinates: d = 0 at the seam,
// growing downward. The scene decides where the band sits on screen;
// the laws do not know.
//
// The ramp is a smoothstep raised to a power. Smoothstep alone starts
// and ends with zero slope, which is what keeps both edges of the band
// from reading as creases; the exponent holds the content legible
// deeper into the band before letting it dissolve, which is how the
// real ones behave (iOS's sheets stay readable well past the blur's
// start).

export interface VeilParams {
  /** Band depth in CSS px over which the blur ramps. */
  height: number
  /** Blur radius at the far (fully veiled) edge, px. */
  maxRadius: number
  /** Exponent on the ramp; 1 is plain smoothstep, above 1 stays sharp longer. */
  curve: number
  /** Depth over which the band's own alpha ramps in from the seam, px. */
  fade: number
  /**
   * Budget, ms, for the blur's return once the copy's layout generation
   * re-matches the live page's — see `veilReturn`. Its own concern from
   * `fade`: `fade` shapes a spatial ramp that runs every frame at rest,
   * `returnMs` times a temporal one that only runs after a resize.
   */
  returnMs: number
}

export const VEIL_DEFAULTS: VeilParams = {
  height: 180,
  maxRadius: 24,
  curve: 1.6,
  // Chosen where the blur takes over the hiding: with the defaults
  // above the radius crosses 2px just before d = 56, and a misalignment
  // under 2px of blur is not a seam anyone can see. veilLaw.test.ts
  // pins the ordering (fade done only where the blur is strong).
  fade: 56,
  // Fast enough that the veil's return after a resize reads as settling
  // rather than loading; slow enough not to pop. veilLaw.test.ts pins
  // the perceptual floor (120-250ms).
  returnMs: 180,
}

function smoothstep(x: number): number {
  const k = Math.min(1, Math.max(0, x))
  return k * k * (3 - 2 * k)
}

/** Blur radius at `d` CSS px into the band (0 = the sharp seam). */
export function veilRadius(d: number, p: VeilParams): number {
  return p.maxRadius * Math.pow(smoothstep(d / p.height), p.curve)
}

/**
 * The band's own opacity at `d` px into the band: 0 AT the seam, 1 by
 * `fade`. The band is a copy of the page; wherever the copy is still
 * sharp enough that a small offset would read as doubled text, the live
 * page shows through instead. At rest the ramp costs nothing: the
 * copy's pixels equal the page's, and blending identical pixels is a
 * no-op at every alpha.
 */
export function veilSeamAlpha(d: number, p: VeilParams): number {
  return smoothstep(d / p.fade)
}

/**
 * The band's generation gate during the return ramp: 0 at the moment
 * the copy's layout generation re-matches the live page's, 1 once the
 * blur is fully back. While generations DISAGREE the scene holds the
 * gate at 0 outright — a copy of one layout blended over a page of
 * another reads as doubled text (the resize ghosting, 2026-08-08), so
 * mismatch is not a ramp, it is absence.
 *
 * The odd one out in this file: `d` above is a distance the shader also
 * walks, fed by a GLSL twin; `msSinceMatch` is a clock only the scene
 * can read (the raster's paintedSize versus the live DOM's own box), so
 * this ramp is evaluated JS-side once per frame and its result crosses
 * into the shader as a single uniform, not as a per-fragment function.
 */
export function veilReturn(msSinceMatch: number, p: VeilParams): number {
  return smoothstep(msSinceMatch / p.returnMs)
}

/**
 * The mip level a blur tap must sample at, given the spacing between
 * taps and the texel size of the source, both in CSS px.
 *
 * A 13-tap kernel spaced radius/6 apart is not a gaussian — it is a
 * comb, unless each tap INTEGRATES the span between taps. Bilinear
 * level 0 integrates about one texel, so once the spacing outgrows the
 * texel the gaps between taps show through as a woven lattice of ghost
 * impulses. The lattice is resolution-dependent in the worst way: at
 * dpr 1 a texel is 1 CSS px and roughly plugs the gaps, at dpr 2 it is
 * half that and the fabric shows (observed on a retina display,
 * 2026-08-08 — the dpr 1 probe was blind to it). Level L integrates
 * ~2^L texels, so the level that plugs the gap is the log of the ratio,
 * floored at 0 so the seam — spacing 0 — stays on the pristine base
 * level and the seam-exactness constraint survives.
 */
export function veilLod(spacingPx: number, texelPx: number): number {
  return Math.max(0, Math.log2(Math.max(spacingPx / texelPx, 1)))
}

/**
 * The rows the offscreen passes must cover, in band coordinates, for
 * the vertical taps of the final pass to always land on real pixels. A
 * tap at row `d` reaches `±radius(d)`, past BOTH edges of the window
 * the band occupies: above the seam (where the radius is already
 * small) and below the window's far edge — the article continues and
 * the texture has those pixels, but only if the passes rendered them,
 * or the taps clamp to the edge row and smear it (observed as
 * bottom-edge flicker, 2026-08-08). veilLaw.test.ts pins the
 * containment. The +2 covers bilinear filtering's half-texel look-past
 * at the outermost rows.
 */
/** The band of window the veil paints, in CSS px. */
export interface VeilStrip {
  top: number
  height: number
}

export function veilStrip(windowH: number, p: VeilParams): VeilStrip {
  const reach = Math.ceil(p.maxRadius) + 2
  return { top: -reach, height: windowH + 2 * reach }
}
