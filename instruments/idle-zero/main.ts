// idle-zero — the upload-on-paint economy, measured (instruments/
// charter: measurement is maintained infrastructure).
//
// The claim under gate: a mounted, visually quiescent source paints
// ZERO times per second. paint="auto" is passive — the compositor's
// self-firing onpaint is the only change signal, and while nothing in
// the subtree changes its paint record, that signal stays silent. The
// whole upload-on-paint economy (idle Surfaces free, ~64–96 animating
// ceiling) rests on this; a stray repaint loop, MutationObserver, or
// dirty-flag heuristic added to the paint path shows up HERE as a
// nonzero idle delta before it shows up anywhere else.
//
// Two legs, both load-bearing:
//   idle    — N realistic static cards, counted over a window: every
//             delta must be exactly 0. (The economy.)
//   provoke — one deliberate DOM mutation afterwards: the counter must
//             advance. (Proof the instrument is live — without this, a
//             broken onpaint wiring would pass the idle leg vacuously.)
import { createDomTextureSource, type DomTextureSource } from '@anamorph/core'

const params = new URLSearchParams(location.search)
const N = Number(params.get('n') ?? 12)

const hud = document.getElementById('hud')!

/** The trial surface, detected the honest way: the API is either on the
 * 2D context or the machine can't run this gate. */
function detectCapability(): boolean {
  const ctx = document.createElement('canvas').getContext('2d')
  return typeof (ctx as unknown as { drawElementImage?: unknown }).drawElementImage === 'function'
}

/** A realistic quiescent card: text, border, radius, background — the
 * things a real Surface paints once and then never again. System font
 * stack on purpose: no webfont swap can invalidate paint records
 * mid-window (we still await document.fonts.ready before measuring). */
function cardMarkup(i: number): string {
  return `<div style="box-sizing:border-box;width:240px;height:140px;padding:16px;
    border:1px solid #d0d7de;border-radius:10px;background:#ffffff;color:#1f2328;
    font:14px/1.45 system-ui,sans-serif">
    <div style="font-weight:600">card ${i}</div>
    <div data-stamp>at rest</div>
    <div style="color:#57606a">idle sources are free</div>
  </div>`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor(cond: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const t0 = performance.now()
  while (!cond()) {
    if (performance.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await sleep(50)
  }
}

interface RunResult {
  n: number
  /** paintCount deltas across the idle window — every entry must be 0. */
  idleDeltas: number[]
  /** paintCount delta on source 0 after a deliberate text mutation — must be > 0. */
  provokedDelta: number
  windowMs: number
}

interface IdleZero {
  capable: boolean
  ready: boolean
  sources: DomTextureSource[]
  stats: () => Array<{ label: string; painted: boolean; paintCount: number }>
  run: (opts?: { settleMs?: number; windowMs?: number }) => Promise<RunResult>
}

declare global {
  interface Window {
    __idleZero: IdleZero
  }
}

const capable = detectCapability()
const sources: DomTextureSource[] = capable
  ? Array.from({ length: N }, (_, i) =>
      createDomTextureSource(cardMarkup(i), 240, 140, { label: `idle-${i}` }),
    )
  : []

window.__idleZero = {
  capable,
  ready: true,
  sources,
  // House rule: a scene that can't be interrogated from the console
  // isn't done.
  stats: () =>
    sources.map((s, i) => ({ label: `idle-${i}`, painted: s.painted(), paintCount: s.paintCount() })),

  async run({ settleMs = 1200, windowMs = 3000 } = {}) {
    if (!capable) throw new Error('drawElementImage absent — run.mjs should have skipped')

    // Every source must reach its first paint before the clock means
    // anything — a source that never painted would idle at 0 for the
    // wrong reason.
    await waitFor(() => sources.every((s) => s.painted()), 15_000, 'first paint on all sources')
    await document.fonts.ready
    await sleep(settleMs)

    const before = sources.map((s) => s.paintCount())
    await sleep(windowMs)
    const idleDeltas = sources.map((s, i) => s.paintCount() - before[i]!)

    // The liveness leg, AFTER the idle window so the window stays pure:
    // mutate one subtree, the compositor must tell us.
    const zero = sources[0]!
    const provokedBase = zero.paintCount()
    zero.element.querySelector('[data-stamp]')!.textContent = 'provoked'
    await waitFor(() => zero.paintCount() > provokedBase, 5_000, 'provoked repaint on source 0')
    const provokedDelta = zero.paintCount() - provokedBase

    return { n: N, idleDeltas, provokedDelta, windowMs }
  },
}

hud.innerHTML = capable
  ? `idle-zero: <b>${N} sources parked</b> — drive with <code>__idleZero.run()</code>`
  : `idle-zero: <span class="bad">drawElementImage absent</span> — launch Chrome with --enable-features=CanvasDrawElement`
