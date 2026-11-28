// Finish recipe — each card's finish as the page holds it, the shared key
// light, and the code listing printed from the same values.
//
// The law: the page shows the code it runs. Each card's Surface props come
// from cardProps, and the listing prints those props, the card's finish and
// the key light's position, so a value on screen and a value in the listing
// cannot differ.
//
// The key either stays where it is dragged or follows the pointer. Each is
// its own createSurfaceLight handle, because `follow` is fixed when a handle
// is made; the canvas is lit by one of them.
//
// Ownership: the preset table (material-finishes/recipe/finishes.ts) owns
// the finish values and the library owns the material and lights. This
// module owns which finish each card wears and where the key stands.

import { createSurfaceLight, type LightPosition, type SurfaceCanvasProps, type SurfaceFinish } from '@petepetrash/munari/gpu'
import { finishes } from '../material-finishes/recipe/finishes'
import { LIGHT_RIGS, type CardTilt, type FinishId, type LightRig, type TextLighting } from '../material-finishes/materialFinishesTuning'
import type { ContextId } from './FinishDemoContexts'
import { BASE_KNOBS, knobValue, ownKnobs, type FinishKnob } from './finishDemoFinishes'

// ── state ──────────────────────────────────────────────────────────────

/** One card: the preset it started from and the finish it wears now. */
export interface BenchCard {
  readonly context: ContextId
  readonly preset: FinishId
  readonly finish: SurfaceFinish
}

/** The settings every card on the page shares. */
export interface PageSetup {
  readonly rig: LightRig
  readonly text: TextLighting
  readonly inScene: boolean
  /** The key follows the pointer instead of staying where it was dragged. */
  readonly followsPointer: boolean
  readonly tilt: CardTilt
}

export function createCard(context: ContextId, preset: FinishId): BenchCard {
  return { context, preset, finish: finishes[preset] }
}

// The material-finishes scene's softbox: wide and short, so a coat's
// highlight is a bar that fits between lines of text
// (materialFinishesTuning.ts STUDIO_START).
const SOFTBOX_SIZE: readonly [number, number] = [290, 80]

/** The key's size for a rig: the softbox's, or none for a point. */
export function keySize(rig: LightRig): readonly [number, number] | undefined {
  return rig === 'softbox' ? SOFTBOX_SIZE : undefined
}

/** The page's key light. Every card is lit by it, so dragging it moves the light over all of them at once. */
export const keyLight = createSurfaceLight({ size: SOFTBOX_SIZE })

/** The key while it follows the pointer. It rests, and stays under reduced motion, where keyLight stood. */
export const pointerLight = createSurfaceLight({ follow: 'pointer', size: SOFTBOX_SIZE })

/** Rest the pointer's key where the dragged key stands. */
export function restPointerLight(): void {
  const { x, y } = keyLight.get()
  pointerLight.set({ x: x ?? undefined, y: y ?? undefined })
}

/** Give both keys a rig's size. */
export function sizeKeys(rig: LightRig): void {
  keyLight.set({ size: keySize(rig) })
  pointerLight.set({ size: keySize(rig) })
}

// ── props ──────────────────────────────────────────────────────────────

/** The props this page gives SurfaceCanvas, apart from its id and children. */
export const CANVAS_PROPS = {
  pointerMode: 'surfaces',
  frameloop: 'demand',
  style: { position: 'fixed', inset: 0, zIndex: 10 },
  lighting: { key: keyLight },
} as const satisfies Partial<SurfaceCanvasProps>

/** The canvas's lighting while the key follows the pointer. */
export const POINTER_LIGHTING = { key: pointerLight } as const satisfies SurfaceCanvasProps['lighting']

/** The Surface props a card takes from its finish and the page. */
export interface CardProps {
  readonly inScene: boolean
  readonly finish: SurfaceFinish
  /** The content root's class: a page copy carries a shadow, which a capture would bake into the texture. */
  readonly className: string
}

export function cardProps(card: BenchCard, page: PageSetup): CardProps {
  const place = page.inScene ? 'mf-card--scene' : 'mf-card--page'
  return {
    inScene: page.inScene,
    finish: { ...card.finish, text: page.text },
    className: `mf-card ${place} fd-card fd-card--${card.context}`,
  }
}

// ── listing ────────────────────────────────────────────────────────────

export type CodeLine = string

const finishName = (card: BenchCard) => `${card.context}Finish`
const setterName = (card: BenchCard) => `set${card.context[0].toUpperCase()}${card.context.slice(1)}Finish`
const px = (value: number | null) => String(Math.round(value ?? 0))

/** The imports the listing's code needs. */
export function importLines(page: PageSetup): readonly CodeLine[] {
  const tilting = page.tilt === 'pointer'
  return [
    "import { useId, useState } from 'react'",
    "import { createSurfaceLight, Surface, SurfaceCanvas, supportsCapture, type SurfaceFinish } from '@petepetrash/munari/gpu'",
    "import { finishes } from './finishes'  // registry/finishes",
    ...(tilting ? ["import { createPointerTiltBehavior } from './behaviors/compose'  // registry/behaviors"] : []),
    "import { bodyOf, inkStyle } from '../finish-demo/finishDemoFinishes'",
    "import '../material-finishes/materialFinishes.css'",
  ]
}

function lightLines(page: PageSetup, key: LightPosition): readonly CodeLine[] {
  const size = keySize(page.rig)
  const sizeText = size ? `, size: [${size.join(', ')}]` : ''
  if (!page.followsPointer) return [`const keyLight = createSurfaceLight({ x: ${px(key.x)}, y: ${px(key.y)}${sizeText} })`]
  return [
    '// Follows the mouse and pen with no React render. x and y are where it rests:',
    '// off the page, and always under prefers-reduced-motion.',
    `const keyLight = createSurfaceLight({ follow: 'pointer', x: ${px(key.x)}, y: ${px(key.y)}${sizeText} })`,
  ]
}

/** The key light, the canvas, and each card's finish state. */
export function setupLines(cards: readonly BenchCard[], page: PageSetup, key: LightPosition): readonly CodeLine[] {
  return [
    ...lightLines(page, key),
    '',
    'const supported = supportsCapture()',
    'const canvasId = useId()',
    ...cards.map((card) => `const [${finishName(card)}, ${setterName(card)}] = useState<SurfaceFinish>(finishes['${card.preset}'])`),
    '',
    '{supported && (',
    '  <SurfaceCanvas',
    '    id={canvasId}',
    `    pointerMode="${CANVAS_PROPS.pointerMode}"`,
    `    frameloop="${CANVAS_PROPS.frameloop}"`,
    '    lighting={{ key: keyLight }}',
    `    style={{ position: '${CANVAS_PROPS.style.position}', inset: ${CANVAS_PROPS.style.inset}, zIndex: ${CANVAS_PROPS.style.zIndex} }}`,
    '  />',
    ')}',
  ]
}

/** One card's Surface, with the props cardProps gives it. */
export function cardLines(card: BenchCard, page: PageSetup, content: string): readonly CodeLine[] {
  const props = cardProps(card, page)
  const tiltProp = page.tilt === 'pointer' ? ' onFrame={tiltHandler}' : ''
  return [
    // The page shows its HTML copy by passing false, whatever the support.
    `<Surface canvasId={canvasId} inScene={${props.inScene ? 'supported' : 'false'}} finish={{ ...${finishName(card)}, text: '${page.text}' }}${tiltProp}>`,
    `  <div className="${props.className}" style={inkStyle(bodyOf(${finishName(card)}))}>`,
    `    <${content} />`,
    '  </div>',
    '</Surface>',
  ]
}

function decimalsOf(step: number): number {
  const [, fraction = ''] = String(step).split('.')
  return fraction.length
}

function printed(knob: FinishKnob, value: number | string): string {
  return knob.kind === 'color' ? `'${value}'` : Number(value).toFixed(decimalsOf(knob.kind === 'number' ? knob.step : 1))
}

/** The fields a card's finish has changed from its preset, as an object literal's entries. */
function changedEntries(card: BenchCard): readonly string[] {
  const tuned = finishes[card.preset]
  const fields = new Map<string, string[]>()
  for (const knob of [...BASE_KNOBS, ...ownKnobs(tuned)]) {
    const value = knobValue(card.finish, knob.path)
    if (value === knobValue(tuned, knob.path)) continue
    const [field, key] = knob.path
    const entries = fields.get(field) ?? []
    entries.push(key === undefined ? printed(knob, value) : `${key}: ${printed(knob, value)}`)
    fields.set(field, entries)
  }
  return [...fields].map(([field, entries]) => {
    const layered = ownKnobs(tuned).some((knob) => knob.path[0] === field && knob.path.length === 2)
    return layered ? `${field}: { ...preset.${field}, ${entries.join(', ')} }` : `${field}: ${entries.join(', ')}`
  })
}

/** The calls that bring a card from its preset to what is on screen, and the key light's position. */
export function adjustLines(card: BenchCard, page: PageSetup, key: LightPosition): readonly CodeLine[] {
  const entries = changedEntries(card)
  const lines: CodeLine[] = [`const preset = finishes['${card.preset}']`]
  lines.push(entries.length === 0 ? `${setterName(card)}(preset)` : `${setterName(card)}({ ...preset, ${entries.join(', ')} })`)
  lines.push(
    page.followsPointer
      ? '// keyLight follows the pointer: each move redraws every canvas it lights, with no React render'
      : `keyLight.set({ x: ${px(key.x)}, y: ${px(key.y)} })  // redraws every canvas it lights, with no React render`,
  )
  return lines
}

export const RIG_CHOICES = LIGHT_RIGS.map((item) => [item.id, item.label] as const)
