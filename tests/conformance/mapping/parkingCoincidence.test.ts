// CONFORMANCE — mapping (flipped 2026-08-02)
// New contract (owed by seed manifest): the parking coincidence — every parked source sits fixed at page (0,0), so a client point is already a page point for every surface (archive#16, archive#20, archive#22)
// @vitest-environment happy-dom
//
// The coincidence three-ui leaned on everywhere and never tested: the
// parking canvas is `position:fixed; left:0; top:0`, the drawn element
// is laid out inside it from that same origin, and therefore a point
// forwarded to ANY surface needs no per-surface translation — local
// coordinates, client coordinates, and page coordinates are the same
// numbers. archive#16's "zero coordinate math" for floating layers is
// this fact; archive#20's content hit-test and archive#22's
// detached-layer sizing both assume it silently. A contract because a
// well-meaning refactor (parking off-screen at left:-10000px, tiling
// sources side by side) would keep every unit green and break every
// forwarded pointer in the app.
//
// Flip note: lives in mapping (it is a coordinate-custody fact) but
// its subject API is the paint layer's source factory — it flips WITH
// paint, brings happy-dom to devDependencies if the door layer hasn't
// already, and reuses the paint suite's trial-surface stubs (onpaint /
// requestPaint / layoutSubtree do not exist in happy-dom).
import { beforeEach, describe, expect, it } from 'vitest'

import { createDomTextureSource } from '@anamorph/core'

interface StubCanvas extends HTMLCanvasElement {
  layoutSubtree: boolean
  onpaint: (() => void) | null
  requestPaint: () => void
}

// The origin-trial surface (layoutSubtree / onpaint / requestPaint) does not
// exist in happy-dom — stubbed onto the canvas prototype exactly as the
// paint suite does (paint/htmlInCanvas.test.ts). Vitest isolates each test
// file's module state, so that file's beforeEach can't reach this one: the
// "reuses the paint suite's trial-surface stubs" note above is the PATTERN,
// not a cross-file hook, and this file owns its own copy. None of these
// tests fire onpaint or count paints, so the stub is a no-op.
beforeEach(() => {
  const proto = HTMLCanvasElement.prototype as unknown as StubCanvas
  proto.layoutSubtree = false
  proto.onpaint = null
  proto.requestPaint = function (this: StubCanvas) {}
})

describe('the parking coincidence — a client point IS a page point', () => {
  it('parks the canvas fixed at page (0,0)', () => {
    // Style declarations, not layout reads: the guarantee must hold in
    // environments that stub layout, and the declaration is the mechanism.
    const s = createDomTextureSource('<div style="width:120px;height:80px">hi</div>', 120, 80)
    expect(s.canvas.style.position).toBe('fixed')
    expect(s.canvas.style.left).toBe('0px')
    expect(s.canvas.style.top).toBe('0px')
    s.dispose()
  })

  it('lays the element out from that same origin', () => {
    const s = createDomTextureSource('<div style="width:120px;height:80px">hi</div>', 120, 80)
    const rect = s.element.getBoundingClientRect()
    // THE theorem: the element's box starts at the page origin, so for
    // every (x, y) a forwarder computes, element-local == client == page.
    expect(rect.left).toBe(0)
    expect(rect.top).toBe(0)
    s.dispose()
  })

  it('every source parks at the SAME origin — surfaces stack, they never tile', () => {
    // All parked subtrees coincide. That is why hit arbitration must be
    // decided by z-order and painted content (archive#20, archive#27) —
    // position can never disambiguate surfaces, by construction.
    const a = createDomTextureSource('<div style="width:10px;height:10px">a</div>', 10, 10)
    const b = createDomTextureSource('<div style="width:900px;height:600px">b</div>', 900, 600)
    for (const s of [a, b]) {
      expect(s.canvas.style.left).toBe('0px')
      expect(s.canvas.style.top).toBe('0px')
    }
    a.dispose()
    b.dispose()
  })

  it('the canvas is unhittable and the cascade re-roots at the element', () => {
    // The parking canvas must never catch a real pointer (it sits at the
    // page origin, under everything) — but pointer-events:none inherits,
    // and the forwarder's hit test reads computed values. Left alone,
    // every parked element would read as clear glass. The factory
    // re-roots the cascade to `auto` on the element (archive#20).
    const s = createDomTextureSource('<div style="width:12px;height:12px">x</div>', 12, 12)
    expect(s.canvas.style.pointerEvents).toBe('none')
    expect(s.element.style.pointerEvents).toBe('auto')
    s.dispose()
  })
})
