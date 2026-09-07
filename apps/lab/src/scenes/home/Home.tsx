// Overview — the lit masthead, a live example, a gallery, and a short path
// into the API. The shared canvas follows the scrolling page; each demo owns
// its content. Native fallback renders the same controlled content without
// capture setup.
import { useEffect, useRef } from 'react'
import { useSurfaceSupport } from '@petepetrash/munari'
import { HandoffSection } from './HomeHandoff'
import { HomePostcard } from './HomePostcard'
import { HomeMasthead } from './HomeMasthead'
import { ExamplesSection } from './HomeExamples'
import { SupportSection } from './HomeSupport'
import { TutorialSection } from './HomeTutorial'
import { useHomeReducedMotion } from './homeMotion'
import { GUIDE_URL, SOURCE_ROOT } from '../../components/sceneCatalog'
import '../../components/lit.css'
import './home.css'

export function HomeApp() {
  const supported = useSurfaceSupport()
  const reduced = useHomeReducedMotion()
  const pageRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const section = window.location.hash.slice(1)
    document.getElementById(section)?.scrollIntoView({ block: 'start' })
  }, [])

  return (
    <div ref={pageRef} className="home-page">
      <main ref={innerRef} className="home-inner">
        <HomeMasthead pageRef={pageRef} innerRef={innerRef} />
        <HomePostcard supported={supported} reduced={reduced} />
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
