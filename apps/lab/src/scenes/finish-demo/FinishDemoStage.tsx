// Finish stage — the page's one WebGPU SurfaceCanvas, the draggable key light,
// and the cards that wear their finishes (`@petepetrash/munari/gpu`, zero Three.js).
//
// The law: each card's `Surface` takes its own fluid omitted-`size` layout box
// and its own `finish`, so cards share one canvas and one key light. Dragging the
// key handle redraws the canvas without React re-renders. When pointer tilt is
// enabled, `createPointerTiltBehavior` drives each card's pose with analytic
// springs (`apps/lab/src/behaviors/compose.ts`) and wakes the demand canvas via
// `requestGpuFrame`, turning both geometry and compiled finish normals together.
//
// Ownership: `@petepetrash/munari/gpu` owns WebGPU finishes & device lifecycle;
// this module owns stage setup, the key light handle, and card props.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import {
  Surface,
  SurfaceCanvas,
  getGpuHostStats,
  requestGpuFrame,
  supportsCapture,
  type GpuHostStats,
  type LightPosition,
  type SurfaceFrameContext,
  type SurfaceLight,
} from '@petepetrash/munari/gpu'

declare global {
  interface Window {
    __finishDemoStats?: () => GpuHostStats
  }
}
import { createPointerTiltBehavior } from '../../behaviors/compose'
import { SPRING_SNAPPY } from '../../behaviors/spring'
import { bodyOf, inkStyle } from './finishDemoFinishes'
import { CANVAS_PROPS, cardProps, keyLight, POINTER_LIGHTING, type BenchCard, type PageSetup } from './finishDemoRecipe'
import '../material-finishes/materialFinishes.css'
import './finishDemo.css'

// The arrow-key step for the draggable key light handle, as a fraction of viewport.
const KEY_STEP = 0.02
// Six-degree max tilt matching the original bench reach.
const MAX_TILT_RAD = (6 * Math.PI) / 180
const TILT_REACH_PX = 420
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

interface PagePointerState {
  position: { readonly x: number; readonly y: number } | null
}

const pagePointer: PagePointerState = { position: null }

function keyDelta(key: string): readonly [number, number] | null {
  switch (key) {
    case 'ArrowLeft':
      return [-KEY_STEP, 0]
    case 'ArrowRight':
      return [KEY_STEP, 0]
    case 'ArrowUp':
      return [0, -KEY_STEP]
    case 'ArrowDown':
      return [0, KEY_STEP]
    default:
      return null
  }
}

/** Stand the key over a client point, kept inside the viewport. */
export function moveKey(x: number, y: number): void {
  keyLight.set({
    x: Math.min(Math.max(x, 0), window.innerWidth),
    y: Math.min(Math.max(y, 0), window.innerHeight),
  })
}

/** The key's position, re-rendering the caller on each move for code listings. */
export function useKeyPosition(light: SurfaceLight): LightPosition {
  const [position, setPosition] = useState(light.get)
  useEffect(() => light.subscribe(setPosition), [light])
  return position
}

export type PageGround = 'light' | 'dark'

// ── stage ──────────────────────────────────────────────────────────────

const StageContext = createContext<string | null>(null)

function useStageCanvas(): string {
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
  readonly pageHtml: boolean
  readonly followsPointer: boolean
  readonly tilts: boolean
  readonly onReady?: () => void
  readonly children: (inScene: boolean) => ReactNode
}

export function FinishStage({ ground, className, pageHtml, followsPointer, tilts, onReady, children }: FinishStageProps) {
  const supported = useMemo(() => supportsCapture(), [])
  const canvasId = useId()
  useEffect(() => {
    window.__finishDemoStats = () => getGpuHostStats(canvasId)
    return () => {
      delete window.__finishDemoStats
    }
  }, [canvasId])
  useEffect(() => {
    let alive = true
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (alive) requestAnimationFrame(() => onReady?.())
    })
    return () => {
      alive = false
    }
  }, [onReady])

  useEffect(() => {
    if (!tilts) {
      pagePointer.position = null
      requestGpuFrame(canvasId)
      return
    }
    const reduced = window.matchMedia?.(REDUCED_MOTION)
    const update = (pos: PagePointerState['position']) => {
      pagePointer.position = reduced?.matches ? null : pos
      requestGpuFrame(canvasId)
    }
    const onMove = (event: globalThis.PointerEvent) => {
      if (!event.isTrusted) return
      update({ x: event.clientX, y: event.clientY })
    }
    const onLeave = () => update(null)
    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    reduced?.addEventListener('change', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      reduced?.removeEventListener('change', onLeave)
      pagePointer.position = null
    }
  }, [tilts, canvasId])

  const inScene = supported && !pageHtml

  return (
    <div className={`fd-page ${className}`} data-page-ground={ground}>
      {supported && (
        <SurfaceCanvas
          id={canvasId}
          pointerMode={CANVAS_PROPS.pointerMode}
          frameloop={CANVAS_PROPS.frameloop}
          lighting={followsPointer ? POINTER_LIGHTING : CANVAS_PROPS.lighting}
          style={CANVAS_PROPS.style}
        />
      )}
      <StageContext value={canvasId}>{children(inScene)}</StageContext>
      {inScene && !followsPointer && <LightHandle />}
    </div>
  )
}

// ── cards ──────────────────────────────────────────────────────────────

interface FinishedCardProps {
  readonly card: BenchCard
  readonly page: PageSetup
  readonly children: ReactNode
}

/** A fluid omitted-size UI card wearing its own compiled WebGPU finish. */
export function FinishedCard({ card, page, children }: FinishedCardProps) {
  const canvasId = useStageCanvas()
  const props = cardProps(card, page)
  const ink = inkStyle(bodyOf(card.finish))
  const tilt = useMemo(() => createPointerTiltBehavior(MAX_TILT_RAD, SPRING_SNAPPY), [])
  const tiltsRef = useRef(page.tilt === 'pointer')
  tiltsRef.current = page.tilt === 'pointer'

  useEffect(() => {
    if (page.tilt !== 'pointer') {
      tilt.reset()
      requestGpuFrame(canvasId)
    }
  }, [page.tilt, tilt, canvasId])

  const onFrame = useCallback(
    (ctx: SurfaceFrameContext) => {
      const ptr = tiltsRef.current ? pagePointer.position : null
      if (ptr && ctx.pageRect) {
        const cx = ctx.pageRect.left + ctx.pageRect.width / 2
        const cy = ctx.pageRect.top + ctx.pageRect.height / 2
        const nx = Math.max(-1, Math.min(1, (ptr.x - cx) / TILT_REACH_PX))
        const ny = Math.max(-1, Math.min(1, (cy - ptr.y) / TILT_REACH_PX))
        tilt.setPointer(nx, ny)
      } else {
        tilt.reset()
      }
      return tilt.behavior(ctx)
    },
    [tilt],
  )

  return (
    <Surface canvasId={canvasId} inScene={props.inScene} finish={props.finish} onFrame={onFrame}>
      <div className={props.className} style={ink}>
        {children}
      </div>
    </Surface>
  )
}
