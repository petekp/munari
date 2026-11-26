// Finish stage — the page's one SurfaceCanvas, its lights and environments,
// the draggable key light, and the cards that wear their finishes.
//
// The law: each card hands FinishCard its own finish, studio and lights, so
// cards with different finishes share the canvas. The key light is one
// position that every card's studio holds a copy of, so dragging it moves
// the light over all of them at once. Each card's ink follows its own body
// color, so its text stays legible while the color is tuned.
//
// Ownership: the material-finishes scene owns the material, lights and
// environments. This module mounts them and passes each card the props the
// code listing prints (finishDemoRecipe).

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { SurfaceCanvas, useCaptureSupport, type SurfaceCanvasId } from '@petepetrash/munari'
import { StudioEnvironment, TuningInvalidator } from '../material-finishes/MaterialFinishes'
import { FinishCard } from '../material-finishes/MaterialFinishesSurface'
import {
  createStudioEnvironments,
  lightsOf,
  type StudioEnvironments,
} from '../material-finishes/materialFinishesStudio'
import { subscribeFinishTuning, type LightRig } from '../material-finishes/materialFinishesTuning'
import { inkStyle } from './finishDemoFinishes'
import { CANVAS_PROPS, cardProps, moveKeyLight, type BenchCard, type KeyLight, type PageSetup } from './finishDemoRecipe'
import '../material-finishes/materialFinishes.css'
import './finishDemo.css'

// The material-finishes scene's arrow-key step for its light handle.
const KEY_STEP = 0.02

function keyDelta(key: string): readonly [number, number] | null {
  switch (key) {
    case 'ArrowLeft': return [-KEY_STEP, 0]
    case 'ArrowRight': return [KEY_STEP, 0]
    case 'ArrowUp': return [0, -KEY_STEP]
    case 'ArrowDown': return [0, KEY_STEP]
    default: return null
  }
}

export type PageGround = 'light' | 'dark'

let tuningVersion = 0
subscribeFinishTuning(() => {
  tuningVersion += 1
})

/** A number that changes whenever a finish or studio value is written, for re-rendering readouts. */
export function useTuningVersion(): number {
  return useSyncExternalStore(subscribeFinishTuning, () => tuningVersion)
}

// ── stage ──────────────────────────────────────────────────────────────

interface StageContextValue {
  readonly canvasId: SurfaceCanvasId
  readonly environments: StudioEnvironments
}

const StageContext = createContext<StageContextValue | null>(null)

function useStage(): StageContextValue {
  const stage = useContext(StageContext)
  if (!stage) throw new Error('A finished card needs a FinishStage around it')
  return stage
}

interface LightHandleProps {
  readonly cards: readonly BenchCard[]
  readonly keyLight: KeyLight
}

function LightHandle({ cards, keyLight }: LightHandleProps) {
  useTuningVersion()
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    moveKeyLight(cards, keyLight, event.clientX / window.innerWidth, event.clientY / window.innerHeight)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = keyDelta(event.key)
    if (!delta) return
    event.preventDefault()
    moveKeyLight(cards, keyLight, keyLight.x + delta[0], keyLight.y + delta[1])
  }
  return (
    <button
      type="button"
      className="mf-light-handle"
      style={{ left: `${keyLight.x * 100}%`, top: `${keyLight.y * 100}%` }}
      aria-label="Key light. Drag or use the arrow keys to move it over the cards."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
    >
      <span className="mf-light-dot" aria-hidden />
    </button>
  )
}

interface FinishStageProps {
  readonly rig: LightRig
  readonly ground: PageGround
  readonly cards: readonly BenchCard[]
  readonly keyLight: KeyLight
  readonly className: string
  /** Show the cards as page HTML instead of on Surfaces. */
  readonly pageHtml: boolean
  readonly onReady?: () => void
  /** The page, given whether the cards are drawn on Surfaces. */
  readonly children: (inScene: boolean) => ReactNode
}

export function FinishStage({ rig, ground, cards, keyLight, className, pageHtml, onReady, children }: FinishStageProps) {
  const supported = useCaptureSupport()
  const canvasId = useId()
  const [environments] = useState(createStudioEnvironments)
  useEffect(() => {
    let alive = true
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (alive) requestAnimationFrame(() => onReady?.())
    })
    return () => {
      alive = false
    }
  }, [onReady])
  const inScene = supported && !pageHtml
  const [stage] = useState<StageContextValue>(() => ({ canvasId, environments }))

  return (
    <div className={`fd-page ${className}`} data-page-ground={ground}>
      {supported && (
        <SurfaceCanvas id={canvasId} {...CANVAS_PROPS} onCreated={({ gl }) => gl.setClearAlpha(0)}>
          <StudioEnvironment rig={rig} environments={environments} />
          <TuningInvalidator />
          {cards.flatMap((card) => lightsOf(rig, card.lights)).map((light) => (
            <primitive key={light.uuid} object={light} />
          ))}
        </SurfaceCanvas>
      )}
      <StageContext.Provider value={stage}>{children(inScene)}</StageContext.Provider>
      {inScene && <LightHandle cards={cards} keyLight={keyLight} />}
    </div>
  )
}

// ── cards ──────────────────────────────────────────────────────────────

interface FinishedCardProps {
  readonly card: BenchCard
  readonly page: PageSetup
  readonly children: ReactNode
}

/** A piece of UI wearing its own finish: FinishCard with exactly the props cardProps gives it. */
export function FinishedCard({ card, page, children }: FinishedCardProps) {
  const { canvasId, environments } = useStage()
  const props = cardProps(card, page)
  return (
    <FinishCard
      canvasId={canvasId}
      inScene={props.inScene}
      finish={card.finish}
      studio={card.studio}
      environment={props.environment}
      environments={environments}
      text={props.text}
      tilt={props.tilt}
      rig={props.rig}
      lights={card.lights}
      className={props.className}
      style={inkStyle(card.finish.color)}
    >
      {children}
    </FinishCard>
  )
}
