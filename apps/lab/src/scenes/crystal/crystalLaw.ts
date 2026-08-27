// The crystal's law — a solid of glass floating over the page, and what a
// ray of light does on its way through it.
//
// Two frames, and everything here converts between exactly those two.
// SHEET space is CSS px: x right, y DOWN, z UP out of the page toward the
// viewer, origin at the sheet's top-left corner ON the page. That is the
// frame a `getBoundingClientRect` and a `pointermove` already speak, with
// one axis added. LOCAL space is the solid's own: the arrow's point is at
// x = y = 0, and z = 0 is the stone's UNDERSIDE at that point, not its
// lowest place — a pavilion hangs below it everywhere else. `rot` carries
// local into the sheet. The frame anchors the hotspot at the local origin
// and builds the view ray through it, so that point has to be on the glass;
// `hotspotDrop` is what puts it there.
//
// The law: what you click is what you SEE. The page is not displaced by a
// screen-space offset — it is seen THROUGH a cut solid, and the ray that
// reaches the eye entered a crown facet, bounced around inside until enough
// of it got out, and crossed the gap underneath. `traceCrystal` is that
// path. A click has to be corrected by the same path or it lands somewhere
// the viewer never looked.
//
// The picture can superimpose every exit; a pointer has to name ONE page
// pixel. So `traceCrystal` returns the first DOWNWARD exit — the ray that
// crossed the stone once — and falls back to a bounced one only where that
// path does not exist. Measured 2026-08-26 over the 7,319 pixels the crystal
// covers at the committed cut: all 7,319 have a direct path, and none of
// them misses the solid. The fallback is dead code here and stays because
// the cut is a knob — at a real brilliant's 34/41 it takes over, where 2,890
// of the same rays find no exit at all and a quarter of the rest bounce.
//
// The fault this file exists to guard, and the reason `crystalLaw.test.ts`
// pins every function below against the GLSL: the two copies can drift
// while the PICTURE stays correct, because the shader is the one drawing.
// Only the click goes wrong. It is invisible in review, invisible in a
// screenshot, and arrives as "this demo feels broken" with nothing to see.
//
// Ownership: shape, optics and physics as pure functions. Pixels are
// `crystalShaders.ts`, numbers are `crystalTuning.ts`, the mount is
// `Crystal.tsx`.

import type { CrystalTuning } from './crystalTuning'

export type Vec3 = readonly [number, number, number]

// ── the arrow ──────────────────────────────────────────────────────────

/**
 * The pointer, as seven points, tip at the origin and y running DOWN.
 *
 * The proportions every desktop has shipped since 1984: a long left edge, a
 * notch, a tail kicked out to the right, a shoulder back to the tip. Sixteen
 * units wide and 26.5 tall.
 *
 * Transcribed vertex for vertex into `ARROW_GLSL`. The two are one shape and
 * the test pins them to the same distances.
 */
export const ARROW: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 24],
  [5.5, 18.5],
  [9, 26.5],
  [12.5, 25],
  [9, 17],
  [16, 17],
]

/**
 * The direction the arrow's mass hangs from its tip, unit length.
 *
 * The vertex average rather than the area centroid: it is a pendulum's rest
 * axis and not an inertia calculation, and the two differ by less than the
 * spin knob's own step.
 */
export const ARROW_AXIS: readonly [number, number] = (() => {
  let sx = 0
  let sy = 0
  for (const [x, y] of ARROW) {
    sx += x
    sy += y
  }
  const m = Math.hypot(sx, sy) || 1
  return [sx / m, sy / m] as const
})()

/**
 * Signed distance to the arrow polygon, in polygon units. Negative inside.
 *
 * A crossing count taken from three comparisons, flipped when all three
 * agree or all three disagree. Exact for any simple polygon, convex or not
 * — and the arrow is not convex. The notch between the shoulder and the
 * tail is the whole reason a rounded-rect field could not be reused here.
 */
export function sdArrowPolygon(x: number, y: number): number {
  const n = ARROW.length
  let d = (x - ARROW[0][0]) ** 2 + (y - ARROW[0][1]) ** 2
  let s = 1
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const ex = ARROW[j][0] - ARROW[i][0]
    const ey = ARROW[j][1] - ARROW[i][1]
    const wx = x - ARROW[i][0]
    const wy = y - ARROW[i][1]
    const t = Math.min(1, Math.max(0, (wx * ex + wy * ey) / (ex * ex + ey * ey)))
    const bx = wx - ex * t
    const by = wy - ey * t
    d = Math.min(d, bx * bx + by * by)
    const c1 = y >= ARROW[i][1]
    const c2 = y < ARROW[j][1]
    const c3 = ex * wy > ey * wx
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s
  }
  return s * Math.sqrt(d)
}

// ── the solid ──────────────────────────────────────────────────────────

/**
 * The arrow's outline before the edges are rolled, LOCAL px, negative inside.
 *
 * The widest the stone gets is this field's `girdlePx` isoline, not its
 * zero — every facet in `sdCrystal` springs from that offset — so the
 * glass reaches `roundPx + girdlePx` past the polygon on every side.
 *
 * The CHAMFER is what makes the bend at the hotspot mean anything. Measured
 * 2026-08-25 on the flat version of this scene: at a sharp vertex the bend
 * was 8.37px and a +/-2px tremor moved it 10.65px, so the click target
 * travelled further than the correction it was being corrected by. Rounding
 * did not fix it — the ratio held at 1.27 across every radius from 2 to 60,
 * because a polygon vertex is a singular point of its own distance field and
 * the gradient rotates through the whole exterior angle no matter how far
 * away the outline is put. Cutting a flat face across the point puts the
 * hotspot under a HALF-PLANE instead, whose gradient is constant. It is also
 * what a crystal ground into this shape would look like.
 */
export function sdInner2(x: number, y: number, t: CrystalTuning): number {
  const poly = sdArrowPolygon(x / t.scalePx, y / t.scalePx) * t.scalePx
  // The half-plane the chamfer keeps, square across the arrow's own axis.
  // Intersection is a max: exact outside, conservative inside, and the
  // conservative side is the one that only ever understates a step.
  const cut = t.chamferPx - (x * ARROW_AXIS[0] + y * ARROW_AXIS[1])
  return Math.max(poly, cut) - t.roundPx
}

/**
 * The solid itself, LOCAL space, negative inside — a brilliant cut swept
 * along the arrow's own outline.
 *
 * Five surfaces. From the page up: a KEEL where the pavilion facets would
 * meet — 233.7px in from the girdle at the committed cut, so on a 76px-wide
 * arrow they never do and it is unreachable — a
 * PAVILION tilted `pavilionDeg` and running up to the widest point, a
 * vertical GIRDLE band `girdleThickPx` tall, a CROWN of facets tilted
 * `crownDeg` back inward, and a flat TABLE on top. Offsetting the outline
 * inward is what turns those into facets that follow the arrow, so the
 * arrow's own medial axis becomes the crest above and the keel below — a
 * ridge down the shaft and a peak under the head.
 *
 * The crown is what makes the arrow a lens at all. A slab with parallel
 * faces DEVIATES NOTHING at normal incidence, so the flat-topped version of
 * this solid was a window over its whole interior: measured 2026-08-25, the
 * median displacement over its interior pixels was 2.7px against 21.2 at
 * the hotspot, and on screen that read as grey plastic.
 *
 * The pavilion is what makes it a STONE rather than a lens. A ray that has
 * crossed the crown meets the pavilion from inside, where index 1.58 puts
 * the critical angle at 39.27 degrees, so a steep pavilion mirrors instead
 * of transmitting. The ray crosses to the far side, bounces again, and
 * leaves through the crown carrying a piece of the page from somewhere else
 * entirely. `traceCrystal` follows that zigzag; a single pass down through a
 * flat bottom cannot produce it at any angle. The committed cut stops 2.27
 * degrees short of the line, so what bounces is the picture's business and
 * the pointer takes the direct path everywhere.
 *
 * Every term is a half-space in the (`sdInner2`, z) plane and they are
 * combined with `max`. That is an INTERSECTION, and for an intersection the
 * true distance is never less than the largest of the parts — so this only
 * ever understates, which is the direction a marcher can survive. Each term
 * is itself Lipschitz-1: a facet's gradient has magnitude `sin(a)` across
 * and `cos(a)` up, and `sdInner2`'s own gradient is a unit vector, so no
 * step-size fudge is needed anywhere. It also leaves every facet edge
 * SHARP, which is correct — a cut stone's girdle is an edge, not a fillet.
 */
export function sdCrystal(q: Vec3, t: CrystalTuning): number {
  const d2 = sdInner2(q[0], q[1], t) - t.girdlePx
  const drop = hotspotDrop(t)
  const zg0 = t.pavilionPx - drop
  const zg1 = zg0 + t.girdleThickPx
  const ac = (t.crownDeg * Math.PI) / 180
  const ap = (t.pavilionDeg * Math.PI) / 180
  const crown = d2 * Math.sin(ac) + (q[2] - zg1) * Math.cos(ac)
  const pavilion = d2 * Math.sin(ap) - (q[2] - zg0) * Math.cos(ap)
  const table = q[2] - (zg1 + t.crownPx)
  const culet = -drop - q[2]
  return Math.max(Math.max(d2, culet), Math.max(Math.max(crown, pavilion), table))
}

/** The crown's height above the hotspot, at a given `sdInner2`. */
export function topAt(d2: number, t: CrystalTuning): number {
  const zg1 = t.pavilionPx + t.girdleThickPx - hotspotDrop(t)
  const a = (t.crownDeg * Math.PI) / 180
  return Math.min(zg1 - (d2 - t.girdlePx) * Math.tan(a), zg1 + t.crownPx)
}

/**
 * The pavilion's height above the page, at a given `sdInner2`.
 *
 * The counterpart `topAt` needed once the bottom stopped being flat. The
 * light chain refracts against this plane on its way out, and clamping at
 * zero is the culet — past the point where the facets have converged there
 * is no more stone to cross.
 */
export function bottomAt(d2: number, t: CrystalTuning): number {
  const drop = hotspotDrop(t)
  const a = (t.pavilionDeg * Math.PI) / 180
  return Math.max(t.pavilionPx + (d2 - t.girdlePx) * Math.tan(a), 0) - drop
}

/**
 * How far the stone's underside at the arrow's own point sits above its
 * keel, px — the shift that puts LOCAL z = 0 on the hotspot.
 *
 * The frame anchors the hotspot at local (0, 0, 0) and the view ray is built
 * to pass through it, so that point has to be ON the glass. It was, while
 * the bottom was a flat face at z = 0. A pavilion lifts the underside off
 * the keel everywhere except along the medial axis, and the arrow's point is
 * the furthest place on the stone from that axis: measured 2026-08-25 at
 * pavilionDeg 30, the underside under the tip sat 28px above the keel, so
 * the anchor floated in mid-air below the glass. Straight down that still
 * hit — the ray passed up through the stone anyway — but at the right of the
 * screen the line of sight is 11 degrees off vertical, which walked it 7px
 * sideways out past the point, and the hotspot's own correction reported a
 * miss.
 *
 * `sdInner2` at the tip is exactly `chamferPx - roundPx`, because the
 * chamfer's half-plane passes through the origin.
 */
export function hotspotDrop(t: CrystalTuning): number {
  const a = (t.pavilionDeg * Math.PI) / 180
  return Math.max(t.pavilionPx + (t.chamferPx - t.roundPx - t.girdlePx) * Math.tan(a), 0)
}

/**
 * Half-width of the central difference the surface normal is built from, px.
 *
 * The shader takes the gradient the same way with the same number, rather
 * than analytically. Matching an approximation exactly is worth more here
 * than matching an exact thing approximately: the two copies have to agree
 * by construction, not within a tolerance somebody later widens.
 */
export const GRAD_EPS = 0.5

export function normalAt(q: Vec3, t: CrystalTuning): Vec3 {
  const e = GRAD_EPS
  const nx = sdCrystal([q[0] + e, q[1], q[2]], t) - sdCrystal([q[0] - e, q[1], q[2]], t)
  const ny = sdCrystal([q[0], q[1] + e, q[2]], t) - sdCrystal([q[0], q[1] - e, q[2]], t)
  const nz = sdCrystal([q[0], q[1], q[2] + e], t) - sdCrystal([q[0], q[1], q[2] - e], t)
  const m = Math.max(Math.hypot(nx, ny, nz), 1e-9)
  return [nx / m, ny / m, nz / m]
}

// ── where the crystal is ───────────────────────────────────────────────

/**
 * The pose the shader draws and the pointer corrects against.
 *
 * `rot` is a full rotation rather than the angles it was built from, and it
 * is built HERE and uploaded as a matrix. Two copies of a rotation are two
 * chances to disagree about multiplication order, and that disagreement is
 * silent: the crystal is drawn correctly by the copy that draws.
 *
 * The tip is never integrated. It IS the pointer, and a cursor drawing its
 * point somewhere its own hand has not reached reports a position the
 * operating system disagrees with. Only the mass behind it may lag.
 */
export interface CrystalFrame {
  /** The hotspot, sheet px, and the height the bottom face floats at. */
  tipX: number
  tipY: number
  tipZ: number
  /** Local -> sheet, 3x3 COLUMN-major (THREE.Matrix3's own order). */
  rot: number[]
}

export const REST_FRAME: CrystalFrame = {
  tipX: 0,
  tipY: 0,
  tipZ: 0,
  rot: [1, 0, 0, 0, 1, 0, 0, 0, 1],
}

/** Sheet point -> local. `rot` is orthonormal, so the inverse is a transpose. */
export function toLocal(p: Vec3, f: CrystalFrame): Vec3 {
  const x = p[0] - f.tipX
  const y = p[1] - f.tipY
  const z = p[2] - f.tipZ
  const r = f.rot
  return [
    r[0] * x + r[1] * y + r[2] * z,
    r[3] * x + r[4] * y + r[5] * z,
    r[6] * x + r[7] * y + r[8] * z,
  ]
}

/** Local direction -> sheet. */
export function toSheetDir(d: Vec3, f: CrystalFrame): Vec3 {
  const r = f.rot
  return [
    r[0] * d[0] + r[3] * d[1] + r[6] * d[2],
    r[1] * d[0] + r[4] * d[1] + r[7] * d[2],
    r[2] * d[0] + r[5] * d[1] + r[8] * d[2],
  ]
}

/** Local point -> sheet. */
export function toSheet(q: Vec3, f: CrystalFrame): Vec3 {
  const d = toSheetDir(q, f)
  return [d[0] + f.tipX, d[1] + f.tipY, d[2] + f.tipZ]
}

/** Local direction -> sheet, transposed: sheet direction -> local. */
export function toLocalDir(d: Vec3, f: CrystalFrame): Vec3 {
  const r = f.rot
  return [
    r[0] * d[0] + r[1] * d[1] + r[2] * d[2],
    r[3] * d[0] + r[4] * d[1] + r[5] * d[2],
    r[6] * d[0] + r[7] * d[1] + r[8] * d[2],
  ]
}

// ── the ray ────────────────────────────────────────────────────────────

/** How close to the surface a march has to get before it counts, px. */
/**
 * The direction the light TRAVELS, sheet space, from the two angles.
 *
 * Sheet y runs down the screen, so an azimuth of 45 degrees carries the light
 * to the right and downward — light coming over the viewer's left shoulder.
 */
export function lightDirOf(t: CrystalTuning): Vec3 {
  const a = (t.lightAzimuthDeg * Math.PI) / 180
  const e = (t.lightElevationDeg * Math.PI) / 180
  return [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), -Math.sin(e)]
}

export const MARCH_EPS = 0.15

/** Steps allowed on each leg. Two legs: in through the top, out the bottom. */
export const MARCH_STEPS = 96

/** The sphere the whole solid fits in: centre and radius, LOCAL px. */
export interface CrystalBounds {
  c: Vec3
  r: number
}

/**
 * The sphere the whole solid fits in, LOCAL space.
 *
 * A ray that misses this misses the crystal, and that test is what keeps the
 * march off almost every pixel of the sheet.
 */
export function boundsOf(t: CrystalTuning): CrystalBounds {
  const halfW = 8 * t.scalePx
  const halfH = 13.25 * t.scalePx
  const pad = t.roundPx + t.girdlePx
  const h = t.pavilionPx + t.girdleThickPx + t.crownPx
  const halfZ = h / 2
  return {
    c: [halfW, halfH, halfZ - hotspotDrop(t)],
    r: Math.hypot(halfW + pad, halfH + pad, halfZ),
  }
}

/** Distance to the near intersection with that sphere, or -1 for a miss. */
export function sphereEntry(o: Vec3, d: Vec3, c: Vec3, r: number): number {
  const ox = o[0] - c[0]
  const oy = o[1] - c[1]
  const oz = o[2] - c[2]
  const b = ox * d[0] + oy * d[1] + oz * d[2]
  const cc = ox * ox + oy * oy + oz * oz - r * r
  const h = b * b - cc
  if (h < 0) return -1
  const s = Math.sqrt(h)
  const near = -b - s
  const far = -b + s
  if (far < 0) return -1
  return Math.max(near, 0)
}

/**
 * `refract` from GLSL, spelled out so the two copies are the same
 * arithmetic and not the same intention. `n` must oppose `i`. Returns null
 * past the critical angle, which is total internal reflection and is the
 * right answer rather than a case to guard.
 */
export function refract(i: Vec3, n: Vec3, eta: number): Vec3 | null {
  const ndi = i[0] * n[0] + i[1] * n[1] + i[2] * n[2]
  const k = 1 - eta * eta * (1 - ndi * ndi)
  if (k < 0) return null
  const g = eta * ndi + Math.sqrt(k)
  return [eta * i[0] - g * n[0], eta * i[1] - g * n[1], eta * i[2] - g * n[2]]
}

/**
 * `reflect` from GLSL, spelled out for the same reason `refract` is. `n`
 * must be unit; `i` may be on either side of it.
 */
export function reflect(i: Vec3, n: Vec3): Vec3 {
  const k = 2 * (i[0] * n[0] + i[1] * n[1] + i[2] * n[2])
  return [i[0] - k * n[0], i[1] - k * n[1], i[2] - k * n[2]]
}

/**
 * How much of the light hitting a surface from INSIDE bounces back, 0..1.
 *
 * Schlick's approximation, evaluated on the transmitted ray's angle rather
 * than the incident one. That is the form that holds going from dense to
 * rare: the approximation is written around the angle in the rarer medium,
 * and using the internal angle instead reports a mirror as a window right
 * where the mirror matters most. Past the critical angle there is no
 * transmitted ray and the answer is 1, which `traceCrystal` handles by
 * `refract` returning null rather than by calling this.
 */
export function schlick(cosOut: number, ior: number): number {
  const f0 = ((ior - 1) / (ior + 1)) ** 2
  const c = 1 - Math.min(Math.max(cosOut, 0), 1)
  return f0 + (1 - f0) * c ** 5
}

/**
 * How many surfaces a ray may cross before the rest of its light is
 * abandoned inside the stone.
 *
 * A brilliant's signature path is crown in, pavilion, pavilion, crown out —
 * four. Rays still carrying light after that are the ones bouncing along
 * the thin shaft, and what they carry is below the weight cutoff anyway.
 */
export const MAX_BOUNCES = 4

/** Light left after which a path stops being followed. */
export const WEIGHT_FLOOR = 0.02

export interface CrystalHit {
  /** Where the strongest exit lands on the page, sheet px. */
  x: number
  y: number
  /** The outward surface normal where it entered, SHEET space, unit. */
  n: Vec3
  /** How far that path travelled inside the glass, px — dispersion's lever. */
  through: number
  /** Its share of the entering light, 0..1. */
  weight: number
  /** How many surfaces it crossed on the way. 0 is straight through. */
  bounces: number
}

/**
 * One ray of sight, from the eye to whatever page pixel it ends on.
 *
 * The ray enters through a facet and then BOUNCES. At each surface it meets
 * from inside, Snell either lets a share through or, past the critical
 * angle, hands the whole thing back — and either way the remainder reflects
 * and keeps going, up to `MAX_BOUNCES` segments. Beer's law drains the
 * weight over the distance travelled. Every exit that heads down at the
 * page is a place this pixel could have come from.
 *
 * The picture superimposes all of them; a POINTER cannot. It has to name
 * one page pixel, so this returns the heaviest exit — the one carrying the
 * most of the light, which is the one a viewer reads the object as showing.
 * `crystalLaw.test.ts` pins that the choice is stable under a hand tremor,
 * because a correction that swapped between two exits as the hand shook
 * would be worse than no correction at all.
 *
 * Total internal reflection at the last allowed segment is a dead end and
 * the ray is dropped, which is honest: that light really does stay in the
 * stone as far as this trace knows.
 *
 * `dir` must be unit and must point away from the eye.
 */
export function traceCrystal(
  eye: Vec3,
  dir: Vec3,
  f: CrystalFrame,
  t: CrystalTuning,
): CrystalHit | null {
  const o = toLocal(eye, f)
  const d = toLocalDir(dir, f)
  const { c, r } = boundsOf(t)

  let s = sphereEntry(o, d, c, r)
  if (s < 0) return null

  // In from outside: the field is positive here, so a step of its own value
  // can never pass through the surface.
  let hit = false
  for (let i = 0; i < MARCH_STEPS; i++) {
    const p: Vec3 = [o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s]
    const sd = sdCrystal(p, t)
    if (sd < MARCH_EPS) {
      hit = true
      break
    }
    s += sd
    if (s > 2 * r + Math.hypot(o[0] - c[0], o[1] - c[1], o[2] - c[2])) break
  }
  if (!hit) return null

  const p0: Vec3 = [o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s]
  const n0 = normalAt(p0, t)
  const ior = Math.max(t.ior, 1)
  const inside = refract(d, n0, 1 / ior)
  if (!inside) return null

  const flatT = eye[2] / -dir[2]
  const fx = eye[0] + dir[0] * flatT
  const fy = eye[1] + dir[1] * flatT

  let pos = p0
  let ray = inside
  let weight = 1
  let path = 0
  let bx = 0
  let by = 0
  let bw = 0
  let bThrough = 0
  let bBounces = 0

  for (let b = 0; b < MAX_BOUNCES; b++) {
    // Out from inside: the field is negative in here, so the step is its
    // magnitude. Started clear of the surface it just left, or the first
    // step is zero and the march never moves.
    let u = MARCH_EPS * 4
    let out = false
    for (let i = 0; i < MARCH_STEPS; i++) {
      const p: Vec3 = [pos[0] + ray[0] * u, pos[1] + ray[1] * u, pos[2] + ray[2] * u]
      const sd = sdCrystal(p, t)
      if (sd > -MARCH_EPS) {
        out = true
        break
      }
      u -= sd
      if (u > 4 * r) break
    }
    if (!out) break

    const p1: Vec3 = [pos[0] + ray[0] * u, pos[1] + ray[1] * u, pos[2] + ray[2] * u]
    path += u
    weight *= Math.exp((-t.absorbPer100 * 0.01) * u)
    const n1 = normalAt(p1, t)
    const leaving = refract(ray, [-n1[0], -n1[1], -n1[2]], ior)

    if (leaving) {
      const cosOut = leaving[0] * n1[0] + leaving[1] * n1[1] + leaving[2] * n1[2]
      const back = schlick(cosOut, ior)
      const w = weight * (1 - back)
      const away = toSheetDir(leaving, f)
      // Down toward the page, or it never lands on one.
      if (away[2] < -1e-6 && bw <= 0) {
        const exit = toSheet(p1, f)
        const travel = exit[2] / -away[2]
        bx = exit[0] + away[0] * travel
        by = exit[1] + away[1] * travel
        bw = w
        bThrough = path
        bBounces = b
      }
      weight *= back
    }

    if (weight < WEIGHT_FLOOR) break
    ray = reflect(ray, n1)
    pos = p1
  }

  if (bw <= 0) return null

  // Against where the ray WOULD have landed with no glass in the way, so
  // the cap is on the displacement and not on a position.
  let dx = bx - fx
  let dy = by - fy
  const m = Math.hypot(dx, dy)
  if (m > t.maxBendPx) {
    dx = (dx / m) * t.maxBendPx
    dy = (dy / m) * t.maxBendPx
  }

  return {
    x: fx + dx,
    y: fy + dy,
    n: toSheetDir(n0, f),
    through: bThrough,
    weight: bw,
    bounces: bBounces,
  }
}

/**
 * How far the page under a point of the sheet is displaced, CSS px.
 *
 * Zero where the crystal is not, so a caller may ask about any point. The
 * ray is built from the EYE and not straight down, because the camera is a
 * perspective one: at the edge of a 1280px viewport the line of sight is
 * about 20 degrees off vertical, which is more than enough to move which
 * key a click lands on.
 */
export function bendAt(
  x: number,
  y: number,
  f: CrystalFrame,
  t: CrystalTuning,
  eye: Vec3,
): [number, number] {
  const dx = x - eye[0]
  const dy = y - eye[1]
  const dz = -eye[2]
  const m = Math.max(Math.hypot(dx, dy, dz), 1e-9)
  const hit = traceCrystal(eye, [dx / m, dy / m, dz / m], f, t)
  if (!hit) return [0, 0]
  return [hit.x - x, hit.y - y]
}

/**
 * Where the tip has to BE so that it is drawn where the hand is.
 *
 * The hand reports a point on the screen, and the tip floats `liftPx` above
 * the page — so putting the tip at the hand's own page coordinate draws it
 * somewhere else. The camera is a perspective one, and everything nearer
 * than the page is magnified about the screen's centre: at `liftPx = 40` on
 * a 1280px viewport that is 3.7%, which is nothing in the middle and 20px
 * of daylight between the point and the cursor at the edge.
 *
 * So the tip is placed on the ray the hand is looking down, at the height it
 * floats at. Its screen position is then the hand's, exactly, everywhere.
 */
export function tipPlanePoint(
  screenX: number,
  screenY: number,
  eye: Vec3,
  liftZ: number,
): [number, number] {
  const s = (eye[2] - liftZ) / eye[2]
  return [eye[0] + (screenX - eye[0]) * s, eye[1] + (screenY - eye[1]) * s]
}

/**
 * Where the tip is DRAWN — the inverse of `tipPlanePoint`.
 *
 * The pointer's hotspot is the tip, so this is the screen point the hotspot
 * appears at, which trails the hand by however far it moved since the last
 * frame.
 */
export function tipScreenPoint(f: CrystalFrame, eye: Vec3): [number, number] {
  const s = eye[2] / Math.max(eye[2] - f.tipZ, 1e-9)
  return [eye[0] + (f.tipX - eye[0]) * s, eye[1] + (f.tipY - eye[1]) * s]
}

// ── the hand ───────────────────────────────────────────────────────────

/** The tip, plus the lagging mass that decides how the body is thrown. */
export interface CrystalPose {
  tipX: number
  tipY: number
  /** The mass, px. A spring-damper follower of the tip. */
  bodyX: number
  bodyY: number
  /** Its velocity, px/s. */
  vx: number
  vy: number
}

export function makePose(x = 0, y = 0): CrystalPose {
  return { tipX: x, tipY: y, bodyX: x, bodyY: y, vx: 0, vy: 0 }
}

/**
 * One step of the follower, semi-implicit Euler.
 *
 * `dt` is clamped because a backgrounded tab hands back a whole second at
 * once, and this spring integrated over a second in one step throws the
 * mass off the screen and never recovers.
 */
export function stepCrystal(
  pose: CrystalPose,
  tipX: number,
  tipY: number,
  dt: number,
  t: CrystalTuning,
): void {
  pose.tipX = tipX
  pose.tipY = tipY
  const h = Math.min(Math.max(dt, 0), 1 / 30)
  const ax = t.followK * (tipX - pose.bodyX) - t.followD * pose.vx
  const ay = t.followK * (tipY - pose.bodyY) - t.followD * pose.vy
  pose.vx += ax * h
  pose.vy += ay * h
  pose.bodyX += pose.vx * h
  pose.bodyY += pose.vy * h
}

/**
 * The pose, read as the rotation and translation the solid is drawn with.
 *
 * The lag vector points the way the hand is going, because the mass is
 * behind it, and it drives two rotations. SPIN is the pendulum's own torque
 * about the page's normal — the cross product of the arrow's rest axis with
 * the lag — so the tail swings OUT of a turn rather than into it. TILT rocks
 * the whole solid out of the page about the axis across the direction of
 * travel, so a flick to the right lifts the left flank and the eye sees
 * under it.
 *
 * That is why acceleration is legible here at all: a constant velocity
 * settles the spring and the crystal comes back level, so what the
 * deformation shows is the change and not the speed.
 */
export function frameOf(pose: CrystalPose, t: CrystalTuning, eye: Vec3): CrystalFrame {
  let lx = pose.tipX - pose.bodyX
  let ly = pose.tipY - pose.bodyY
  const raw = Math.hypot(lx, ly)
  const mag = Math.min(raw, t.maxLagPx)
  if (raw > 1e-6) {
    lx = (lx / raw) * mag
    ly = (ly / raw) * mag
  } else {
    lx = 0
    ly = 0
  }

  // Per 100px of lag, so both knobs read as degrees at a hard flick rather
  // than as coefficients nobody can picture.
  const cross = ARROW_AXIS[0] * ly - ARROW_AXIS[1] * lx
  const spin = ((cross / 100) * t.spinPerLag * Math.PI) / 180
  const tilt = ((mag / 100) * t.tiltPerLag * Math.PI) / 180
  // Across the travel, and in the sense that lifts the trailing flank.
  const ax = mag > 1e-6 ? -ly / mag : 0
  const ay = mag > 1e-6 ? lx / mag : 0

  // The pose is kept in the coordinates the hand reports, which are a point
  // on the PAGE. The tip is lifted onto the plane it actually floats on
  // here, so the whole rest of the file can work in one frame.
  const [tx, ty] = tipPlanePoint(pose.tipX, pose.tipY, eye, t.liftPx)
  return {
    tipX: tx,
    tipY: ty,
    tipZ: t.liftPx,
    rot: rockThenSpin(ax, ay, tilt, spin),
  }
}

/**
 * The solid's rotation: spun about its own normal, then rocked about an axis
 * lying in the page.
 *
 * That order and not the other one. The rock's axis is fixed in the SHEET —
 * it is across the direction the hand is travelling — so it has to be
 * applied in the sheet's frame, which means last. Applied first it would be
 * carried around by the spin and the crystal would rock about whichever way
 * its own tail happened to be pointing.
 *
 * Column-major, which is what `THREE.Matrix3.fromArray` reads.
 */
export function rockThenSpin(
  ax: number,
  ay: number,
  tilt: number,
  spin: number,
): number[] {
  const cs = Math.cos(spin)
  const ss = Math.sin(spin)
  // Rz(spin), column-major.
  const z = [cs, ss, 0, -ss, cs, 0, 0, 0, 1]

  // Rodrigues about (ax, ay, 0), column-major.
  const c = Math.cos(tilt)
  const s = Math.sin(tilt)
  const k = 1 - c
  const a = [
    c + ax * ax * k,
    ax * ay * k,
    -ay * s,
    ax * ay * k,
    c + ay * ay * k,
    ax * s,
    ay * s,
    -ax * s,
    c,
  ]

  // a * z, column-major: out[col*3 + row] = sum_i a[i*3 + row] * z[col*3 + i]
  const out = new Array<number>(9)
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      out[col * 3 + row] =
        a[row] * z[col * 3] + a[3 + row] * z[col * 3 + 1] + a[6 + row] * z[col * 3 + 2]
    }
  }
  return out
}
