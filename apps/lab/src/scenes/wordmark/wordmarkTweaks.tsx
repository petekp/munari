// Wordmark controls — the bench's schema for the shared tweak panel.
//
// Ownership: wordmarkTuning.ts owns keys, ranges, and normalization;
// this file only turns WORDMARK_GROUPS into panel props. The copied
// snippet is the whole bench bag — drop `base` and spread the rest over
// LOGO_DEFAULTS to update WORDMARK_KNOBS (components/MunariLogo.tsx).

import { TweakPanel, type TweakControl, type TweakGroup } from '../../components/tweakPanel'
import {
  WORDMARK_GROUPS,
  normalizeWordmarkTuning,
  type WordmarkTuning,
} from './wordmarkTuning'

interface WordmarkTweaksProps {
  readonly tuning: WordmarkTuning
  readonly onTuningChange: (next: WordmarkTuning) => void
  readonly onReset: () => void
  readonly lifted: boolean
}

export function WordmarkTweaks({ tuning, onTuningChange, onReset, lifted }: WordmarkTweaksProps) {
  const groups: readonly TweakGroup[] = WORDMARK_GROUPS.map((group) => ({
    key: group.key,
    title: group.title,
    description: group.description,
    initiallyOpen: group.key === 'cadence',
    controls: group.controls.map(
      (control): TweakControl => ({
        id: control.key,
        label: control.label,
        min: control.min,
        max: control.max,
        step: control.step,
        unit: control.unit,
        value: tuning[control.key],
        onChange: (next) => onTuningChange({ ...tuning, [control.key]: next }),
        numberAttrs: { 'data-tuning-key': control.key },
        rangeAttrs: { 'data-tuning-key': control.key },
      }),
    ),
  }))

  return (
    <TweakPanel
      title="Wordmark bench"
      eyebrow="Private view"
      idPrefix="wordmark"
      groups={groups}
      tuning={tuning}
      onReset={onReset}
      storageKey="munari-lab-wordmark-tuning"
      normalizeTuning={normalizeWordmarkTuning}
      onApplyStored={onTuningChange}
      initiallyOpen
      openerLabel="Tweak wordmark"
      closeAriaLabel="Close wordmark controls"
      footerHint={
        lifted
          ? 'Copy values, then paste over WORDMARK_KNOBS in MunariLogo.tsx (drop `base`).'
          : 'HTML-in-canvas is off here — the matter group has nothing to show.'
      }
    />
  )
}
