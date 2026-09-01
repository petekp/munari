// Rain — weather that only knows where the page is.
//
// The law: the overlay measures real boxes and drops water on them; it
// never reads what the boxes say. This file owns the boxes — a small,
// static magazine page — and nothing about their content. Swap every word
// below for different words and the rain does not need to change.
//
// Ownership: this component owns the native layout and the reduced-motion
// query. RainField owns the canvas and the physics; rainLaw owns the water.

import { useEffect, useRef, useState } from 'react'
import { RainField } from './rainField'
import './rain.css'

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) return
    const change = () => setReduced(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  return reduced
}

export function RainApp() {
  const articleRef = useRef<HTMLElement>(null)
  const reducedMotion = useReducedMotion()

  return (
    <div className="rain-app">
      <article className="rain-page" ref={articleRef}>
        <h1>Overcast, and holding</h1>
        <p className="rain-lede">
          The forecast has stopped promising anything better than this: a flat grey ceiling,
          no wind to speak of, and the kind of light that makes every surface look
          exactly as old as it is. Nobody minds. A city under a held sky gets on with itself.
        </p>
        <div className="rain-row">
          <div className="rain-card">
            <h2>The roofline</h2>
            <p>Water finds the same six ledges it found yesterday, and sits there
              until it doesn&rsquo;t.</p>
          </div>
          <div className="rain-card">
            <h2>The gutter</h2>
            <p>Every bead is patient until it isn&rsquo;t large enough to keep
              being patient.</p>
          </div>
          <div className="rain-card">
            <h2>The street</h2>
            <p>What falls off the end of something was, a moment ago,
              sitting quite still.</p>
          </div>
        </div>
        <p className="rain-tail">
          None of this is unusual. It is only weather, moving across a page the way it
          moves across anything else with edges — gathering where the edges stop it,
          leaving where they don&rsquo;t.
        </p>
      </article>
      <RainField articleRef={articleRef} reducedMotion={reducedMotion} />
      <p className="rain-hint">It rains on the layout. The boxes are the ledges.</p>
    </div>
  )
}
