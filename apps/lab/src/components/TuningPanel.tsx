// Lab tuning panel — shared DOM chrome around scene-owned live knobs.
//
// The panel stays outside the canvas so it remains a trustworthy instrument
// while a scene moves. Scenes still own every read, write, and side effect;
// this module owns only the shell, disclosure, and slider markup, drawn
// with the system's panel and slider (components/system).

import { useState, type ReactNode } from 'react'
import { Button, CHEVRON, Panel, Slider, TextButton } from './system'

type TuningPanelSide = 'left' | 'right'
type TuningPanelLayer = 50 | 200

interface TuningPanelProps {
  title: string
  side: TuningPanelSide
  zIndex: TuningPanelLayer
  /** The system ground (tokens.css): paper by default, ink over a dark scene. */
  ground?: 'paper' | 'ink'
  onCopy: () => void
  children: ReactNode
}

/** Scenes write knob names in lower case; the system writes sentence case. */
function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// 16px off the viewport edge, clear of a scene's own corner controls.
const EDGE = 16

export function TuningPanel({ title, side, zIndex, ground = 'paper', onCopy, children }: TuningPanelProps) {
  const [open, setOpen] = useState(false)
  const position = { position: 'fixed', top: EDGE, [side]: EDGE, zIndex } as const

  if (!open) {
    return (
      <span data-ground={ground} style={position}>
        <Button variant="outline" compact onClick={() => setOpen(true)}>Tweaks</Button>
      </span>
    )
  }

  return (
    <Panel
      data-ground={ground}
      style={{ ...position, maxHeight: `calc(100vh - ${2 * EDGE}px)`, overflowY: 'auto' }}
      title={sentenceCase(title)}
      action={<TextButton onClick={() => setOpen(false)}>Hide</TextButton>}
      foot={<Button variant="outline" compact onClick={onCopy}>Copy values</Button>}
    >
      {children}
    </Panel>
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
    <div className="m-panel-section">
      <button type="button" className="m-panel-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {sentenceCase(title)}
        {CHEVRON}
      </button>
      {open && <div className="m-panel-group">{children}</div>}
    </div>
  )
}

interface TuningSliderProps {
  label: string
  min: number
  max: number
  step: number
  value: number
  onValueChange: (value: number) => void
}

export function TuningSlider({ label, min, max, step, value, onValueChange }: TuningSliderProps) {
  return <Slider label={sentenceCase(label)} min={min} max={max} step={step} value={value} onChange={onValueChange} />
}
