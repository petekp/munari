// Why Munari page — interactive visual walkthrough of selective DOM promotion and Munari's guarantees.
//
// The law: every claim from `docs/why-munari.md` pairs an interactive specimen
// showing what breaks in DIY code with an on-demand live lab demo and the
// minimal JSX that implements it.
//
// Ownership: `App.tsx` mounts `WhyApp` at `?scene=why`; `whyData.ts`,
// `whySnippets.ts`, `whyDiagrams.tsx`, and `whyStage.tsx` supply the copy,
// specimens, and single-active demo frame.

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { CaptureEngineStatus } from '../../components/CaptureEngineStatus'
import { MunariLogo } from '../../components/MunariLogo'
import { CopyBlock, Tag } from '../../components/system'
import { GUIDE_URL, SOURCE_ROOT } from '../../components/sceneCatalog'
import { sceneUrl } from '../../captureMode'
import {
  COMPARISON_ROWS,
  DECISION_CARDS,
  INSTALL_SNIPPET,
  LIFECYCLE_MODES,
  PARADIGM_CARDS,
  TRADEOFFS,
  UNLOCK_ITEMS,
  WHY_SECTIONS,
  type WhySectionItem,
} from './whyData'
import { WhyDiagram } from './whyDiagrams'
import { WhyLiveStage } from './whyStage'
import './why.css'

export interface WhyProps {
  readonly onReady?: () => void
}

type SpecimenTab = 'diagram' | 'code'

function BrowserEnvironmentBar() {
  const hasNativeCanvas =
    'CanvasRenderingContext2D' in globalThis &&
    'drawElementImage' in CanvasRenderingContext2D.prototype
  const hasMoveBefore = 'Element' in globalThis && 'moveBefore' in Element.prototype
  const hasWebGpu = 'navigator' in globalThis && 'gpu' in navigator

  return (
    <div className="why-live-env m-ui" aria-label="Detected browser capabilities">
      <CaptureEngineStatus />
      <Tag>HTML-in-canvas: {hasNativeCanvas ? 'enabled' : 'absent'}</Tag>
      <Tag>Element.moveBefore: {hasMoveBefore ? 'supported' : 'insertBefore restore'}</Tag>
      <Tag>Renderer: {hasWebGpu ? 'WebGPU' : 'WebGL 2'}</Tag>
    </div>
  )
}

function ParadigmSection() {
  return (
    <section id="paradigm" className="m-section" aria-labelledby="paradigm-heading">
      <h2 id="paradigm-heading">Selective DOM promotion</h2>
      <div className="why-paradigm-body">
        <div className="why-decisions">
          {PARADIGM_CARDS.map((card, idx) => (
            <div key={card.title} className={`why-decision${idx === 2 ? ' why-decision-active' : ''}`}>
              <div>
                <Tag>{card.tag}</Tag>
              </div>
              <h3 className="m-heading">{card.title}</h3>
              <b className="m-label">{card.verdict}</b>
              <p className="m-ui m-quiet">{card.detail}</p>
            </div>
          ))}
        </div>

        <div className="why-modes">
          {LIFECYCLE_MODES.map((mode) => (
            <div key={mode.title} className="why-mode">
              <div>
                <Tag>{mode.badge}</Tag>
              </div>
              <h3 className="m-label">{mode.title}</h3>
              <p className="m-ui m-quiet">{mode.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function UnlocksSection() {
  return (
    <section id="unlocks" className="m-section" aria-labelledby="unlocks-heading">
      <h2 id="unlocks-heading">What it unlocks</h2>
      <div className="why-unlocks">
        {UNLOCK_ITEMS.map((item) => (
          <article key={item.title} className="why-unlock">
            <div>
              <Tag>{item.wall}</Tag>
            </div>
            <h3 className="m-heading">{item.title}</h3>
            <p className="m-ui m-quiet">{item.detail}</p>
            <div className="why-unlock-demos m-small">
              <span className="m-quiet">Demos:</span>
              {item.demos.map((demo) => (
                <a key={demo.id} className="m-link" href={sceneUrl(demo.id)}>
                  {demo.label}
                </a>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function WalkthroughSection({
  item,
  activeDemoId,
  onActivateDemo,
  onParkDemo,
}: {
  readonly item: WhySectionItem
  readonly activeDemoId: string | null
  readonly onActivateDemo: (id: string) => void
  readonly onParkDemo: () => void
}) {
  const [tab, setTab] = useState<SpecimenTab>('diagram')
  const baseId = useId()
  const diagramTabRef = useRef<HTMLButtonElement>(null)
  const codeTabRef = useRef<HTMLButtonElement>(null)

  const selectAndFocus = (next: SpecimenTab) => {
    setTab(next)
    const ref = next === 'diagram' ? diagramTabRef.current : codeTabRef.current
    ref?.focus()
  }

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      selectAndFocus(tab === 'diagram' ? 'code' : 'diagram')
    } else if (event.key === 'Home') {
      event.preventDefault()
      selectAndFocus('diagram')
    } else if (event.key === 'End') {
      event.preventDefault()
      selectAndFocus('code')
    }
  }

  const diagramTabId = `${baseId}-diagram-tab`
  const codeTabId = `${baseId}-code-tab`

  return (
    <section id={item.id} className="m-section why-walk-section" aria-labelledby={`${item.id}-heading`}>
      <h2>
        <span className="m-readout m-quiet">{item.number}</span>
        <br />
        {item.navLabel}
      </h2>

      <div className="why-section-body">
        <div className="why-section-head">
          <h3 id={`${item.id}-heading`} className="m-title">
            {item.title}
          </h3>
          <p className="m-body m-quiet">{item.summary}</p>
        </div>

        <div className="why-split-notes m-ui">
          <div className="why-note-col">
            <b className="m-label">{item.breaksTitle}</b>
            <ul className="m-quiet">
              {item.breaksPoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
          <div className="why-note-col">
            <b className="m-label">{item.munariTitle}</b>
            <ul>
              {item.munariPoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="why-card-shell">
          <div
            role="tablist"
            aria-label={`${item.navLabel} view`}
            className="why-tabs"
            onKeyDown={onTabKeyDown}
          >
            <button
              ref={diagramTabRef}
              type="button"
              role="tab"
              id={diagramTabId}
              className="why-tab"
              aria-selected={tab === 'diagram'}
              tabIndex={tab === 'diagram' ? 0 : -1}
              onClick={() => setTab('diagram')}
            >
              Interactive specimen
            </button>
            <button
              ref={codeTabRef}
              type="button"
              role="tab"
              id={codeTabId}
              className="why-tab"
              aria-selected={tab === 'code'}
              tabIndex={tab === 'code' ? 0 : -1}
              onClick={() => setTab('code')}
            >
              JSX snippet
            </button>
          </div>

          <div role="tabpanel" aria-labelledby={diagramTabId} hidden={tab !== 'diagram'}>
            <div className="why-tabpanel-inner">
              <WhyDiagram kind={item.diagram} />
            </div>
          </div>

          <div role="tabpanel" aria-labelledby={codeTabId} hidden={tab !== 'code'}>
            <div className="why-tabpanel-inner">
              <CopyBlock text={item.code} />
            </div>
          </div>
        </div>

        <WhyLiveStage
          demoId={item.demoId}
          title={item.demoTitle}
          thumb={item.demoThumb}
          instruction={item.demoInstruction}
          active={activeDemoId === item.id}
          allowEngineSwitch={item.id === 'browsers'}
          relatedScenes={item.relatedScenes}
          onActivate={() => onActivateDemo(item.id)}
          onPark={onParkDemo}
        />
      </div>
    </section>
  )
}

export function WhyApp({ onReady }: WhyProps) {
  const [activeDemoId, setActiveDemoId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const ready = document.fonts?.ready ?? Promise.resolve()
    void ready.then(() => {
      if (alive) requestAnimationFrame(() => onReady?.())
    })
    return () => {
      alive = false
    }
  }, [onReady])

  return (
    <div className="why-page">
      <header className="why-header">
        <a href={sceneUrl('home')} className="why-logo" aria-label="Munari home">
          <span aria-hidden>
            <MunariLogo />
          </span>
        </a>
        <nav aria-label="Project" className="m-ui">
          <a className="m-link m-link--nav" href={sceneUrl('home')}>
            Demos
          </a>
          <a className="m-link m-link--nav" href={sceneUrl('why')} aria-current="page">
            Why Munari
          </a>
          <a className="m-link m-link--nav" href={GUIDE_URL} target="_blank" rel="noreferrer">
            Guide
          </a>
          <a className="m-link m-link--nav" href={SOURCE_ROOT} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
      </header>

      <main>
        <div className="why-intro">
          <h1 className="m-display">Why Munari</h1>
          <p className="m-lead">
            Native-grade lighting, optics, and physical motion on real DOM components—without turning your website
            into a full-canvas app. Your page stays ordinary HTML; Munari promotes only the components or transitions
            that cross CSS&rsquo;s limits.
          </p>
          <BrowserEnvironmentBar />
          <nav aria-label="Contents" className="why-contents m-ui">
            <a className="m-link m-link--nav" href="#paradigm">
              Selective promotion
            </a>
            <a className="m-link m-link--nav" href="#unlocks">
              What it unlocks
            </a>
            <a className="m-link m-link--nav" href="#choose">
              Choose the right tool
            </a>
            {WHY_SECTIONS.map((item) => (
              <a key={item.id} className="m-link m-link--nav" href={`#${item.id}`}>
                {item.number} {item.navLabel}
              </a>
            ))}
            <a className="m-link m-link--nav" href="#tradeoffs">
              Trade-offs
            </a>
            <a className="m-link m-link--nav" href="#compare">
              Comparison
            </a>
          </nav>
        </div>

        <ParadigmSection />
        <UnlocksSection />

        <section id="choose" className="m-section" aria-labelledby="choose-heading">
          <h2 id="choose-heading">Choose the right tool</h2>
          <div className="why-decisions">
            {DECISION_CARDS.map((card, idx) => (
              <div key={card.title} className={`why-decision${idx === 2 ? ' why-decision-active' : ''}`}>
                <div>
                  <Tag>{card.tag}</Tag>
                </div>
                <h3 className="m-heading">{card.title}</h3>
                <b className="m-label">{card.verdict}</b>
                <p className="m-ui m-quiet">{card.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {WHY_SECTIONS.map((item) => (
          <WalkthroughSection
            key={item.id}
            item={item}
            activeDemoId={activeDemoId}
            onActivateDemo={setActiveDemoId}
            onParkDemo={() => setActiveDemoId(null)}
          />
        ))}

        <section id="tradeoffs" className="m-section" aria-labelledby="tradeoffs-heading">
          <h2 id="tradeoffs-heading">Trade-offs &amp; limits</h2>
          <div className="why-tradeoffs">
            {TRADEOFFS.map((entry) => (
              <div key={entry.title} className="why-tradeoff">
                <h3 className="m-label">{entry.title}</h3>
                <p className="m-ui m-quiet">{entry.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="compare" className="m-section" aria-labelledby="compare-heading">
          <h2 id="compare-heading">Comparison</h2>
          <div tabIndex={0} role="region" aria-labelledby="compare-heading" className="why-table-wrap">
            <table className="why-table m-ui">
              <caption className="why-sr-only">
                Comparison of CSS 3D and Drei Html, DIY HTML-in-canvas, and Munari
              </caption>
              <thead>
                <tr>
                  <th scope="col">Requirement</th>
                  <th scope="col">CSS 3D / Drei &lt;Html&gt;</th>
                  <th scope="col">DIY html-in-canvas</th>
                  <th scope="col">Munari</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.requirement}>
                    <th scope="row">{row.requirement}</th>
                    <td className="m-quiet">{row.cssAndDrei}</td>
                    <td className="m-quiet">{row.diyCanvas}</td>
                    <td>{row.munari}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="start" className="m-section" aria-labelledby="start-heading">
          <h2 id="start-heading">Get started</h2>
          <div className="why-start">
            <CopyBlock text={INSTALL_SNIPPET} />
            <p className="m-ui m-quiet">
              Pin <code className="m-code">three</code> with <code className="m-code">--save-exact</code> so npm
              keeps the validated <code className="m-code">0.186.x</code> WebGPU range. Read the{' '}
              <a className="m-link" href={GUIDE_URL} target="_blank" rel="noreferrer">
                setup guide
              </a>{' '}
              or explore all{' '}
              <a className="m-link" href={sceneUrl('home')}>
                live demos
              </a>
              .
            </p>
          </div>
        </section>
      </main>

      <footer className="why-footer m-small m-quiet">
        <p>Named for the Italian designer Bruno Munari.</p>
        <span className="why-footer-links">
          <a className="m-link" href={sceneUrl('home')}>
            Demos
          </a>
          <a className="m-link" href={sceneUrl('style')}>
            Style guide
          </a>
          <a className="m-link" href={`${SOURCE_ROOT}/issues`} target="_blank" rel="noreferrer">
            Feedback
          </a>
        </span>
      </footer>
    </div>
  )
}
