// The crystal's numbers — one solid of glass, the light it stands in, and
// the hand that throws it around.
//
// Lengths are CSS PIXELS and times are SECONDS, the calibration the rest of
// the lab already uses (flightPhysicsLaw.ts's preamble says why). A knob
// here means what it says on a ruler held to the screen, at any window size
// and any device pixel ratio.
//
// There is no knob converting refraction into pixels. The displacement is
// whatever the geometry produces — how thick the glass is, how high it
// floats, how steep its edge is where you are looking through it — so every
// number below moves the picture and the click together, and none of them
// can be turned up to hide a mistake in another.

/** One slider. `key` names a number in the bag below and nothing else. */
export interface CrystalKnobDef {
  key: keyof CrystalTuning & string
  label: string
  min: number
  max: number
  step: number
}

/** A titled run of them, the shape `CrystalTweaks` renders. */
export interface CrystalKnobGroup {
  title: string
  knobs: CrystalKnobDef[]
}

export const crystalTuning = {
  // ── the solid ────────────────────────────────────────────────────────

  /**
   * How many CSS px one unit of the arrow polygon is worth.
   *
   * The polygon in `crystalLaw.ts` is 16 units wide and 26.5 tall — the
   * proportions of the pointer every desktop has shipped since 1984. At 9
   * that is 144x239 px of glass, which is the whole joke: it is your cursor,
   * at the size of a playing card.
   */
  scalePx: 4.75,

  /** How far the outline is pushed out from the polygon, CSS px. */
  roundPx: 6,

  /**
   * How far up the arrow's axis its point is ground off, CSS px.
   *
   * `chamferPx - roundPx` is the hotspot's own `sdInner2`, and the girdle is
   * at `girdlePx` — so the tip sits `girdlePx - chamferPx + roundPx` = 8.5px
   * inside it. It has to be well inside, because the stone is a thin wedge
   * at its point: measured 2026-08-25, the glass over the hotspot is 11px
   * from pavilion to crown, and a slanted line of sight walks sideways
   * through all of it. At 3.5px in (chamferPx 14) the hotspot's own ray
   * missed the solid at the right of the screen and the correction reported
   * zero; at 8.5px in it lands at all four screen edges with a 2px hand
   * tremor moving it 0.8px.
   */
  chamferPx: 0,

  /**
   * How far past `sdInner2`'s zero the girdle sits, CSS px.
   *
   * The widest the stone gets, and the reference every facet springs from.
   * Also what sets how deep inside the girdle the hotspot lands, which is
   * `chamferPx`'s whole subject.
   */
  girdlePx: 1,

  /** How tall the vertical band at the girdle is, CSS px. */
  girdleThickPx: 1,

  /**
   * The angle of the crown facets, degrees off the page.
   *
   * One of the two numbers that decide whether this is glass or a window. A
   * slab with parallel faces deviates nothing at normal incidence; a facet
   * at this angle deviates every ray that crosses it.
   *
   * It is also half of a BUDGET, and the other half is `pavilionDeg`. A ray
   * entering a facet at `crownDeg` leaves the entry turned `crownDeg -
   * asin(sin(crownDeg) / ior)` off vertical, and then meets a pavilion facet
   * already tilted `pavilionDeg` the other way, so the incidence inside is
   * about the sum. Past 38.1 degrees — the critical angle at index 1.62 —
   * that pavilion is a mirror and the page is not visible through the stone
   * at all. Measured 2026-08-25 at the hotspot: 30 + 15 puts the incidence
   * at 27.0 degrees and every ray goes through; 30 + 20 puts it at 38.6 and
   * the correction dies at the right of the screen; 50 + 24, which is what a
   * real brilliant is cut to, traps 51% of the light and reports no answer at
   * three of four screen positions.
   */
  crownDeg: 50,

  /** How far above the girdle the flat table sits, CSS px. */
  crownPx: 18,

  /**
   * The angle of the pavilion facets, degrees off the page, and how deep
   * they run from the girdle down to the keel.
   *
   * The pavilion is what makes a cut stone a cut stone rather than a lens.
   * A ray that crosses the crown meets the pavilion from INSIDE, where the
   * critical angle is 38.1 degrees at index 1.62 — so most of the pavilion
   * reflects rather than transmits, the ray zigzags across to the far side,
   * and it leaves through the crown carrying an image of somewhere else on
   * the page entirely. That superposition of several exits is the thing the
   * eye reads as a gem — and the reason a real brilliant is cut to 41
   * degrees is that at 41 almost NONE of it gets through, which is what
   * makes a diamond sparkle instead of being see-through. This scene needs
   * the page visible through the glass, so the cut is shallow and the
   * bouncing is what happens at the rim and the ridges rather than
   * everywhere. Measured 2026-08-25 over the arrow's interior: 3% of the
   * light that leaves the stone has crossed more than one face, against 24%
   * at a true brilliant's angles. `crownDeg` carries the budget the two
   * angles share.
   *
   * `pavilionPx` decides where the facets meet: they converge on the
   * arrow's own medial axis, a ridge down the shaft and a peak under the
   * head, at `pavilionPx / tan(pavilionDeg)` in from the girdle. The culet
   * plane at z = 0 catches whatever has not converged by then.
   */
  pavilionDeg: 16,
  pavilionPx: 67,

  /** How high the HOTSPOT floats above the page, CSS px — see `hotspotDrop`. */
  liftPx: 110,

  // ── the optics ───────────────────────────────────────────────────────

  /** Refractive index. */
  ior: 1.58,

  /**
   * The furthest the glass may move the page, CSS px.
   *
   * Not a fudge for the strength of the effect — the geometry decides that.
   * This is a cap on the handful of pixels at the silhouette where a grazing
   * ray bounces off the pavilion instead of crossing it and leaves almost
   * horizontally. Measured 2026-08-25 uncapped over the 40,264 pixels the
   * crystal covers at rest: the median displacement is 63px, the 99th
   * percentile is 67, and SEVEN pixels — 0.017% — want more than this. Those
   * seven want hundreds, and they move by hundreds when the hand moves by
   * one. Uncapped they smear the whole page into the rim.
   *
   * Both copies clamp, so the picture and the click stay the same function.
   */
  maxBendPx: 180,

  /** How far red and blue part company, as a fraction of the displacement. */
  dispersion: 0.01,

  /**
   * Where the light stands, degrees.
   *
   * Azimuth is measured on the page: 0 sends the light off to the right, 90
   * straight down the screen, so 45 is the over-the-left-shoulder light every
   * drawing of a solid object has used since the Renaissance. Elevation 90 is
   * straight down, which throws no shadow clear of the object and no caustic
   * worth the name — the whole picture lives in the slant.
   *
   * FIXED IN THE SHEET, not carried by the crystal: the highlight has to
   * sweep across the glass and the shadow has to swing as the hand moves, or
   * the object reads as a decal that happens to be shaded.
   */
  lightAzimuthDeg: 54,
  lightElevationDeg: 75,

  /**
   * How much of the reflected sky the glass shows, and what that sky is.
   *
   * Glass is a mirror at grazing incidence and a window head on, and that
   * Fresnel split is most of what makes it read as glass. There is no
   * environment map here, so the sky is two greys and a sun: `skyHigh`
   * overhead, `skyLow` below the horizon, and a lobe around the light. A
   * flat white wash instead of a reflection is what made the first solid
   * look like plastic — measured 2026-08-25, 100% of the visible arrow was
   * that wash.
   */
  edgeLight: 1.18,
  skyHigh: 0.31,
  skyLow: 0.68,

  /** The sun in that sky: how bright it is, and how tight. */
  specular: 20,
  specularPow: 192,

  /**
   * How much light the glass drinks, per 100px of path.
   *
   * Beer's law over the distance the ray actually spent inside, so a long
   * diagonal through the crown comes out darker than a short one through the
   * table. It is the depth cue that tells the eye the thing has a volume and
   * not just a surface, and on a lit page it is what stops clear glass over
   * white paper from disappearing.
   *
   * Tinted so red goes first — the green cast every thick edge of real glass
   * has — and applied per SEGMENT, so a ray that bounced around inside comes
   * out darker than one that went straight through. That is what tells the
   * eye which exit it is looking at. Measured 2026-08-25 over the arrow's
   * interior: the median path is 22.9px and leaves 81/86/83% of r/g/b, the
   * 99th percentile is 44.4px at 66/74/70%, and the longest bounced path is
   * 290px, which arrives at 7/14/10% and reads as the stone's dark heart.
   */
  absorbPer100: 1.1,

  // ── what it throws on the page ───────────────────────────────────────

  /** How dark the shadow goes at its darkest, 0 = no shadow. */
  shadow: 0.63,

  /** How far the shadow's edge is smeared, CSS px. */
  shadowSoftPx: 22.5,

  /** Weight of the light the glass focuses back onto the page. */
  caustic: 3,

  /** The brightest a fold is allowed to get, as a multiple of flat light. */
  causticClamp: 7.6,

  // ── the hand ─────────────────────────────────────────────────────────

  /**
   * The spring that drags the body, px/s² per px of lag, and its damping.
   *
   * The TIP never lags — it is the pointer, and a cursor that reported a
   * position its own hand had not reached would be lying. What lags is the
   * mass hanging off it, which is what a heavy glass pendant pinned at its
   * point would do.
   */
  followK: 1700,
  followD: 86,

  /** How far the body may fall behind the tip, CSS px. */
  maxLagPx: 186,

  /** Degrees of spin about the page's own normal, per 100px of lag. */
  spinPerLag: 8,

  /**
   * Degrees the solid rocks out of the page plane, per 100px of lag.
   *
   * About the axis across the direction of travel, so a flick to the right
   * lifts the left flank and you see under it. This is the deformation the
   * old flat version could only fake by stretching, and it is the one that
   * needs the object to have a thickness to be visible at all.
   */
  tiltPerLag: 8,
} satisfies Record<string, number>

export type CrystalTuning = typeof crystalTuning

export const CRYSTAL_GROUPS: CrystalKnobGroup[] = [
  {
    title: 'solid',
    knobs: [
      { key: 'scalePx', label: 'scale px/unit', min: 3, max: 16, step: 0.25 },
      { key: 'roundPx', label: 'outline px', min: 0, max: 30, step: 0.5 },
      { key: 'chamferPx', label: 'ground point px', min: 0, max: 40, step: 0.5 },
      { key: 'girdlePx', label: 'girdle px', min: 1, max: 60, step: 0.5 },
      { key: 'girdleThickPx', label: 'girdle band px', min: 0, max: 30, step: 0.5 },
      { key: 'crownDeg', label: 'crown deg', min: 5, max: 70, step: 1 },
      { key: 'crownPx', label: 'crown px', min: 0, max: 120, step: 1 },
      { key: 'pavilionDeg', label: 'pavilion deg', min: 5, max: 70, step: 1 },
      { key: 'pavilionPx', label: 'pavilion px', min: 0, max: 160, step: 1 },
      { key: 'liftPx', label: 'float px', min: 0, max: 200, step: 1 },
    ],
  },
  {
    title: 'optics',
    knobs: [
      { key: 'ior', label: 'index', min: 1, max: 2.5, step: 0.01 },
      { key: 'maxBendPx', label: 'bend cap px', min: 10, max: 600, step: 5 },
      { key: 'dispersion', label: 'dispersion', min: 0, max: 0.3, step: 0.005 },
      { key: 'lightAzimuthDeg', label: 'light azimuth', min: 0, max: 360, step: 1 },
      { key: 'lightElevationDeg', label: 'light elevation', min: 5, max: 90, step: 1 },
      { key: 'edgeLight', label: 'reflection', min: 0, max: 2, step: 0.02 },
      { key: 'skyHigh', label: 'sky high', min: 0, max: 1, step: 0.01 },
      { key: 'skyLow', label: 'sky low', min: 0, max: 1, step: 0.01 },
      { key: 'specular', label: 'sun', min: 0, max: 20, step: 0.1 },
      { key: 'specularPow', label: 'sun tightness', min: 8, max: 4000, step: 8 },
      { key: 'absorbPer100', label: 'absorption', min: 0, max: 2, step: 0.01 },
    ],
  },
  {
    title: 'on the page',
    knobs: [
      { key: 'shadow', label: 'shadow', min: 0, max: 1, step: 0.01 },
      { key: 'shadowSoftPx', label: 'shadow soft px', min: 0.5, max: 60, step: 0.5 },
      { key: 'caustic', label: 'caustic', min: 0, max: 3, step: 0.02 },
      { key: 'causticClamp', label: 'caustic cap', min: 1, max: 8, step: 0.1 },
    ],
  },
  {
    title: 'hand',
    knobs: [
      { key: 'followK', label: 'spring', min: 100, max: 3000, step: 25 },
      { key: 'followD', label: 'damping', min: 4, max: 140, step: 1 },
      { key: 'maxLagPx', label: 'max lag px', min: 0, max: 200, step: 2 },
      { key: 'spinPerLag', label: 'spin deg/100px', min: 0, max: 60, step: 1 },
      { key: 'tiltPerLag', label: 'tilt deg/100px', min: 0, max: 60, step: 1 },
    ],
  },
]
