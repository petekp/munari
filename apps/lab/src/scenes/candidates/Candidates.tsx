// Candidates — seven prototypes of one question, on one bench.
//
// Each is a state change a component already has (pressed, selected, open,
// moved, being read, copied, deleted) handed to the other renderer for as
// long as the change lasts. They are here to be COMPARED, not shipped, so
// they share a page shell, a canvas, and a camera, and differ only in the
// deformation. Pick one from the rail; `?candidate=<id>` deep-links it.
//
// The one structural rule the shell exists to enforce: exactly one
// <SurfaceCanvas> is mounted, and every candidate declares its
// <Surface.WebGL> beside the DOM it presents. A page-declared presenter
// renders nothing where it is written and registers inward to the single
// mounted host (SurfaceWebGL.tsx), which is what lets each candidate be a
// self-contained file with no store, no portal, and no canvas of its own.
//
// Frameloop is 'always' here, unlike the scenes that earn their zero-paint
// gate: seven effects with seven independent clocks would each need to
// claim and release demand, and a bench is not the place to prove that.

import { useCallback, useEffect, useState } from 'react'
import { SurfaceCanvas } from '@petepetrash/munari'
import { PixelPerfect } from './candidateStage'
import { CandidateRipple } from './CandidateRipple'
import { CandidateBillow } from './CandidateBillow'
import { CandidateUnroll } from './CandidateUnroll'
import { CandidateDissolve } from './CandidateDissolve'
import { CandidateAnalyze } from './CandidateAnalyze'
import { CandidateCopy } from './CandidateCopy'
import { CandidateDelete } from './CandidateDelete'
import { CandidateTweaks } from './CandidateTweaks'
import './candidates.css'

const CANDIDATES = [
  { id: 'ripple', label: 'Ripple', blurb: 'a press, spent in the material', Body: CandidateRipple },
  { id: 'billow', label: 'Billow', blurb: 'the same press, one button alone', Body: CandidateBillow },
  { id: 'unroll', label: 'Unroll', blurb: 'a menu wound on a roll', Body: CandidateUnroll },
  { id: 'dissolve', label: 'Dissolve', blurb: 'a card as its own pixels', Body: CandidateDissolve },
  { id: 'analyze', label: 'Analyze', blurb: 'what the reader is holding', Body: CandidateAnalyze },
  { id: 'copy', label: 'Copy', blurb: 'the copy goes to the cursor', Body: CandidateCopy },
  { id: 'delete', label: 'Delete', blurb: 'melt, shatter, peel', Body: CandidateDelete },
] as const

type CandidateId = (typeof CANDIDATES)[number]['id']

const IDS = new Set<string>(CANDIDATES.map((c) => c.id))

function isCandidateId(value: string | null): value is CandidateId {
  return value !== null && IDS.has(value)
}

function readCandidate(): CandidateId {
  const q = new URLSearchParams(window.location.search).get('candidate')
  return isCandidateId(q) ? q : 'ripple'
}

export function CandidatesApp({ chips }: { chips?: React.ReactNode }) {
  const [id, setId] = useState<CandidateId>(readCandidate)

  const select = useCallback((next: CandidateId) => {
    const url = new URL(window.location.href)
    url.searchParams.set('scene', 'candidates')
    url.searchParams.set('candidate', next)
    window.history.pushState(null, '', url)
    setId(next)
  }, [])

  useEffect(() => {
    const pop = () => setId(readCandidate())
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }, [])

  const current = CANDIDATES.find((c) => c.id === id) ?? CANDIDATES[0]
  const Body = current.Body

  return (
    <div className="cand-app">
      {/* Keyed on the candidate: switching tears every Surface in the old
          one down rather than reusing handles across two different sets of
          content, which would hand a presenter a texture of the wrong
          size mid-crossing. */}
      <Body key={current.id} />

      <nav className="cand-rail" aria-label="candidates">
        {CANDIDATES.map((c) => (
          <button
            key={c.id}
            type="button"
            data-on={c.id === id || undefined}
            aria-current={c.id === id ? 'page' : undefined}
            onClick={() => select(c.id)}
          >
            <strong>{c.label}</strong>
            <span>{c.blurb}</span>
          </button>
        ))}
      </nav>

      <SurfaceCanvas
        pointerMode="surfaces"
        style={{ position: 'fixed', inset: 0, zIndex: 40 }}
        gl={{ alpha: true, antialias: true }}
        // No dpr clamp: PixelPerfect owns render density and follows the
        // live devicePixelRatio, browser zoom included.
        camera={{ fov: 42, position: [0, 0, 1000] }}
        onCreated={(state) => {
          // The page under the canvas IS the background; a cleared opaque
          // frame would hide every candidate's own DOM.
          state.gl.setClearAlpha(0)
          // The bench's one probe seam: a smoke check asks the scene how
          // many presentations are actually standing, which is the only
          // way to tell a registered presenter from a silently dropped one.
          window.__r3f = state
        }}
      >
        <PixelPerfect />
      </SurfaceCanvas>

      <CandidateTweaks id={id} />
      {chips}
    </div>
  )
}
