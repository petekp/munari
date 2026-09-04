// The logo playground — a side page, not one of the eight scenes.
//
// The wordmark from the sketch: six letters, each in its own face and
// color, set a little haphazard and never sitting still. A conductor
// (logoLaw.ts) re-rolls one letter per beat — new face, new color, new
// tilt — and the CSS spring makes each change land as a hop. All of it
// is ordinary DOM: the page IS the logo, tweakable from the panel.
//
// The munari trick is the "matter" switch, and the WebGL half of it —
// the six-part Surface, the twins, the substance shaders — lives in
// logoMatter.tsx, shared with the official wordmark component. This
// module owns what makes the page a PLAYGROUND: the conductor, the
// seed, the panel, and the probe handles.
//
// Landing runs the protocol backwards: progress ramps to zero, the
// twins glide back onto the grid, and the page takes its letters back
// in the same commit that drops the canvas. At no frame is a letter in
// nobody's hands — a sentence that is now a conformance contract
// rather than a comment.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Surface,
  type SurfacePresentation,
  useSurfaceSupport,
  useSurfaceHandle,
} from '@petepetrash/munari'
import { useCarriedMotion } from '@petepetrash/munari/advanced'
import {
  LOGO_DEFAULTS,
  beatPlan,
  makeRng,
  nextBeat,
  rollPose,
  seedWord,
  waveSteps,
  type BeatStep,
  type LetterPose,
  type LogoKnobs,
} from './logoLaw'
import {
  GRID,
  MatterWord,
  SEED0,
  WORD,
  ensureLogoFonts,
  glyphPaint,
  type LetterBox,
  type WordMetrics,
} from './logoMatter'
import './logo.css'

// ── the tweak panel ─────────────────────────────────────────────────────

// The panel shows the subset of LogoKnobs still being tuned by eye. The
// settled ones ship at LOGO_DEFAULTS and move in logoLaw.ts; adding a row
// back here exposes one again. The shader gate drives knobs through
// `window.__logo` rather than this list, so hiding a row cannot silently
// drop a material from its walk.
const SLIDERS: {
  key: keyof LogoKnobs
  label: string
  min: number
  max: number
  step: number
  matterOnly?: boolean
}[] = [
  // 0.9, not 1: gloss becomes uFx, the mix weight in
  // `mix(base.rgb, aces(lit) * base.a, uFx)` (logoShaders.ts). At exactly 1
  // the page's own texel leaves the blend and the letters render from
  // lighting alone, which comes up black (2026-08-15). The cap is on what
  // the panel can ask for; LogoKnobs still carries the full range.
  { key: 'gloss', label: 'gloss', min: 0, max: 0.9, step: 0.05, matterOnly: true },
  { key: 'polish', label: 'polish', min: 0, max: 2, step: 0.05, matterOnly: true },
  { key: 'sheen', label: 'sheen', min: 0, max: 2, step: 0.05, matterOnly: true },
  { key: 'irid', label: 'irid', min: 0, max: 2, step: 0.05, matterOnly: true },
  { key: 'glow', label: 'glow', min: 0, max: 2, step: 0.05, matterOnly: true },
  { key: 'jelly', label: 'jelly', min: 0, max: 1, step: 0.05, matterOnly: true },
  { key: 'prism', label: 'prism', min: 0, max: 1, step: 0.05, matterOnly: true },
  // Not 'relief px': the number is a gain referenced to 22, and the px
  // it buys are per-matter (LogoKnobs.relief).
  { key: 'relief', label: 'relief', min: 0, max: 60, step: 2, matterOnly: true },
  { key: 'extrude', label: 'extrude px', min: 0, max: 80, step: 2, matterOnly: true },
  { key: 'lightYaw', label: 'light yaw°', min: -80, max: 80, step: 1, matterOnly: true },
  { key: 'lightPitch', label: 'light pitch°', min: -45, max: 80, step: 1, matterOnly: true },
  { key: 'key', label: 'key light', min: 0, max: 2, step: 0.05, matterOnly: true },
  { key: 'keySoft', label: 'key soft', min: 0.2, max: 2, step: 0.05, matterOnly: true },
  { key: 'room', label: 'room', min: 0, max: 2, step: 0.05, matterOnly: true },
  { key: 'waveScale', label: 'wave scale', min: 0.3, max: 3, step: 0.05, matterOnly: true },
  { key: 'waveSpeed', label: 'wave speed', min: 0, max: 3, step: 0.05, matterOnly: true },
  { key: 'waveAngle', label: 'wave angle°', min: -90, max: 90, step: 5, matterOnly: true },
]

/** The logo scene's probe handle: the shader gate walks the material states
 *  by setting knobs directly, independent of which rows the panel shows. */
export interface LogoProbeApi {
  setKnob: (key: keyof LogoKnobs, value: number) => void
}

// ── the page ────────────────────────────────────────────────────────────

export function LogoApp() {
  useEffect(ensureLogoFonts, [])

  const [knobs, setKnobs] = useState<LogoKnobs>(LOGO_DEFAULTS)
  // Multiplies the stylesheet's responsive base (--logo-base) rather than
  // naming a px size, so the wordmark still answers the viewport at every
  // setting. Not a LogoKnob: those reach the shaders through a ref, and this
  // one never leaves the DOM. Everything downstream is em — slots, drift,
  // float amplitude — and the WebGL twins size themselves from the fontPx
  // measured below, so this single number carries the whole scene.
  const [textScale, setTextScale] = useState(1)
  const [compact, setCompact] = useState(false)
  const [seed, setSeed] = useState(SEED0)
  // `?probe=still` boots with the conductor paused, so a capture reads
  // the CROSSING alone: beats mid-capture fold the choreography into the
  // measurement. Written for crossing-flash, which is gone; kept because
  // any future crossing instrument needs the same still page.
  const [running, setRunning] = useState(
    () => new URLSearchParams(window.location.search).get('probe') !== 'still',
  )
  const knobsRef = useRef(knobs)
  knobsRef.current = knobs

  // The shader gate reaches materials the panel no longer exposes. Driving
  // knobs from here keeps its walk independent of panel layout: a hidden row
  // costs the gate nothing, where clicking a slider that stopped existing
  // passed while proving less.
  useEffect(() => {
    window.__logo = { setKnob: (key, value) => setKnobs((k) => ({ ...k, [key]: value })) }
    return () => {
      delete window.__logo
    }
  }, [])

  // The handoff is the library's now (this page is where it bled
  // first): six parts must each prove a post-draw color write, and the
  // settle dwell outlasts the compositor-clocked eases — hop and color;
  // the carried float is exempt — the facts that make the swap frame
  // pixel-identical even mid-breath. The handle holds the phases, the
  // evidence gate, and the reversal rule; this page states its timing
  // and reads back what it needs to dress the DOM.
  const supported = useSurfaceSupport()
  const [view, setView] = useState<SurfacePresentation>('page')
  const [presented, setPresented] = useState<SurfacePresentation>('page')
  const [settledOn, setSettledOn] = useState<SurfacePresentation>('page')
  // Identity only. The view, the timing, and the callbacks are stated once,
  // on the `<Surface>` that declares this handle.
  const surface = useSurfaceHandle('logo')
  const request = useCallback((webgl: boolean) => {
    setView(webgl ? 'canvas' : 'page')
  }, [])
  const inCrossing = view !== presented || view !== settledOn
  // Who shows the letters. The page keeps them until it actually lets
  // go, which is a draw, not a commit — so the phase the word wears is
  // read from the hold rather than from the request.
  const phase = presented === 'canvas' ? 'gl' : inCrossing ? 'lifting' : 'page'

  const rRef = useRef(makeRng(SEED0))
  const [poses, setPoses] = useState<LetterPose[]>(() =>
    seedWord(WORD.length, makeRng(SEED0), LOGO_DEFAULTS),
  )
  useEffect(() => {
    rRef.current = makeRng(seed)
    setPoses(seedWord(WORD.length, rRef.current, knobsRef.current))
  }, [seed])

  // One letter re-rolls against its own current pose AND both standing
  // neighbors — the constraint that keeps the word six distinct voices.
  const swapLetter = useCallback((i: number) => {
    setPoses((prev) => {
      const near = [prev[i - 1], prev[i + 1]].filter((p) => p !== undefined)
      const next = prev.slice()
      next[i] = rollPose(
        rRef.current,
        {
          fonts: [prev[i].font, ...near.map((p) => p.font)],
          colors: [prev[i].color, ...near.map((p) => p.color)],
          matters: [prev[i].matter, ...near.map((p) => p.matter)],
        },
        knobsRef.current,
      )
      return next
    })
  }, [])

  // Wave steps land on their own delays; the ids are kept so pausing (or
  // leaving the page) silences a sweep already in the air.
  const pending = useRef<number[]>([])
  const schedule = useCallback(
    (steps: BeatStep[]) => {
      for (const s of steps) {
        if (s.delay === 0) swapLetter(s.letter)
        else pending.current.push(window.setTimeout(() => swapLetter(s.letter), s.delay))
      }
    },
    [swapLetter],
  )

  // The conductor: a swung setTimeout chain, reading knobs through the
  // ref so dragging tempo never restarts the loop mid-phrase. It rests
  // during a crossing — a beat landing mid-handoff would put the page
  // letter and its twin mid-transition on different clocks, and the
  // swap frame would stop being pixel-identical.
  useEffect(() => {
    if (!running || inCrossing) return
    let beat = 0
    const tick = () => {
      schedule(beatPlan(rRef.current, WORD.length, knobsRef.current))
      beat = window.setTimeout(tick, nextBeat(rRef.current, knobsRef.current))
    }
    beat = window.setTimeout(tick, nextBeat(rRef.current, knobsRef.current))
    return () => {
      clearTimeout(beat)
      pending.current.forEach(clearTimeout)
      pending.current = []
    }
  }, [running, inCrossing, seed, schedule])

  // Idle float: per-letter period and phase rolled once per take, so six
  // letters breathe out of step instead of pumping in unison.
  const floats = useMemo(() => {
    const r = makeRng(seed ^ 0x9e3779b9)
    return WORD.split('').map(() => ({
      dur: 2600 + r() * 2400,
      delay: -r() * 2600,
    }))
  }, [seed])

  // The float is CARRIED (useCarriedMotion): one clock owns it, the
  // page writes its per-frame sample to the slots and the meshes read
  // the same sample, so a crossing never parks it — the letters keep
  // breathing straight through the swap in both directions
  // (decisions.md #30). The amplitude smooths toward the knob (and
  // toward zero under prefers-reduced-motion) inside the program,
  // replacing the registered-property ease this page used when the
  // float lived on the compositor's clock.
  const slotRefs = useRef<(HTMLElement | null)[]>([])
  const reduced = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)'), [])
  const float = useCarriedMotion(
    useMemo(() => {
      let amp = 0
      let lastT = 0
      return (t: number) => {
        const dt = Math.min(t - lastT, 100)
        lastT = t
        const target = reduced.matches ? 0 : knobsRef.current.float
        amp += (target - amp) * (1 - Math.exp(-dt / 150))
        return floats.map((f) => -Math.cos(((t - f.delay) / f.dur) * Math.PI * 2) * amp)
      }
    }, [floats, reduced]),
    useCallback((v: number[]) => {
      slotRefs.current.forEach((el, i) => {
        if (el) el.style.transform = `translateY(${v[i]}em)`
      })
    }, []),
  )

  // ── measurement for matter mode ──
  // The word is measured for exactly two numbers — its viewport origin
  // and its resolved font-size — and every center is COMPUTED from the
  // same grid the page renders (slotLayout, in em). Reading centers
  // back through offsetLeft/offsetWidth loses the truth: those APIs are
  // integers by spec while the 9vw font-size makes the real geometry
  // fractional, and the stacked rounding stood each twin up to ~1 CSS
  // px (two device px on Retina) off its letter — a visible up-and-
  // sideways step at the swap frame (2026-08-13).
  const wordRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const syncPresented = useCallback((next: SurfacePresentation) => {
    // The hold changes inside a renderer frame. React state commits later,
    // which left one frame where the canvas had stopped writing but the page
    // letters were still hidden. Put the two CSS ownership flags on their
    // elements synchronously, then let React record the same state.
    if (wordRef.current) wordRef.current.dataset.phase = next === 'canvas' ? 'gl' : 'page'
    if (canvasRef.current) canvasRef.current.dataset.holds = String(next === 'canvas')
    setPresented(next)
  }, [])
  const [metrics, setMetrics] = useState<WordMetrics | null>(null)
  const lastKey = useRef('')
  const measure = useCallback(() => {
    const word = wordRef.current
    if (!word) return
    const wr = word.getBoundingClientRect()
    const fontPx = parseFloat(getComputedStyle(word).fontSize)
    const pad = Math.round(fontPx * 0.45)
    // Slots sit at top: 0 with height 1em, so every vertical center is
    // 0.5em below the word's own top — no per-letter reads at all.
    const boxes: LetterBox[] = GRID.slots.map((slot) => ({
      cx: wr.left + (slot.left + slot.width / 2) * fontPx,
      cy: wr.top + 0.5 * fontPx,
      w: Math.ceil((slot.width * fontPx + pad * 2) / 16) * 16,
      h: Math.ceil((fontPx + pad * 2) / 16) * 16,
    }))
    const key = `${fontPx}|${boxes
      .map((b) => `${b.cx.toFixed(2)},${b.cy.toFixed(2)},${b.w},${b.h}`)
      .join(' ')}`
    if (key === lastKey.current) return
    lastKey.current = key
    setMetrics({ fontPx, boxes })
  }, [])
  // The grid only moves when the viewport does (the word's font-size is
  // a clamp on vw) — but re-measuring after every commit is cheap with
  // the key dedupe, and it makes the lift's first frame correct
  // without ordering assumptions.
  useLayoutEffect(() => {
    if (supported) measure()
  })
  useEffect(() => {
    if (!supported) return
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [supported, measure])

  const setKnob = (key: keyof LogoKnobs, value: number) =>
    setKnobs((k) => ({ ...k, [key]: value }))

  return (
    <div className="logo-page">
      <div className="logo-plate">
        <Surface.DOM surface={surface} className="logo-page-copy">
          <div
          className="logo-word"
          ref={wordRef}
          // The protocol phase, worn on the DOM: logo.css keys letter
          // visibility off it, and an instrument can read it to know
          // when a crossing is mid-air.
          data-phase={phase}
          // React writes this during the commit, so the layout effect that
          // measures fontPx below reads the new size in the same frame —
          // an effect that set it afterwards would leave the twins one
          // commit behind, at the wrong size for a frame after every step.
          style={{ width: `${GRID.width}em`, fontSize: `calc(var(--logo-base) * ${textScale})` }}
        >
          {WORD.split('').map((ch, i) => (
            <span
              key={i}
              className="logo-slot"
              // The carrier writes this slot's transform every frame —
              // the float never pauses for a crossing, because the
              // meshes are reading the same sample it is writing.
              ref={(el) => {
                slotRefs.current[i] = el
              }}
              style={{
                left: `${GRID.slots[i].left}em`,
                width: `${GRID.slots[i].width}em`,
              }}
            >
              <span
                className="logo-letter"
                style={{
                  ...glyphPaint(poses[i]),
                  transform: `translate(${poses[i].dx}em, ${poses[i].dy}em) rotate(${poses[i].tilt}deg) scale(${poses[i].scale})`,
                }}
              >
                {ch}
              </span>
            </span>
          ))}
          </div>
        </Surface.DOM>
      </div>

      {supported && metrics && (
        <MatterWord
          poses={poses}
          metrics={metrics}
          knobs={knobsRef}
          surface={surface}
          renderIn={view}
          presented={presented}
          canvasRef={canvasRef}
          onPresentationChange={syncPresented}
          onMotionComplete={setSettledOn}
          carried={float.sample}
          solid={knobs.extrude > 0}
        />
      )}

      <div className="logo-panel" data-compact={compact}>
        <button
          className="logo-panel-title"
          aria-expanded={!compact}
          onClick={() => setCompact((v) => !v)}
        >
          <span>wordmark</span>
          <span className="logo-panel-toggle">{compact ? '+' : '−'}</span>
        </button>
        {/* The scene's subject, so it leads the panel: the same letters
            drawn by the page or by WebGL. Naming both renderers as
            segments states which one owns the pixels right now, where a
            checkbox stated only the destination. A flip mid-crossing
            reverses the crossing, never skips it — that rule lives in the
            library now (crossingRequest), so both segments stay live
            while one is in flight. */}
        {/* `data-renderer` is the probe's handle: shader-compile walks the
            scene through both directions by name, so reordering or
            restyling the segments cannot quietly change what it clicks. */}
        {/* Only where there is a second renderer to name. Without the
            trial the WebGL segment offered a destination nothing could
            reach: the request mounted a Canvas whose frameloop never
            advanced, so react-three-fiber's `onCreated` stayed pending
            until the segment was flipped back — and fired against the
            wrapper div it had just unmounted, throwing (2026-08-23). The
            letters are the page's either way, so the scene loses a label
            here and nothing else. */}
        {supported && (
          <div className="logo-matter">
            <button
              data-renderer="html"
              data-on={view === 'page'}
              onClick={() => request(false)}
            >
              HTML
            </button>
            <button data-renderer="gl" data-on={view === 'canvas'} onClick={() => request(true)}>
              WebGL
            </button>
          </div>
        )}
        <div className="logo-panel-row">
          <button onClick={() => setRunning((v) => !v)}>{running ? 'pause' : 'play'}</button>
          <button onClick={() => schedule(waveSteps(rRef.current, WORD.length))}>wave</button>
          <button onClick={() => setSeed(Math.floor(Math.random() * 2 ** 31))}>reroll</button>
        </div>
        <label className="logo-panel-slider">
          <span>text size</span>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={textScale}
            onChange={(e) => setTextScale(Number(e.target.value))}
          />
          <em>{textScale.toFixed(2)}×</em>
        </label>
        {SLIDERS.map((s) => (
          <label
            key={s.key}
            className="logo-panel-slider"
            data-off={s.matterOnly && phase === 'page'}
          >
            <span>{s.label}</span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={knobs[s.key]}
              onChange={(e) => setKnob(s.key, Number(e.target.value))}
            />
            <em>{knobs[s.key]}</em>
          </label>
        ))}
      </div>

    </div>
  )
}
