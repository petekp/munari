// @vitest-environment happy-dom
//
// The laws every capture engine keeps, run over every engine.
//
// A capture engine turns a live DOM subtree into pixels and parks the
// subtree somewhere the browser lays it out. Those two things vary; nothing
// else does. This suite is where "nothing else" is written down, so adding
// a third engine means making this file pass rather than reading two
// existing engines and guessing which of their behaviors were deliberate.
//
// The engines are NOT supersets of each other and this suite does not
// pretend otherwise: what differs — which changes signal a paint, whether
// the host can be hit-tested through a transform — is pinned per engine
// below the shared block, each against its own measurement.
//
// happy-dom has no compositor and no rasterizer, so both engines are driven
// by hand: the trial surface is stubbed and `onpaint` is fired, and the
// rasterizer is a function that answers with a stub image. These are tests
// about the ledger, the parking and the coalescing — never about pixels.
// Pixels are the browser gates' subject (`instruments/README.md`).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  captureEngine,
  createDomTextureSource,
  createInputWindow,
  createRasterizedSource,
  htmlInCanvasEngine,
  PARKED_HOST_ATTRIBUTE,
  setCaptureEngine,
  type CaptureClock,
  type RasterImage,
  UnsupportedPlatformError,
  type CaptureEngine,
  type DomTextureSource,
} from '@munari/core'

// ── the two harnesses ────────────────────────────────────────────────────

interface StubCanvas extends HTMLCanvasElement {
  layoutSubtree: boolean
  onpaint: (() => void) | null
  requestPaint: () => void
}

/** One engine, plus the hand-cranking its driver needs. */
interface EngineHarness {
  readonly engine: CaptureEngine
  /** Paints the engine has been ASKED for since birth. */
  asked(): number
  /** Deliver every paint the engine is waiting on. */
  deliver(source: DomTextureSource): Promise<void>
  install(): void
  uninstall(): void
}

function nativeHarness(): EngineHarness {
  let asked = 0
  let restoreContext = () => {}
  return {
    engine: htmlInCanvasEngine,
    asked: () => asked,
    deliver: async (source) => {
      // SAFETY: `install` puts the trial members on the canvas prototype, so
      // every canvas this harness makes carries `onpaint`, and this engine's
      // host IS its canvas.
      const host = source.host as StubCanvas
      host.onpaint?.()
    },
    install() {
      asked = 0
      // happy-dom does not define `CanvasRenderingContext2D` as a global at
      // all — which is why the probe asks whether the name is declared before
      // it reads the value.
      class Ctx2D {
        drawElementImage() {}
        setTransform() {}
        clearRect() {}
      }
      vi.stubGlobal('CanvasRenderingContext2D', Ctx2D)
      // SAFETY: the three writes below are what MAKE the prototype a
      // StubCanvas. happy-dom ships none of the trial members, so this names
      // the shape the harness is about to install rather than one it found.
      const proto = HTMLCanvasElement.prototype as StubCanvas
      proto.layoutSubtree = false
      proto.onpaint = null
      proto.requestPaint = function () {
        asked++
      }
      const real = HTMLCanvasElement.prototype.getContext
      // SAFETY: the real `getContext` is overloaded across every context id
      // and answers each with a different class. This one answers '2d' with
      // the three members the paint path calls, and every other id with null.
      HTMLCanvasElement.prototype.getContext = ((id: string) =>
        id === '2d' ? new Ctx2D() : null) as typeof real
      restoreContext = () => {
        HTMLCanvasElement.prototype.getContext = real
      }
    },
    uninstall() {
      restoreContext()
      vi.unstubAllGlobals()
    },
  }
}

/**
 * A clock the test turns by hand.
 *
 * The rasterized source leaves a gap between captures, so "let the engine
 * finish" now means draining the microtask queue AND letting that gap pass.
 * Real timers would make every assertion below a race; this makes the pause
 * a value the test sets. `pending` is what the source asked to wait, which is
 * how the gap's length is pinned without the constant leaving the module.
 */
function handCranked() {
  let now = 0
  const waits: { at: number; ms: number; run: () => void }[] = []
  const clock: CaptureClock = {
    now: () => now,
    wait: (run, ms) => {
      const entry = { at: now + ms, ms, run }
      waits.push(entry)
      return () => {
        const at = waits.indexOf(entry)
        if (at >= 0) waits.splice(at, 1)
      }
    },
  }
  return {
    clock,
    /** What the source last asked to wait, in ms. */
    pending: () => waits.at(-1)?.ms,
    armed: () => waits.length,
    /** Pass `ms` of wall clock and run whatever came due. */
    pass(ms: number) {
      now += ms
      for (const entry of [...waits]) {
        if (entry.at > now) continue
        waits.splice(waits.indexOf(entry), 1)
        entry.run()
      }
    },
  }
}

// Longer than the gap the source leaves between captures, so passing it
// releases a waiting capture whatever the gap is set to.
const PAST_THE_GAP_MS = 1000

function rasterizedHarness(): EngineHarness {
  let asked = 0
  const time = handCranked()
  const engine: CaptureEngine = {
    name: 'fake-raster',
    native: false,
    available: () => 'document' in globalThis,
    createSource: (content, width, height, options) =>
      createRasterizedSource(
        () => {
          asked++
          return Promise.resolve(document.createElement('canvas'))
        },
        'fake-raster',
        content,
        width,
        height,
        options,
        time.clock,
      ),
    refusal: 'fake-raster needs a document',
  }
  return {
    engine,
    asked: () => asked,
    // The source batches requests to a microtask, answers from a resolved
    // promise, and leaves a gap before the next capture. So "let the engine
    // finish" is: drain, pass the gap, drain again — twice over, because a
    // capture released by the gap can itself owe a follow-up.
    deliver: async () => {
      for (let round = 0; round < 2; round++) {
        for (let i = 0; i < 4; i++) await Promise.resolve()
        time.pass(PAST_THE_GAP_MS)
        for (let i = 0; i < 4; i++) await Promise.resolve()
      }
    },
    install() {
      asked = 0
    },
    uninstall() {},
  }
}

const HARNESSES: readonly [string, () => EngineHarness][] = [
  ['html-in-canvas', nativeHarness],
  ['rasterized', rasterizedHarness],
]

// ── the shared laws ──────────────────────────────────────────────────────

describe.each(HARNESSES)('every capture engine — %s', (_name, make) => {
  let harness: EngineHarness

  beforeEach(() => {
    harness = make()
    harness.install()
    setCaptureEngine(harness.engine)
  })
  afterEach(() => {
    setCaptureEngine(null)
    harness.uninstall()
    document.body.replaceChildren()
  })

  const born = async (markup = '<div>hi</div>', w = 200, h = 100) => {
    const source = createDomTextureSource(markup, w, h)
    await harness.deliver(source)
    return source
  }

  it('is the engine the next source is built from', () => {
    expect(captureEngine()).toBe(harness.engine)
    expect(captureEngine().name).toBe(harness.engine.name)
  })

  // Law 1 (decisions.md #12). The gate is ordered ahead of construction, so
  // a browser that cannot run this engine is left with no orphaned DOM to
  // clean up and a sentence it can act on.
  it('refuses before building anything, and owns no DOM when it does', () => {
    const children = document.body.childElementCount
    setCaptureEngine({ ...harness.engine, available: () => false })
    expect(() => createDomTextureSource('<div></div>', 10, 10)).toThrow(UnsupportedPlatformError)
    expect(document.body.childElementCount).toBe(children)
  })

  // Law 2 (decisions.md #13). Adoption is one-way and only an unparented
  // node may cross: `appendChild` MOVES, so a node still in the consumer's
  // page would be torn out of it mid-frame with no error anywhere.
  it('adopts only an unparented node, and leaves a refused one where it was', () => {
    const parent = document.createElement('section')
    const child = document.createElement('div')
    parent.append(child)
    document.body.append(parent)
    const children = document.body.childElementCount

    expect(() => createDomTextureSource(child, 10, 10)).toThrow(/unparented/)
    expect(child.parentElement).toBe(parent)
    expect(document.body.childElementCount).toBe(children)
  })

  it('releases the adopted node on dispose, so adopt and dispose are invertible', async () => {
    const node = document.createElement('div')
    const source = createDomTextureSource(node, 40, 20)
    await harness.deliver(source)
    expect(source.element).toBe(node)
    expect(node.parentElement).toBe(source.host)

    source.dispose()
    expect(node.parentElement).toBeNull()
    expect(source.host.isConnected).toBe(false)

    // The same node re-adopted: a StrictMode remount does exactly this, and
    // a source that kept its parent pointer would be refused for a parent it
    // installed itself.
    const again = createDomTextureSource(node, 40, 20)
    await harness.deliver(again)
    expect(again.element).toBe(node)
    again.dispose()
  })

  // Law 7, the relay's half. Shared by every engine and pinned in the
  // arithmetic by `mapping/parkingCoincidence`: the relay walks the parked
  // subtree's untransformed layout box, so the host has to stand at the
  // viewport origin at exactly the CSS size, in-document and on-screen.
  it('parks at the viewport origin, at the exact CSS size, in the document', async () => {
    const source = await born('<div></div>', 320, 180)
    const style = source.host.style

    expect(source.host.isConnected).toBe(true)
    expect(style.position).toBe('fixed')
    expect(style.left).toBe('0px')
    expect(style.top).toBe('0px')
    expect(style.width).toBe('320px')
    expect(style.height).toBe('180px')
    // The host never takes a real hit; the drawn root re-roots the cascade.
    // Left alone, the inherited `none` makes every element read as clear
    // glass and nothing in any Surface is ever hittable.
    expect(style.pointerEvents).toBe('none')
    expect(source.element.style.pointerEvents).toBe('auto')
    expect(source.element.style.visibility).toBe('visible')
    // A page-wide `useElementCapture` excludes parked hosts by this marker.
    // Without it the capture copies a Surface's own live content back into
    // itself — the panel appearing a second time at the corner of the page.
    expect(source.host.hasAttribute(PARKED_HOST_ATTRIBUTE)).toBe(true)

    source.setSize(400, 200)
    expect(style.width).toBe('400px')
    expect(style.height).toBe('200px')
    source.dispose()
  })

  // A source that paints onto the page the instant it is made is a fault
  // with no error attached: the pixels look like a duplicate of the content,
  // at the top-left corner, in a page that never asked for them.
  it('is born with its host unpainted, and shows it only when asked', async () => {
    const source = await born()
    const hidden = source.host.getAttribute('style') ?? ''

    source.setHostPainted(true)
    expect(source.host.getAttribute('style')).not.toBe(hidden)
    source.setHostPainted(false)
    expect(source.host.getAttribute('style')).toBe(hidden)
    source.dispose()
  })

  // Law 3. The idle-zero gate reads exactly this: a still counter means a
  // quiescent subtree, and a source that asked for paints nobody needed
  // would keep a demand renderer awake forever.
  it('asks for no paint without a change signal, and counts every completed one', async () => {
    const source = await born()
    expect(source.paintCount()).toBe(1)
    expect(source.painted()).toBe(true)

    const quiet = harness.asked()
    await harness.deliver(source)
    await harness.deliver(source)
    expect(harness.asked()).toBe(quiet)
    source.dispose()
  })

  // Law 4. `repaint()` is the escape hatch for a change no observer can
  // see — a CSSOM edit, a canvas redraw, a theme written to a stylesheet
  // rather than to an element.
  it('forces exactly one more paint on repaint(), however many times it is called', async () => {
    const source = await born()
    const before = source.paintCount()

    source.repaint()
    source.repaint()
    source.repaint()
    await harness.deliver(source)

    expect(source.paintCount()).toBe(before + 1)
    source.dispose()
  })

  // Law 5. `size()` reports the box a consumer just asked for; the receipt
  // reports the box the delivered raster actually holds. Blending a copy
  // from one layout generation over a page from a newer one reads as doubled
  // content, not as a soft mismatch (observed 2026-08-08).
  it('publishes a frozen receipt naming the box its raster holds', async () => {
    const source = await born('<div></div>', 200, 100)
    const first = source.currentPaint()

    expect(first?.frame).toEqual({ sourceId: source.sourceId, generation: 1 })
    expect(first?.paintedSize).toEqual([200, 100])
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first?.frame)).toBe(true)
    expect(source.paintedSize()).toEqual([200, 100])

    source.setSize(288, 122)
    // Before the next paint lands, the receipt still names the OLD box — the
    // gap between the two IS the capture pipeline's lag.
    expect(source.paintedSize()).toEqual([200, 100])
    expect(source.size()).toEqual([288, 122])

    await harness.deliver(source)
    expect(source.currentPaint()?.frame.generation).toBe(2)
    expect(source.paintedSize()).toEqual([288, 122])
    source.dispose()
  })

  it('notifies every subscriber with the receipt it just published, once', async () => {
    const source = await born()
    const seen: unknown[] = []
    const stop = source.subscribePaint((receipt) => {
      expect(source.currentPaint()).toBe(receipt)
      seen.push(receipt)
    })

    source.repaint()
    await harness.deliver(source)
    expect(seen).toHaveLength(1)

    stop()
    stop()
    source.repaint()
    await harness.deliver(source)
    expect(seen).toHaveLength(1)
    source.dispose()
  })

  // Law 6. The band exists so a moving Surface keeps its pixels across every
  // resize; rest is where the store is cut exact. Motion is approximate,
  // rest is exact (`storeForBox`, decisions.md #44).
  it('holds the store through a resize the band absorbs, and cuts it exact on resettle', async () => {
    const source = await born('<div></div>', 200, 100)
    expect([source.canvas.width, source.canvas.height]).toEqual([200, 100])

    source.setSize(220, 110)
    await harness.deliver(source)
    // Inside ±40%: the same store rasters the new layout at a slightly
    // different density rather than being cleared for one frame.
    expect([source.canvas.width, source.canvas.height]).toEqual([200, 100])

    source.resettle()
    await harness.deliver(source)
    expect([source.canvas.width, source.canvas.height]).toEqual([220, 110])

    // A density request is always exact — the band guards a moving box, not
    // a caller who just named the number of texels they want.
    source.setScale(2)
    await harness.deliver(source)
    expect([source.canvas.width, source.canvas.height]).toEqual([440, 220])
    expect(source.scale()).toBe(2)
    source.dispose()
  })

  it('rasters each axis independently without moving the retained CSS box', async () => {
    const source = await born('<div></div>', 200, 100)
    source.setRasterScale(2, 0.5)
    await harness.deliver(source)

    expect([source.canvas.width, source.canvas.height]).toEqual([400, 50])
    expect(source.rasterScale()).toEqual([2, 0.5])
    expect(source.scale()).toBe(2)
    expect(source.size()).toEqual([200, 100])
    expect(source.host.style.width).toBe('200px')
    source.dispose()
  })

  it('is a no-op at the same size, so a caller can set it every render', async () => {
    const source = await born('<div></div>', 200, 100)
    const quiet = harness.asked()

    source.setSize(200, 100)
    source.setScale(1)
    expect(harness.asked()).toBe(quiet)
    source.dispose()
  })
})

// ── what only the rasterized engine can express ──────────────────────────

describe('the rasterized engine', () => {
  let time = handCranked()
  beforeEach(() => {
    time = handCranked()
  })

  /** Microtasks only: the source is left waiting out its gap. */
  const drain = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  }

  /** Microtasks, then the gap, then microtasks — a capture actually starts. */
  const settle = async () => {
    await drain()
    time.pass(PAST_THE_GAP_MS)
    await drain()
  }

  /** A rasterizer whose answers the test hands over one at a time. */
  function deferred() {
    const calls: { resolve: () => void; reject: (why: Error) => void }[] = []
    const rasterize = () =>
      new Promise<RasterImage>((resolve, reject) => {
        calls.push({
          resolve: () => resolve(document.createElement('canvas')),
          reject,
        })
      })
    return { calls, rasterize }
  }

  afterEach(() => document.body.replaceChildren())

  // One capture running, one owed behind it. A queue of stale pictures is
  // what the coalescing is here to prevent: at tens of milliseconds a raster,
  // a drag that queued one capture per move would still be drawing the start
  // of the gesture when the hand stopped.
  //
  // Coalescing alone bounds how many captures are OWED, never how often they
  // run, which is why the gap below is a separate law and not this one.
  it('keeps one capture running and coalesces every request behind it', async () => {
    const { calls, rasterize } = deferred()
    const source = createRasterizedSource(rasterize, 'test', '<div></div>', 100, 50, {}, time.clock)
    await drain()
    expect(calls).toHaveLength(1)

    source.repaint()
    source.repaint()
    source.repaint()
    await drain()
    expect(calls).toHaveLength(1)

    calls[0]!.resolve()
    await settle()
    // Exactly one follow-up for the three requests that arrived during it.
    expect(calls).toHaveLength(2)
    expect(source.paintCount()).toBe(1)

    calls[1]!.resolve()
    await settle()
    expect(calls).toHaveLength(2)
    expect(source.paintCount()).toBe(2)
    source.dispose()
  })

  // The pacing law. A subtree that mutates on every animation frame asks for
  // a capture on every animation frame, through BOTH doors — the microtask a
  // change signal schedules and the re-entry a finished capture makes. An
  // ungoverned source therefore rasterizes continuously and the scene renders
  // in whatever main thread is left: measured 2026-09-11 in WebKit on a
  // four-window scene, 51.4 fps through a hand drag with 40% of frames over
  // 20 ms, against 60.1 fps and 15% with the gap in place (decisions.md #60).
  //
  // The gap is 150 ms and it is measured from the END of a capture, so a
  // subtree that has been quiet captures at once and only a subtree mutating
  // faster than it can be rastered is held back.
  it('leaves a 150ms gap between captures, whichever door asked', async () => {
    const { calls, rasterize } = deferred()
    const source = createRasterizedSource(rasterize, 'test', '<div></div>', 100, 50, {}, time.clock)

    // Birth. Nothing has been captured, so nothing is owed any quiet.
    await drain()
    expect(calls).toHaveLength(1)
    expect(time.armed()).toBe(0)

    // The re-entry door: the follow-up a finished capture owes for a change
    // that landed under it. The raster takes 80 ms of clock here, and the
    // gap that follows is still the full 150 — measured from the capture's
    // END, not its start, which is what keeps the main thread quiet for the
    // whole gap rather than for whatever is left of it.
    source.repaint()
    time.pass(80)
    calls[0]!.resolve()
    await drain()
    expect(calls).toHaveLength(1)
    expect(time.pending()).toBe(150)

    time.pass(150)
    await drain()
    expect(calls).toHaveLength(2)
    calls[1]!.resolve()
    await drain()

    // The signal door: the microtask a change signal schedules, with no
    // capture running to re-enter from.
    source.repaint()
    await drain()
    expect(calls).toHaveLength(2)
    expect(time.pending()).toBe(150)

    // Most of the gap is not enough, and a request inside the gap does not
    // re-arm it — a second wait would restart the countdown from wherever
    // the request landed, so a subtree mutating every frame would never
    // capture again at all.
    time.pass(149)
    source.repaint()
    await drain()
    expect(calls).toHaveLength(2)
    expect(time.armed()).toBe(1)

    time.pass(1)
    await drain()
    expect(calls).toHaveLength(3)
    source.dispose()
  })

  // The gap holds a subtree that mutates faster than it can be rastered. It
  // does not hold a subtree that has been quiet: the first request after any
  // pause longer than the gap starts its capture in the same microtask, with
  // no timer armed at all.
  it('captures at once when the subtree has been quiet longer than the gap', async () => {
    const { calls, rasterize } = deferred()
    const source = createRasterizedSource(rasterize, 'test', '<div></div>', 100, 50, {}, time.clock)
    await drain()
    calls[0]!.resolve()
    await drain()

    time.pass(5000)
    source.repaint()
    await drain()
    expect(calls).toHaveLength(2)
    expect(time.armed()).toBe(0)
    source.dispose()
  })

  // The gap paces by cost. It is measured from a capture's END, so a cheaper
  // capture is a more frequent one, and the frames a cheaper capture gives
  // back are spent on more captures. Supplying fonts once took a snapDOM
  // capture from 137 to 14 ms of wall time in Safari at 30 fps, and gap-only
  // pacing turned that into 23 captures per 4 s of a live window instead of
  // 13, with the scene's p99 frame going from 34 to 48 ms; held to this
  // period it was 16 captures and 35 ms (measured 2026-09-12, decisions.md
  // #62). So a live source is paced by a period too, measured from a
  // capture's START, and the longer of the two holds. Content that is not
  // live is paced by the user's input and owes only the gap: a field the
  // user is typing in follows the keystroke.
  it('starts a live capture at most every 250ms, however cheap the raster', async () => {
    const { calls, rasterize } = deferred()
    const source = createRasterizedSource(rasterize, 'test', '<div></div>', 100, 50, {}, time.clock)
    await drain()
    calls[0]!.resolve()
    await drain()
    time.pass(PAST_THE_GAP_MS)

    source.setLive(true)
    await drain()
    expect(calls).toHaveLength(2)

    // An instant raster owes a gap of 150 and a period of 250; the period holds.
    calls[1]!.resolve()
    await drain()
    source.element.setAttribute('data-tick', '1')
    await drain()
    expect(calls).toHaveLength(2)
    expect(time.pending()).toBe(250)
    time.pass(250)
    await drain()
    expect(calls).toHaveLength(3)

    // A raster slower than the period owes only its gap: the period is a
    // floor under the pace, not an addition to it.
    time.pass(300)
    calls[2]!.resolve()
    await drain()
    source.element.setAttribute('data-tick', '2')
    await drain()
    expect(calls).toHaveLength(3)
    expect(time.pending()).toBe(150)
    time.pass(150)
    await drain()
    expect(calls).toHaveLength(4)
    calls[3]!.resolve()
    await drain()

    // Not live, the user's input owes the gap alone.
    source.setLive(false)
    source.element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
    await drain()
    expect(calls).toHaveLength(4)
    expect(time.pending()).toBe(150)
    time.pass(150)
    await drain()
    expect(calls).toHaveLength(5)
    source.dispose()
  })

  // A capture that took long enough for the subtree to move is not wrong,
  // it is late — and the receipt is how a consumer tells the difference.
  it('reports how many change signals landed while the raster was being made', async () => {
    const { calls, rasterize } = deferred()
    const source = createRasterizedSource(rasterize, 'test', '<div></div>', 100, 50, {}, time.clock)
    await drain()

    source.repaint()
    source.repaint()
    calls[0]!.resolve()
    await drain()

    expect(source.currentPaint()?.changesDuringPaint).toBe(2)
    // The follow-up ran with nothing changing under it.
    await settle()
    calls[1]!.resolve()
    await drain()
    expect(source.currentPaint()?.changesDuringPaint).toBe(0)
    source.dispose()
  })

  // The box the raster holds is the box that was live when the rasterizer
  // STARTED, not when it answered. A receipt naming the current box would
  // claim pixels that do not exist.
  it('names the box the raster started at, not the one it landed in', async () => {
    const { calls, rasterize } = deferred()
    const source = createRasterizedSource(rasterize, 'test', '<div></div>', 100, 50, {}, time.clock)
    await drain()

    source.setSize(300, 150)
    calls[0]!.resolve()
    await drain()

    expect(source.currentPaint()?.paintedSize).toEqual([100, 50])
    expect(source.size()).toEqual([300, 150])
    source.dispose()
  })

  // Law 9. The last good picture stays on screen, and the same message does
  // not fill the console once per frame for as long as the Surface is
  // mounted — one unreachable cross-origin image fails every capture.
  it('keeps the last receipt on a failure and reports each distinct message once', async () => {
    const { calls, rasterize } = deferred()
    const errors: string[] = []
    const source = createRasterizedSource(
      rasterize,
      'test',
      '<div></div>',
      100,
      50,
      { onError: (error) => errors.push(error.message) },
      time.clock,
    )
    await drain()
    calls[0]!.resolve()
    await drain()
    const good = source.currentPaint()

    for (let i = 0; i < 3; i++) {
      source.repaint()
      await settle()
      calls.at(-1)!.reject(new Error('CORS'))
      await drain()
    }

    expect(errors).toEqual(['CORS'])
    expect(source.currentPaint()).toBe(good)
    expect(source.paintCount()).toBe(1)

    // A success ends the run the message was suppressed over.
    source.repaint()
    await settle()
    calls.at(-1)!.resolve()
    await drain()
    source.repaint()
    await settle()
    calls.at(-1)!.reject(new Error('CORS'))
    await drain()
    expect(errors).toEqual(['CORS', 'CORS'])
    source.dispose()
  })

  // The freshness law, and the default. A subtree that animates itself
  // asks for a capture every frame, and at tens of milliseconds a capture
  // that is the scene's whole frame budget (decisions.md #60). So a source
  // that was not told its content is live leaves the picture as it was:
  // a mutation nobody asked for is not a change signal here.
  it('leaves a mutation the content made on its own uncaptured, unless live', async () => {
    const { calls, rasterize } = deferred()
    const source = createRasterizedSource(rasterize, 'test', '<div></div>', 100, 50, {}, time.clock)
    await drain()
    calls[0]!.resolve()
    await drain()

    source.element.append(document.createElement('span'))
    source.element.setAttribute('data-tick', '1')
    await settle()
    expect(calls).toHaveLength(1)

    // Told the content is live, the source first captures the state it
    // stopped following at — the picture is current from the moment the
    // flag is — and then follows every change at its pace.
    source.setLive(true)
    await settle()
    expect(calls).toHaveLength(2)
    calls[1]!.resolve()
    await drain()

    source.element.setAttribute('data-tick', '2')
    await settle()
    expect(calls).toHaveLength(3)
    calls[2]!.resolve()
    await drain()

    // And back: the last picture stays, and the next tick is not followed.
    source.setLive(false)
    source.element.setAttribute('data-tick', '3')
    await settle()
    expect(calls).toHaveLength(3)
    source.dispose()
  })

  // The user's input is always followed, and so is the content's answer to
  // it. A mutation cannot be told apart from an animation's by looking at
  // it; it is told apart by landing inside `INPUT_WINDOW_MS` of an input
  // event on the subtree. `keydown` opens the window and asks for nothing
  // by itself — a key that changes nothing costs nothing.
  it('captures a mutation that answers the user\'s input, for 150ms after it', async () => {
    const { calls, rasterize } = deferred()
    const source = createRasterizedSource(rasterize, 'test', '<div><input></div>', 100, 50, {}, time.clock)
    await drain()
    calls[0]!.resolve()
    await drain()
    const field = source.element.querySelector('input')!
    // Quiet for longer than the gap, so what follows captures at once and
    // the only question left is whether a mutation is followed at all.
    time.pass(PAST_THE_GAP_MS)

    field.dispatchEvent(new Event('keydown', { bubbles: true }))
    await drain()
    expect(calls).toHaveLength(1)
    expect(time.armed()).toBe(0)

    time.pass(149)
    source.element.append(document.createElement('span'))
    await drain()
    expect(calls).toHaveLength(2)
    calls[1]!.resolve()
    await drain()

    // The window is measured from the input, not from the capture it led
    // to, so a mutation landing after it is the content's own again.
    time.pass(PAST_THE_GAP_MS)
    source.element.append(document.createElement('span'))
    await settle()
    expect(calls).toHaveLength(2)

    // Hovering is not acting. The relay forwards a move on every frame the
    // pointer rests on a Surface, so a bare move must open nothing, or a
    // self-animating subtree would be followed for as long as it is under
    // the pointer.
    field.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
    source.element.append(document.createElement('span'))
    await settle()
    expect(calls).toHaveLength(2)

    // An input event that changes paint by itself — a field's value, a
    // scroll offset — asks for a capture on its own, as it always did.
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    expect(calls).toHaveLength(3)
    calls[2]!.resolve()
    await drain()

    // A native drag has no pointer stream: the reorder a drop makes lands
    // with `drop` as the only input near it, so `drop` opens the window.
    time.pass(PAST_THE_GAP_MS)
    field.dispatchEvent(new Event('drop', { bubbles: true }))
    source.element.append(document.createElement('span'))
    await drain()
    expect(calls).toHaveLength(4)
    source.dispose()
  })

  // A gesture begun on the content is the user acting on it until it ends,
  // wherever its moves land. A slider or a resize handle listens for moves on
  // `window`, so nothing between the press and the release touches the
  // subtree — and a window that closed 150 ms into the drag would freeze the
  // thumb under the hand.
  it('keeps following a drag that began on the content until the pointer is released', async () => {
    const { calls, rasterize } = deferred()
    const source = createRasterizedSource(rasterize, 'test', '<div></div>', 100, 50, {}, time.clock)
    await drain()
    calls[0]!.resolve()
    await drain()
    time.pass(PAST_THE_GAP_MS)

    source.element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7 }))
    await drain()
    calls[1]!.resolve()
    await drain()

    // Well past the window the press opened; the moves land on the document.
    time.pass(PAST_THE_GAP_MS)
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7 }))
    source.element.setAttribute('data-value', '40')
    await settle()
    expect(calls).toHaveLength(3)
    calls[2]!.resolve()
    await drain()

    // Another pointer lifting is not this gesture ending.
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 8 }))
    time.pass(PAST_THE_GAP_MS)
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7 }))
    source.element.setAttribute('data-value', '41')
    await settle()
    expect(calls).toHaveLength(4)
    calls[3]!.resolve()
    await drain()

    // Released: the last window closes and the content is its own again.
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }))
    time.pass(PAST_THE_GAP_MS)
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7 }))
    source.element.setAttribute('data-value', '42')
    await settle()
    expect(calls).toHaveLength(4)
    source.dispose()
  })

  // The retained Surface mirrors its page content into the source by hand
  // while the page holds, so the user acts on a node the source's element
  // never hears. `hearInput` names that node; the mirror's answer is then
  // followed exactly as a change on the element would be.
  it('hears input on a node it was told about, until told to stop', async () => {
    const { calls, rasterize } = deferred()
    const source = createRasterizedSource(rasterize, 'test', '<div></div>', 100, 50, {}, time.clock)
    await drain()
    calls[0]!.resolve()
    await drain()
    time.pass(PAST_THE_GAP_MS)
    const page = document.createElement('section')
    document.body.append(page)
    const stop = source.hearInput(page)

    page.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    source.element.append(document.createElement('span'))
    await drain()
    expect(calls).toHaveLength(2)
    calls[1]!.resolve()
    await drain()

    stop()
    time.pass(PAST_THE_GAP_MS)
    page.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    source.element.append(document.createElement('span'))
    await settle()
    expect(calls).toHaveLength(2)

    // Told to stop mid-drag: the gesture's document listeners go with the
    // hearing, or a Surface unmounted under the hand would keep following
    // the pointer for the rest of the page's life.
    const hear = source.hearInput(page)
    page.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 3 }))
    source.element.append(document.createElement('span'))
    await drain()
    expect(calls).toHaveLength(3)
    calls[2]!.resolve()
    await drain()
    hear()
    time.pass(PAST_THE_GAP_MS)
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 3 }))
    source.element.append(document.createElement('span'))
    await settle()
    expect(calls).toHaveLength(3)
    source.dispose()
  })

  // A pointer sweeping across content crosses every element twice, and the
  // relay flips the hover twin on each crossing. Captured at once, a sweep
  // over a sign-in form cost eleven rasters showing the same pixels
  // (2026-09-12, decisions.md #62). A hover change is captured only once it
  // has settled, and a crossing that leaves the chain where the last raster
  // saw it captures nothing.
  it('captures a hover only once it settles, and a crossing not at all', async () => {
    const { calls, rasterize } = deferred()
    const source = createRasterizedSource(rasterize, 'test', '<div><button></button></div>', 100, 50, {}, time.clock)
    await drain()
    calls[0]!.resolve()
    await drain()
    time.pass(PAST_THE_GAP_MS)
    const button = source.element.querySelector('button')!

    // In and out within the settle: the chain is back where it was.
    button.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    button.setAttribute('data-hover', '')
    time.pass(60)
    button.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }))
    button.removeAttribute('data-hover')
    await settle()
    expect(calls).toHaveLength(1)

    // Resting on it: one capture, within the settle time.
    button.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    button.setAttribute('data-hover', '')
    await drain()
    time.pass(99)
    await drain()
    expect(calls).toHaveLength(1)
    time.pass(1)
    await drain()
    expect(calls).toHaveLength(2)
    calls[1]!.resolve()
    await drain()

    // A press while a hover change is still settling captures at once.
    time.pass(PAST_THE_GAP_MS)
    button.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }))
    button.removeAttribute('data-hover')
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await drain()
    expect(calls).toHaveLength(3)
    source.dispose()
  })

  // What a source that is not live still follows: the box, the density,
  // the settle, a transition or animation reaching its ends, an image or a
  // webfont landing, and an explicit `repaint()`. Each of these leaves the
  // held picture WRONG rather than merely old — a resize relays the subtree
  // out under it, an image that arrived is a blank where the page has a
  // picture — which is the line between freshness and correctness.
  it('still captures the correctness reasons when it is not live', async () => {
    const { calls, rasterize } = deferred()
    const source = createRasterizedSource(rasterize, 'test', '<div><img></div>', 100, 50, {}, time.clock)
    await drain()
    calls[0]!.resolve()
    await drain()
    const image = source.element.querySelector('img')!

    // `load` does not bubble; the source listens in the capture phase.
    image.dispatchEvent(new Event('load'))
    await settle()
    expect(calls).toHaveLength(2)
    calls[1]!.resolve()
    await drain()

    source.element.dispatchEvent(new Event('transitionend', { bubbles: true }))
    await settle()
    expect(calls).toHaveLength(3)
    calls[2]!.resolve()
    await drain()

    source.setSize(120, 60)
    await settle()
    expect(calls).toHaveLength(4)
    calls[3]!.resolve()
    await drain()

    source.repaint()
    await settle()
    expect(calls).toHaveLength(5)
    source.dispose()
  })

  it('observes its own subtree, and stops when disposed', async () => {
    const { calls, rasterize } = deferred()
    const source = createRasterizedSource(
      rasterize,
      'test',
      '<div></div>',
      100,
      50,
      { live: true },
      time.clock,
    )
    await drain()
    calls[0]!.resolve()
    await drain()

    source.element.append(document.createElement('span'))
    await settle()
    expect(calls).toHaveLength(2)
    calls[1]!.resolve()
    await drain()

    // Dispose with a capture already waiting out the gap. Both halves have
    // to hold: the armed wait is released, so nothing hands the rasterizer a
    // detached element after teardown, and the observer is disconnected, so
    // a later mutation asks for nothing.
    source.element.append(document.createElement('i'))
    await drain()
    expect(time.armed()).toBe(1)
    source.dispose()
    expect(time.armed()).toBe(0)

    source.element.append(document.createElement('b'))
    await settle()
    expect(calls).toHaveLength(2)
  })
})

// ── the input window ─────────────────────────────────────────────────────
//
// The law the rasterized engine and element capture both judge by, pinned
// where the engine's laws cannot reach it: what a hearing disowns, and the
// two gesture ends the pointer stream never reports.
describe('the input window', () => {
  it('disowns input a consumer says is another Surface\'s', () => {
    let now = 0
    const window = createInputWindow(() => now)
    const page = document.createElement('div')
    const parked = document.createElement('div')
    parked.setAttribute(PARKED_HOST_ATTRIBUTE, '')
    page.append(parked)
    document.body.append(page)
    const stop = window.hear(page, {
      ignore: (target) => target instanceof Element && target.closest(`[${PARKED_HOST_ATTRIBUTE}]`) !== null,
    })

    parked.dispatchEvent(new Event('focusin', { bubbles: true }))
    expect(window.isOpen()).toBe(false)
    // A press on a disowned node begins no gesture, so its moves count for nothing.
    parked.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1 }))
    expect(window.isOpen()).toBe(false)

    page.dispatchEvent(new Event('focusin', { bubbles: true }))
    expect(window.isOpen()).toBe(true)
    now += 151
    expect(window.isOpen()).toBe(false)
    stop()
    page.remove()
  })

  it('ends a gesture when a native drag takes over or the window loses focus', () => {
    let now = 0
    const window = createInputWindow(() => now)
    const page = document.createElement('div')
    document.body.append(page)
    const stop = window.hear(page)
    const drags = (pointerId: number) => {
      now += 151
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId }))
      return window.isOpen()
    }

    page.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
    expect(drags(1)).toBe(true)
    document.dispatchEvent(new Event('dragstart', { bubbles: true }))
    expect(drags(1)).toBe(false)

    page.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2 }))
    expect(drags(2)).toBe(true)
    globalThis.window.dispatchEvent(new Event('blur'))
    expect(drags(2)).toBe(false)
    stop()
    page.remove()
  })
})
