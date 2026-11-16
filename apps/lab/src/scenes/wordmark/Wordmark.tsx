import { useMemo, useState } from "react";
import { MunariLogo } from "../../components/MunariLogo";
import { WordmarkTweaks } from "./wordmarkTweaks";
import { toWordmarkOptions, wordmarkTuning } from "./wordmarkTuning";
import "./wordmark.css";

export function WordmarkApp() {
  const [tuning, setTuning] = useState(wordmarkTuning);
  const options = useMemo(() => toWordmarkOptions(tuning), [tuning]);

  return (
    <div className="wordmark-page">
      <div
        className="wordmark-stage"
        // SAFETY: CSSProperties has no index for custom properties; the
        // browser accepts any `--name` and munariLogo.css reads this one.
        style={{ "--wordmark-base": `${tuning.base}px` } as React.CSSProperties}
      >
        <MunariLogo options={options} />
      </div>
      <p className="wordmark-context">Each letter moves independently.</p>
      <WordmarkTweaks
        tuning={tuning}
        onTuningChange={setTuning}
        onReset={() => setTuning(wordmarkTuning)}
      />
    </div>
  );
}
