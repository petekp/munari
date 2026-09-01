// Lamp tuning — the single owner of every number a reviewer would push on:
// the flame's shape and pace, the shadow's throw and darkness, the page's
// light pool, and the model's own scale and mounting height.
//
// The law: every field's default equals the constant that shipped before
// this panel existed (lampLantern.ts's flicker/flame numbers, lampShaders.ts's
// shadow/pool numbers) — moving a slider to its own default must render
// pixel-identical to round 5's shipped scene. lampLantern.ts and
// lampShaders.ts read these values through uniforms/params instead of
// duplicating the literals (round 6).
//
// Ownership: this file owns the editable values and their input limits.
// lampShaders.ts owns what the shadow/pool uniforms do with them;
// lampLantern.ts owns what the flame/model params do with them; Lamp.tsx
// owns holding the live value and handing it to both every frame.

export interface LampTuning {
  flameScale: number
  flickerRate: number
  flickerAmplitude: number
  coreBrightness: number
  penumbraGrowth: number
  maxBlurLevel: number
  opacityFalloff: number
  shadowStrength: number
  poolIntensity: number
  poolWarmth: number
  poolRadius: number
  pageFlicker: number
  lampHeight: number
  modelScale: number
}

// The first open and Reset all share one frozen preset, and every value
// below equals the constant it replaces so the panel's own default renders
// identically to the scene that shipped without it.
export const lampTuning: Readonly<LampTuning> = Object.freeze({
  /** 1x reproduces FLAME_QUAD_WIDTH/HEIGHT (22x34, lampLantern.ts) unscaled. */
  flameScale: 1,
  /** 1x reproduces the flicker clock's own pace (elapsedMs/1000, unscaled). */
  flickerRate: 1,
  /** Was FLICKER_INTENSITY_AMPLITUDE in lampLantern.ts. */
  flickerAmplitude: 0.1,
  /** 1x reproduces the flame shader's unscaled output brightness. */
  coreBrightness: 1,
  /** Was PENUMBRA_GROWTH_SCALE in lampShaders.ts — the dimensionless factor
   * on FLAME_APPARENT_SIZE / lampHeight that sets how fast the penumbra
   * widens with throw. */
  penumbraGrowth: 0.5,
  /** Was the reachable ceiling of levelForPenumbra's 0..3 range in
   * lampShaders.ts (MASK_BLUR_RADII has 4 channels, indices 0..3). */
  maxBlurLevel: 3,
  /** 1x reproduces FAR_FADE_START/FAR_FADE_END (lampShaders.ts) unscaled. */
  opacityFalloff: 1,
  /** Was SHADOW_FLOOR in lampShaders.ts — lower reads as a darker shadow. */
  shadowStrength: 0.55,
  /** 1x reproduces the pool's unscaled brightness curve. */
  poolIntensity: 1,
  /** 1x reproduces POOL_TINT/AMBIENT_TINT (lampShaders.ts) at full warmth;
   * lower lerps the pool toward neutral white. */
  poolWarmth: 1,
  /** 1x reproduces INNER_RADIUS/OUTER_RADIUS (lampShaders.ts) unscaled. */
  poolRadius: 1,
  /** Was PAGE_FLICKER_SCALE in Lamp.tsx — how much of the flame's own
   * brightness wobble reaches the page's light pool. */
  pageFlicker: 0.6,
  /** Was LANTERN_FLAME_HEIGHT in lampLantern.ts (CHAMBER_BASE_Y +
   * GLOBE_HEIGHT / 2) — also the shadow shader's light height, so moving
   * this slider keeps the rendered flame and its projected shadow agreeing
   * the same way the two constants used to (round 5's invariant, now kept
   * by both reading the same live value instead of by import). */
  lampHeight: 44,
  /** 1x reproduces the model's unscaled geometry. */
  modelScale: 1,
})

export type LampNumberKey = keyof LampTuning

export interface LampControl {
  readonly key: LampNumberKey
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
  readonly unit?: string
  readonly displayScale?: number
}

export interface LampControlGroup {
  readonly key: 'flame' | 'shadow' | 'pool' | 'lantern'
  readonly title: string
  readonly description: string
  readonly controls: readonly LampControl[]
}

// Normalize stored units, not a rounded display string — mirrors
// normalizePlumeInput (plumeTuning.ts) exactly, so both panels snap and
// clamp input the same way.
export function normalizeLampInput(control: LampControl, value: number): number | null {
  if (!Number.isFinite(value)) return null
  const bounded = Math.min(control.max, Math.max(control.min, value))
  const steps = Math.round((bounded - control.min) / control.step)
  const decimals = control.step.toString().split('.')[1]?.length ?? 0
  const snapped = Number((control.min + steps * control.step).toFixed(decimals))
  return Math.min(control.max, Math.max(control.min, snapped))
}

// Turns a stored bag — shaped like LampTuning but not necessarily valid at
// runtime (an older build, a hand-edited localStorage entry) — into a
// complete, in-range tuning object. Every field falls back to its shipped
// default independently; one bad field cannot invalidate the rest. Restore
// clamps to bounds but never snaps to step — a stored value off the step
// grid must survive a reload exactly (see normalizeMarbleHandTuning);
// step snapping belongs to typed input only (normalizeLampInput).
export function normalizeLampTuning(raw: LampTuning): LampTuning {
  const next = { ...lampTuning }
  for (const group of LAMP_GROUPS) {
    for (const control of group.controls) {
      const stored = raw[control.key]
      if (!Number.isFinite(stored)) continue
      next[control.key] = Math.min(control.max, Math.max(control.min, stored))
    }
  }
  return next
}

export const LAMP_GROUPS: readonly LampControlGroup[] = [
  {
    key: 'flame',
    title: 'Flame',
    description: 'The flame quad and the three-frequency flicker driving its sway and brightness.',
    controls: [
      { key: 'flameScale', label: 'Size', min: 0.5, max: 2, step: 0.05, unit: '×' },
      { key: 'flickerRate', label: 'Flicker rate', min: 0.25, max: 3, step: 0.05, unit: '×' },
      { key: 'flickerAmplitude', label: 'Flicker amplitude', min: 0, max: 0.4, step: 0.01, unit: '%', displayScale: 100 },
      { key: 'coreBrightness', label: 'Core brightness', min: 0.3, max: 2.5, step: 0.05, unit: '×' },
    ],
  },
  {
    key: 'shadow',
    title: 'Shadow',
    description: 'How far the headline’s shadow throws and how dark it reads. The blur pyramid itself stays fixed.',
    controls: [
      { key: 'penumbraGrowth', label: 'Penumbra growth', min: 0.1, max: 1.5, step: 0.05, unit: '×' },
      { key: 'maxBlurLevel', label: 'Max blur level', min: 0, max: 3, step: 0.1, unit: '' },
      { key: 'opacityFalloff', label: 'Opacity falloff', min: 0.3, max: 3, step: 0.05, unit: '×' },
      { key: 'shadowStrength', label: 'Shadow strength', min: 0.05, max: 0.95, step: 0.01, unit: '' },
    ],
  },
  {
    key: 'pool',
    title: 'Light pool',
    description: 'The page-wide glow the lamp casts, independent of the shadow it also draws.',
    controls: [
      { key: 'poolIntensity', label: 'Intensity', min: 0.3, max: 2, step: 0.05, unit: '×' },
      { key: 'poolWarmth', label: 'Warmth', min: 0, max: 1, step: 0.02, unit: '%', displayScale: 100 },
      { key: 'poolRadius', label: 'Radius', min: 0.4, max: 2.5, step: 0.05, unit: '×' },
      { key: 'pageFlicker', label: 'Page flicker amplitude', min: 0, max: 1, step: 0.02, unit: '%', displayScale: 100 },
    ],
  },
  {
    key: 'lantern',
    title: 'Lantern',
    description: 'The 3D model’s own mounting height and overall scale.',
    controls: [
      { key: 'lampHeight', label: 'Lamp height', min: 20, max: 80, step: 1, unit: 'px' },
      { key: 'modelScale', label: 'Model scale', min: 0.5, max: 2, step: 0.05, unit: '×' },
    ],
  },
]
