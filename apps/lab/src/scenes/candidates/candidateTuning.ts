// The candidates' tuning surface — every number a hand wants to drag while
// judging an effect, one live bag per candidate.
//
// Writes go straight into these objects and nothing re-renders (the
// GlassTweaks doctrine): each material's useFrame copies its bag into its
// uniforms every frame, and the CPU drives (unroll, peel) read the bag
// mid-loop. Durations are picked up at the start of the next run, because
// a flight's PhaseDrive mounts per run.
//
// The defaults ARE the committed values. When a session lands on numbers
// worth keeping, the copy button's JSON is pasted back over these literals
// — the bag is the single place the tuned values live, and the candidate
// files no longer carry their own copies.

export const rippleTuning = {
  durationMs: 1640,
  /** Peak lift of the far corners, px toward the camera. */
  lift: 36,
  /** Wave amplitude at the free edge, px of silhouette bend. */
  bend: 14,
  /** Wavelength, as a fraction of the control's half-diagonal. */
  waveSpan: 0.4,
  /** Full wave cycles over one press. */
  flapCycles: 4.6,
  /** Ring train length behind the front, in wavelengths. */
  tail: 3.35,
  shadeGain: 0.55,
  /** Where the settle window opens, as a fraction of the run. Past this
   *  every wave tapers to zero height and zero velocity, so the sheet is
   *  flat before the DOM takes the pixels back. */
  settle: 0.72,
  /** Shadow opacity under a mid-height caster. */
  shadowAlpha: 0.14,
  /** Penumbra width at full lift, px of edge feather. */
  shadowSoft: 10,
}

export const selectionTuning = {
  height: 17.5,
  /** Rolloff scale of the drop profile h = H·√(1 − exp(d/edge)), px:
   *  smaller is a steeper rim and a fuller middle. */
  edge: 24,
  /** Corner radius, px, capped at the strip's half-height: at the cap the
   *  strip's ends are stadium-round. */
  corner: 24,
  /** Smooth-min radius, px, fusing neighbouring strips into one body. */
  weld: 0,
  /** Weld px at which the strips count as fully merged. Gates the √area
   *  law — see WELD_FULL's use in CandidateSelection. */
  weldFull: 30,
  magnify: 0.03,
  refract: 5,
  /** Body size — √(selection area), px — at which the bend reaches the
   *  full `refract` value. Smaller selections bend proportionally less.
   *  Only applies to the degree the strips are welded into one body. */
  bodyPx: 130,
  /** Index of refraction; 1.45 is crown-glass territory. The bend length
   *  stays `refract` — this shapes how it ramps toward the rim. */
  ior: 2.4,
  disperse: 0,
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
  /** Light bearing, degrees. 123/51 reproduces the shared LIGHT vector
   *  the other candidates are lit by. */
  lightAz: 83,
  lightEl: 34,
  /** 0 = the fixed bearing above; 1 = a point light riding the cursor.
   *  The shadow direction follows the same blend. */
  follow: 0.36,
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

export const unrollTuning = {
  /** Core radius of the roll's innermost turn, px. */
  radius: 13,
  /** Spacing between successive turns, px. */
  ply: 2.5,
  /** Time constant of the open/close ease, s. */
  tau: 0.085,
  shade: 0.55,
}

export const dissolveTuning = {
  flightMs: 1150,
  swirl: 34,
  bulge: 90,
  twist: 3.4,
  stagger: 0.34,
  spark: 0.06,
  flareGain: 0.85,
}

export const analyzeTuning = {
  /** One scan pass, and the reader's dwell on each block, ms. */
  dwellMs: 1900,
  lift: 6,
  wave: 1.6,
  scanWidth: 0.16,
  disperse: 0.0038,
  prism: 0.9,
  glow: 0.1,
  edgeGain: 5.5,
  backGain: 0.11,
}

export const copyTuning = {
  durationMs: 560,
  /** Radians of twist over the flight. */
  twist: 2.6,
  /** Peak height off the page mid-flight, px. */
  arc: 90,
  /** Fraction of the flight spent handing out per-vertex start times. */
  lag: 0.42,
  /** Peak sideways bow of the flight path, px; each run rolls its own
   *  direction at the click. */
  sway: 60,
  /** Bound on the broad diffuse term, ± fraction of the sheet's colour. */
  diffuse: 0.1,
  specPow: 48,
  specGain: 0.85,
}

export const deleteTuning = {
  meltMs: 1250,
  waver: 9,
  streams: 5,
  gather: 0.82,
  shatterMs: 950,
  spread: 340,
  pop: 260,
  spin: 11,
  kick: 190,
  /** Gravity as a multiple of the exit distance. */
  gravity: 1.35,
  peelMs: 1050,
  peelRadius: 9,
  peelPly: 2.2,
  peelShade: 0.6,
}

export interface CandidateKnobDef<B> {
  key: keyof B & string
  label: string
  min: number
  max: number
  step: number
}

export interface CandidateKnobGroup<B> {
  title: string
  knobs: CandidateKnobDef<B>[]
}

export const RIPPLE_GROUPS: CandidateKnobGroup<typeof rippleTuning>[] = [
  {
    title: 'press',
    knobs: [
      { key: 'durationMs', label: 'duration ms', min: 300, max: 2000, step: 20 },
      { key: 'lift', label: 'lift px', min: 0, max: 150, step: 2 },
      { key: 'bend', label: 'bend px', min: 0, max: 40, step: 1 },
      { key: 'waveSpan', label: 'wavelength', min: 0.2, max: 2, step: 0.05 },
      { key: 'flapCycles', label: 'flap cycles', min: 0.5, max: 5, step: 0.1 },
      { key: 'tail', label: 'ring tail', min: 0.3, max: 4, step: 0.05 },
      { key: 'shadeGain', label: 'shading', min: 0, max: 2, step: 0.05 },
      { key: 'settle', label: 'settle from', min: 0.4, max: 0.95, step: 0.01 },
    ],
  },
  {
    title: 'shadow',
    knobs: [
      { key: 'shadowAlpha', label: 'opacity', min: 0, max: 0.8, step: 0.02 },
      { key: 'shadowSoft', label: 'penumbra px', min: 1, max: 40, step: 1 },
    ],
  },
]

export const SELECTION_GROUPS: CandidateKnobGroup<typeof selectionTuning>[] = [
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

export const UNROLL_GROUPS: CandidateKnobGroup<typeof unrollTuning>[] = [
  {
    title: 'roll',
    knobs: [
      { key: 'radius', label: 'core radius px', min: 6, max: 40, step: 1 },
      { key: 'ply', label: 'ply px', min: 0.5, max: 8, step: 0.1 },
      { key: 'tau', label: 'ease tau s', min: 0.03, max: 0.4, step: 0.005 },
      { key: 'shade', label: 'shading', min: 0, max: 1.5, step: 0.05 },
    ],
  },
]

export const DISSOLVE_GROUPS: CandidateKnobGroup<typeof dissolveTuning>[] = [
  {
    title: 'flight',
    knobs: [
      { key: 'flightMs', label: 'duration ms', min: 400, max: 3000, step: 50 },
      { key: 'bulge', label: 'arc height px', min: 0, max: 300, step: 5 },
      { key: 'twist', label: 'twist rad', min: 0, max: 8, step: 0.1 },
      { key: 'stagger', label: 'stagger', min: 0, max: 0.8, step: 0.02 },
    ],
  },
  {
    title: 'grains',
    knobs: [
      { key: 'swirl', label: 'swirl px', min: 0, max: 120, step: 2 },
      { key: 'spark', label: 'spark', min: 0, max: 0.4, step: 0.01 },
      { key: 'flareGain', label: 'flare', min: 0, max: 1, step: 0.02 },
    ],
  },
]

export const ANALYZE_GROUPS: CandidateKnobGroup<typeof analyzeTuning>[] = [
  {
    title: 'scan',
    knobs: [
      { key: 'dwellMs', label: 'dwell ms', min: 600, max: 5000, step: 100 },
      { key: 'scanWidth', label: 'band width', min: 0.04, max: 0.5, step: 0.01 },
      { key: 'glow', label: 'band glow', min: 0, max: 0.5, step: 0.01 },
    ],
  },
  {
    title: 'sheet',
    knobs: [
      { key: 'lift', label: 'lift px', min: 0, max: 30, step: 0.5 },
      { key: 'wave', label: 'ripple px', min: 0, max: 6, step: 0.1 },
      { key: 'disperse', label: 'disperse', min: 0, max: 0.02, step: 0.0002 },
      { key: 'prism', label: 'prism', min: 0, max: 2, step: 0.05 },
      { key: 'edgeGain', label: 'edge gain', min: 0, max: 15, step: 0.25 },
      { key: 'backGain', label: 'backlight', min: 0, max: 0.4, step: 0.01 },
    ],
  },
]

export const COPY_GROUPS: CandidateKnobGroup<typeof copyTuning>[] = [
  {
    title: 'flight',
    knobs: [
      { key: 'durationMs', label: 'duration ms', min: 250, max: 1600, step: 10 },
      { key: 'twist', label: 'twist rad', min: 0, max: 6, step: 0.1 },
      { key: 'arc', label: 'arc px', min: 0, max: 300, step: 5 },
      { key: 'lag', label: 'lag', min: 0, max: 0.8, step: 0.02 },
      { key: 'sway', label: 'sway px', min: 0, max: 200, step: 5 },
    ],
  },
  {
    title: 'material',
    knobs: [
      { key: 'diffuse', label: 'diffuse ±', min: 0, max: 0.5, step: 0.01 },
      { key: 'specPow', label: 'spec power', min: 4, max: 128, step: 2 },
      { key: 'specGain', label: 'spec gain', min: 0, max: 2, step: 0.05 },
    ],
  },
]

export const DELETE_GROUPS: CandidateKnobGroup<typeof deleteTuning>[] = [
  {
    title: 'melt',
    knobs: [
      { key: 'meltMs', label: 'duration ms', min: 500, max: 3000, step: 50 },
      { key: 'streams', label: 'streams', min: 2, max: 12, step: 1 },
      { key: 'waver', label: 'waver px', min: 0, max: 20, step: 0.5 },
      { key: 'gather', label: 'gather', min: 0, max: 1, step: 0.02 },
    ],
  },
  {
    title: 'shatter',
    knobs: [
      { key: 'shatterMs', label: 'duration ms', min: 400, max: 2500, step: 50 },
      { key: 'spread', label: 'spread px', min: 0, max: 800, step: 10 },
      { key: 'pop', label: 'pop px', min: 0, max: 600, step: 10 },
      { key: 'spin', label: 'spin', min: 0, max: 30, step: 0.5 },
      { key: 'kick', label: 'kick px', min: 0, max: 600, step: 10 },
      { key: 'gravity', label: 'gravity ×', min: 0, max: 4, step: 0.05 },
    ],
  },
  {
    title: 'peel',
    knobs: [
      { key: 'peelMs', label: 'duration ms', min: 500, max: 2500, step: 50 },
      { key: 'peelRadius', label: 'core radius px', min: 4, max: 30, step: 0.5 },
      { key: 'peelPly', label: 'ply px', min: 0.5, max: 8, step: 0.1 },
      { key: 'peelShade', label: 'shading', min: 0, max: 1.5, step: 0.05 },
    ],
  },
]
