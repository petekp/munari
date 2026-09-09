// Masthead content — one introduction beside a live postcard and its controls.
// Native text retains layout and selection; the rendering owner reads these refs.
import type { ReactNode, RefObject } from 'react'

interface Props {
  mastheadRef: RefObject<HTMLElement | null>
  headingRef: RefObject<HTMLHeadingElement | null>
  lineRefs: readonly [RefObject<HTMLSpanElement | null>, RefObject<HTMLSpanElement | null>, RefObject<HTMLSpanElement | null>]
  lightHeight: number
  onLightHeight: (height: number) => void
  degraded: boolean
  children: ReactNode
}

export function HomeMastheadContent({ mastheadRef, headingRef, lineRefs, lightHeight, onLightHeight, degraded, children }: Props) {
  return (
    <header ref={mastheadRef} className="home-masthead">
      <div className="home-masthead-intro">
        <h1 ref={headingRef} className="home-masthead-title" aria-label="HTML, 3D, and Shaders, Unified.">
          <span ref={lineRefs[0]}><span className="home-headline-html">{'<html>'}</span>, <span className="home-headline-3d">3D</span>,</span>
          <span ref={lineRefs[1]}>and <span className="home-headline-shaders">Shaders</span>,</span>
          <span ref={lineRefs[2]} className="home-masthead-em">Unified.</span>
        </h1>
        <div className="home-masthead-details">
          <p className="home-masthead-copy">
            Bring live HTML into 3D scenes. Buttons, fields, and text keep working.
          </p>
          <nav className="home-masthead-links" aria-label="Explore Munari">
            <a className="home-text-link" href="#examples">Explore examples <span aria-hidden>↓</span></a>
            <a className="home-text-link" href="#how-it-works">How it works</a>
          </nav>
        </div>
      </div>
      <div className="home-masthead-demo">
        {children}
        {!degraded && (
          <div className="home-masthead-tools">
            <label className="home-light-height">
              <span>Light distance</span>
              <span className="home-light-height-range">
                <span>Near</span>
                <input aria-label="Distance from the page" type="range" min={220} max={600} step={1} value={lightHeight} onChange={event => onLightHeight(Number(event.target.value))} />
                <span>Far</span>
              </span>
            </label>
            <button className="home-select-word" type="button" onClick={() => {
              const word = lineRefs[2].current
              if (!word) return
              const range = document.createRange()
              range.selectNodeContents(word)
              const selection = document.getSelection()
              selection?.removeAllRanges()
              selection?.addRange(range)
            }}>Select “Unified.”</button>
          </div>
        )}
      </div>
    </header>
  )
}
