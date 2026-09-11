// Overview — the lit masthead, a live example, a gallery, and a short path
// into the API. The postcard and its canvas scroll together; the lamp stays
// in the demo viewport. Native fallback keeps the same controlled content.
import { useEffect, useMemo, useRef } from 'react'
import { useSurfaceSupport } from '@petepetrash/munari'
import { HandoffSection } from './HomeHandoff'
import { HomePostcard } from './HomePostcard'
import { HomeMasthead } from './HomeMasthead'
import { ExamplesSection } from './HomeExamples'
import { SupportSection } from './HomeSupport'
import { TutorialSection } from './HomeTutorial'
import { useHomeReducedMotion } from './homeMotion'
import { useHomeOpening } from './homeOpening'
import { createHomeFlyerStore } from './homeFlyer'
import { DemoHost, useDemoViewport } from '../../components/DemoHost'
import { GUIDE_URL, SOURCE_ROOT } from '../../components/sceneCatalog'
import '../../components/lit.css'
import './home.css'

interface HomeProps { section?: string; onReady?: () => void }

export function HomeApp(props: HomeProps) {
  return <DemoHost className="home-demo"><HomePage {...props} /></DemoHost>
}

function HomePage({ section = '', onReady }: HomeProps) {
  const supported = useSurfaceSupport()
  const reduced = useHomeReducedMotion()
  const viewportRef = useDemoViewport()
  const pageRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLElement>(null)
  const opening = useHomeOpening(onReady)
  const flyer = useMemo(createHomeFlyerStore, [])

  useEffect(() => {
    if (!opening.ready) return
    if (!section) { pageRef.current?.scrollTo({ top: 0 }); return }
    pageRef.current?.querySelector(`#${CSS.escape(section)}`)?.scrollIntoView({ block: 'start' })
  }, [section, opening.ready])

  return (
    <div ref={pageRef} data-home-ready={opening.ready || undefined} className="home-page absolute inset-0 overflow-y-auto overscroll-contain">
      <main ref={innerRef} className="home-inner mx-auto max-w-[1260px]">
        <HomeMasthead flyer={flyer} pageRef={pageRef} innerRef={innerRef} effectsEnabled={opening.effectsEnabled} onReady={opening.onReady}>
          <HomePostcard flyer={flyer} viewportRef={viewportRef} supported={supported && !opening.native} reduced={reduced} effectsEnabled={opening.effectsEnabled} />
        </HomeMasthead>
        <ExamplesSection />
        <HandoffSection />
        <TutorialSection />
        <SupportSection />
        <footer className="home-footer">
          <div><b>munari</b><p>HTML, 3D, and Shaders, Unified.</p></div>
          <div>
            <a href={GUIDE_URL} target="_blank" rel="noreferrer">Developer guide</a>
            <a href={SOURCE_ROOT} target="_blank" rel="noreferrer">GitHub</a>
            <a href="https://github.com/petekp/munari/issues" target="_blank" rel="noreferrer">Feedback</a>
          </div>
        </footer>
      </main>
    </div>
  )
}
