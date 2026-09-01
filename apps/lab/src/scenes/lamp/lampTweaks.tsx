// Lamp controls — the lamp scene's schema for the shared tweak panel.
//
// Ownership: Lamp.tsx owns the tuning state and what each field does to
// the render. This file owns turning LAMP_GROUPS into the shared panel's
// schema; the panel itself (disclosure, drafts, copy, persistence) lives
// in components/tweakPanel.tsx.

import {
  LAMP_GROUPS,
  normalizeLampInput,
  normalizeLampTuning,
  type LampControl,
  type LampTuning,
} from './lampTuning'
import { TweakPanel, type TweakControl, type TweakGroup } from '../../components/tweakPanel'

interface LampTweaksProps {
  readonly tuning: LampTuning
  readonly onTuningChange: (next: LampTuning) => void
  readonly onReset: () => void
}

function toTweakControl(control: LampControl, tuning: LampTuning, onTuningChange: (next: LampTuning) => void): TweakControl {
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
      const normalized = normalizeLampInput(control, next / factor)
      if (normalized !== null) onTuningChange({ ...tuning, [control.key]: normalized })
    },
    numberAttrs: { 'data-tuning-key': control.key, 'data-lamp-number': control.key },
    rangeAttrs: { 'data-tuning-key': control.key, 'data-lamp-range': control.key },
  }
}

export function LampTweaks({ tuning, onTuningChange, onReset }: LampTweaksProps) {
  const groups: readonly TweakGroup[] = LAMP_GROUPS.map((group) => ({
    key: group.key,
    title: group.title,
    description: group.description,
    initiallyOpen: group.key === 'flame',
    controls: group.controls.map((control) => toTweakControl(control, tuning, onTuningChange)),
  }))

  return (
    <TweakPanel
      title="Lamp controls"
      idPrefix="lamp"
      groups={groups}
      tuning={tuning}
      onReset={onReset}
      storageKey="munari-lab-lamp-tuning"
      normalizeTuning={normalizeLampTuning}
      onApplyStored={onTuningChange}
      openerLabel={
        <>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 5h12M2 11h12M6 3v4m4 2v4" />
          </svg>
          Tweak Lamp
        </>
      }
      openerAttrs={{ 'data-lamp-controls-opener': '' }}
      rootAttrs={{ 'data-lamp-controls': '' }}
      closeAriaLabel="Close Lamp controls"
      closerAttrs={{ 'data-lamp-controls-close': '' }}
      resetAttrs={{ 'data-lamp-reset': '' }}
      copyAttrs={{ 'data-lamp-copy': '' }}
    />
  )
}
