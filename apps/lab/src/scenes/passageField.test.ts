// @vitest-environment happy-dom
/**
 * The field's two non-obvious contracts, both bought in the browser.
 *
 * `captureScale` decides how densely each endpoint is cut, and it needs to
 * know the OTHER endpoint to do it — which is a problem, because the
 * destination arrives several frames after the source. `publishedCut` is what
 * keeps that from being visible.
 */
import { describe, expect, it } from 'vitest'

import * as THREE from 'three'

import { captureScale, plateTexture, publishedCut, type Cut } from './passageField'

const DPR = 2

describe('captureScale', () => {
  it('cuts the smaller endpoint denser, and only the smaller one', () => {
    // The source of an OPEN is magnified on the way out, so it is oversampled.
    const opening = captureScale(308, 940, DPR)
    // The source of a CLOSE is only ever minified, and mipmaps answer that.
    const closing = captureScale(940, 308, DPR)
    expect(opening).toBeGreaterThan(closing)
    expect(closing).toBe(captureScale(940, 940, DPR))
  })

  /**
   * The measured cause of the flash at the start of every open.
   *
   * The destination cannot be measured until the route has flipped, and the
   * route cannot flip until the source capture exists — so for a few frames
   * the source is cut believing it is going nowhere. When the destination
   * lands, its own scale changes underneath it, and the capture is re-cut.
   *
   * This is not a bug in `captureScale`; the second answer is the right one.
   * It is why `publishedCut` exists. And it fires asymmetrically, which is
   * exactly what the browser census found: a drop of 200 triangles to 8 on
   * every open and never once on a close.
   */
  it('changes its answer for the source when the destination arrives — on an open only', () => {
    expect(captureScale(308, 308, DPR)).not.toBe(captureScale(308, 940, DPR))
    expect(captureScale(940, 940, DPR)).toBe(captureScale(940, 308, DPR))
  })

  /**
   * A resting endpoint is supplied at EXACTLY one texel per device pixel.
   *
   * The first cut of this multiplied every density by a constant lift factor,
   * on the argument that the card rises toward the camera mid-flight and wants
   * the headroom. What that actually bought was a permanent 1.25×
   * MINIFICATION at both ends of the flight, sampled trilinearly — a third of
   * a mip level of blur on the two frames a reader can actually stare at.
   * Measured 2026-08-04 against the landed DOM at the same pixels: the mesh
   * title was visibly mushy beside a crisp page, and turning mipmaps off in
   * the live scene recovered most of it.
   *
   * The lift belongs with the magnification, which is the only cut that is
   * ever seen in motion.
   */
  it('supplies a resting endpoint at exactly one texel per device pixel', () => {
    expect(captureScale(940, 940, DPR)).toBe(DPR)
    expect(captureScale(308, 308, DPR)).toBe(DPR)
    expect(captureScale(940, 308, DPR)).toBe(DPR)
    expect(captureScale(940, 940, 1)).toBe(1)
  })

  it('gives the magnified cut headroom for the lift, and the resting cut none', () => {
    const growth = 940 / 308
    expect(captureScale(308, 940, DPR)).toBeGreaterThan(DPR * Math.sqrt(growth))
  })

  /** The texture guard still wins over everything above. */
  it('never asks for a texture wider than the platform will take', () => {
    expect(captureScale(3000, 12000, DPR)).toBeLessThanOrEqual(4000 / 3000)
  })
})

/**
 * A tripwire, not a theory. The whole defect was one absent line, it produced
 * no error and no stripe — only text that read heavier than the page it was
 * standing in for — and nothing in the type system or the renderer notices
 * that a straight-alpha upload is about to be blended as premultiplied.
 */
describe('plateTexture', () => {
  it('uploads premultiplied, because the whole path downstream is', () => {
    const t = plateTexture(document.createElement('canvas'))
    expect(t.premultiplyAlpha).toBe(true)
  })

  it('reads top-down and decodes as sRGB', () => {
    const t = plateTexture(document.createElement('canvas'))
    expect(t.flipY).toBe(false)
    expect(t.colorSpace).toBe(THREE.SRGBColorSpace)
  })
})

describe('publishedCut', () => {
  const cut = (gen: number, paints: number): Cut => ({ gen, paints })

  it('publishes nothing before the first cut has pixels', () => {
    expect(publishedCut(null, cut(0, 0))).toBe(null)
  })

  it('publishes the first cut the moment it paints', () => {
    const first = cut(0, 1)
    expect(publishedCut(null, first)).toBe(first)
  })

  /**
   * The whole point. A re-cut is a NEW canvas with no pixels in it, and the
   * page copy has already been told to hide by the time one happens — so a
   * slot that vacates while its replacement warms up leaves a hole in a card
   * the reader is looking at. Measured: two frames, the entire field gone.
   */
  it('keeps showing the old cut while the new one is still blank', () => {
    const live = cut(0, 4)
    expect(publishedCut(live, cut(1, 0))).toBe(live)
  })

  it('swaps only once the replacement has painted', () => {
    const live = cut(0, 4)
    const next = cut(1, 1)
    expect(publishedCut(live, next)).toBe(next)
  })

  it('lets go when there is no replacement coming', () => {
    expect(publishedCut(cut(0, 4), null)).toBe(null)
  })

  /**
   * Reversibility: a slot must never go backwards. Once the new cut is on
   * screen the old one is gone, and a stale paint count arriving late cannot
   * resurrect it.
   */
  it('never returns to a cut it has already left', () => {
    const live = cut(0, 4)
    const next = cut(1, 1)
    expect(publishedCut(next, next)).toBe(next)
    expect(publishedCut(live, next)).toBe(next)
  })
})
