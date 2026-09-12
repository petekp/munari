// The rasterized source — a capture engine for browsers with no
// HTML-in-canvas: park the subtree in a plain container, ask a rasterizer
// for an image of it, and draw that into the source's canvas.
//
// The law both engines keep: a source requests no paint without a change
// signal, and every completed paint advances `paintCount()`. The idle-zero
// gate reads exactly that. What differs is the cost of a change and which
// changes signal — the compositor fires by itself for anything that enters
// a paint record, while this source has to be told, by an observer that
// sees mutations and by input events that change paint without mutating
// anything (`:focus`, `:hover`, a scroll, a running transition).
//
// What it is NOT told about, unless the consumer says the content is
// `live`, is a change the content made on its own. A capture here costs
// tens of milliseconds and a subtree that animates itself asks for one
// every frame, so its picture is left as it was. What is always followed:
// the user's input on the content and the mutations that answer it, a
// layout resize, a webfont or image landing, a transition or animation
// reaching its ends, and an explicit `repaint()`.
//
// The fault this shape answers, measured across the 2026-09 spikes: a
// whole-panel raster costs tens of milliseconds, so two can be running at
// once and they can land out of order. A source that published every answer
// showed the panel jumping backwards mid-drag. One capture running, a
// coalesced request behind it, and a receipt that names the box it actually
// holds is what makes a late answer merely late rather than wrong — the
// consumer compares `paintedSize()` to `size()` and knows.
//
// The second fault, and the reason the loop has a pace: coalescing bounds
// how many captures are OWED, not how often they run. Measured 2026-09-11 in
// a WebKit build with no HTML-in-canvas, on a four-window scene where two
// subtrees mutate on every animation frame — every saving went into another
// capture instead of into the frame rate, and the scene rendered in the gaps
// between whole-panel rasters: 51.4 fps through a hand drag, 40% of frames
// over 20 ms, p99 44 ms. `CAPTURE_GAP_MS` of quiet after each capture is
// 60.1 fps, 15% over 20 ms, p99 31 ms, at a third of the captures. The pace
// is what a `live` source pays; a source that is not live pays nothing for
// motion it does not follow.
//
// Zero dependencies, including on the rasterizer and the clock: both arrive
// as functions, so this file runs under vitest against a fake rasterizer and
// a hand-cranked clock, and the beta library that implements the rasterizer
// for real sits at the package edge, behind its own published entry.
//
// Ownership: this module owns change detection, coalescing, pacing, and the
// parked container. `domTextureSource.ts` owns the canvas and the ledger. The
// rasterizer owns pixels and nothing else.

import { createInputWindow } from './inputWindow'
import { HOVER_ATTR } from '../pointer/twins'
import {
  adoptContent,
  createCaptureCanvas,
  PARKED_HOST_ATTRIBUTE,
  type CaptureCanvas,
  type DomTextureSource,
  type DomTextureSourceOptions,
  type PaintReason,
} from './domTextureSource'

/**
 * The quiet a source leaves the main thread between captures.
 *
 * Why this number (decisions.md #60, amended 2026-09-11): a whole-panel
 * raster costs ~88 ms of wall clock in WebKit at dpr 2, so an ungoverned
 * source captures continuously and the scene gets whatever is left. Swept
 * against scene frame rate over three conditions — idle, a hand drag, and an
 * untouched animation — as interleaved blocks in one page load: no gap
 * 51-56 fps with 36-40% of frames over 20 ms; 100 ms 59-60 fps at 17-18%;
 * 150 ms 59-60 fps at 13-15%. Pacing by a SHARE of each capture's own wall
 * clock instead scored the same at matched throughput and meters the wrong
 * quantity — a capture that yields to the frame loop between its stages
 * looks expensive, and one that blocks it straight through looks cheap.
 *
 * Measured from a capture's END: a subtree quiet for longer than the gap
 * captures at once, and a request landing inside the gap waits out its
 * remainder. So what it holds back is continuous mutation — and, for as long
 * as the gap lasts, an input echo too.
 */
const CAPTURE_GAP_MS = 150

/**
 * The least time between the starts of two captures of a live source.
 *
 * The gap alone paces by cost: make a capture cheaper and a live source
 * simply captures more often, and the frames it costs come back. Measured
 * 2026-09-12 on a live window in Safari at 30 fps (decisions.md #62):
 * supplying fonts once took a capture from 137 to 14 ms of wall time, and
 * gap-only pacing turned that into 23 captures per 4 s instead of 13, with
 * the scene's p99 frame going from 34 to 48 ms. With this period it is 16
 * captures and a p99 of 35 — the same feel as before, with a third of the
 * main thread the captures used to take. Why this number: four pictures a
 * second of content that moves on its own, which is what the gap already
 * gave a slow engine. A source that is not live is paced by the user's
 * input, not by this.
 */
const LIVE_PERIOD_MS = 250

/**
 * The wall clock and the delay, injected.
 *
 * The module's other impurity arrives the same way (`ElementRasterizer`), and
 * for the same reason: a suite that drives pacing has to advance time rather
 * than wait for it, and a parameter keeps the pause a value the test sets
 * instead of a race it hopes to win. `wait` answers with its own cancel so
 * `dispose()` leaves no armed timer behind — the callback checks `disposed`
 * before it captures, so a stray firing does no harm, but until it fires it
 * holds this source's element and host alive.
 */
export interface CaptureClock {
  now: () => number
  wait: (run: () => void, ms: number) => () => void
}

const systemClock: CaptureClock = {
  now: () => performance.now(),
  wait: (run, ms) => {
    const id = setTimeout(run, ms)
    return () => {
      clearTimeout(id)
    }
  },
}

/**
 * Render a laid-out element at a given per-axis scale.
 *
 * `scaleX`/`scaleY` are backing-store pixels per CSS pixel, independently:
 * the LOD ladder spends texels per axis, so a panel seen edge-on is supplied
 * densely across and sparsely down, and `storeForBox` carries a store
 * forward while a box moves rather than reallocating every frame — so
 * neither axis is a whole number and the two are routinely unequal.
 *
 * The image lands at the store's origin at its NATURAL size, exactly as the
 * native engine's replay does (platform.md #8: a capture at scale k lands at
 * k x position and k x size). A rasterizer must therefore return the element
 * at `its own box x scale`, never the element stretched to fill a requested
 * output — the two agree only while the element exactly fills its host.
 *
 * The fault this signature exists for, measured 2026-09-11: a rasterizer
 * told only a single density answered at its own size and the source
 * stretched that into the store, resampling the whole capture by a
 * different non-integer factor on each axis. It reads as text that has
 * moved, changed weight and shifted colour against the same content on the
 * page — a card's body text 3px low and 28% heavier, its checkbox border
 * covering twice the pixels.
 *
 * Rejecting is a first-class answer: the source keeps its last texture and
 * receipt, and reports through `onError`.
 */
export type ElementRasterizer = (
  element: HTMLElement,
  scaleX: number,
  scaleY: number,
) => Promise<RasterImage>

/**
 * An image that reports its own pixel size.
 *
 * `CanvasImageSource` also admits `VideoFrame` (which measures in
 * `codedWidth`) and `SVGImageElement` (whose `width` is an animated length).
 * The source has to compare what it asked for against what arrived, so a
 * rasterizer answers with something it can simply measure.
 */
export type RasterImage = Exclude<CanvasImageSource, VideoFrame | SVGImageElement>

/** Events that change what an element paints without mutating its DOM. */
const PAINT_EVENTS = [
  'input',
  'change',
  'focusin',
  'focusout',
  'pointerdown',
  'pointerup',
  'scroll',
  'transitionrun',
  'transitionend',
  'animationstart',
  'animationend',
  'load',
] as const

/**
 * How long a hover change waits before it is captured.
 *
 * A pointer sweeping across content crosses each element twice, in and
 * out, and the browser (or the relay's twin) flips hover state on both
 * crossings. Captured at once, a sweep over a sign-in form cost eleven
 * rasters in three seconds and the wall art beside it seven, all showing
 * the same pixels (2026-09-12, Safari 18.6, decisions.md #62). So a hover
 * change is captured only once it has settled: if the hover chain is back
 * where the last raster saw it when the wait ends, there is nothing to
 * capture. Why this number: a hand crossing a 40 px field takes 40-80 ms,
 * so both crossings land inside one wait; a pointer that rests is captured
 * within 100 ms, under the 150 ms the pacing gap already puts between
 * captures, so a hover reveal is never slower than pacing made it.
 */
const HOVER_SETTLE_MS = 100

/**
 * Build a source that rasterizes its parked subtree through `rasterize`.
 *
 * The host is a plain container at the viewport origin, sized to the CSS
 * box, holding the live DOM. It is `opacity: 0` rather than
 * `visibility: hidden` because the subtree is the thing being parked: a
 * hidden container hides its children, and hidden children are neither
 * painted (which is wanted) nor hit-testable (which is not). Opacity keeps
 * layout, hit testing and the browser's own `:hover`/`:focus` painting
 * intact, and costs no capture because the rasterizer reads the element's
 * own computed styles rather than what the compositor put on screen.
 */
export function createRasterizedSource(
  rasterize: ElementRasterizer,
  engine: string,
  content: string | HTMLElement,
  width: number,
  height: number,
  options: DomTextureSourceOptions = {},
  clock: CaptureClock = systemClock,
): DomTextureSource {
  // Before anything is built, for the reason in `adoptContent`: a refused
  // source owns no DOM (decisions.md #12, #13).
  const element = adoptContent(content)

  let disposed = false
  // One capture running, one owed behind it. A third would be a queue, and a
  // queue of stale pictures is exactly what the receipt is here to make
  // unnecessary.
  let capturing = false
  let owed = false
  let scheduled = false
  // Change signals since the running capture started. A signal that lands
  // while a capture is WAITING out the gap is not one of these: the raster
  // reads the DOM after the wait, so that change is in the pixels. Reported
  // on the receipt so a consumer can see how stale the picture was on arrival.
  let changesDuringPaint = 0
  // The store the last completed raster was actually made for. `rest` asks
  // for a sharp capture; this is how it knows one is already there.
  let rasteredStore: readonly [number, number] = [0, 0]
  // Non-null exactly while a capture is owed and waiting out the gap.
  let cancelWait: (() => void) | null = null
  let lastFinishedAt = -Infinity
  let lastStartedAt = -Infinity
  let live = options.live === true
  const input = createInputWindow(() => clock.now())
  // The hover chain the last raster read, and the wait a hover change arms.
  let rasteredHover: readonly Element[] = []
  let cancelHoverWait: (() => void) | null = null

  const host = document.createElement('div')
  // The parking law, shared with the native engine and pinned by
  // `tests/conformance/mapping/parkingCoincidence`: viewport origin, exact
  // CSS size, in-document and on-screen, with the pointer-events cascade
  // re-rooted at the element rather than the container.
  host.style.cssText =
    `position:fixed;left:0;top:0;z-index:-1;pointer-events:none;opacity:0;` +
    `width:${width}px;height:${height}px;`
  host.setAttribute(PARKED_HOST_ATTRIBUTE, '')
  element.style.pointerEvents = 'auto'
  element.style.visibility = 'visible'
  host.appendChild(element)
  document.body.appendChild(host)

  const body: CaptureCanvas = createCaptureCanvas(element, width, height, {
    ...options,
    engine,
    requestPaint: onPaintRequested,
  })
  const canvas = body.canvas

  /**
   * Put a finished raster into the store.
   *
   * `askedFor` is the store this image was rastered for. It is usually the
   * store now, and then this is a 1:1 blit at the origin — the native
   * engine's replay law (platform.md #8), and the reason an element smaller
   * than its host lands small instead of being stretched across it.
   *
   * When the store moved WHILE the raster was being made, the image is
   * carried onto the new store by the ratio between them. A box that moves
   * every frame is the normal case during a lift, and a raster that always
   * arrives one frame late must still cover the store: drawn at its natural
   * size into a store that grew, it would leave the rest cleared, and the
   * texture would flicker between a full frame and a partial one.
   */
  const draw = (image: RasterImage, askedFor: readonly [number, number]) => {
    const ctx = canvas.getContext('2d')
    if (!ctx || !('drawImage' in ctx)) return
    const kx = canvas.width / Math.max(1, askedFor[0])
    const ky = canvas.height / Math.max(1, askedFor[1])
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, image.width * kx, image.height * ky)
  }

  /**
   * The one door to a capture, and the reason there is only one.
   *
   * A subtree that mutates every animation frame rings both doors — the
   * microtask a change signal schedules, and the re-entry a finished capture
   * makes for a change that landed under it — so pacing either one alone
   * moves nothing. An earlier attempt paced only the re-entry.
   */
  const start = () => {
    if (disposed || capturing || !owed) return
    if (cancelWait) return
    const periodOwed = live ? lastStartedAt + LIVE_PERIOD_MS - clock.now() : 0
    const quietOwed = Math.max(lastFinishedAt + CAPTURE_GAP_MS - clock.now(), periodOwed)
    if (quietOwed <= 0) {
      void run()
      return
    }
    // Assigned before the call and cleared by the callback, in that order,
    // because a `wait` that runs its callback INLINE would otherwise clear
    // the field first and then have the stale cancel written over the top —
    // leaving `cancelWait` non-null forever and every later request refused.
    let waiting = true
    const cancel = clock.wait(() => {
      waiting = false
      cancelWait = null
      if (!disposed && !capturing && owed) void run()
    }, quietOwed)
    if (waiting) cancelWait = cancel
  }

  const run = async () => {
    capturing = true
    owed = false
    changesDuringPaint = 0
    lastStartedAt = clock.now()
    // Read the box HERE. It is the box this raster holds, however far it has
    // moved by the time the answer lands, and the receipt has to say so —
    // a capture stretched over the box it no longer matches reads as doubled
    // content rather than as a soft mismatch.
    const box = body.size()
    rasteredHover = hoverChain()
    // The store's own ratio to the box, per axis. Reading it off the canvas
    // rather than from `rasterScale()` is the point: the density that was
    // ASKED for and the density the store actually carries are different
    // numbers whenever the band is holding a store forward, and the pixels
    // have to follow the store.
    const askedFor: readonly [number, number] = [canvas.width, canvas.height]
    const scaleX = askedFor[0] / Math.max(1, box[0])
    const scaleY = askedFor[1] / Math.max(1, box[1])
    try {
      const image = await rasterize(element, scaleX, scaleY)
      if (disposed) return
      draw(image, askedFor)
      rasteredStore = [canvas.width, canvas.height]
      body.completePaint(box, changesDuringPaint)
    } catch (cause) {
      if (!disposed) body.failPaint(cause)
    } finally {
      capturing = false
      lastFinishedAt = clock.now()
      // Anything that changed while the raster was being made is not in these
      // pixels, so a follow-up is owed — through `start()` rather than back
      // into `run()`, so it waits out the gap like any other request.
      if (!disposed && owed) start()
    }
  }

  /**
   * A ladder step does not rasterize; it re-reports the carried pixels.
   *
   * A raster costs tens of milliseconds of main thread here, and the LOD
   * ladder moves a Surface's supply every frame it moves — so rasterizing
   * on `lod` puts a whole-panel capture inside the render loop sixty times
   * a second, and the texture visibly freezes and jumps on a card being
   * dragged (platform.md #27).
   *
   * Skipping it loses nothing, because `recut` already carried the old
   * raster into the new store and both hold the SAME element box — the
   * difference is the density change and nothing else, which is exactly the
   * error `storeForBox`'s band exists to spend. What the receipt must still
   * say is that the pixels now live in a bigger or smaller store, or a
   * consumer that checks the store against the box it was painted for reads
   * a mismatch that is not there and stops drawing the Surface for as long
   * as the box keeps moving.
   *
   * The other three rasterize. `box` relaid the subtree out, so the carried
   * pixels are the wrong content stretched over the new box. `density` is a
   * caller naming the density it wants to arrive at, which is the whole
   * point of naming it. `rest` is the settle repaying the band, and it is
   * skipped only when the store it settles on is the one the last raster
   * was already made for — the settle re-arms on every ladder step, and
   * most of those land back on a store that is already sharp.
   *
   * Motion is approximate, rest is exact.
   */
  function onPaintRequested(reason: PaintReason) {
    if (disposed) return
    if (reason === 'box' || reason === 'density') {
      request()
      return
    }
    if (reason === 'rest') {
      if (rasteredStore[0] !== canvas.width || rasteredStore[1] !== canvas.height) request()
      return
    }
    const held = body.currentPaint()
    if (!held || !body.painted()) return
    if (held.storeSize[0] === canvas.width && held.storeSize[1] === canvas.height) return
    body.completePaint(held.paintedSize, 0)
  }

  // Deferred to a microtask, never started on the signal itself. One React
  // commit writes the host's size, mutates the subtree and fires events in a
  // single task; a capture kicked off by the first of those rasterizes a
  // half-applied frame, and the rest of the commit then has to be captured
  // again. A microtask runs after the task's synchronous writes and before
  // the browser lays out, so the raster reads the finished state. The
  // `scheduled` latch only keeps one microtask per burst rather than twenty;
  // the capture count is the same either way.
  function request() {
    if (disposed) return
    if (capturing) changesDuringPaint++
    owed = true
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      start()
    })
  }

  /** Every element under the pointer's hover chain, in document order. */
  const hoverChain = (): readonly Element[] => {
    const under = Array.from(element.querySelectorAll(`[${HOVER_ATTR}]`))
    return element.hasAttribute(HOVER_ATTR) ? [element, ...under] : under
  }
  const sameChain = (a: readonly Element[], b: readonly Element[]) =>
    a.length === b.length && a.every((el, i) => el === b[i])
  // Re-armed on every hover change, so only the state the pointer settles
  // on is captured; a crossing whose chain is back where the last raster
  // saw it captures nothing.
  const hoverChanged = () => {
    if (disposed) return
    cancelHoverWait?.()
    cancelHoverWait = clock.wait(() => {
      cancelHoverWait = null
      if (!sameChain(hoverChain(), rasteredHover)) request()
    }, HOVER_SETTLE_MS)
  }
  const isHoverSwap = (record: MutationRecord) =>
    record.type === 'attributes' && record.attributeName === HOVER_ATTR

  // A mutation is followed when the content is live, or when the user just
  // acted on it and this is the answer. Anything else is the content moving
  // on its own, which this engine leaves as it was. The hover twin moving
  // is the hover path's business, whichever route stamped it.
  const observer = new MutationObserver((records) => {
    if (records.every(isHoverSwap)) {
      hoverChanged()
      return
    }
    if (live || input.isOpen()) request()
  })
  observer.observe(element, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  })
  const listeners = new AbortController()
  for (const event of PAINT_EVENTS) {
    element.addEventListener(event, request, { capture: true, signal: listeners.signal })
  }
  for (const event of ['pointerover', 'pointerout'] as const) {
    element.addEventListener(event, hoverChanged, { capture: true, signal: listeners.signal })
  }
  const stopHearingElement = input.hear(element)
  // A webfont that lands after the first capture restyles every glyph under
  // it, and nothing in the subtree mutates to say so.
  document.fonts?.addEventListener('loadingdone', request, { signal: listeners.signal })

  request()

  return {
    sourceId: body.sourceId,
    canvas,
    host,
    element,
    setHostPainted: (painted) => {
      host.style.opacity = painted ? '1' : '0'
    },
    // The escape hatch for a change no observer can see — a CSSOM edit, a
    // canvas redraw, a video frame, a theme flip written to a stylesheet
    // rather than to an element. Coalesces with the running capture and
    // never queues more than one.
    repaint: request,
    setLive: (next) => {
      if (next === live) return
      live = next
      // The picture stopped following at some point; make it current from
      // the moment the flag is, rather than at the next change.
      if (live) request()
    },
    hearInput: input.hear,
    scale: body.scale,
    rasterScale: body.rasterScale,
    size: body.size,
    paintedSize: body.paintedSize,
    currentPaint: body.currentPaint,
    subscribePaint: body.subscribePaint,
    setScale: (k) => {
      body.setScale(k)
    },
    setRasterScale: (x, y) => {
      body.setRasterScale(x, y)
    },
    setSize: (w, h) => {
      if (!body.setSize(w, h)) return
      // After the ledger, not before: the ledger owns the rounding, and the
      // capture it just asked for is batched to a microtask, so this write
      // lands before anything reads the subtree's layout.
      const [nw, nh] = body.size()
      host.style.width = `${nw}px`
      host.style.height = `${nh}px`
    },
    resettle: body.resettle,
    painted: body.painted,
    paintCount: body.paintCount,
    dispose: () => {
      if (disposed) return
      disposed = true
      cancelWait?.()
      cancelWait = null
      cancelHoverWait?.()
      cancelHoverWait = null
      observer.disconnect()
      listeners.abort()
      stopHearingElement()
      host.remove()
      // Release the subtree unparented, exactly as it arrived — the same
      // adopt/dispose invertibility the native engine keeps (decisions.md #13).
      element.remove()
      body.dispose()
    },
  }
}
