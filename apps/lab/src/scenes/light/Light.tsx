// Light — a selectable headline lit by one draggable lamp.
// The page scrolls inside the demo viewport; the bulb stays in its overlay.
// Native fallback keeps the same headline without the lighting canvases.
import { useMemo, useRef } from 'react'
import { LightLamp } from './LightLamp'
import { LightHeadline } from './LightHeadline'
import { useLightOpening } from './lightOpening'
import { createLightFlyerStore } from './lightFlyer'
import { DemoHost } from '../../components/DemoHost'
import '../../components/lit.css'
import './light.css'

export function LightApp() {
  return <DemoHost className="light-theme"><LightPage /></DemoHost>
}

function LightPage() {
  const pageRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLElement>(null)
  const opening = useLightOpening()
  // No postcard on this page, so the flyer store stays empty.
  const flyer = useMemo(createLightFlyerStore, [])
  return (
    <div ref={pageRef} data-page-ready={opening.ready || undefined} className="light-page absolute inset-0 overflow-y-auto overscroll-contain">
      <main ref={innerRef} className="light-inner mx-auto max-w-[1260px]">
        <LightLamp flyer={flyer} pageRef={pageRef} innerRef={innerRef} effectsEnabled={opening.effectsEnabled} onReady={opening.onReady}>
          {content => <LightHeadline {...content} />}
        </LightLamp>
      </main>
    </div>
  )
}
