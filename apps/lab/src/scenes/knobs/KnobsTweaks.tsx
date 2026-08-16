// The knobs scene's tweak panel — a DOM overlay, deliberately OUTSIDE
// the Canvas and the captured Surface, for the reason GenieTweaks.tsx
// carries in full: a tuning surface has to be the one thing in the
// frame you can trust, so measurement infrastructure stays out of the
// excursion. Sliders write into knobsTuning and apply live;
// React state here is only the panel's own chrome.
//
// It anchors top-LEFT where Genie's anchors right: the slab owns the
// right rail, and a tuning surface must not stand on the pixels it is
// tuning.

import { useCallback, useState } from 'react'
import { TuningGroup, TuningPanel, TuningSlider } from '@/components/TuningPanel'
import {
  KNOBS_TUNING_GROUPS,
  applyKnobsTuning,
  bumpTuningRev,
  dumpKnobsTuning,
  knobsTuning,
  type KnobsTuningDef,
} from './knobsTuning'

function Row({ knob }: { knob: KnobsTuningDef }) {
  // Seeded from the live bag, so the panel shows the truth even when
  // the console has been poking the same values.
  const [value, setValue] = useState(() => knobsTuning[knob.key])

  const onInput = useCallback(
    (nextValue: number) => {
      setValue(nextValue)
      knobsTuning[knob.key] = nextValue
      applyKnobsTuning()
      // Geometry knobs can't be dripped — vertex counts change — so
      // they announce a re-machine.
      if (knob.rebuild) bumpTuningRev()
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

export function KnobsTweakPanel() {
  // A tuning session is worth nothing if it cannot leave the browser:
  // paste-ready values for baking back into the constants and the
  // var() defaults they mirror.
  const dump = useCallback(() => {
    const out = dumpKnobsTuning()
    // eslint-disable-next-line no-console
    console.log(out)
    void navigator.clipboard?.writeText(out).catch(() => {})
  }, [])

  return (
    <TuningPanel title="knobs tweaks" side="left" zIndex={200} onCopy={dump}>
      {KNOBS_TUNING_GROUPS.map((g) => (
        <TuningGroup key={g.title} title={g.title} initialState="open">
          {g.knobs.map((k) => (
            <Row key={k.key} knob={k} />
          ))}
        </TuningGroup>
      ))}
    </TuningPanel>
  )
}
