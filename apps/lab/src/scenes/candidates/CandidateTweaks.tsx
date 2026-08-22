// The candidates' tweak panel — a DOM overlay outside the canvas, showing
// only the active candidate's knobs. Sliders write into the live bags in
// candidateTuning.ts; materials pick the values up on their next frame, and
// durations on the next run. The copy button puts the active bag on the
// clipboard as JSON, ready to paste back over the committed defaults.

import { useCallback, useState } from 'react'
import { TuningGroup, TuningPanel, TuningSlider } from '@/components/TuningPanel'
import {
  ANALYZE_GROUPS,
  COPY_GROUPS,
  DELETE_GROUPS,
  DISSOLVE_GROUPS,
  RIPPLE_GROUPS,
  UNROLL_GROUPS,
  analyzeTuning,
  copyTuning,
  deleteTuning,
  dissolveTuning,
  rippleTuning,
  unrollTuning,
  type CandidateKnobDef,
  type CandidateKnobGroup,
} from './candidateTuning'

function Row<B extends Record<string, number>>({ bag, knob }: { bag: B; knob: CandidateKnobDef<B> }) {
  // Seeded from the live bag, so the panel shows the truth even when the
  // console has been poking the same values.
  const [value, setValue] = useState<number>(() => bag[knob.key])

  const onInput = useCallback(
    (nextValue: number) => {
      setValue(nextValue)
      const writable: Record<string, number> = bag
      writable[knob.key] = nextValue
    },
    [bag, knob],
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

function BagGroups<B extends Record<string, number>>({
  bag,
  groups,
}: {
  bag: B
  groups: CandidateKnobGroup<B>[]
}) {
  return (
    <>
      {groups.map((g) => (
        <TuningGroup key={g.title} title={g.title} initialState="open">
          {g.knobs.map((k) => (
            <Row key={k.key} bag={bag} knob={k} />
          ))}
        </TuningGroup>
      ))}
    </>
  )
}

const PANELS = {
  ripple: { bag: rippleTuning, body: <BagGroups bag={rippleTuning} groups={RIPPLE_GROUPS} /> },
  // Billow is the ripple mechanism on a lone button — one bag, one set of
  // knobs, tuned once for both.
  billow: { bag: rippleTuning, body: <BagGroups bag={rippleTuning} groups={RIPPLE_GROUPS} /> },
  unroll: { bag: unrollTuning, body: <BagGroups bag={unrollTuning} groups={UNROLL_GROUPS} /> },
  dissolve: {
    bag: dissolveTuning,
    body: <BagGroups bag={dissolveTuning} groups={DISSOLVE_GROUPS} />,
  },
  analyze: { bag: analyzeTuning, body: <BagGroups bag={analyzeTuning} groups={ANALYZE_GROUPS} /> },
  copy: { bag: copyTuning, body: <BagGroups bag={copyTuning} groups={COPY_GROUPS} /> },
  delete: { bag: deleteTuning, body: <BagGroups bag={deleteTuning} groups={DELETE_GROUPS} /> },
} as const

export type TweakableCandidateId = keyof typeof PANELS

export function CandidateTweaks({ id }: { id: TweakableCandidateId }) {
  const panel = PANELS[id]

  const dump = useCallback(() => {
    const out = JSON.stringify({ [id]: panel.bag }, null, 2)
    // eslint-disable-next-line no-console
    console.log(out)
    void navigator.clipboard?.writeText(out).catch(() => {})
  }, [id, panel])

  // Keyed on the candidate so every Row re-seeds from the right bag when
  // the rail switches.
  return (
    <TuningPanel key={id} title={`${id} tweaks`} side="right" zIndex={200} onCopy={dump}>
      {panel.body}
    </TuningPanel>
  )
}
