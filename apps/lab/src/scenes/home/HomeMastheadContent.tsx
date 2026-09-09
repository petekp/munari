// Masthead content — native type, one retained postcard, and the light controls.
// The rendering owner reads these refs; the text itself stays in the page.
// Native selection supplies both direct selection and the keyboard shortcut (#50).
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
        <h1 ref={headingRef} className="home-masthead-title" aria-label="HTML, 3D, and Shaders, Unified.">
          <span ref={lineRefs[0]}>HTML, 3D,</span>
          <span ref={lineRefs[1]}>and Shaders,</span>
          <span ref={lineRefs[2]} className="home-masthead-em">Unified.</span>
        </h1>
        <div className="home-masthead-body">
          {children}
          <div className="home-masthead-details">
        <p className="home-masthead-copy">
          A page you can touch. A scene you can type in.
          Move the light, select the words, and lift the postcard.
          It is all still HTML.
        </p>
        <div className="home-masthead-links">
          <a className="home-btn home-btn--primary" href="#examples" data-relief="raised">See it work <span aria-hidden>↓</span></a>
          <a className="home-text-link" href="#how-it-works">How it works</a>
        </div>
        {!degraded && <label className="home-light-height">
          <span>Distance from the page</span>
          <span className="home-light-height-range"><span>Near</span><input aria-label="Distance from the page" type="range" min={220} max={600} step={1} value={lightHeight} onChange={event => onLightHeight(Number(event.target.value))}/><span>Far</span></span>

        </label>}
        {!degraded && <button className="home-select-word" type="button" onClick={() => {
          const word = lineRefs[2].current
          if (!word) return
          const range = document.createRange()
          range.selectNodeContents(word)
          const nativeSelection = document.getSelection()
          nativeSelection?.removeAllRanges()
          nativeSelection?.addRange(range)
        }}>Select “Unified.”</button>}
          </div>
        </div>
      </header>
  )
}
