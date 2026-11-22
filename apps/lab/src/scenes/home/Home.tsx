// Overview — the tagline, one demo running live, and an index of every demo
// that chooses which one runs. The catalog (sceneCatalog.ts) is the only list:
// a new entry appears in the index and can take the stage with no change here.
import { useEffect, useRef, useState } from 'react'
import { MunariLogo } from '../../components/MunariLogo'
import { DEMOS, GUIDE_URL, SOURCE_ROOT, BROWSER_GUIDE, type Demo } from '../../components/sceneCatalog'
import { HomeStage } from './HomeStage'
import { sceneUrl } from '../../captureMode'
import './home.css'

interface HomeProps { onReady?: () => void }

// README's install: `three` pinned exactly, because npm writes a caret range
// that accepts the next minor, and Three changes its WebGPU API between minors.
const INSTALL = 'npm install @petepetrash/munari @react-three/fiber\nnpm install three@0.186.1 --save-exact'

export function HomeApp({ onReady }: HomeProps) {
  const [ready, setReady] = useState(false)
  const [demo, setDemo] = useState<Demo>(DEMOS[0])
  const stageRef = useRef<HTMLElement>(null)

  // The opening cover lifts once the page's own faces have loaded, so the
  // first visible frame is set in them.
  useEffect(() => {
    let alive = true
    void document.fonts.ready.then(() => {
      if (!alive) return
      setReady(true)
      requestAnimationFrame(() => onReady?.())
    })
    return () => { alive = false }
  }, [onReady])

  const choose = (next: Demo) => {
    setDemo(next)
    const stage = stageRef.current
    if (!stage) return
    const stageIsAboveView = stage.getBoundingClientRect().top < 0
    if (stageIsAboveView) stage.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  return (
    <div className="home-page" data-page-ready={ready || undefined}>
      <header className="home-header">
        <a href={sceneUrl('home')} className="home-logo" aria-label="Munari">
          <span aria-hidden><MunariLogo ground="light" /></span>
        </a>
        <nav aria-label="Project">
          <a href={sceneUrl('why')}>Why Munari</a>
          <a href={GUIDE_URL} target="_blank" rel="noreferrer">Guide</a>
          <a href={SOURCE_ROOT} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </header>

      <main>
        <section className="home-intro" aria-labelledby="home-title">
          <h1 id="home-title">HTML, 3D, and Shaders, Unified.</h1>
          <p>Native-grade lighting, optics, and physical motion on real DOM components—without turning your website into a full-canvas app. Buttons still click, fields still take typing, and text still selects.</p>
        </section>

        <a className="home-skip" href="#home-index">Skip to all demos</a>
        <HomeStage ref={stageRef} demo={demo} />

        <section className="home-index" id="home-index" tabIndex={-1} aria-label="Demos">
          <ul>
            {DEMOS.map((entry) => (
              <li key={entry.id}>
                <button type="button" aria-pressed={entry.id === demo.id} onClick={() => choose(entry)}>
                  <img src={`/thumbs/${entry.id}.jpg`} alt="" loading="lazy" />
                  <b>{entry.title}</b>
                  <span>{entry.headline}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="home-facts" aria-labelledby="home-facts-title">
          <h2 id="home-facts-title">What it does</h2>
          <dl>
            <div>
              <dt>Crosses CSS’s flat-box limits</dt>
              <dd>Cast shared scene light across separate components, refract live text through glass, or bend and curl interactive forms with WebGPU shaders.</dd>
            </div>
            <div>
              <dt>Keeps the real DOM working</dt>
              <dd>Clicks, typing, focus, scroll, and text selection reach the live React elements—even across curved or lit geometry.</dd>
            </div>
            <div>
              <dt>Promotes on demand, sleeps at 0 fps</dt>
              <dd>Components stay in ordinary page layout, enter 3D without blank frames or lost state, and drop to 0 fps at rest across Chrome, Safari, and Firefox.</dd>
            </div>
          </dl>
        </section>

        <section className="home-start" aria-labelledby="home-start-title">
          <h2 id="home-start-title">Get started</h2>
          <CopyLine text={INSTALL} />
          <p>
            Follow <a href={GUIDE_URL} target="_blank" rel="noreferrer">the guide</a> to put your first component in a scene, or read <a href={sceneUrl('why')}>Why Munari</a> for how selective DOM promotion works.
            Chrome 157+ and the <a href={BROWSER_GUIDE} target="_blank" rel="noreferrer">HTML-in-canvas origin trial</a> draw live elements directly; Safari, Firefox, and iOS run the same components through snapDOM.
          </p>
        </section>
      </main>

      <footer className="home-footer">
        <p>Named for the Italian designer Bruno Munari.</p>
        <span className="home-footer-links">
          <a href={sceneUrl('why')}>Why Munari</a>
          <a href={sceneUrl('style')}>Style guide</a>
          <a href={`${SOURCE_ROOT}/issues`} target="_blank" rel="noreferrer">Feedback</a>
        </span>
      </footer>
    </div>
  )
}

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <div className="home-copy">
      <code>{text}</code>
      <button type="button" onClick={() => { void navigator.clipboard.writeText(text).then(() => setCopied(true)) }}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
