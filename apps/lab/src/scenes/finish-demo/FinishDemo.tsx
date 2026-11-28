// Finish demo — a bench where a developer puts Munari's material finishes on
// four kinds of UI side by side, adjusts each card's finish, and reads the
// code that is running (?scene=finish-demo).
//
// The finishes are the preset table's and the material and lights are the
// library's. Each card wears its own finish; the light rig, text lighting
// and key light are the page's.

import { useEffect, useRef, useState } from 'react'
import { finishes } from '../material-finishes/recipe/finishes'
import { Button } from '../../components/system'
import { FINISH_ORDER, type CardTilt, type FinishId, type LightRig, type TextLighting } from '../material-finishes/materialFinishesTuning'
import { CODE_NOTE, DemoBar } from './FinishDemoBar'
import { CONTEXTS, ContextCard, contextOf, type ContextId } from './FinishDemoContexts'
import { Choice, CodeListing, CopyCode, FinishPicker, GROUND_OPTIONS, KnobControl, RIG_OPTIONS, TEXT_OPTIONS } from './FinishDemoControls'
import { BASE_KNOBS, ownKnobs } from './finishDemoFinishes'
import { adjustLines, cardLines, createCard, importLines, keyLight, restPointerLight, setupLines, sizeKeys, type BenchCard, type CodeLine, type PageSetup } from './finishDemoRecipe'
import { FinishStage, moveKey, useKeyPosition, type PageGround } from './FinishDemoStage'

// The finish each card starts in: four finishes whose lobes differ (a coat,
// a dielectric's plain gloss, a brushed metal and a sheen), so the bench
// opens on materials a reader can tell apart. Lacquer goes on the tile,
// whose empty right half can take its highlight without covering text.
const START_FINISHES: readonly (readonly [ContextId, FinishId])[] = [
  ['settings', 'polymer-charcoal'],
  ['product', 'aluminum-blue'],
  ['tile', 'lacquer-crimson'],
  ['media', 'velvet-midnight'],
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
  return [2 * targetX - window.innerWidth / 2, 2 * targetY - window.innerHeight / 2]
}

type CodeTab = 'apply' | 'adjust'

type KeyFollow = 'drag' | 'pointer'

const FOLLOW_OPTIONS: readonly (readonly [KeyFollow, string])[] = [
  ['drag', 'Drag'],
  ['pointer', 'Follows pointer'],
]

const TILT_OPTIONS: readonly (readonly [CardTilt, string])[] = [
  ['none', 'Flat'],
  ['pointer', 'Tilt to pointer'],
]

const CODE_TABS: readonly (readonly [CodeTab, string])[] = [
  ['apply', 'Apply'],
  ['adjust', 'Adjust'],
]

function finishLabel(id: FinishId): string {
  return FINISH_ORDER.find((item) => item.id === id)?.label ?? id
}

export function FinishDemoApp({ onReady }: { readonly onReady?: () => void }) {
  const [rig, setRig] = useState<LightRig>('softbox')
  const [cards, setCards] = useState<readonly BenchCard[]>(() => START_FINISHES.map(([context, preset]) => createCard(context, preset)))
  const [selected, setSelected] = useState<ContextId>(HIGHLIGHT_CARD)
  const [text, setText] = useState<TextLighting>('unlit')
  const [ground, setGround] = useState<PageGround>('light')
  const [pageHtml, setPageHtml] = useState(false)
  const [tab, setTab] = useState<CodeTab>('apply')
  const [follow, setFollow] = useState<KeyFollow>('drag')
  const [tilt, setTilt] = useState<CardTilt>('none')
  const followsPointer = follow === 'pointer'
  const gridRef = useRef<HTMLElement>(null)
  const keyPlaced = useRef(false)

  useEffect(() => {
    const figure = gridRef.current?.querySelector(`[data-context="${HIGHLIGHT_CARD}"]`)?.getBoundingClientRect()
    if (keyPlaced.current || !figure) return
    keyPlaced.current = true
    const [x, y] = keyFor(figure.left + figure.width * HIGHLIGHT_X, figure.top + figure.height * HIGHLIGHT_Y)
    moveKey(x, y)
  }, [cards])

  const card = cards.find((item) => item.context === selected)
  if (!card) throw new Error(`The bench has no ${selected} card`)
  const replaceCard = (next: BenchCard) => {
    setCards((current) => current.map((item) => (item.context === next.context ? next : item)))
  }
  const chooseFinish = (preset: FinishId) => replaceCard(createCard(selected, preset))
  const chooseRig = (next: LightRig) => {
    setRig(next)
    sizeKeys(next)
  }
  const chooseFollow = (next: KeyFollow) => {
    restPointerLight()
    setFollow(next)
  }

  return (
    <FinishStage ground={ground} className="fd-bench" pageHtml={pageHtml} followsPointer={followsPointer} tilts={tilt === 'pointer'} onReady={onReady}>
      {(inScene) => {
        const page: PageSetup = { rig, text, inScene, followsPointer, tilt }
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
                        <span className="fd-swatch" style={{ background: item.finish.color ?? undefined }} aria-hidden />
                        <span>
                          <strong>{contextOf(item.context).label}</strong>
                          <span className="fd-finish-note">{finishLabel(item.preset)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h2 className="fd-heading">{contextOf(card.context).label} finish</h2>
                <FinishPicker value={card.preset} onSelect={chooseFinish} />
              </section>
              <section>
                <h2 className="fd-heading">Adjust</h2>
                {[...BASE_KNOBS, ...ownKnobs(finishes[card.preset])].map((knob) => (
                  <KnobControl
                    key={`${card.context}-${card.preset}-${knob.path.join('.')}`}
                    knob={knob}
                    finish={card.finish}
                    onChange={(finish) => replaceCard({ ...card, finish })}
                  />
                ))}
                <Button compact variant="outline" onClick={() => replaceCard(createCard(card.context, card.preset))}>
                  Reset finish
                </Button>
              </section>
              <section>
                <h2 className="fd-heading">Page</h2>
                <Choice label="Text lighting" value={text} options={TEXT_OPTIONS} onSelect={setText} />
                <Choice label="Page" value={ground} options={GROUND_OPTIONS} onSelect={setGround} />
                <Choice label="Light" value={rig} options={RIG_OPTIONS} onSelect={chooseRig} />
              </section>
              <section>
                <h2 className="fd-heading">Pointer</h2>
                <Choice label="Key light" value={follow} options={FOLLOW_OPTIONS} onSelect={chooseFollow} />
                <Choice label="Cards" value={tilt} options={TILT_OPTIONS} onSelect={setTilt} />
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
                      {context.label} · {finishLabel(item.preset)}
                    </figcaption>
                  </figure>
                )
              })}
            </main>
            <BenchCode cards={cards} card={card} page={page} tab={tab} onTab={setTab} />
          </>
        )
      }}
    </FinishStage>
  )
}

interface BenchCodeProps {
  readonly cards: readonly BenchCard[]
  readonly card: BenchCard
  readonly page: PageSetup
  readonly tab: CodeTab
  readonly onTab: (tab: CodeTab) => void
}

/** The listing follows the key light itself, so a light drag re-renders only the listing. */
function BenchCode({ cards, card, page, tab, onTab }: BenchCodeProps) {
  const key = useKeyPosition(keyLight)
  const apply: CodeLine[] = [...importLines(page), '', ...setupLines(cards, page, key)]
  for (const item of cards) apply.push('', ...cardLines(item, page, contextOf(item.context).content))
  const lines = tab === 'apply' ? apply : adjustLines(card, page, key)
  return (
    <aside className="fd-rail fd-rail--code">
      <div className="fd-code-head">
        <Choice label="Code" value={tab} options={CODE_TABS} onSelect={onTab} />
        <CopyCode lines={lines} />
      </div>
      <p className="fd-note">
        {tab === 'apply'
          ? 'Give the canvas the key light, then give each piece of UI a Surface with its own finish. Its content paints var(--munari-body).'
          : `The writes that bring the ${contextOf(card.context).label.toLowerCase()} from its tuned finish to what is on screen. Drag the light or move a slider and this updates.`}
      </p>
      <CodeListing lines={lines} />
      <p className="fd-note">{CODE_NOTE}</p>
    </aside>
  )
}
