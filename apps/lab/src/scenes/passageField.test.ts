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

import {
  captureScale,
  EXPOSURE,
  plateTexture,
  publishedCut,
  shutterSpan,
  type Cut,
} from './passageField'

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
 * flight is a pure function of `uT`, so a part's own velocity is the derivative
 * of a closed form — the vertex shader evaluates the same trajectory twice,
 * once at `uT` and once at `uT` minus this span, and smears between the two
 * answers. Which means the ONLY thing the CPU has to supply is how far the
 * flight travelled while the shutter was open.
 *
 * A real camera's blur is exposure × velocity, and BOTH factors have to be
 * quantities the world supplies. The first cut of this got the second one right
 * and the first one wrong: it measured the exposure as a fraction of a FRAME, a
 * 180° shutter angle. That is a fraction of a quantity the scene does not
 * control, and it makes the effect weaker the better the machine performs — a
 * 180° shutter is 1/48 s at cinema's 24 Hz and 1/240 s at the 120 Hz this
 * actually runs at. Measured on a live flight at 120 Hz: peak smear 4.4 px,
 * median 0.76 px, not one frame above 6 px. Present in the buffer, absent to
 * the eye, and it would have looked like a different effect on a 60 Hz display.
 *
 * So the exposure is a TIME, in seconds, and the span is progress-velocity
 * times that time. Same blur on every display, and the number that reads
 * correctly turns out to be the one cinema settled on.
 */
describe('shutterSpan', () => {
  /** A 60 Hz frame and a 120 Hz frame covering the same stretch of flight. */
  const SLOW = { dt: 1 / 60, from: 0.4, to: 0.45 }
  const FAST = { dt: 1 / 120, from: 0.4, to: 0.425 }

  /**
   * The regression, stated directly. Two machines are moving the same flight at
   * the same speed; the only difference is how often they are asked to draw it.
   * A camera pointed at that flight would record the same streak in both cases,
   * because the shutter does not know the frame rate.
   */
  it('does not depend on the frame rate', () => {
    const slow = shutterSpan(SLOW.from, SLOW.to, SLOW.dt, EXPOSURE)
    const fast = shutterSpan(FAST.from, FAST.to, FAST.dt, EXPOSURE)
    expect(fast).toBeCloseTo(slow, 6)
  })

  it('is exposure × the velocity the flight is actually travelling at', () => {
    // 3 units of progress per second, open for a fiftieth of one.
    expect(shutterSpan(0.4, 0.45, 1 / 60, 1 / 50)).toBeCloseTo(0.06, 6)
    expect(shutterSpan(0.4, 0.45, 1 / 60, 0)).toBe(0)
  })

  it('is zero on a held frame, so a paused flight is exactly the still', () => {
    // The whole scene is compared against real DOM at held instants. If a hold
    // blurred, every measurement taken through it would be measuring the blur.
    expect(shutterSpan(0.5, 0.5, 1 / 60, EXPOSURE)).toBe(0)
    expect(shutterSpan(1, 1, 1 / 120, EXPOSURE)).toBe(0)
  })

  /**
   * A close is an open played backwards (see `departureTarget`), and so is its
   * blur: the trail has to fall behind the direction of travel, whichever way
   * that is. An unsigned span would smear a returning word FORWARD, which reads
   * as the word arriving before it moves.
   */
  it('is signed, so a reversal trails the right way', () => {
    expect(shutterSpan(0.5, 0.4, 1 / 60, EXPOSURE)).toBeLessThan(0)
    expect(shutterSpan(0.5, 0.4, 1 / 60, EXPOSURE)).toBeCloseTo(
      -shutterSpan(0.4, 0.5, 1 / 60, EXPOSURE),
      9,
    )
  })

  /**
   * Velocity is already frame-rate invariant, so a long frame is no longer a
   * fast one by construction and the cap has stopped being load-bearing. It
   * stays for the degenerate `dt` — a first frame, a restored tab, a clock that
   * hands over zero — where the division itself is the hazard.
   */
  it('survives a degenerate frame time instead of dividing by it', () => {
    expect(Number.isFinite(shutterSpan(0.4, 0.5, 0, EXPOSURE))).toBe(true)
    expect(Math.abs(shutterSpan(0.4, 0.5, 1e-9, EXPOSURE))).toBeLessThanOrEqual(0.08)
    expect(Math.abs(shutterSpan(0, 1, 1e-9, EXPOSURE))).toBeLessThanOrEqual(0.08)
  })

  /**
   * And it is allowed to be WIDER than the frame that reported it — at 120 Hz a
   * 1/48 s exposure covers two and a half frames of travel, which no single
   * camera could do. That is the deliberate part: this is photographing the
   * flight, not sampling it, and the look being reproduced is a 24 Hz one. The
   * shader clamps the time it reaches back to, so a wide span asks for an
   * earlier pose and never for an undefined one.
   */
  it('may reach back further than the frame it was measured over', () => {
    expect(Math.abs(shutterSpan(0.4, 0.42, 1 / 120, EXPOSURE))).toBeGreaterThan(0.02)
  })

  it('is bounded, whatever it is handed', () => {
    for (const [p, n, dt] of [
      [0, 1, 1 / 120],
      [1, 0, 1 / 600],
      [0.5, 0.52, 0],
    ]) {
      expect(Math.abs(shutterSpan(p, n, dt, EXPOSURE))).toBeLessThanOrEqual(0.08)
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
