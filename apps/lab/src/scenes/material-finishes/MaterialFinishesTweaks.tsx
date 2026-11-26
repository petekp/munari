// Live tuning panel for the material finishes prototype — outside the canvas.

import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { Button } from '../../components/system'
import { TuningGroup, TuningPanel, TuningSlider } from '../../components/TuningPanel'
import {
  applyLook,
  liveFinish,
  notifyFinishTuning,
  studio,
  subscribeFinishTuning,
  type Finish,
  type FinishLook,
  type LightRig,
  type StudioTuning,
} from './materialFinishesTuning'

type FinishNumber = Exclude<keyof Finish, 'color' | 'sheenColor' | 'rimColor' | 'detail'>
type StudioNumber = Exclude<keyof StudioTuning, 'lightX' | 'lightY'>
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
      { key: 'specularIntensity', label: 'base specular', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'edge and relief',
    knobs: [
      { key: 'edgeWidth', label: 'edge width (css px)', min: 0, max: 120, step: 0.5 },
      { key: 'detailScale', label: 'relief size (css px)', min: 0.5, max: 160, step: 0.5 },
      { key: 'detailDepth', label: 'relief slope', min: 0, max: 2, step: 0.005 },
      { key: 'crackle', label: 'crackle', min: 0, max: 1, step: 0.01 },
      { key: 'crackleScale', label: 'crackle size (css px)', min: 4, max: 120, step: 1 },
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

const KEY_KNOBS: readonly Knob<StudioNumber>[] = [
  { key: 'lightHeight', label: 'key height (css px)', min: 40, max: 900, step: 10 },
  { key: 'lightPower', label: 'key power', min: 0, max: 8, step: 0.1 },
]
const SOFTBOX_KNOBS: readonly Knob<StudioNumber>[] = [
  { key: 'softboxWidth', label: 'softbox width (css px)', min: 20, max: 600, step: 10 },
  { key: 'softboxHeight', label: 'softbox height (css px)', min: 20, max: 600, step: 10 },
]
const RIM_KNOBS: readonly Knob<StudioNumber>[] = [
  { key: 'rimPower', label: 'rim power', min: 0, max: 6, step: 0.05 },
  { key: 'rimElevation', label: 'rim elevation (deg)', min: 2, max: 60, step: 1 },
]
const ENVIRONMENT_KNOBS: readonly Knob<StudioNumber>[] = [
  { key: 'environmentIntensity', label: 'environment', min: 0, max: 2, step: 0.05 },
]

function studioKnobs(rig: LightRig): readonly Knob<StudioNumber>[] {
  switch (rig) {
    case 'room':
      return [...KEY_KNOBS, ...ENVIRONMENT_KNOBS]
    case 'softbox':
      return [...KEY_KNOBS, ...SOFTBOX_KNOBS, ...RIM_KNOBS, ...ENVIRONMENT_KNOBS]
    case 'studio-point':
      return [...KEY_KNOBS, ...RIM_KNOBS, ...ENVIRONMENT_KNOBS]
  }
}

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

export function MaterialFinishesTweaks({ look, rig }: { readonly look: FinishLook; readonly rig: LightRig }) {
  const [, bump] = useState(0)
  useEffect(() => subscribeFinishTuning(() => bump((n) => n + 1)), [])

  const setFinishValue = useCallback((key: FinishNumber, value: number) => {
    liveFinish[key] = value
    notifyFinishTuning()
  }, [])
  const setStudioValue = useCallback((key: StudioNumber, value: number) => {
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
        <Button compact variant="outline" onClick={() => applyLook(look)}>
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
        {studioKnobs(rig).map((knob) => (
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
