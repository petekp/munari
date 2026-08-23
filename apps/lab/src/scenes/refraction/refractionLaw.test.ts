// The refraction law's contract.
//
// Three properties fail silently in the browser and are pinned here. A
// relief that is nonzero at an endpoint leaves a permanent lens over a
// landed page — visible only as text that never quite sharpens. A
// transmission that does not reach exactly 1 leaves the outgoing view
// faintly on top of the incoming one forever. And a drop whose bend is
// under the perceptual floor turns the whole crossing into a crossfade with
// a soft middle, which reads as a bug in the easing rather than as glass.
//
// The tuning is a live bag the panel writes into, so what is pinned here is
// the COMMITTED default of each number. Dragging a slider past one of these
// is how they were found; changing the literal is a decision.

import { describe, expect, it } from 'vitest'
import {
  apertureEdge,
  apertureField,
  apertureReveal,
  bendTaper,
  blobBendPx,
  blobHeightPx,
  blobSlope,
  channelSeparationPx,
  maxBlobBendPx,
  refractionStage,
  reliefPulse,
  signedSpread,
  spreadDecay,
  spreadPasses,
} from './refractionLaw'
import { DISPLACEMENT_FLOOR_PX, refractionTuning as tune } from './refractionTuning'

/** The steepest bend the committed drop can ask for, in CSS px. */
const MOST = maxBlobBendPx(tune.heightPx, tune.rimPx, tune.ior, tune.refractPx)

/** The bend at a point d CSS px inside the contact line. */
const bendAt = (d: number) =>
  blobBendPx(blobSlope(d, tune.heightPx, tune.rimPx), tune.ior, tune.refractPx)

/** Every value the aperture field can take, sampled densely. */
const FIELD = Array.from({ length: 101 }, (_, i) => i / 100)

/**
 * Half-seams the shader can produce. It derives this from `fwidth(field)`
 * and clamps it to the overshoot, so the widest is the overshoot itself —
 * which is the case the absolute-ends contract has to survive.
 */
const WIDTHS = [1e-5, 0.005, 0.05, tune.apertureOvershoot]

describe('the relief pulse', () => {
  it('is flat page at both ends, so nothing of the glass survives the landing', () => {
    expect(reliefPulse(0, tune.rise, tune.fall)).toBe(0)
    expect(reliefPulse(1, tune.rise, tune.fall)).toBe(0)
  })

  it('peaks at exactly 1, so the height constant means the pixels it says', () => {
    const peakAt = tune.rise / (tune.rise + tune.fall)
    expect(reliefPulse(peakAt, tune.rise, tune.fall)).toBeCloseTo(1, 12)
  })

  it('peaks at two fifths — glass forms fast and releases slowly', () => {
    const samples = Array.from({ length: 201 }, (_, i) => i / 200)
    const peak = samples.reduce((best, t) =>
      reliefPulse(t, tune.rise, tune.fall) >
      reliefPulse(best, tune.rise, tune.fall)
        ? t
        : best,
    )
    expect(peak).toBeCloseTo(0.4, 2)
  })

  it('clamps outside 0..1 rather than running away', () => {
    expect(reliefPulse(-3, tune.rise, tune.fall)).toBe(0)
    expect(reliefPulse(7, tune.rise, tune.fall)).toBe(0)
  })
})

describe('the stage', () => {
  it('starts as the outgoing view alone and lands as the incoming one alone', () => {
    const start = refractionStage(0, tune)
    const end = refractionStage(1, tune)
    expect(start).toEqual({ relief: 0, transmission: 0, zoom: tune.approachZoom })
    expect(end).toEqual({ relief: 0, transmission: 1, zoom: 1 })
  })

  it('forms the glass ahead of the page it lets through', () => {
    // The ordering IS the effect: if transmission led, this would be a
    // crossfade with a soft middle. The committed pulse buys that ordering
    // with its own shape rather than with a hold, so `transmissionDelay` is
    // 0 and this walks the two curves instead of probing one instant.
    expect(refractionStage(tune.transmissionDelay, tune).transmission).toBe(0)
    for (let i = 10; i <= 55; i++) {
      const { relief, transmission } = refractionStage(i / 100, tune)
      expect(relief).toBeGreaterThan(transmission)
    }
    // Below t=0.073 the transmission is nominally ahead, which costs nothing
    // because neither curve has left the floor yet.
    expect(refractionStage(0.073, tune).transmission).toBeLessThan(0.016)
  })

  it('resolves the incoming view monotonically', () => {
    let previous = -1
    for (let i = 0; i <= 100; i++) {
      const { transmission } = refractionStage(i / 100, tune)
      expect(transmission).toBeGreaterThanOrEqual(previous)
      previous = transmission
    }
  })

  it('settles the incoming view to 1:1 exactly, never near it', () => {
    expect(refractionStage(1, tune).zoom).toBe(1)
  })
})

describe('the aperture front', () => {
  it('reveals nothing anywhere at the start, at any seam width', () => {
    for (const width of WIDTHS) {
      for (const field of FIELD) {
        expect(apertureReveal(field, 0, tune.apertureOvershoot, width)).toBe(0)
      }
    }
  })

  it('reveals everything everywhere at the end, including the flattest corner', () => {
    // The failure this pins is invisible in review and permanent on screen:
    // a front swept only to the field's own limits leaves the last sliver of
    // the outgoing page in the sheet forever, at whatever opacity it stopped.
    for (const width of WIDTHS) {
      for (const field of FIELD) {
        expect(apertureReveal(field, 1, tune.apertureOvershoot, width)).toBe(1)
      }
    }
  })

  it('never uncovers a pixel it has already covered', () => {
    for (const field of FIELD) {
      let previous = -1
      for (let i = 0; i <= 100; i++) {
        const reveal = apertureReveal(field, i / 100, tune.apertureOvershoot, 0.02)
        expect(reveal).toBeGreaterThanOrEqual(previous)
        previous = reveal
      }
    }
  })

  it('opens the inked places first, which is the whole point of the field', () => {
    // Mid-sweep, more ink is strictly further along. If this ever reversed,
    // the front would run from the margins inward and the effect would read
    // as a vignette closing rather than as a page welling up through text.
    const mid = 0.5
    for (let i = 1; i < FIELD.length; i++) {
      expect(apertureReveal(FIELD[i], mid, tune.apertureOvershoot, 0.02)).toBeGreaterThanOrEqual(
        apertureReveal(FIELD[i - 1], mid, tune.apertureOvershoot, 0.02),
      )
    }
    expect(apertureReveal(1, mid, tune.apertureOvershoot, 0.02)).toBeGreaterThan(
      apertureReveal(0, mid, tune.apertureOvershoot, 0.02),
    )
  })

  it('carries the measured median of a real page past the middle of its travel', () => {
    // The quantile the tuning cites, taken off 8281 points of the leaving
    // document on 2026-08-22 at the committed settings. Without the gamma the
    // front crosses most of its range before it reaches half the panel, and
    // the crossing looks like nothing happens and then everything does.
    //
    // 0.624 would land the median exactly at 0.5. The committed 0.43 pushes it
    // to 0.62, so the front opens most of the page in its first half and spends
    // the second half finishing the margins.
    const RAW_MEDIAN = 0.3294
    expect(Math.pow(RAW_MEDIAN, tune.apertureGamma)).toBeCloseTo(0.62, 2)
    expect(Math.pow(RAW_MEDIAN, tune.apertureGamma)).toBeGreaterThan(0.5)
  })

  it('stays inside its own range for every mix of spread and ink', () => {
    for (const spread of FIELD) {
      for (const ink of [0, 0.25, 0.5, 0.75, 1]) {
        const f = apertureField(spread, ink, tune.apertureInk, tune.apertureGamma)
        expect(f).toBeGreaterThanOrEqual(0)
        expect(f).toBeLessThanOrEqual(1)
      }
    }
  })

  it('sweeps past both ends by the full overshoot', () => {
    expect(apertureEdge(0, tune.apertureOvershoot)).toBeCloseTo(1 + tune.apertureOvershoot, 12)
    expect(apertureEdge(1, tune.apertureOvershoot)).toBeCloseTo(-tune.apertureOvershoot, 12)
  })

  it('keeps the seam inside what the browser gate measured as a front', () => {
    // The defect this pins, seen at full size on 2026-08-22: a seam stated
    // in field units spread over half the panel, and both documents were
    // readable on top of each other everywhere. Stating it in screen px is
    // what fixed that.
    //
    // How wide it can be is not derivable here — it depends on the field's
    // spatial gradient, which is a fact about the page. This pins the widest
    // value `gate:refraction-arriving` has actually cleared: at 8, 63–66% of the
    // cells that differ between the two documents still match one exactly, on
    // a floor of 25%. Past this, re-run the gate before changing the number.
    expect(tune.apertureEdgePx).toBeLessThanOrEqual(8)
  })
})

describe('the spread', () => {
  it('holds the blob at the same size when the field resolution moves', () => {
    // The failure this pins is quiet: `blob texel px` reads as a quality
    // knob, so dragging it should not resize the blobs. It would, if the
    // pass count were the knob instead of the distance.
    for (const px of [8, 10, 16, 20, 40]) {
      expect(spreadPasses(80, px) * px).toBeCloseTo(80, 0)
    }
  })

  it('reaches far enough at the committed defaults to order the margins', () => {
    // Under about two passes the blob never leaves the text block that made
    // it, and every margin on the page arrives in one step.
    expect(spreadPasses(tune.spreadReachPx, tune.spreadPx)).toBeGreaterThan(2)
  })

  it('cannot be dragged into stalling a frame, or below the pass that normalises', () => {
    // Never zero: pass zero is also the pass that puts the field in 0..1, and
    // without it the material would threshold raw ink heights — a page whose
    // densest mark reads 0.99 against a front that starts at 1.15, so nothing
    // would ever open.
    expect(spreadPasses(1e6, 1)).toBe(16)
    expect(spreadPasses(0, 20)).toBe(1)
    expect(spreadPasses(-50, 20)).toBe(1)
  })

  it('gives the inside of a solid mark an order, which is what a plateau lacks', () => {
    // The defect this pins, from Pete's screenshot on 2026-08-22: the black
    // square figure was one flat plateau in the field, 80% of its box above
    // 0.995 against 6% over a text column. A plateau has no interior order,
    // and fwidth across it is zero so the seam collapses — the whole square
    // crossed the front on a single frame with a hard rectangular edge.
    //
    // Deeper inside the mark is strictly further along. Depth is what the
    // inward grassfire measures, so this walks it from the mark's edge in.
    let previous = -1
    for (let depth = 0; depth <= 1; depth += 0.02) {
      const field = signedSpread(1, 1 - depth)
      expect(field).toBeGreaterThan(previous)
      previous = field
    }
  })

  it("reads bare paper as empty, a mark's edge as the middle, its core as full", () => {
    expect(signedSpread(0, 1)).toBe(0)
    expect(signedSpread(1, 1)).toBe(0.5)
    expect(signedSpread(1, 0)).toBe(1)
  })

  it('stays inside 0..1 for every pair the two chains can produce', () => {
    for (let a = 0; a <= 1; a += 0.05) {
      for (let b = 0; b <= 1; b += 0.05) {
        const v = signedSpread(a, b)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('lands every blob on bare paper at the tuned reach, whatever made it', () => {
    // The failure this pins cost two rewrites of the spread pass. A decay in
    // raw field units is right for one mark and wrong for every other: the
    // drop that killed a paragraph's blob in four passes left the figure
    // border's at 0.86 and it flooded the sheet. Normalising first is what
    // makes one number work.
    for (const passes of [1, 2, 4, 8, 16]) {
      expect(spreadDecay(passes) * passes).toBeCloseTo(1, 12)
    }
  })
})

describe('the drop', () => {
  it('is flat paper outside the contact line, and nothing else', () => {
    // The front and the surface are the same object: at and outside the
    // contact line the drop has no height, so the page under it is untouched
    // by the bend, the room reflection, and the rim alike.
    for (const d of [-40, -1, -0.01, 0]) {
      expect(blobHeightPx(d, tune.heightPx, tune.rimPx)).toBe(0)
      expect(blobSlope(d, tune.heightPx, tune.rimPx)).toBe(0)
      expect(bendAt(d)).toBe(0)
    }
  })

  it('climbs to its full height and stays there, so the middle is a window', () => {
    // sqrt(1 - exp(-d/e)) is 97.5% of the way up three meniscus widths in
    // and never reaches 1. A profile that kept climbing would make the drop
    // a lens over its whole area, and the arriving page would never be
    // readable while it arrived.
    let last = 0
    for (let d = 0; d <= 200; d += 0.5) {
      const h = blobHeightPx(d, tune.heightPx, tune.rimPx)
      expect(h).toBeGreaterThanOrEqual(last)
      expect(h).toBeLessThan(tune.heightPx)
      last = h
    }
    const flat = blobHeightPx(3 * tune.rimPx, tune.heightPx, tune.rimPx)
    expect(flat / tune.heightPx).toBeCloseTo(0.9748, 4)
  })

  it('has a finite steepest bend, though its tangent at the contact line is vertical', () => {
    // The profile's derivative diverges at d = 0 — that vertical tangent is
    // what makes the edge read as liquid rather than as a ramp. Sampled
    // naively it is an infinity that reaches the uv clamp and streaks the
    // arriving page's border row across the sheet. ROOT_FLOOR stops the
    // climb a twentieth of the way up, which is the number this pins.
    expect(Number.isFinite(MOST)).toBe(true)
    expect(MOST).toBeCloseTo(17.2895, 3)
  })

  it('is no glass at all at an index of 1', () => {
    // Not a degenerate case to guard against — it is the useful setting for
    // seeing what the front alone does, with every other knob untouched.
    // Zero to a rounding error rather than exactly zero: the ray leaves at
    // the angle it arrived, and sqrt(nz * nz) - nz is not bit-exact.
    for (const d of [0.5, 2, 10, 40]) {
      const flat = blobBendPx(blobSlope(d, tune.heightPx, tune.rimPx), 1, tune.refractPx)
      expect(flat).toBeCloseTo(0, 12)
    }
  })
})

describe('the perceptual floor', () => {
  it('bends the meniscus past the floor a human can see', () => {
    expect(MOST).toBeGreaterThan(DISPLACEMENT_FLOOR_PX)
    // Stated as numbers rather than as ratios so a tuning change has to come
    // back here and say what it did. 17.29px at the contact line, 13.30 half
    // a pixel in, 8.80 two in — the whole lens lives in the first few px.
    expect(bendAt(0.5)).toBeCloseTo(13.2985, 3)
    expect(bendAt(2)).toBeCloseTo(8.7973, 3)
  })

  it('leaves the words inside the drop straight', () => {
    // The defect this pins, from Pete's report on 2026-08-22: the glass was
    // a relief of the LEAVING page's letterforms, so every stroke of it bent
    // the arriving page and nothing was ever readable through it. The bend
    // now belongs to the meniscus, and dies within two meniscus widths.
    expect(bendAt(10)).toBeCloseTo(2.5722, 3)
    expect(bendAt(20)).toBeCloseTo(0.8207, 3)
    expect(bendAt(20)).toBeLessThan(DISPLACEMENT_FLOOR_PX)
    expect(bendAt(3 * tune.rimPx)).toBeLessThan(DISPLACEMENT_FLOOR_PX)
  })

  it('puts colour on the meniscus and nowhere else', () => {
    // The defect this pins, from Pete's screenshot on 2026-08-22: the title
    // came out with a rainbow along every stroke. Dispersion is a fraction
    // of the bend, so it goes exactly where the bend goes — 17.2895 x 2 x
    // 0.12 = 4.15px of spectrum across the contact line, 0.62px ten pixels
    // in, and nothing over the flat top.
    const onEdge = channelSeparationPx(MOST, tune.dispersion)
    expect(onEdge).toBeGreaterThan(DISPLACEMENT_FLOOR_PX)
    expect(onEdge).toBeCloseTo(4.1495, 3)
    const inside = channelSeparationPx(bendAt(10), tune.dispersion)
    expect(inside).toBeLessThan(DISPLACEMENT_FLOOR_PX)
    expect(inside).toBeCloseTo(0.6173, 3)
  })

  it('never bends a pixel further than that pixel is from the rim', () => {
    // The streak this pins was visible at full size on 2026-08-22: the uv
    // clamp repeats the arriving page's border row wherever the bend points
    // off the sheet, and the repeat draws as a hard straight edge. The taper
    // has to outrun the bend at EVERY distance, not just at the ends — the
    // dangerous case is halfway out, where the taper is at half strength and
    // the distance is only half the width.
    for (let d = 0; d <= tune.bendTaperPx; d += 0.05) {
      expect(bendTaper(d, tune.bendTaperPx) * MOST).toBeLessThanOrEqual(d)
    }
    // Where the headroom actually is: a smoothstep's steepest slope is 1.5
    // over its width, so the taper outruns every bend under bendTaperPx/1.5
    // and fails every bend over it, whatever the curve does in between. At
    // 34 that ceiling is 22.7px and the drop asks for 17.3.
    expect(tune.bendTaperPx / 1.5).toBeGreaterThan(MOST)
  })
})
