// @vitest-environment happy-dom
//
// Native capture sizing, readiness and paint receipts.
// Trial callbacks are driven in happy-dom. The capture-engines browser gate
// checks the scaled raster pixels and backing-store clearing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * happy-dom does not define `CanvasRenderingContext2D` as a global at all —
 * which is why the probe asks whether the name is declared before it reads
 * the value. Stub the constructor so the trial can be switched on and off
 * from a test.
 */
function stubTrialContext(present: boolean) {
  class Ctx2D {
    drawElementImage?: () => void
  }
  if (present) {
    Ctx2D.prototype.drawElementImage = function () {}
  }
  vi.stubGlobal('CanvasRenderingContext2D', Ctx2D)
}

import {
  createCanvasFrameSource,
  createDomTextureSource,
  type DomTextureSource,
} from '@munari/core'

interface StubCanvas extends HTMLCanvasElement {
  layoutSubtree: boolean
  onpaint: (() => void) | null
  requestPaint: () => void
}

/**
 * The 2d context these tests paint through. onpaint's success path — the one
 * that stamps the paint receipt — only runs if `drawElementImage` does not
 * throw, and happy-dom's real context has no idea what that method is. These
 * three members are the whole of what the paint path calls.
 */
interface StubContext2D {
  setTransform: (...args: number[]) => void
  clearRect: (...args: number[]) => void
  drawElementImage: (...args: unknown[]) => void
}

/** Put `context` behind every `getContext('2d')`, and hand back the undo. */
function stubGetContext(context: StubContext2D) {
  const proto = HTMLCanvasElement.prototype
  const original = proto.getContext
  // SAFETY: the real `getContext` is overloaded across every context id and
  // answers each with a different class. This one answers '2d' with the
  // members above and every other id with `null`, which is the whole of what
  // the code under test asks for.
  proto.getContext = ((id: string) => (id === '2d' ? context : null)) as typeof proto.getContext
  return () => {
    proto.getContext = original
  }
}

/** The compositor's turn: fire the handler the source installed. */
function firePaint(s: DomTextureSource) {
  // SAFETY: `beforeEach` puts the trial members on the canvas prototype, so
  // every canvas this file makes carries `onpaint`.
  const canvas = s.canvas as StubCanvas
  canvas.onpaint?.()
}

/**
 * The Error `run` threw. A test that pins a message or an error class is
 * pinning what the library owes the consumer, so a clean return — or a throw
 * of something that is not an Error — fails right here rather than a line
 * later against a widened type.
 */
function errorFrom(run: () => void): Error {
  try {
    run()
  } catch (cause) {
    if (cause instanceof Error) return cause
    throw new Error(`expected an Error, got ${String(cause)}`)
  }
  throw new Error('expected a throw, got a clean return')
}

/**
 * Stub the origin-trial API onto every canvas this module creates, and let a
 * test drive paints by hand. `requestPaint` is deliberately asynchronous-ish
 * (it only records intent) so a test can assert on the state the compositor
 * would see, not on a synchronous side effect.
 */
let paintRequests = 0

beforeEach(() => {
  paintRequests = 0
  // SAFETY: the three writes below are what MAKE the prototype a StubCanvas.
  // happy-dom ships none of the trial members, so this names the shape the
  // harness is about to install rather than one it found.
  const proto = HTMLCanvasElement.prototype as StubCanvas
  proto.layoutSubtree = false
  proto.onpaint = null
  proto.requestPaint = function (this: StubCanvas) {
    paintRequests++
  }
  // The CONTEXT half of the trial, which the factory's capability gate reads
  // before it builds anything. Nothing here calls it — the only code that
  // touches `ctx` lives inside `onpaint` — but a harness that stubs the
  // canvas half and not this one is describing a browser that cannot exist,
  // and the gate is right to refuse it.
  stubTrialContext(true)
})

function make(w = 360, h = 460, scale = 1) {
  return createDomTextureSource('<div class="root"></div>', w, h, {
    label: 'test',
    scale,
  })
}

/** The CSS box the canvas is pinned to, as numbers. */
function cssSize(canvas: HTMLCanvasElement): [number, number] {
  return [parseFloat(canvas.style.width), parseFloat(canvas.style.height)]
}

describe('createDomTextureSource sizing', () => {
  it('pins the CSS box to the layout size and the backing store to size × scale', () => {
    const s = make(360, 460, 1.5)
    expect(cssSize(s.canvas)).toEqual([360, 460])
    expect([s.canvas.width, s.canvas.height]).toEqual([540, 690])
    expect(s.size()).toEqual([360, 460])
    s.dispose()
  })

  it('setScale moves the backing store only — the subtree never relayouts', () => {
    const s = make(360, 460, 1)
    s.setScale(2)
    expect([s.canvas.width, s.canvas.height]).toEqual([720, 920])
    // The CSS box is what the DOM lays out against. It must not move, or
    // focus/caret/selection would survive the raster but not the reflow.
    expect(cssSize(s.canvas)).toEqual([360, 460])
    expect(s.size()).toEqual([360, 460])
    s.dispose()
  })

  it('setSize moves the CSS box exactly, and the store when the density leaves the band', () => {
    const s = make(360, 460, 1.5)
    s.setSize(288, 122)
    // The BOX is exact, always — it is what the subtree lays out against and
    // what container queries answer. This one is a big enough change on the
    // height axis (690 store against a 122 box is 5.6 px/px, far above the
    // 1.5 asked for) that the store is re-cut with it.
    expect(cssSize(s.canvas)).toEqual([288, 122])
    expect([s.canvas.width, s.canvas.height]).toEqual([432, 183])
    expect(s.size()).toEqual([288, 122])
    s.dispose()
  })

  // THE CONTINUOUS-RESIZE LAW. Writing `canvas.width` clears the
  // backing store, and the paint that refills it is the compositor's to
  // schedule — it lands after the frame that asked. A store cut to the box
  // exactly, on a Surface resized every frame, is therefore BLANK at every
  // upload (measured: coverage 0/576 on 38 of 40 frames; platform.md #12).
  // So the
  // store holds while the density it supplies is close enough, and the
  // element simply rasters at a slightly different density in the meantime.
  it('HOLDS the store through a resize the band can absorb — pixels survive', () => {
    const s = make(400, 400, 2)
    const store = [s.canvas.width, s.canvas.height]
    expect(store).toEqual([800, 800])
    s.setSize(480, 470)
    // 800/480 = 1.67 px/px against a target of 2 — inside ±40%.
    expect(cssSize(s.canvas)).toEqual([480, 470])
    expect(s.size()).toEqual([480, 470])
    expect([s.canvas.width, s.canvas.height]).toEqual(store)
    s.dispose()
  })

  it('still asks for a paint when the store holds — the box moved, so the layout did', () => {
    const s = make(400, 400, 2)
    const before = paintRequests
    s.setSize(480, 470)
    expect([s.canvas.width, s.canvas.height]).toEqual([800, 800])
    expect(paintRequests).toBe(before + 1)
    s.dispose()
  })

  it('resettle cuts the store exact — motion is approximate, rest is exact', () => {
    const s = make(400, 400, 2)
    s.setSize(480, 470)
    expect([s.canvas.width, s.canvas.height]).toEqual([800, 800])
    s.resettle()
    expect([s.canvas.width, s.canvas.height]).toEqual([960, 940])
    expect(cssSize(s.canvas)).toEqual([480, 470])
    s.dispose()
  })

  it('resettle at rest changes nothing and still costs one paint at most', () => {
    const s = make(400, 400, 2)
    const before = paintRequests
    s.resettle()
    expect([s.canvas.width, s.canvas.height]).toEqual([800, 800])
    expect(paintRequests).toBe(before + 1)
    s.dispose()
  })

  // THE REGRESSION GUARD. If setSize ever stops updating the closed-over
  // width/height, this is the test that fails — and it fails for the same
  // reason the browser did: the next setScale recomputes from the stale size.
  it('a resize SURVIVES a subsequent tier swap', () => {
    const s = make(360, 460, 1.5)
    s.setSize(288, 122)
    // An ordinary LOD downshift, exactly as Surface's useFrame issues it.
    s.setScale(1)
    expect(s.size()).toEqual([288, 122])
    expect(cssSize(s.canvas)).toEqual([288, 122])
    // The killer assertion: 288×122, NOT the birth size of 360×460.
    expect([s.canvas.width, s.canvas.height]).toEqual([288, 122])
    s.setScale(2)
    expect([s.canvas.width, s.canvas.height]).toEqual([576, 244])
    s.dispose()
  })

  it('setSize is a no-op at the same size, so callers can call it every render', () => {
    const s = make(360, 460)
    const before = paintRequests
    s.setSize(360, 460)
    expect(paintRequests).toBe(before)
    // Surface compares size() across the call to decide whether to mark a
    // texture realloc; a no-op must leave it unchanged.
    expect(s.size()).toEqual([360, 460])
    s.dispose()
  })

  it('rounds to whole pixels and never collapses to zero', () => {
    const s = make(360, 460)
    // A measured content box is often fractional; a canvas dimension is not.
    s.setSize(287.6, 121.2)
    expect(s.size()).toEqual([288, 121])
    s.setSize(0, 0)
    expect(s.size()).toEqual([1, 1])
    expect([s.canvas.width, s.canvas.height]).toEqual([1, 1])
    s.dispose()
  })
})

// PAINTEDSIZE — the box the delivered raster actually holds, as opposed to
// size()'s box a consumer just asked for. The gap between them is the
// capture pipeline's lag, and a consumer blending the raster against live
// DOM has to read THIS, not size(), to know whether
// what it is about to blend is even the same generation as the live page.
describe('paintedSize — the box the last COMPLETED paint actually holds', () => {
  // onpaint's success path — the one that stamps the paint receipt — only
  // runs if ctx.drawElementImage doesn't throw. happy-dom's real 2D context
  // has no idea what that method is (it is a Chrome-only trial API); the
  // top-level beforeEach only stubs the CONSTRUCTOR's prototype for the
  // capability gate, not a context these tests can actually paint through.
  // Fake one, same shape the identity-CTM block below uses.
  let restoreGetContext = () => {}
  beforeEach(() => {
    restoreGetContext = stubGetContext({
      setTransform: () => {},
      clearRect: () => {},
      drawElementImage: () => {},
    })
  })
  afterEach(() => restoreGetContext())

  it('is [0, 0] before any paint has succeeded', () => {
    const s = make(360, 460)
    expect(s.paintedSize()).toEqual([0, 0])
    s.dispose()
  })

  // THE LAG IS THE CONTRACT, NOT A DEFECT. setSize moves the CSS box (and
  // size()) immediately — the DOM consumer asked for a new layout NOW —
  // but nothing has rasterized AT that box yet. Reporting the new box here
  // before a paint has actually delivered it would tell a consumer
  // blending the raster against live DOM that the copy already matches a
  // generation it has never painted, which is exactly the ghosting this
  // seam exists to prevent (measured 2026-08-08).
  it('still reports the OLD box after setSize, before the next driven paint', () => {
    const s = make(360, 460)
    firePaint(s)
    s.setSize(288, 122)
    expect(s.size()).toEqual([288, 122])
    expect(s.paintedSize()).toEqual([360, 460])
    firePaint(s)
    expect(s.paintedSize()).toEqual([288, 122])
    s.dispose()
  })

  it('publishes frozen, monotonic receipts after successful paints', () => {
    const s = make(360, 460, 1.5)
    const notified: unknown[] = []
    const unsubscribe = s.subscribePaint((receipt) => {
      expect(s.currentPaint()).toBe(receipt)
      notified.push(receipt)
    })
    expect(s.currentPaint()).toBeNull()

    firePaint(s)
    const first = s.currentPaint()
    expect(first).toEqual({
      frame: { sourceId: s.sourceId, generation: 1 },
      paintedSize: [360, 460],
      storeSize: [540, 690],
      // Zero on this engine by construction: the compositor rasterizes inside
      // the frame that asked, so nothing can change while it does.
      changesDuringPaint: 0,
      // The first read of the DOM. This engine reads inside the paint, so a
      // read and a generation advance together here; a re-report does not.
      read: 1,
    })
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first?.frame)).toBe(true)
    expect(Object.isFrozen(first?.paintedSize)).toBe(true)
    expect(Object.isFrozen(first?.storeSize)).toBe(true)

    s.setSize(288, 122)
    firePaint(s)
    expect(s.currentPaint()?.frame.generation).toBe(2)
    expect(s.currentPaint()?.paintedSize).toEqual([288, 122])
    expect(s.currentPaint()?.storeSize).toEqual([432, 183])
    expect(notified).toHaveLength(2)
    expect(s.paintCount()).toBe(2)
    expect(s.painted()).toBe(true)
    expect(s.paintedSize()).toBe(s.currentPaint()?.paintedSize)

    unsubscribe()
    unsubscribe()
    s.repaint()
    firePaint(s)
    expect(s.paintCount()).toBe(3)
    expect(notified).toHaveLength(2)
    s.dispose()
  })

  it('shares globally unique source IDs with frame sources', () => {
    const frame = createCanvasFrameSource(document.createElement('canvas'), {
      premultiplyAlpha: false,
    })
    const dom = make()
    expect(dom.sourceId).not.toBe(frame.currentFrame().sourceId)
    dom.dispose()
  })

  it('does not replace the last good receipt when a paint fails', () => {
    let fail = false
    const errors: Error[] = []
    let s: DomTextureSource | undefined
    const restore = stubGetContext({
      setTransform: () => {},
      clearRect: () => {},
      drawElementImage: () => {
        if (fail) throw new Error('paint failed')
      },
    })
    try {
      s = createDomTextureSource('<div></div>', 80, 40, { onError: error => errors.push(error) })
      const notified: unknown[] = []
      s.subscribePaint((receipt) => notified.push(receipt))
      firePaint(s)
      const good = s.currentPaint()
      fail = true
      s.repaint()
      firePaint(s)
      expect(errors.map(error => error.message)).toEqual(['paint failed'])
      expect(s.painted()).toBe(false)
      expect(s.currentPaint()).toBe(good)
      expect(s.paintCount()).toBe(1)
      expect(notified).toEqual([good])

      // A failed attempt must not consume the explicit demand. The next
      // compositor callback completes it without a second repaint().
      fail = false
      firePaint(s)
      expect(s.painted()).toBe(true)
      expect(s.currentPaint()).toMatchObject({
        frame: { sourceId: s.sourceId, generation: 2 },
        read: 3,
      })
      expect(s.paintCount()).toBe(2)
      expect(notified).toEqual([good, s.currentPaint()])
    } finally {
      s?.dispose()
      restore()
    }
  })
})

describe('the native adopted source', () => {
  it('the ADOPTED NODE is the element drawn, through the ordinary paint path', () => {
    const drawn: unknown[] = []
    const restore = stubGetContext({
      setTransform: () => {},
      clearRect: () => {},
      drawElementImage: (el) => void drawn.push(el),
    })
    try {
      const node = document.createElement('div')
      const s = createDomTextureSource(node, 360, 460)
      // Nothing about the door is a second paint path: same onpaint, same
      // counter, and the element handed to the platform is the consumer's own
      // object — not a copy of it, which would rasterize a subtree they can
      // no longer reach to update.
      expect(s.paintCount()).toBe(0)
      firePaint(s)
      expect(s.paintCount()).toBe(1)
      expect(drawn).toEqual([node])
      s.dispose()
    } finally {
      restore()
    }
  })
})

// The factory's answer when the platform is not there at all.
//
// Reproduced in Chrome 150 WITHOUT --enable-features=CanvasDrawElement
// (2026-08-03): `createDomTextureSource` reached `canvas.requestPaint()`,
// which does not exist, and the bare TypeError propagated out of the r3f
// Canvas — every Surface threw, `<CanvasImpl>` unmounted its whole tree, and
// the page went SOLID BLACK with nothing in the DOM and no message anywhere.
// A library whose entire premise is an origin-trial API owes the consumer a
// sentence, not a blank screen.
//
// `detectHtmlInCanvas` already asks the question honestly; the factory simply
// never listened. These pin that it does. Measured in the same session: the
// trial members are all-or-nothing — drawElementImage, texElementImage2D,
// requestPaint, layoutSubtree and onpaint were true together under the flag
// and false together without it — so the probe's two booleans are a complete
// gate, and this needs no third capability key.
describe('createDomTextureSource without the origin trial', () => {
  beforeEach(() => {
    // SAFETY: the top-level beforeEach installed these three; taking them off
    // again is what a browser without the flag looks like. `Partial` is what
    // makes the removal expressible — on StubCanvas itself they are required.
    const proto = HTMLCanvasElement.prototype as Partial<StubCanvas>
    delete proto.requestPaint
    delete proto.layoutSubtree
    delete proto.onpaint
    stubTrialContext(false)
  })

  it('refuses with a named error instead of a bare TypeError', () => {
    const thrown = errorFrom(() => make())
    expect(thrown.name).toBe('UnsupportedPlatformError')
    expect(thrown.message).not.toMatch(/is not a function/)
    expect(thrown.message).toMatch(/drawElementImage/)
    expect(thrown.message).toMatch(/CanvasDrawElement/)
  })

  it('leaves no parked canvas behind — a refused source owns no DOM', () => {
    const before = document.body.querySelectorAll('canvas').length
    try {
      make()
    } catch {
      /* expected */
    }
    expect(document.body.querySelectorAll('canvas').length).toBe(before)
  })
})

it('rasters each axis independently without changing the retained CSS box',()=>{
 const restore=stubGetContext({setTransform(){},clearRect(){},drawElementImage(){}})
 const source=createDomTextureSource('<div>Axis density</div>',200,100,{scale:1})
 try {
 source.setRasterScale(2.4,1.7);source.resettle()
 expect(source.canvas.width).toBe(480);expect(source.canvas.height).toBe(170)
 expect(source.canvas.style.width).toBe('200px');expect(source.canvas.style.height).toBe('100px')
 expect(source.rasterScale()).toEqual([2.4,1.7])
 firePaint(source)
 expect(source.currentPaint()?.storeSize).toEqual([480,170])
 source.setScale(2);source.resettle()
 expect(source.rasterScale()).toEqual([2,2])
 expect(source.canvas.height).toBe(200)
 }finally{source.dispose();restore()}
})

it('supplies a new display density exactly even when the old store is within the resize band',()=>{
 const restore=stubGetContext({setTransform(){},clearRect(){},drawElementImage(){}})
 const source=createDomTextureSource('<div>Display density</div>',200,100,{scale:2})
 try {
  source.setScale(3)
  expect([source.canvas.width,source.canvas.height]).toEqual([600,300])
  source.setRasterScale(2.4,2.5)
  expect([source.canvas.width,source.canvas.height]).toEqual([480,250])
  expect([source.canvas.style.width,source.canvas.style.height]).toEqual(['200px','100px'])
 }finally{source.dispose();restore()}
})
