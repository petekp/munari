import {
  WORDMARK_DEFAULTS,
  type WordmarkOptions,
} from "../../components/wordmark/wordmarkAnimation";

export interface WordmarkTuning extends WordmarkOptions {
  base: number;
}

export const wordmarkTuning: Readonly<WordmarkTuning> = Object.freeze({
  base: 64,
  ...WORDMARK_DEFAULTS,
});

export function toWordmarkOptions(tuning: WordmarkTuning): WordmarkOptions {
  const { base: _base, ...options } = tuning;
  return options;
}

interface WordmarkControl {
  key: keyof WordmarkTuning;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

interface WordmarkControlGroup {
  key: "frame" | "cadence" | "motion";
  title: string;
  description: string;
  controls: readonly WordmarkControl[];
}

export const WORDMARK_GROUPS: readonly WordmarkControlGroup[] = [
  {
    key: "frame",
    title: "Size",
    description: "Preview the logo at different sizes.",
    controls: [
      { key: "base", label: "Size", min: 16, max: 96, step: 1, unit: "px" },
    ],
  },
  {
    key: "cadence",
    title: "Morphing",
    description:
      "Each letter has its own timing, with variation around these values.",
    controls: [
      {
        key: "morphMs",
        label: "Morph duration",
        min: 200,
        max: 2200,
        step: 50,
        unit: "ms",
      },
      {
        key: "restMs",
        label: "Rest between morphs",
        min: 100,
        max: 4000,
        step: 100,
        unit: "ms",
      },
    ],
  },
  {
    key: "motion",
    title: "Movement",
    description: "Floating and pointer response, relative to letter size.",
    controls: [
      { key: "float", label: "Float", min: 0, max: 0.15, step: 0.005 },
      { key: "depth", label: "Depth bob", min: 0, max: 0.6, step: 0.01 },
      { key: "dodge", label: "Mouse dodge", min: 0, max: 0.6, step: 0.01 },
    ],
  },
];

export function normalizeWordmarkTuning(raw: WordmarkTuning): WordmarkTuning {
  const next = { ...wordmarkTuning };
  for (const group of WORDMARK_GROUPS)
    for (const control of group.controls) {
      const value = raw[control.key];
      if (Number.isFinite(value))
        next[control.key] = Math.min(control.max, Math.max(control.min, value));
    }
  return next;
}
