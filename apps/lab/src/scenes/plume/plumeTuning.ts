// Plume tuning — the local perceptual budget for ink becoming air.
//
// The law: a word stays readable long enough to finish, then spends longer
// leaving than it spent arriving. The 1.5s hold is longer than an ordinary
// inter-word pause, while the 7.2s plume keeps several recent words in
// the same weather without turning the page into a permanent particle loop.
//
// The fault this avoids, 2026-08-30: starting a clock at the first letter
// made a five-letter word begin disappearing before its last letter arrived.
// Ownership: this file owns the editable scene values and input limits.
// Timing state and pixels live in plumeLaw.ts and plumeShaders.ts.

export interface PlumeEffects {
  wisps: boolean
  afterglow: boolean
  embers: boolean
  draft: boolean
}

export type PlumeFontFamily = 'serif' | 'sans' | 'mono'

export type PlumeReleaseUnitSetting = 'word' | 'character'

export interface PlumeTuning {
  fontFamily: PlumeFontFamily
  typeScale: number
  fontWeight: number
  lineHeight: number
  letterSpacing: number
  textWidth: number
  releaseUnit: PlumeReleaseUnitSetting
  holdMs: number
  durationMs: number
  staggerMs: number
  reducedDurationMs: number
  pitch: number
  particleSize: number
  sizeVariation: number
  particleGrowth: number
  particleOpacity: number
  particleSoftness: number
  lifetimeVariation: number
  rise: number
  spread: number
  depth: number
  turbulence: number
  billow: number
  shading: number
  depthFog: number
  turbulenceSpeed: number
  draftStrength: number
  draftDamping: number
  inkColor: string
  backgroundColor: string
  particleColor: string
  sparkColor: string
  tint: number
  sparkAmount: number
  ghostOpacity: number
  ghostBlur: number
}

// The first open and Reset all share one frozen preset. Editing a field
// cannot quietly replace the baseline that the browser probe compares.
// The values are the 2026-08-31 hand-tuned pass: bold sans released per
// character, a 2px powder of faint-grown grains rather than 9px puffs.
export const plumeTuning: Readonly<PlumeTuning> = Object.freeze({
  fontFamily: 'sans',
  typeScale: 1,
  fontWeight: 900,
  lineHeight: 1.16,
  letterSpacing: -0.035,
  textWidth: 1000,
  /** Word keeps one clock per word; character gives every letter its own. */
  releaseUnit: 'character',
  /** Quiet time after the latest edit before a unit gives up its page hold. */
  holdMs: 1500,
  /** Full trip from intact ink to no visible particle. */
  durationMs: 7200,
  /** One word does not release as a straight horizontal shutter. */
  staggerMs: 1520,
  /** Reduced motion keeps the dissolve but removes spatial travel. */
  reducedDurationMs: 620,
  /** Grid pitch in CSS px. At 2px, a 760×420 sheet is about 80k grains. */
  pitch: 2,
  /** Diameter before growth. Under the 2px pitch each grain starts finer
   * than its cell; `particleGrowth` builds the late-flight mass. */
  particleSize: 1.25,
  sizeVariation: 0.32,
  particleGrowth: 2.6,
  particleOpacity: 0.71,
  particleSoftness: 0.55,
  lifetimeVariation: 0.72,
  /** Rise and sideways reach are CSS px because the scene camera is 1:1. */
  rise: 320,
  /** Spread separates the glyph grid into a visible cloud. */
  spread: 80,
  depth: 257,
  /** Flow-field strength. 1× puts a grain's turbulent travel near `spread`
   * over a full lifetime; 3× tears the mass — paired with the wide 0.5
   * billow so the shreds stay ribbon-sized instead of confetti. */
  turbulence: 3,
  /** Octave scale of the field. Larger numbers make smaller, faster eddies. */
  billow: 0.5,
  shading: 0.55,
  depthFog: 0.69,
  turbulenceSpeed: 1,
  draftStrength: 1,
  draftDamping: 5,
  /** Dusk palette, 2026-08-31: storm-aubergine ink on pale wisteria, so
   * the retained glyph colour reads as evening cloud; the ember spark
   * stays warm against it. */
  inkColor: '#33254a',
  backgroundColor: '#e5ddea',
  particleColor: '#6e5c8e',
  sparkColor: '#ef694b',
  /** Zero keeps each grain's captured glyph colour; 100% replaces it. */
  tint: 0,
  sparkAmount: 0,
  ghostOpacity: 0.06,
  ghostBlur: 5,
})

export const defaultPlumeEffects: Readonly<PlumeEffects> = Object.freeze({
  wisps: true,
  afterglow: true,
  embers: true,
  draft: true,
})

export type PlumeNumberKey = {
  [Key in keyof PlumeTuning]: PlumeTuning[Key] extends number ? Key : never
}[keyof PlumeTuning]

export type PlumeColorKey = 'inkColor' | 'backgroundColor' | 'particleColor' | 'sparkColor'

export interface PlumeControl {
  readonly key: PlumeNumberKey
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
  readonly unit?: string
  readonly displayScale?: number
}

export interface PlumeColorControl {
  readonly key: PlumeColorKey
  readonly label: string
}

export interface PlumeControlGroup {
  readonly key: 'type' | 'timing' | 'particles' | 'motion' | 'color'
  readonly title: string
  readonly description: string
  readonly controls: readonly PlumeControl[]
  readonly colors?: readonly PlumeColorControl[]
}

// Normalize stored units, not a rounded display string. Percentage fields
// convert back to fractions first; milliseconds stay milliseconds in JSON.
export function normalizePlumeInput(control: PlumeControl, value: number): number | null {
  if (!Number.isFinite(value)) return null
  const bounded = Math.min(control.max, Math.max(control.min, value))
  const steps = Math.round((bounded - control.min) / control.step)
  const decimals = control.step.toString().split('.')[1]?.length ?? 0
  const snapped = Number((control.min + steps * control.step).toFixed(decimals))
  return Math.min(control.max, Math.max(control.min, snapped))
}

export const PLUME_GROUPS: readonly PlumeControlGroup[] = [
  {
    key: 'type',
    title: 'Type',
    description: 'Type changes replay the text so the new letter shapes can release.',
    controls: [
      { key: 'typeScale', label: 'Type size', min: 0.5, max: 2.5, step: 0.05, unit: '×' },
      { key: 'fontWeight', label: 'Weight', min: 400, max: 900, step: 10 },
      { key: 'lineHeight', label: 'Line height', min: 0.9, max: 2, step: 0.02, unit: '×' },
      { key: 'letterSpacing', label: 'Letter spacing', min: -0.08, max: 0.12, step: 0.005, unit: 'em' },
      { key: 'textWidth', label: 'Text width', min: 240, max: 1400, step: 20, unit: 'px' },
    ],
  },
  {
    key: 'timing',
    title: 'Timing',
    description: 'Timing changes replay the text without changing its words.',
    controls: [
      { key: 'holdMs', label: 'Hold before release', min: 100, max: 8000, step: 100, unit: 'ms' },
      { key: 'durationMs', label: 'Particle lifetime', min: 600, max: 16000, step: 100, unit: 'ms' },
      { key: 'staggerMs', label: 'Release stagger', min: 0, max: 1800, step: 20, unit: 'ms' },
      { key: 'reducedDurationMs', label: 'Reduced-motion fade', min: 150, max: 1600, step: 10, unit: 'ms' },
    ],
  },
  {
    key: 'particles',
    title: 'Particles',
    description: 'Wider spacing makes fewer particles. Spacing changes replay the text.',
    controls: [
      { key: 'pitch', label: 'Particle spacing', min: 2, max: 8, step: 0.25, unit: 'px' },
      { key: 'particleSize', label: 'Puff size', min: 0.5, max: 16, step: 0.25, unit: 'px' },
      { key: 'sizeVariation', label: 'Size variation', min: 0, max: 0.9, step: 0.01, unit: '%', displayScale: 100 },
      { key: 'particleGrowth', label: 'Growth', min: 0.5, max: 4, step: 0.05, unit: '×' },
      { key: 'particleOpacity', label: 'Opacity', min: 0, max: 1, step: 0.01, unit: '%', displayScale: 100 },
      { key: 'particleSoftness', label: 'Softness', min: 0.02, max: 1, step: 0.01, unit: '%', displayScale: 100 },
      { key: 'lifetimeVariation', label: 'Lifetime variation', min: 0, max: 0.8, step: 0.02, unit: '%', displayScale: 100 },
    ],
  },
  {
    key: 'motion',
    title: 'Motion',
    description: 'Change the air in flight. Reduced motion keeps the ink still.',
    controls: [
      { key: 'rise', label: 'Rise', min: 0, max: 600, step: 1, unit: 'px' },
      { key: 'spread', label: 'Spread', min: 0, max: 300, step: 1, unit: 'px' },
      { key: 'depth', label: 'Depth', min: 0, max: 300, step: 1, unit: 'px' },
      { key: 'turbulence', label: 'Turbulence', min: 0, max: 6, step: 0.05, unit: '×' },
      { key: 'billow', label: 'Billow', min: 0.2, max: 3, step: 0.05, unit: '×' },
      { key: 'shading', label: 'Shading', min: 0, max: 1, step: 0.01, unit: '%', displayScale: 100 },
      { key: 'depthFog', label: 'Depth fog', min: 0, max: 1, step: 0.01, unit: '%', displayScale: 100 },
      { key: 'turbulenceSpeed', label: 'Air speed', min: 0.1, max: 4, step: 0.05, unit: '×' },
      { key: 'draftStrength', label: 'Pointer strength', min: 0, max: 4, step: 0.05, unit: '×' },
      { key: 'draftDamping', label: 'Pointer response', min: 0.5, max: 20, step: 0.5, unit: '/s' },
    ],
  },
  {
    key: 'color',
    title: 'Color & ghost',
    description: 'Particles keep the ink colour they were captured from until Tint moves them.',
    colors: [
      { key: 'inkColor', label: 'Ink' },
      { key: 'backgroundColor', label: 'Background' },
      { key: 'particleColor', label: 'Particles' },
      { key: 'sparkColor', label: 'Sparks' },
    ],
    controls: [
      { key: 'tint', label: 'Tint', min: 0, max: 1, step: 0.01, unit: '%', displayScale: 100 },
      { key: 'sparkAmount', label: 'Spark amount', min: 0, max: 0.5, step: 0.005, unit: '%', displayScale: 100 },
      { key: 'ghostOpacity', label: 'Ghost opacity', min: 0, max: 0.5, step: 0.01, unit: '%', displayScale: 100 },
      { key: 'ghostBlur', label: 'Ghost blur', min: 0, max: 8, step: 0.1, unit: 'px' },
    ],
  },
]
