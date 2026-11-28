// Sheet motion — the top sheet's state from frame to frame: resting,
// lifted under the hand, settling back, torn by the Tear off button, or
// falling once the perforation has let go.
//
// One mutable object, stepped once per rendered frame by whichever sheet
// rig draws first, so both rigs read the same fold in the same frame: the
// sheet on top deforms by it and the sheet beneath shades by it.
import { HOLE_PITCH_PX, foldPoint, solveFold, type Fold } from './tearPlannerFoldLaw'

export type SheetMode = 'rest' | 'hover' | 'drag' | 'settle' | 'auto' | 'fall'

interface Vec { x: number; y: number }

export interface SheetFall {
  x: number
  y: number
  vx: number
  vy: number
  spin: number
  vspin: number
  age: number
}

export interface SheetReading {
  readonly mode: SheetMode
  /** Distance from the grabbed point to the hand, in mm at 4 px per mm. */
  readonly liftMm: number
  readonly holesTorn: number
  readonly holesTotal: number
}

/**
 * Where the Tear off button's hand ends, as fractions of the sheet: up and
 * to the left, far enough to tear the whole perforation while the sheet
 * stays below the top of a 900 px viewport.
 */
const AUTO_HAND_END = { x: -0.5, y: -0.2 }
/** How long the Tear off button's hand takes to pull the corner up past the binding. */
const AUTO_TEAR_MS = 1150
/** Gravity on a falling sheet, in px/s². */
const FALL_GRAVITY = 2600
/**
 * A sheet's fall speed through air, in px/s. Paper this light reaches it
 * within a few tenths of a second, so it drifts down instead of dropping.
 */
const FALL_TERMINAL = 1100
/** Fall speed a sheet keeps from the hand, as a fraction of the hand's speed. */
const FALL_KEEPS_HAND = 0.35
/** How far a falling sheet rocks either side, in radians (about 20°), and how fast. */
const FALL_SWAY = { angle: 0.35, rate: 4.2 }
const SPRINGS = {
  hover: { stiffness: 260, damping: 0.8 },
  settle: { stiffness: 340, damping: 0.5 },
  fall: { stiffness: 30, damping: 0.9 },
}

/** The resting corner lifts this far toward the hand when the pointer is over it, in px. */
const HOVER_LIFT = { x: -18, y: -16 }
/** The lifting corner: page points this close to the bottom-right corner, in px. Matches .tp-grip. */
export const GRAB_RADIUS = 84

export interface SheetState {
  readonly width: number
  readonly height: number
  mode: SheetMode
  /** Which of the two live pages is on top. */
  topIndex: 0 | 1
  /** The page point the hand holds. */
  grab: Vec
  hand: Vec
  /** Where the held point is drawn: the hand, followed with a short lag. */
  shown: Vec
  shownVel: Vec
  handVel: Vec
  tearFront: number
  fold: Fold | null
  tension: number
  fall: SheetFall | null
  stageHeight: number
  clock: number
  autoStart: number
  lastTime: number
  timeScale: number
  version: number
  onFallen: (() => void) | null
  onReading: ((reading: SheetReading) => void) | null
  wake: (() => void) | null
  view: { cx: number; cy: number; distance: number }
  lastReading: string
  reducedMotion: boolean
}

export function createSheetMotion(width: number, height: number) {
  const corner: Vec = { x: width - 2, y: height - 2 }
  const holesTotal = Math.floor(width / HOLE_PITCH_PX)
  const m: SheetState = {
    width,
    height,
    mode: 'rest',
    topIndex: 0,
    grab: { ...corner },
    hand: { ...corner },
    shown: { ...corner },
    shownVel: { x: 0, y: 0 },
    handVel: { x: 0, y: 0 },
    tearFront: width,
    fold: null,
    tension: 0,
    fall: null,
    stageHeight: 900,
    /** Motion time, in seconds: frame time scaled by `timeScale`. */
    clock: 0,
    /** Clock reading when the Tear off button started; -1 until the next frame reads it. */
    autoStart: -1,
    lastTime: -1,
    /** Slows every motion for frame captures (`?slowmo=N` gives 1 / N). */
    timeScale: 1,
    version: 0,
    onFallen: null,
    onReading: null,
    wake: null,
    /** The camera, in page px: the screen centre and the eye's distance from the page. */
    view: { cx: width / 2, cy: height / 2, distance: 1600 },
    lastReading: '',
    reducedMotion: false,
  }

  const atRest = () => {
    m.mode = 'rest'
    m.shown = { ...m.grab }
    m.hand = { ...m.grab }
    m.shownVel = { x: 0, y: 0 }
  }

  function read() {
    const reading: SheetReading = {
      mode: m.mode,
      liftMm: Math.hypot(m.shown.x - m.grab.x, m.shown.y - m.grab.y) / 4,
      holesTorn: Math.round((width - m.tearFront) / HOLE_PITCH_PX),
      holesTotal,
    }
    const key = `${reading.mode}|${Math.round(reading.liftMm)}|${reading.holesTorn}`
    if (key !== m.lastReading) {
      m.lastReading = key
      m.onReading?.(reading)
    }
  }

  function startFall() {
    m.mode = 'fall'
    m.shownVel = { x: 0, y: 0 }
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
    m.fall = {
      x: 0,
      y: 0,
      // A flick upward lifts the sheet only a little: it is torn free, not thrown.
      vx: clamp(m.handVel.x * FALL_KEEPS_HAND, -420, 420),
      vy: clamp(m.handVel.y * FALL_KEEPS_HAND, -200, 300),
      spin: 0,
      vspin: m.handVel.x < 0 ? -1 : 1,
      age: 0,
    }
  }

  /** Steps a falling sheet; swaps the pages once it is off the stage. */
  function stepFall(f: SheetFall, dt: number): boolean {
    f.age += dt
    // Gravity against air drag, which sets the terminal speed.
    f.vy += FALL_GRAVITY * (1 - f.vy / FALL_TERMINAL) * dt
    // The sheet rocks as it falls, and each rock carries it sideways.
    const rock = FALL_SWAY.angle * Math.sin(f.age * FALL_SWAY.rate) * Math.min(1, f.age * 2)
    f.vx = f.vx * Math.exp(-2.2 * dt) + rock * 520 * dt
    f.x += f.vx * dt
    f.y += f.vy * dt
    f.spin = f.vspin * rock
    // Free of the binding and the hand, the curl springs flat.
    follow(m.grab, dt)
    const flat = solveFold(m.grab.x, m.grab.y, m.shown.x, m.shown.y, 0, m, false)
    m.fold = flat.fold
    m.version++
    const gone = f.y > m.stageHeight + 160 || f.age > 2.4
    if (gone) {
      m.topIndex = m.topIndex === 0 ? 1 : 0
      m.fold = null
      m.fall = null
      m.tearFront = width
      m.grab = { ...corner }
      atRest()
    }
    read()
    if (gone) m.onFallen?.()
    return !gone
  }

  /** Where the held point is heading this frame. */
  function targetFor(mode: SheetMode): Vec {
    if (mode === 'auto') {
      if (m.autoStart < 0) m.autoStart = m.clock
      const t = Math.min(1, ((m.clock - m.autoStart) * 1000) / AUTO_TEAR_MS)
      const ease = t * t * (3 - 2 * t)
      m.hand = {
        x: corner.x + (AUTO_HAND_END.x * width - corner.x) * ease,
        y: corner.y + (AUTO_HAND_END.y * height - corner.y) * Math.pow(ease, 0.8),
      }
      return m.hand
    }
    if (mode === 'hover') return { x: m.grab.x + HOVER_LIFT.x, y: m.grab.y + HOVER_LIFT.y }
    if (mode === 'settle') return m.grab
    return m.hand
  }

  /** Moves the drawn point toward `target`: a hand leads directly, paper springs back. */
  function follow(target: Vec, dt: number) {
    const prev = { ...m.shown }
    if (m.mode === 'drag' || m.mode === 'auto' || m.reducedMotion) {
      const k = m.reducedMotion ? 1 : 1 - Math.exp(-dt * 30)
      m.shown = { x: m.shown.x + (target.x - m.shown.x) * k, y: m.shown.y + (target.y - m.shown.y) * k }
    } else {
      // A damped spring with a little overshoot: paper settles, it does not snap.
      // A falling sheet has nothing to press it flat, so it unrolls slowly.
      const spring = SPRINGS[m.mode === 'hover' || m.mode === 'fall' ? m.mode : 'settle']
      const stiffness = spring.stiffness
      const damping = 2 * spring.damping * Math.sqrt(stiffness)
      m.shownVel.x += ((target.x - m.shown.x) * stiffness - m.shownVel.x * damping) * dt
      m.shownVel.y += ((target.y - m.shown.y) * stiffness - m.shownVel.y * damping) * dt
      m.shown = { x: m.shown.x + m.shownVel.x * dt, y: m.shown.y + m.shownVel.y * dt }
    }
    const vx = (m.shown.x - prev.x) / Math.max(dt, 1e-3)
    const vy = (m.shown.y - prev.y) / Math.max(dt, 1e-3)
    m.handVel = { x: m.handVel.x * 0.6 + vx * 0.4, y: m.handVel.y * 0.6 + vy * 0.4 }
  }

  /** Solves the roll so the held point, seen in perspective, lands under the drawn point. */
  function solve() {
    const pulling = m.mode === 'drag' || m.mode === 'auto'
    let aim = { ...m.shown }
    let solved = solveFold(m.grab.x, m.grab.y, aim.x, aim.y, m.tearFront, m, pulling)
    for (let i = 0; i < 3 && solved.fold; i++) {
      const p = foldPoint(m.grab.x, m.grab.y, solved.fold)
      const scale = m.view.distance / Math.max(1, m.view.distance - (p.z ?? 0))
      const seenX = m.view.cx + (p.x - m.view.cx) * scale
      const seenY = m.view.cy + (p.y - m.view.cy) * scale
      aim = { x: aim.x + (m.shown.x - seenX) * 0.8, y: aim.y + (m.shown.y - seenY) * 0.8 }
      solved = solveFold(m.grab.x, m.grab.y, aim.x, aim.y, m.tearFront, m, pulling)
    }
    m.fold = solved.fold
    m.tension = solved.tension
    m.tearFront = solved.tearFront
    m.version++
  }

  /** Steps the sheet to `time` (seconds). Returns whether it is still moving. */
  function advance(time: number): boolean {
    if (time === m.lastTime) return m.mode !== 'rest'
    const dt = (m.lastTime < 0 ? 1 / 60 : Math.min(1 / 30, Math.max(0, time - m.lastTime))) * m.timeScale
    m.lastTime = time
    m.clock += dt
    if (m.mode === 'rest') {
      read()
      return false
    }
    if (m.fall) return stepFall(m.fall, dt)

    follow(targetFor(m.mode), dt)
    solve()

    let settled = false
    if (m.tearFront <= 0) {
      startFall()
    } else if (m.mode === 'settle') {
      settled = Math.hypot(m.shown.x - m.grab.x, m.shown.y - m.grab.y) < 0.4 && Math.hypot(m.shownVel.x, m.shownVel.y) < 6
      if (settled) {
        atRest()
        m.fold = null
      }
    }
    read()
    return !settled
  }

  return {
    state: m,
    advance,
    /** Is this page point on the part of the sheet a hand would lift? */
    inGrabZone(x: number, y: number): boolean {
      return Math.hypot(width - x, height - y) < GRAB_RADIUS || y > height - 40
    },
    hover(on: boolean) {
      if (m.mode === 'rest' && on) {
        m.grab = { ...corner }
        m.mode = 'hover'
      } else if (m.mode === 'hover' && !on) {
        m.mode = 'settle'
      }
    },
    grabAt(gx: number, gy: number, hx: number, hy: number) {
      if (m.mode === 'fall' || m.mode === 'auto') return
      if (m.mode === 'rest' || m.mode === 'hover') {
        m.grab = { x: gx, y: gy }
        if (m.mode === 'rest') m.shown = { x: gx, y: gy }
      }
      m.hand = { x: hx, y: hy }
      m.shownVel = { x: 0, y: 0 }
      m.mode = 'drag'
    },
    moveHand(hx: number, hy: number) {
      if (m.mode === 'drag') m.hand = { x: hx, y: hy }
    },
    release() {
      if (m.mode === 'drag') {
        m.shownVel = { x: 0, y: 0 }
        m.mode = 'settle'
      }
    },
    tearOff() {
      if (m.mode === 'fall' || m.mode === 'auto') return
      m.grab = { ...corner }
      m.shown = { ...corner }
      m.autoStart = -1
      m.mode = 'auto'
    },
  }
}

export type SheetMotion = ReturnType<typeof createSheetMotion>
