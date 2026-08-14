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
 *  substances only the canvas can render (logoShaders): the conductor
 *  deals them exactly like faces and colors, so in matter mode a beat
 *  transmutes a letter, not just redecorates it. */
export const LOGO_MATTERS = ['ink', 'balloon', 'foil', 'gummy', 'neon'] as const

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
  /** 0..1 — matter mode: gel-wave amplitude, scaled per matter (gummy
   *  full, foil a crinkle, neon rigid). */
  jelly: number
  /** 0..1 — matter mode: chromatic fringe on a moving letter. */
  prism: number
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
  jelly: 0.55,
  prism: 0.5,
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
