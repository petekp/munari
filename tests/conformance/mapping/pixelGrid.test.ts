// The phase law: a Surface's texels land on the display's pixels only if
// the Surface itself does.
//
// `densityIdentity` pins how MANY texels a plane needs. This pins where
// they have to arrive, and the two are independent budgets — a Surface can
// be supplied at exactly 1 : 1 and still read soft, which is the defect
// that produced this module. Measured on a live route transition: a
// 0.156 px origin offset cost 16% of the typography's gradient energy
// against the same pixels of real DOM (900.90 → 758.02), and snapping
// the origin returned 1.001×.
//
// The kernel owns the correction. Deciding a Surface is at rest is the
// consumer's judgement, so every number here is the correction at full
// strength; blending is the caller's.
import { describe, expect, it } from 'vitest'

import { cameraDistance, pixelGridSnap, planeScale } from '@munari/core'

const VH = 720
const VW = 1280
const FOV = 42
const CAM = cameraDistance(VH, FOV)

/**
 * The measured Surface at rest. Its box is integral, so the store its
 * capture cut is exactly `box x density` and the texel count is not in
 * question — every law below except `the footprint` is about the corner.
 */
const RESTING = {
  x: -326,
  y: 50.15625,
  width: 308,
  height: 324,
  mag: 1,
  viewW: VW,
  viewH: VH,
  dpr: 2,
  density: 2,
  texelsX: 616,
  texelsY: 648,
}

/** Where the Surface's top-left corner actually lands, in device px. */
function corner(input: Parameters<typeof pixelGridSnap>[0]) {
  const s = pixelGridSnap(input)
  const mag = input.mag
  return {
    left: (input.viewW / 2 + (input.x + s.dx) * mag) * input.dpr - (input.width * mag * input.dpr * s.sx) / 2,
    top: (input.viewH / 2 - (input.y + s.dy) * mag) * input.dpr - (input.height * mag * input.dpr * s.sy) / 2,
  }
}

describe('the pixel-grid snap', () => {
  it('lands the corner on an integer device pixel', () => {
    // The whole point, stated as the thing a probe can read off the
    // screen. The measured Surface sat at y 50.15625 — a sixth of a pixel,
    // and enough to smear every glyph edge across two device pixels.
    const { left, top } = corner(RESTING)
    expect(left).toBeCloseTo(Math.round(left), 9)
    expect(top).toBeCloseTo(Math.round(top), 9)
  })

  it('is already zero for a Surface that was on the grid', () => {
    // A snap that moves an aligned Surface is a snap that would jitter one.
    const aligned = { ...RESTING, x: -326, y: 50 }
    const s = pixelGridSnap(aligned)
    expect(s.dx).toBe(0)
    expect(s.dy).toBe(0)
    expect(s.sx).toBe(1)
    expect(s.sy).toBe(1)
  })

  it('never asks for more than half a device pixel', () => {
    // The cost side of the trade. Half a pixel of displacement is
    // invisible; half a pixel of blur is what gets reported.
    for (const x of [-326.4, -0.5, 0.5, 17.03125, 400.9]) {
      for (const y of [-200.1, -0.25, 50.15625, 331.75]) {
        const s = pixelGridSnap({ ...RESTING, x, y })
        expect(Math.abs(s.dx)).toBeLessThanOrEqual(0.5 / RESTING.dpr + 1e-12)
        expect(Math.abs(s.dy)).toBeLessThanOrEqual(0.5 / RESTING.dpr + 1e-12)
      }
    }
  })

  /**
   * The second correction, and the one a corner-only snap is missing.
   * A 514 px Surface magnified by planeScale at a raised plane
   * does not cover a whole number of device pixels, so the phase walks
   * across the Surface's own width even with the top-left nailed down.
   */
  describe('the footprint', () => {
    const RAISED_Z = 96
    const mag = planeScale(CAM, RAISED_Z)
    const lifted = {
      ...RESTING,
      width: 514,
      height: 157.484375,
      mag,
      density: 2 * mag,
      // What the capture cut for that box: `setSize` rounds the box, THEN
      // the store rounds the product. See the law below.
      texelsX: Math.round(Math.round(514) * 2 * mag),
      texelsY: Math.round(Math.round(157.484375) * 2 * mag),
    }

    it('covers exactly as many device pixels as the texture has texels', () => {
      const s = pixelGridSnap(lifted)
      expect(lifted.width * mag * lifted.dpr * s.sx).toBeCloseTo(lifted.texelsX, 9)
      expect(lifted.height * mag * lifted.dpr * s.sy).toBeCloseTo(lifted.texelsY, 9)
    })

    it('lies about the size by at most half a texel, over the whole Surface', () => {
      // That is the cost side, and it is the bound the law actually
      // gives — a rounding of the demand, spread across the Surface. In
      // fractions it is half a texel over the count, which is a tenth of
      // a percent here and smaller for a larger Surface. A correction
      // larger than this means the density it was handed is not the one
      // the capture happened at.
      const s = pixelGridSnap(lifted)
      const demandX = lifted.width * lifted.density
      const demandY = lifted.height * lifted.density
      expect(Math.abs(s.sx - 1)).toBeLessThanOrEqual(
        (0.5 + Math.abs(lifted.texelsX - demandX)) / lifted.texelsX + 1e-12,
      )
      expect(Math.abs(s.sy - 1)).toBeLessThanOrEqual(
        (0.5 + Math.abs(lifted.texelsY - demandY)) / lifted.texelsY + 1e-12,
      )
    })

    it('is the identity when the capture is already whole', () => {
      // dpr density on an integral Surface: the demand is already a texel
      // count and there is nothing to correct.
      const s = pixelGridSnap({
        ...RESTING, width: 308, height: 324, density: 2, mag: 1, texelsX: 616, texelsY: 648,
      })
      expect(s.sx).toBe(1)
      expect(s.sy).toBe(1)
    })

    /**
     * The count comes from the STORE, and nothing may re-derive it.
     *
     * The capture rounds twice and the obvious guess rounds once:
     * `setSize` rounds the box to an integer before `storeForBox` rounds
     * `box x density`, so the store is `round(round(size) x density)` while
     * `round(size x density)` is what a caller reaching for the nearest
     * formula writes. At density 2 those differ by a whole texel whenever
     * the size's fraction lands in [0.25, 0.75) — half of all fractional
     * sizes — and the density band can hold an older store forward, where
     * no formula recovers the count at all.
     *
     * The failure is not blur. The corner still lands on the grid, so the
     * Surface looks right where anyone checks it, and the phase then ramps
     * to a full device pixel at the far edge. Measured 2026-09-11 on a card
     * 515 x 157.6172 CSS px at density 2, store 316 against a guess of 315:
     * its rules landed one device row low at the divider and two at the
     * footer while its frame stayed put, reading as text that moved and a
     * checkbox stroke that changed weight.
     */
    it('takes the texel count from the store, never from the box', () => {
      const box = 157.6172
      const guess = Math.round(box * 2)
      const store = Math.round(Math.round(box) * 2)
      expect(store - guess).toBe(1)

      const s = pixelGridSnap({ ...RESTING, height: box, density: 2, mag: 1, texelsY: store })
      expect(box * s.sy * 2).toBeCloseTo(store, 9)
      // And the guess would have been a whole texel short over the card.
      expect(box * s.sy * 2 - guess).toBeCloseTo(1, 9)
    })
  })

  /**
   * The correction is applied to a Surface that is centred on its pose, so
   * the two axes cannot share a sign: world y runs up and screen y runs
   * down. Getting this wrong doubles the error instead of cancelling it,
   * silently, on one axis only.
   */
  it('corrects each axis in the direction its own screen edge needs', () => {
    // Same fractional quarter-pixel on both axes, at dpr 2 with an even
    // Surface: the left edge sits half a device pixel past the grid and so
    // does the top. Pushing the Surface RIGHT fixes the left edge; fixing
    // the top means pushing the Surface DOWN, which is world −y. A shared
    // sign here doubles the error on one axis instead of cancelling it,
    // silently, and only on that axis.
    const s = pixelGridSnap({ ...RESTING, x: -326.25, y: 50.25 })
    expect(s.dx).toBeCloseTo(0.25, 9)
    expect(s.dy).toBeCloseTo(-0.25, 9)
  })

  it('scales the correction into world units at altitude', () => {
    // A world unit is `mag` × dpr device pixels up there, so the same
    // sub-pixel error is a SMALLER world move than it is on the page.
    // Applying a page-sized correction at altitude overshoots.
    const mag = planeScale(CAM, 96)
    const { left, top } = corner({ ...RESTING, mag, density: 2 * mag })
    expect(left).toBeCloseTo(Math.round(left), 9)
    expect(top).toBeCloseTo(Math.round(top), 9)
  })

  it('never returns a negative zero', () => {
    // Callers multiply this by a blend weight and compare it against
    // nothing; `-0` is a value they would otherwise have to know about.
    const s = pixelGridSnap({ ...RESTING, x: -326, y: 50 })
    expect(Object.is(s.dx, -0)).toBe(false)
    expect(Object.is(s.dy, -0)).toBe(false)
  })

  it('answers a degenerate Surface instead of dividing by it', () => {
    // A slot before layout or a Surface during unmount can have zero size.
    // NaN would propagate straight into the
    // render graph where nothing checks for it.
    for (const box of [
      { width: 0, height: 324 },
      { width: 308, height: 0 },
      { width: 0, height: 0 },
      { width: -10, height: -10 },
    ]) {
      const s = pixelGridSnap({ ...RESTING, ...box })
      expect(s.sx).toBe(1)
      expect(s.sy).toBe(1)
      expect(Number.isFinite(s.dx)).toBe(true)
      expect(Number.isFinite(s.dy)).toBe(true)
    }
  })

  it('survives a degenerate display instead of dividing by it', () => {
    for (const bad of [{ dpr: 0 }, { mag: 0 }, { dpr: 0, mag: 0 }]) {
      const s = pixelGridSnap({ ...RESTING, ...bad })
      expect(Number.isFinite(s.dx)).toBe(true)
      expect(Number.isFinite(s.dy)).toBe(true)
      expect(Number.isFinite(s.sx)).toBe(true)
      expect(Number.isFinite(s.sy)).toBe(true)
    }
  })

  it('is a pure function of its input', () => {
    // Consumers call it every frame inside useFrame and compare the
    // result against the previous one to decide whether to touch React.
    const a = pixelGridSnap(RESTING)
    const b = pixelGridSnap({ ...RESTING })
    expect(b).toEqual(a)
  })
})
