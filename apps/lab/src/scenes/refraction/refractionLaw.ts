// The refraction law — the shape of a crossing where a drop of glass opens
// out of the OUTGOING view and the incoming one is only seen inside it.
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
 * `heightPx` in the tuning bag still means the pixels it says.
 */
export function reliefPulse(t: number, rise: number, fall: number): number {
  const x = clamp01(t)
  const peakAt = rise / (rise + fall)
  const peak = Math.pow(peakAt, rise) * Math.pow(1 - peakAt, fall)
  return (Math.pow(x, rise) * Math.pow(1 - x, fall)) / peak
}

/**
 * A critically damped spring's step response, normalised to land on 1.
 *
 * The playthrough drove the scrub linearly until 2026-08-24, so the crossing
 * started and stopped at full speed. Nothing in the shape below can hide
 * that: the relief pulse and the transmission are both functions of the
 * scrub, so a linear scrub means the glass forms at a constant rate and the
 * motion stops dead at the landing.
 *
 * Critically damped rather than bouncy on purpose. An underdamped spring
 * overshoots past 1, and past 1 there is nothing to see — `reliefPulse`
 * clamps to a relief of 0 and the transmission clamps to fully arrived, so
 * the bounce would be invisible and the damping ratio would be a knob with a
 * dead end. What is left, and what actually reads as a spring, is the
 * asymmetry: it leaves at rest, covers most of the distance early, and
 * settles into the landing.
 *
 * `stiffness` is the spring's rate over the crossing's own duration, so the
 * curve is the same shape whatever `crossingMs` says. The raw response only
 * approaches 1, so it is divided by its own value at the end — at the tuned
 * stiffness that is a 1.7% correction, which is the sense in which the
 * crossing is long enough for the spring to have settled. Drop the stiffness
 * far and the correction grows, which is the curve landing while it is still
 * moving.
 */
export function springEase(p: number, stiffness: number): number {
  const t = clamp01(p)
  const k = Math.max(1e-3, stiffness)
  const step = (x: number) => 1 - (1 + k * x) * Math.exp(-k * x)
  return step(t) / step(1)
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

/** Where the drop's vertical tangent is floored, as a share of full height. */
const ROOT_FLOOR = 0.06

/**
 * Height of the emerging glass, `distPx` inside its contact line, CSS px.
 *
 * A drop, not a ramp: zero at the line, a vertical tangent there, a flat top
 * about three rim widths in. The flat top is what keeps the arriving page
 * readable through the middle of a blob, because every optical term the
 * scene has lives in the meniscus and dies inside it.
 */
export function blobHeightPx(distPx: number, heightPx: number, rimPx: number): number {
  if (distPx <= 0) return 0
  return heightPx * Math.sqrt(1 - Math.exp(-distPx / Math.max(rimPx, 0.5)))
}

/**
 * The drop's slope there, dh/dd, dimensionless.
 *
 * A vertical tangent has no normal, so the root is floored at ROOT_FLOOR of
 * full height. That floor, and not the profile, is what sets the steepest
 * surface the glass can present — which makes it, and not the profile, what
 * bounds the widest bend the scene can ask for.
 */
export function blobSlope(distPx: number, heightPx: number, rimPx: number): number {
  if (distPx <= 0) return 0
  const e = Math.max(rimPx, 0.5)
  const uu = Math.exp(-distPx / e)
  const fill = Math.sqrt(Math.max(1 - uu, 0))
  return (heightPx * uu) / (2 * e * Math.max(fill, ROOT_FLOOR))
}

/**
 * How far a surface of that slope moves what is behind it, CSS px.
 *
 * Snell at the front face of a flat-backed sheet: the eye ray refracts
 * through the normal and lands `refractPx` times its lateral deviation away.
 * Past the critical angle there is no refracted ray at all — total internal
 * reflection — and this returns 0 rather than a clamped guess, which is what
 * the shader's own `refract` does.
 */
export function blobBendPx(slope: number, ior: number, refractPx: number): number {
  const eta = 1 / Math.max(ior, 1)
  const nz = 1 / Math.sqrt(1 + slope * slope)
  const nxy = slope * nz
  const k = 1 - eta * eta * (1 - nz * nz)
  if (k < 0) return 0
  return Math.abs(Math.sqrt(k) - eta * nz) * nxy * refractPx
}

/**
 * The steepest bend a drop of this shape can ask for, CSS px.
 *
 * Not at the contact line: there the profile is exactly zero and the slope
 * with it. The steepest real surface is wherever the floored root takes
 * over, which is where the profile reaches ROOT_FLOOR of full height. The
 * rim taper is pinned against this rather than against a typical bend,
 * because the border streak it prevents needs only one pixel to appear.
 */
export function maxBlobBendPx(
  heightPx: number,
  rimPx: number,
  ior: number,
  refractPx: number,
): number {
  const e = Math.max(rimPx, 0.5)
  const dAtFloor = -e * Math.log(1 - ROOT_FLOOR * ROOT_FLOOR)
  return blobBendPx(blobSlope(dAtFloor, heightPx, e), ior, refractPx)
}

export function bendTaper(edgePx: number, taperPx: number): number {
  return smoothstep(0, taperPx, edgePx)
}

/**
 * How far apart red and blue land, in CSS px, for a bend of `bendPx`.
 *
 * Red bends by `1 + dispersion` and blue by `1 - dispersion`, so the two are
 * separated by twice the dispersion times the bend. Stated as its own
 * function because the fringe, not the dispersion constant, is the thing a
 * perceptual floor can be argued about.
 */
export function channelSeparationPx(bendPx: number, dispersion: number): number {
  return bendPx * 2 * dispersion
}

// ── routing the pointer: which document is under a given point ──────────
//
// The material decides per fragment which of two live documents a pixel
// shows. A pointer needs the same answer on the CPU, at one point, to send
// a hover into the right subtree. `apertureEdge` above is already half of
// it — a point is showing the incoming document where its field is past
// that edge. These two are the rest of the pure part; the field itself has
// to be read back off the GPU.

/**
 * A uv snapped toward the centre of a texel, eased across the boundary.
 *
 * The spread field is bilinear on a coarse grid, so a front sweeping across
 * it turns a corner at every texel edge. `rounding` at 1 replaces the linear
 * ramp between texel centres with a smoothstep, which is what rounds those
 * corners out. Mirrors `roundedUv` in the fragment shader — the two are one
 * law and `refractionRouting.test.ts` pins them to the same numbers.
 */
export function roundedCoord(x: number, texel: number, rounding: number): number {
  const t = x / texel - 0.5
  const i = Math.floor(t)
  const f = t - i
  return (i + 0.5 + (f + (f * f * (3 - 2 * f) - f) * rounding)) * texel
}

/**
 * Where on the incoming document a point of the sheet is looking.
 *
 * The outgoing view is sampled undisplaced, so a hit on the sheet is already
 * the right point of it. The incoming view is sampled through the drop, and
 * this is the part of that mapping the whole sheet shares: the approach
 * zoom, about the centre. The bend on top of it is a local displacement of
 * at most `refractPx`, and routing deliberately ignores it — see the
 * scene's own note on what that costs.
 */
export function approachUv(u: number, v: number, zoom: number): [number, number] {
  const z = Math.max(zoom, 1e-4)
  return [(u - 0.5) / z + 0.5, (v - 0.5) / z + 0.5]
}
