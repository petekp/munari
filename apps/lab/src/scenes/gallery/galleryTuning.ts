// Tuned values for the gallery crossing — the same drop of glass as the
// refraction scene, over photographs instead of a page.
//
// One thing differs, and it is the reason this bag exists: what the
// aperture field MEASURES. The refraction scene measures how dark each
// patch of the leaving document is, and its floor and ceiling are that
// page's own ink histogram. A photograph is dark everywhere by a page's
// standards, so read that way the field saturates, the spread has no
// gradient to grow along, and the whole image opens at once. This bag
// reads how busy each patch is instead — see `apertureDetail` — which
// separates a photo's detailed regions from its flat ones the same way ink
// separates text from margin.
//
// Everything else is the refraction scene's committed shape, copied. Shape
// is a property of the drop and does not care what is underneath it.
//
// Every aperture number below was measured in a browser on 2026-08-24 by
// reading the field's own render targets back off the GPU, over all five
// of this scene's cards at full screen: 5000 raw field texels and 2610
// aperture texels. The refraction scene's numbers are on that scene's own
// histogram and none of them survived the move.

import type { RefractionKnobGroup } from '../refraction/refractionTuning'

/**
 * The box the aperture's two texel grids are counted against, CSS px.
 *
 * The gallery is full screen, so its stage is the viewport and it resizes.
 * The drop follows that — its meniscus and its bend are physical lengths
 * and stay the CSS px they are tuned to, the way a real drop of water does
 * not grow because the screen behind it did.
 *
 * The FIELD must not follow it. `fieldPx` and `spreadPx` only ever decide
 * how many texels the two grids have; the grids themselves are uv over the
 * card, so a grid that tracked the viewport would put a different number of
 * texels across the same photograph in a different window, and the same
 * image would open in a different order. Counting them against a fixed box
 * instead makes the crossing identical at any window size, which is also
 * what lets one calibration hold.
 *
 * 1440x900 is a size, not a shape — the numbers that come out of it are
 * 60x38 ink texels and 29x18 spread texels, and those are what the
 * measurements below are stated at.
 */
export const GALLERY_REF_W = 1440
export const GALLERY_REF_H = 900

export const galleryTuning = {
  /** How long an unscrubbed crossing takes, ms. */
  crossingMs: 1900,

  /** The spring the playthrough rides. See refractionTuning's own entry. */
  crossingSpring: 6,

  rise: 4,
  fall: 6,
  transmissionDelay: 0,
  approachZoom: 1.125,

  // ── the drop ─────────────────────────────────────────────────────────
  //
  // The refraction scene's shape, unchanged. `bendTaperPx` in particular
  // is bound by `taper > 1.5 x the steepest bend`, and the steepest bend
  // is a property of the drop rather than of the content, so 34 clears it
  // here for the same reason it does there.
  rimPx: 40,
  heightPx: 40,
  ior: 2,
  refractPx: 26,
  bendTaperPx: 34,
  dispersion: 0.12,

  // ── the aperture ─────────────────────────────────────────────────────

  /**
   * What the field measures: 0 how dark a patch is, 1 how busy it is.
   *
   * 1, all the way to busyness, and this one knob is what separates a
   * gallery from a page. Measured over the five cards, darkness gives a
   * field with no interior: its bottom quarter is all one value (p05, p10
   * and p25 are all 0.133 — the paper the text column sits on) and its top
   * tenth is saturated flat (p90 and p95 are both 0.992). Run through the
   * spread at this scene's own floor and ceiling, 29.2% of the card comes
   * out at exactly 1 and the whole p05-to-p95 span collapses to 0.333 —
   * nearly a third of the picture opens on the first frame, together, and
   * the rest follows in a narrow rush. Given the refraction scene's floor
   * and ceiling instead it is 9.8% at one AND 4.1% at zero: a tenth of the
   * card jumps out at t = 0.16 and another tenth waits until t = 0.66.
   *
   * Busyness on the same cards has neither end: 0.3% at zero, 0.3% at one,
   * and a span of 0.678. A photograph's detailed regions come first and its
   * flat ones last, which is the order a page's marks and margins already
   * had.
   */
  apertureDetail: 1,

  /**
   * How many CSS px of `GALLERY_REF_W` one texel of the ink field covers —
   * so really a texel COUNT, 40x25 at the reference box.
   *
   * Busyness is a statistic over a patch and wants a patch large enough to
   * have one, and a full-screen photograph is an upscaled 1280x720 source,
   * so small patches of it are flat. Swept at 24, 36 and 48 with everything
   * else held: 24 (a 60x38 grid) reads inside the grain rather than which
   * regions are detailed, and the aperture's span drops to 0.504; 48 puts
   * 1.6% of the card back at exactly 1, and its 30x19 grid is barely
   * coarser than the spread's own 29x18, which leaves the two scales doing
   * the same job. 36 has no dead field, 0.3% at one, and the widest span.
   */
  fieldPx: 36,

  /**
   * Floor and ceiling of the field, normalising it before the spread grows
   * out of it.
   *
   * Floor 0 because there is nothing under the photographs to subtract:
   * 48.2% of the raw field is already exactly zero — flat sky, solid
   * backgrounds, and the large whitespace a full-screen text column has —
   * and a positive floor only makes that fraction larger.
   *
   * The ceiling decides how much of the card seeds the fire, so it is
   * really a knob on how far the front can reach. At 0.32 the emptiest card
   * holds a steady 3.3% of itself dead at the end of the reach, read after
   * read. At 0.20 that falls to somewhere between 0 and 2.3% — the number
   * moves between reads, because it is a handful of texels at the far
   * corner of one card — and the aperture's span widens from 0.657 to
   * about 0.68.
   */
  apertureFloor: 0,
  apertureCeil: 0.2,

  /** Purely the spread, as in the refraction scene. */
  apertureInk: 0,

  spreadPx: 50,

  /**
   * How far the fire travels out of the busy regions, in reference px —
   * nine passes at `spreadPx`.
   *
   * Much further than the refraction scene's 125 because a full-screen card
   * has far larger empty regions than a page does, and a texel the fire
   * never reaches sits at exactly zero and opens with every other such
   * texel at once. Swept at 300, 350, 400 and 450: the emptiest card had
   * 15.3%, 6.1%, 3.8% and at most 2.3% of itself in that state. 450 is the
   * first of the four where the dead patch stops being a region and becomes
   * a few texels in a corner; going further only narrows the span.
   */
  spreadReachPx: 450,

  /**
   * Gamma on the field, correcting where the middle of the distribution
   * sits so the front does not stall and then rush.
   *
   * The measured aperture has its median at 0.500; 0.69 lifts that to 0.62,
   * which the sweeping edge reaches at t = 0.418 — just behind the relief
   * peak at 0.4, the same relation the refraction scene is tuned to. The
   * card then opens across the crossing rather than in one step: the
   * busiest tenth at t = 0.297, the median at 0.418, the quietest tenth at
   * t = 0.634.
   */
  apertureGamma: 0.69,

  /**
   * Fully eased across the spread's texel boundaries. See the refraction
   * scene's entry for what the easing does and what it measured.
   */
  frontRounding: 1,

  apertureOvershoot: 0.23,
  apertureEdgePx: 8,

  // ── the room the drop mirrors ────────────────────────────────────────

  reflect: 1,
  roomBand: 0.86,
  roomWidth: 1,
  rim: 0.58,
  rimPow: 16,
  mirrorFalloff: 2,
}

export const GALLERY_GROUPS: RefractionKnobGroup<typeof galleryTuning>[] = [
  {
    title: 'crossing',
    knobs: [
      { key: 'crossingMs', label: 'duration ms', min: 300, max: 3000, step: 50 },
      { key: 'crossingSpring', label: 'spring', min: 2, max: 14, step: 0.25 },
      { key: 'approachZoom', label: 'approach zoom', min: 1, max: 1.3, step: 0.005 },
      { key: 'rise', label: 'relief rise', min: 1, max: 8, step: 0.5 },
      { key: 'fall', label: 'relief fall', min: 1, max: 12, step: 0.5 },
    ],
  },
  {
    title: 'aperture',
    knobs: [
      { key: 'apertureDetail', label: 'dark to busy', min: 0, max: 1, step: 0.02 },
      { key: 'fieldPx', label: 'field texel px', min: 8, max: 72, step: 1 },
      { key: 'apertureFloor', label: 'quiet level', min: 0, max: 0.5, step: 0.002 },
      { key: 'apertureCeil', label: 'busy level', min: 0.02, max: 1, step: 0.005 },
      { key: 'apertureGamma', label: 'front gamma', min: 0.2, max: 2, step: 0.01 },
      { key: 'spreadReachPx', label: 'blob reach px', min: 0, max: 800, step: 10 },
      { key: 'spreadPx', label: 'blob texel px', min: 6, max: 60, step: 2 },
      { key: 'frontRounding', label: 'front rounding', min: 0, max: 1, step: 0.05 },
      { key: 'apertureOvershoot', label: 'overshoot', min: 0, max: 0.6, step: 0.01 },
      { key: 'apertureEdgePx', label: 'seam px', min: 0.25, max: 8, step: 0.25 },
    ],
  },
  {
    title: 'drop',
    knobs: [
      { key: 'rimPx', label: 'meniscus px', min: 2, max: 80, step: 1 },
      { key: 'heightPx', label: 'drop height px', min: 0, max: 80, step: 0.5 },
      { key: 'ior', label: 'index', min: 1, max: 2.5, step: 0.01 },
      { key: 'refractPx', label: 'bend px', min: 0, max: 80, step: 1 },
      { key: 'dispersion', label: 'dispersion', min: 0, max: 0.4, step: 0.005 },
      { key: 'bendTaperPx', label: 'rim taper px', min: 1, max: 80, step: 1 },
    ],
  },
  {
    title: 'room',
    knobs: [
      { key: 'reflect', label: 'reflect', min: 0, max: 1, step: 0.02 },
      { key: 'roomBand', label: 'band', min: 0, max: 1, step: 0.01 },
      { key: 'roomWidth', label: 'width', min: 0.1, max: 2, step: 0.02 },
      { key: 'rim', label: 'rim', min: 0, max: 1, step: 0.02 },
      { key: 'rimPow', label: 'rim falloff', min: 1, max: 32, step: 1 },
      { key: 'mirrorFalloff', label: 'mirror falloff', min: 1, max: 8, step: 0.5 },
    ],
  },
]
