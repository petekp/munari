// Live tuning panel for the material finishes prototype — outside the canvas.

import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { Button } from '../../components/system'
import { TuningGroup, TuningPanel, TuningSlider } from '../../components/TuningPanel'
import {
  applyFinish,
  liveFinish,
  notifyFinishTuning,
  studio,
  subscribeFinishTuning,
  type Finish,
  type FinishId,
  type StudioTuning,
} from './materialFinishesTuning'

type FinishNumber = Exclude<keyof Finish, 'color' | 'sheenColor'>
type FinishColor = 'color' | 'sheenColor'

interface Knob<Key> {
  readonly key: Key
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
}

// Slider ranges span three's valid range for each property, so a knob can
// leave a finish's catalog range (docs/materials-research-catalog.md §1).
const GROUPS: readonly { readonly title: string; readonly knobs: readonly Knob<FinishNumber>[] }[] = [
  {
    title: 'base',
    knobs: [
      { key: 'roughness', label: 'roughness', min: 0, max: 1, step: 0.01 },
      { key: 'metalness', label: 'metalness', min: 0, max: 1, step: 0.01 },
      { key: 'ior', label: 'ior', min: 1, max: 2.333, step: 0.01 },
    ],
  },
  {
    title: 'clearcoat',
    knobs: [
      { key: 'clearcoat', label: 'clearcoat', min: 0, max: 1, step: 0.01 },
      { key: 'clearcoatRoughness', label: 'coat roughness', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'sheen',
    knobs: [
      { key: 'sheen', label: 'sheen', min: 0, max: 1, step: 0.01 },
      { key: 'sheenRoughness', label: 'sheen roughness', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'anisotropy',
    knobs: [
      { key: 'anisotropy', label: 'anisotropy', min: 0, max: 1, step: 0.01 },
      { key: 'anisotropyRotation', label: 'rotation (rad)', min: 0, max: Math.PI, step: 0.01 },
    ],
  },
  {
    title: 'iridescence',
    knobs: [
      { key: 'iridescence', label: 'iridescence', min: 0, max: 1, step: 0.01 },
      { key: 'iridescenceIOR', label: 'film ior', min: 1, max: 2.333, step: 0.01 },
      { key: 'iridescenceThickness', label: 'film thickness (nm)', min: 100, max: 1000, step: 10 },
    ],
  },
]

const STUDIO_KNOBS: readonly Knob<Exclude<keyof StudioTuning, 'lightX' | 'lightY'>>[] = [
  { key: 'lightHeight', label: 'light height (css px)', min: 40, max: 900, step: 10 },
  { key: 'lightPower', label: 'light power', min: 0, max: 8, step: 0.1 },
  { key: 'environmentIntensity', label: 'environment', min: 0, max: 2, step: 0.05 },
]

function ColorField({ name, label }: { readonly name: FinishColor; readonly label: string }) {
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    liveFinish[name] = event.target.value
    notifyFinishTuning()
  }
  return (
    <label className="mf-color-field">
      <span>{label}</span>
      <input type="color" value={liveFinish[name]} onChange={onChange} />
    </label>
  )
}

export function MaterialFinishesTweaks({ finish }: { readonly finish: FinishId }) {
  const [, bump] = useState(0)
  useEffect(() => subscribeFinishTuning(() => bump((n) => n + 1)), [])

  const setFinishValue = useCallback((key: FinishNumber, value: number) => {
    liveFinish[key] = value
    notifyFinishTuning()
  }, [])
  const setStudioValue = useCallback((key: Exclude<keyof StudioTuning, 'lightX' | 'lightY'>, value: number) => {
    studio[key] = value
    notifyFinishTuning()
  }, [])
  const copyJson = useCallback(() => {
    void navigator.clipboard?.writeText(JSON.stringify({ finish: liveFinish, studio }, null, 2)).catch(() => {})
  }, [])

  return (
    <TuningPanel title="finish tweaks" side="right" zIndex={200} onCopy={copyJson}>
      <TuningGroup title="colors" initialState="open">
        <ColorField name="color" label="Body" />
        <ColorField name="sheenColor" label="Sheen" />
        <Button compact variant="outline" onClick={() => applyFinish(finish)}>
          Reset finish
        </Button>
      </TuningGroup>
      {GROUPS.map((group) => (
        <TuningGroup key={group.title} title={group.title} initialState="open">
          {group.knobs.map((knob) => (
            <TuningSlider
              key={knob.key}
              label={knob.label}
              min={knob.min}
              max={knob.max}
              step={knob.step}
              value={liveFinish[knob.key]}
              onValueChange={(value) => setFinishValue(knob.key, value)}
            />
          ))}
        </TuningGroup>
      ))}
      <TuningGroup title="light and environment" initialState="open">
        {STUDIO_KNOBS.map((knob) => (
          <TuningSlider
            key={knob.key}
            label={knob.label}
            min={knob.min}
            max={knob.max}
            step={knob.step}
            value={studio[knob.key]}
            onValueChange={(value) => setStudioValue(knob.key, value)}
          />
        ))}
      </TuningGroup>
    </TuningPanel>
  )
}
