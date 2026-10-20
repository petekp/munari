// Style guide — the site system shown with its own classes. Every specimen is
// the real component CSS (components/system/system.css) over the real tokens,
// so the page changes when the system does. States at rest use the same
// `[data-hover]` and `[data-active]` twins a captured Surface receives.
import { useEffect, useState, type ReactNode } from 'react'
import { MunariLogo } from '../../components/MunariLogo'
import { Bar, Button, Check, CopyBlock, Dial, Field, Input, Notice, Panel, PanelSection, Plate, Radio, Select, Slider, StageCaption, Status, Tag, TextArea, TextButton, Toggle, UnitInput, Window, type PointerState } from '../../components/system'
import { GUIDE_URL, SOURCE_ROOT } from '../../components/sceneCatalog'
import { sceneUrl } from '../../captureMode'
import { contrastRatio } from './styleContrastLaw'
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
                  <Button compact>Lift</Button>
                  <Button variant="outline" compact>Reset</Button>
                  <a className="m-link m-ui" href="#grounds">Source</a>
                </div>
                <ToggleSpecimen label="Shadows" initial={ground !== 'field'} />
                <SliderSpecimen label="Distance" unit="px" initial={ground === 'ink' ? 72 : 40} min={0} max={120} />
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
            <div><dt className="m-label">Targets</dt><dd className="m-quiet">Page buttons are 44px tall. On touch, every control is at least 44px. Desktop panels go down to 32px.</dd></div>
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
              <tr><td className="m-readout">120ms</td><td>A slider thumb widening, a chevron turning.</td></tr>
              <tr><td className="m-readout">200ms</td><td>A demo fading in over its poster.</td></tr>
              <tr><td className="m-readout">320ms</td><td>A panel opening.</td></tr>
            </tbody>
          </table>
          <p className="m-body m-quiet style-note">One easing, <code className="m-code">cubic-bezier(0.2, 0, 0, 1)</code>. Springs belong to the scene. Layout, text and rules never move, and reduced motion sets every duration to zero.</p>
        </Section>

        <Section id="actions" title="Actions">
          <States title="Button" note="One per view. Inverts on hover.">
            <State label="Default"><Button>Show in 3D</Button></State>
            <State label="Hover"><Button pointerState="hover">Show in 3D</Button></State>
            <State label="Pressed"><Button pointerState="active">Show in 3D</Button></State>
            <State label="Disabled"><Button disabled>Show in 3D</Button></State>
          </States>
          <States title="Outline button" note="Secondary actions and panel footers.">
            <State label="Default"><Button variant="outline">Reset</Button></State>
            <State label="Hover"><Button variant="outline" pointerState="hover">Reset</Button></State>
            <State label="Pressed"><Button variant="outline" pointerState="active">Reset</Button></State>
            <State label="Compact"><Button variant="outline" compact>Reset</Button></State>
          </States>
          <States title="Link and text button" note="Underlined in text; bar links underline on hover.">
            <State label="Default"><a className="m-link m-ui" href="#actions">Open full page</a></State>
            <State label="Hover"><a className="m-link m-ui" href="#actions" data-hover>Open full page</a></State>
            <State label="Pressed"><a className="m-link m-ui" href="#actions" data-active>Open full page</a></State>
            <State label="Disabled"><TextButton disabled>Next</TextButton></State>
          </States>
          <States title="Copy block" note="Code that runs as typed. The button confirms for 1.6s.">
            <State label="Live" wide><CopyBlock text={'npm install @petepetrash/munari @react-three/fiber\nnpm install three@0.186.1 --save-exact'} /></State>
          </States>
        </Section>

        <Section id="plates" title="Plates and stage">
          <p className="m-body m-quiet style-note">A demo in the index is a plate: a numbered image with its name and one line. The numbers follow the catalog's order.</p>
          <div className="style-plates">
            <PlateSpecimen id="genie" number="01" title="Genie" headline="A window that can bend" state="Default" />
            <PlateSpecimen id="flight" number="02" title="Flight" headline="Drag and drop with weight" state="Hover" pointerState="hover" />
            <PlateSpecimen id="light" number="03" title="Light" headline="A lamp over live HTML" state="Selected" selected />
          </div>
          <div className="style-stage-sample">
            <div className="m-stage style-stage-frame"><img src="/thumbs/knobs.jpg" alt="" /></div>
            <StageCaption title="Knobs" action={<a className="m-link" href="#plates">Open full page</a>}>Turn a dial, switch the power, and resize the panel with its corner handle.</StageCaption>
          </div>
          <States title="Demo bar" note="Above every demo page. The wordmark sits at the left, at 26px.">
            <State label="Live" wide>
              <Bar
                className="style-bar"
                title="Genie"
                instruction="Minimize a window, or drag its title toward the dock."
                links={<><span className="m-readout m-quiet">01 / 09</span><a className="m-link m-link--nav" href="#plates">Previous</a><a className="m-link m-link--nav" href="#plates">Next</a><a className="m-link m-link--nav" href="#plates">Source</a></>}
              />
            </State>
          </States>
        </Section>

        <Section id="fields" title="Fields">
          <div className="style-fields">
            <Field label="Your name">{(control) => <Input {...control} placeholder="Ada Lovelace" />}</Field>
            <Field label="Hover">{(control) => <Input {...control} pointerState="hover" defaultValue="Grace Hopper" />}</Field>
            <Field label="Blur radius">{(control) => <UnitInput {...control} unit="px" defaultValue="12" />}</Field>
            <Field label="Message" invalid message={<><b>Error:</b> Write at least one word.</>}>{(control) => <Input {...control} defaultValue="" />}</Field>
            <Field label="Disabled">{(control) => <Input {...control} disabled defaultValue="Read only here" />}</Field>
            <Field label="Material">{(control) => <Select {...control} defaultValue="glass" options={[['paper', 'Paper'], ['glass', 'Glass'], ['chrome', 'Chrome']]} />}</Field>
            <Field label="Greeting" className="style-field--wide">{(control) => <TextArea {...control} defaultValue="Greetings from the web." />}</Field>
          </div>
        </Section>

        <Section id="controls" title="Controls">
          <States title="Checkbox and radio" note="The label is part of the target.">
            <State label="Off"><CheckSpecimen initial={false} /></State>
            <State label="On"><CheckSpecimen initial /></State>
            <State label="Hover"><CheckSpecimen initial={false} pointerState="hover" /></State>
            <State label="Disabled"><CheckSpecimen initial disabled /></State>
            <State label="Radio"><RadioSpecimen /></State>
          </States>
          <States title="Toggle" note="The word beside it says the state, so position never carries it alone.">
            <State label="Off"><ToggleSpecimen label="Shadows" initial={false} /></State>
            <State label="On"><ToggleSpecimen label="Shadows" initial /></State>
            <State label="Disabled"><ToggleSpecimen label="Shadows" initial disabled /></State>
          </States>
          <States title="Slider" note="Arrows step by one, Shift by ten. The fill is ink to the thumb; the ruler stays.">
            <State label="Live" wide><SliderSpecimen label="Light distance" unit="px" initial={64} min={0} max={160} /></State>
            <State label="Disabled" wide><SliderSpecimen label="Light distance" unit="px" initial={64} min={0} max={160} disabled /></State>
          </States>
          <States title="Dial" note="Drag up or down, or use the arrows. The ticks are the ruler, bent.">
            <State label="Live"><DialSpecimen label="Cutoff" /></State>
          </States>
        </Section>

        <Section id="panels" title="Panels and windows">
          <div className="style-panels" data-ground="field">
            <PanelSpecimen />
            <div className="style-windows">
              <Window title="quadrato" bodyClassName="m-quiet">An unfocused window. Paper title bar, ink rule below.</Window>
              <Window title="scheda" focused>The focused window. Its title bar inverts. No shadow: windows separate by their edge and the field behind them.</Window>
            </div>
          </div>
        </Section>

        <Section id="status" title="Status and notices">
          <States title="Status" note="The word is always there; the square only repeats it.">
            <State label="Live"><Status status="live">HTML-in-canvas</Status></State>
            <State label="Fallback"><Status status="fallback">snapDOM</Status></State>
            <State label="Idle"><Status status="idle">Waiting for input</Status></State>
            <State label="Unavailable"><Status status="unavailable">No capture</Status></State>
          </States>
          <States title="Tag" note="Not clickable.">
            <State label="Renderer"><Tag>WebGPU</Tag></State>
            <State label="Browser"><Tag>Chrome 155</Tag></State>
          </States>
          <div className="style-notices">
            <Notice title="Needs Chrome." action={<TextButton>Dismiss</TextButton>}>Other browsers draw this demo through snapDOM, so the caret is not painted.</Notice>
            <Notice title="Error:" kind="error">The scene lost its GPU device. Reload the page to draw it again.</Notice>
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
// The library's components are controlled; these hold each specimen's value.

function PlateSpecimen({ id, state, ...plate }: { id: string; number: string; title: string; headline: string; state: string; selected?: boolean; pointerState?: PointerState }) {
  return (
    <figure className="style-state">
      <Plate image={`/thumbs/${id}.jpg`} {...plate} />
      <figcaption className="m-small m-quiet">{state}</figcaption>
    </figure>
  )
}

function CheckSpecimen({ initial, disabled, pointerState }: { initial: boolean; disabled?: boolean; pointerState?: PointerState }) {
  const [checked, setChecked] = useState(initial)
  return <Check label="Cast shadows" checked={checked} onChange={setChecked} disabled={disabled} pointerState={pointerState} />
}

function RadioSpecimen() {
  const [ground, setGround] = useState<'paper' | 'ink'>('paper')
  return (
    <span className="style-radios">
      <Radio label="Paper" name="ground" checked={ground === 'paper'} onSelect={() => setGround('paper')} />
      <Radio label="Ink" name="ground" checked={ground === 'ink'} onSelect={() => setGround('ink')} />
    </span>
  )
}

function ToggleSpecimen({ label, initial, disabled }: { label: string; initial: boolean; disabled?: boolean }) {
  const [on, setOn] = useState(initial)
  return <Toggle label={label} checked={on} onChange={setOn} disabled={disabled} />
}

function SliderSpecimen({ initial, ...slider }: { label: string; unit: string; initial: number; min: number; max: number; disabled?: boolean }) {
  const [value, setValue] = useState(initial)
  return <Slider value={value} onChange={setValue} {...slider} />
}

function DialSpecimen({ label }: { label: string }) {
  const [value, setValue] = useState(35)
  return <Dial label={label} value={value} onChange={setValue} />
}

function PanelSpecimen() {
  return (
    <Panel
      role="group"
      aria-label="Tune Plume"
      title="Tune Plume"
      action={<TextButton>Hide</TextButton>}
      foot={<><Button variant="outline" compact>Copy values</Button><Button variant="outline" compact>Reset</Button></>}
    >
      <PanelSection title="Timing" defaultOpen>
        <SliderSpecimen label="Pause before dissolving" unit="ms" initial={600} min={0} max={2000} />
        <ToggleSpecimen label="Drift with the pointer" initial />
      </PanelSection>
      <PanelSection title="Particles">
        <SliderSpecimen label="Count" unit="k" initial={24} min={1} max={64} />
      </PanelSection>
    </Panel>
  )
}
