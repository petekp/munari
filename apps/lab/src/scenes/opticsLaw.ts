// The optics of the kit — one module, two languages.
//
// Every instrument on the bench does the same thing to the page: one
// refraction, at one curved face, at one standoff. The JS below is the
// literal twin of the GLSL in `opticsShaders.ts`. The shader refracts the
// VIEW ray to decide which page texel a fragment shows; the raycast
// refracts the POINTER ray with the same six lines to decide which element
// a click reaches. Neither inverts the other — that is why they agree.
// Measured at 0.35–0.68 px across the whole aperture, below the measuring
// chart's own quantisation (docs/spikes/optics-loupe.md).
//
// If you change the math here, change the GLSL in the same commit.
//
// Units are CSS px throughout, which is also world units: the scene's
// camera is pixel-calibrated, so a page px is a world unit is a screen px.

export type Vec3 = readonly [number, number, number]

export interface LensSpec {
  /**
   * Radius of the glass, px. Nothing outside it is refracted.
   *
   * For a rectangular face this is the CORNER distance — the radius of the
   * smallest disc containing the face. Everything downstream that reasons
   * about how far from the axis the glass reaches (`capIsValid`,
   * `powerLimit`) wants that number and no other, because the corner is
   * where a rectangle strains its cap hardest.
   */
  aperture: number
  /**
   * Half-width and half-height, px, when the face is a rectangle you
   * resize rather than a fixed disc. Absent is a disc.
   *
   * The cap is the same sphere either way — only the cookie-cutter changes.
   * That is what lets one law serve a turned loupe and a bare sheet.
   */
  half?: readonly [number, number]
  /**
   * Sphere radius of the curved face, px, SIGNED. Positive bulges toward
   * the eye and magnifies; negative dishes away and reduces; infinite is
   * a flat window. The reducing glass is the loupe with one sign flipped,
   * which is the whole reason the kit is one law instead of three.
   */
  curvature: number
  /** How high the glass stands above the page, px. */
  standoff: number
  /** Index of refraction of the glass. 1 is a window. */
  ior: number
}

const EPS = 1e-9

function normalize(v: Vec3): Vec3 {
  const m = Math.hypot(v[0], v[1], v[2])
  return m < EPS ? [0, 0, 1] : [v[0] / m, v[1] / m, v[2] / m]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/**
 * Outward normal of the curved face at a point on the aperture.
 *
 * The face is the cap of a sphere of radius |curvature| whose axis passes
 * through the lens centre. At radius r the cap's height is
 * k = √(R² − r²), and the outward normal of a sphere is the vector from
 * its centre — so the normal is (r, k) with r's sign following the
 * curvature's. A flat face (infinite curvature) is straight up.
 */
export function lensNormal(lx: number, ly: number, curvature: number): Vec3 {
  if (!Number.isFinite(curvature)) return [0, 0, 1]
  const r2 = lx * lx + ly * ly
  // Guard the rim: a point at or past the sphere's own radius has no
  // tangent plane. Clamped, not thrown — an aperture wider than its
  // curvature is a design error, and it should read as a hard rim rather
  // than as NaN pixels.
  const k = Math.sqrt(Math.max(curvature * curvature - r2, EPS))
  const s = curvature < 0 ? -1 : 1
  return normalize([s * lx, s * ly, k])
}

/**
 * GLSL's `refract`, transcribed. Returns null on total internal
 * reflection, which GLSL reports as a zero vector.
 */
export function refract(I: Vec3, n: Vec3, eta: number): Vec3 | null {
  const d = dot(n, I)
  const k = 1 - eta * eta * (1 - d * d)
  if (k < 0) return null
  const s = eta * d + Math.sqrt(k)
  return [eta * I[0] - s * n[0], eta * I[1] - s * n[1], eta * I[2] - s * n[2]]
}

/** The disc that contains a rectangular face — its corner distance. */
export function apertureOf(half: readonly [number, number]): number {
  return Math.hypot(half[0], half[1])
}

/** Is this point on the glass? A rectangle if `half` is set, else a disc. */
export function inAperture(lx: number, ly: number, spec: LensSpec): boolean {
  if (spec.half) return Math.abs(lx) <= spec.half[0] && Math.abs(ly) <= spec.half[1]
  return lx * lx + ly * ly <= spec.aperture * spec.aperture
}

/**
 * Where a ray entering the glass at (lx, ly) lands on the page.
 *
 * Both the argument and the result are relative to the lens axis, so the
 * caller adds the lens centre. `incident` is the unit direction of the
 * arriving ray, pointing at the page (negative z). Under an orthographic
 * eye that is (0, 0, −1) everywhere; under this scene's perspective camera
 * it changes per fragment, which is the only thing the shader computes
 * that the spike did not.
 *
 * Null means the ray misses: outside the aperture, or reflected.
 */
export function landOffset(
  lx: number,
  ly: number,
  incident: Vec3,
  spec: LensSpec,
): [number, number] | null {
  if (!inAperture(lx, ly, spec)) return null
  const rd = refract(incident, lensNormal(lx, ly, spec.curvature), 1 / spec.ior)
  // A ray bent back up never reaches the page. Physically this is the
  // grazing limit of a strong reducer; practically it is the guard that
  // keeps a bad dial value from dividing by zero.
  if (!rd || rd[2] >= -EPS) return null
  const t = spec.standoff / -rd[2]
  return [lx + t * rd[0], ly + t * rd[1]]
}

/**
 * Power at the axis, in closed form.
 *
 * Paraxially the normal is (x/R, y/R, 1) and a straight-down ray leaves at
 * (−(1−η)x/R, −(1−η)y/R, −1), so it lands at x(1 − D(1−η)/R): the page
 * point the axis-adjacent glass shows is pulled toward the axis by a
 * constant factor, and the magnification is that factor inverted. Exact
 * at the axis, and the number worth printing on a readout.
 */
export function magnification(spec: LensSpec): number {
  if (!Number.isFinite(spec.curvature)) return 1
  return 1 / (1 - (spec.standoff * (1 - 1 / spec.ior)) / spec.curvature)
}

/**
 * How much clearance the cap keeps over its own aperture.
 *
 * Two separate things go wrong as |R| falls toward the aperture, and the
 * second one is the reason this number is 2 and not something near 1.
 *
 * The face is a spherical cap of radius |R| cut to a disc of radius
 * `aperture`, so it needs |R| > aperture: at |R| = aperture the rim normal
 * lies flat in the page plane, and past it there is no sphere left to cut.
 * Nothing in the arithmetic stops there — `lensNormal` clamps its square
 * root and keeps returning a unit vector — so the failure is silent and
 * surfaces two layers away as a footprint that GROWS when the power does.
 * Measured 2026-08-11, before any bound existed: the loupe marked 2.35×
 * (|R| = 89.3, aperture 90) reported a 201 px reading where 77 px was true.
 *
 * The second is a caustic, and it bites first. A convex cap converges, so
 * far enough down the rim rays cross the axis BEFORE they reach the page and
 * the footprint collapses through zero. Swept 2026-08-11 at aperture 90:
 *
 *     |R|/A      1.10    1.25    1.40    1.60    2.00    2.50    3.00
 *     rim/axis   0.52   310.9    1.96    1.32    1.10    1.04    1.02
 *
 * At 1.25 the rim reads 311× what the collar claims. The number is only
 * meaningful from about 2 up, which is where this sits: the extreme power a
 * cap may be ground to still shows its rim within ~30% of its axis, and
 * every softer setting is inside a few percent.
 *
 * A concave cap diverges and never crosses, so it is well behaved much
 * sooner (0.96 of paraxial at 2.0). One margin governs both anyway — the
 * reducing glass loses nothing by clearing a bar it was already over.
 */
export const CAP_MARGIN = 2

/** Is this a cap the law can describe? */
export function capIsValid(spec: LensSpec): boolean {
  if (!Number.isFinite(spec.curvature)) return true
  return Math.abs(spec.curvature) >= CAP_MARGIN * spec.aperture
}

/**
 * The powers an aperture, standoff and index can actually hold, given
 * CAP_MARGIN. A collar marked outside this range is marked with a lie.
 *
 * Both bounds fall out of |R| ≥ CAP_MARGIN·A with R = c/(1−1/m) and
 * c = D(1−1/n): magnifying gives m ≤ 1/(1−K), reducing gives m ≥ 1/(1+K),
 * for K = c/(CAP_MARGIN·A). When K ≥ 1 the magnifying side is unbounded —
 * the cap can stay a cap at any power.
 */
export function powerLimit(
  aperture: number,
  standoff: number,
  ior: number,
): { min: number; max: number } {
  const k = (standoff * (1 - 1 / ior)) / (CAP_MARGIN * aperture)
  return { min: 1 / (1 + k), max: k >= 1 ? Infinity : 1 / (1 - k) }
}

/**
 * The inverse: the curved face that gives a wanted power. This is what a
 * collar twist actually sets — a dial reading "2.4×" is a dial choosing a
 * radius of curvature, exactly as grinding a real lens would.
 */
export function curvatureFor(power: number, standoff: number, ior: number): number {
  if (power === 1) return Infinity
  return (standoff * (1 - 1 / ior)) / (1 - 1 / power)
}

export interface Disc {
  x: number
  y: number
  r: number
}

/**
 * The patch of page an instrument is reading, as a bounding disc in page
 * coordinates.
 *
 * Two consumers need exactly this and they must agree, or the demo lies:
 * the offscreen pass that re-renders the page for the glass to sample, and
 * the LOD policy that decides which blocks get pinned to a higher tier.
 * If the framing were computed twice, the glass would eventually sample a
 * block that was never asked to sharpen.
 *
 * The radial map is monotone, so the axis and the rim bound it — but under
 * a perspective eye the incident ray varies around the rim, so the rim is
 * sampled rather than assumed circular.
 */
/**
 * Points around the edge of the glass.
 *
 * A disc is sampled just inside its rim: `landOffset` rejects points
 * outside the aperture, and `aperture·cos θ` squared and summed can round
 * a hair over `aperture²`. A rectangle needs no such margin — its edge
 * coordinates ARE the half-extents, compared against themselves — and it
 * must not have one, because the 0.1% would come off the corner, which is
 * the point the whole bound rests on.
 *
 * A rectangle gets its four corners explicitly and the rest spread along
 * the perimeter. The corners are not an optimisation: the map pushes each
 * point out along its own radius, so the corner, being furthest from the
 * axis, lands furthest out. Sampling the perimeter uniformly and hoping to
 * hit them is how a bounding disc comes back too small.
 */
function rim(spec: LensSpec, samples: number): Array<[number, number]> {
  if (!spec.half) {
    return Array.from({ length: samples }, (_, i) => {
      const a = (i / samples) * Math.PI * 2
      return [Math.cos(a) * spec.aperture * 0.999, Math.sin(a) * spec.aperture * 0.999]
    })
  }
  const hw = spec.half[0]
  const hh = spec.half[1]
  const out: Array<[number, number]> = [
    [hw, hh],
    [-hw, hh],
    [-hw, -hh],
    [hw, -hh],
  ]
  const per = 4 * (hw + hh)
  for (let i = 0; i < samples; i++) {
    let d = ((i + 0.5) / samples) * per
    if (d < 2 * hw) out.push([-hw + d, -hh])
    else if ((d -= 2 * hw) < 2 * hh) out.push([hw, -hh + d])
    else if ((d -= 2 * hh) < 2 * hw) out.push([hw - d, hh])
    else out.push([-hw, hh - (d - 2 * hw)])
  }
  return out
}

export function footprint(
  center: { x: number; y: number },
  spec: LensSpec,
  incidentAt: (lx: number, ly: number) => Vec3,
  samples = 16,
): Disc {
  const pts: Array<[number, number]> = []
  const axis = landOffset(0, 0, incidentAt(0, 0), spec)
  if (axis) pts.push(axis)
  for (const [lx, ly] of rim(spec, samples)) {
    const p = landOffset(lx, ly, incidentAt(lx, ly), spec)
    if (p) pts.push(p)
  }
  if (!pts.length) return { x: center.x, y: center.y, r: spec.aperture }

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const [x, y] of pts) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  let r = 0
  for (const [x, y] of pts) r = Math.max(r, Math.hypot(x - cx, y - cy))
  return { x: center.x + cx, y: center.y + cy, r }
}
