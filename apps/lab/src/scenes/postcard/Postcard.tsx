// Postcard — a live HTML form that lifts off the page as bending paper.
// The lamp lights the page and the card, so the card casts its shadow in both
// presentations; the form keeps its React state through every handoff.
import { useMemo, useRef } from 'react'
import { useSurfaceSupport } from '@petepetrash/munari'
import { LightLamp } from '../light/LightLamp'
import { useLightOpening } from '../light/lightOpening'
import { useLightReducedMotion } from '../light/lightMotion'
import { createLightFlyerStore } from '../light/lightFlyer'
import { PostcardStage } from './PostcardStage'
import { DemoHost, useDemoViewport } from '../../components/DemoHost'
import '../../components/lit.css'
import '../light/light.css'
import './postcard.css'

export function PostcardApp() {
  return <DemoHost className="light-theme"><PostcardPage /></DemoHost>
}

function PostcardPage() {
  const supported = useSurfaceSupport()
  const reduced = useLightReducedMotion()
  const viewportRef = useDemoViewport()
  const pageRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLElement>(null)
  const opening = useLightOpening()
  const flyer = useMemo(createLightFlyerStore, [])
  return (
    <div ref={pageRef} data-page-ready={opening.ready || undefined} className="light-page absolute inset-0 overflow-y-auto overscroll-contain">
      <main ref={innerRef} className="light-inner mx-auto max-w-[1260px]">
        <LightLamp flyer={flyer} pageRef={pageRef} innerRef={innerRef} effectsEnabled={opening.effectsEnabled} onReady={opening.onReady}>
          {({ mastheadRef }) => (
            <section ref={mastheadRef} className="postcard-page" aria-label="A live postcard">
              <PostcardStage flyer={flyer} viewportRef={viewportRef} supported={supported && !opening.native} reduced={reduced} effectsEnabled={opening.effectsEnabled} />
            </section>
          )}
        </LightLamp>
      </main>
    </div>
  )
}
