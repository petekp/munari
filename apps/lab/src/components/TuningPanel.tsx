// Lab tuning panel — shared DOM chrome around scene-owned live knobs.
//
// The panel stays outside the canvas so it remains a trustworthy instrument
// while a scene moves. Scenes still own every read, write, and side effect;
// this module owns only the repeated shell, disclosure, and slider markup.

import { useState, type ReactNode } from 'react'

type TuningPanelSide = 'left' | 'right'
type TuningPanelLayer = 50 | 200

const sideClass = {
  left: 'left-4',
  right: 'right-4',
} satisfies Record<TuningPanelSide, string>

const layerClass = {
  50: 'z-50',
  200: 'z-[200]',
} satisfies Record<TuningPanelLayer, string>

interface TuningPanelProps {
  title: string
  side: TuningPanelSide
  zIndex: TuningPanelLayer
  onCopy: () => void
  children: ReactNode
}

export function TuningPanel({ title, side, zIndex, onCopy, children }: TuningPanelProps) {
  const [open, setOpen] = useState(false)
  const position = `${sideClass[side]} ${layerClass[zIndex]}`

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed top-4 ${position} rounded border border-white/15 bg-black/70 px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-white/75 backdrop-blur hover:text-white`}
      >
        tweaks
      </button>
    )
  }

  return (
    <div
      className={`fixed top-4 ${position} max-h-[calc(100vh-2rem)] w-[300px] overflow-y-auto rounded border border-white/15 bg-black/80 px-3 py-2 text-white backdrop-blur`}
    >
      <div className="flex items-center justify-between pb-1">
        <span className="text-[10px] uppercase tracking-wider text-white/50">{title}</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCopy}
            className="text-[10px] uppercase tracking-wider text-white/50 hover:text-white"
          >
            copy
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={`close ${title}`}
            className="text-[10px] uppercase tracking-wider text-white/50 hover:text-white"
          >
            ✕
          </button>
        </div>
      </div>
      {children}
    </div>
  )
}

interface TuningGroupProps {
  title: string
  initialState: 'open' | 'closed'
  children: ReactNode
}

export function TuningGroup({ title, initialState, children }: TuningGroupProps) {
  const [open, setOpen] = useState(initialState === 'open')

  return (
    <div className="border-t border-white/10 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 py-1.5 text-[10px] uppercase tracking-wider text-white/70 hover:text-white"
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        {title}
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  )
}

interface TuningSliderProps {
  label: string
  min: number
  max: number
  step: number
  value: number
  decimalPlaces: number
  onValueChange: (value: number) => void
}

export function TuningSlider({
  label,
  min,
  max,
  step,
  value,
  decimalPlaces,
  onValueChange,
}: TuningSliderProps) {
  return (
    <label className="flex items-center gap-2 py-[3px] text-[10px] leading-none">
      <span className="w-[104px] shrink-0 truncate text-white/55">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onValueChange(Number(event.target.value))}
        className="h-[3px] flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-[#ff4f17]"
      />
      <span className="w-[46px] shrink-0 text-right tabular-nums text-white/80">
        {value.toFixed(decimalPlaces)}
      </span>
    </label>
  )
}
