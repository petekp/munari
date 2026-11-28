// Shared presets, controlled lighting rigs, and styling constants for the
// Three.js vs `@petepetrash/munari/gpu` side-by-side finish parity probe.

import type { SurfaceFinish } from '@petepetrash/munari'
import { finishes, inks, type FinishPreset } from '../../registry/finishes/finishes'

export type ParityRigKind = 'softbox' | 'point'

export const OPAQUE_PRESETS: readonly FinishPreset[] = [
  'lacquer-crimson',
  'polymer-charcoal',
  'aluminum-blue',
  'velvet-midnight',
]

export const GLASS_PRESETS: readonly FinishPreset[] = [
  'glass-clear',
  'glass-cobalt',
  'glass-frosted',
]

export const PARITY_PRESETS: readonly FinishPreset[] = [...OPAQUE_PRESETS, ...GLASS_PRESETS]

export const PARITY_FINISHES: Readonly<Record<FinishPreset, SurfaceFinish>> = finishes
export const PARITY_INKS = inks

export const PARITY_VIEWPORT = {
  width: 1100,
  height: 760,
  dpr: 2,
} as const

export const PARITY_KEY_PARAMS = {
  x: 520,
  y: 240,
  z: 480,
  brightness: 1,
  softboxSize: [290, 80] as const,
} as const

export const PARITY_CSS = /* css */ `
html, body, #root {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #eef1f5;
  color: #161b26;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.parity-page {
  position: relative;
  width: 1100px;
  height: 760px;
  padding: 40px 44px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 36px;
}

.parity-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 28px;
  height: 150px;
}

.parity-glass-row {
  position: relative;
  width: 924px;
  height: 150px;
  display: flex;
  align-items: center;
  gap: 28px;
}

.parity-backdrop-slot {
  position: absolute;
  left: 16px;
  top: 22px;
  width: 716px;
  height: 106px;
}

.parity-backdrop {
  width: 716px;
  height: 106px;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  align-items: stretch;
  background: #1e293b;
  color: #ffffff;
  font-size: 15px;
  font-weight: 700;
}

.parity-stripe {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  letter-spacing: 0.04em;
}

.parity-slot {
  position: relative;
  width: 210px;
  height: 150px;
  flex: none;
}

.parity-card {
  width: 210px;
  height: 150px;
  padding: 16px 18px;
  box-sizing: border-box;
  border-radius: 16px;
  background: var(--munari-body, transparent);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.parity-title {
  font-size: 16px;
  font-weight: 700;
  line-height: 1.2;
}

.parity-sub {
  font-size: 12px;
  line-height: 1.35;
}

.parity-footer {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.ui-root {
  background: transparent;
}
`

export function cardMarkupCopy(preset: FinishPreset) {
  return {
    label: preset,
    title: preset
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
    detail: 'Controlled parity card',
  }
}
