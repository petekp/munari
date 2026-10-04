// Headline content — the lit headline, its introduction, and the light's controls.
// Native text retains layout and selection; the lamp reads these refs.
import type { LightContent } from './LightLamp'

export function LightHeadline({ mastheadRef, headingRef, lineRefs, lightHeight, onLightHeight, degraded }: LightContent) {
  return (
    <header ref={mastheadRef} className="light-masthead relative pt-24 @max-[1050px]/demo:pt-[84px] @max-[760px]/demo:pt-14">
      <h1 ref={headingRef} className="light-masthead-title" aria-label="HTML, 3D, and Shaders, Unified.">
        <span ref={lineRefs[0]}><span className="light-headline-html">{'<html>'}</span>, <span className="light-headline-3d">3D</span>,</span>
        <span ref={lineRefs[1]}>and <span className="light-headline-shaders">Shaders</span>,</span>
        <span ref={lineRefs[2]} className="light-masthead-em">Unified.</span>
      </h1>
      <div className="light-masthead-details">
        <p className="light-masthead-copy">
          The headline is selectable HTML. A lamp above the page casts its shadows, and the bulb’s glass bends the live page behind it.
        </p>
        {!degraded && (
          <div className="light-masthead-tools">
            <label className="light-height">
              <span>Light distance</span>
              <span className="light-height-range flex items-center gap-3">
                <span>Near</span>
                <input aria-label="Distance from the page" type="range" min={220} max={600} step={1} value={lightHeight} onChange={event => onLightHeight(Number(event.target.value))} />
                <span>Far</span>
              </span>
            </label>
            <button className="light-select-word" type="button" onClick={() => {
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
