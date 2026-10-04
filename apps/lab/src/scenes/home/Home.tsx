// Overview — a prompt for a coding agent beside the demo it describes, then
// every demo, then setup. The visitor picks a verb; the prompt and the live
// demo change together, and the copied prompt names the visitor's component.
import { useEffect, useId, useRef, useState } from 'react'
import { MunariLogo } from '../../components/MunariLogo'
import { EXAMPLES, GUIDE_URL, SOURCE_ROOT, BROWSER_GUIDE, exampleFor } from '../../components/sceneCatalog'
import { HomeStage } from './HomeStage'
import { HOME_VERBS, SKILL_PATH, promptFor, sentenceParts } from './homeVerbs'
import './home.css'

interface HomeProps { section?: string; onReady?: () => void }

// The landing's demos, in the order of the verbs that open them.
const DEMOS = HOME_VERBS.map((entry) => exampleFor(entry.demo)).filter((example) => example !== undefined)

export function HomeApp({ section = '', onReady }: HomeProps) {
  const pageRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

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

  useEffect(() => {
    if (!ready) return
    if (!section) { pageRef.current?.scrollTo({ top: 0 }); return }
    pageRef.current?.querySelector(`#${CSS.escape(section)}`)?.scrollIntoView({ block: 'start' })
  }, [section, ready])

  return (
    <div ref={pageRef} className="home-page" data-page-ready={ready || undefined}>
      <div className="home-wrap">
        <header className="home-header">
          <a href="/?scene=home" className="home-plate" aria-label="Munari">
            <span aria-hidden className="home-wordmark"><MunariLogo /></span>
          </a>
          <nav aria-label="Overview">
            <a href="#demos">Demos</a>
            <a href="#setup">Setup</a>
            <a href={SOURCE_ROOT} target="_blank" rel="noreferrer">GitHub</a>
          </nav>
        </header>
        <PromptHero />
        <DemoGrid />
        <Setup />
        <footer className="home-footer">
          <p>Named for the Italian designer Bruno Munari.</p>
          <div>
            <a href={GUIDE_URL} target="_blank" rel="noreferrer">Developer guide</a>
            <a href={SOURCE_ROOT} target="_blank" rel="noreferrer">GitHub</a>
            <a href={`${SOURCE_ROOT}/issues`} target="_blank" rel="noreferrer">Feedback</a>
          </div>
        </footer>
      </div>
    </div>
  )
}

// ── hero ─────────────────────────────────────────────────────────────

function PromptHero() {
  const [index, setIndex] = useState(0)
  const entry = HOME_VERBS[index]
  const [targets, setTargets] = useState(() => HOME_VERBS.map((verb) => verb.target))
  const target = targets[index]
  const pickerId = useId()

  return (
    <section className="home-hero" aria-labelledby="home-title">
      <div className="home-hero-copy">
        <h1 id="home-title" className="home-tagline">HTML, 3D, and Shaders, Unified.</h1>
        <p className="home-lede">Munari is a React library that puts live HTML into Three.js scenes. Buttons, fields, and text keep working.</p>
        <p className="home-ask" id={`${pickerId}-ask`}>Ask your coding agent:</p>
        <p className="home-prompt" aria-describedby={`${pickerId}-ask`} style={verbStyle(entry.demo)}>
          {sentenceParts(entry).map((part, partIndex) => {
            if (part.kind === 'verb') return <mark key={partIndex} className="home-prompt-verb">{part.text}</mark>
            if (part.kind === 'target') {
              return (
                <input
                  key={partIndex}
                  className="home-prompt-target"
                  aria-label="Your component"
                  value={target}
                  size={Math.max(4, target.length)}
                  spellCheck={false}
                  onFocus={(event) => event.target.select()}
                  onChange={(event) => setTargets((all) => all.map((value, valueIndex) => valueIndex === index ? event.target.value : value))}
                />
              )
            }
            return <span key={partIndex}>{part.text}</span>
          })}
        </p>
        <div className="home-verbs" role="radiogroup" aria-label="Effect">
          {HOME_VERBS.map((verb, verbIndex) => (
            <button
              key={verb.verb}
              type="button"
              role="radio"
              aria-checked={verbIndex === index}
              style={verbStyle(verb.demo)}
              onClick={() => setIndex(verbIndex)}
            >
              {verb.verb}
            </button>
          ))}
        </div>
        <CopyButton text={promptFor(entry, target)} label="Copy prompt" />
        <p className="home-fine">The copied prompt first tells your agent to read the Munari skill that ships in the package.</p>
      </div>
      <HomeStage demo={entry.demo} />
    </section>
  )
}

type VerbStyle = React.CSSProperties & { '--verb-wash': string }
function verbStyle(demo: string): VerbStyle {
  return { '--verb-wash': exampleFor(demo)?.wash ?? '#e3ec5a' }
}

function CopyButton({ text, label, className = 'home-button' }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setCopied(true))
      }}
    >
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </button>
  )
}

// ── demos ────────────────────────────────────────────────────────────

function DemoGrid() {
  const others = EXAMPLES.filter((example) => !DEMOS.includes(example))
  return (
    <section className="home-section" id="demos" aria-labelledby="demos-title">
      <h2 id="demos-title">Demos</h2>
      <ul className="home-demos">
        {DEMOS.map((example) => (
          <li key={example.id}>
            <a className="home-demo" href={`/?scene=${example.id}&capture=auto`}>
              <img src={`/thumbs/${example.id}.jpg`} alt="" loading="lazy" width={1280} height={720} />
              <h3>{example.title}</h3>
              <p>{example.headline}</p>
            </a>
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <p className="home-more">Also in the lab: {others.map((example, exampleIndex) => (
          <span key={example.id}>{exampleIndex > 0 && ', '}<a href={`/?scene=${example.id}&capture=auto`}>{example.title}</a></span>
        ))}.</p>
      )}
    </section>
  )
}

// ── setup ────────────────────────────────────────────────────────────

const INSTALL = 'npm install @petepetrash/munari three @react-three/fiber @zumer/snapdom\nnpm install --save-dev @types/three'
const POINT = `Read ${SKILL_PATH} before writing any Munari code.`

function Setup() {
  return (
    <section className="home-section home-setup" id="setup" aria-labelledby="setup-title">
      <div>
        <h2 id="setup-title">Setup</h2>
        <p className="home-setup-lede">The package includes instructions for coding agents. They cover the API and the rules for HTML that Munari draws.</p>
      </div>
      <div>
        <ol className="home-steps">
          <li>
            <h3>Install the package.</h3>
            <Slip text={INSTALL} />
            <p className="home-note">The API on this page is newer than the current npm release, 0.3.0. Until the next release, <a href={GUIDE_URL} target="_blank" rel="noreferrer">build the package from source</a>.</p>
          </li>
          <li>
            <h3>Point your agent at the instructions.</h3>
            <Slip text={POINT} />
          </li>
          <li>
            <h3>Describe the effect.</h3>
            <p className="home-note">Start from a prompt above, or describe your own. Name the component and what should still work while it moves.</p>
          </li>
        </ol>
        <div className="home-setup-links">
          <a href={GUIDE_URL} target="_blank" rel="noreferrer">Write your first Surface by hand</a>
          <a href={BROWSER_GUIDE} target="_blank" rel="noreferrer">Browser support</a>
        </div>
      </div>
    </section>
  )
}

function Slip({ text }: { text: string }) {
  return (
    <div className="home-slip">
      <pre><code>{text}</code></pre>
      <CopyButton text={text} label="Copy" className="home-slip-copy" />
    </div>
  )
}
