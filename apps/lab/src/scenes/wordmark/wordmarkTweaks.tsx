import {
  TweakPanel,
  type TweakControl,
  type TweakGroup,
} from "../../components/tweakPanel";
import {
  WORDMARK_GROUPS,
  normalizeWordmarkTuning,
  type WordmarkTuning,
} from "./wordmarkTuning";

interface WordmarkTweaksProps {
  readonly tuning: WordmarkTuning;
  readonly onTuningChange: (next: WordmarkTuning) => void;
  readonly onReset: () => void;
}

export function WordmarkTweaks({
  tuning,
  onTuningChange,
  onReset,
}: WordmarkTweaksProps) {
  const groups: readonly TweakGroup[] = WORDMARK_GROUPS.map((group) => ({
    key: group.key,
    title: group.title,
    description: group.description,
    initiallyOpen: group.key === "cadence",
    controls: group.controls.map((control): TweakControl => ({
      id: control.key,
      label: control.label,
      min: control.min,
      max: control.max,
      step: control.step,
      unit: control.unit,
      value: tuning[control.key],
      onChange: (next) => onTuningChange({ ...tuning, [control.key]: next }),
      numberAttrs: { "data-tuning-key": control.key },
      rangeAttrs: { "data-tuning-key": control.key },
    })),
  }));

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
    />
  );
}
