// Polymer prototype tuning — live mutable parameters for soft polymer containers.
//
// Prototype state lives in memory (prototype skill) and mutates in place so
// dragging sliders or the global light updates TSL uniforms at 60 fps without
// re-rendering the React component tree (GlassTweaks pattern).

export type PolymerVariantId = 'A' | 'B' | 'C'

export type PolymerPresetId = 'delrin-white' | 'warm-abs' | 'frosted-silicone' | 'mineral-putty'

export interface PolymerTuning {
  // Global light in viewport CSS coordinates (fractions 0..1 of viewport W/H + px height)
  lightU: number
  lightV: number
  lightHeight: number
  lightRadius: number
  // Polymer geometry & bevel
  elevation: number
  bevelWidth: number
  cornerRadius: number
  pillow: number
  // Polymer optical finish
  baseHex: string
  bodyOpacity: number
  subsurfaceWrap: number
  warmth: number
  sheen: number
  roughness: number
  grain: number
  seamInk: number
  // Shadow tuning
  shadowOpacity: number
  contactOpacity: number
  // Performance / mobile controls
  maxDpr: number
}

export interface PolymerPreset {
  readonly id: PolymerPresetId
  readonly label: string
  readonly values: Partial<PolymerTuning>
}

export const POLYMER_PRESETS: readonly PolymerPreset[] = [
  {
    id: 'delrin-white',
    label: 'Delrin white',
    values: {
      baseHex: '#f9f9f7',
      bodyOpacity: 1,
      bevelWidth: 8.5,
      pillow: 0.18,
      subsurfaceWrap: 0.44,
      warmth: 0.24,
      sheen: 0.36,
      roughness: 0.38,
      grain: 0.012,
      seamInk: 0.2,
      shadowOpacity: 0.13,
      contactOpacity: 0.13,
    },
  },
  {
    id: 'warm-abs',
    label: 'Warm Braun ABS',
    values: {
      baseHex: '#f5f2eb',
      bodyOpacity: 1,
      bevelWidth: 9,
      pillow: 0.22,
      subsurfaceWrap: 0.54,
      warmth: 0.36,
      sheen: 0.28,
      roughness: 0.38,
      grain: 0.016,
      seamInk: 0.18,
      shadowOpacity: 0.16,
      contactOpacity: 0.19,
    },
  },
  {
    id: 'frosted-silicone',
    label: 'Frosted silicone',
    values: {
      baseHex: '#f8fafc',
      bodyOpacity: 0.82,
      bevelWidth: 10,
      pillow: 0.26,
      subsurfaceWrap: 0.68,
      warmth: 0.14,
      sheen: 0.32,
      roughness: 0.34,
      grain: 0.01,
      seamInk: 0.22,
      shadowOpacity: 0.12,
      contactOpacity: 0.12,
    },
  },
  {
    id: 'mineral-putty',
    label: 'Mineral putty',
    values: {
      baseHex: '#eceae4',
      bodyOpacity: 1,
      bevelWidth: 6.5,
      pillow: 0.12,
      subsurfaceWrap: 0.4,
      warmth: 0.28,
      sheen: 0.16,
      roughness: 0.56,
      grain: 0.022,
      seamInk: 0.24,
      shadowOpacity: 0.17,
      contactOpacity: 0.2,
    },
  },
]

export const polymerTuning: PolymerTuning = {
  lightU: 0.18,
  lightV: 0.032,
  lightHeight: 540,
  lightRadius: 34,
  elevation: 11,
  bevelWidth: 8.5,
  cornerRadius: 18,
  pillow: 0.18,
  baseHex: '#f9f9f7',
  bodyOpacity: 1,
  subsurfaceWrap: 0.44,
  warmth: 0.24,
  sheen: 0.36,
  roughness: 0.38,
  grain: 0.012,
  seamInk: 0.2,
  shadowOpacity: 0.13,
  contactOpacity: 0.13,
  maxDpr: 2,
}

type Listener = () => void
const listeners = new Set<Listener>()

export function subscribePolymerTuning(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function notifyPolymerTuning(): void {
  for (const fn of listeners) fn()
}

export function applyPolymerPreset(id: PolymerPresetId): void {
  const preset = POLYMER_PRESETS.find((item) => item.id === id)
  if (!preset) return
  Object.assign(polymerTuning, preset.values)
  notifyPolymerTuning()
}

export interface PolymerTelemetry {
  rendersTotal: number
  rendersLastSecond: number
  lastFrameMs: number
  activeSurfaces: number
  dpr: number
}

export const polymerTelemetry: PolymerTelemetry = {
  rendersTotal: 0,
  rendersLastSecond: 0,
  lastFrameMs: 0,
  activeSurfaces: 0,
  dpr: 1,
}
