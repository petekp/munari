// Idle capture — quiet frozen and live sources must produce no new paints.
// Frozen sources can decline unsolicited compositor callbacks; only a live
// quiet profile detects those callbacks becoming unnecessary capture work.
import { createDomTextureSource, type DomTextureSource } from '@munari/core'

const params = new URLSearchParams(location.search)
const N = Number(params.get('n') ?? 12)

const hud = document.getElementById('hud')!

/** The trial surface, detected the honest way: the API is either on the
 * 2D context or the machine can't run this gate. */
function detectCapability(): boolean {
  const ctx = document.createElement('canvas').getContext('2d')
  return ctx !== null && 'drawElementImage' in ctx
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

interface QuietProfile {
  live: boolean
  idleDeltas: number[]
  recurringRequests: number
  recurringCallbacks: number
  windowMs: number
}

interface RunResult {
  n: number
  profiles: QuietProfile[]
  provokedDelta: number
}

interface TrialCanvas extends HTMLCanvasElement {
  requestPaint(): void
  onpaint: (() => void) | null
}

interface IdleZero {
  capable: boolean
  ready: boolean
  sources: DomTextureSource[]
  stats: () => Array<{ label: string; painted: boolean; paintCount: number }>
  run: (opts?: { settleMs?: number; windowMs?: number; recurringPaint?: boolean }) => Promise<RunResult>
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
  stats: () =>
    sources.map((s, i) => ({ label: `idle-${i}`, painted: s.painted(), paintCount: s.paintCount() })),

  async run({ settleMs = 1200, windowMs = 3000, recurringPaint = false } = {}) {
    if (!capable) throw new Error('drawElementImage absent — run.mjs should have skipped')
    if (!Number.isInteger(N) || N < 1) throw new Error('Source count must be a positive integer')
    if (!Number.isFinite(settleMs) || settleMs < 0 || !Number.isFinite(windowMs) || windowMs <= 0) {
      throw new Error('Invalid idle observation duration')
    }

    await waitFor(() => sources.every((s) => s.painted()), 15_000, 'first paint on all sources')
    await document.fonts.ready
    const profiles: QuietProfile[] = []
    for (const live of [false, true]) {
      const switchPaints = sources.map((source) => source.paintCount())
      for (const source of sources) source.setLive(live)
      if (live) {
        await waitFor(
          () => sources.every((source, i) => source.paintCount() > switchPaints[i]!),
          5000,
          'live capture on all sources',
        )
      }
      await sleep(settleMs)
      const before = sources.map((source) => source.paintCount())
      let recurringRequests = 0
      let recurringCallbacks = 0
      let completedRequests = 0
      let callback = 0
      // SAFETY: the native engine created this canvas with the trial API after capability detection.
      const canvas = sources[0]!.canvas as TrialCanvas
      const originalPaint = canvas.onpaint
      if (recurringPaint) {
        canvas.onpaint = () => {
          recurringCallbacks++
          completedRequests = recurringRequests
          originalPaint?.()
        }
      }
      const request = () => {
        // Native requestPaint schedules onpaint without marking source demand.
        // Frozen sources may decline it; live sources reveal the injected work.
        canvas.requestPaint()
        recurringRequests++
        callback = requestAnimationFrame(request)
      }
      try {
        if (recurringPaint) callback = requestAnimationFrame(request)
        await sleep(windowMs)
        profiles.push({
          live,
          idleDeltas: sources.map((source, i) => source.paintCount() - before[i]!),
          recurringRequests,
          recurringCallbacks,
          windowMs,
        })
      } finally {
        cancelAnimationFrame(callback)
        try {
          if (recurringRequests > 0) {
            await waitFor(() => completedRequests === recurringRequests, 5000, 'final recurring paint callback')
          }
        } finally {
          canvas.onpaint = originalPaint
        }
      }
    }

    const zero = sources[0]!
    const provokedBase = zero.paintCount()
    const stamp = zero.element.querySelector('[data-stamp]')!
    stamp.textContent = stamp.textContent === 'provoked' ? 'provoked again' : 'provoked'
    await waitFor(() => zero.paintCount() > provokedBase, 5000, 'provoked repaint on source 0')
    const provokedDelta = zero.paintCount() - provokedBase

    return { n: N, profiles, provokedDelta }
  },
}

hud.innerHTML = capable
  ? `idle-zero: <b>${N} sources parked</b> — drive with <code>__idleZero.run()</code>`
  : `idle-zero: <span class="bad">drawElementImage absent</span> — launch Chrome with --enable-features=CanvasDrawElement`
