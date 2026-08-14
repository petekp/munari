// @vitest-environment happy-dom
//
// The source canvas's size arithmetic. Everything here is about ONE invariant
// that is easy to get wrong and expensive to notice: `setScale` recomputes the
// backing store from the CSS size, so the CSS size is the source of truth and
// a resize that fails to move it is silently undone the next time the LOD
// ladder shifts a tier.
//
// That is not a hypothetical. Measured in the browser during the detached-
// surface spike (2026-07-31): a hand-resize that touched only `canvas.width`
// and `canvas.style.width` held for about a second, then an ordinary LOD
// downshift recomputed 360×460 from the birth size — against a 288×122 CSS
// box — and the two stayed diverged for the rest of the session.
//
// happy-dom has no compositor, so the origin-trial surface is stubbed. These
// tests are about the arithmetic, not about rasterization.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * happy-dom does not define `CanvasRenderingContext2D` as a global at all —
 * which is why the probe reaches it through `typeof`. Stub the constructor so
 * the trial can be switched on and off from a test.
 */
function stubTrialContext(present: boolean) {
  class Ctx2D {}
  if (present) {
    ;(Ctx2D.prototype as unknown as Record<string, unknown>).drawElementImage = function () {}
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
 * Stub the origin-trial API onto every canvas this module creates, and let a
 * test drive paints by hand. `requestPaint` is deliberately asynchronous-ish
 * (it only records intent) so a test can assert on the state the compositor
 * would see, not on a synchronous side effect.
 */
let paintRequests = 0

beforeEach(() => {
  paintRequests = 0
  const proto = HTMLCanvasElement.prototype as unknown as StubCanvas
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

  // THE LAW THE PASSAGE FLIGHT BOUGHT. Writing `canvas.width` clears the
  // backing store, and the paint that refills it is the compositor's to
  // schedule — it lands after the frame that asked. A store cut to the box
  // exactly, on a Surface resized every frame, is therefore BLANK at every
  // upload (measured: coverage 0/576 on 38 of 40 frames of a flight). So the
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
    s.dispose()
  })

  it('a tier swap after a resize still scales the NEW size', () => {
    const s = make(360, 460, 1)
    s.setSize(200, 100)
    s.setScale(2)
    expect([s.canvas.width, s.canvas.height]).toEqual([400, 200])
    expect(cssSize(s.canvas)).toEqual([200, 100])
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

  it('setSize requests a repaint when the size really moves', () => {
    const s = make(360, 460)
    const before = paintRequests
    s.setSize(288, 122)
    expect(paintRequests).toBe(before + 1)
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
// DOM (the veil's fade zone) has to read THIS, not size(), to know whether
// what it is about to blend is even the same generation as the live page.
describe('paintedSize — the box the last COMPLETED paint actually holds', () => {
  // onpaint's success path — the one that stamps paintedW/paintedH — only
  // runs if ctx.drawElementImage doesn't throw. happy-dom's real 2D context
  // has no idea what that method is (it is a Chrome-only trial API); the
  // top-level beforeEach only stubs the CONSTRUCTOR's prototype for the
  // capability gate, not a context these tests can actually paint through.
  // Fake one, same shape the identity-CTM block below uses.
  let restoreGetContext = () => {}
  beforeEach(() => {
    const proto = HTMLCanvasElement.prototype
    const original = proto.getContext
    proto.getContext = (() => ({
      setTransform: () => {},
      clearRect: () => {},
      drawElementImage: () => {},
    })) as unknown as typeof proto.getContext
    restoreGetContext = () => {
      proto.getContext = original
    }
  })
  afterEach(() => restoreGetContext())

  /** The compositor's turn: fire the handler the source installed. */
  function firePaint(s: DomTextureSource) {
    ;(s.canvas as unknown as StubCanvas).onpaint?.()
  }

  it('is [0, 0] before any paint has succeeded', () => {
    const s = make(360, 460)
    expect(s.paintedSize()).toEqual([0, 0])
    s.dispose()
  })

  it('reports the birth box after the first driven paint', () => {
    const s = make(360, 460)
    firePaint(s)
    expect(s.paintedSize()).toEqual([360, 460])
    s.dispose()
  })

  // THE LAG IS THE CONTRACT, NOT A DEFECT. setSize moves the CSS box (and
  // size()) immediately — the DOM consumer asked for a new layout NOW —
  // but nothing has rasterized AT that box yet. Reporting the new box here
  // before a paint has actually delivered it would tell a consumer
  // blending the raster against live DOM that the copy already matches a
  // generation it has never painted, which is exactly the ghosting this
  // seam exists to prevent (the veil resize bug, 2026-08-08).
  it('still reports the OLD box after setSize, before the next driven paint', () => {
    const s = make(360, 460)
    firePaint(s)
    s.setSize(288, 122)
    expect(s.size()).toEqual([288, 122])
    expect(s.paintedSize()).toEqual([360, 460])
    s.dispose()
  })

  it('reports the new box once the next paint actually lands', () => {
    const s = make(360, 460)
    firePaint(s)
    s.setSize(288, 122)
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
    firePaint(s)
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
    const proto = HTMLCanvasElement.prototype
    const original = proto.getContext
    proto.getContext = (() => ({
      setTransform: () => {},
      clearRect: () => {},
      drawElementImage: () => {
        if (fail) throw new Error('paint failed')
      },
    })) as unknown as typeof proto.getContext
    try {
      const s = createDomTextureSource('<div></div>', 80, 40)
      const notified: unknown[] = []
      s.subscribePaint((receipt) => notified.push(receipt))
      firePaint(s)
      const good = s.currentPaint()
      fail = true
      firePaint(s)
      expect(s.currentPaint()).toBe(good)
      expect(s.paintCount()).toBe(1)
      expect(notified).toEqual([good])
      s.dispose()
    } finally {
      proto.getContext = original
    }
  })
})

// The identity-CTM pin. The replay is auto-scaled by the canvas's
// backing/CSS ratio, and any CTM multiplies ON TOP of that — effective
// = ratio × CTM at every k. setScale sets the ratio, so the CTM must
// stay identity or the scale applies twice: the k² crop-to-top-left
// bug. Identity is asserted PER PAINT because a resize resets context
// state. This is the unit-level pin — onpaint asserts identity, the
// backing supplies the scale.
describe('identity CTM — the backing ratio is the only scale', () => {
  type Call = { op: 'setTransform' | 'clearRect' | 'drawElementImage'; args: unknown[] }
  let calls: Call[] = []
  let restoreGetContext = () => {}

  beforeEach(() => {
    calls = []
    const proto = HTMLCanvasElement.prototype
    const original = proto.getContext
    const fake = {
      setTransform: (...args: number[]) => void calls.push({ op: 'setTransform', args }),
      clearRect: (...args: number[]) => void calls.push({ op: 'clearRect', args }),
      drawElementImage: (...args: unknown[]) => void calls.push({ op: 'drawElementImage', args }),
    }
    proto.getContext = (() => fake) as unknown as typeof proto.getContext
    restoreGetContext = () => {
      proto.getContext = original
    }
  })

  afterEach(() => restoreGetContext())

  /** The compositor's turn: fire the handler the source installed. */
  function firePaint(s: DomTextureSource) {
    ;(s.canvas as unknown as StubCanvas).onpaint?.()
  }

  it('every paint begins by resetting the CTM to identity', () => {
    const s = make(360, 460, 1.5)
    firePaint(s)
    const first = calls.find((c) => c.op === 'setTransform' || c.op === 'drawElementImage')
    expect(first?.op).toBe('setTransform')
    expect(first?.args).toEqual([1, 0, 0, 1, 0, 0])
    s.dispose()
  })

  it('the replay lands at (0, 0) — the ratio scales, nothing translates', () => {
    const s = make(360, 460, 2)
    firePaint(s)
    const draw = calls.find((c) => c.op === 'drawElementImage')
    expect(draw?.args[0]).toBe(s.element)
    expect(draw?.args.slice(1)).toEqual([0, 0])
    s.dispose()
  })

  it('the clear covers the full backing store, not the CSS box', () => {
    const s = make(360, 460, 1.5)
    firePaint(s)
    const clear = calls.find((c) => c.op === 'clearRect')
    expect(clear?.args).toEqual([0, 0, 540, 690])
    s.dispose()
  })

  it('identity is re-asserted after a resize — context state does not survive one', () => {
    const s = make(360, 460, 1)
    firePaint(s)
    calls = []
    s.setSize(288, 122)
    firePaint(s)
    const first = calls.find((c) => c.op === 'setTransform')
    expect(first?.args).toEqual([1, 0, 0, 1, 0, 0])
    // …and both paints advanced the counter: the resize's raster rides
    // the normal onpaint path (realloc-mark contract).
    expect(s.paintCount()).toBe(2)
    s.dispose()
  })
})

// THE NODE DOOR. A source mounts markup OR adopts an element the consumer
// already built.
//
// Adoption is not sugar. `drawElementImage` accepts only immediate children
// of the trial canvas — measured 2026-08-03, with an explicit InvalidStateError
// for a page element AND for a descendant of a legitimate child — so anything
// captured is necessarily a clone living in its own parked canvas. An
// exploded-paint plate is exactly that: a `cloneNode` of a live element,
// wrapped in padding to defeat the border-box clip (platform.md #9), carrying
// an injected descendant-wide neutralizing stylesheet. That subtree is
// assembled by the consumer and cannot round-trip through `innerHTML`.
//
// The door is one-way BY CONSTRUCTION, and these cases are what makes it so:
// `appendChild` MOVES a node, so a parented element handed over would be torn
// out of the consumer's page with no error anywhere. Refusing it is the whole
// point of the seam.
describe('createDomTextureSource adopting a node', () => {
  /** A plate as the consumer builds one: detached, already assembled. */
  function plate(): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.style.padding = '100px'
    const style = document.createElement('style')
    style.textContent = '*{color:transparent !important}'
    const card = document.createElement('div')
    card.className = 'card'
    card.textContent = 'live'
    wrapper.append(style, card)
    return wrapper
  }

  it('adopts the node ITSELF — identity survives, so the consumer can keep a handle', () => {
    const node = plate()
    const s = createDomTextureSource(node, 360, 460, { label: 'plate' })
    // Not a copy, not a re-parse: the same object. A plate builder holds its
    // wrapper to re-style or re-measure it after the source exists.
    expect(s.element).toBe(node)
    s.dispose()
  })

  it('carries the assembled subtree across intact', () => {
    const node = plate()
    const s = createDomTextureSource(node, 360, 460)
    // The injected stylesheet and the card are both still there. This is what
    // markup round-tripping would have cost: `innerHTML` on a detached wrapper
    // serializes, and the re-parsed subtree is a different object graph than
    // the one whose geometry the consumer measured.
    expect(s.element.querySelector('style')?.textContent).toContain('color:transparent')
    expect(s.element.querySelector('.card')?.textContent).toBe('live')
    s.dispose()
  })

  it('parks the adopted node inside the canvas — the drawn element is a canvas CHILD', () => {
    const node = plate()
    const s = createDomTextureSource(node, 360, 460)
    // The platform's hardest structural rule: only immediate children of the
    // trial canvas can be drawn. An adopted node that landed anywhere else
    // would fail at paint time with InvalidStateError, not here.
    expect(node.parentNode).toBe(s.canvas)
    s.dispose()
  })

  it('re-roots the pointer-events cascade on the adopted node too', () => {
    const node = plate()
    const s = createDomTextureSource(node, 360, 460)
    // The parked canvas is `pointer-events: none` and that value INHERITS.
    // The forwarder's hit test reads the computed style, so without this the
    // whole plate would read as clear glass. The markup path has always done
    // it; the node path is the same subtree and needs the same re-rooting.
    expect(s.element.style.pointerEvents).toBe('auto')
    s.dispose()
  })

  it('dispose RELEASES the node — it leaves unparented, exactly as it arrived', () => {
    const node = plate()
    const s = createDomTextureSource(node, 360, 460)
    s.dispose()
    // Custody, not confiscation. The node is required to arrive unparented,
    // so dispose returns it to that state and adoption is exactly invertible.
    // Leaving it inside the dead canvas would be a resting state nobody owns:
    // a consumer holding the node holds the canvas through it, so every
    // disposed plate would leak its parked canvas.
    expect(document.body.contains(s.canvas)).toBe(false)
    expect(document.body.contains(node)).toBe(false)
    expect(node.parentNode).toBe(null)
  })

  // THE REMOUNT. React StrictMode mounts, cleans up, and mounts again — so a
  // <Surface html={node}> adopts the SAME node twice, with a dispose between.
  // Without release the second adoption sees a node parented to the first
  // (detached) canvas and refuses it: the plate would throw on the second
  // pass of every dev-mode mount, and the refusal would be *correct* by the
  // rule while being nonsense in the situation. Release is what makes the
  // rule and the lifecycle agree.
  it('the same node can be re-adopted after dispose — a StrictMode remount', () => {
    const node = plate()
    const first = createDomTextureSource(node, 360, 460)
    first.dispose()
    const second = createDomTextureSource(node, 360, 460)
    expect(second.element).toBe(node)
    expect(node.parentNode).toBe(second.canvas)
    second.dispose()
  })

  // THE REFUSAL. This is the case the seam exists for.
  it('REFUSES an element that still has a parent, rather than moving it', () => {
    const live = document.createElement('div')
    document.body.appendChild(live)
    let thrown: unknown
    try {
      createDomTextureSource(live, 360, 460)
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(Error)
    // The message has to name the mechanism, because the symptom the consumer
    // would otherwise see is their own page silently losing an element.
    expect((thrown as Error).message).toMatch(/cloneNode/)
    live.remove()
  })

  it('a refused node is left exactly where it was, and no canvas is parked', () => {
    const host = document.createElement('section')
    const live = document.createElement('div')
    host.appendChild(live)
    document.body.appendChild(host)
    const canvasesBefore = document.body.querySelectorAll('canvas').length
    try {
      createDomTextureSource(live, 360, 460)
    } catch {
      /* expected */
    }
    // Refusal happens before construction: the consumer's tree is untouched
    // and nothing was appended to the document to clean up.
    expect(live.parentNode).toBe(host)
    expect(document.body.querySelectorAll('canvas').length).toBe(canvasesBefore)
    host.remove()
  })

  it('refuses a node parented to ANOTHER source, not just a page node', () => {
    const first = createDomTextureSource('<div class="root"></div>', 360, 460)
    // Re-adopting a live source's element would strip that source of the very
    // subtree it rasterizes — a source that silently goes blank, which reads
    // as a paint bug rather than as the double-adoption it is.
    expect(() => createDomTextureSource(first.element, 360, 460)).toThrow(/unparented/)
    expect(first.element.parentNode).toBe(first.canvas)
    first.dispose()
  })

  it('the markup path is unchanged — a string still parses to its first element', () => {
    const s = createDomTextureSource('<div class="root"><span>x</span></div>', 360, 460)
    expect(s.element.className).toBe('root')
    expect(s.element.parentNode).toBe(s.canvas)
    expect(s.element.style.pointerEvents).toBe('auto')
    s.dispose()
  })

  it('the ADOPTED NODE is the element drawn, through the ordinary paint path', () => {
    const proto = HTMLCanvasElement.prototype
    const original = proto.getContext
    const drawn: unknown[] = []
    proto.getContext = (() => ({
      setTransform: () => {},
      clearRect: () => {},
      drawElementImage: (el: unknown) => void drawn.push(el),
    })) as unknown as typeof proto.getContext
    try {
      const node = plate()
      const s = createDomTextureSource(node, 360, 460)
      // Nothing about the door is a second paint path: same onpaint, same
      // counter, and the element handed to the platform is the consumer's own
      // object — not a copy of it, which would rasterize a subtree they can
      // no longer reach to update.
      expect(s.paintCount()).toBe(0)
      ;(s.canvas as unknown as StubCanvas).onpaint?.()
      expect(s.paintCount()).toBe(1)
      expect(drawn).toEqual([node])
      s.dispose()
    } finally {
      proto.getContext = original
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
    const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>
    delete proto.requestPaint
    delete proto.layoutSubtree
    delete proto.onpaint
    stubTrialContext(false)
  })

  it('refuses with a named error instead of a bare TypeError', () => {
    let thrown: unknown
    try {
      make()
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).name).toBe('UnsupportedPlatformError')
    expect((thrown as Error).message).not.toMatch(/is not a function/)
  })

  it("the message names the API and the flag that turns it on", () => {
    const message = (() => {
      try {
        make()
        return ''
      } catch (err) {
        return (err as Error).message
      }
    })()
    expect(message).toMatch(/drawElementImage/)
    expect(message).toMatch(/CanvasDrawElement/)
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
