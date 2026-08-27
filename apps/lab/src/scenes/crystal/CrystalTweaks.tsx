// The crystal's tweak panel — a DOM overlay outside the canvas.
//
// Sliders write into the live bag in crystalTuning.ts, which the frame loop
// re-reads every frame, so a knob takes effect with no remount. The same bag
// is what the pointer correction reads, so a knob moves the picture and the
// click together and they cannot be tuned apart.
//
// Parking is the exception: it is React state on the scene, not a tuned
// number, because it changes what the scene LISTENS to rather than what it
// draws. `p` is the control and this box reports it — see Crystal.tsx.

import { useCallback, useState } from 'react'
import { TuningGroup, TuningPanel, TuningSlider } from '@/components/TuningPanel'
import { CRYSTAL_GROUPS, crystalTuning, type CrystalKnobDef } from './crystalTuning'

function Row({ knob }: { knob: CrystalKnobDef }) {
  // Seeded from the live bag, so the panel shows the truth even when the
  // console has been poking the same values.
  const [value, setValue] = useState<number>(() => crystalTuning[knob.key])

  const onInput = useCallback(
    (nextValue: number) => {
      setValue(nextValue)
      const writable: Record<string, number> = crystalTuning
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

export function CrystalTweaks({
  parked,
  onParked,
}: {
  parked: boolean
  onParked: (next: boolean) => void
}) {
  const dump = useCallback(() => {
    const out = JSON.stringify({ crystal: crystalTuning }, null, 2)
    // eslint-disable-next-line no-console
    console.log(out)
    void navigator.clipboard?.writeText(out).catch(() => {})
  }, [])

  return (
    <TuningPanel title="crystal tweaks" side="right" zIndex={200} onCopy={dump}>
      <label className="crystal-park">
        <input
          type="checkbox"
          checked={parked}
          onChange={(e) => onParked(e.target.checked)}
        />
        <span>park the crystal</span>
        <kbd>P</kbd>
      </label>
      {CRYSTAL_GROUPS.map((g) => (
        <TuningGroup key={g.title} title={g.title} initialState={g.title === 'optics' ? 'open' : 'closed'}>
          {g.knobs.map((k) => (
            <Row key={k.key} knob={k} />
          ))}
        </TuningGroup>
      ))}
    </TuningPanel>
  )
}
