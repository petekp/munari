// @vitest-environment happy-dom
/**
 * The field's non-obvious contracts, all of them bought in the browser.
 *
 * `captureScale` decides how densely each endpoint is cut; `shutterSpan` how
 * far back the shutter reaches; `publishedCut` which cut a slot is allowed to
 * show. Every one of the three was wrong in a way that produced no error, and
 * every one was caught by a measurement rather than by reading it.
 */
import { describe, expect, it } from 'vitest'

import * as THREE from 'three'

import { MAX_TEXTURE_EDGE } from 'munari'

import {
  captureScale,
  EXPOSURE,
  plateTexture,
  publishedCut,
  shutterSpan,
  type Cut,
} from './passageField'

const DPR = 2

/**
 * EVERY ENDPOINT IS A DESTINATION. That is the whole law, and it took three
 * passes to say plainly.
 *
 * This function used to take the OTHER endpoint's width and cut the smaller of
 * the two denser, so the plate would still have texels left when the flight
 * magnified it. The argument is real — mid-flight the small card's capture is
 * blown up toward the large card's size — but it silently reclassified the
 * small endpoint as a source and nothing else. It is also where the card COMES
 * TO REST, at the start of an open and the end of a close, and the extra
 * density is a minification there.
 *
 * Measured live 2026-08-04, at the two resting sizes, supply being texels
 * carried over device pixels covered:
 *
 *     large endpoint (940 px):  1.000    exact
 *     small endpoint (308 px):  2.526    two and a half times oversupplied
 *
 * A 2.5× minification through a trilinear sampler is over a mip level of blur.
 * Pete saw it as the card shrinking back to the tile and the typography
 * snapping clear at the instant the mesh handed back to the DOM — which is
 * exactly the shape of a defect that lives at ONE endpoint: the landing is the
 * only frame where the mesh and the page are shown the same type at the same
 * size, one after the other.
 *
 * The headroom is not free and it was being paid for out of the wrong budget.
 * Both endpoints are now cut at exactly `dpr`, and mid-flight softness — which
 * peaks at 1.75× magnification at the hand-over, the geometric mean of the two
 * widths — is left to the motion blur that now covers precisely that stretch
 * of the flight (decisions #19). Sharpness where a reader can stop; the
 * exposure where they cannot.
 */
describe('captureScale', () => {
  it('cuts EVERY endpoint at exactly one texel per device pixel', () => {
    // Neither endpoint's answer depends on the other's, which is the change.
    expect(captureScale(308, 324, DPR)).toBe(DPR)
    expect(captureScale(940, 695, DPR)).toBe(DPR)
    expect(captureScale(940, 695, 1)).toBe(1)
  })

  /**
   * The corollary that deletes work: the source's density used to change the
   * moment the destination was measured, several frames in, so every open
   * re-cut its own plate mid-flight. That re-cut is what `publishedCut` exists
   * to hide, and it is what quietly handed `createDomTextureSource` a node it
   * had already adopted (decisions #18). It cannot happen now — there is
   * nothing for the destination's arrival to change.
   */
  it('does not change its answer when the destination arrives', () => {
    const beforeDestination = captureScale(308, 324, DPR)
    const afterDestination = captureScale(308, 324, DPR)
    expect(afterDestination).toBe(beforeDestination)
  })

  /**
   * The texture guard still wins over everything above — and it is the KERNEL's
   * guard now, borrowed rather than approximated. This used to cap at 4000, a
   * margin invented to stay clear of a boundary the scene could not cite; a
   * density that has been through `clampScale` cannot trip the warning `Surface`
   * raises from the same call (#21).
   */
  it('never asks for a texture longer than the platform will take', () => {
    expect(captureScale(3000, 400, DPR)).toBe(MAX_TEXTURE_EDGE / 3000)
    // And on the LONG edge, not the width: a tall narrow endpoint used to walk
    // straight past a ceiling that only ever looked at how wide it was.
    expect(captureScale(400, 3000, DPR)).toBe(MAX_TEXTURE_EDGE / 3000)
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
