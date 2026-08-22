// The bead's tuned values — one live bag the sliders write into.
//
// Every material reads these on its next frame, so a slider takes effect
// without a remount. The panel's copy button dumps the bag as JSON, ready
// to paste back over the literals here; a number nobody can cite gets
// approximated by the next reader, so each one that is not obvious says
// why it is what it is.

export interface SelectionKnobDef<B> {
  key: keyof B & string
  label: string
  min: number
  max: number
  step: number
}

export interface SelectionKnobGroup<B> {
  title: string
  knobs: SelectionKnobDef<B>[]
}

export const selectionTuning = {
  height: 17.5,
  /** Rolloff scale of the drop profile h = H·√(1 − exp(d/edge)), px:
   *  smaller is a steeper rim and a fuller middle. */
  edge: 30,
  /** Corner radius, px, capped at the strip's half-height: at the cap the
   *  strip's ends are stadium-round. */
  corner: 24,
  /** Smooth-min radius, px, fusing neighbouring strips into one body. */
  weld: 0,
  /** Weld px at which the strips count as fully merged. Gates the √area
   *  law — see its use in Selection.tsx. */
  weldFull: 30,
  magnify: 0.03,
  refract: 20,
  /** Body size — √(selection area), px — at which the bend reaches the
   *  full `refract` value. Smaller selections bend proportionally less.
   *  Only applies to the degree the strips are welded into one body. */
  bodyPx: 190,
  /** Index of refraction; 1.45 is crown-glass territory. The bend length
   *  stays `refract` — this shapes how it ramps toward the rim. */
  ior: 1.1,
  disperse: 0.07,
  /** Scatter radius of the frosted body, px. Shares the dispersion loop's
   *  eight taps, so it costs nothing extra. */
  frost: 0,
  shadowX: 0,
  shadowY: 5,
  shadowSoft: 8,
  shadowAlpha: 0.1,
  /** Gain on the caustic — the bright band the rim focuses just outside
   *  the silhouette, down-light of the body. */
  caustic: 0.74,
  /** Light bearing, degrees. The bead is lit from its own bearing, not the
   *  shared LIGHT vector — 123/51 would reproduce that one. An elevation
   *  this low is a grazing light, which is what stretches the sheen along
   *  the whole length of a strip instead of pooling it in the middle. */
  lightAz: 87,
  lightEl: 5,
  /** 0 = the fixed bearing above; 1 = a point light riding the cursor.
   *  The shadow direction follows the same blend. */
  follow: 0.32,
  /** The cursor light's height above the page, px. Lower swings the
   *  highlights faster as the pointer passes. */
  lightZ: 570,
  /** Absorption strength: how deeply the body colours what shows through
   *  it. Multiplicative — the ink stays dark, the paper takes the cast. */
  tintGain: 0.59,
  /** Gain on the mirrored environment: the white streak on the upper
   *  curvature and the dark floor in the lower rim. */
  reflect: 0.66,
  depth: 0,
  /** Post-normalization gains: the shader's (n+2)/2π factor keeps lobe
   *  energy constant, so these run ~10x smaller than the old raw gains. */
  spec: 0.05,
  /** Highlight tightness: higher is a smaller, harder glint. */
  specPow: 256,
  /** Alpha of the glint layer: 0 is no highlight, 1 is opaque white that
   *  hides the words it crosses. Gain sizes the lobe, this dims it. */
  specOpacity: 1,
  sheen: 0.6,
  sheenPow: 24,
  /** Alpha of the sheen layer — same meaning as specOpacity. */
  sheenOpacity: 0.34,
  rim: 0.48,
  /** Fresnel falloff: lower spreads the rim glow inward from the border. */
  rimPow: 1.9,
}

export const SELECTION_GROUPS: SelectionKnobGroup<typeof selectionTuning>[] = [
  {
    title: 'glass body',
    knobs: [
      { key: 'height', label: 'inflate px', min: 0, max: 24, step: 0.5 },
      // Rolloff scale of the drop profile h = H·sqrt(1 - exp(d/edge)):
      // smaller is a steeper rim and a fuller middle; larger melts the
      // whole body toward a shallow film.
      { key: 'edge', label: 'rim rolloff px', min: 1, max: 48, step: 0.5 },
      { key: 'corner', label: 'corner px', min: 0, max: 24, step: 0.5 },
      // Top of range is weldFull, so "slider at max" and "strips fully
      // merged" stay the same number.
      { key: 'weld', label: 'weld px', min: 0, max: selectionTuning.weldFull, step: 0.5 },
      { key: 'magnify', label: 'magnify', min: 0, max: 0.2, step: 0.005 },
      { key: 'refract', label: 'refract px', min: 0, max: 20, step: 0.25 },
      { key: 'bodyPx', label: 'full bend √px', min: 60, max: 600, step: 10 },
      { key: 'ior', label: 'ior', min: 1, max: 2.4, step: 0.01 },
      { key: 'disperse', label: 'disperse', min: 0, max: 0.6, step: 0.01 },
      { key: 'frost', label: 'frost px', min: 0, max: 12, step: 0.25 },
    ],
  },
  {
    title: 'light',
    knobs: [
      { key: 'lightAz', label: 'light az °', min: 0, max: 360, step: 1 },
      { key: 'lightEl', label: 'light el °', min: 5, max: 85, step: 1 },
      { key: 'follow', label: 'follow cursor', min: 0, max: 1, step: 0.02 },
      { key: 'lightZ', label: 'light height px', min: 60, max: 800, step: 10 },
      { key: 'tintGain', label: 'tint', min: 0, max: 0.6, step: 0.01 },
      { key: 'reflect', label: 'reflect', min: 0, max: 1, step: 0.02 },
      { key: 'depth', label: 'depth', min: 0, max: 0.5, step: 0.01 },
      { key: 'spec', label: 'specular', min: 0, max: 2, step: 0.05 },
      { key: 'specPow', label: 'spec power', min: 4, max: 256, step: 2 },
      { key: 'specOpacity', label: 'spec opacity', min: 0, max: 1, step: 0.02 },
      { key: 'sheen', label: 'sheen', min: 0, max: 0.6, step: 0.01 },
      { key: 'sheenPow', label: 'sheen power', min: 2, max: 24, step: 0.5 },
      { key: 'sheenOpacity', label: 'sheen opacity', min: 0, max: 1, step: 0.02 },
      { key: 'rim', label: 'rim light', min: 0, max: 1, step: 0.02 },
      { key: 'rimPow', label: 'rim falloff', min: 1, max: 6, step: 0.1 },
    ],
  },
  {
    title: 'shadow',
    knobs: [
      { key: 'shadowX', label: 'offset x px', min: -10, max: 10, step: 0.5 },
      { key: 'shadowY', label: 'offset y px', min: -10, max: 10, step: 0.5 },
      { key: 'shadowSoft', label: 'soften px', min: 0, max: 20, step: 0.5 },
      { key: 'shadowAlpha', label: 'opacity', min: 0, max: 0.8, step: 0.02 },
      { key: 'caustic', label: 'caustic', min: 0, max: 1, step: 0.02 },
    ],
  },
]
