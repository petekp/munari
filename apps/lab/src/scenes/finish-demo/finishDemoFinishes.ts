// Finish catalog for the finish demo — the finishes the page offers, the
// page ink that reads on each body, and the knobs that belong to each.
//
// The law: every list here is derived from the material-finishes scene's
// FINISH_ORDER and families and the preset table, so a preset added there
// appears on this page, in its family, with its ink and knobs, and no edit
// here.
//
// Ownership: the preset table (material-finishes/recipe/finishes.ts) owns
// the finish values. This module only describes them.

import type { CSSProperties } from 'react'
import type { FinishValues, SurfaceFinish } from '@petepetrash/munari'
import { FINISH_ORDER, type FinishId } from '../material-finishes/materialFinishesTuning'
import { familyOfFinish } from '../material-finishes/materialFinishesFamilies'
import { finishes } from '../material-finishes/recipe/finishes'
import { contrastRatio } from '../style/styleContrastLaw'

export interface DemoFinish {
  readonly id: FinishId
  readonly label: string
  readonly finish: Readonly<SurfaceFinish>
}

export const DEMO_FINISHES: readonly DemoFinish[] = FINISH_ORDER.map((item) => ({
  id: item.id,
  label: item.label,
  finish: finishes[item.id],
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

/** A preset's body color; every preset paints its body. */
export function bodyOf(finish: Readonly<SurfaceFinish>): string {
  if (!finish.color) throw new Error('A bench finish needs a body color')
  return finish.color
}

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

type InkStyle = CSSProperties & { readonly '--mf-on-ink': string; readonly '--mf-ink': string; readonly '--mf-quiet': string }

/** The page ink a card's content reads in, for its style prop: the ink that reads on the body, and the body color for text on a solid ink fill. */
export function inkStyle(body: string): InkStyle {
  const { ink, quiet } = inkFor(body)
  return { '--mf-on-ink': body, '--mf-ink': ink, '--mf-quiet': quiet }
}

// ── knobs ──────────────────────────────────────────────────────────────

type BaseNumber = 'roughness' | 'metalness'
type Layer = 'coat' | 'sheen' | 'anisotropy' | 'detail' | 'crackle' | 'edge'

/** Where a knob's value sits in a finish: a field of its own, or a field of one of its layers. */
export type KnobPath = readonly [BaseNumber | 'color'] | readonly [Layer, string]

export interface NumberKnob {
  readonly kind: 'number'
  readonly path: KnobPath
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
}

export interface ColorKnob {
  readonly kind: 'color'
  readonly path: KnobPath
  readonly label: string
}

export type FinishKnob = NumberKnob | ColorKnob

// The ranges are the material-finishes tuning panel's, which span three's
// valid range for each property.
export const BASE_KNOBS: readonly FinishKnob[] = [
  { kind: 'color', path: ['color'], label: 'Body color' },
  { kind: 'number', path: ['roughness'], label: 'Roughness', min: 0, max: 1, step: 0.01 },
]

/**
 * The knobs that make a finish its material: the layers it carries. A
 * layer the finish lacks has no knob, because adding it would turn the
 * finish into a different material.
 */
export function ownKnobs(finish: Readonly<SurfaceFinish>): readonly FinishKnob[] {
  const knobs: FinishKnob[] = []
  if ((finish.metalness ?? 0) > 0) knobs.push({ kind: 'number', path: ['metalness'], label: 'Metalness', min: 0, max: 1, step: 0.01 })
  if (finish.coat) {
    knobs.push({ kind: 'number', path: ['coat', 'amount'], label: 'Coat', min: 0, max: 1, step: 0.01 })
    knobs.push({ kind: 'number', path: ['coat', 'roughness'], label: 'Coat roughness', min: 0, max: 1, step: 0.01 })
  }
  if (finish.sheen) {
    knobs.push({ kind: 'color', path: ['sheen', 'color'], label: 'Sheen color' })
    knobs.push({ kind: 'number', path: ['sheen', 'roughness'], label: 'Sheen roughness', min: 0, max: 1, step: 0.01 })
  }
  if (finish.anisotropy) {
    knobs.push({ kind: 'number', path: ['anisotropy', 'amount'], label: 'Brushing', min: 0, max: 1, step: 0.01 })
    knobs.push({ kind: 'number', path: ['anisotropy', 'rotation'], label: 'Brushing angle (rad)', min: 0, max: Math.PI, step: 0.01 })
  }
  if (finish.detail) {
    knobs.push({ kind: 'number', path: ['detail', 'scale'], label: 'Relief size (CSS px)', min: 0.5, max: 160, step: 0.5 })
    knobs.push({ kind: 'number', path: ['detail', 'depth'], label: 'Relief slope', min: 0, max: 2, step: 0.005 })
  }
  if (finish.crackle) {
    knobs.push({ kind: 'number', path: ['crackle', 'amount'], label: 'Crackle', min: 0, max: 1, step: 0.01 })
    knobs.push({ kind: 'number', path: ['crackle', 'scale'], label: 'Crackle size (CSS px)', min: 4, max: 120, step: 1 })
  }
  knobs.push({ kind: 'number', path: ['edge', 'width'], label: 'Edge width (CSS px)', min: 0, max: 120, step: 0.5 })
  return knobs
}

/** A knob's value in a finish; a field the finish leaves out reads as the library's neutral value. */
export function knobValue(finish: Readonly<SurfaceFinish>, path: KnobPath): number | string {
  if (path.length === 1) {
    const [field] = path
    return finish[field] ?? NEUTRAL[field] ?? ''
  }
  const [field, key] = path
  const layer: Readonly<Record<string, number | string | null>> | null | undefined = finish[field]
  const value = layer?.[key]
  if (value === undefined || value === null) throw new Error(`The finish has no ${path.join('.')}`)
  return String(value) === value ? value : Number(value)
}

/** A copy of a finish with one knob's value changed. */
export function withKnob(finish: Readonly<SurfaceFinish>, path: KnobPath, value: number | string): SurfaceFinish {
  if (path.length === 1) return { ...finish, [path[0]]: value }
  const [field, key] = path
  return { ...finish, [field]: { ...finish[field], [key]: value } }
}

const NEUTRAL: Pick<FinishValues, BaseNumber | 'color'> = { roughness: 0.55, metalness: 0, color: null }
