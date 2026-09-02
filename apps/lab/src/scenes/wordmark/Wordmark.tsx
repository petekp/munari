// Wordmark bench — the official mark on its own ink, with dials.
//
// The law: what renders here is the very component every real host
// mounts (components/MunariLogo.tsx), fed a live knob bag — not a copy
// of its markup. A bench that re-implemented the mark would tune the
// re-implementation. Unlisted on purpose: reachable at ?scene=wordmark,
// never advertised in the nav (App.tsx NAV_SCENES).
//
// Ownership: this file owns the ground and the wiring; ranges live in
// wordmarkTuning.ts, the panel in wordmarkTweaks.tsx.

import { useMemo, useState } from 'react'
import { useSupportsDOMSurfaces } from '@petepetrash/munari'
import { MunariLogo } from '../../components/MunariLogo'
import { WordmarkTweaks } from './wordmarkTweaks'
import { toLogoKnobs, wordmarkTuning } from './wordmarkTuning'
import './wordmark.css'

export function WordmarkApp() {
  const [tuning, setTuning] = useState(wordmarkTuning)
  const knobs = useMemo(() => toLogoKnobs(tuning), [tuning])
  const lifted = useSupportsDOMSurfaces()

  return (
    <div className="wordmark-page">
      <div
        className="wordmark-stage"
        // SAFETY: CSSProperties has no index for custom properties; the
        // browser accepts any `--name` and munariLogo.css reads this one.
        style={{ '--wordmark-base': `${tuning.base}px` } as React.CSSProperties}
      >
        <MunariLogo knobs={knobs} />
      </div>
      <p className="wordmark-context">
        the mark at nav scale, on the console's ink
      </p>
      <WordmarkTweaks
        tuning={tuning}
        onTuningChange={setTuning}
        onReset={() => setTuning(wordmarkTuning)}
        lifted={lifted}
      />
    </div>
  )
}
