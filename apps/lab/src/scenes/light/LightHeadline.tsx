// Headline content — the lit headline, its introduction, and the light's controls.
// Native text retains layout and selection; the lamp reads these refs.
import type { CSSProperties } from 'react'
import { TextButton } from '@/components/system'
import type { LightContent } from './LightLamp'

// The distance slider is the system slider's markup written out: the library
// Slider cannot carry the aria-label the light instrument focuses by.
const LIGHT_HEIGHT_MIN = 220
const LIGHT_HEIGHT_MAX = 600

export function LightHeadline({ mastheadRef, headingRef, lineRefs, lightHeight, onLightHeight, degraded }: LightContent) {
  const sliderStyle: CSSProperties & { '--m-value': string } = {
    '--m-value': `${((lightHeight - LIGHT_HEIGHT_MIN) / (LIGHT_HEIGHT_MAX - LIGHT_HEIGHT_MIN)) * 100}%`,
  }
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
            <label className="m-slider light-height" style={sliderStyle}>
              <span className="m-slider-head"><span className="m-small">Light distance</span><span className="m-slider-value m-readout">{lightHeight} px</span></span>
              <span className="m-slider-control">
                <input aria-label="Distance from the page" type="range" min={LIGHT_HEIGHT_MIN} max={LIGHT_HEIGHT_MAX} step={1} value={lightHeight} onChange={event => onLightHeight(Number(event.target.value))} />
                <span className="m-slider-track m-ruler" aria-hidden />
                <span className="m-slider-fill" aria-hidden />
                <span className="m-slider-thumb" aria-hidden />
              </span>
              <span className="m-slider-ends m-readout" aria-hidden><span>{LIGHT_HEIGHT_MIN}</span><span>{LIGHT_HEIGHT_MAX}</span></span>
            </label>
            <TextButton className="light-select-word" onClick={() => {
              const word = lineRefs[2].current
              if (!word) return
              const range = document.createRange()
              range.selectNodeContents(word)
              const selection = document.getSelection()
              selection?.removeAllRanges()
              selection?.addRange(range)
            }}>Select “Unified.”</TextButton>
          </div>
        )}
      </div>
    </header>
  )
}
