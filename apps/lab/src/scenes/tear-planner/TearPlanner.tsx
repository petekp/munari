// Tear-off planner — a day planner you close by tearing off the page.
//
// Two live `@petepetrash/munari/gpu` Surfaces share one canvas (today on top,
// tomorrow beneath) plus a contentless drop-shadow manifest for the falling page.
// Pulling the bottom corner curls today's sheet by `tearPlannerFoldLaw`; pulling
// past the perforation tears along `tearFront` and lets it fall off the pad.
//
// Ownership: `@petepetrash/munari/gpu` owns WebGPU capture, pointer raycasting,
// and demand ticks; `tearPlannerMotion` owns curl/tear/fall physics; this file
// owns task state and DOM slots.

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import {
  Surface,
  SurfaceCanvas,
  detectHtmlInCanvas,
  requestGpuFrame,
  supportsCapture,
  type SurfaceFrameContext,
} from '@petepetrash/munari/gpu'
import { HOLE_PITCH_PX, foldPoint } from './tearPlannerFoldLaw'
import { tearPlannerSheetManifest, type TearPlannerSheetUniforms } from './tearPlannerSheet.material.gen'
import { tearPlannerDropShadowManifest, type TearPlannerDropShadowUniforms } from './tearPlannerDropShadow.material.gen'
import { createSheetMotion, type SheetMotion, type SheetReading } from './tearPlannerMotion'
import { PAD_CITY, sheetFor } from './tearPlannerAlmanac'
import { EMPTY_SLOTS, SEED, carryInto, countDone, writeOnBlankLine, type Days, type Slots, type Task } from './tearPlannerTasks'
import { SHEET_HEIGHT, SHEET_WIDTH, TearPlannerPage } from './TearPlannerPage'
import './tearPlanner.css'

const CANVAS_ID = 'munari-tear-planner'
const FOV = 30
const UNDER_Z = -2
let taskSeq = 100

function handFromClient(slot: HTMLElement | null, clientX: number, clientY: number) {
  const rect = slot?.getBoundingClientRect()
  return rect ? { x: clientX - rect.left, y: clientY - rect.top } : null
}

function writeSlot(slots: Slots, slot: number, change: (task: Task | null) => Task | null): Slots {
  return slots.map((task, i) => (i === slot ? change(task) : task))
}

function updateTask(days: Days, id: string, change: (task: Task) => Task) {
  return Object.fromEntries(
    Object.entries(days).map(([key, slots]) => [key, slots.map((task) => (task && task.id === id ? change(task) : task))]),
  )
}

function SheetSurface({
  index,
  canvasId,
  inScene,
  motion,
  slotRef,
  lastPointerRef,
  children,
}: {
  readonly index: 0 | 1
  readonly canvasId: string
  readonly inScene: boolean
  readonly motion: SheetMotion
  readonly slotRef: RefObject<HTMLDivElement | null>
  readonly lastPointerRef: RefObject<{ readonly x: number; readonly y: number } | null>
  readonly children: React.ReactNode
}) {
  const drawnRef = useRef({ version: -1, top: false })
  const onFrame = useCallback(
    (ctx: SurfaceFrameContext<TearPlannerSheetUniforms>) => {
      const moving = motion.advance(ctx.elapsedMs * 0.001)
      const m = motion.state
      const top = m.topIndex === index
      m.stageHeight = ctx.viewport.height
      if (ctx.pageRect) {
        const s = ctx.pageRect
        const v = ctx.viewport
        m.view = { cx: v.left + v.width / 2 - s.left, cy: v.top + v.height / 2 - s.top, distance: v.cameraZ }
      }
      const fall = top ? m.fall : null
      ctx.setPose({
        ...ctx.basePose,
        x: ctx.basePose.x + (fall ? fall.x : 0),
        y: ctx.basePose.y - (fall ? fall.y : 0),
        z: top ? (fall ? 24 : 0) : UNDER_Z,
        rz: fall ? fall.spin : 0,
      })

      if (drawnRef.current.version !== m.version || drawnRef.current.top !== top) {
        drawnRef.current = { version: m.version, top }
        const fold = top ? m.fold : null
        ctx.deform((lx, ly) => {
          const p = foldPoint(lx + SHEET_WIDTH / 2, SHEET_HEIGHT / 2 - ly, fold)
          return { x: p.x - SHEET_WIDTH / 2, y: SHEET_HEIGHT / 2 - p.y, z: p.z }
        })
        const over = top ? null : m.fold
        const rollShadowLeft = m.fall ? Math.max(0, 1 - m.fall.age / 0.3) : 1
        ctx.setUniforms({
          size: [SHEET_WIDTH, SHEET_HEIGHT],
          _pad: [0, 0],
          fold: fold ? [fold.nx, fold.ny, fold.s0, fold.r] : [0, 1, 0, 1],
          over: over ? [over.nx, over.ny, over.s0, over.r] : [0, 1, 0, 1],
          params: [fold ? 1 : 0, top ? m.tearFront : SHEET_WIDTH, over ? rollShadowLeft : 0, 0],
        })
      }
      return moving
    },
    [index, motion],
  )

  const handleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (motion.state.topIndex !== index || e.button !== 0) return
    const r = e.currentTarget.getBoundingClientRect()
    const at = { x: e.clientX - r.left, y: e.clientY - r.top }
    const pt = lastPointerRef.current ?? { x: e.clientX, y: e.clientY }
    const hand = handFromClient(slotRef.current, pt.x, pt.y)
    if (!hand || !motion.inGrabZone(at.x, at.y)) return
    motion.grabAt(at.x, at.y, hand.x, hand.y)
    requestGpuFrame(canvasId)
  }

  const handleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (motion.state.topIndex !== index) return
    const r = e.currentTarget.getBoundingClientRect()
    motion.hover(motion.inGrabZone(e.clientX - r.left, e.clientY - r.top))
    requestGpuFrame(canvasId)
  }

  const handleLeave = () => {
    if (motion.state.topIndex !== index) return
    motion.hover(false)
    requestGpuFrame(canvasId)
  }

  return (
    <Surface
      canvasId={canvasId}
      inScene={inScene}
      size={[SHEET_WIDTH, SHEET_HEIGHT]}
      segments={[70, 99]}
      material={tearPlannerSheetManifest}
      onFrame={onFrame}
    >
      <div onPointerDown={handleDown} onPointerMove={handleMove} onPointerLeave={handleLeave}>
        {children}
      </div>
    </Surface>
  )
}

function FallingDropShadow({
  canvasId,
  inScene,
  motion,
  slotRef,
}: {
  readonly canvasId: string
  readonly inScene: boolean
  readonly motion: SheetMotion
  readonly slotRef: RefObject<HTMLDivElement | null>
}) {
  const onFrame = useCallback(
    (ctx: SurfaceFrameContext<TearPlannerDropShadowUniforms>) => {
      const fall = motion.state.fall
      const slot = slotRef.current
      if (!fall || !slot) {
        ctx.setUniforms({ size: [SHEET_WIDTH, SHEET_HEIGHT], blur: 24, strength: 0 })
        return false
      }
      const r = slot.getBoundingClientRect()
      const cx = r.left + r.width / 2 - (ctx.viewport.left + ctx.viewport.width / 2)
      const cy = ctx.viewport.top + ctx.viewport.height / 2 - (r.top + r.height / 2)
      const away = Math.min(1, fall.age * 2.5)
      const t = Math.max(0, Math.min(1, (fall.age - 0.12) / (0.55 - 0.12)))
      const opened = t * t * (3 - 2 * t)
      ctx.setPose({
        x: cx + fall.x + 10 + 16 * away,
        y: cy - fall.y - 14 - 22 * away,
        z: 1,
        rz: fall.spin,
      })
      ctx.setUniforms({
        size: [SHEET_WIDTH, SHEET_HEIGHT],
        blur: 10 + 34 * away,
        strength: 0.18 * opened * (1 - 0.3 * away),
      })
      return true
    },
    [motion, slotRef],
  )

  return (
    <Surface
      canvasId={canvasId}
      exclusive={false}
      inScene={inScene}
      pointerEvents="none"
      placement="manual"
      size={[SHEET_WIDTH, SHEET_HEIGHT]}
      material={tearPlannerDropShadowManifest}
      onFrame={onFrame}
    >
      <div style={{ width: 1, height: 1 }} />
    </Surface>
  )
}

export function TearPlannerApp() {
  const supported = supportsCapture()
  const canvasId = CANVAS_ID
  const slotRef = useRef<HTMLDivElement>(null)
  const lastPointerRef = useRef<{ readonly x: number; readonly y: number } | null>(null)
  const motion = useMemo(() => createSheetMotion(SHEET_WIDTH, SHEET_HEIGHT), [])
  const [offset, setOffset] = useState(0)
  const [topIndex, setTopIndex] = useState<0 | 1>(0)
  const [days, setDays] = useState<Days>(SEED)
  const [reading, setReading] = useState<SheetReading>({
    mode: 'rest',
    liftMm: 0,
    holesTorn: 0,
    holesTotal: Math.floor(SHEET_WIDTH / HOLE_PITCH_PX),
  })

  const today = sheetFor(offset)
  const tomorrow = sheetFor(offset + 1)
  const todaySlots = days[offset] ?? EMPTY_SLOTS
  const tomorrowSlots = useMemo(
    () => carryInto(todaySlots, days[offset + 1] ?? EMPTY_SLOTS, today.weekday),
    [todaySlots, days, offset, today.weekday],
  )
  const todayIds = useMemo(() => new Set(todaySlots.filter((t): t is Task => t !== null).map((t) => t.id)), [todaySlots])

  const latest = useRef({ offset, tomorrowSlots })
  latest.current = { offset, tomorrowSlots }
  useEffect(() => {
    motion.state.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const slowmo = Number(new URLSearchParams(window.location.search).get('slowmo'))
    if (slowmo > 1) motion.state.timeScale = 1 / slowmo
    motion.state.wake = () => requestGpuFrame(canvasId)
    motion.state.onReading = setReading
    motion.state.onFallen = () => {
      const { offset: was, tomorrowSlots: carried } = latest.current
      setDays((current) => ({ ...current, [was + 1]: carried }))
      setOffset(was + 1)
      setTopIndex(motion.state.topIndex)
    }
    return () => {
      motion.state.wake = null
      motion.state.onFallen = null
      motion.state.onReading = null
    }
  }, [motion, canvasId])

  useEffect(() => {
    const down = (event: PointerEvent) => {
      if (event.isTrusted) lastPointerRef.current = { x: event.clientX, y: event.clientY }
    }
    const move = (event: PointerEvent) => {
      if (!event.isTrusted) return
      lastPointerRef.current = { x: event.clientX, y: event.clientY }
      if (motion.state.mode !== 'drag') return
      const hand = handFromClient(slotRef.current, event.clientX, event.clientY)
      if (hand) motion.moveHand(hand.x, hand.y)
      requestGpuFrame(canvasId)
    }
    const up = (event: PointerEvent) => {
      if (!event.isTrusted) return
      motion.release()
      requestGpuFrame(canvasId)
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
    }
  }, [motion, canvasId])

  const editToday = useCallback(
    (slot: number, text: string) => {
      setDays((current) => ({
        ...current,
        [offset]: writeSlot(current[offset] ?? EMPTY_SLOTS, slot, (task) =>
          task ? { ...task, text } : { id: `t${taskSeq++}`, text, done: false },
        ),
      }))
    },
    [offset],
  )
  const toggleToday = useCallback(
    (slot: number) => {
      setDays((current) => ({
        ...current,
        [offset]: writeSlot(current[offset] ?? EMPTY_SLOTS, slot, (task) => (task ? { ...task, done: !task.done } : task)),
      }))
    },
    [offset],
  )
  const editTomorrow = useCallback(
    (slot: number, text: string) => {
      const shown = tomorrowSlots[slot]
      if (shown) {
        setDays((current) => updateTask(current, shown.id, (task) => ({ ...task, text })))
        return
      }
      setDays((current) => ({
        ...current,
        [offset + 1]: writeOnBlankLine(current[offset + 1] ?? EMPTY_SLOTS, { id: `t${taskSeq++}`, text, done: false }),
      }))
    },
    [tomorrowSlots, offset],
  )
  const toggleTomorrow = useCallback(
    (slot: number) => {
      const shown = tomorrowSlots[slot]
      if (!shown) return
      setDays((current) => updateTask(current, shown.id, (task) => ({ ...task, done: !task.done })))
    },
    [tomorrowSlots],
  )

  const tearOff = () => {
    if (!supported) {
      latest.current.tomorrowSlots = tomorrowSlots
      setDays((current) => ({ ...current, [offset + 1]: tomorrowSlots }))
      setOffset(offset + 1)
      setTopIndex(topIndex === 0 ? 1 : 0)
      return
    }
    motion.tearOff()
    requestGpuFrame(canvasId)
  }

  const pages = ([0, 1] as const).map((index) => {
    const isTop = index === topIndex
    return {
      index,
      isTop,
      sheet: isTop ? today : tomorrow,
      slots: isTop ? todaySlots : tomorrowSlots,
      carried: (isTop ? todaySlots : tomorrowSlots).filter((t) => t?.carriedFrom).length,
      onText: isTop ? editToday : editTomorrow,
      onToggle: isTop ? toggleToday : toggleTomorrow,
    }
  })

  const torn = reading.mode === 'fall'
  const done = countDone(torn ? tomorrowSlots : todaySlots)
  const carrying = tomorrowSlots.filter((t) => t && todayIds.has(t.id)).length
  const engineKind = !supported ? 'none' : detectHtmlInCanvas().drawElementImage ? 'native' : 'snapdom'

  return (
    <SurfaceCanvas
      id={canvasId}
      fov={FOV}
      frameloop="demand"
      pointerMode="surfaces"
      style={{ position: 'absolute', inset: 0 }}
    >
      <div className="tp-stage">
        <header className="tp-caption">
          <p className="tp-caption-title">Tear-off planner</p>
          <p>Lift the bottom corner. Pull through the perforation to tear the day off.</p>
          <p className="tp-caption-engine">{engineNote(engineKind)}</p>
        </header>

        <div className="tp-pad">
          <div className="tp-board" aria-hidden="true">
            <span className="tp-hanger" />
            <span className="tp-board-year">{today.year}</span>
            <span className="tp-board-city">Day by day · {PAD_CITY.name}</span>
          </div>
          <div className="tp-binding" aria-hidden="true">
            {offset > 0 && <TornStub width={SHEET_WIDTH} />}
            {reading.holesTorn > 0 && <TornStub width={Math.min(SHEET_WIDTH, reading.holesTorn * HOLE_PITCH_PX)} />}
          </div>
          <div className="tp-block">
            <div ref={slotRef} className="tp-slot" style={{ width: SHEET_WIDTH, height: SHEET_HEIGHT }}>
              {pages.map((page) => (
                <div key={page.index} className="tp-layer" data-top={page.isTop || undefined}>
                  <SheetSurface
                    index={page.index}
                    canvasId={canvasId}
                    inScene={supported}
                    motion={motion}
                    slotRef={slotRef}
                    lastPointerRef={lastPointerRef}
                  >
                    <TearPlannerPage
                      sheet={page.sheet}
                      slots={page.slots}
                      carriedCount={page.carried}
                      onText={page.onText}
                      onToggle={page.onToggle}
                    />
                  </SheetSurface>
                </div>
              ))}
            </div>
            <div className="tp-stack-edge" style={{ height: stackEdgePx(today.daysLeft + 1) }} aria-hidden="true" />
          </div>
        </div>

        <footer className="tp-readout">
          <p className="tp-statement">
            {(torn ? tomorrow : today).weekday} · {done.done} of {done.total} done
          </p>
          <p className="tp-readout-line">{readingLine(reading, carrying, tomorrow.weekday, today.daysLeft)}</p>
          <button type="button" className="tp-tear" onClick={tearOff} disabled={reading.mode === 'fall' || reading.mode === 'auto'}>
            Tear off {today.weekday}
          </button>
        </footer>
        <FallingDropShadow canvasId={canvasId} inScene={supported} motion={motion} slotRef={slotRef} />
      </div>
    </SurfaceCanvas>
  )
}

const STUB_EDGE = (() => {
  const points = ['0 0', '100% 0']
  for (let x = SHEET_WIDTH; x >= 0; x -= 1.1) {
    const fibre = fract(Math.sin(Math.floor(x * 0.9) * 12.9898) * 43758.5453)
    points.push(`${x.toFixed(1)}px ${(3.2 + fibre * 3.6).toFixed(2)}px`)
  }
  return `polygon(${points.join(', ')})`
})()

function fract(value: number): number {
  return value - Math.floor(value)
}

function TornStub({ width }: { readonly width: number }) {
  return (
    <span className="tp-stub" style={{ width }}>
      <span style={{ clipPath: STUB_EDGE }} />
    </span>
  )
}

function stackEdgePx(sheets: number): number {
  return Math.max(1, Math.round(sheets * 0.4))
}

function readingLine(reading: SheetReading, carrying: number, nextWeekday: string, daysLeft: number): string {
  const torn = `perforation ${reading.holesTorn}/${reading.holesTotal} torn`
  if (reading.mode === 'fall') return 'torn off'
  if (reading.mode === 'drag' || reading.mode === 'auto') return `lift ${Math.round(reading.liftMm)} mm · ${torn}`
  const pad = `${carrying} carry to ${nextWeekday.slice(0, 3)} · ${daysLeft + 1} sheets on the pad`
  return reading.holesTorn > 0 ? `${pad} · ${torn}` : pad
}

function engineNote(engine: string): string {
  if (engine === 'snapdom') return 'Drawn by snapDOM: no caret on the sheet.'
  if (engine === 'none') return 'No capture engine here: the button turns the page.'
  return 'Drawn by HTML-in-canvas.'
}
