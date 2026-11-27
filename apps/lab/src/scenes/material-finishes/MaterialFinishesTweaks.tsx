// Live tuning panel for the material finishes prototype — outside the canvas.
//
// Each knob writes a changed copy of the live finish, so a layer the finish
// lacks is added by its knob, at the defaults below, and the material that
// wears it rebuilds once; after that a knob is a uniform write.

import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import type { FinishValues, SurfaceFinish } from '@petepetrash/munari'
import { Button } from '../../components/system'
import { TuningGroup, TuningPanel, TuningSlider } from '../../components/TuningPanel'
import {
  applyFinish,
  liveFinish,
  notifyFinishTuning,
  placeKey,
  setLiveFinish,
  studio,
  subscribeFinishTuning,
  type FinishId,
  type LightRig,
  type StudioTuning,
} from './materialFinishesTuning'

type BaseNumber = 'roughness' | 'metalness' | 'ior' | 'specularIntensity' | 'emissiveIntensity' | 'lightGain'
type Layer = 'coat' | 'sheen' | 'anisotropy' | 'film' | 'scatter' | 'crackle'
type StudioNumber = Exclude<keyof StudioTuning, 'keyX' | 'keyY'>

interface Knob<Key> {
  readonly key: Key
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
}

// A layer's values when its knob first adds it: amount 0 and the rest at
// the neutral values the lab started each from (KHR_materials_iridescence's
// IOR 1.3 and 400 nm for the film).
const LAYER_START = {
  coat: { amount: 0, roughness: 0 },
  sheen: { amount: 0, color: '#000000', roughness: 1 },
  anisotropy: { amount: 0, rotation: 0 },
  film: { amount: 0, ior: 1.3, thickness: 400, variation: 0, scale: 200 },
  scatter: { amount: 0 },
  crackle: { amount: 0, scale: 40 },
} as const satisfies { readonly [L in Layer]: NonNullable<FinishValues[L]> }

// Slider ranges span three's valid range for each property, so a knob can
// leave a finish's catalog range (docs/materials-research-catalog.md §1).
const BASE_KNOBS: readonly Knob<BaseNumber>[] = [
  { key: 'roughness', label: 'roughness', min: 0, max: 1, step: 0.01 },
  { key: 'metalness', label: 'metalness', min: 0, max: 1, step: 0.01 },
  { key: 'ior', label: 'ior', min: 1, max: 2.333, step: 0.01 },
  { key: 'specularIntensity', label: 'base specular', min: 0, max: 1, step: 0.01 },
  { key: 'lightGain', label: 'light gain', min: 0, max: 6, step: 0.05 },
]

// The library's NEUTRAL_FINISH values, which a finish that leaves a field out wears.
const NEUTRAL_BASE = { roughness: 0.55, metalness: 0, ior: 1.5, specularIntensity: 1, emissiveIntensity: 0, lightGain: 1 } as const satisfies { readonly [K in BaseNumber]: number }

interface LayerGroup {
  readonly layer: Layer
  readonly title: string
  readonly knobs: readonly Knob<string>[]
}

const LAYER_GROUPS: readonly LayerGroup[] = [
  { layer: 'coat', title: 'clearcoat', knobs: [{ key: 'amount', label: 'clearcoat', min: 0, max: 1, step: 0.01 }, { key: 'roughness', label: 'coat roughness', min: 0, max: 1, step: 0.01 }] },
  { layer: 'sheen', title: 'sheen', knobs: [{ key: 'amount', label: 'sheen', min: 0, max: 1, step: 0.01 }, { key: 'roughness', label: 'sheen roughness', min: 0, max: 1, step: 0.01 }] },
  { layer: 'scatter', title: 'subsurface', knobs: [{ key: 'amount', label: 'scatter', min: 0, max: 1, step: 0.01 }] },
  { layer: 'anisotropy', title: 'anisotropy', knobs: [{ key: 'amount', label: 'anisotropy', min: 0, max: 1, step: 0.01 }, { key: 'rotation', label: 'rotation (rad)', min: 0, max: Math.PI, step: 0.01 }] },
  {
    layer: 'film',
    title: 'thin film',
    knobs: [
      { key: 'amount', label: 'film', min: 0, max: 1, step: 0.01 },
      { key: 'ior', label: 'film ior', min: 1, max: 2.333, step: 0.01 },
      { key: 'thickness', label: 'film thickness (nm)', min: 100, max: 1000, step: 10 },
      { key: 'variation', label: 'film thinning', min: 0, max: 1, step: 0.01 },
      { key: 'scale', label: 'film pattern size (css px)', min: 10, max: 600, step: 5 },
    ],
  },
  { layer: 'crackle', title: 'crackle', knobs: [{ key: 'amount', label: 'crackle', min: 0, max: 1, step: 0.01 }, { key: 'scale', label: 'crackle size (css px)', min: 4, max: 120, step: 1 }] },
]

const KEY_KNOBS: readonly Knob<StudioNumber>[] = [
  { key: 'keyHeight', label: 'key height (css px)', min: 40, max: 900, step: 10 },
  { key: 'keyBrightness', label: 'key brightness', min: 0, max: 5, step: 0.05 },
]
const SOFTBOX_KNOBS: readonly Knob<StudioNumber>[] = [
  { key: 'softboxWidth', label: 'softbox width (css px)', min: 20, max: 600, step: 10 },
  { key: 'softboxHeight', label: 'softbox height (css px)', min: 20, max: 600, step: 10 },
]
const STUDIO_KNOBS: readonly Knob<StudioNumber>[] = [
  { key: 'rimBrightness', label: 'rim brightness', min: 0, max: 5, step: 0.05 },
  { key: 'rimElevation', label: 'rim elevation (deg)', min: 2, max: 60, step: 1 },
  { key: 'environmentIntensity', label: 'environment', min: 0, max: 3, step: 0.05 },
]

function layerValue(finish: SurfaceFinish, layer: Layer, key: string): number {
  const values: Readonly<Record<string, number | string>> = finish[layer] ?? LAYER_START[layer]
  return Number(values[key])
}

function withLayerValue(finish: SurfaceFinish, layer: Layer, key: string, value: number): SurfaceFinish {
  return { ...finish, [layer]: { ...(finish[layer] ?? LAYER_START[layer]), [key]: value } }
}

function ColorField({ label, value, onChange }: { readonly label: string; readonly value: string; readonly onChange: (next: string) => void }) {
  return (
    <label className="mf-color-field">
      <span>{label}</span>
      <input type="color" value={value} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)} />
    </label>
  )
}

export function MaterialFinishesTweaks({ finish, rig }: { readonly finish: FinishId; readonly rig: LightRig }) {
  const [, bump] = useState(0)
  useEffect(() => subscribeFinishTuning(() => bump((n) => n + 1)), [])
  const live = liveFinish()

  const setStudioValue = useCallback((key: StudioNumber, value: number) => {
    studio[key] = value
    placeKey(rig)
    notifyFinishTuning()
  }, [rig])
  const copyJson = useCallback(() => {
    void navigator.clipboard?.writeText(JSON.stringify({ finish: liveFinish(), studio }, null, 2)).catch(() => {})
  }, [])
  const edge = live.edge ?? { width: 0, rimColor: null }
  const studioKnobs = rig === 'softbox' ? [...KEY_KNOBS, ...SOFTBOX_KNOBS, ...STUDIO_KNOBS] : [...KEY_KNOBS, ...STUDIO_KNOBS]

  return (
    <TuningPanel title="finish tweaks" side="right" zIndex={200} onCopy={copyJson}>
      <TuningGroup title="colors" initialState="open">
        <ColorField label="Body" value={live.color ?? '#ffffff'} onChange={(color) => setLiveFinish({ ...live, color })} />
        <ColorField
          label="Sheen"
          value={live.sheen?.color ?? LAYER_START.sheen.color}
          onChange={(color) => setLiveFinish({ ...live, sheen: { ...(live.sheen ?? LAYER_START.sheen), color } })}
        />
        <Button compact variant="outline" onClick={() => applyFinish(finish)}>
          Reset finish
        </Button>
      </TuningGroup>
      <TuningGroup title="base" initialState="open">
        {BASE_KNOBS.map((knob) => (
          <TuningSlider
            key={knob.key}
            label={knob.label}
            min={knob.min}
            max={knob.max}
            step={knob.step}
            value={live[knob.key] ?? NEUTRAL_BASE[knob.key]}
            onValueChange={(value) => setLiveFinish({ ...live, [knob.key]: value })}
          />
        ))}
      </TuningGroup>
      <TuningGroup title="edge and relief" initialState="open">
        <TuningSlider
          label="edge width (css px)"
          min={0}
          max={120}
          step={0.5}
          value={edge.width}
          onValueChange={(width) => setLiveFinish({ ...live, edge: { ...edge, width } })}
        />
        {live.detail && (
          <>
            <TuningSlider
              label="relief size (css px)"
              min={0.5}
              max={160}
              step={0.5}
              value={live.detail.scale}
              onValueChange={(scale) => live.detail && setLiveFinish({ ...live, detail: { ...live.detail, scale } })}
            />
            <TuningSlider
              label="relief slope"
              min={0}
              max={2}
              step={0.005}
              value={live.detail.depth}
              onValueChange={(depth) => live.detail && setLiveFinish({ ...live, detail: { ...live.detail, depth } })}
            />
          </>
        )}
      </TuningGroup>
      {LAYER_GROUPS.map((group) => (
        <TuningGroup key={group.layer} title={group.title} initialState="open">
          {group.knobs.map((knob) => (
            <TuningSlider
              key={knob.key}
              label={knob.label}
              min={knob.min}
              max={knob.max}
              step={knob.step}
              value={layerValue(live, group.layer, knob.key)}
              onValueChange={(value) => setLiveFinish(withLayerValue(live, group.layer, knob.key, value))}
            />
          ))}
        </TuningGroup>
      ))}
      <TuningGroup title="light and environment" initialState="open">
        {studioKnobs.map((knob) => (
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
