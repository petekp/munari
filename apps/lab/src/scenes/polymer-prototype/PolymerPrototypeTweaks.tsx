// Live tuning panel for the soft-polymer prototype — outside the canvas.

import { useCallback, useState } from 'react'
import { Button } from '../../components/system'
import { TuningGroup, TuningPanel, TuningSlider } from '../../components/TuningPanel'
import {
  applyPolymerPreset,
  notifyPolymerTuning,
  POLYMER_PRESETS,
  polymerTuning,
  type PolymerBodyModel,
  type PolymerPresetId,
  type PolymerTuning,
} from './polymerPrototypeTuning'

type NumericKey = Exclude<keyof PolymerTuning, 'baseHex' | 'body'>

interface KnobDef {
  readonly key: NumericKey
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
}

const GEOMETRY_KNOBS: readonly KnobDef[] = [
  { key: 'elevation', label: 'elevation (px)', min: 0, max: 28, step: 0.5 },
  { key: 'bevelWidth', label: 'bevel cushion (px)', min: 2, max: 18, step: 0.5 },
  { key: 'cornerRadius', label: 'corner radius (px)', min: 4, max: 32, step: 1 },
  { key: 'pillow', label: 'face pillow dome', min: 0, max: 0.45, step: 0.01 },
]

const BODY_MODELS: readonly { readonly id: PolymerBodyModel; readonly label: string }[] = [
  { id: 'hand-built', label: 'Hand-built' },
  { id: 'physical', label: 'Physical' },
]

const SHARED_FINISH_KNOBS: readonly KnobDef[] = [
  { key: 'bodyOpacity', label: 'polymer opacity', min: 0.5, max: 1, step: 0.02 },
  { key: 'roughness', label: 'surface roughness', min: 0.1, max: 0.85, step: 0.02 },
  { key: 'grain', label: 'mold micro-grain', min: 0, max: 0.04, step: 0.002 },
  { key: 'seamInk', label: 'modernist seam ink', min: 0, max: 0.5, step: 0.02 },
]

const HAND_BUILT_FINISH_KNOBS: readonly KnobDef[] = [
  { key: 'subsurfaceWrap', label: 'subsurface wrap', min: 0, max: 1, step: 0.02 },
  { key: 'warmth', label: 'subsurface warmth', min: 0, max: 0.7, step: 0.02 },
  { key: 'specular', label: 'satin specular', min: 0, max: 0.65, step: 0.02 },
]

// Ranges: docs/materials-research-catalog.md §1, molded polymer row.
const PHYSICAL_FINISH_KNOBS: readonly KnobDef[] = [
  { key: 'clearcoat', label: 'clearcoat', min: 0, max: 0.3, step: 0.01 },
  { key: 'clearcoatRoughness', label: 'clearcoat roughness', min: 0, max: 0.6, step: 0.02 },
  { key: 'sheen', label: 'sheen', min: 0, max: 0.4, step: 0.01 },
  { key: 'sheenRoughness', label: 'sheen roughness', min: 0.3, max: 0.8, step: 0.02 },
  { key: 'ior', label: 'index of refraction', min: 1.35, max: 1.6, step: 0.01 },
  { key: 'lightIntensity', label: 'studio light intensity', min: 0, max: 6, step: 0.1 },
  { key: 'environmentIntensity', label: 'room environment intensity', min: 0, max: 1.5, step: 0.05 },
]

const LIGHT_KNOBS: readonly KnobDef[] = [
  { key: 'lightHeight', label: 'light height (px)', min: 180, max: 900, step: 10 },
  { key: 'lightRadius', label: 'bulb softness', min: 8, max: 100, step: 2 },
  { key: 'shadowOpacity', label: 'penumbra opacity', min: 0, max: 0.35, step: 0.01 },
  { key: 'contactOpacity', label: 'contact crease', min: 0, max: 0.35, step: 0.01 },
  { key: 'maxDpr', label: 'max canvas dpr', min: 1, max: 2, step: 0.25 },
]

export function PolymerPrototypeTweaks({ onDprChange }: { readonly onDprChange: (dpr: number) => void }) {
  const [, bump] = useState(0)
  const [preset, setPreset] = useState<PolymerPresetId>('delrin-white')
  const [body, setBody] = useState<PolymerBodyModel>(polymerTuning.body)
  const finishKnobs = [
    ...SHARED_FINISH_KNOBS,
    ...(body === 'physical' ? PHYSICAL_FINISH_KNOBS : HAND_BUILT_FINISH_KNOBS),
  ]

  const update = useCallback(
    (key: NumericKey, value: number) => {
      polymerTuning[key] = value
      if (key === 'maxDpr') onDprChange(value)
      notifyPolymerTuning()
      bump((n) => n + 1)
    },
    [onDprChange],
  )

  const copyJson = useCallback(() => {
    const text = JSON.stringify(polymerTuning, null, 2)
    void navigator.clipboard?.writeText(text).catch(() => {})
  }, [])

  return (
    <TuningPanel title="polymer tweaks" side="right" zIndex={200} onCopy={copyJson}>
      <TuningGroup title="body lighting" initialState="open">
        <div className="poly-preset-grid" role="group" aria-label="Body lighting model">
          {BODY_MODELS.map((item) => (
            <Button
              key={item.id}
              compact
              variant={body === item.id ? 'solid' : 'outline'}
              aria-pressed={body === item.id}
              onClick={() => {
                setBody(item.id)
                polymerTuning.body = item.id
                notifyPolymerTuning()
              }}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </TuningGroup>

      <TuningGroup title="material presets" initialState="open">
        <div className="poly-preset-grid">
          {POLYMER_PRESETS.map((item) => (
            <Button
              key={item.id}
              compact
              variant={preset === item.id ? 'solid' : 'outline'}
              onClick={() => {
                setPreset(item.id)
                applyPolymerPreset(item.id)
                bump((n) => n + 1)
              }}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </TuningGroup>

      <TuningGroup title="cushion & bevel" initialState="open">
        {GEOMETRY_KNOBS.map((k) => (
          <TuningSlider
            key={k.key}
            label={k.label}
            min={k.min}
            max={k.max}
            step={k.step}
            value={polymerTuning[k.key]}
            onValueChange={(v) => update(k.key, v)}
          />
        ))}
      </TuningGroup>

      <TuningGroup title="polymer finish" initialState="closed">
        {finishKnobs.map((k) => (
          <TuningSlider
            key={k.key}
            label={k.label}
            min={k.min}
            max={k.max}
            step={k.step}
            value={polymerTuning[k.key]}
            onValueChange={(v) => update(k.key, v)}
          />
        ))}
      </TuningGroup>

      <TuningGroup title="global light & shadow" initialState="open">
        {LIGHT_KNOBS.map((k) => (
          <TuningSlider
            key={k.key}
            label={k.label}
            min={k.min}
            max={k.max}
            step={k.step}
            value={polymerTuning[k.key]}
            onValueChange={(v) => update(k.key, v)}
          />
        ))}
      </TuningGroup>
    </TuningPanel>
  )
}
