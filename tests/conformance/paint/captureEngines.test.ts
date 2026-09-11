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
  createRasterizedSource,
  htmlInCanvasEngine,
  PARKED_HOST_ATTRIBUTE,
  setCaptureEngine,
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

function rasterizedHarness(): EngineHarness {
  let asked = 0
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
      ),
    refusal: 'fake-raster needs a document',
  }
  return {
    engine,
    asked: () => asked,
    // The source batches requests to a microtask and answers from a resolved
    // promise, so draining the microtask queue twice is the whole of "let the
    // engine finish". Three drains covers a follow-up run queued by the one
    // that just landed.
    deliver: async () => {
      for (let i = 0; i < 4; i++) await Promise.resolve()
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
  const drain = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
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
  it('keeps one capture running and coalesces every request behind it', async () => {
    const { calls, rasterize } = deferred()
    const source = createRasterizedSource(rasterize, 'test', '<div></div>', 100, 50)
    await drain()
    expect(calls).toHaveLength(1)

    source.repaint()
    source.repaint()
    source.repaint()
    await drain()
    expect(calls).toHaveLength(1)

    calls[0]!.resolve()
    await drain()
    // Exactly one follow-up for the three requests that arrived during it.
    expect(calls).toHaveLength(2)
    expect(source.paintCount()).toBe(1)

    calls[1]!.resolve()
    await drain()
    expect(calls).toHaveLength(2)
    expect(source.paintCount()).toBe(2)
    source.dispose()
  })

  // A capture that took long enough for the subtree to move is not wrong,
  // it is late — and the receipt is how a consumer tells the difference.
  it('reports how many change signals landed while the raster was being made', async () => {
    const { calls, rasterize } = deferred()
    const source = createRasterizedSource(rasterize, 'test', '<div></div>', 100, 50)
    await drain()

    source.repaint()
    source.repaint()
    calls[0]!.resolve()
    await drain()

    expect(source.currentPaint()?.changesDuringPaint).toBe(2)
    // The follow-up ran with nothing changing under it.
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
    const source = createRasterizedSource(rasterize, 'test', '<div></div>', 100, 50)
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
    const source = createRasterizedSource(rasterize, 'test', '<div></div>', 100, 50, {
      onError: (error) => errors.push(error.message),
    })
    await drain()
    calls[0]!.resolve()
    await drain()
    const good = source.currentPaint()

    for (let i = 0; i < 3; i++) {
      source.repaint()
      await drain()
      calls.at(-1)!.reject(new Error('CORS'))
      await drain()
    }

    expect(errors).toEqual(['CORS'])
    expect(source.currentPaint()).toBe(good)
    expect(source.paintCount()).toBe(1)

    // A success ends the run the message was suppressed over.
    source.repaint()
    await drain()
    calls.at(-1)!.resolve()
    await drain()
    source.repaint()
    await drain()
    calls.at(-1)!.reject(new Error('CORS'))
    await drain()
    expect(errors).toEqual(['CORS', 'CORS'])
    source.dispose()
  })

  it('observes its own subtree, and stops when disposed', async () => {
    const { calls, rasterize } = deferred()
    const source = createRasterizedSource(rasterize, 'test', '<div></div>', 100, 50)
    await drain()
    calls[0]!.resolve()
    await drain()

    source.element.append(document.createElement('span'))
    await drain()
    expect(calls).toHaveLength(2)

    source.dispose()
    source.element.append(document.createElement('b'))
    await drain()
    expect(calls).toHaveLength(2)
  })
})
