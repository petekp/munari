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

import { captureScale, plateTexture, publishedCut, shutterSpan, type Cut } from './passageField'

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

/**
 * The shutter.
 *
 * Motion blur here is not a post pass and there is no velocity buffer. The
 * flight is a pure function of `uT`, so a part's own velocity is the
 * derivative of a closed form — the vertex shader evaluates the same trajectory
 * twice, once at `uT` and once at `uT` minus this span, and smears between the
 * two answers. Which means the ONLY thing the CPU has to supply is how much of
 * the frame the shutter was open for.
 *
 * That framing is load-bearing rather than decorative: a real camera's blur is
 * exposure × velocity, and a shutter angle is the one knob that expresses it.
 * 180° — half a frame — is the film convention, and measurement agreed: a fully
 * open shutter is the honest integral and renders the card unreadable.
 */
describe('shutterSpan', () => {
  const SH = 0.5

  it('is zero on a held frame, so a paused flight is exactly the still', () => {
    // The whole scene is compared against real DOM at held instants. If a hold
    // blurred, every measurement taken through it would be measuring the blur.
    expect(shutterSpan(0.5, 0.5, SH)).toBe(0)
    expect(shutterSpan(1, 1, SH)).toBe(0)
  })

  it('is the shutter fraction of the frame that was actually travelled', () => {
    // A real frame: 60 Hz through the middle of a spring that takes about a
    // second, which is where the words are moving fastest.
    expect(shutterSpan(0.4, 0.425, SH)).toBeCloseTo(0.0125, 6)
    expect(shutterSpan(0.4, 0.425, 1)).toBeCloseTo(0.025, 6)
    expect(shutterSpan(0.4, 0.425, 0)).toBe(0)
  })

  /**
   * A close is an open played backwards (see `departureTarget`), and so is its
   * blur: the trail has to fall behind the direction of travel, whichever way
   * that is. An unsigned span would smear a returning word FORWARD, which reads
   * as the word arriving before it moves.
   */
  it('is signed, so a reversal trails the right way', () => {
    expect(shutterSpan(0.5, 0.4, SH)).toBeCloseTo(-0.05, 6)
  })

  /**
   * The spring is fastest in the middle, so this is naturally largest exactly
   * where the words are moving most — no envelope is authored. But a seek, a
   * tab that was backgrounded, or a first frame after a stall can hand over a
   * whole flight's worth of progress at once, and smearing a word across the
   * entire card is not motion, it is a wipe.
   */
  it('caps a jump, because a dropped frame is not a fast one', () => {
    expect(shutterSpan(0, 1, 1)).toBeLessThanOrEqual(0.08)
    expect(shutterSpan(1, 0, 1)).toBeGreaterThanOrEqual(-0.08)
  })

  it('never smears past the endpoints it is interpolating between', () => {
    // `uT - span` is sampled directly, so a span wider than the trip would ask
    // the trajectory for a time it was never defined at.
    for (const [p, n] of [
      [0, 0.02],
      [0.98, 1],
      [0.5, 0.52],
    ]) {
      const span = shutterSpan(p, n, 1)
      expect(Math.abs(span)).toBeLessThanOrEqual(Math.abs(n - p) + 1e-9)
    }
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
