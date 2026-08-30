// Plume tuning — the local perceptual budget for ink becoming air.
//
// The law: a word stays readable long enough to finish, then spends longer
// leaving than it spent arriving. The 1.5s hold is longer than an ordinary
// inter-word pause, while the 7.2s plume keeps several recent words in
// the same weather without turning the page into a permanent particle loop.
//
// The fault this avoids, 2026-08-30: starting a clock at the first letter
// made a five-letter word begin disappearing before its last letter arrived.
// Ownership: this file owns scene taste only; timing state and pixels live in
// plumeLaw.ts and plumeShaders.ts.

export interface PlumeEffects {
  wisps: boolean
  afterglow: boolean
  embers: boolean
  draft: boolean
}

export const plumeTuning = {
  /** Quiet time after the latest edit before a word gives up its page hold. */
  holdMs: 1500,
  /** Full trip from intact ink to no visible particle. */
  durationMs: 7200,
  /** Reduced motion keeps the dissolve but removes spatial travel. */
  reducedDurationMs: 620,
  /** Grid pitch in CSS px. At 3px, a 760×420 sheet is about 35k grains. */
  pitch: 3,
  /** Rise and sideways reach are CSS px because the scene camera is 1:1. */
  rise: 188,
  // 82px breaks the original text rows into overlapping streams without
  // carrying a grain beyond the 84px left writing margin. The 58px pass
  // still read as parallel hatch marks in the 2026-08-30 browser film.
  curl: 82,
  depth: 32,
  /** One word does not release as a straight horizontal shutter. */
  staggerMs: 480,
} as const

export const defaultPlumeEffects: PlumeEffects = {
  wisps: true,
  afterglow: true,
  embers: true,
  draft: true,
}
