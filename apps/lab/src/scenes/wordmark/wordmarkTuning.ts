// Wordmark tuning — the dial-in bench for the official mark's behavior.
//
// The law: the shipped wordmark moves at WORDMARK_KNOBS
// (components/MunariLogo.tsx), and this bench edits a live copy of that
// bag, never the bag itself — a dialed-in value ships by being pasted
// into WORDMARK_KNOBS, so the mark every page shows cannot drift with a
// browser's localStorage. The fault this exists for, 2026-09-01: the
// wordmark's 16s tempo was chosen by argument ("furniture shouldn't
// re-deal every second"), not by eye; a number nobody watched on the
// real mark is a guess with units.
//
// Ownership: this file owns the exposed keys, ranges, and normalization.
// The panel shell is components/tweakPanel.tsx; the mark itself is
// components/MunariLogo.tsx; the deep matter/light knobs stay on the
// logo playground's panel — this bench tunes how the mark behaves, not
// how its substances are lit.

import { LOGO_DEFAULTS, type LogoKnobs } from '../logo/logoLaw'
import { WORDMARK_KNOBS } from '../../components/MunariLogo'

/** The LogoKnobs this bench exposes. Everything else rides LOGO_DEFAULTS. */
export type WordmarkKnobKey =
  | 'tempo'
  | 'swing'
  | 'wave'
  | 'tilt'
  | 'drift'
  | 'squish'
  | 'float'
  | 'depth'
  | 'dodge'
  | 'jelly'
  | 'prism'
  | 'gloss'

export interface WordmarkTuning extends Pick<LogoKnobs, WordmarkKnobKey> {
  /** px — the --wordmark-base the host page would set. */
  base: number
}

export const wordmarkTuning: Readonly<WordmarkTuning> = Object.freeze({
  base: 28,
  tempo: WORDMARK_KNOBS.tempo,
  swing: WORDMARK_KNOBS.swing,
  wave: WORDMARK_KNOBS.wave,
  tilt: WORDMARK_KNOBS.tilt,
  drift: WORDMARK_KNOBS.drift,
  squish: WORDMARK_KNOBS.squish,
  float: WORDMARK_KNOBS.float,
  depth: WORDMARK_KNOBS.depth,
  dodge: WORDMARK_KNOBS.dodge,
  jelly: WORDMARK_KNOBS.jelly,
  prism: WORDMARK_KNOBS.prism,
  gloss: WORDMARK_KNOBS.gloss,
})

/** The full knob bag the mark runs under a bench tuning. */
export function toLogoKnobs(tuning: WordmarkTuning): LogoKnobs {
  const { base: _base, ...knobs } = tuning
  return { ...LOGO_DEFAULTS, ...knobs }
}

export interface WordmarkControl {
  readonly key: keyof WordmarkTuning
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
  readonly unit?: string
}

export interface WordmarkControlGroup {
  readonly key: 'frame' | 'cadence' | 'pose' | 'matter'
  readonly title: string
  readonly description: string
  readonly controls: readonly WordmarkControl[]
}

export const WORDMARK_GROUPS: readonly WordmarkControlGroup[] = [
  {
    key: 'frame',
    title: 'Frame',
    description: 'How large the mark sits — the nav runs it at 28px.',
    controls: [{ key: 'base', label: 'Base size', min: 16, max: 96, step: 1, unit: 'px' }],
  },
  {
    key: 'cadence',
    title: 'Cadence',
    description: 'The conductor. Tempo is the mean gap between re-deals; swing spreads each gap; wave is the chance a beat sweeps the whole word.',
    controls: [
      { key: 'tempo', label: 'Tempo', min: 1000, max: 40000, step: 500, unit: 'ms' },
      { key: 'swing', label: 'Swing', min: 0, max: 1, step: 0.05 },
      { key: 'wave', label: 'Wave', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    key: 'pose',
    title: 'Pose',
    description: 'Ranges a re-dealt letter may land in, and the idle float. Pose edits show on the next re-deal, not the standing word.',
    controls: [
      { key: 'tilt', label: 'Tilt', min: 0, max: 30, step: 1, unit: '°' },
      { key: 'drift', label: 'Drift', min: 0, max: 0.3, step: 0.01, unit: 'em' },
      { key: 'squish', label: 'Squish', min: 0, max: 0.4, step: 0.01 },
      { key: 'float', label: 'Float', min: 0, max: 0.15, step: 0.005, unit: 'em' },
    ],
  },
  {
    key: 'matter',
    title: 'Matter',
    description: 'Only visible once the mark has lifted to WebGL.',
    controls: [
      { key: 'depth', label: 'Depth bob', min: 0, max: 160, step: 2, unit: 'px' },
      { key: 'dodge', label: 'Dodge', min: 0, max: 120, step: 2, unit: 'px' },
      { key: 'jelly', label: 'Jelly', min: 0, max: 1, step: 0.05 },
      { key: 'prism', label: 'Prism', min: 0, max: 1, step: 0.05 },
      // 0.9, not 1 — same cap as the playground panel: at exactly 1 the
      // page texel leaves the shader blend and letters come up black.
      { key: 'gloss', label: 'Gloss', min: 0, max: 0.9, step: 0.05 },
    ],
  },
]

// Restore clamps to bounds but never snaps to step — a stored value off
// the step grid must survive a reload exactly; step snapping belongs to
// the slider, which only emits on-grid values.
export function normalizeWordmarkTuning(raw: WordmarkTuning): WordmarkTuning {
  const next = { ...wordmarkTuning }
  for (const group of WORDMARK_GROUPS) {
    for (const control of group.controls) {
      const stored = raw[control.key]
      if (!Number.isFinite(stored)) continue
      next[control.key] = Math.min(control.max, Math.max(control.min, stored))
    }
  }
  return next
}
