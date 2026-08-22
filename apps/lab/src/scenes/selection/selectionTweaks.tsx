// The bead's tweak panel — a DOM overlay outside the canvas.
//
// Sliders write into the live bag in selectionTuning.ts; the material picks
// the values up on its next frame, with no remount. The copy button puts the
// bag on the clipboard as JSON, ready to paste back over the committed
// defaults.

import { useCallback, useState } from 'react'
import { TuningGroup, TuningPanel, TuningSlider } from '@/components/TuningPanel'
import {
  SELECTION_GROUPS,
  selectionTuning,
  type SelectionKnobDef,
} from './selectionTuning'

function Row({ knob }: { knob: SelectionKnobDef<typeof selectionTuning> }) {
  // Seeded from the live bag, so the panel shows the truth even when the
  // console has been poking the same values.
  const [value, setValue] = useState<number>(() => selectionTuning[knob.key])

  const onInput = useCallback(
    (nextValue: number) => {
      setValue(nextValue)
      const writable: Record<string, number> = selectionTuning
      writable[knob.key] = nextValue
    },
    [knob],
  )

  return (
    <TuningSlider
      label={knob.label}
      min={knob.min}
      max={knob.max}
      step={knob.step}
      value={value}
      decimalPlaces={knob.step >= 1 ? 0 : knob.step >= 0.01 ? 2 : 4}
      onValueChange={onInput}
    />
  )
}

export function SelectionTweaks() {
  const dump = useCallback(() => {
    const out = JSON.stringify({ selection: selectionTuning }, null, 2)
    // eslint-disable-next-line no-console
    console.log(out)
    void navigator.clipboard?.writeText(out).catch(() => {})
  }, [])

  return (
    <TuningPanel title="selection tweaks" side="right" zIndex={200} onCopy={dump}>
      {SELECTION_GROUPS.map((g) => (
        <TuningGroup key={g.title} title={g.title} initialState="open">
          {g.knobs.map((k) => (
            <Row key={k.key} knob={k} />
          ))}
        </TuningGroup>
      ))}
    </TuningPanel>
  )
}
