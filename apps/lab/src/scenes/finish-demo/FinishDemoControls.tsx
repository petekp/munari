// Finish demo controls — the pickers, knobs and code listing of the bench.
//
// Every control writes through the actions in finishDemoRecipe, and the
// listing renders the lines that module prints, so the page cannot show
// code it does not run.

import { useState } from 'react'
import { Button, Slider } from '../../components/system'
import type { FinishId, TextLighting } from '../material-finishes/materialFinishesTuning'
import { DEMO_FINISH_GROUPS, type FinishKnob } from './finishDemoFinishes'
import { RIG_CHOICES, setFinishColor, setFinishNumber, type BenchCard, type CodeLine } from './finishDemoRecipe'
import { useTuningVersion, type PageGround } from './FinishDemoStage'

interface ChoiceProps<Value extends string> {
  readonly label: string
  readonly value: Value
  readonly options: readonly (readonly [Value, string])[]
  readonly onSelect: (next: Value) => void
}

export function Choice<Value extends string>({ label, value, options, onSelect }: ChoiceProps<Value>) {
  return (
    <div className="fd-choice" role="group" aria-label={label}>
      {options.map(([id, text]) => (
        <Button key={id} compact variant={value === id ? 'solid' : 'outline'} aria-pressed={value === id} onClick={() => onSelect(id)}>
          {text}
        </Button>
      ))}
    </div>
  )
}

export function FinishPicker({ value, onSelect }: { readonly value: FinishId; readonly onSelect: (next: FinishId) => void }) {
  return (
    <>
      {DEMO_FINISH_GROUPS.map((group) => (
        <div key={group.label} role="group" aria-label={group.label} className="fd-finish-group">
          <h3 className="fd-finish-family">{group.label}</h3>
          <ul className="fd-finishes">
            {group.finishes.map((item) => (
              <li key={item.id}>
                <button type="button" className="fd-finish" aria-pressed={value === item.id} onClick={() => onSelect(item.id)}>
                  <span className="fd-swatch" style={{ background: item.finish.color }} aria-hidden />
                  <strong>{item.label}</strong>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}

export const RIG_OPTIONS = RIG_CHOICES
export const TEXT_OPTIONS: readonly (readonly [TextLighting, string])[] = [
  ['unlit', 'Unlit text'],
  ['lit', 'Lit text'],
]
export const GROUND_OPTIONS: readonly (readonly [PageGround, string])[] = [
  ['light', 'Light page'],
  ['dark', 'Dark page'],
]

function decimalsOf(step: number): number {
  const [, fraction = ''] = String(step).split('.')
  return fraction.length
}

export function KnobControl({ knob, card }: { readonly knob: FinishKnob; readonly card: BenchCard }) {
  useTuningVersion()
  if (knob.kind === 'color') {
    return (
      <label className="fd-color">
        <span className="m-small">{knob.label}</span>
        <input type="color" value={card.finish[knob.key]} onChange={(event) => setFinishColor(card, knob.key, event.target.value)} />
      </label>
    )
  }
  return (
    <Slider
      label={knob.label}
      min={knob.min}
      max={knob.max}
      step={knob.step}
      value={Number(card.finish[knob.key].toFixed(decimalsOf(knob.step)))}
      onChange={(value) => setFinishNumber(card, knob.key, value)}
    />
  )
}

// ── code ───────────────────────────────────────────────────────────────

export function CopyCode({ lines }: { readonly lines: readonly CodeLine[] }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard
      ?.writeText(lines.join('\n'))
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1600)
      })
      .catch(() => {})
  }
  return (
    <Button compact variant="outline" onClick={copy}>
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}

export function CodeListing({ lines }: { readonly lines: readonly CodeLine[] }) {
  return <pre className="fd-code">{lines.join('\n')}</pre>
}
