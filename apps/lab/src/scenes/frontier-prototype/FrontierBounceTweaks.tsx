// Light bounce tweak panel — a DOM overlay that writes the shared bounce
// uniforms directly and wakes the demand-driven canvas.
//
// Picking a finish or toggling boost in the toolbar reseeds every value, so the
// scene remounts this panel then; the rows read the uniforms again on mount.

import { useCallback, useState } from 'react'
import { TuningGroup, TuningPanel, TuningSlider } from '@/components/TuningPanel'
import {
  BOUNCE_KNOB_GROUPS,
  readBounceTuning,
  type BounceKnob,
  type BounceTuningUniforms,
} from './frontierBounceTuning'

function Row({
  knob,
  uniforms,
  onChange,
}: {
  readonly knob: BounceKnob
  readonly uniforms: BounceTuningUniforms
  readonly onChange: () => void
}) {
  const [value, setValue] = useState(() => uniforms[knob.key].value)

  const onValueChange = useCallback(
    (next: number) => {
      setValue(next)
      uniforms[knob.key].value = next
      onChange()
    },
    [knob, uniforms, onChange],
  )

  return (
    <TuningSlider
      label={knob.label}
      min={knob.min}
      max={knob.max}
      step={knob.step}
      value={value}
      onValueChange={onValueChange}
    />
  )
}

export function FrontierBounceTweaks({
  uniforms,
  onChange,
}: {
  readonly uniforms: BounceTuningUniforms
  readonly onChange: () => void
}) {
  const copy = useCallback(() => {
    const out = JSON.stringify({ bounce: readBounceTuning(uniforms) }, null, 2)
    // eslint-disable-next-line no-console
    console.log(out)
    void navigator.clipboard?.writeText(out).catch(() => {})
  }, [uniforms])

  return (
    <TuningPanel title="light bounce tweaks" side="right" zIndex={200} onCopy={copy}>
      {BOUNCE_KNOB_GROUPS.map((group, index) => (
        <TuningGroup
          key={group.title}
          title={group.title}
          initialState={index === 0 ? 'open' : 'closed'}
        >
          {group.knobs.map((knob) => (
            <Row key={knob.key} knob={knob} uniforms={uniforms} onChange={onChange} />
          ))}
        </TuningGroup>
      ))}
    </TuningPanel>
  )
}
