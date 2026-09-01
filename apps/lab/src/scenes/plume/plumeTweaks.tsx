// Plume controls — the plume scene's schema for the shared tweak panel.
//
// Ownership: Plume.tsx owns the text, tuning, and effects. This file owns
// turning PLUME_GROUPS into the shared panel's schema and the bespoke
// content (effects, typeface/release-unit selects, text actions, status)
// no tuning field covers; the panel itself (disclosure, drafts, copy,
// persistence) lives in components/tweakPanel.tsx.

import {
  normalizePlumeInput,
  normalizePlumeTuning,
  PLUME_GROUPS,
  type PlumeControl,
  type PlumeEffects,
  type PlumeTuning,
} from './plumeTuning'
import { TweakColorField, TweakPanel, type TweakControl, type TweakGroup } from '../../components/tweakPanel'
import './plumeTweaks.css'

interface PlumeTweaksProps {
  readonly tuning: PlumeTuning
  readonly onTuningChange: (next: PlumeTuning) => void
  readonly onReset: () => void
  readonly effects: PlumeEffects
  readonly onToggle: (key: keyof PlumeEffects) => void
  readonly onRestore: () => void
  readonly onClear: () => void
  readonly supported: boolean
  readonly reduced: boolean
  readonly animating: boolean
}

const EFFECTS: readonly {
  readonly key: keyof PlumeEffects
  readonly label: string
  readonly detail: string
}[] = [
  { key: 'wisps', label: 'Updraft', detail: 'lift particles in curling air' },
  { key: 'afterglow', label: 'Ghost ink', detail: 'leave a faint impression' },
  { key: 'embers', label: 'Sparks', detail: 'catch a few warm particles' },
  { key: 'draft', label: 'Draft', detail: 'let the pointer bend the air' },
]

function toTweakControl(control: PlumeControl, tuning: PlumeTuning, onTuningChange: (next: PlumeTuning) => void): TweakControl {
  const factor = control.displayScale ?? 1
  const displayStep = Number((control.step * factor).toPrecision(12))
  return {
    id: control.key,
    label: control.label,
    min: control.min * factor,
    max: control.max * factor,
    step: displayStep,
    unit: control.unit,
    value: tuning[control.key] * factor,
    onChange: (next) => {
      const normalized = normalizePlumeInput(control, next / factor)
      if (normalized !== null) onTuningChange({ ...tuning, [control.key]: normalized })
    },
    numberAttrs: { 'data-tuning-key': control.key, 'data-plume-number': control.key },
    rangeAttrs: { 'data-tuning-key': control.key, 'data-plume-range': control.key },
  }
}

export function PlumeTweaks({
  tuning,
  onTuningChange,
  onReset,
  effects,
  onToggle,
  onRestore,
  onClear,
  supported,
  reduced,
  animating,
}: PlumeTweaksProps) {
  function update<Key extends keyof PlumeTuning>(key: Key, value: PlumeTuning[Key]) {
    onTuningChange({ ...tuning, [key]: value })
  }

  const status = !supported
    ? 'HTML-in-canvas is unavailable. The text uses a quiet dissolve.'
    : reduced
      ? 'Reduced motion is on. Ink dissolves in place.'
      : animating
        ? 'Ink is in the air.'
        : 'Ready for your next word.'

  const groups: readonly TweakGroup[] = PLUME_GROUPS.map((group) => {
    const controls = group.controls.map((control) => toTweakControl(control, tuning, onTuningChange))
    let extra = null
    if (group.key === 'type') {
      extra = (
        <>
          <label className="tweak-select">
            <span>Typeface</span>
            <select
              value={tuning.fontFamily}
              data-tuning-key="fontFamily"
              data-plume-font
              onChange={(event) => {
                const value = event.target.value
                if (value === 'serif' || value === 'sans' || value === 'mono') update('fontFamily', value)
              }}
            >
              <option value="serif">Bodoni Moda · Serif</option>
              <option value="sans">Archivo · Sans serif</option>
              <option value="mono">Courier Prime · Mono</option>
            </select>
          </label>
          {tuning.fontFamily === 'mono' ? (
            <p className="tweak-group-description">Courier Prime has regular and bold weights.</p>
          ) : null}
        </>
      )
    } else if (group.key === 'timing') {
      extra = (
        <label className="tweak-select">
          <span>Release unit</span>
          <select
            value={tuning.releaseUnit}
            data-tuning-key="releaseUnit"
            data-plume-release-unit
            onChange={(event) => {
              const value = event.target.value
              if (value === 'word' || value === 'character') update('releaseUnit', value)
            }}
          >
            <option value="word">Whole words</option>
            <option value="character">Single characters</option>
          </select>
        </label>
      )
    } else if (group.key === 'color' && group.colors) {
      extra = (
        <>
          {group.colors.map((control) => (
            <TweakColorField
              key={control.key}
              id={control.key}
              label={control.label}
              value={tuning[control.key]}
              onChange={(value) => update(control.key, value)}
              swatchAttrs={{ 'data-tuning-key': control.key, 'data-plume-color': control.key }}
              hexAttrs={{ 'data-plume-color-hex': control.key }}
            />
          ))}
        </>
      )
    }
    return { key: group.key, title: group.title, description: group.description, extra, controls }
  })

  return (
    <TweakPanel
      title="Plume controls"
      idPrefix="plume"
      groups={groups}
      tuning={tuning}
      onReset={onReset}
      storageKey="munari-lab-plume-tuning"
      normalizeTuning={normalizePlumeTuning}
      onApplyStored={onTuningChange}
      openerLabel={
        <>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 5h12M2 11h12M6 3v4m4 2v4" />
          </svg>
          Tweak Plume
        </>
      }
      openerAttrs={{ 'data-plume-controls-opener': '' }}
      rootAttrs={{ 'data-plume-controls': '' }}
      closeAriaLabel="Close Plume controls"
      closerAttrs={{ 'data-plume-controls-close': '' }}
      resetAttrs={{ 'data-plume-reset': '' }}
      copyAttrs={{ 'data-plume-copy': '' }}
      afterGroups={<p className="plume-status" role="status">{status}</p>}
    >
      <div className="plume-actions">
        <button type="button" data-plume-restore onClick={onRestore}>Restore text</button>
        <button type="button" data-plume-clear onClick={onClear}>Clear</button>
      </div>
      <p className="plume-controls-help">
        Words stay editable after they fade. Type, timing, and spacing edits replay them.
        Other edits apply live, or replay when idle.
      </p>
      <fieldset className="plume-effects">
        <legend>Effects</legend>
        {EFFECTS.map((effect) => (
          <label key={effect.key} className="plume-effect">
            <input type="checkbox" checked={effects[effect.key]} onChange={() => onToggle(effect.key)} />
            <span>
              <strong>{effect.label}</strong>
              <small>{effect.detail}</small>
            </span>
          </label>
        ))}
      </fieldset>
    </TweakPanel>
  )
}
