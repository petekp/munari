// The crossing's tweak panel — a DOM overlay outside the canvas.
//
// Sliders write into the live bag in refractionTuning.ts. The material and
// the field pass both re-read that bag every frame, so a slider takes
// effect with no remount — including `field texel px`, which resizes the
// render target in place. The copy button puts the bag on the clipboard as
// JSON, ready to paste back over the committed defaults.
//
// Scrub while dragging: relief is zero at both ends of the crossing, so a
// slider moved with the scrub parked at 0 or 1 appears to do nothing at all.

import { useCallback, useState } from 'react'
import { TuningGroup, TuningPanel, TuningSlider } from '@/components/TuningPanel'
import {
  REFRACTION_GROUPS,
  refractionTuning,
  type RefractionKnobDef,
} from './refractionTuning'

function Row({ knob }: { knob: RefractionKnobDef<typeof refractionTuning> }) {
  // Seeded from the live bag, so the panel shows the truth even when the
  // console has been poking the same values.
  const [value, setValue] = useState<number>(() => refractionTuning[knob.key])

  const onInput = useCallback(
    (nextValue: number) => {
      setValue(nextValue)
      const writable: Record<string, number> = refractionTuning
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

export function RefractionTweaks() {
  const dump = useCallback(() => {
    const out = JSON.stringify({ refraction: refractionTuning }, null, 2)
    // eslint-disable-next-line no-console
    console.log(out)
    void navigator.clipboard?.writeText(out).catch(() => {})
  }, [])

  return (
    <TuningPanel title="refraction tweaks" side="right" zIndex={200} onCopy={dump}>
      {REFRACTION_GROUPS.map((g) => (
        <TuningGroup key={g.title} title={g.title} initialState={g.title === 'lens' ? 'open' : 'closed'}>
          {g.knobs.map((k) => (
            <Row key={k.key} knob={k} />
          ))}
        </TuningGroup>
      ))}
    </TuningPanel>
  )
}
