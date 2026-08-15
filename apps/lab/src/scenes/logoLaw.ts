// The wordmark law — the pure half of the logo playground.
//
// The logo is six letters that never agree: each wears its own face,
// color, tilt and drift, and a conductor re-rolls one letter at a time
// on a swung beat. Everything that decides WHAT a letter becomes lives
// here as pure functions over a seeded rng, so the choreography is
// testable and a reroll of the same seed replays the same word.
//
// Two constraints keep haphazard from collapsing into mud:
//   - a letter never re-rolls into the face or color it already wears
//     (a beat that changes nothing reads as a dropped beat), and
//   - a letter avoids its neighbors' faces and colors, which is what
//     makes the word read as six voices instead of an accident.

export type Rand = () => number

/** Deterministic rng (mulberry32) — one seed, one choreography. */
export function makeRng(seed: number): Rand {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface LogoFont {
  /** CSS font-family value, quoted and with a fallback. */
  family: string
  /**
   * Optical trim: multiplies the shared size so nine faces read as one
   * word. Eyeballed against the bench — Caveat's x-height runs tiny,
   * Silkscreen's pixels run huge — and meant to be re-eyeballed here.
   */
  trim: number
  /** The weights this face actually ships; rolled uniformly. */
  weights: number[]
}

// Three resident bench voices (index.html) plus six guests the logo
// page loads for itself — pixel, bubble, marker, juice: the registers
// the sketch mixes.
export const LOGO_FONTS: LogoFont[] = [
  { family: "'Bodoni Moda', serif", trim: 1.0, weights: [400, 500, 600, 700, 800, 900] },
  { family: "'Archivo', sans-serif", trim: 0.96, weights: [500, 600, 700, 800, 900] },
  { family: "'Courier Prime', monospace", trim: 1.04, weights: [400, 700] },
  { family: "'Fraunces', serif", trim: 1.0, weights: [300, 500, 700, 900] },
  { family: "'DynaPuff', system-ui", trim: 0.95, weights: [400, 600, 700] },
  { family: "'Pixelify Sans', monospace", trim: 0.98, weights: [400, 600, 700] },
  { family: "'Silkscreen', monospace", trim: 0.8, weights: [400, 700] },
  { family: "'Caveat', cursive", trim: 1.3, weights: [400, 600, 700] },
  { family: "'Shrikhand', serif", trim: 0.95, weights: [400] },
]

// Candy on litho ink — sampled off the sketch, two extras so six
// letters plus two neighbors' exclusions still leave the rng a choice.
export const LOGO_PALETTE = [
  '#f2695c', // coral
  '#e3ec5a', // chartreuse
  '#f07ff0', // orchid
  '#52c7f2', // sky
  '#b47deb', // violet
  '#66c94e', // leaf
  '#f5a53f', // tangerine
  '#f76fa2', // bubblegum
]

/** The matter deck — what a lifted letter is MADE of. Index 0 is plain
 *  ink, the page's own look kept as a rest note: a word where one letter
 *  stays mere ink shows what its siblings transmuted from. The rest are
 *  substances only the canvas can render — each one is a MATTER_PARAMS
 *  row in logoShaders, aligned with this list by index (the shader
 *  suite pins the alignment). The conductor deals them exactly like
 *  faces and colors, so in matter mode a beat transmutes a letter, not
 *  just redecorates it. */
export const LOGO_MATTERS = [
  'ink',
  'balloon',
  'foil',
  'gummy',
  'neon',
  'chrome',
  'pearl',
  'velvet',
  'holo',
  'plasma',
  'enamel',
] as const

export interface LogoKnobs {
  /** ms between conductor beats. */
  tempo: number
  /** 0..1 — fraction of tempo each beat may drift, either direction. */
  swing: number
  /** 0..1 — chance a beat sweeps the whole word instead of one letter. */
  wave: number
  /** deg — max |rotation| a pose may carry. */
  tilt: number
  /** em — max |x/y offset| a pose may carry. */
  drift: number
  /** max scale deviation from 1 (0.12 → letters live in 0.88..1.12). */
  squish: number
  /** em — idle float amplitude of the DOM letters. */
  float: number
  /** px — matter mode: z amplitude of the depth bob. */
  depth: number
  /** px — matter mode: how far a letter shies away from the pointer. */
  dodge: number
  /** 0..1 — matter mode: how hard the substances are lit (bevel shade,
   *  glints, reflections, glow). Zero is flat ink for every matter. */
  gloss: number
  /** 0..2 — matter mode: walks every matter's roughness matte ↔ mirror
   *  around its deck value. 1 is the deck as tuned. */
  polish: number
  /** 0..2 — matter mode: trim on the fabric rim (velvet, pearl). A
   *  matter whose deck row carries no sheen ignores it. */
  sheen: number
  /** 0..2 — matter mode: trim on the thin-film tint (holo, pearl). */
  irid: number
  /** 0..2 — matter mode: trim on the emissive matters — the tube and
   *  its halo (neon, plasma). Above 1 overdrives the tube. */
  glow: number
  /** 0..1 — matter mode: how far the weave rolls the letter — the
   *  orbit radius every matter shares, scaled by its own softness
   *  above WEAVE.floor (gummy deepest, enamel least). 0 becalms the
   *  word; 1 is a heavy sea. */
  jelly: number
  /** 0..1 — matter mode: chromatic fringe on a moving letter. */
  prism: number
  /** px — matter mode: how far the height field PUSHES the sheet at
   *  full coverage, scaled per matter by `dome`. Shading alone makes a
   *  letter look domed; this makes it one. */
  relief: number
  /** 0..1 — matter mode: how much of `relief` the MESH carries. The
   *  rest stays a bump. Lighting is identical at both ends, so this
   *  buys parallax and a real silhouette without restyling the letter:
   *  0 is a flat card lit as a dome, 1 is a dome. */
  body: number
  /** px — matter mode: how far the letter's traced outline (logoContour)
   *  extrudes back into real side walls. Zero is a sheet. */
  extrude: number
  /** deg — matter mode: the key light's swing around the vertical, 0
   *  dead ahead of the letters, negative to their left. One direction
   *  drives the analytic key AND its softbox twin in the studio
   *  (logoShaders), so the glint and the shading always agree. */
  lightYaw: number
  /** deg — matter mode: the key light's climb above the horizon. */
  lightPitch: number
  /** 0..2 — matter mode: key light brightness. 1 is the shipped rig. */
  key: number
  /** 0.2..2 — matter mode: key softbox size — tight glint ↔ broad sheet. */
  keySoft: number
  /** 0..2 — matter mode: the cool fill and floor bounce together. */
  fill: number
  /** 0..2 — matter mode: the room grade, the studio's ambient base.
   *  Below 1 this undercuts the perceptual floor the shader suite
   *  pins — a bench excursion, deliberately reachable, never shipped. */
  room: number
  /** 0..2 — matter mode: the front fill on the view axis — the light
   *  a flat mirror reflects. Zero returns chrome to a void. */
  front: number
  /** ×wavelength — matter mode: the gel weave's scale. 1 is the tuned
   *  weave; below tightens it toward chop, above opens it toward
   *  swell. */
  waveScale: number
  /** ×speed — matter mode: how fast the weave travels. 0 freezes it
   *  mid-pose. */
  waveSpeed: number
  /** deg — matter mode: rotates the weave's two travel axes together. */
  waveAngle: number
  /** 0..2 — matter mode: how hard a strike rings the letter. A tap on
   *  a letter and a beat re-dealing one both strike; 0 disarms both. */
  ripple: number
  /** 0..2 — matter mode: how far travel deforms the letter — squash
   *  and stretch along the motion, area-conserving, gone at rest. */
  stretch: number
}

export const LOGO_DEFAULTS: LogoKnobs = {
  tempo: 1100,
  swing: 0.45,
  wave: 0.12,
  tilt: 10,
  drift: 0.08,
  squish: 0.12,
  float: 0.045,
  depth: 60,
  dodge: 46,
  gloss: 0.7,
  polish: 1,
  sheen: 1,
  irid: 1,
  glow: 1,
  jelly: 0.55,
  prism: 0.5,
  relief: 22,
  body: 1,
  // Off by default. Extrusion is the one effect that costs a readback
  // and a mesh rebuild per glyph change, so it stays something the
  // bench opts into rather than something every visit pays for.
  extrude: 0,
  // The rig at identity: gains of exactly 1 are what the studio's
  // conformance sweep measures, and the yaw/pitch pair reproduces the
  // key the letters shipped under (−0.42, 0.58, 0.7 in world).
  lightYaw: -31,
  lightPitch: 35,
  key: 1,
  keySoft: 1,
  fill: 1,
  room: 1,
  front: 1,
  // The motion rig at identity: scale and speed of exactly 1 and an
  // angle of 0 reproduce the gel weave the letters shipped with
  // (logoLaw.test pins this). Strikes and stretch are new motions, on
  // by default at their tuned strength.
  waveScale: 1,
  waveSpeed: 1,
  waveAngle: 0,
  ripple: 1,
  stretch: 1,
}

export interface LetterPose {
  /** Index into LOGO_FONTS. */
  font: number
  /** Index into LOGO_PALETTE. */
  color: number
  weight: number
  /** deg. */
  tilt: number
  /** em. */
  dx: number
  /** em. */
  dy: number
  scale: number
  /** Index into LOGO_MATTERS — the substance this letter becomes when
   *  the word lifts. The page ignores it; only matter mode can see it. */
  matter: number
}

/** What a re-roll must not land on: the letter's own current face,
 *  color, and matter, plus whatever its neighbors wear right now. */
export interface PoseAvoid {
  fonts: number[]
  colors: number[]
  matters: number[]
}

function pickIndex(r: Rand, n: number, avoid: number[]): number {
  const open: number[] = []
  for (let i = 0; i < n; i++) if (!avoid.includes(i)) open.push(i)
  // Over-constrained (avoid covers everything) falls back to the full
  // deck rather than throwing — a haphazard logo shrugs, it never crashes.
  const pool = open.length ? open : Array.from({ length: n }, (_, i) => i)
  return pool[Math.floor(r() * pool.length)]
}

export function rollPose(r: Rand, avoid: PoseAvoid, k: LogoKnobs): LetterPose {
  const font = pickIndex(r, LOGO_FONTS.length, avoid.fonts)
  const color = pickIndex(r, LOGO_PALETTE.length, avoid.colors)
  const matter = pickIndex(r, LOGO_MATTERS.length, avoid.matters)
  const weights = LOGO_FONTS[font].weights
  return {
    font,
    color,
    weight: weights[Math.floor(r() * weights.length)],
    tilt: (r() * 2 - 1) * k.tilt,
    dx: (r() * 2 - 1) * k.drift,
    dy: (r() * 2 - 1) * k.drift,
    scale: 1 + (r() * 2 - 1) * k.squish,
    matter,
  }
}

/** Roll a whole word left to right, each letter dodging its left
 *  neighbor's face, color, and matter. */
export function seedWord(n: number, r: Rand, k: LogoKnobs): LetterPose[] {
  const word: LetterPose[] = []
  for (let i = 0; i < n; i++) {
    const left = word[i - 1]
    word.push(
      rollPose(
        r,
        left
          ? { fonts: [left.font], colors: [left.color], matters: [left.matter] }
          : { fonts: [], colors: [], matters: [] },
        k,
      ),
    )
  }
  return word
}

// ── the word's fixed grid ───────────────────────────────────────────────
//
// Letters sit in slots of FIXED advance, absolutely positioned: a font
// swap redecorates a slot, it never re-measures the line. Without this
// the word breathes — every swap changes one glyph's advance, the flex
// row re-lays out, and five innocent letters shuffle sideways to make
// room. The widths are eyeballed averages across the nine faces, in em
// of the word's size, and meant to be re-eyeballed here.

export const LETTER_SLOT_EM: Record<string, number> = {
  m: 0.98,
  u: 0.68,
  n: 0.68,
  a: 0.62,
  r: 0.52,
  i: 0.34,
}
export const SLOT_GAP_EM = 0.08
export const SLOT_FALLBACK_EM = 0.66

export interface SlotBox {
  /** em from the word's left edge. */
  left: number
  /** em. */
  width: number
}

export function slotLayout(word: string): { slots: SlotBox[]; width: number } {
  const slots: SlotBox[] = []
  let x = 0
  for (const ch of word) {
    const width = LETTER_SLOT_EM[ch] ?? SLOT_FALLBACK_EM
    slots.push({ left: x, width })
    x += width + SLOT_GAP_EM
  }
  return { slots, width: x - SLOT_GAP_EM }
}

// ── the conductor's beat ────────────────────────────────────────────────

export interface BeatStep {
  letter: number
  /** ms after the beat lands. */
  delay: number
}

/** ms per letter of distance when a wave sweeps the word. */
export const WAVE_STEP_MS = 85

/** ms of per-step jitter on top. Additive and smaller than one step on
 *  purpose: d·STEP + JITTER < (d+1)·STEP for every d, so the metronome
 *  loosens without ever reordering the sweep. (A ±15% multiplicative
 *  jitter looked safe and reorders from d=3 on — the suite caught it.) */
export const WAVE_JITTER_MS = 24

/** A sweep from one end of the word to the other. */
export function waveSteps(r: Rand, n: number): BeatStep[] {
  const origin = r() < 0.5 ? 0 : n - 1
  const steps: BeatStep[] = []
  for (let i = 0; i < n; i++) {
    const dist = Math.abs(i - origin)
    steps.push({ letter: i, delay: dist === 0 ? 0 : dist * WAVE_STEP_MS + r() * WAVE_JITTER_MS })
  }
  return steps
}

/** What this beat does: usually one random letter, sometimes the wave. */
export function beatPlan(r: Rand, n: number, k: LogoKnobs): BeatStep[] {
  if (r() < k.wave) return waveSteps(r, n)
  return [{ letter: Math.floor(r() * n), delay: 0 }]
}

/** When the next beat lands: tempo swung by ±swing, floored so a wild
 *  swing setting cannot collapse the loop into a spin. */
export function nextBeat(r: Rand, k: LogoKnobs): number {
  return Math.max(120, k.tempo * (1 + (r() * 2 - 1) * k.swing))
}

// ── the lighting rig ────────────────────────────────────────────────────

/** The key light's direction from the panel's two position dials —
 *  yaw swings around the vertical (0 is dead ahead of the letters,
 *  negative left), pitch climbs from the horizon — in degrees because
 *  the panel speaks degrees. Pure math, shared by the uniform feed
 *  (Logo.tsx) and the studio's conformance sweep (logoShaders.test),
 *  so the two can never disagree about where the key stands. */
export function lightDir(yawDeg: number, pitchDeg: number): [number, number, number] {
  const yaw = (yawDeg * Math.PI) / 180
  const pitch = (pitchDeg * Math.PI) / 180
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)]
}

// ── the motion rig ──────────────────────────────────────────────────────

/** The gel weave — the resting motion a soft letter wears: ONE swell
 *  that travels the whole word. The numbers live HERE rather than as
 *  shader or feed literals because the wave dials scale them on the
 *  way to the uniforms, and a dial's identity — ×1 reproduces the
 *  shipped weave — is a law: the numbers must be somewhere a test can
 *  hold them. Lengths are em of the letter's font size (the weave must
 *  read the same on a phone glyph and a display glyph), speeds rad/s.
 *
 *  Re-tuned three times on 2026-08-14, all on one report — "a
 *  rumble", "erratic shaking", "no wave at all". The lessons, each
 *  now load-bearing:
 *  · The WORD is the unit, not the glyph: the field is continuous
 *    across the word (uWaveOrigin) and the dominant wavelength is
 *    word-scale, so a crest marches out of one letter into the next.
 *  · The sea is STEADY: excitation pumping the height on every beat
 *    read as shaking. Strikes answer through the rings alone.
 *  · The PAINT must carry the wave: out-of-plane height reaches a
 *    face-on eye only through lighting, and lighting is invisible on
 *    matte matters. The weave is a Gerstner ORBIT — in-plane surge
 *    plus heave — so the ink itself rolls, flag-like, on every
 *    matter. The floor keeps six different matters on ONE sea. */
export const WEAVE = {
  /** Wavelengths, em: a word-scale swell (two-plus crests across the
   *  word — the crest clause) and a glyph-scale cross ripple for
   *  detail. Both clear the sheet grid at the smallest font (the
   *  Nyquist clause, shared with RIPPLE.lambda). */
  lambda: [1.4, 0.62],
  /** Angular speeds, rad/s: the swell bobs at ~0.56 Hz and its crest
   *  crosses the word in about six seconds — a flag in a slow wind,
   *  which is the whole brief. Incommensurate, so the pair never
   *  locks into a standing pattern. */
  w: [3.5, 5.1],
  /** Orbit radius at rest, em, at knob 1 on the softest matter — and
   *  at rest is where it stays: excitation never scales it. With
   *  lambda[0] this sets both the surge the paint shows and the
   *  steepness the lighting shows (the legibility clause pins the
   *  product). A trochoid cusps at steepness 1 and self-intersects
   *  past it; the shipped weave sits near 0.22, so only a deliberate
   *  excursion — jelly at max under a hard-tightened waveScale —
   *  can reach the fold. */
  amp: 0.09,
  /** How much of the sea the HARDEST matter still rides, 0..1 — the
   *  same shape as RIPPLE.floor, for the same reason turned outward:
   *  a sea that skips the chrome letter breaks into six private
   *  waters, and the word stops reading as one surface. Softness
   *  scales the remainder, so gummy settles deeper than chrome. */
  floor: 0.35,
} as const

/** The strike rig: a tap (or a beat re-dealing a letter) rings the
 *  sheet with an expanding, decaying wave packet. Lengths are in em of
 *  the letter's font size — a ring must read the same on a phone glyph
 *  and a display glyph — and times are seconds. */
export const RIPPLE = {
  /** Live rings a letter carries at once; a fresh strike recycles the
   *  DEADEST slot (strikeSlot), so drumming degrades oldest-first. */
  slots: 4,
  /** Ring wavelength, em. At the lab's smallest font (64 px) this is
   *  ~27 px — about seven sheet steps (SHEET_STEP_PX 4), so the vertex
   *  grid carries the ring instead of aliasing it. */
  lambda: 0.42,
  /** Gaussian half-width of the ring packet, em. */
  width: 0.18,
  /** Front speed, em/s: a ring crosses its glyph in about half a
   *  second — fast enough to answer the tap, slow enough to watch. */
  speed: 1.9,
  /** Amplitude e-folding time, s: the ring-down. */
  tau: 0.55,
  /** Peak displacement of a full-power strike, em. */
  amp: 0.05,
  /** The share of a strike the STIFFEST matter keeps. Rings are a
   *  surface wave, so even chrome carries them — mercury, not stone.
   *  Ink stays flat through the matter gate, not through this. */
  floor: 0.3,
} as const

/** Which slot a new strike takes: the deadest — smallest birth time.
 *  Pure, so the drumming budget below can be proven on it. */
export function strikeSlot(births: readonly number[]): number {
  let idx = 0
  for (let i = 1; i < births.length; i++) if (births[i] < births[idx]) idx = i
  return idx
}

/** The travel deformation: screen speed (CSS px/s) → squash-and-
 *  stretch amount. Soft-saturating, so a hop reads as mass and a
 *  throw cannot tear the glyph: the curve climbs past ref at half its
 *  ceiling and only approaches max. */
export const STRETCH = { ref: 480, max: 0.35 } as const
export function stretchAmount(speed: number): number {
  return (STRETCH.max * speed) / (speed + STRETCH.ref)
}

// ── the matter spring ───────────────────────────────────────────────────

/** One integration step of the underdamped spring matter-mode letters
 *  ride toward each new pose. Damping sits below critical
 *  (2·√stiffness ≈ 19) on purpose: a letter should overshoot and
 *  settle — arrive like a thing with mass, not fade like a tween. */
export function springStep(
  x: number,
  v: number,
  target: number,
  dt: number,
  stiffness = 90,
  damping = 12,
): [number, number] {
  const nv = v + (-stiffness * (x - target) - damping * v) * dt
  return [x + nv * dt, nv]
}
