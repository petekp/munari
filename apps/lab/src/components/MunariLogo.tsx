// The official munari wordmark — the logo playground's initial take
// (seed 20260813), distilled to a drop-in component.
//
// The law it inherits: the page word IS the logo. Without HTML-in-canvas
// it renders as ordinary DOM — six letters on the fixed grid, breathing
// on the carried float — and that is the shipped fallback, not a
// degraded one. With the capability it lifts once, automatically, into
// the matter overlay (logoScene.tsx) and stays there: same pixels,
// plus depth bob, wobble, and the pointer dodge.
//
// The conductor still re-rolls letters, at a far slower cadence than
// the playground: a wordmark is furniture, and furniture that re-deals
// itself every second competes with the page it brands (Pete,
// 2026-09-01). Under prefers-reduced-motion the conductor rests
// entirely and the float eases to zero — the word stands still.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  type BeatStep,
  type LetterPose,
  type LogoKnobs,
} from '../scenes/logo/logoLaw'
import {
  GRID,
  LogoScene,
  SEED0,
  WORD,
  ensureLogoFonts,
  LogoLetterHTML,
  SETTLE_MS,
  type LetterBox,
  type WordMetrics,
} from '../scenes/logo/logoScene'
import '../scenes/logo/logo.css'
import './munariLogo.css'

// Dialed by eye on the wordmark bench (?scene=wordmark), 2026-09-01:
// a near-steady ~5s pulse (swing 0.1) that more often than not
// re-deals the whole word at once (wave 0.55), with gentler poses and
// half the playground's depth bob. Every bench-exposed key is restated
// even where it matches LOGO_DEFAULTS today, so the shipped mark
// cannot drift if the playground's defaults move.
export const WORDMARK_KNOBS: LogoKnobs = {
  ...LOGO_DEFAULTS,
  tempo: 5000,
  swing: 0.1,
  wave: 0.55,
  tilt: 4,
  drift: 0.12,
  squish: 0.1,
  float: 0.04,
  depth: 26,
  dodge: 46,
  jelly: 0.35,
  prism: 0.55,
  gloss: 0.7,
}

export function MunariLogo({ className, knobs }: { className?: string; knobs?: LogoKnobs }) {
  useEffect(ensureLogoFonts, [])

  // The wordmark bench (scenes/wordmark) drives `knobs` live; everywhere
  // else the prop is absent and the shipped bag holds.
  const knobsRef = useRef(knobs ?? WORDMARK_KNOBS)
  knobsRef.current = knobs ?? WORDMARK_KNOBS

  const supported = useSurfaceSupport()
  const [view, setView] = useState<SurfacePresentation>('page')
  const [presented, setPresented] = useState<SurfacePresentation>('page')
  const [settledOn, setSettledOn] = useState<SurfacePresentation>('page')
  const surface = useSurfaceHandle('logo')
  // The one behavioral difference from the playground: no renderer
  // switch. The capability answer IS the request — the hook reports
  // false through hydration and flips once, so this fires at most one
  // lift, and a browser without the trial never mounts a canvas.
  useEffect(() => {
    if (!supported) return
    setView('scene')
  }, [supported])
  const inCrossing = view !== presented || view !== settledOn
  const phase = presented === 'scene' ? 'gl' : inCrossing ? 'lifting' : 'page'

  const rRef = useRef(makeRng(SEED0))
  const [poses, setPoses] = useState<LetterPose[]>(() =>
    seedWord(WORD.length, makeRng(SEED0), WORDMARK_KNOBS),
  )

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

  const reduced = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)'), [])

  // The conductor, same swung setTimeout chain as the playground. It
  // rests during a crossing — a beat landing mid-handoff would put the
  // page letter and its twin mid-transition on different clocks — and
  // rests entirely under reduced motion.
  const pending = useRef<number[]>([])
  // tempo/swing in the deps: the chain reads knobsRef per beat, but a
  // slower-to-faster edit would otherwise wait out the beat already
  // scheduled at the old tempo — up to tens of seconds on the wordmark.
  const tempo = (knobs ?? WORDMARK_KNOBS).tempo
  const swing = (knobs ?? WORDMARK_KNOBS).swing
  useEffect(() => {
    if (inCrossing || reduced.matches) return
    const schedule = (steps: BeatStep[]) => {
      for (const s of steps) {
        if (s.delay === 0) swapLetter(s.letter)
        else pending.current.push(window.setTimeout(() => swapLetter(s.letter), s.delay))
      }
    }
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
  }, [inCrossing, reduced, swapLetter, tempo, swing])

  // Idle float: per-letter period and phase, the playground's take.
  const floats = useMemo(() => {
    const r = makeRng(SEED0 ^ 0x9e3779b9)
    return WORD.split('').map(() => ({
      dur: 2600 + r() * 2400,
      delay: -r() * 2600,
    }))
  }, [])

  const slotRefs = useRef<(HTMLElement | null)[]>([])
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

  // Measurement, as in the playground (its comment explains why centers
  // are computed from the grid, not read back per-letter) — plus a
  // scroll listener: the playground's word stood on a fixed page, but a
  // wordmark sits in whatever flow its host puts it in, and a scrolled
  // host moves the grid without firing resize.
  const wordRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const syncPresented = useCallback((next: SurfacePresentation) => {
    if (wordRef.current) wordRef.current.dataset.phase = next === 'scene' ? 'gl' : 'page'
    if (canvasRef.current) canvasRef.current.dataset.holds = String(next === 'scene')
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
  useLayoutEffect(() => {
    if (supported) measure()
  })
  useEffect(() => {
    if (!supported) return
    window.addEventListener('resize', measure)
    // Capture: the host's scroller is usually an inner div, and scroll
    // does not bubble.
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [supported, measure])

  return (
    <div className={className ? `munari-logo ${className}` : 'munari-logo'}>
      <Surface.Root surface={surface} inScene={view === 'scene'} canvas="logo" timing={{ settleMs: SETTLE_MS }} onPresentationChange={syncPresented} onMotionComplete={setSettledOn}>
      <div className="munari-logo__page">
        <div
          className="logo-word"
          ref={wordRef}
          data-phase={phase}
          style={{ width: `${GRID.width}em` }}
        >
        {WORD.split('').map((ch, i) => (
          <span
            key={i}
            className="logo-slot"
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
                flexShrink: 0,
                transform: `translate(${poses[i].dx}em, ${poses[i].dy}em) rotate(${poses[i].tilt}deg) scale(${poses[i].scale})`,
              }}
            >
              <LogoLetterHTML index={i} text={ch} pose={poses[i]} box={metrics?.boxes[i]} fontPx={metrics?.fontPx} />
            </span>
          </span>
        ))}
        </div>
      </div>

      {supported && metrics && (
        <LogoScene
          poses={poses}
          metrics={metrics}
          knobs={knobsRef}
          surface={surface}
          presented={presented}
          canvasRef={canvasRef}
          carried={float.sample}
          solid={false}
        />
      )}
      </Surface.Root>
    </div>
  )
}
