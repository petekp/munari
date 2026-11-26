// Finish recipe — each card's finish and studio as the page holds them, the
// calls that change them, and the code listing printed from the same objects.
//
// The law: the page shows the code it runs. Each card's FinishCard props come
// from cardProps, and the listing prints those props and the values held in
// the card's finish and studio objects, so a value on screen and a value in
// the listing cannot differ. The finish code is the lab's (material-finishes
// scene); the library has no finish API yet.
//
// Ownership: the material-finishes scene owns the finish values, the studio
// and FinishCard. This module owns which finish each card wears.

import type { SurfaceCanvasProps } from '@petepetrash/munari'
import {
  FINISH_STUDIOS,
  FINISHES,
  LIGHT_RIGS,
  notifyFinishTuning,
  studioFor,
  type EnvironmentKind,
  type Finish,
  type FinishId,
  type LightRig,
  type StudioTuning,
  type TextLighting,
} from '../material-finishes/materialFinishesTuning'
import { createStudioLights, type StudioLights } from '../material-finishes/materialFinishesStudio'
import type { ContextId } from './FinishDemoContexts'
import { BASE_KNOBS, ownKnobs, type FinishColorKey, type FinishKnob, type FinishNumberKey } from './finishDemoFinishes'

// ── state ──────────────────────────────────────────────────────────────

/** The key light's position, as fractions of the viewport. Every card's studio holds a copy. */
export interface KeyLight {
  x: number
  y: number
}

/** One card: the finish it wears and the studio it is lit at, both its own objects. */
export interface BenchCard {
  readonly context: ContextId
  readonly finishId: FinishId
  readonly finish: Finish
  readonly studio: StudioTuning
  /** Lights of the card's own, because its studio differs from the other cards'. */
  readonly lights: StudioLights
}

/** The settings every card on the page shares. */
export interface PageSetup {
  readonly rig: LightRig
  readonly text: TextLighting
  readonly inScene: boolean
}

export function createCard(context: ContextId, finishId: FinishId, rig: LightRig, key: KeyLight): BenchCard {
  return {
    context,
    finishId,
    finish: { ...FINISHES[finishId] },
    studio: { ...studioFor(rig, finishId), lightX: key.x, lightY: key.y },
    lights: createStudioLights(),
  }
}

// ── actions ────────────────────────────────────────────────────────────

export function setFinishNumber(card: BenchCard, key: FinishNumberKey, value: number): void {
  card.finish[key] = value
  notifyFinishTuning()
}

export function setFinishColor(card: BenchCard, key: FinishColorKey, value: string): void {
  card.finish[key] = value
  notifyFinishTuning()
}

/** Put a card's finish back to its tuned values. */
export function resetFinish(card: BenchCard): void {
  Object.assign(card.finish, FINISHES[card.finishId])
  notifyFinishTuning()
}

/** Stand the key light over a viewport point, in every card's studio. */
export function moveKeyLight(cards: readonly BenchCard[], key: KeyLight, x: number, y: number): void {
  key.x = Math.min(Math.max(x, 0), 1)
  key.y = Math.min(Math.max(y, 0), 1)
  for (const card of cards) {
    card.studio.lightX = key.x
    card.studio.lightY = key.y
  }
  notifyFinishTuning()
}

/** Restart every card's studio at a rig's values and its finish's own, keeping the key where it is. */
export function changeRig(cards: readonly BenchCard[], rig: LightRig, key: KeyLight): void {
  for (const card of cards) Object.assign(card.studio, studioFor(rig, card.finishId), { lightX: key.x, lightY: key.y })
  notifyFinishTuning()
}

// ── props ──────────────────────────────────────────────────────────────

/** The props this page gives SurfaceCanvas, apart from its children. */
export const CANVAS_PROPS = {
  pointerMode: 'surfaces',
  frameloop: 'demand',
  dpr: [1, 2],
  gl: { alpha: true, antialias: false, depth: false },
  style: { position: 'fixed', inset: 0, zIndex: 10 },
} as const satisfies Partial<SurfaceCanvasProps>

/** The FinishCard props a card takes from its finish and the page, apart from the objects it is handed. */
export interface CardProps {
  readonly inScene: boolean
  readonly environment: EnvironmentKind
  readonly text: TextLighting
  readonly tilt: 'none'
  readonly rig: LightRig
  readonly className: string
}

export function cardProps(card: BenchCard, page: PageSetup): CardProps {
  return {
    inScene: page.inScene,
    environment: FINISH_STUDIOS[card.finishId].environment,
    text: page.text,
    tilt: 'none',
    rig: page.rig,
    className: `fd-card fd-card--${card.context}`,
  }
}

// ── listing ────────────────────────────────────────────────────────────

export type CodeLine = string

const finishName = (card: BenchCard) => `${card.context}Finish`
const studioName = (card: BenchCard) => `${card.context}Studio`
const lightsName = (card: BenchCard) => `${card.context}Lights`
const fixed = (value: number) => value.toFixed(3)

export const IMPORT_LINES: readonly CodeLine[] = [
  "import { useId, useState } from 'react'",
  "import { SurfaceCanvas, useCaptureSupport } from '@petepetrash/munari'",
  "import '../material-finishes/materialFinishes.css'",
  "import { StudioEnvironment, TuningInvalidator } from '../material-finishes/MaterialFinishes'",
  "import { FinishCard } from '../material-finishes/MaterialFinishesSurface'",
  "import { createStudioEnvironments, createStudioLights, lightsOf } from '../material-finishes/materialFinishesStudio'",
  "import { FINISHES, studioFor } from '../material-finishes/materialFinishesTuning'",
  "import { inkStyle } from '../finish-demo/finishDemoFinishes'",
]

/** The canvas, its lights and environments, and each card's own finish and studio objects. */
export function setupLines(cards: readonly BenchCard[], rig: LightRig): readonly CodeLine[] {
  return [
    'const supported = useCaptureSupport()',
    'const canvasId = useId()',
    'const [environments] = useState(createStudioEnvironments)',
    ...cards.flatMap((card) => [
      `const [${finishName(card)}] = useState(() => ({ ...FINISHES['${card.finishId}'] }))`,
      `const [${lightsName(card)}] = useState(createStudioLights)`,
      `const [${studioName(card)}] = useState(() => ({ ...studioFor('${rig}', '${card.finishId}'), lightX: ${fixed(card.studio.lightX)}, lightY: ${fixed(card.studio.lightY)} }))`,
    ]),
    '',
    '{supported && (',
    '  <SurfaceCanvas',
    '    id={canvasId}',
    `    pointerMode="${CANVAS_PROPS.pointerMode}"`,
    `    frameloop="${CANVAS_PROPS.frameloop}"`,
    `    dpr={[${CANVAS_PROPS.dpr.join(', ')}]}`,
    `    gl={{ alpha: ${CANVAS_PROPS.gl.alpha}, antialias: ${CANVAS_PROPS.gl.antialias}, depth: ${CANVAS_PROPS.gl.depth} }}`,
    '    onCreated={({ gl }) => gl.setClearAlpha(0)}',
    `    style={{ position: '${CANVAS_PROPS.style.position}', inset: ${CANVAS_PROPS.style.inset}, zIndex: ${CANVAS_PROPS.style.zIndex} }}`,
    '  >',
    `    <StudioEnvironment rig="${rig}" environments={environments} />`,
    '    <TuningInvalidator />',
    `    {[${cards.map(lightsName).join(', ')}].flatMap((lights) => lightsOf('${rig}', lights)).map((light) => <primitive key={light.uuid} object={light} />)}`,
    '  </SurfaceCanvas>',
    ')}',
  ]
}

/** One card's FinishCard, with the props cardProps gives it. */
export function cardLines(card: BenchCard, page: PageSetup, content: string): readonly CodeLine[] {
  const props = cardProps(card, page)
  return [
    '<FinishCard',
    '  canvasId={canvasId}',
    // The page shows its HTML copy by passing false, whatever the support.
    props.inScene ? '  inScene={supported}' : '  inScene={false}',
    `  finish={${finishName(card)}}`,
    `  studio={${studioName(card)}}`,
    `  environment="${props.environment}"`,
    '  environments={environments}',
    `  text="${props.text}"`,
    `  tilt="${props.tilt}"`,
    `  rig="${props.rig}"`,
    `  lights={${lightsName(card)}}`,
    `  className="${props.className}"`,
    `  style={inkStyle(${finishName(card)}.color)}`,
    '>',
    `  <${content} />`,
    '</FinishCard>',
  ]
}

function decimalsOf(step: number): number {
  const [, fraction = ''] = String(step).split('.')
  return fraction.length
}

function knobValue(card: BenchCard, knob: FinishKnob): string {
  if (knob.kind === 'color') return `'${card.finish[knob.key]}'`
  return card.finish[knob.key].toFixed(decimalsOf(knob.step))
}

/** The writes that bring a card's finish from its tuned values to what is on screen, and the key light's position. */
export function adjustLines(card: BenchCard, cards: readonly BenchCard[]): readonly CodeLine[] {
  const tuned = FINISHES[card.finishId]
  const knobs = [...BASE_KNOBS, ...ownKnobs(tuned)]
  const lines: CodeLine[] = knobs
    .filter((knob) => card.finish[knob.key] !== tuned[knob.key])
    .map((knob) => `${finishName(card)}.${knob.key} = ${knobValue(card, knob)}`)
  const studios = cards.map(studioName).join(', ')
  lines.push(`for (const studio of [${studios}]) Object.assign(studio, { lightX: ${fixed(card.studio.lightX)}, lightY: ${fixed(card.studio.lightY)} })`)
  lines.push('notifyFinishTuning()  // redraws the canvas; a finish whose relief or a lobe changes kind rebuilds its material')
  return lines
}

export const RIG_CHOICES = LIGHT_RIGS.map((item) => [item.id, item.label] as const)
