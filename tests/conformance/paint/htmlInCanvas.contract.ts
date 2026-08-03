// CONFORMANCE CONTRACT — paint (typechecked, not yet run)
// Ported from three-ui@362c5a1 src/lib/htmlInCanvas.test.ts (archive#10, archive#22) + new: identity-CTM pin (archive#11)

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

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// ---- CONTRACT HOLES ------------------------------------------------
interface DomTextureSource {
  /** The 2D canvas receiving the rasterized DOM — feed this to CanvasTexture. */
  canvas: HTMLCanvasElement
  /** The live DOM element being rasterized. Mutate it; changes show up. */
  element: HTMLElement
  /** Force a repaint request (rarely needed — see paintCount). */
  repaint: () => void
  /** Current texture scale (backing-store px per CSS px). */
  scale: () => number
  /** Current CSS size of the subtree's layout box. */
  size: () => readonly [number, number]
  /**
   * Re-rasterize the subtree at `width×k`/`height×k` backing-store pixels.
   * drawElementImage replays paint records — vector draw commands — so this
   * is a true re-render (sharper glyphs), not an upscale. The canvas's CSS
   * size stays pinned, so the subtree never relayouts and DOM state (focus,
   * caret, selection) is untouched. The repaint rides the normal onpaint
   * path: paintCount advances, so upload-on-paint consumers need no extra
   * plumbing.
   */
  setScale: (k: number) => void
  /**
   * Re-layout the subtree at a new CSS size, moving the canvas's CSS box and
   * its backing store together so the effective raster scale is unchanged.
   * Unlike `setScale` this DOES relayout the subtree — that is the point: a
   * content-fitted Surface hugs whatever the DOM measured. Rides the same
   * onpaint path, so callers holding a texture must mark the realloc exactly
   * as they do for `setScale` (decisions #10).
   */
  setSize: (w: number, h: number) => void
  /** True once at least one paint has succeeded. */
  painted: () => boolean
  /**
   * Number of paints that have hit the canvas. The compositor fires onpaint
   * BY ITSELF whenever the subtree's paint record changes — DOM mutations,
   * transitions, paint-property CSS animations, caret blink — so this
   * counter advancing IS the "content changed" signal, and while it's
   * still, the subtree is visually quiescent. (Compositor-side properties
   * — animated opacity/transform — never enter the paint record and are
   * invisible here AND to drawElementImage itself.)
   */
  paintCount: () => number
  dispose: () => void
}

interface DomTextureSourceOptions {
  /** Name shown in the paint-stats diagnostics registry. */
  label?: string
  /** Initial texture scale (backing-store px per CSS px). Default 1. */
  scale?: number
  onError?: (err: unknown) => void
}

declare function createDomTextureSource(
  markup: string,
  width: number,
  height: number,
  options?: DomTextureSourceOptions,
): DomTextureSource
// --------------------------------------------------------------------

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
  // No 2D context stub is needed: the only code that touches `ctx` lives
  // inside `onpaint`, and nothing fires it here.
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

  it('setSize moves the CSS box and the backing store together, holding scale', () => {
    const s = make(360, 460, 1.5)
    s.setSize(288, 122)
    expect(cssSize(s.canvas)).toEqual([288, 122])
    expect([s.canvas.width, s.canvas.height]).toEqual([432, 183])
    expect(s.size()).toEqual([288, 122])
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

// NEW (seed manifest owed): the identity-CTM pin (archive#11). The
// replay is auto-scaled by the canvas's backing/CSS ratio, and any CTM
// multiplies ON TOP of that — effective = ratio × CTM at every k
// (platform claim, re-audit pending). setScale sets the ratio, so the
// CTM must stay identity or the scale applies twice: the k²
// crop-to-top-left bug. Identity is asserted PER PAINT because a
// resize resets context state. This is the unit-level pin the archive
// owed — onpaint asserts identity, the backing supplies the scale; the
// position-aware browser probe stays in the Phase 2 re-audit.
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
    // the normal onpaint path (archive#10's realloc-mark contract).
    expect(s.paintCount()).toBe(2)
    s.dispose()
  })
})
