// Finish stage — the page's one SurfaceCanvas, the draggable key light, and
// the cards that wear their finishes.
//
// The law: each card's Surface.Root takes its own finish, so cards with
// different finishes share the canvas, and the canvas lights them all with
// one key. The key is a createSurfaceLight handle: dragging it redraws the
// canvas and moves the handle with no React render. Each card's ink follows
// its own body color, so its text stays legible while the color is tuned.
//
// Ownership: the library owns the material and lights. This module mounts
// the canvas and gives each card the props the code listing prints
// (finishDemoRecipe).

import { createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Surface, SurfaceCanvas, useCaptureSupport, type LightPosition, type SurfaceCanvasId, type SurfaceLight } from '@petepetrash/munari'
import { RecaptureOnStyle } from '../material-finishes/MaterialFinishesSurface'
import { bodyOf, inkStyle } from './finishDemoFinishes'
import { CANVAS_PROPS, cardProps, keyLight, type BenchCard, type PageSetup } from './finishDemoRecipe'
import '../material-finishes/materialFinishes.css'
import './finishDemo.css'

// The material-finishes scene's arrow-key step for its light handle, as a
// fraction of the viewport.
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

/** Stand the key over a client point, kept inside the viewport. */
export function moveKey(x: number, y: number): void {
  keyLight.set({ x: Math.min(Math.max(x, 0), window.innerWidth), y: Math.min(Math.max(y, 0), window.innerHeight) })
}

/** The key's position, re-rendering the caller on each move: for readouts such as the code listing. */
export function useKeyPosition(light: SurfaceLight): LightPosition {
  const [position, setPosition] = useState(light.get)
  useEffect(() => light.subscribe(setPosition), [light])
  return position
}

export type PageGround = 'light' | 'dark'

// ── stage ──────────────────────────────────────────────────────────────

const StageContext = createContext<SurfaceCanvasId | null>(null)

function useStageCanvas(): SurfaceCanvasId {
  const canvasId = useContext(StageContext)
  if (!canvasId) throw new Error('A finished card needs a FinishStage around it')
  return canvasId
}

function LightHandle() {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(
    () =>
      keyLight.subscribe(({ x, y }) => {
        const handle = ref.current
        if (!handle || x === null || y === null) return
        handle.style.left = `${x}px`
        handle.style.top = `${y}px`
      }),
    [],
  )
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    moveKey(event.clientX, event.clientY)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = keyDelta(event.key)
    const { x, y } = keyLight.get()
    if (!delta || x === null || y === null) return
    event.preventDefault()
    moveKey(x + delta[0] * window.innerWidth, y + delta[1] * window.innerHeight)
  }
  return (
    <button
      ref={ref}
      type="button"
      className="mf-light-handle"
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
  readonly ground: PageGround
  readonly className: string
  /** Show the cards as page HTML instead of on Surfaces. */
  readonly pageHtml: boolean
  readonly onReady?: () => void
  /** The page, given whether the cards are drawn on Surfaces. */
  readonly children: (inScene: boolean) => ReactNode
}

export function FinishStage({ ground, className, pageHtml, onReady, children }: FinishStageProps) {
  const supported = useCaptureSupport()
  const canvasId = useId()
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

  return (
    <div className={`fd-page ${className}`} data-page-ground={ground}>
      {supported && <SurfaceCanvas id={canvasId} {...CANVAS_PROPS} onCreated={({ gl }) => gl.setClearAlpha(0)} />}
      <StageContext value={canvasId}>{children(inScene)}</StageContext>
      {inScene && <LightHandle />}
    </div>
  )
}

// ── cards ──────────────────────────────────────────────────────────────

interface FinishedCardProps {
  readonly card: BenchCard
  readonly page: PageSetup
  readonly children: ReactNode
}

/** A piece of UI wearing its own finish, with exactly the props cardProps gives it. */
export function FinishedCard({ card, page, children }: FinishedCardProps) {
  const canvasId = useStageCanvas()
  const props = cardProps(card, page)
  const ink = inkStyle(bodyOf(card.finish))
  return (
    <Surface.Root canvasId={canvasId} inScene={props.inScene} finish={props.finish}>
      <Surface.HTML>
        <div className={props.className} style={ink}>
          <RecaptureOnStyle style={ink} />
          {children}
        </div>
      </Surface.HTML>
      <Surface.Scene>
        <Surface.Mesh placement="match-dom" />
      </Surface.Scene>
    </Surface.Root>
  )
}
