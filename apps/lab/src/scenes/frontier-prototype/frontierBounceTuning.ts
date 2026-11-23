// Light bounce tuning — every number the bounce material reads, as one flat bag
// of live uniforms shared by the three glass panes, plus the finish presets that
// seed it.
//
// A finish preset sets the surface character. The shared defaults were constants
// inside the material until the tweak panel exposed them (2026-11-22); they keep
// its output unchanged. One uniform set feeds all three materials, so a slider
// moves every pane at once without re-rendering the scene.

import { uniform } from 'three/tsl'

export type BounceFinishId = 'satin' | 'obsidian' | 'frost'

const FINISH_KEYS = [
  'scatterGain',
  'ambientGain',
  'blurNormalPx',
  'blurParallelPx',
  'parallelRatio',
  'roughnessScale',
  'baseMip',
  'falloffPx',
  'spanSigmaPx',
  'rimGain',
  'chromaBoost',
  'brushStrength',
] as const

const SHARED_KEYS = [
  'blackFloor',
  'chromaFloor',
  'chromaLow',
  'chromaHigh',
  'mipPerPx',
  'mipMin',
  'mipMax',
  'penetrateBasePx',
  'penetratePerPx',
  'distanceKneePx',
  'brushFrequency',
  'ambientMip',
  'ambientReachPx',
  'rimFacingPower',
  'rimReachPx',
  'toneShoulder',
  'verticalLift',
  'emitBoost',
] as const

type FinishKey = (typeof FINISH_KEYS)[number]
export type BounceTuningKey = FinishKey | (typeof SHARED_KEYS)[number]
export type BounceTuning = Readonly<Record<BounceTuningKey, number>>

export const BOUNCE_TUNING_KEYS: readonly BounceTuningKey[] = [...FINISH_KEYS, ...SHARED_KEYS]

export interface BounceFinish {
  readonly label: string
  readonly shortPill: string
  readonly values: Readonly<Record<FinishKey, number>>
}

export const BOUNCE_FINISHES = {
  satin: {
    label: 'Liquid satin',
    shortPill: 'Satin',
    values: {
      scatterGain: 1.04,
      ambientGain: 0.28,
      blurNormalPx: 44,
      blurParallelPx: 44,
      parallelRatio: 1.0,
      roughnessScale: 0.30,
      baseMip: 2.1,
      falloffPx: 146,
      spanSigmaPx: 44,
      rimGain: 0.94,
      chromaBoost: 1.38,
      brushStrength: 0,
    },
  },
  obsidian: {
    label: 'Brushed anodized',
    shortPill: 'Anodized',
    values: {
      scatterGain: 1.22,
      ambientGain: 0.16,
      blurNormalPx: 68,
      blurParallelPx: 12,
      parallelRatio: 0.20,
      roughnessScale: 0.22,
      baseMip: 1.35,
      falloffPx: 170,
      spanSigmaPx: 32,
      rimGain: 1.38,
      chromaBoost: 1.32,
      brushStrength: 0.06,
    },
  },
  frost: {
    label: 'Deep acrylic',
    shortPill: 'Frost',
    values: {
      scatterGain: 1.24,
      ambientGain: 0.44,
      blurNormalPx: 64,
      blurParallelPx: 64,
      parallelRatio: 1.0,
      roughnessScale: 0.44,
      baseMip: 2.65,
      falloffPx: 220,
      spanSigmaPx: 62,
      rimGain: 0.76,
      chromaBoost: 1.44,
      brushStrength: 0,
    },
  },
} as const satisfies Record<BounceFinishId, BounceFinish>

/** The toolbar's boost toggle multiplies all bounce light by this. */
export const BOOSTED_EMIT = 1.45

const SHARED_DEFAULTS = {
  blackFloor: 0.013,
  chromaFloor: 0.11,
  chromaLow: 0.03,
  chromaHigh: 0.24,
  mipPerPx: 0.011,
  mipMin: 1.0,
  mipMax: 4.2,
  penetrateBasePx: 30,
  penetratePerPx: 0.38,
  distanceKneePx: 180,
  brushFrequency: 1.25,
  ambientMip: 2.8,
  ambientReachPx: Math.sqrt(22000),
  rimFacingPower: 1.75,
  rimReachPx: 120,
  toneShoulder: 1.45,
  verticalLift: 0.07,
  emitBoost: 1,
} satisfies Record<(typeof SHARED_KEYS)[number], number>

export function bounceTuningFor(finish: BounceFinishId, boosted: boolean) {
  return {
    ...SHARED_DEFAULTS,
    ...BOUNCE_FINISHES[finish].values,
    emitBoost: boosted ? BOOSTED_EMIT : 1,
  } satisfies BounceTuning
}

const floatUniform = (value: number) => uniform(value)
export type FloatUniform = ReturnType<typeof floatUniform>
export type BounceTuningUniforms = Readonly<Record<BounceTuningKey, FloatUniform>>

export function createBounceTuningUniforms(tuning: BounceTuning): BounceTuningUniforms {
  // SAFETY: mapping BOUNCE_TUNING_KEYS, which lists every BounceTuningKey once,
  // yields exactly one uniform per key.
  return Object.fromEntries(
    BOUNCE_TUNING_KEYS.map((key) => [key, floatUniform(tuning[key])]),
  ) as BounceTuningUniforms
}

export function applyBounceTuning(uniforms: BounceTuningUniforms, tuning: BounceTuning): void {
  for (const key of BOUNCE_TUNING_KEYS) uniforms[key].value = tuning[key]
}

export function readBounceTuning(uniforms: BounceTuningUniforms): BounceTuning {
  // SAFETY: as in createBounceTuningUniforms, one entry per BounceTuningKey.
  return Object.fromEntries(
    BOUNCE_TUNING_KEYS.map((key) => [key, uniforms[key].value]),
  ) as BounceTuning
}

// ── panel knobs ─────────────────────────────────────────────────────────

export interface BounceKnob {
  readonly key: BounceTuningKey
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
}

export interface BounceKnobGroup {
  readonly title: string
  readonly knobs: readonly BounceKnob[]
}

export const BOUNCE_KNOB_GROUPS: readonly BounceKnobGroup[] = [
  {
    title: 'strength',
    knobs: [
      { key: 'emitBoost', label: 'overall light', min: 0, max: 3, step: 0.05 },
      { key: 'scatterGain', label: 'diffuse glow', min: 0, max: 3, step: 0.02 },
      { key: 'ambientGain', label: 'ambient fill', min: 0, max: 1.5, step: 0.02 },
      { key: 'rimGain', label: 'edge highlight', min: 0, max: 3, step: 0.02 },
      { key: 'toneShoulder', label: 'highlight compression', min: 0, max: 4, step: 0.05 },
    ],
  },
  {
    title: 'color',
    knobs: [
      { key: 'chromaBoost', label: 'saturation', min: 0, max: 3, step: 0.02 },
      { key: 'chromaFloor', label: 'gray light kept', min: 0, max: 1, step: 0.01 },
      { key: 'chromaLow', label: 'colorful from', min: 0, max: 0.5, step: 0.005 },
      { key: 'chromaHigh', label: 'fully colorful at', min: 0.01, max: 1, step: 0.005 },
      { key: 'blackFloor', label: 'black cutoff', min: 0, max: 0.2, step: 0.001 },
    ],
  },
  {
    title: 'blur',
    knobs: [
      { key: 'blurNormalPx', label: 'blur across seam px', min: 0, max: 200, step: 1 },
      { key: 'blurParallelPx', label: 'blur along seam px', min: 0, max: 200, step: 1 },
      { key: 'roughnessScale', label: 'blur growth with distance', min: 0, max: 1.5, step: 0.01 },
      { key: 'parallelRatio', label: 'growth along seam', min: 0, max: 2, step: 0.02 },
      { key: 'baseMip', label: 'sample softness', min: 0, max: 6, step: 0.05 },
      { key: 'mipPerPx', label: 'softness per px', min: 0, max: 0.05, step: 0.0005 },
      { key: 'mipMin', label: 'softness min', min: 0, max: 6, step: 0.05 },
      { key: 'mipMax', label: 'softness max', min: 0, max: 8, step: 0.05 },
    ],
  },
  {
    title: 'reach',
    knobs: [
      { key: 'falloffPx', label: 'falloff px', min: 40, max: 600, step: 2 },
      { key: 'distanceKneePx', label: 'falloff knee px', min: 20, max: 800, step: 5 },
      { key: 'spanSigmaPx', label: 'spill past emitter px', min: 16, max: 240, step: 1 },
      { key: 'penetrateBasePx', label: 'sample depth px', min: 0, max: 160, step: 1 },
      { key: 'penetratePerPx', label: 'sample depth per px', min: 0, max: 2, step: 0.01 },
      { key: 'ambientReachPx', label: 'ambient reach px', min: 20, max: 600, step: 2 },
      { key: 'ambientMip', label: 'ambient softness', min: 0, max: 8, step: 0.05 },
    ],
  },
  {
    title: 'edge and surface',
    knobs: [
      { key: 'rimFacingPower', label: 'edge facing focus', min: 0.25, max: 8, step: 0.05 },
      { key: 'rimReachPx', label: 'edge highlight reach px', min: 10, max: 600, step: 5 },
      { key: 'brushStrength', label: 'brushed streaks', min: 0, max: 0.4, step: 0.005 },
      { key: 'brushFrequency', label: 'streak frequency', min: 0.1, max: 4, step: 0.05 },
      { key: 'verticalLift', label: 'top-to-bottom shading', min: 0, max: 0.4, step: 0.005 },
    ],
  },
]
