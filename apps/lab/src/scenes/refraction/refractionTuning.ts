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
// and so cannot move per frame, and the perceptual floor, which is a fact
// about eyes rather than a choice about the effect.

/** The stage box both views lay themselves out in, CSS px. */
export const STAGE_W = 560
export const STAGE_H = 420

// ── measurements, not knobs ────────────────────────────────────────────

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

  // ── the drop ─────────────────────────────────────────────────────────
  //
  // The front is the contact line of a drop of glass, and these four shape
  // it. The ink decides where the drop grows; none of it decides what the
  // drop looks like. Before 2026-08-22 the surface was cut from the leaving
  // page's ink field, which made the glass a relief of its letterforms with
  // the front merely masking it — embossed text, not liquid emerging.

  /**
   * How wide the meniscus is, CSS px.
   *
   * The whole lens. Inside about three of these the profile is flat and the
   * arriving page reads straight through; outside the contact line there is
   * no surface at all. At 10 the bend measures 13.3px half a pixel in, 8.8px
   * two in, 2.6px ten in, and 0.8px twenty in.
   *
   * Narrow reads as a hard bevel and wide reads as a lens over the whole
   * blob, which stops the arriving page being legible while it arrives.
   */
  rimPx: 10,

  /**
   * How tall the drop stands, CSS px.
   *
   * Only ever seen through the slope it implies, so it trades against
   * `rimPx`: the steepest surface is roughly height over rim width. It is
   * stated as a height anyway because that is the thing with a shape.
   */
  heightPx: 14,

  /**
   * Refractive index of the glass. 1.45 is soda-lime; 1.33 is water.
   *
   * Sets how far the meniscus can bend before total internal reflection
   * takes over. At 1 there is no bend at any slope, which is a legal answer
   * and a useful one for seeing what the front alone does.
   */
  ior: 1.45,

  /**
   * CSS px the arriving page moves per unit of lateral deviation.
   *
   * The drop's thickness, in effect — Snell gives an angle and this turns it
   * into a distance. 26 puts the steepest bend at 17.3px, which the rim
   * taper is pinned against (`bendTaperPx` must outrun it at every distance
   * from the sheet's edge, and at 34 it clears by 3.3px at the tightest
   * point).
   */
  refractPx: 26,

  /**
   * How many CSS px from the sheet's rim the bend dies out over.
   *
   * Wide enough that the taper always outruns the bend it is limiting: the
   * law's test walks every distance and pins taper(d) * bend <= d against
   * the steepest bend the drop can ask for (17.3px at the committed shape),
   * which is what makes the border streak unreachable rather than merely
   * unlikely. At 34 the tightest point clears by 3.3px.
   */
  bendTaperPx: 34,

  /**
   * How many CSS px one texel of the lens field covers.
   *
   * Wider than a word, so the front opens on the page's ink MASS and not on
   * its letterforms. Body text here sets 13px lines of about 7px glyphs; at
   * 18 the whole field is 31x23 texels.
   *
   * This field now feeds only the aperture — the ink term of the front, and
   * the spread grown out of it. Nothing optical reads it since the drop's
   * surface stopped being a relief of the leaving page (2026-08-22). Turn it
   * down toward 2 and the front picks out individual words instead of text
   * blocks.
   */
  fieldPx: 18,

  /**
   * How far red and blue diverge from green, as a fraction of the bend.
   *
   * The fringe is this times twice the bend, so it lives exactly where the
   * bend does: 4.15px across the contact line, 0.6px ten pixels in, nothing
   * over the flat top. That is the shape colour should have — a spectrum on
   * the meniscus and clean words inside it.
   *
   * Colour edges are much easier to see than position ones, so the useful
   * band is narrow. At 0.25 the arriving title fringed magenta and cyan at
   * full size and read as a printing misregistration rather than as glass.
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

  // ── the room the drop mirrors ────────────────────────────────────────
  //
  // What the glass REFLECTS, not what a light does to it. There is no light
  // position and no pointer here: the highlight lives on the meniscus, so it
  // moves as the front sweeps across the page. The scene carried a raking
  // point light until 2026-08-22, and it read as a hot spot chasing the
  // cursor rather than as glass.
  //
  // Nothing here needs a gate for the page outside the drop. The normal is
  // exactly flat there, F0 is renormalised out of the mix weight, and both
  // terms come to zero on their own.

  /** How much of the room the glass mirrors, at full grazing. Replaces what
   *  is behind it rather than adding, so past about 0.8 the words under a
   *  streak stop being readable through it. */
  reflect: 0.6,

  /** Where the window streak sits, as a reflected-ray y. 0 is a light
   *  straight ahead; ±1 puts it at the grazing limit, which is where the
   *  meniscus looks. */
  roomBand: 0.5,

  /** How broad that streak is, in the same units. Under about 0.15 it reads
   *  as a hard line rather than as a window. */
  roomWidth: 0.3,

  /** Weight of the grazing-incidence rim — the bright border a raised edge
   *  of glass shows before its body does. White paint, so it is bounded at
   *  paper-white and the knob stays linear all the way up. */
  rim: 0.1,

  /** How tightly the rim hugs the steepest slope. Low values wash the whole
   *  drop; 3 keeps it on the contact line. */
  rimPow: 3,
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
    title: 'drop',
    knobs: [
      { key: 'rimPx', label: 'meniscus px', min: 2, max: 40, step: 1 },
      { key: 'heightPx', label: 'drop height px', min: 0, max: 40, step: 0.5 },
      { key: 'ior', label: 'index', min: 1, max: 2, step: 0.01 },
      { key: 'refractPx', label: 'bend px', min: 0, max: 80, step: 1 },
      { key: 'dispersion', label: 'dispersion', min: 0, max: 0.4, step: 0.005 },
      { key: 'bendTaperPx', label: 'rim taper px', min: 1, max: 64, step: 1 },
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
      // 2 is one texel per two CSS px, which is where the front stops
      // opening on ink mass and starts picking out letterforms. Left
      // reachable on purpose: the failure is worth being able to see.
      { key: 'fieldPx', label: 'field texel px', min: 2, max: 32, step: 1 },
    ],
  },
  {
    title: 'room',
    knobs: [
      { key: 'reflect', label: 'mirror', min: 0, max: 1, step: 0.02 },
      { key: 'roomBand', label: 'window place', min: -1, max: 1, step: 0.02 },
      { key: 'roomWidth', label: 'window width', min: 0.05, max: 1, step: 0.01 },
      { key: 'rim', label: 'rim', min: 0, max: 1, step: 0.02 },
      { key: 'rimPow', label: 'rim tightness', min: 1, max: 16, step: 0.5 },
    ],
  },
]
