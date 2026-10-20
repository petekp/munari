// Site controls — checkbox, radio, toggle, slider and dial over system.css.
// Each is controlled: the caller owns the value and hears every change.
// A value is printed with its unit, and the slider and dial show it against
// a ruler (the style guide's Principles).

import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { pointerAttrs, type PointerState } from './pointerState'

export const CHECK_MARK = <svg viewBox="0 0 12 12" aria-hidden><path d="M2.5 6.2 5 8.6l4.6-5.2" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>

interface CheckProps {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (next: boolean) => void
  readonly disabled?: boolean
  readonly pointerState?: PointerState
}

export function Check({ label, checked, onChange, disabled = false, pointerState }: CheckProps) {
  return (
    <label className="m-check" {...pointerAttrs(pointerState)}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="m-check-box">{CHECK_MARK}</span>
      {label}
    </label>
  )
}

interface RadioProps {
  readonly label: string
  readonly name: string
  readonly checked: boolean
  readonly onSelect: () => void
  readonly disabled?: boolean
}

export function Radio({ label, name, checked, onSelect, disabled = false }: RadioProps) {
  return (
    <label className="m-check m-check--radio">
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onSelect} />
      <span className="m-check-box" />
      {label}
    </label>
  )
}

interface ToggleProps {
  /** A noun for what the toggle switches; the state word sits beside it. */
  readonly label: string
  readonly checked: boolean
  readonly onChange: (next: boolean) => void
  readonly disabled?: boolean
}

export function Toggle({ label, checked, onChange, disabled = false }: ToggleProps) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="m-toggle" disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="m-toggle-track" aria-hidden />
      {label}
      <span className="m-toggle-state m-readout">{checked ? 'On' : 'Off'}</span>
    </button>
  )
}

/** +1 or -1 for an arrow key, 0 for anything else. */
function arrowDirection(key: string): number {
  if (key === 'ArrowRight' || key === 'ArrowUp') return 1
  if (key === 'ArrowLeft' || key === 'ArrowDown') return -1
  return 0
}

// Shift moves this many steps at once, on the slider and the dial alike.
const SHIFT_STEPS = 10

function decimalsOf(step: number): number {
  return step.toString().split('.')[1]?.length ?? 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

type SliderStyle = CSSProperties & { '--m-value': string }

interface SliderProps {
  readonly label: string
  readonly value: number
  readonly onChange: (next: number) => void
  readonly min: number
  readonly max: number
  readonly step?: number
  readonly unit?: string
  readonly disabled?: boolean
}

export function Slider({ label, value, onChange, min, max, step = 1, unit, disabled = false }: SliderProps) {
  const decimals = decimalsOf(step)
  const style: SliderStyle = { '--m-value': `${((value - min) / (max - min)) * 100}%` }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const direction = arrowDirection(event.key)
    if (!event.shiftKey || direction === 0) return
    event.preventDefault()
    onChange(clamp(Number((value + direction * step * SHIFT_STEPS).toFixed(decimals)), min, max))
  }
  return (
    <label className="m-slider" style={style}>
      <span className="m-slider-head"><span className="m-small">{label}</span><span className="m-slider-value m-readout">{value.toFixed(decimals)}{unit ? ` ${unit}` : ''}</span></span>
      <span className="m-slider-control">
        <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(event.target.valueAsNumber)} onKeyDown={onKeyDown} />
        <span className="m-slider-track m-ruler" aria-hidden />
        <span className="m-slider-fill" aria-hidden />
        <span className="m-slider-thumb" aria-hidden />
      </span>
      <span className="m-slider-ends m-readout" aria-hidden><span>{min}</span><span>{max}</span></span>
    </label>
  )
}

// The dial sweeps 270°, from -135° (min) to +135° (max), so the gap sits at
// the bottom where the label hangs.
const DIAL_SWEEP = 270
// Pixels of vertical drag per percent of the range.
const DIAL_DRAG_PX = 2

type DialStyle = CSSProperties & { '--m-turn': string }

// 20 steps across the sweep, with a long tick at every quarter.
const DIAL_TICKS = (
  <svg className="m-dial-ticks" viewBox="-38 -38 76 76" aria-hidden>
    {Array.from({ length: 21 }, (_, step) => {
      const angle = ((-DIAL_SWEEP / 2 + step * (DIAL_SWEEP / 20)) * Math.PI) / 180
      const outer = step % 5 === 0 ? 37 : 34
      return <line key={step} x1={31 * Math.sin(angle)} y1={-31 * Math.cos(angle)} x2={outer * Math.sin(angle)} y2={-outer * Math.cos(angle)} data-major={step % 5 === 0 || undefined} />
    })}
  </svg>
)

interface DialProps {
  readonly label: string
  readonly value: number
  readonly onChange: (next: number) => void
  readonly min?: number
  readonly max?: number
  readonly unit?: string
}

export function Dial({ label, value, onChange, min = 0, max = 100, unit = '%' }: DialProps) {
  const latest = useRef(value)
  latest.current = value
  const span = max - min
  const set = (next: number) => onChange(clamp(Math.round(next), min, max))
  const onKeyDown = (event: KeyboardEvent) => {
    const direction = arrowDirection(event.key)
    if (direction === 0) return
    event.preventDefault()
    set(value + direction * (event.shiftKey ? SHIFT_STEPS : 1))
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const startY = event.clientY
    const startValue = latest.current
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const move = (e: globalThis.PointerEvent) => set(startValue + ((startY - e.clientY) / DIAL_DRAG_PX) * (span / 100))
    const end = () => { target.removeEventListener('pointermove', move); target.removeEventListener('lostpointercapture', end) }
    target.addEventListener('pointermove', move)
    target.addEventListener('lostpointercapture', end)
  }
  const style: DialStyle = { '--m-turn': `${-DIAL_SWEEP / 2 + ((value - min) / span) * DIAL_SWEEP}deg` }
  return (
    <div className="m-dial-group">
      <div className="m-dial" role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} style={style} onKeyDown={onKeyDown} onPointerDown={onPointerDown}>{DIAL_TICKS}</div>
      <span className="m-small">{label}</span>
      <span className="m-readout m-quiet">{value} {unit}</span>
    </div>
  )
}
