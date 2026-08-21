// Candidate 8 — one button, nothing else on the bench.
//
// The ripple mechanism exactly as Ripple runs it, isolated to a single
// primary CTA so the press can be judged with no card, no neighbours, and
// no competing type. Same target, same tuning bag, same knobs.

import { RippleTarget } from './CandidateRipple'

export function CandidateBillow() {
  return (
    <div className="cand-page cand-page--center">
      <RippleTarget
        name="billow-primary"
        content={
          <button type="button" className="cand-btn cand-btn--primary cand-btn--billow">
            Billow
          </button>
        }
      />
    </div>
  )
}
