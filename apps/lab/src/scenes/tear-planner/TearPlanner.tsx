// Tear-off planner — a day planner you close by tearing off the page.
//
// Today's sheet and tomorrow's are two live Surfaces on one canvas, today
// on top. Pulling the bottom corner folds today's sheet by
// tearPlannerFoldLaw, with its checkboxes and fields still answering on the
// curled paper, and tomorrow shows beneath, already live, with today's
// unfinished tasks on the same ruled lines. Let go and the sheet settles
// back; pull past the perforation and it tears at the speed of the hand,
// then falls. The fallen sheet's Surface goes back under the pad as the
// day after tomorrow, so two Surfaces serve every day.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import {
  Surface,
  SurfaceCanvas,
  deformSurfaceGeometry,
  useSurfaceHandle,
  useSurfaceNodes,
  useSurfaceRefresh,
  useSurfaceStatus,
  useSurfaceSupport,
  type SurfaceHandle,
} from '@petepetrash/munari'
import { cameraDistance } from '@petepetrash/munari/advanced'
import { foldPoint } from './tearPlannerFoldLaw'
import { HOLE_PITCH_PX, createSheetMaterial, createSheetUniforms, type SheetUniforms } from './tearPlannerNodes'
import { createSheetMotion, type SheetMotion, type SheetReading } from './tearPlannerMotion'
import { PAD_CITY, sheetFor } from './tearPlannerAlmanac'
import { EMPTY_SLOTS, SEED, carryInto, countDone, writeOnBlankLine, type Days, type Slots, type Task } from './tearPlannerTasks'
import { SHEET_HEIGHT, SHEET_WIDTH, TearPlannerPage } from './TearPlannerPage'
import './tearPlanner.css'

const FOV = 30
/** The sheet beneath sits this far behind the top one, in px: enough for depth, too little to change its size. */
const UNDER_Z = -2

// ── canvas furniture ─────

function PlannerCamera() {
  // SAFETY: SurfaceCanvas creates a PerspectiveCamera unless `orthographic` is set.
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    if (size.height <= 0) return
    camera.fov = FOV
    camera.position.set(0, 0, cameraDistance(size.height, FOV))
    camera.near = 20
    camera.far = camera.position.z * 4
    camera.updateProjectionMatrix()
    invalidate()
  }, [camera, size.height, size.width, invalidate])
  return null
}

/** A press on the canvas would move focus to <body> and blur the field a Surface just focused. */
function KeepDomFocus() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    const keep = (event: MouseEvent) => event.preventDefault()
    el.addEventListener('mousedown', keep)
    return () => el.removeEventListener('mousedown', keep)
  }, [gl])
  return null
}

function SheetMaterial({ uniforms }: { readonly uniforms: SheetUniforms }) {
  const surface = useSurfaceNodes()
  const material = useMemo(() => createSheetMaterial(surface, uniforms), [surface, uniforms])
  useEffect(() => () => material.dispose(), [material])
  return <primitive object={material} attach="material" />
}

function handFromClient(slot: HTMLElement | null, clientX: number, clientY: number) {
  const rect = slot?.getBoundingClientRect()
  return rect ? { x: clientX - rect.left, y: clientY - rect.top } : null
}

// ── one sheet ─────

function SheetRig({ index, motion, slotRef }: { readonly index: 0 | 1; readonly motion: SheetMotion; readonly slotRef: RefObject<HTMLDivElement | null> }) {
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  const groupRef = useRef<THREE.Group>(null)
  const geoRef = useRef<THREE.PlaneGeometry>(null)
  const uniforms = useMemo(createSheetUniforms, [])
  const drawn = useRef({ version: -1, top: false })

  useEffect(() => {
    uniforms.size.value.set(SHEET_WIDTH, SHEET_HEIGHT)
    uniforms.tearFront.value = SHEET_WIDTH
    motion.state.wake = invalidate
  }, [uniforms, motion, invalidate])

  useFrame((frame) => {
    const moving = motion.advance(frame.clock.elapsedTime)
    const m = motion.state
    const group = groupRef.current
    const geo = geoRef.current
    const slot = slotRef.current
    if (!group || !geo || !slot) return
    const top = m.topIndex === index
    const s = slot.getBoundingClientRect()
    const c = gl.domElement.getBoundingClientRect()
    m.stageHeight = c.height
    m.view = { cx: c.left + c.width / 2 - s.left, cy: c.top + c.height / 2 - s.top, distance: frame.camera.position.z }
    group.position.set(
      s.left - c.left + SHEET_WIDTH / 2 - c.width / 2,
      c.height / 2 - (s.top - c.top + SHEET_HEIGHT / 2),
      top ? 0 : UNDER_Z,
    )
    group.rotation.set(0, 0, 0)
    const fall = top ? m.fall : null
    if (fall) {
      group.position.x += fall.x
      group.position.y -= fall.y
      // Held in front of the next page: a tilt toward the wall would push its
      // top edge behind the sheet now on top.
      group.position.z += 24
      group.rotation.z = fall.spin
    }
    if (drawn.current.version !== m.version || drawn.current.top !== top) {
      drawn.current = { version: m.version, top }
      const fold = top ? m.fold : null
      deformSurfaceGeometry(geo, [SHEET_WIDTH, SHEET_HEIGHT], (x, y) => foldPoint(x, y, fold))
      if (fold) uniforms.fold.value.set(fold.nx, fold.ny, fold.s0, fold.r)
      uniforms.foldOn.value = fold ? 1 : 0
      uniforms.tearFront.value = top ? m.tearFront : SHEET_WIDTH
      const over = top ? null : m.fold
      if (over) uniforms.over.value.set(over.nx, over.ny, over.s0, over.r)
      uniforms.overOn.value = over && !m.fall ? 1 : 0
    }
    if (moving) invalidate()
  })

  const pagePoint = (event: ThreeEvent<PointerEvent>) =>
    event.uv ? { x: event.uv.x * SHEET_WIDTH, y: (1 - event.uv.y) * SHEET_HEIGHT } : null

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (motion.state.topIndex !== index || event.nativeEvent.button !== 0) return
    const at = pagePoint(event)
    const hand = handFromClient(slotRef.current, event.nativeEvent.clientX, event.nativeEvent.clientY)
    if (!at || !hand || !motion.inGrabZone(at.x, at.y)) return
    motion.grabAt(at.x, at.y, hand.x, hand.y)
    invalidate()
  }

  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (motion.state.topIndex !== index) return
    const at = pagePoint(event)
    motion.hover(at !== null && motion.inGrabZone(at.x, at.y))
    invalidate()
  }

  const onPointerOut = () => {
    if (motion.state.topIndex !== index) return
    motion.hover(false)
    invalidate()
  }

  return (
    <group ref={groupRef}>
      <Surface.Mesh
        placement="manual"
        pointerRoute="relay"
        alpha="opaque"
        geometry={<planeGeometry ref={geoRef} args={[1, 1, 70, 99]} />}
        material={<SheetMaterial uniforms={uniforms} />}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerOut={onPointerOut}
      />
    </group>
  )
}

// ── the pad ─────


let taskSeq = 100

function writeSlot(slots: Slots, slot: number, change: (task: Task | null) => Task | null): Slots {
  return slots.map((task, i) => (i === slot ? change(task) : task))
}

function updateTask(days: Days, id: string, change: (task: Task) => Task) {
  return Object.fromEntries(
    Object.entries(days).map(([key, slots]) => [key, slots.map((task) => (task && task.id === id ? change(task) : task))]),
  )
}

export function TearPlannerApp() {
  const supported = useSurfaceSupport()
  const canvasId = useId()
  const handles = [useSurfaceHandle('tear-sheet-a'), useSurfaceHandle('tear-sheet-b')] as const
  const slotRef = useRef<HTMLDivElement>(null)
  const motion = useMemo(() => createSheetMotion(SHEET_WIDTH, SHEET_HEIGHT), [])
  const [offset, setOffset] = useState(0)
  const [topIndex, setTopIndex] = useState<0 | 1>(0)
  const [days, setDays] = useState<Days>(SEED)
  const [reading, setReading] = useState<SheetReading>({ mode: 'rest', liftMm: 0, holesTorn: 0, holesTotal: Math.floor(SHEET_WIDTH / 6) })

  const today = sheetFor(offset)
  const tomorrow = sheetFor(offset + 1)
  const todaySlots = days[offset] ?? EMPTY_SLOTS
  const tomorrowSlots = useMemo(
    () => carryInto(todaySlots, days[offset + 1] ?? EMPTY_SLOTS, today.weekday),
    [todaySlots, days, offset, today.weekday],
  )
  const todayIds = useMemo(() => new Set(todaySlots.filter((t): t is Task => t !== null).map((t) => t.id)), [todaySlots])

  // The fallen sheet's Surface is now beneath: commit the carried list and move the pad on a day.
  const latest = useRef({ offset, tomorrowSlots })
  latest.current = { offset, tomorrowSlots }
  useEffect(() => {
    motion.state.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const slowmo = Number(new URLSearchParams(window.location.search).get('slowmo'))
    if (slowmo > 1) motion.state.timeScale = 1 / slowmo
    motion.state.onReading = setReading
    motion.state.onFallen = () => {
      const { offset: was, tomorrowSlots: carried } = latest.current
      setDays((current) => ({ ...current, [was + 1]: carried }))
      setOffset(was + 1)
      setTopIndex(motion.state.topIndex)
    }
    return () => {
      motion.state.onFallen = null
      motion.state.onReading = null
    }
  }, [motion])

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!event.isTrusted || motion.state.mode !== 'drag') return
      const hand = handFromClient(slotRef.current, event.clientX, event.clientY)
      if (hand) motion.moveHand(hand.x, hand.y)
      motion.state.wake?.()
    }
    const up = (event: PointerEvent) => {
      if (!event.isTrusted) return
      motion.release()
      motion.state.wake?.()
    }
    // Capture phase: the canvas's pointer gate stops these events at the canvas.
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
    }
  }, [motion])

  const editToday = useCallback((slot: number, text: string) => {
    setDays((current) => ({
      ...current,
      [offset]: writeSlot(current[offset] ?? EMPTY_SLOTS, slot, (task) => (task ? { ...task, text } : { id: `t${taskSeq++}`, text, done: false })),
    }))
  }, [offset])
  const toggleToday = useCallback((slot: number) => {
    setDays((current) => ({
      ...current,
      [offset]: writeSlot(current[offset] ?? EMPTY_SLOTS, slot, (task) => (task ? { ...task, done: !task.done } : task)),
    }))
  }, [offset])
  // Tomorrow's lines are derived: a carried line is today's task, so editing it there edits it today.
  const editTomorrow = useCallback((slot: number, text: string) => {
    const shown = tomorrowSlots[slot]
    if (shown) {
      setDays((current) => updateTask(current, shown.id, (task) => ({ ...task, text })))
      return
    }
    setDays((current) => ({
      ...current,
      [offset + 1]: writeOnBlankLine(current[offset + 1] ?? EMPTY_SLOTS, { id: `t${taskSeq++}`, text, done: false }),
    }))
  }, [tomorrowSlots, offset])
  const toggleTomorrow = useCallback((slot: number) => {
    const shown = tomorrowSlots[slot]
    if (!shown) return
    setDays((current) => updateTask(current, shown.id, (task) => ({ ...task, done: !task.done })))
  }, [tomorrowSlots])

  const tearOff = () => {
    if (!supported) {
      latest.current.tomorrowSlots = tomorrowSlots
      setDays((current) => ({ ...current, [offset + 1]: tomorrowSlots }))
      setOffset(offset + 1)
      setTopIndex(topIndex === 0 ? 1 : 0)
      return
    }
    motion.tearOff()
    motion.state.wake?.()
  }

  const pages = [0, 1].map((index) => {
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

  const done = countDone(todaySlots)
  const carrying = tomorrowSlots.filter((t) => t && todayIds.has(t.id)).length
  const status = useSurfaceStatus(handles[0])
  const engine = status.engine === null ? 'none' : status.engine

  return (
    <div className="tp-stage">
      <header className="tp-caption">
        <p className="tp-caption-title">Tear-off planner</p>
        <p>Lift the bottom corner. Let go and it falls back; pull through the perforation to tear the day off.</p>
        <p className="tp-caption-engine">{engineNote(supported ? engine : 'none')}</p>
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
                  handle={handles[page.index]}
                  canvasId={canvasId}
                  inScene={supported}
                  refreshKey={JSON.stringify([page.sheet.time, page.slots])}
                >
                  <TearPlannerPage sheet={page.sheet} slots={page.slots} carriedCount={page.carried} onText={page.onText} onToggle={page.onToggle} />
                </SheetSurface>
              </div>
            ))}
          </div>
          <div className="tp-stack-edge" style={{ height: stackEdgePx(today.daysLeft + 1) }} aria-hidden="true" />
        </div>
      </div>

      <footer className="tp-readout">
        <p className="tp-statement">
          {today.weekday} · {done.done} of {done.total} done
        </p>
        <p className="tp-readout-line">
          {readingLine(reading, carrying, tomorrow.weekday, today.daysLeft)}
        </p>
        <button type="button" className="tp-tear" onClick={tearOff} disabled={reading.mode === 'fall' || reading.mode === 'auto'}>
          Tear off {today.weekday}
        </button>
      </footer>

      {supported && (
        <SurfaceCanvas
          id={canvasId}
          className="tp-canvas"
          pointerMode="surfaces"
          frameloop="demand"
          gl={{ alpha: true }}
          onCreated={(state) => state.gl.setClearAlpha(0)}
        >
          <PlannerCamera />
          <KeepDomFocus />
          {([0, 1] as const).map((index) => (
            <Surface.Scene key={index} surface={handles[index]}>
              <SheetRig index={index} motion={motion} slotRef={slotRef} />
            </Surface.Scene>
          ))}
        </SurfaceCanvas>
      )}
    </div>
  )
}

/**
 * The torn edge left on the binding, from the right end leftward. Its
 * profile uses the same fibre noise as the sheet's torn edge in
 * tearPlannerNodes, so the two edges match.
 */
const STUB_EDGE = (() => {
  const points = ['0 0', '100% 0']
  for (let x = SHEET_WIDTH; x >= 0; x -= 1.1) {
    const fibre = fract(Math.sin(Math.floor(x * 0.9) * 12.9898) * 43758.5453)
    points.push(`${x.toFixed(1)}px ${(3.6 + fibre * 2.8).toFixed(2)}px`)
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

/** The pad's visible bottom edge: 0.1 mm of paper per sheet at 4 px per mm, never under 1 px. */
function stackEdgePx(sheets: number): number {
  return Math.max(1, Math.round(sheets * 0.4))
}

/** One line: the sheet's lift and perforation while a hand is on it, the pad's state otherwise. */
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

/** One sheet's Surface, refreshed when its content changes from outside it (a carried task, a new day). */
function SheetSurface({ handle, canvasId, inScene, refreshKey, children }: {
  readonly handle: SurfaceHandle
  readonly canvasId: string
  readonly inScene: boolean
  readonly refreshKey: string
  readonly children: React.ReactNode
}) {
  const refresh = useSurfaceRefresh(handle)
  useEffect(() => {
    refresh()
  }, [refresh, refreshKey])
  return (
    <Surface.Root surface={handle} canvasId={canvasId} inScene={inScene}>
      <Surface.HTML size={[SHEET_WIDTH, SHEET_HEIGHT]}>{children}</Surface.HTML>
    </Surface.Root>
  )
}
