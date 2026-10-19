// Style guide — the site system shown with its own classes. Every specimen is
// the real component CSS (components/system/system.css) over the real tokens,
// so the page changes when the system does. States at rest use the same
// `[data-hover]` and `[data-active]` twins a captured Surface receives.
import { useEffect, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { MunariLogo } from '../../components/MunariLogo'
import { GUIDE_URL, SOURCE_ROOT } from '../../components/sceneCatalog'
import { sceneUrl } from '../../captureMode'
import { contrastRatio } from './styleContrastLaw'
import '../../components/system/system.css'
import './style.css'

interface StyleProps { onReady?: () => void }

const SECTIONS = [
  ['principles', 'Principles'],
  ['color', 'Color'],
  ['grounds', 'Grounds'],
  ['type', 'Type'],
  ['space', 'Space and layout'],
  ['line', 'Line and shape'],
  ['motion', 'Motion'],
  ['actions', 'Actions'],
  ['plates', 'Plates and stage'],
  ['fields', 'Fields'],
  ['controls', 'Controls'],
  ['panels', 'Panels and windows'],
  ['status', 'Status and notices'],
  ['voice', 'Voice'],
  ['demos', 'Demos'],
] as const

const NEUTRALS = [
  ['--m-paper', '#ffffff', 'Page, panels, windows, fields.'],
  ['--m-ink', '#000000', 'Text, structural rules, filled controls, focus.'],
  ['--m-quiet', '#5c5c5c', 'Secondary text. Never under 13px.'],
  ['--m-field', '#f2f2f2', 'A floor behind content: the stage, thumbnails, a desk.'],
  ['--m-rule', '#dedede', 'Separates items inside a region. Never a control edge.'],
  ['--m-tick', '#8a8a8a', 'Minor ruler ticks and disabled text.'],
] as const

const PALETTE = [
  ['coral', '#f2695c'], ['chartreuse', '#e3ec5a'], ['orchid', '#f07ff0'], ['sky', '#52c7f2'],
  ['violet', '#b47deb'], ['leaf', '#66c94e'], ['tangerine', '#f5a53f'], ['bubblegum', '#f76fa2'],
] as const

const TYPE_STEPS = [
  ['m-display', 'display', 'HTML, 3D, and Shaders.', '40–80px / 0.98 · 600 · 112%', 'The page title. One per page.'],
  ['m-title', 'title', 'Live HTML in a scene', '28–44px / 1.05 · 600 · 108%', 'A statement that opens a section.'],
  ['m-lead', 'lead', 'Buttons still click, fields still take typing, and text still selects.', '18–21px / 1.45 · 400', 'The paragraph under a title. 46ch at most.'],
  ['m-heading', 'heading', 'Keeps it working', '21px / 1.2 · 600', 'Item titles inside a section.'],
  ['m-label', 'label', 'What it does', '15px / 1.35 · 600', 'Section labels, names, buttons, the bar title.'],
  ['m-body', 'body', 'Wrap React content in a Surface and it becomes a texture in your scene, redrawn as the content changes.', '16px / 1.5 · 400', 'Running text. 64ch at most.'],
  ['m-ui', 'ui', 'Drag a card by its title.', '15px / 1.35 · 400', 'Links, captions, field text.'],
  ['m-small', 'small', 'Distance from the page', '13px / 1.4 · 400', 'Panel labels and notes. The smallest size.'],
  ['m-readout', 'readout', '0.35 s\u200342 px\u200303 / 09', '13px · 500 · 85% · tabular', 'Values, units, plate numbers.'],
  ['m-code', 'code', 'npm install three@0.186.1 --save-exact', 'Courier Prime 15px / 1.6', 'Code someone will copy. Nothing else.'],
] as const

const SPACE = [['s1', 4], ['s2', 8], ['s3', 12], ['s4', 16], ['s5', 24], ['s6', 32], ['s7', 48], ['s8', 64], ['s9', 96]] as const

const CHECK = <svg viewBox="0 0 12 12" aria-hidden><path d="M2.5 6.2 5 8.6l4.6-5.2" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
const CHEVRON = <svg viewBox="0 0 16 16" aria-hidden><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>

export function StyleApp({ onReady }: StyleProps) {
  useEffect(() => {
    let alive = true
    void document.fonts.ready.then(() => { if (alive) requestAnimationFrame(() => onReady?.()) })
    return () => { alive = false }
  }, [onReady])

  return (
    <div className="style-page">
      <header className="style-header">
        <a href={sceneUrl('home')} className="style-logo" aria-label="Munari home">
          <span aria-hidden><MunariLogo ground="light" /></span>
        </a>
        <nav aria-label="Project" className="m-ui">
          <a className="m-link m-link--nav" href={sceneUrl('home')}>Demos</a>
          <a className="m-link m-link--nav" href={GUIDE_URL} target="_blank" rel="noreferrer">Guide</a>
          <a className="m-link m-link--nav" href={SOURCE_ROOT} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </header>

      <main>
        <div className="style-intro">
          <h1 className="m-display">Style guide</h1>
          <p className="m-lead">How the Munari site and its demos look, and the parts they are built from. Paper and ink carry the interface. The wordmark and the demos are the only color.</p>
          <nav aria-label="Contents" className="style-contents m-ui">
            {SECTIONS.map(([id, name]) => <a key={id} className="m-link m-link--nav" href={`#${id}`}>{name}</a>)}
          </nav>
        </div>

        <Section id="principles" title="Principles">
          <ol className="style-principles">
            <li><b className="m-heading">The demo is the color.</b><p className="m-body m-quiet">Chrome is black on white. A color on the page means the product is working.</p></li>
            <li><b className="m-heading">Depth belongs to the scene.</b><p className="m-body m-quiet">2D parts have no shadow, blur or translucency. Real depth and light come from Three.js.</p></li>
            <li><b className="m-heading">Width carries the voice.</b><p className="m-body m-quiet">One family. Wide for statements, normal for reading, narrow for numbers.</p></li>
            <li><b className="m-heading">Controls show their measure.</b><p className="m-body m-quiet">A value is printed in tabular numerals with its unit, and a slider or dial shows where it sits on a ruler.</p></li>
            <li><b className="m-heading">States are crisp.</b><p className="m-body m-quiet">A control inverts, fills, or gains a rule. Nothing fades halfway, and no state relies on color.</p></li>
          </ol>
        </Section>

        <Section id="color" title="Color">
          <div className="style-swatches">
            {NEUTRALS.map(([token, hex, role]) => (
              <div key={token} className="style-swatch">
                <span className="style-chip" style={{ background: hex }} />
                <code className="m-label">{token}</code>
                <span className="m-readout m-quiet">{hex} · {formatRatio(contrastRatio(hex, '#ffffff'))} on paper</span>
                <span className="m-ui m-quiet">{role}</span>
              </div>
            ))}
          </div>
          <h3 className="m-heading style-subhead">The wordmark palette</h3>
          <p className="m-body m-quiet style-note">For demo content only: objects, light, particles, the thing being lifted. Never text, borders, focus or state. A demo picks one or two at rest. Chartreuse never draws text, lines or marks on paper.</p>
          <div className="style-palette">
            {PALETTE.map(([name, hex]) => (
              <div key={name} className="style-palette-entry">
                <span className="style-palette-chip" style={{ background: hex }} />
                <span className="m-label">{name}</span>
                <span className="m-readout m-quiet">{hex} · {formatRatio(contrastRatio(hex, '#ffffff'))}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section id="grounds" title="Grounds">
          <p className="m-body m-quiet style-note">Every region sits on one of three grounds. Set <code className="m-code">data-ground</code> and every part inside follows. Paper is the default; field gives content a floor; ink is for demos where light is the subject.</p>
          <div className="style-grounds">
            {(['paper', 'field', 'ink'] as const).map((ground) => (
              <div key={ground} data-ground={ground} className="style-ground">
                <span className="m-label">{ground}</span>
                <div className="style-row">
                  <button type="button" className="m-button m-button--compact">Lift</button>
                  <button type="button" className="m-button m-button--outline m-button--compact">Reset</button>
                  <a className="m-link m-ui" href="#grounds">Source</a>
                </div>
                <Toggle label="Shadows" initial={ground !== 'field'} />
                <Slider label="Distance" unit="px" initial={ground === 'ink' ? 72 : 40} min={0} max={120} />
              </div>
            ))}
          </div>
        </Section>

        <Section id="type" title="Type">
          <p className="m-body m-quiet style-note">Archivo for everything, from 62% to 125% wide. Courier Prime only for code. Sentence case everywhere: no capitals for emphasis, no italics, no tracked labels. Emphasis is weight.</p>
          <div className="style-type">
            {TYPE_STEPS.map(([className, name, sample, metrics, use]) => (
              <div key={name} className="style-type-step">
                <div className="style-type-meta">
                  <span className="m-label">{name}</span>
                  <span className="m-readout m-quiet">{metrics}</span>
                  <span className="m-small m-quiet">{use}</span>
                </div>
                <p className={`${className} style-type-sample`}>{sample}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="space" title="Space and layout">
          <div className="style-space">
            {SPACE.map(([name, px]) => (
              <div key={name} className="style-space-row">
                <span className="m-readout">{name}</span>
                <span className="style-space-bar" style={{ width: px }} />
                <span className="m-readout m-quiet">{px}</span>
              </div>
            ))}
          </div>
          <dl className="style-facts m-ui">
            <div><dt className="m-label">Measure</dt><dd className="m-quiet">Text and sections sit in a 1200px column, with a gutter of 16–48px.</dd></div>
            <div><dt className="m-label">Sections</dt><dd className="m-quiet">A label column and a content column, 1 to 3. One column under 760px.</dd></div>
            <div><dt className="m-label">Stage</dt><dd className="m-quiet">Edge to edge up to 1600px. Past that it centers and its corners round to 16px as the margins open.</dd></div>
            <div><dt className="m-label">Targets</dt><dd className="m-quiet">44px tall on the page and on touch; 32px in desktop panels.</dd></div>
          </dl>
        </Section>

        <Section id="line" title="Line and shape">
          <div className="style-lines">
            <Labeled label="Separates" note="1px rule"><span className="style-line" style={{ borderTopColor: 'var(--m-rule)' }} /></Labeled>
            <Labeled label="Structures" note="1px ink"><span className="style-line" /></Labeled>
            <Labeled label="Emphasizes" note="2px ink: selection, error"><span className="style-line style-line--heavy" /></Labeled>
            <Labeled label="Measures" note="the ruler, ticks every 16 and 64px"><div className="m-ruler" /></Labeled>
          </div>
          <div className="style-row style-row--spread">
            <Labeled label="Focus" note="2px ink, 3px off the edge"><button type="button" className="m-button m-button--outline style-focus-sample">Copy</button></Labeled>
            <Labeled label="Corners" note="Square, except circles and the wide stage"><span className="style-corners"><span /><span /><span /></span></Labeled>
          </div>
          <p className="m-body m-quiet style-note">Never in chrome: shadows, blur, translucency, gradients, colored borders, dashed rules, opacity for disabled, emoji. A demo's scene may use any of them.</p>
        </Section>

        <Section id="motion" title="Motion">
          <table className="style-table m-ui">
            <tbody>
              <tr><td className="m-readout">0ms</td><td>Hover, press, toggle. Controls switch like hardware.</td></tr>
              <tr><td className="m-readout">120ms</td><td>A button inverting, a slider thumb widening.</td></tr>
              <tr><td className="m-readout">200ms</td><td>A demo fading in over its poster.</td></tr>
              <tr><td className="m-readout">320ms</td><td>A panel opening.</td></tr>
            </tbody>
          </table>
          <p className="m-body m-quiet style-note">One easing, <code className="m-code">cubic-bezier(0.2, 0, 0, 1)</code>. Springs belong to the scene. Layout, text and rules never move, and reduced motion sets every duration to zero.</p>
        </Section>

        <Section id="actions" title="Actions">
          <States title="Button" note="One per view. Inverts on hover.">
            <State label="Default"><button type="button" className="m-button">Show in 3D</button></State>
            <State label="Hover"><button type="button" className="m-button" data-hover>Show in 3D</button></State>
            <State label="Pressed"><button type="button" className="m-button" data-active>Show in 3D</button></State>
            <State label="Disabled"><button type="button" className="m-button" disabled>Show in 3D</button></State>
          </States>
          <States title="Outline button" note="Secondary actions and panel footers.">
            <State label="Default"><button type="button" className="m-button m-button--outline">Reset</button></State>
            <State label="Hover"><button type="button" className="m-button m-button--outline" data-hover>Reset</button></State>
            <State label="Pressed"><button type="button" className="m-button m-button--outline" data-active>Reset</button></State>
            <State label="Compact"><button type="button" className="m-button m-button--outline m-button--compact">Reset</button></State>
          </States>
          <States title="Link and text button" note="Underlined in text; bar links underline on hover.">
            <State label="Default"><a className="m-link m-ui" href="#actions">Open full page</a></State>
            <State label="Hover"><a className="m-link m-ui" href="#actions" data-hover>Open full page</a></State>
            <State label="Pressed"><a className="m-link m-ui" href="#actions" data-active>Open full page</a></State>
            <State label="Disabled"><button type="button" className="m-textbutton" disabled>Next</button></State>
          </States>
          <States title="Copy block" note="Code that runs as typed. The button confirms for 1.6s.">
            <State label="Live" wide><CopyBlock text={'npm install @petepetrash/munari @react-three/fiber\nnpm install three@0.186.1 --save-exact'} /></State>
          </States>
        </Section>

        <Section id="plates" title="Plates and stage">
          <p className="m-body m-quiet style-note">A demo in the index is a plate: a numbered image with its name and one line. The numbers follow the catalog's order.</p>
          <div className="style-plates">
            <Plate id="genie" number="01" title="Genie" headline="A window that can bend" state="Default" />
            <Plate id="flight" number="02" title="Flight" headline="Drag and drop with weight" state="Hover" hover />
            <Plate id="light" number="03" title="Light" headline="A lamp over live HTML" state="Selected" pressed />
          </div>
          <div className="style-stage-sample">
            <div className="m-stage style-stage-frame"><img src="/thumbs/knobs.jpg" alt="" /></div>
            <div className="m-stage-caption"><p><b>Knobs.</b> Turn a dial, switch the power, and resize the panel with its corner handle.</p><a className="m-link" href="#plates">Open full page</a></div>
            <div className="m-ruler" />
          </div>
          <States title="Demo bar" note="Above every demo page. The wordmark sits at the left, at 26px.">
            <State label="Live" wide>
              <div className="m-bar style-bar">
                <div className="m-bar-demo"><b>Genie</b><span>Minimize a window, or drag its title toward the dock.</span></div>
                <div className="m-bar-links"><span className="m-readout m-quiet">01 / 09</span><a className="m-link m-link--nav" href="#plates">Previous</a><a className="m-link m-link--nav" href="#plates">Next</a><a className="m-link m-link--nav" href="#plates">Source</a></div>
              </div>
            </State>
          </States>
        </Section>

        <Section id="fields" title="Fields">
          <div className="style-fields">
            <Field label="Your name"><input className="m-input" placeholder="Ada Lovelace" /></Field>
            <Field label="Hover"><input className="m-input" data-hover defaultValue="Still the same field" /></Field>
            <Field label="Blur radius">
              <span className="m-field-unit"><input className="m-input m-readout" inputMode="decimal" defaultValue="12" /><span className="m-readout">px</span></span>
            </Field>
            <Field label="Message" message={<><b>Error:</b> Write at least one word.</>}><input className="m-input" aria-invalid="true" defaultValue="" /></Field>
            <Field label="Disabled"><input className="m-input" disabled defaultValue="Read only here" /></Field>
            <Field label="Material">
              <span className="m-select">
                <select className="m-input" defaultValue="glass"><option value="paper">Paper</option><option value="glass">Glass</option><option value="chrome">Chrome</option></select>
                {CHEVRON}
              </span>
            </Field>
            <Field label="Greeting" wide><textarea className="m-input" defaultValue="Greetings from the web." /></Field>
          </div>
        </Section>

        <Section id="controls" title="Controls">
          <States title="Checkbox and radio" note="The label is part of the target.">
            <State label="Off"><Check label="Cast shadows" /></State>
            <State label="On"><Check label="Cast shadows" checked /></State>
            <State label="Hover"><Check label="Cast shadows" hover /></State>
            <State label="Disabled"><Check label="Cast shadows" checked disabled /></State>
            <State label="Radio"><span className="style-radios"><Check label="Paper" radio name="ground" checked /><Check label="Ink" radio name="ground" /></span></State>
          </States>
          <States title="Toggle" note="The word beside it says the state, so position never carries it alone.">
            <State label="Off"><Toggle label="Shadows" initial={false} /></State>
            <State label="On"><Toggle label="Shadows" initial /></State>
            <State label="Disabled"><Toggle label="Shadows" initial disabled /></State>
          </States>
          <States title="Slider" note="Arrows step by one, Shift by ten. The fill is ink to the thumb; the ruler stays.">
            <State label="Live" wide><Slider label="Light distance" unit="px" initial={64} min={0} max={160} /></State>
            <State label="Disabled" wide><Slider label="Light distance" unit="px" initial={64} min={0} max={160} disabled /></State>
          </States>
          <States title="Dial" note="Drag up or down, or use the arrows. The ticks are the ruler, bent.">
            <State label="Live"><Dial label="Cutoff" /></State>
          </States>
        </Section>

        <Section id="panels" title="Panels and windows">
          <div className="style-panels" data-ground="field">
            <TuningPanel />
            <div className="style-windows">
              <div className="m-window">
                <div className="m-window-bar"><button type="button" className="m-window-close" aria-label="Close quadrato" />quadrato</div>
                <div className="m-window-body m-quiet">An unfocused window. Paper title bar, ink rule below.</div>
              </div>
              <div className="m-window" data-focused>
                <div className="m-window-bar"><button type="button" className="m-window-close" aria-label="Close scheda" />scheda</div>
                <div className="m-window-body">The focused window. Its title bar inverts. No shadow: windows separate by their edge and the field behind them.</div>
              </div>
            </div>
          </div>
        </Section>

        <Section id="status" title="Status and notices">
          <States title="Status" note="The word is always there; the square only repeats it.">
            <State label="Live"><span className="m-status" data-status="live">HTML-in-canvas</span></State>
            <State label="Fallback"><span className="m-status" data-status="fallback">snapDOM</span></State>
            <State label="Idle"><span className="m-status" data-status="idle">Waiting for input</span></State>
            <State label="Unavailable"><span className="m-status" data-status="unavailable">No capture</span></State>
          </States>
          <States title="Tag" note="Not clickable.">
            <State label="Renderer"><span className="m-tag">WebGPU</span></State>
            <State label="Browser"><span className="m-tag">Chrome 155</span></State>
          </States>
          <div className="style-notices">
            <div className="m-notice" role="status"><b>Needs Chrome.</b><p>Other browsers draw this demo through snapDOM, so the caret is not painted.</p><button type="button" className="m-textbutton">Dismiss</button></div>
            <div className="m-notice" role="alert"><b>Error:</b><p>The scene lost its GPU device. Reload the page to draw it again.</p></div>
          </div>
        </Section>

        <Section id="voice" title="Voice">
          <p className="m-body m-quiet style-note">Plain mechanics in sentence case. Name the thing and say what it does. Buttons are verbs, toggles are nouns, numbers carry units.</p>
          <table className="style-table style-voice m-ui">
            <thead><tr><th className="m-label">Write</th><th className="m-label">Not</th></tr></thead>
            <tbody>
              <tr><td>Buttons still click, fields still take typing, and text still selects.</td><td className="m-quiet">Experience seamless, delightful interactivity.</td></tr>
              <tr><td>Needs Chrome. Other browsers use snapDOM.</td><td className="m-quiet">Oops! Your browser isn’t supported yet.</td></tr>
              <tr><td>Drag the bulb to move the light.</td><td className="m-quiet">Unleash the power of real-time lighting.</td></tr>
            </tbody>
          </table>
        </Section>

        <Section id="demos" title="Demos">
          <div className="style-adopt">
            <div>
              <h3 className="m-heading">From the system</h3>
              <ul className="m-body">
                <li>Tokens, type steps, the focus ring and the motion durations.</li>
                <li>The demo bar, the tuning panel and every control outside the demo’s subject.</li>
                <li>Captions, notices and status.</li>
                <li>One ground: paper, field or ink.</li>
                <li>The voice.</li>
              </ul>
            </div>
            <div>
              <h3 className="m-heading">The demo’s own</h3>
              <ul className="m-body">
                <li>Its scene: geometry, materials, shaders, light and real shadows.</li>
                <li>One or two palette colors for its subject.</li>
                <li>The subject’s own type and surface, like the postcard’s Bodoni or the knobs’ machined faces.</li>
                <li>Motion inside the scene, springs included.</li>
              </ul>
            </div>
          </div>
        </Section>
      </main>

      <footer className="style-footer m-small m-quiet">
        <p>Named for the Italian designer Bruno Munari.</p>
        <a className="m-link m-link--nav" href={sceneUrl('home')}>Back to the demos</a>
      </footer>
    </div>
  )
}

function formatRatio(ratio: number): string {
  return `${ratio.toFixed(1)}:1`
}

// ── layout helpers ───────────────────────────────────────────────────

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="m-section style-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      <div className="style-section-body">{children}</div>
    </section>
  )
}

function States({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <div className="style-states">
      <div className="style-states-head"><h3 className="m-label">{title}</h3><p className="m-small m-quiet">{note}</p></div>
      <div className="style-states-row">{children}</div>
    </div>
  )
}

function State({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <figure className={wide ? 'style-state style-state--wide' : 'style-state'}>
      <div className="style-state-specimen">{children}</div>
      <figcaption className="m-small m-quiet">{label}</figcaption>
    </figure>
  )
}

function Labeled({ label, note, children }: { label: string; note: string; children: ReactNode }) {
  return (
    <div className="style-labeled">
      <div className="style-labeled-specimen">{children}</div>
      <span className="m-label">{label}</span>
      <span className="m-small m-quiet">{note}</span>
    </div>
  )
}

// ── specimens ────────────────────────────────────────────────────────

function Plate({ id, number, title, headline, state, hover = false, pressed = false }: { id: string; number: string; title: string; headline: string; state: string; hover?: boolean; pressed?: boolean }) {
  return (
    <figure className="style-state">
      <button type="button" className="m-plate" data-hover={hover || undefined} aria-pressed={pressed}>
        <img className="m-plate-image" src={`/thumbs/${id}.jpg`} alt="" />
        <span className="m-plate-meta"><span className="m-plate-number m-readout">{number}</span><span className="m-plate-title">{title}</span></span>
        <span className="m-plate-headline">{headline}</span>
      </button>
      <figcaption className="m-small m-quiet">{state}</figcaption>
    </figure>
  )
}

function Field({ label, message, wide = false, children }: { label: string; message?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <label className={wide ? 'm-field style-field--wide' : 'm-field'}>
      <span className="m-field-label">{label}</span>
      {children}
      {message && <span className="m-field-message">{message}</span>}
    </label>
  )
}

function Check({ label, checked = false, disabled = false, hover = false, radio = false, name }: { label: string; checked?: boolean; disabled?: boolean; hover?: boolean; radio?: boolean; name?: string }) {
  return (
    <label className={radio ? 'm-check m-check--radio' : 'm-check'} data-hover={hover || undefined}>
      <input type={radio ? 'radio' : 'checkbox'} name={name} defaultChecked={checked} disabled={disabled} />
      <span className="m-check-box">{radio ? null : CHECK}</span>
      {label}
    </label>
  )
}

function Toggle({ label, initial, disabled = false }: { label: string; initial: boolean; disabled?: boolean }) {
  const [on, setOn] = useState(initial)
  return (
    <button type="button" role="switch" aria-checked={on} className="m-toggle" disabled={disabled} onClick={() => setOn(!on)}>
      <span className="m-toggle-track" aria-hidden />
      {label}
      <span className="m-toggle-state m-readout">{on ? 'On' : 'Off'}</span>
    </button>
  )
}

type SliderStyle = CSSProperties & { '--m-value': string }

function Slider({ label, unit, initial, min, max, disabled = false }: { label: string; unit: string; initial: number; min: number; max: number; disabled?: boolean }) {
  const [value, setValue] = useState(initial)
  const style: SliderStyle = { '--m-value': `${((value - min) / (max - min)) * 100}%` }
  return (
    <label className="m-slider" style={style}>
      <span className="m-slider-head"><span className="m-small">{label}</span><span className="m-slider-value m-readout">{value} {unit}</span></span>
      <span className="m-slider-control">
        <input type="range" min={min} max={max} value={value} disabled={disabled} onChange={(event) => setValue(Number(event.target.value))} />
        <span className="m-slider-track m-ruler" aria-hidden />
        <span className="m-slider-fill" aria-hidden />
        <span className="m-slider-thumb" aria-hidden />
      </span>
      <span className="m-slider-ends m-readout" aria-hidden><span>{min}</span><span>{max}</span></span>
    </label>
  )
}

type DialStyle = CSSProperties & { '--m-turn': string }

function Dial({ label }: { label: string }) {
  const [value, setValue] = useState(35)
  const set = (next: number) => setValue(Math.min(100, Math.max(0, Math.round(next))))
  const onKey = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 1
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') set(value + step)
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') set(value - step)
    else return
    event.preventDefault()
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const startY = event.clientY
    const startValue = value
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const move = (e: globalThis.PointerEvent) => set(startValue + (startY - e.clientY) / 2)
    const end = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', end) }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', end)
  }
  const style: DialStyle = { '--m-turn': `${-135 + value * 2.7}deg` }
  return (
    <div className="style-dial">
      <div className="m-dial" role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} style={style} onKeyDown={onKey} onPointerDown={onPointerDown} />
      <span className="m-small">{label}</span>
      <span className="m-readout m-quiet">{value} %</span>
    </div>
  )
}

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <div className="m-copy">
      <code>{text}</code>
      <button type="button" className="m-textbutton" onClick={() => { void navigator.clipboard.writeText(text).then(() => setCopied(true)) }}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  )
}

function TuningPanel() {
  return (
    <div className="m-panel" role="group" aria-label="Tune Plume">
      <div className="m-panel-head"><b>Tune Plume</b><button type="button" className="m-textbutton">Hide</button></div>
      <details open>
        <summary>Timing{CHEVRON}</summary>
        <div className="m-panel-group">
          <Slider label="Pause before dissolving" unit="ms" initial={600} min={0} max={2000} />
          <Toggle label="Drift with the pointer" initial />
        </div>
      </details>
      <details>
        <summary>Particles{CHEVRON}</summary>
        <div className="m-panel-group">
          <Slider label="Count" unit="k" initial={24} min={1} max={64} />
        </div>
      </details>
      <div className="m-panel-foot">
        <button type="button" className="m-button m-button--outline m-button--compact">Copy values</button>
        <button type="button" className="m-button m-button--outline m-button--compact">Reset</button>
      </div>
    </div>
  )
}
