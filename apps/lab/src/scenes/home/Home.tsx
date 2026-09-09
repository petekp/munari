// Overview — the lit masthead, a live example, a gallery, and a short path
// into the API. The shared canvas follows the scrolling page; each demo owns
// its content. Native fallback renders the same controlled content without
// capture setup.
import { useEffect, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Surface, SurfaceCanvas, useSurfaceHandle, useSurfaceState, useSurfaceSupport } from '@petepetrash/munari'
import { HandoffSection } from './HomeHandoff'
import { HeroMesh, HeroSection, PixelPerfect } from './HomeHero'
import { HomeMasthead } from './HomeMasthead'
import { ExamplesSection } from './HomeExamples'
import { SupportSection } from './HomeSupport'
import { TutorialSection } from './HomeTutorial'
import { useHomeReducedMotion } from './homeMotion'
import { GUIDE_URL, SOURCE_ROOT } from '../../components/sceneCatalog'
import '../../components/lit.css'
import './home.css'

const FOV = 42

function KeepDomFocus() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    const noSteal = (event: MouseEvent) => event.preventDefault()
    el.addEventListener('mousedown', noSteal)
    return () => el.removeEventListener('mousedown', noSteal)
  }, [gl])
  return null
}

export function HomeApp() {
  const supported = useSurfaceSupport()
  const reduced = useHomeReducedMotion()
  const hero = useSurfaceHandle('home-hero')
  const heroState = useSurfaceState(hero)
  const [heroRenderIn, setHeroRenderIn] = useState<'page' | 'canvas'>('page')
  const holderRef = useRef<HTMLDivElement>(null)
  const landRef = useRef(false)
  const pageRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const section = window.location.hash.slice(1)
    document.getElementById(section)?.scrollIntoView({ block: 'start' })
  }, [])

  return (
    <div ref={pageRef} className="home-page">
      {supported && (
        <SurfaceCanvas
          id="home"
          flat
          pointerMode="surfaces"
          style={{ position: 'fixed', inset: 0, zIndex: 30 }}
          className="home-canvas"
          gl={{ alpha: true }}
          frameloop={heroRenderIn === 'canvas' && !reduced ? 'always' : 'demand'}
          dpr={[1, 2]}
          camera={{ fov: FOV, position: [0, 0, 1000] }}
          onCreated={(state) => state.gl.setClearAlpha(0)}
        >
          <KeepDomFocus />
          <PixelPerfect fov={FOV} />
          <Surface.Scene surface={hero}>
            <HeroMesh
              surface={hero}
              holderRef={holderRef}
              presented={heroState.presented === 'canvas'}
              requested={heroRenderIn}
              reduced={reduced}
              landRef={landRef}
              onLanded={() => setHeroRenderIn('page')}
            />
          </Surface.Scene>
        </SurfaceCanvas>
      )}
      <main ref={innerRef} className="home-inner">
        <HomeMasthead pageRef={pageRef} innerRef={innerRef} />
        <HeroSection
          surface={hero}
          state={heroState}
          renderIn={heroRenderIn}
          setRenderIn={setHeroRenderIn}
          holderRef={holderRef}
          landRef={landRef}
          supported={supported}
          reduced={reduced}
        />
        <ExamplesSection />
        <HandoffSection />
        <TutorialSection />
        <SupportSection />
        <footer className="home-footer">
          <div><b>munari</b><p>HTML, 3D and shaders, unified.</p></div>
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
