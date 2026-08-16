// The genie scene's tweak panel — a DOM overlay, deliberately OUTSIDE
// the windows and their flights, for the same reason GlassTweaks.tsx
// states in full: a tuning surface has to be the one thing in the frame
// you can trust, so measurement infrastructure stays out of the
// excursion. Sliders write into genieTuning and apply live; React state
// here is only the panel's own chrome.

import { useCallback, useState } from 'react'
import { TuningGroup, TuningPanel, TuningSlider } from '@/components/TuningPanel'
import {
  GENIE_KNOB_GROUPS,
  applyGenieKnobs,
  dumpGenieKnobs,
  genieTuning,
  type GenieKnobDef,
} from './genieTuning'

function Row({ knob }: { knob: GenieKnobDef }) {
  // Seeded from the live bag, so the panel shows the truth even when the
  // console has been poking the same values.
  const [value, setValue] = useState(() => genieTuning[knob.key])

  const onInput = useCallback(
    (nextValue: number) => {
      setValue(nextValue)
      genieTuning[knob.key] = nextValue
      applyGenieKnobs()
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
      decimalPlaces={knob.step >= 1 ? 0 : 2}
      onValueChange={onInput}
    />
  )
}

export function GenieTweakPanel() {
  // A tuning session is worth nothing if it cannot leave the browser:
  // paste-ready knob values plus the two derived CSS lines (end scale
  // and easing) that genie.css carries as literals.
  const dump = useCallback(() => {
    const out = dumpGenieKnobs()
    // eslint-disable-next-line no-console
    console.log(out)
    void navigator.clipboard?.writeText(out).catch(() => {})
  }, [])

  return (
    <TuningPanel title="genie tweaks" side="right" zIndex={200} onCopy={dump}>
      {GENIE_KNOB_GROUPS.map((g) => (
        <TuningGroup key={g.title} title={g.title} initialState="open">
          {g.knobs.map((k) => (
            <Row key={k.key} knob={k} />
          ))}
        </TuningGroup>
      ))}
    </TuningPanel>
  )
}
