// capture-engines — one set of laws, run against each engine's REAL
// rasterizer (instruments/ charter: measurement is maintained
// infrastructure).
//
// The paint conformance suite runs these same laws against a fake
// rasterizer, which proves the shared helper's arithmetic and nothing
// about pixels. What only a browser can answer: does the installed engine
// actually put the subtree's colors in the canvas, does it stay silent
// while the subtree is still, and does it answer a burst of mutations with
// one raster rather than one per mutation.
//
// The fault this exists for, 2026-09-10: the snapDOM engine's coalescing
// and its change observer are its own code, and a fake rasterizer that
// resolves in a microtask cannot distinguish "coalesced" from "the
// rasterizer was too fast to overlap". A real raster takes milliseconds,
// so a burst either collapses here or it does not.
import {
  captureEngine,
  createDomTextureSource,
  paintStats,
  setCaptureEngine,
  type DomTextureSource,
} from '@munari/core'
import { snapdomCaptureEngine } from '@petepetrash/munari/snapdom'

const params = new URLSearchParams(location.search)
const requested = params.get('engine') === 'snapdom' ? 'snapdom' : 'html-in-canvas'
if (requested === 'snapdom') setCaptureEngine(snapdomCaptureEngine)

const BOX: readonly [number, number] = [240, 140]
const LEFT = [255, 0, 0] as const
const RIGHT = [0, 255, 0] as const

/** Two flat halves and one mutable line: the halves are the fidelity
 *  check, the line is the change signal. Flat color on purpose — a
 *  gradient would make every tolerance a judgment call. */
function cardMarkup(): string {
  return `<div style="box-sizing:border-box;width:${BOX[0]}px;height:${BOX[1]}px;
    background:linear-gradient(to right,rgb(255,0,0) 50%,rgb(0,255,0) 50%);
    font:14px/1.45 system-ui,sans-serif;color:#000">
    <div data-stamp>at rest</div>
  </div>`
}

/**
 * The two things the browser paints that a structural clone does not own:
 * a form field's `::after` and its `::placeholder`. Both are drawn here at
 * sizes a glyph-level difference cannot hide in.
 */
const FIELD_BOX: readonly [number, number] = [240, 80]
function fieldMarkup(): string {
  return `<div style="box-sizing:border-box;width:${FIELD_BOX[0]}px;height:${FIELD_BOX[1]}px;
    background:#101014;padding:12px;font:14px/1.4 monospace;color:#e8e8e8">
    <style>
      .gate-box{appearance:none;margin:0;width:22px;height:22px;border:2px solid #888;
        background:#e0452a;position:relative}
      .gate-box:checked::after{content:'';position:absolute;left:6px;top:1px;width:6px;height:12px;
        border:solid #101014;border-width:0 3px 3px 0;transform:rotate(43deg)}
      .gate-note{display:block;margin-top:12px;width:200px;background:transparent;border:0;
        border-bottom:1px solid #555;color:#e8e8e8;font:14px monospace}
      .gate-note::placeholder{color:#6ad6a0;letter-spacing:.34em;text-transform:uppercase;font-size:9px}
    </style>
    <input class="gate-box" type="checkbox" checked>
    <input class="gate-note" placeholder="add note">
  </div>`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor(cond: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const t0 = performance.now()
  while (!cond()) {
    if (performance.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await sleep(25)
  }
}

/** Settled means: no paint has landed for a full quiet window. Polling a
 *  fixed sleep instead would race the snapDOM engine's owed-capture tail. */
async function settle(source: DomTextureSource, quietMs = 400): Promise<void> {
  let last = -1
  let since = performance.now()
  const deadline = performance.now() + 10_000
  for (;;) {
    const now = source.paintCount()
    if (now !== last) {
      last = now
      since = performance.now()
    } else if (performance.now() - since >= quietMs) return
    if (performance.now() > deadline) throw new Error('source never went quiet')
    await sleep(50)
  }
}

/** Read one pixel out of the source's own canvas — the pixels a texture
 *  upload would take, not a re-render of the DOM. */
function samplePixel(
  source: DomTextureSource,
  fractionX: number,
  fractionY: number,
): [number, number, number, number] {
  const ctx = source.canvas.getContext('2d')
  if (!ctx) throw new Error('source canvas has no 2D context')
  const x = Math.round(source.canvas.width * fractionX)
  const y = Math.round(source.canvas.height * fractionY)
  const d = ctx.getImageData(x, y, 1, 1).data
  return [d[0]!, d[1]!, d[2]!, d[3]!]
}

const channelError = (got: readonly number[], want: readonly number[]) =>
  Math.max(...want.map((w, i) => Math.abs(got[i]! - w)))

interface EngineReport {
  engine: string
  native: boolean
  /** Worst per-channel error against the CSS colors, both halves. */
  fidelityError: number
  leftPixel: number[]
  rightPixel: number[]
  /** paintCount delta across a still window — the economy, per engine. */
  idleDelta: number
  idleWindowMs: number
  /** Paints answering one burst of 8 synchronous mutations. */
  burstMutations: number
  burstPaints: number
  /** The host paints nothing at birth, and setHostPainted round-trips. */
  hiddenAtBirth: boolean
  paintedWhenAsked: boolean
  hiddenWhenUnasked: boolean
  /** The parking law: fixed at the origin, its own box, no pointer events. */
  parking: { position: string; left: string; top: string; pointerEvents: string; box: number[] }
  /** After setSize, the receipt names the new box. */
  resizedBox: number[]
  resizedReceipt: number[] | null
  /** Backing store right after the resize (the band applies) and after the
   *  settle (exact). */
  movingStore: number[]
  settledStore: number[]
  errors: number
  lastError?: string
}

/** True when the host contributes no pixels, whichever property the
 *  engine chose to hide it with (canvas: visibility, container: opacity). */
function hostPaintsNothing(host: HTMLElement): boolean {
  const s = getComputedStyle(host)
  return s.visibility === 'hidden' || Number(s.opacity) === 0
}

async function run(): Promise<EngineReport> {
  const source = createDomTextureSource(cardMarkup(), BOX[0], BOX[1], { label: 'engine-card' })
  try {
    const host = source.host
    const hiddenAtBirth = hostPaintsNothing(host)
    const parked = getComputedStyle(host)
    const hostBox = host.getBoundingClientRect()
    const parking = {
      position: parked.position,
      left: parked.left,
      top: parked.top,
      pointerEvents: parked.pointerEvents,
      box: [hostBox.width, hostBox.height],
    }

    await waitFor(() => source.painted(), 15_000, 'first paint')
    await document.fonts.ready
    await settle(source)

    const leftPixel = samplePixel(source, 0.25, 0.75)
    const rightPixel = samplePixel(source, 0.75, 0.75)
    const fidelityError = Math.max(
      channelError(leftPixel, LEFT),
      channelError(rightPixel, RIGHT),
    )

    source.setHostPainted(true)
    const paintedWhenAsked = !hostPaintsNothing(host)
    source.setHostPainted(false)
    const hiddenWhenUnasked = hostPaintsNothing(host)

    const idleWindowMs = 2000
    const idleBefore = source.paintCount()
    await sleep(idleWindowMs)
    const idleDelta = source.paintCount() - idleBefore

    // One task, eight mutations. An engine that rasters per mutation shows
    // up here and nowhere else.
    const burstMutations = 8
    const burstBefore = source.paintCount()
    const stamp = source.element.querySelector('[data-stamp]')!
    for (let i = 0; i < burstMutations; i++) stamp.textContent = `burst ${i}`
    await waitFor(() => source.paintCount() > burstBefore, 10_000, 'a paint answering the burst')
    await settle(source)
    const burstPaints = source.paintCount() - burstBefore

    const resizedBox = [BOX[0] * 2, BOX[1]]
    source.setSize(resizedBox[0]!, resizedBox[1]!)
    await waitFor(
      () => source.paintedSize()[0] === resizedBox[0],
      10_000,
      'a paint at the resized box',
    )
    await settle(source)
    const receipt = source.currentPaint()
    const movingStore = [source.canvas.width, source.canvas.height]
    // Motion is approximate, rest is exact: the band survives a resize and
    // must not survive the settle.
    source.resettle()
    await settle(source)

    const stats = paintStats().find((s) => s.label === 'engine-card')
    return {
      engine: captureEngine().name,
      native: captureEngine().native,
      fidelityError,
      leftPixel,
      rightPixel,
      idleDelta,
      idleWindowMs,
      burstMutations,
      burstPaints,
      hiddenAtBirth,
      paintedWhenAsked,
      hiddenWhenUnasked,
      parking,
      resizedBox,
      resizedReceipt: receipt ? [...receipt.paintedSize] : null,
      movingStore,
      settledStore: [source.canvas.width, source.canvas.height],
      errors: stats?.errors ?? 0,
      lastError: stats?.lastError,
    }
  } finally {
    source.dispose()
  }
}

/**
 * Capture the field fixture and hand back its pixels.
 *
 * The cross-engine comparison this feeds is the parity law itself: whatever
 * one engine draws for a subtree, the other has to draw too. HTML-in-canvas
 * was measured byte-identical to a browser screenshot of the same element
 * (2026-09-11, Flight card at dpr 2, MAE 0.000), so agreeing with it is
 * agreeing with the DOM.
 */
async function fieldPixels(): Promise<{ url: string; size: number[]; carried: string; carriedSize: number[] }> {
  const source = createDomTextureSource(fieldMarkup(), FIELD_BOX[0], FIELD_BOX[1], {
    label: 'engine-fields',
  })
  try {
    await waitFor(() => source.painted(), 15_000, 'first paint of the field fixture')
    await document.fonts.ready
    await settle(source)
    const url = source.canvas.toDataURL('image/png')
    const size = [source.canvas.width, source.canvas.height]

    // The carried case, and it is the one that broke: unequal per-axis
    // density, then a resize the band absorbs, so the store is neither
    // square nor an exact multiple of the box. An engine that rasters at
    // its own size and lets the source stretch the answer is wrong here and
    // nowhere else.
    source.setRasterScale(2.4, 1.1)
    await settle(source)
    source.setSize(Math.round(FIELD_BOX[0] * 1.15), Math.round(FIELD_BOX[1] * 1.15))
    await settle(source)
    return {
      url,
      size,
      carried: source.canvas.toDataURL('image/png'),
      carriedSize: [source.canvas.width, source.canvas.height],
    }
  } finally {
    source.dispose()
  }
}

interface CaptureEngines {
  ready: boolean
  requested: string
  available: boolean
  run: () => Promise<EngineReport>
  fields: () => Promise<{ url: string; size: number[]; carried: string; carriedSize: number[] }>
}

declare global {
  interface Window {
    __captureEngines: CaptureEngines
  }
}

const available = captureEngine().available()
window.__captureEngines = { ready: true, requested, available, run, fields: fieldPixels }

const hud = document.getElementById('hud')!
hud.innerHTML = available
  ? `capture-engines: <b>${captureEngine().name}</b> — drive with <code>__captureEngines.run()</code>`
  : `capture-engines: <span class="bad">${captureEngine().name} unavailable here</span>`
