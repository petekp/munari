// Tuned values for the refraction crossing — one live bag the sliders write
// into, plus the measurements the law argues against.
//
// Every material and the field pass read the bag on their next frame, so a
// slider takes effect without a remount. The panel's copy button dumps it as
// JSON, ready to paste back over the literals here. Every number says why it
// is that number; a constant nobody can cite gets approximated by the next
// reader (AGENTS.md).
//
// What is NOT in the bag: the stage box, which the DOM lays itself out in
// and so cannot move per frame, and the three measured gradients, which are
// facts about this page rather than choices about the effect.

/** The stage box both views lay themselves out in, CSS px. */
export const STAGE_W = 560
export const STAGE_H = 420

// ── measurements, not knobs ────────────────────────────────────────────

/**
 * The lens field's slope over a text block, measured off the panel.
 *
 * Re-measured 2026-08-22 at `fieldPx` 18 as the 90th percentile of the
 * field's gradient over the leaving document: half the page is bare paper
 * and reads 0, so the interesting mass sits in the top decile. A text block
 * is where the perceptual floor has to be argued, so the floor is stated
 * against this.
 *
 * Both gradients are per STEP, not per px, so they move with `fieldPx`. At
 * the old 8px texel these read 0.10 and 0.73; the same page at 18px steps
 * 36 CSS px instead of 16 and so measures a larger slope for the same ink.
 */
export const LENS_GRADIENT = 0.3663

/**
 * The same slope at the figure's border, where the field steps hardest.
 *
 * The 99th percentile of the same measurement. The bend's ceiling exists to
 * keep this case from tearing whatever is behind it.
 */
export const FIGURE_GRADIENT = 0.8314

/**
 * The floor a human eye needs to see the bend at all, CSS px.
 *
 * Under 2px the displacement is inside the antialiasing of the glyph edges
 * it is displacing, so the crossing reads as a plain crossfade with a
 * slightly soft middle.
 */
export const DISPLACEMENT_FLOOR_PX = 2

// ── the live bag ───────────────────────────────────────────────────────

export interface RefractionKnobDef<B> {
  key: keyof B & string
  label: string
  min: number
  max: number
  step: number
}

export interface RefractionKnobGroup<B> {
  title: string
  knobs: RefractionKnobDef<B>[]
}

// Structurally a `RefractionShape`, so `refractionStage` can take the bag
// itself and the panel can move the crossing's timing live.
export const refractionTuning = {
  /** How long an unscrubbed crossing takes, ms. */
  crossingMs: 2850,

  // Peak at rise/(rise+fall) = 0.4. Glass forms over the first two fifths
  // of the scrub and spends the other three releasing, which is the
  // asymmetry refractionLaw's preamble argues for.
  rise: 4,
  fall: 6,

  /**
   * How long the incoming view stays fully hidden, as a share of the scrub.
   *
   * Zero, because at rise 4 / fall 6 the pulse already does the ordering: the
   * relief passes the transmission at t=0.073 with both still under 0.016,
   * peaks at 0.4 against a transmission of 0.35, and only falls behind again
   * at t=0.56 on the release. A delay on top of that shape just flattens the
   * open. It earns its place again if the pulse is flattened — at rise 1 the
   * relief never leads, and the two events read as one crossfade.
   */
  transmissionDelay: 0,

  /** 24% over, which is 134px of travel across a 560px stage. Enough that
   *  the arriving page reads as coming from behind the glass rather than
   *  fading up in place. */
  approachZoom: 1.24,

  /**
   * Peak refraction, in CSS px of displacement per unit field gradient.
   *
   * 43px against a text block (field gradient 0.3663) wants 15.8px of
   * travel, which `maxBendPx` then knees down to 2.86px at peak relief —
   * clear of the 2px perceptual floor the law's test pins, and a fifth of a
   * line of body text.
   *
   * At this setting the ceiling, not this number, is what the eye sees:
   * every part of the page wants more bend than the ceiling allows, so
   * raising this barely moves the result. See `maxBendPx`.
   */
  amplitude: 43,

  /**
   * Ceiling on the displacement, CSS px.
   *
   * The figure's border steps the field more than twice as hard as a
   * paragraph does, so uncapped it would displace by 35.8px — past the
   * margin the approach zoom leaves around the arriving page, where the uv
   * clamp smears its border row into a straight streak.
   *
   * A soft knee, not a hard cap: want / (1 + want / max) approaches this
   * and never reaches it. A hard cap leaves a plateau where neighbouring
   * pixels share a magnitude but not a direction, and the title's heavy
   * strokes sheared along it — seen 2026-08-22, fixed by the knee.
   *
   * 3.5 is well under what even bare body text wants (15.8px), so the knee
   * is saturated everywhere and the page bends almost uniformly: 2.86px
   * over text against 3.19px at the figure's border, a ratio of 1.11. The
   * bevel that used to distinguish the two is gone, and so is any visible
   * dispersion, because the fringe is a fraction of a bend that is now
   * 3px everywhere. Around 14 the figure gets three times what a paragraph
   * gets, which is the ratio that reads as an edge of glass.
   */
  maxBendPx: 3.5,

  /**
   * How many CSS px from the sheet's rim the bend dies out over.
   *
   * Wide enough that the taper always outruns the bend it is limiting: the
   * law's test walks every distance and pins taper(d) * bend <= d, which is
   * what makes the border streak unreachable rather than merely unlikely.
   */
  bendTaperPx: 34,

  /**
   * How many CSS px one texel of the lens field covers.
   *
   * Wider than a word, so the lens is the page's ink MASS and not its
   * letterforms. Body text here sets 13px lines of about 7px glyphs. The
   * bend steps one texel either side, so at 18 it measures the slope over
   * 36px, and the whole field is 31x23 texels.
   *
   * This is the knob the scene's worst bug hid behind. Turn it down toward
   * 2 and the lens becomes the letterforms again, which tears the arriving
   * page apart at any amplitude — refractionField.tsx has the measurement.
   */
  fieldPx: 18,

  /**
   * How far red and blue diverge from green, as a fraction of the bend.
   *
   * The fringe is this times twice the bend, so it can only be as wide as
   * the bend allows. At the current `maxBendPx` that is 0.77px at the
   * figure's border and 0.69px over body text — both under the 2px
   * perceptual floor, which is to say the colour split is off. It comes
   * back with the bend ceiling, not with this number.
   *
   * Colour edges are much easier to see than position ones, so the useful
   * band is narrow: with a 14px ceiling, 0.12 put 2.4px of fringe on the
   * bevel and left the words alone, and 0.25 fringed the arriving title
   * magenta and cyan at full size — a printing misregistration, not glass.
   */
  dispersion: 0.12,

  // ── the aperture ─────────────────────────────────────────────────────

  /**
   * Height of bare paper in the lens field. Not zero: the page is warm
   * off-white, and half the field's texels sit at exactly this value.
   *
   * Read straight off the field's own histogram on 2026-08-22 — p25, p50 and
   * the mode are all 0.1333. The number here was 0.061 before that reading,
   * which is BELOW paper, so bare page normalised to 0.56 instead of 0 and
   * half the sheet started the crossing already more than half way along the
   * front's travel. Set just above the mode so paper reads as empty.
   */
  apertureFloor: 0.135,

  /**
   * Height of a dense text block, the p90 of the same histogram (0.2784).
   *
   * The figure's border reads 0.99 and clamps, which is what makes it the
   * first thing the front opens on. Raising this toward 0.5 gives the figure
   * room to lead by degrees instead; lowering it back toward the old 0.19
   * flattens every text block to 1 and they arrive together — measured
   * 2026-08-22 at the old pair, the correlation between a cell's ink and when
   * it arrived was -0.007, which is to say the ink was not leading at all.
   * At 0.28 that correlation is what the law's test pins.
   */
  apertureCeil: 0.28,

  /**
   * Which scale of the ink steers the front: 0 the spread blobs, 1 the ink
   * mass itself.
   *
   * Both ends are the page. The old 0 end was a circle centred on the sheet,
   * and Pete saw it competing with the blobs on 2026-08-22 — at any share
   * under 1 the front had two shapes at once. The spread has no shape of its
   * own, so this knob is now a scale and not a choice between the page and a
   * piece of geometry.
   *
   * The trap this number still sits in: the cells that visibly change during
   * a crossing are exactly the inked ones, so a high share puts all of them
   * at the same point in the front's travel and they flip together. Measured
   * 2026-08-22 over the changing cells of this page, mean blend at t=0.4 then
   * t=0.5 — 0.55 goes 0.07 to 0.80, 0.35 goes 0.04 to 0.74, 0.20 goes 0.04 to
   * 0.58. Low keeps the arrival staggered; too low and the blob is so smooth
   * that the text blocks stop leading it at all.
   */
  apertureInk: 0,

  /**
   * How many CSS px one texel of the spread field covers.
   *
   * Coarser than the lens by design — this field is thresholded, never
   * differentiated, so it wants reach rather than fidelity. At 22px the whole
   * spread is 25x19 texels and a pass over it costs 25 taps a texel.
   */
  spreadPx: 22,

  /**
   * How far a blob grows out from the ink that made it, CSS px.
   *
   * This is the knob that sets how big the blobs read. Under about 40 they
   * stay inside the text blocks and the margins all arrive together, because
   * nothing out there has an order. Over about 160 neighbouring blocks merge
   * into one front and the page opens as a single sheet again.
   *
   * Converted to a pass count by dividing by `spreadPx`, so changing the
   * resolution keeps the distance. 105 over a 22px texel is five passes,
   * run twice — once outward from the ink, once inward from the paper.
   */
  spreadReachPx: 105,

  /**
   * Gamma applied to the mixed field, to spread the front's travel evenly.
   *
   * Re-measured 2026-08-22 at the settings above, over 8281 points of the
   * leaving document, margins included: the raw mix has quantiles p25 0.18,
   * p50 0.33, p75 0.50, max 0.85. Still bunched below the middle, because
   * most of a page is margin and gutter, so ungamma'd the front spends most
   * of its travel above almost the whole page and then opens everything at
   * once. 0.624 is what would put that median exactly at 0.5; 0.43 pushes it
   * to 0.62, so the front opens most of the page in its first half and
   * spends the second half on the last of the margins.
   *
   * It moves with `blob reach px`, because the reach is what fills the
   * margins in, and it moved when the spread gained its inward half. Drag the
   * reach far and this wants dragging with it.
   */
  apertureGamma: 0.43,

  /**
   * How far the front sweeps past each end of the field, in field units.
   *
   * The ends have to be absolute — nothing revealed at t=0, everything at
   * t=1 — and the seam has width, so the sweep has to clear the field's own
   * range by at least that width. It also caps the seam at half of itself —
   * 0.025 field units here — because the field steps hard at the figure's
   * border and an uncapped seam there would reach back past 1.0 and show a
   * sliver of the arriving page at t=0.
   */
  apertureOvershoot: 0.05,

  /**
   * Width of the seam where the two documents share a pixel, in SCREEN px.
   *
   * Stated in pixels rather than field units, and that distinction is the
   * whole fix. The aperture field is smooth over most of a page, so a seam
   * of 0.12 field units covered roughly half the panel: measured
   * 2026-08-22, only 41% of the cells that differ between the two documents
   * matched either one, and at full size both documents were legible on top
   * of each other across the whole page. Narrowing it in field units barely
   * helped — 0.18 down to 0.05 moved that share by six points — because the
   * field's spatial gradient, not the band, was setting the seam's width.
   *
   * 8 gives a seam up to eight pixels across, narrowed further by the
   * overshoot cap wherever the field steps hard. The gate measures what
   * that costs directly rather than trusting the width: at t=0.5, 63–66% of
   * the cells that differ between the two documents still match one of them
   * exactly, against a floor of 25%. A seam this wide only survives because
   * the signed spread made the field smooth; on the old unsigned field it
   * would have put both documents on the same pixels.
   */
  apertureEdgePx: 8,

  // ── the raking light ─────────────────────────────────────────────────

  /** Specular gain on the relief's own slope. Pure light, added
   *  premultiplied. */
  sheenGain: 6.7,
  sheenAmount: 0.32,

  /**
   * How much of the light survives behind the front, 0 = none, 1 = all.
   *
   * The relief IS the leaving page, so once a pixel has been handed to the
   * arriving one there is no letterform left there to catch light. At 1 the
   * light redraws the leaving page's headline in white over the arriving
   * page's headline — which is the "both documents at once" the aperture
   * exists to prevent, arriving by the one route the aperture does not
   * control (seen 2026-08-22). 0.42 keeps enough that the front's own lip
   * stays lit as it passes.
   */
  sheenTransmit: 0.42,

  /** Distance at which the raking light is half strength, in the same units
   *  the shader measures uv distance in (aspect-corrected, so a corner of
   *  the panel sits at 0.83). At 1.6 the falloff is longer than the panel's
   *  own diagonal, so the sheet is lit nearly evenly. */
  lightFalloff: 1.6,

  /** Tightness of the raking highlight. 3 lights roughly a quadrant of
   *  edges. */
  specPower: 3,
}

export const REFRACTION_GROUPS: RefractionKnobGroup<typeof refractionTuning>[] = [
  {
    title: 'crossing',
    knobs: [
      { key: 'crossingMs', label: 'duration ms', min: 300, max: 3000, step: 50 },
      { key: 'rise', label: 'relief rise', min: 0.4, max: 4, step: 0.1 },
      { key: 'fall', label: 'relief fall', min: 0.4, max: 6, step: 0.1 },
      { key: 'transmissionDelay', label: 'hold before open', min: 0, max: 0.5, step: 0.01 },
      { key: 'approachZoom', label: 'approach zoom', min: 1, max: 1.3, step: 0.005 },
    ],
  },
  {
    title: 'lens',
    knobs: [
      { key: 'amplitude', label: 'bend px per slope', min: 0, max: 200, step: 1 },
      { key: 'maxBendPx', label: 'bend ceiling px', min: 1, max: 40, step: 0.5 },
      { key: 'bendTaperPx', label: 'rim taper px', min: 1, max: 64, step: 1 },
      // 2 is one texel per two CSS px, which is where the lens stops being
      // a mass and becomes letterforms again. Left reachable on purpose:
      // the failure is worth being able to see.
      { key: 'fieldPx', label: 'field texel px', min: 2, max: 32, step: 1 },
      { key: 'dispersion', label: 'dispersion', min: 0, max: 0.4, step: 0.005 },
    ],
  },
  {
    title: 'aperture',
    knobs: [
      { key: 'apertureInk', label: 'ink leads', min: 0, max: 1, step: 0.02 },
      { key: 'spreadReachPx', label: 'blob reach px', min: 0, max: 240, step: 5 },
      { key: 'spreadPx', label: 'blob texel px', min: 6, max: 60, step: 2 },
      { key: 'apertureGamma', label: 'front gamma', min: 0.2, max: 2, step: 0.05 },
      { key: 'apertureFloor', label: 'paper level', min: 0, max: 0.3, step: 0.002 },
      { key: 'apertureCeil', label: 'text level', min: 0.05, max: 0.6, step: 0.005 },
      { key: 'apertureOvershoot', label: 'sweep past ends', min: 0.02, max: 0.4, step: 0.01 },
      { key: 'apertureEdgePx', label: 'seam px', min: 0.25, max: 8, step: 0.25 },
    ],
  },
  {
    title: 'raking light',
    knobs: [
      { key: 'sheenAmount', label: 'sheen', min: 0, max: 2, step: 0.02 },
      { key: 'sheenGain', label: 'slope gain', min: 0, max: 8, step: 0.1 },
      { key: 'specPower', label: 'highlight tightness', min: 1, max: 32, step: 0.5 },
      { key: 'sheenTransmit', label: 'lit behind front', min: 0, max: 1, step: 0.02 },
      { key: 'lightFalloff', label: 'falloff', min: 0.05, max: 2, step: 0.01 },
    ],
  },
]
