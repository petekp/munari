// Finish catalog for the finish demo — the finishes the page offers, the
// page ink that reads on each body, and the knobs that belong to each.
//
// The law: every list here is derived from the material-finishes scene's
// FINISH_ORDER, FINISH_FAMILIES, FINISHES and FINISH_STUDIOS, so a finish
// added there appears on this page, in its family, with its ink and knobs,
// and no edit here.
//
// Ownership: the material-finishes scene owns the finish values and the
// studio. This module only describes them.

import type { CSSProperties } from 'react'
import {
  FINISH_ORDER,
  FINISH_STUDIOS,
  FINISHES,
  type Finish,
  type FinishId,
  type FinishStudio,
} from '../material-finishes/materialFinishesTuning'
import { familyOfFinish } from '../material-finishes/materialFinishesPresets'
import { contrastRatio } from '../style/styleContrastLaw'

export interface DemoFinish {
  readonly id: FinishId
  readonly label: string
  readonly finish: Readonly<Finish>
  readonly studio: FinishStudio
}

export const DEMO_FINISHES: readonly DemoFinish[] = FINISH_ORDER.map((item) => ({
  id: item.id,
  label: item.label,
  finish: FINISHES[item.id],
  studio: FINISH_STUDIOS[item.id],
}))

/** Finishes under one heading in the picker: a material family, or the finishes that belong to none. */
export interface DemoFinishGroup {
  readonly label: string
  readonly finishes: readonly DemoFinish[]
}

const UNGROUPED_LABEL = 'Settled finishes'

/** DEMO_FINISHES grouped by material family, in FINISH_ORDER's order of first appearance. */
export const DEMO_FINISH_GROUPS: readonly DemoFinishGroup[] = (() => {
  const groups = new Map<string, DemoFinish[]>()
  for (const item of DEMO_FINISHES) {
    const label = familyOfFinish(item.id)?.label ?? UNGROUPED_LABEL
    const group = groups.get(label)
    if (group) group.push(item)
    else groups.set(label, [item])
  }
  return [...groups].map(([label, finishes]) => ({ label, finishes }))
})()


// ── ink ────────────────────────────────────────────────────────────────

type Rgb = readonly [number, number, number]

function rgbOf(hex: string): Rgb {
  const channel = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16)
  return [channel(1), channel(3), channel(5)]
}

function hexOf(rgb: readonly number[]): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
}

const DARK_INK = '#15181c'
const LIGHT_INK = '#f5f2ee'
// WCAG 2.2 success criterion 1.4.6 (enhanced): 7:1 on the body color. The
// body renders lighter or darker than its color under the studio, and the
// headroom keeps the 4.5:1 of criterion 1.4.3, which the cards' 12 px text
// needs, on the rendered body (measured 2026-11-26 at the bench's default
// light: velvet's sheen lifts the body behind its fine print from luminance
// 0.012 to 0.026–0.053, and lacquer's coat lifts it from 0.06 to about 0.11).
const QUIET_CONTRAST = 7

export interface PageInk {
  readonly ink: string
  /**
   * Ink for labels and fine print: the ink mixed toward the body as far as
   * keeps QUIET_CONTRAST on the body color, or the full ink on a body where
   * even the full ink falls short of it.
   */
  readonly quiet: string
}

/** Ink that reads on a body color: whichever of the dark and light inks has more contrast on it. */
export function inkFor(body: string): PageInk {
  const ink = contrastRatio(DARK_INK, body) >= contrastRatio(LIGHT_INK, body) ? DARK_INK : LIGHT_INK
  const [inkRgb, surface] = [rgbOf(ink), rgbOf(body)]
  let quiet = ink
  for (let percent = 50; percent < 100; percent += 2) {
    const share = percent / 100
    const mixed = hexOf([0, 1, 2].map((index) => inkRgb[index] * share + surface[index] * (1 - share)))
    if (contrastRatio(mixed, body) >= QUIET_CONTRAST) {
      quiet = mixed
      break
    }
  }
  return { ink, quiet }
}

type InkStyle = CSSProperties & { readonly '--mf-body': string; readonly '--mf-ink': string; readonly '--mf-quiet': string }

/** The page ink a FinishCard's content reads in, for its style prop: the body color and the ink that reads on it. */
export function inkStyle(body: string): InkStyle {
  const { ink, quiet } = inkFor(body)
  return { '--mf-body': body, '--mf-ink': ink, '--mf-quiet': quiet }
}

// ── knobs ──────────────────────────────────────────────────────────────

export type FinishNumberKey = Exclude<keyof Finish, 'color' | 'sheenColor' | 'rimColor' | 'detail'>
export type FinishColorKey = 'color' | 'sheenColor'

export interface NumberKnob {
  readonly kind: 'number'
  readonly key: FinishNumberKey
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
}

export interface ColorKnob {
  readonly kind: 'color'
  readonly key: FinishColorKey
  readonly label: string
}

export type FinishKnob = NumberKnob | ColorKnob

// The ranges are the material-finishes tuning panel's, which span three's
// valid range for each property.
export const BASE_KNOBS: readonly FinishKnob[] = [
  { kind: 'color', key: 'color', label: 'Body color' },
  { kind: 'number', key: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.01 },
]

/**
 * The knobs that make a finish its material: the lobes and relief its
 * values turn on. A lobe at zero in the finish has no knob, because raising
 * it would turn the finish into a different material.
 */
export function ownKnobs(finish: Readonly<Finish>): readonly FinishKnob[] {
  const knobs: FinishKnob[] = []
  if (finish.metalness > 0) knobs.push({ kind: 'number', key: 'metalness', label: 'Metalness', min: 0, max: 1, step: 0.01 })
  if (finish.clearcoat > 0) {
    knobs.push({ kind: 'number', key: 'clearcoat', label: 'Coat', min: 0, max: 1, step: 0.01 })
    knobs.push({ kind: 'number', key: 'clearcoatRoughness', label: 'Coat roughness', min: 0, max: 1, step: 0.01 })
  }
  if (finish.sheen > 0) {
    knobs.push({ kind: 'color', key: 'sheenColor', label: 'Sheen color' })
    knobs.push({ kind: 'number', key: 'sheenRoughness', label: 'Sheen roughness', min: 0, max: 1, step: 0.01 })
  }
  if (finish.anisotropy > 0) {
    knobs.push({ kind: 'number', key: 'anisotropy', label: 'Brushing', min: 0, max: 1, step: 0.01 })
    knobs.push({ kind: 'number', key: 'anisotropyRotation', label: 'Brushing angle (rad)', min: 0, max: Math.PI, step: 0.01 })
  }
  if (finish.detail !== 'none') {
    knobs.push({ kind: 'number', key: 'detailScale', label: 'Relief size (CSS px)', min: 0.5, max: 160, step: 0.5 })
    knobs.push({ kind: 'number', key: 'detailDepth', label: 'Relief slope', min: 0, max: 2, step: 0.005 })
  }
  if (finish.crackle > 0) {
    knobs.push({ kind: 'number', key: 'crackle', label: 'Crackle', min: 0, max: 1, step: 0.01 })
    knobs.push({ kind: 'number', key: 'crackleScale', label: 'Crackle size (CSS px)', min: 4, max: 120, step: 1 })
  }
  knobs.push({ kind: 'number', key: 'edgeWidth', label: 'Edge width (CSS px)', min: 0, max: 120, step: 0.5 })
  return knobs
}
