// The captured face of the control slab — live DOM, mounted as a
// `SurfaceApp`'s content by Knobs.tsx.
//
// Division of labor with the 3D hardware standing over this face: the
// DOM owns everything DOM is unbeatable at — state, focus, ARIA, crisp
// engraved text, the LED readouts, the lamp glow — and it owns the
// INPUT: every drag and click is relayed through the Surface into the
// real controls below. What the DOM no longer paints is the hardware
// itself; the knurled grips, bat levers and bezels are real geometry in
// Knobs.tsx, posed by springs that read the same live bag these
// handlers write. The wells, ticks and shadows painted here are the
// machined face those parts stand on.
//
// Every control writes straight into `knobsValues` (the GlassTweaks
// doctrine) so the art's rAF loop and the hardware springs see a turn
// the instant it happens; panel-local React state exists only so this
// captured subtree repaints its readouts and lamps.

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { PANEL_RADIUS } from './knobsGeometry'
import { KNOB_FLICK_MIN, KNOB_SPIN_MIN, stepSpin } from './knobsPhysics'
import { clickDetent, thunkToggle } from './knobsAudio'
import {
  KNOBS_LAMPS,
  KNOBS_ROTARY,
  KNOBS_TOGGLES,
  KNOB_ANGLE_MIN,
  KNOB_ANGLE_SWEEP,
  type KnobDef,
  type KnobsValues,
  type LampDef,
  type ToggleDef,
  knobAngle,
  knobsValues,
  lampLit,
  panelDrag,
  panelResize,
} from './knobsLaw'
import './knobs.css'

/** Graduation marks around a knob well, one per 27° across the sweep. */
const TICK_COUNT = 11
const TICKS = Array.from({ length: TICK_COUNT }, (_, i) => KNOB_ANGLE_MIN + (i * KNOB_ANGLE_SWEEP) / (TICK_COUNT - 1))

/** A live dial drag: which knob, and where the hand started. Held at
 *  panel scope because the MOVES arrive at panel scope — the relay
 *  dispatches each forwarded move to whatever element is under the
 *  point, so a hand that slides off the 66px dial mid-turn keeps
 *  working through the bubbled listener on the panel root. (Pointer
 *  capture is not available in here: parked matter must never hold the
 *  real pointer, so the relay refuses it — see guardPointerCapture.) */
interface DialDrag {
  def: KnobDef
  startY: number
  startValue: number
  /** Velocity bookkeeping for the flick: the un-stepped value the hand
   *  is at, when it was there, and a low-passed value-units/s estimate. */
  lastRaw: number
  lastT: number
  v: number
}

/* The rows are memoized because a dial drag steps values many times a
 * second, and every step repaints this captured subtree. The row whose
 * value moved must repaint NOW — its readout is the hand's feedback,
 * and is never deferred behind anything — but the other five rows, the
 * toggles and the lamps see identical props and skip. The panel-scope
 * callbacks staying identity-stable is what makes the skip real. */
const RotaryKnob = memo(function RotaryKnob({
  def,
  value,
  onDragStart,
  onChange,
}: {
  def: KnobDef
  value: number
  onDragStart: (drag: DialDrag) => void
  onChange: (def: KnobDef, v: number) => void
}) {
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      onDragStart({
        def,
        startY: e.clientY,
        startValue: value,
        lastRaw: value,
        lastT: performance.now() / 1000,
        v: 0,
      })
    },
    [def, value, onDragStart],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const dir =
        e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0
      if (!dir) return
      e.preventDefault()
      onChange(def, Math.min(def.max, Math.max(def.min, value + dir * def.step)))
    },
    [def, value, onChange],
  )

  return (
    <div className="knb-rotary">
      <span className="knb-dial-label">{def.label}</span>
      <SegmentReadout
        text={value.toFixed(def.step >= 1 ? 0 : 2)}
        cap={def.max.toFixed(def.step >= 1 ? 0 : 2).replace(/\d/g, '8')}
      />
      <div
        className="knb-dial"
        role="slider"
        aria-label={def.label}
        aria-valuemin={def.min}
        aria-valuemax={def.max}
        aria-valuenow={value}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        <span className="knb-dial-ticks" aria-hidden>
          {/* A notch is lit when the pointer has swept past it — the arc
            * of light IS the dial's setting, readable across a room. */}
          {TICKS.map((deg) => (
            <i
              key={deg}
              data-lit={deg <= knobAngle(def, value) + 0.25 ? '' : undefined}
              style={{ transform: `rotate(${deg}deg) translateY(-29px)` }}
            />
          ))}
        </span>
        {/* The dark pool the standing grip casts — painted contact
          * occlusion under real geometry. */}
        <span className="knb-dial-pool" aria-hidden />
      </div>
    </div>
  )
})

/**
 * A seven-segment value window with fixed digit capacity, the display
 * bench gear actually wears. Behind the live digits sits the full
 * unenergized ghost — and the ghost is the WINDOW's capacity (the
 * widest value this dial can show, every digit an 8), not the current
 * text: a dial reading 5 on a two-slot display leaves its leading slot
 * dormant, exactly like the real thing. DSEG7 draws both layers on one
 * shared segment grid, so ghost and live align segment-for-segment
 * when the window right-aligns them together (knobs.css).
 */
function SegmentReadout({ text, cap }: { text: string; cap: string }) {
  return (
    <span className="knb-dial-value">
      <i className="knb-value-ghost" aria-hidden>
        {cap}
      </i>
      <b className="knb-value-live">{text}</b>
    </span>
  )
}

const ToggleSwitch = memo(function ToggleSwitch({
  def,
  on,
  onChange,
}: {
  def: ToggleDef
  on: boolean
  onChange: (def: ToggleDef, v: boolean) => void
}) {
  return (
    <button
      type="button"
      className="knb-toggle"
      data-on={on}
      aria-pressed={on}
      // The legend is silkscreen at the foot of the cell now, outside the
      // button, so the button has to carry its own name.
      aria-label={def.label}
      onClick={() => onChange(def, !on)}
    >
      <span className="knb-toggle-well">
        <span className="knb-toggle-slot" />
      </span>
    </button>
  )
})

/**
 * A switch and the lamp that reports on it, in one cell, read top to
 * bottom: lever, lamp, legend. The panel's order of operations, in the
 * order a hand meets it — you throw the switch, the lamp under it
 * answers, and the silkscreen at the foot says which circuit that was.
 *
 * Only the lever is the button. The lamp is outside it because an
 * indicator is read, not pressed, and every press of one would otherwise
 * throw the switch. The legend is outside it because it is paint on a
 * panel, not a control — which costs the button its text, so it carries
 * an `aria-label` instead.
 *
 * The lamp is `aria-hidden`: it reports the state the button already
 * publishes as `aria-pressed`.
 */
const LAMP_BY_KEY = new Map(KNOBS_LAMPS.map((l) => [l.key, l]))

const SwitchCell = memo(function SwitchCell({
  def,
  lamp,
  on,
  lit,
  onChange,
}: {
  def: ToggleDef
  lamp: LampDef | undefined
  on: boolean
  lit: boolean
  onChange: (def: ToggleDef, v: boolean) => void
}) {
  return (
    <div className="knb-switch">
      <ToggleSwitch def={def} on={on} onChange={onChange} />
      {lamp && (
        <span className="knb-lamp" data-on={lit} data-tone={lamp.tone} aria-hidden>
          <span className="knb-lamp-bezel">
            <span className="knb-lamp-bulb" />
          </span>
        </span>
      )}
      <span className="knb-toggle-label">{def.label}</span>
    </div>
  )
})

export function KnobsPanel() {
  const [values, setValues] = useState<KnobsValues>(() => ({ ...knobsValues }))
  const dialDrag = useRef<DialDrag | null>(null)
  const spin = useRef<{ raf: number } | null>(null)

  const setKnob = useCallback(<K extends keyof KnobsValues>(key: K, v: KnobsValues[K]) => {
    if (knobsValues[key] === v) return
    knobsValues[key] = v
    // Every value change is a real mechanism moving: a graduation
    // clicking past the detent, or a bat lever landing.
    if (typeof v === 'boolean') thunkToggle()
    else clickDetent()
    setValues((prev) => ({ ...prev, [key]: v }))
  }, [])

  const stopSpin = useCallback(() => {
    if (spin.current) {
      cancelAnimationFrame(spin.current.raf)
      spin.current = null
    }
  }, [])
  useEffect(() => stopSpin, [stopSpin])

  /** The flick's tail: the bearing carries the grip on after the hand
   *  lets go — velocity draining through `stepSpin` (pinned law), the
   *  value riding the spin, the end stops stopping it dead. This loop
   *  animates STATE, not style: each crossing repaints exactly like a
   *  hand turn would, and the loop stops scheduling once the spin dies,
   *  so a resting panel is still idle-zero. */
  const startSpin = useCallback(
    (def: KnobDef, from: number, v: number) => {
      stopSpin()
      const state = { v }
      const range = def.max - def.min
      let pos = from
      let last = performance.now()
      const handle = { raf: 0 }
      spin.current = handle
      const tick = (now: number) => {
        if (spin.current !== handle) return
        pos += stepSpin(state, (now - last) / 1000)
        last = now
        if (pos <= def.min || pos >= def.max) {
          pos = Math.min(def.max, Math.max(def.min, pos))
          state.v = 0
        }
        const stepped = Math.round(pos / def.step) * def.step
        setKnob(def.key, Math.min(def.max, Math.max(def.min, stepped)))
        if (Math.abs(state.v) / range < KNOB_SPIN_MIN) {
          spin.current = null
          return
        }
        handle.raf = requestAnimationFrame(tick)
      }
      handle.raf = requestAnimationFrame(tick)
    },
    [setKnob, stopSpin],
  )

  // The identity-stable pair the memoized rows depend on: these never
  // change across renders, so a step on one dial cannot re-render the
  // other five rows through fresh callback props.
  const onKnobDragStart = useCallback(
    (d: DialDrag) => {
      // A hand on the grip catches a spinning knob.
      stopSpin()
      dialDrag.current = d
    },
    [stopSpin],
  )
  const onKnobChange = useCallback(
    (def: KnobDef, v: number) => {
      stopSpin()
      setKnob(def.key, v)
    },
    [setKnob, stopSpin],
  )
  const onToggleChange = useCallback(
    (def: ToggleDef, v: boolean) => setKnob(def.key, v),
    [setKnob],
  )

  /** A release — heard (pointerup) or inferred (a buttonless move).
   *  Fast enough, and the hand's last velocity becomes a free spin. */
  const endDialDrag = useCallback(() => {
    const d = dialDrag.current
    dialDrag.current = null
    if (!d) return
    if (Math.abs(d.v) >= KNOB_FLICK_MIN * (d.def.max - d.def.min)) {
      startSpin(d.def, knobsValues[d.def.key], d.v)
    }
  }, [startSpin])

  // Dial drags resolve here, at the root, where every forwarded move
  // bubbles to regardless of which element it landed on. A move with no
  // button held is the release we never heard (the hand let go off-panel).
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dialDrag.current
      if (!d) return
      if (e.buttons === 0) {
        endDialDrag()
        return
      }
      const range = d.def.max - d.def.min
      const raw = d.startValue + ((d.startY - e.clientY) / 140) * range
      const now = performance.now() / 1000
      const dt = now - d.lastT
      if (dt > 0.005) {
        // Low-passed hand speed in value-units/s, from the un-stepped
        // value — the flick must not quantize to zero on a coarse dial.
        d.v = d.v * 0.6 + ((raw - d.lastRaw) / dt) * 0.4
        d.lastRaw = raw
        d.lastT = now
      }
      const stepped = Math.round(raw / d.def.step) * d.def.step
      setKnob(d.def.key, Math.min(d.def.max, Math.max(d.def.min, stepped)))
    },
    [setKnob, endDialDrag],
  )

  return (
    /* borderRadius inline from the same constant the rim mesh extrudes —
     * Surface's radius:'auto' reads it off this computed style, so the
     * DOM stays the one place the corner is authored.
     *
     * NEITHER dimension is a prop. The width arrives as `--knb-w`, a
     * custom property the scene writes on the host element, because a
     * prop would have to travel React → the Surface's OWN root →
     * commit → layout before it reached this box, and a hand dragging
     * a corner outruns that every frame. A custom property is one
     * style write, and the reflow is the next thing the browser does.
     * The height then falls out of the arrangement: the panel is a
     * container query container (knobs.css), so its rows choose their
     * own layout from whatever width they were handed. The scene
     * measures the result and sizes the slab, the capture and the rim
     * to it — the DOM stays the retained model, including for how tall
     * the aluminum is. */
    <div
      className="knb-panel"
      style={{ borderRadius: PANEL_RADIUS }}
      onPointerMove={onPointerMove}
      onPointerUp={endDialDrag}
      onPointerCancel={endDialDrag}
    >
      <span className="knb-screw" data-corner="tl" aria-hidden />
      <span className="knb-screw" data-corner="tr" aria-hidden />
      <span className="knb-screw" data-corner="bl" aria-hidden />
      <span className="knb-screw" data-corner="br" aria-hidden />

      {/* The carry handle. Its forwarded pointerdown only ARMS the
        * gesture — the scene moves the slab from the real screen
        * pointer, because these coordinates live on the very panel the
        * gesture displaces. */}
      <div
        className="knb-handle"
        aria-label="drag to move panel"
        onPointerDown={(event) => {
          panelDrag.active = true
          panelDrag.pointerId = event.pointerId
        }}
      >
        <span className="knb-handle-grip" aria-hidden />
      </div>

      {/* The corner grip. Same split as the carry handle: this only ARMS
        * the gesture and records where it started, because these
        * coordinates live on the panel the gesture is about to resize.
        * The scene reads the real screen pointer from here on. */}
      <div
        className="knb-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="drag to resize panel"
        onPointerDown={(e) => {
          panelResize.active = true
          panelResize.pointerId = e.pointerId
          // The width the drag starts from is read off the panel, not
          // held in React. Nothing about this gesture goes through a
          // render, which is the point.
          const root = (e.currentTarget as HTMLElement).parentElement
          panelResize.startW = Math.round(root?.getBoundingClientRect().width ?? 0)
          // Not e.clientX: a forwarded coordinate lives on the panel,
          // and this grip is about to move. The scene seeds the origin
          // from the first REAL pointer move instead.
          panelResize.startX = Number.NaN
        }}
      >
        <span className="knb-resize-grip" aria-hidden />
      </div>

      <div className="knb-panel-head">
        <span className="knb-panel-title">svg control board</span>
        <span className="knb-panel-badge">pp-01</span>
      </div>

      <div className="knb-group">
        {KNOBS_ROTARY.map((def) => (
          <RotaryKnob
            key={def.key}
            def={def}
            value={values[def.key]}
            onDragStart={onKnobDragStart}
            onChange={onKnobChange}
          />
        ))}
      </div>

      {/* Switches and their annunciators, one cell each. The lamps used
        * to be a separate row across the panel's foot, which put
        * "mirror" the light a full arrangement away from "mirror" the
        * switch and printed the word twice. */}
      <div className="knb-toggles">
        {KNOBS_TOGGLES.map((def) => {
          const lamp = LAMP_BY_KEY.get(def.key)
          return (
            <SwitchCell
              key={def.key}
              def={def}
              lamp={lamp}
              on={values[def.key]}
              // The switch's position and the lamp's verdict are two
              // different questions that happen to share an answer
              // today. `lampLit` stays the only thing that decides the
              // second one, so the captured bulb and the emissive die
              // standing over it cannot drift apart.
              lit={lamp ? lampLit(lamp, values) : false}
              onChange={onToggleChange}
            />
          )
        })}
      </div>
    </div>
  )
}
