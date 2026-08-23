// The refraction law — the shape of a crossing where the OUTGOING view is
// the lens and the incoming one is only ever seen through it.
//
// The law: three numbers describe the whole transition, all pure functions
// of one scrub `t`. `relief` is how proud the glass stands, and it is zero
// at BOTH ends — the sheet is flat page at t=0 and flat page at t=1, so
// nothing of the effect survives the landing. `transmission` is how much of
// the incoming view has resolved, monotonic and exactly 0 and 1 at the ends.
// `zoom` is the incoming view's own scale, arriving slightly large and
// settling to 1:1 so it reads as coming into focus rather than sliding in.
//
// The fault this shape exists to avoid: a relief driven by `sin(pi t)` is
// symmetric, and a symmetric pulse spends as long dissolving as it spent
// forming. Read at hand speed that is backwards — glass forms under
// pressure and then releases slowly. The beta pulse below peaks at
// `rise / (rise + fall)`, which is where the tuning puts it at 1/3, and
// the asymmetry is the whole reason it is not a sine.
//
// Ownership: this module owns shape and nothing else. Time belongs to the
// scene, pixels to `refractionShaders.ts`, and the numbers to
// `refractionTuning.ts`.

/** The tuned shape constants one stage is computed from. */
export interface RefractionShape {
  /** Beta-pulse exponents. Peak sits at `rise / (rise + fall)`. */
  rise: number
  fall: number
  /** Transmission stays at zero below this, so the glass forms first. */
  transmissionDelay: number
  /** The incoming view's scale at t=0, settling to 1 as it resolves. */
  approachZoom: number
}

/** What the material needs for one frame of the crossing. */
export interface RefractionStage {
  /** Relief height, 0..1, peak-normalised. Zero at both ends. */
  relief: number
  /** How much of the incoming view has resolved, 0..1. */
  transmission: number
  /** The incoming view's scale this frame. */
  zoom: number
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Hermite ease, the same curve `smoothstep` computes in GLSL. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/**
 * The beta pulse, normalised so its peak is exactly 1.
 *
 * Normalising by the analytic peak rather than by a sampled maximum is what
 * keeps the tuning honest: change `rise` or `fall` and the peak stays 1, so
 * the amplitude constant in the tuning bag still means the pixels it says.
 */
export function reliefPulse(t: number, rise: number, fall: number): number {
  const x = clamp01(t)
  const peakAt = rise / (rise + fall)
  const peak = Math.pow(peakAt, rise) * Math.pow(1 - peakAt, fall)
  return (Math.pow(x, rise) * Math.pow(1 - x, fall)) / peak
}

/** The whole crossing at one scrub position. */
export function refractionStage(t: number, shape: RefractionShape): RefractionStage {
  const scrub = clamp01(t)
  const transmission = smoothstep(shape.transmissionDelay, 1, scrub)
  return {
    relief: reliefPulse(scrub, shape.rise, shape.fall),
    transmission,
    zoom: 1 + (shape.approachZoom - 1) * (1 - transmission),
  }
}

/**
 * The two grassfires combined into one signed field, 0..1.
 *
 * `outward` is the ink grown into the paper and `inward` is the paper grown
 * into the ink. Bare paper far from any mark reads 0, the edge of a mark
 * reads 0.5, and the middle of a solid mark reads toward 1 by how deep it is.
 *
 * The one-sided version had nothing to say about the inside of a solid mark,
 * and a mark with a flat inside crosses the front on a single frame with a
 * hard edge — the black square figure did exactly that on 2026-08-22, 80% of
 * its box pinned at the field's ceiling.
 */
export function signedSpread(outward: number, inward: number): number {
  return 0.5 + 0.5 * (clamp01(outward) - clamp01(inward))
}

/**
 * The aperture field at one point: where the front reaches it in the sweep.
 *
 * Both terms are the page's own ink at two scales. `spread` is that ink
 * pushed outward until it covers the margins, so bare paper is ordered by
 * how far it sits from the nearest mark; `ink` is the local density,
 * floored and stretched. Mixing them and then raising to `gamma` is what
 * spreads the front's travel evenly over a real page. Measured 2026-08-22
 * on the leaving document: the mix alone has a median of 0.25, so the front
 * crosses three quarters of its range before it touches half the panel. The
 * square root puts that median back at 0.5.
 */
export function apertureField(
  spread: number,
  ink: number,
  inkShare: number,
  gamma: number,
): number {
  const mixed = clamp01(spread) * (1 - inkShare) + clamp01(ink) * inkShare
  return Math.pow(clamp01(mixed), gamma)
}

/**
 * How many spread passes cover `reachPx`, given a texel of `spreadPx`.
 *
 * Each pass takes the box out one texel, so the reach is their product, and
 * dividing here is what keeps the distance fixed when the resolution moves.
 *
 * Never fewer than one, because pass zero is also the pass that normalises
 * the field — at zero the material would sample raw ink heights against a
 * 0..1 threshold and the front would sit past the end of the page. One pass
 * is the honest "no spread" setting: a blob that dies within its own texel.
 *
 * Capped at 16 because both are sliders: a pass is a fullscreen quad at a
 * thirtieth of the page's resolution and costs nothing, but an unbounded
 * count on a knob is a way to stall a frame by dragging.
 */
export function spreadPasses(reachPx: number, spreadPx: number): number {
  return Math.max(1, Math.min(16, Math.round(reachPx / spreadPx)))
}

/**
 * How much height a spread pass gives up, as a fraction of the whole field.
 *
 * The spread runs on already-normalised ink, so every blob starts at 1 and
 * this puts every one of them on bare paper at exactly the tuned reach,
 * whatever height the mark that made it had. Derived rather than tuned,
 * which is what keeps `blob reach px` meaning a distance and not a strength.
 */
export function spreadDecay(passes: number): number {
  return 1 / Math.max(1, passes)
}

/**
 * Where the aperture front stands at one transmission, in field units.
 *
 * Swept from `1 + overshoot` to `-overshoot` rather than from 1 to 0, so the
 * ends are absolute: at transmission 0 nothing is revealed anywhere and at 1
 * everything is. A front that stopped at the field's own limits would leave
 * a permanent sliver of the outgoing page in the sheet's flattest corner.
 */
export function apertureEdge(transmission: number, overshoot: number): number {
  const done = clamp01(transmission)
  return (1 + overshoot) * (1 - done) + -overshoot * done
}

/**
 * How much of the incoming view shows at one point of the aperture field.
 *
 * `field` is the shader's mix of a radial sweep and local ink density, 0 at
 * the last place to open and 1 at the first. `width` is half the seam, which
 * the shader derives per pixel from `fwidth(field)`; passing it in is what
 * lets the contract below pin the ends without a browser, for every seam the
 * shader can produce.
 *
 * Capped at half the overshoot rather than all of it, so the ends clear the
 * field's range with margin. At the full overshoot the widest seam lands
 * exactly on 1.0 and the reveal comes out as float dust instead of zero.
 */
export function apertureReveal(
  field: number,
  transmission: number,
  overshoot: number,
  width: number,
): number {
  const edge = apertureEdge(transmission, overshoot)
  const half = Math.min(width, overshoot / 2)
  return smoothstep(edge - half, edge + half, field)
}

/**
 * How far the incoming view is displaced, in CSS px, at peak relief.
 *
 * `gradient` is the slope of the box-filtered ink field, not of the page's
 * own luminance — a text block measures about 0.1 and the figure's border
 * about 0.73. The scene's perceptual floor is stated against the text-block
 * number, because amplitude alone says nothing: the same constant over a
 * blank panel displaces nothing at all.
 *
 * A soft knee, so the result approaches `maxPx` and never reaches it. See
 * the tuning's note on the shear a hard cap left along heavy strokes.
 */
export function peakDisplacementPx(
  amplitudePx: number,
  gradient: number,
  maxPx: number,
): number {
  const want = amplitudePx * gradient
  return want / (1 + want / maxPx)
}

/**
 * How much of the bend survives `edgePx` from the sheet's rim.
 *
 * The bend samples the arriving view at an offset, and that sample is
 * clamped to the texture. Within a bend's distance of the rim an outward
 * bend therefore repeats the border row, and the sheet grows a hard
 * straight streak beside whatever caused it. Dying to zero at the rim makes
 * the case unreachable, which is stronger than making it rare.
 */
export function bendTaper(edgePx: number, taperPx: number): number {
  return smoothstep(0, taperPx, edgePx)
}

/**
 * How far apart red and blue land at peak relief, in CSS px.
 *
 * Red bends by `1 + dispersion` and blue by `1 - dispersion`, so the two
 * are separated by twice the dispersion times the bend. Stated as its own
 * function because the fringe, not the dispersion constant, is the thing
 * a perceptual floor can be argued about.
 */
export function channelSeparationPx(
  amplitudePx: number,
  gradient: number,
  dispersion: number,
  maxPx: number,
): number {
  return peakDisplacementPx(amplitudePx, gradient, maxPx) * 2 * dispersion
}
