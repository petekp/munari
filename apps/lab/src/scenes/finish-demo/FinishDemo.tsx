// Finish demo — a bench where a developer puts Munari's material finishes on
// four kinds of UI side by side, adjusts each card's finish, and reads the
// code that is running (?scene=finish-demo).
//
// The finishes, studio and material are the material-finishes scene's
// modules, imported rather than copied, so changes there reach this page.
// Each card wears its own finish; the light rig, text lighting and key light
// are the page's.

import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/system'
import { FINISH_ORDER, FINISHES, notifyFinishTuning, type FinishId, type LightRig, type TextLighting } from '../material-finishes/materialFinishesTuning'
import { CODE_NOTE, DemoBar } from './FinishDemoBar'
import { CONTEXTS, ContextCard, contextOf, type ContextId } from './FinishDemoContexts'
import { Choice, CodeListing, CopyCode, FinishPicker, GROUND_OPTIONS, KnobControl, RIG_OPTIONS, TEXT_OPTIONS } from './FinishDemoControls'
import { BASE_KNOBS, ownKnobs } from './finishDemoFinishes'
import {
  adjustLines,
  cardLines,
  changeRig,
  createCard,
  IMPORT_LINES,
  moveKeyLight,
  resetFinish,
  setupLines,
  type BenchCard,
  type CodeLine,
  type KeyLight,
  type PageSetup,
} from './finishDemoRecipe'
import { FinishStage, useTuningVersion, type PageGround } from './FinishDemoStage'

// The finish each card starts in: four finishes whose lobes differ (a coat,
// a dielectric's plain gloss, a brushed metal and a sheen), so the bench
// opens on materials a reader can tell apart. Lacquer goes on the tile,
// whose empty right half can take its highlight without covering text.
const START_FINISHES: readonly (readonly [ContextId, FinishId])[] = [
  ['settings', 'satin-polymer'],
  ['product', 'anodized-aluminum'],
  ['tile', 'lacquer'],
  ['media', 'velvet'],
]
const HIGHLIGHT_CARD: ContextId = 'tile'

// Where the key's highlight should start on HIGHLIGHT_CARD, as fractions of
// its figure: across the tile's right edge, level with its readout, where
// it covers no text.
const HIGHLIGHT_X = 0.83
const HIGHLIGHT_Y = 0.41

/**
 * The viewport point to stand the key over so a coat's highlight lands on
 * a target. The highlight lands about halfway between the key's viewport
 * point and the viewport center (measured 2026-11-26 at 1440×900: a key at
 * (744, 618) put lacquer's highlight at (732, 534)).
 */
function keyFor(targetX: number, targetY: number): readonly [number, number] {
  return [(2 * targetX) / window.innerWidth - 0.5, (2 * targetY) / window.innerHeight - 0.5]
}

type CodeTab = 'apply' | 'adjust'

const CODE_TABS: readonly (readonly [CodeTab, string])[] = [
  ['apply', 'Apply'],
  ['adjust', 'Adjust'],
]

function finishLabel(id: FinishId): string {
  return FINISH_ORDER.find((item) => item.id === id)?.label ?? id
}

export function FinishDemoApp({ onReady }: { readonly onReady?: () => void }) {
  useTuningVersion()
  const [rig, setRig] = useState<LightRig>('softbox')
  const [keyLight] = useState<KeyLight>(() => ({ x: 0.5, y: 0.5 }))
  const [cards, setCards] = useState<readonly BenchCard[]>(() =>
    START_FINISHES.map(([context, finishId]) => createCard(context, finishId, 'softbox', keyLight)),
  )
  const [selected, setSelected] = useState<ContextId>(HIGHLIGHT_CARD)
  const [text, setText] = useState<TextLighting>('unlit')
  const [ground, setGround] = useState<PageGround>('light')
  const [pageHtml, setPageHtml] = useState(false)
  const [tab, setTab] = useState<CodeTab>('apply')
  const gridRef = useRef<HTMLElement>(null)
  const keyPlaced = useRef(false)

  useEffect(() => {
    const figure = gridRef.current?.querySelector(`[data-context="${HIGHLIGHT_CARD}"]`)?.getBoundingClientRect()
    if (keyPlaced.current || !figure) return
    keyPlaced.current = true
    const [x, y] = keyFor(figure.left + figure.width * HIGHLIGHT_X, figure.top + figure.height * HIGHLIGHT_Y)
    moveKeyLight(cards, keyLight, x, y)
  }, [cards, keyLight])

  useEffect(() => {
    notifyFinishTuning()
  }, [cards])

  const card = cards.find((item) => item.context === selected)
  if (!card) throw new Error(`The bench has no ${selected} card`)
  const chooseFinish = (finishId: FinishId) => {
    setCards((current) => current.map((item) => (item.context === selected ? createCard(selected, finishId, rig, keyLight) : item)))
  }
  const chooseRig = (next: LightRig) => {
    setRig(next)
    changeRig(cards, next, keyLight)
  }

  return (
    <FinishStage rig={rig} ground={ground} cards={cards} keyLight={keyLight} className="fd-bench" pageHtml={pageHtml} onReady={onReady}>
      {(inScene) => {
        const page: PageSetup = { rig, text, inScene }
        const apply: CodeLine[] = [...IMPORT_LINES, '', ...setupLines(cards, rig)]
        for (const item of cards) apply.push('', ...cardLines(item, page, contextOf(item.context).content))
        const lines = tab === 'apply' ? apply : adjustLines(card, cards)
        return (
          <>
            <DemoBar inScene={inScene} />
            <aside className="fd-rail fd-rail--controls">
              <section>
                <h2 className="fd-heading">Card</h2>
                <ul className="fd-finishes">
                  {cards.map((item) => (
                    <li key={item.context}>
                      <button type="button" className="fd-finish" aria-pressed={item.context === selected} onClick={() => setSelected(item.context)}>
                        <span className="fd-swatch" style={{ background: item.finish.color }} aria-hidden />
                        <span>
                          <strong>{contextOf(item.context).label}</strong>
                          <span className="fd-finish-note">{finishLabel(item.finishId)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h2 className="fd-heading">{contextOf(card.context).label} finish</h2>
                <FinishPicker value={card.finishId} onSelect={chooseFinish} />
              </section>
              <section>
                <h2 className="fd-heading">Adjust</h2>
                {[...BASE_KNOBS, ...ownKnobs(FINISHES[card.finishId])].map((knob) => (
                  <KnobControl key={`${card.context}-${card.finishId}-${knob.key}`} knob={knob} card={card} />
                ))}
                <Button compact variant="outline" onClick={() => resetFinish(card)}>
                  Reset finish
                </Button>
              </section>
              <section>
                <h2 className="fd-heading">Page</h2>
                <Choice label="Text lighting" value={text} options={TEXT_OPTIONS} onSelect={setText} />
                <Choice label="Page" value={ground} options={GROUND_OPTIONS} onSelect={setGround} />
                <Choice label="Light" value={rig} options={RIG_OPTIONS} onSelect={chooseRig} />
                <Button compact variant="outline" onClick={() => setPageHtml((on) => !on)}>
                  {pageHtml ? 'Show finishes' : 'Show page HTML'}
                </Button>
              </section>
            </aside>
            <main ref={gridRef} className="fd-grid">
              {CONTEXTS.map((context) => {
                const item = cards.find((entry) => entry.context === context.id)
                if (!item) return null
                return (
                  <figure key={context.id} className="fd-context" data-context={context.id}>
                    <ContextCard card={item} page={page} />
                    <figcaption>
                      {context.label} · {finishLabel(item.finishId)}
                    </figcaption>
                  </figure>
                )
              })}
            </main>
            <aside className="fd-rail fd-rail--code">
              <div className="fd-code-head">
                <Choice label="Code" value={tab} options={CODE_TABS} onSelect={setTab} />
                <CopyCode lines={lines} />
              </div>
              <p className="fd-note">
                {tab === 'apply'
                  ? 'Mount the lights and environments in the canvas, then give each piece of UI a FinishCard with its own finish, studio and lights.'
                  : `The writes that bring the ${contextOf(card.context).label.toLowerCase()} from its tuned finish to what is on screen. Drag the light or move a slider and this updates.`}
              </p>
              <CodeListing lines={lines} />
              <p className="fd-note">{CODE_NOTE}</p>
            </aside>
          </>
        )
      }}
    </FinishStage>
  )
}
