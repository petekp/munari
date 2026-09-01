// Marble-hand finger rig — five knuckle hinges over an unrigged scan.
//
// The law: a vertex bends with exactly one finger, at a weight that is zero
// at the knuckle and fades to zero past the finger's capsule. Where two
// fingers both fully claim a vertex, the nearer curl plane owns it, so the
// seam between neighbours never opens; a fade-band claim never outranks a
// full one, so a distant finger's fade cannot steal a tip. Every finger
// is a two-joint chain: the knuckle hinge carries a second, derived hinge
// partway down the finger, so a bend curls rather than swinging the whole
// digit as a paddle — the paddle read like a stiff toy (2026-08-31).
//
// The fault this prevents, 2026-08-31: classical-hand.stl has no skeleton,
// so the tap has to invent its own weights. A box or a sphere around each
// fingertip also catches the neighbour and the index base; bending a vertex
// away from its own neighbours tears the mesh, which reads as a crack in
// the marble and not as an animation bug. The regions below were measured
// by apps/lab/tools/find-marble-hand-fingers.mjs on 2026-08-31: the branch
// cuts sit at geodesic 140/127/113 from the sawn wrist, the curled axes
// agree to within 25 degrees of each other, and no wrist vertex scores
// above zero. The pinch pair (index and thumb) joined the same day; under
// five-hinge arbitration two web vertices cross digits, at weight 0.033.
//
// Ownership: the finder tool owns the numbers and can reprint them. This
// module owns the weight function and the baked attribute; the shader
// chunk in marbleHandTapShaders.ts owns what the GPU does with them.

import type { BufferGeometry } from 'three'
import { Float32BufferAttribute } from 'three'

export type MarbleHandFinger = 'middle' | 'ring' | 'little' | 'index' | 'thumb'

export interface MarbleHandTapHinge {
  /** Which curled finger this hinge drives. */
  finger: MarbleHandFinger
  /** Knuckle centre in model units. */
  pivot: readonly [number, number, number]
  /** Unit flexion axis; a positive angle tightens the curl. */
  axis: readonly [number, number, number]
  /** Unit direction from the knuckle down the first phalanx. */
  proximal: readonly [number, number, number]
  /** Knuckle to the farthest vertex of the finger. */
  reach: number
  /** Half-thickness of the finger across its curl plane. */
  radius: number
  /** Radial spread off the digit's own line. The pinch plane cuts across a
   *  straight digit, so its plane distance alone would fence in half the
   *  hand; only the pinch hinges need this second bound. */
  girth?: number
}

/** Vertices with no finger. Written into `aTap.x` for palm and wrist. */
export const MARBLE_HAND_TAP_NONE = -1

// The weight reaches 1 three tenths of the way down the finger, so the whole
// distal half moves as one rigid piece and only the knuckle band stretches.
// A shorter ramp creases the skin at the joint; a longer one makes the tip
// travel too little to be seen at the authored 0.69 scale.
export const MARBLE_HAND_TAP_RAMP = 0.3

// The pinned bounds are measured over the finder's branch set, and real
// digit surface sits just past them: cutting weight to zero exactly at a
// bound left weight-1 tip vertices beside weight-0 neighbours — measured
// 2026-08-31 as 48-unit spikes off the index tip (reach and radius cuts)
// and 25-unit blobs at the thumb tip (girth cut). Every bound therefore
// gets 10% headroom, so the whole digit stays at full weight, and then
// fades to zero over a band, so any non-finger surface the capsule grazes
// deforms continuously instead of tearing.
export const MARBLE_HAND_TAP_HEADROOM = 1.1
export const MARBLE_HAND_TAP_FADE = 8

/** 1 inside `edge`, easing to 0 over the fade band beyond it. */
function marbleHandTapFade(value: number, edge: number): number {
  const t = Math.min(1, Math.max(0, (value - edge) / MARBLE_HAND_TAP_FADE))
  return 1 - t * t * (3 - 2 * t)
}

/**
 * The capsule-bound factor alone (1 fully inside, 0 past every fade band).
 * Arbitration ranks a full-capsule claim above any fade-band claim: a
 * distant finger's fade can graze another digit's tip at claim 0.01, and
 * letting the nearer curl plane hand it ownership there tore the tip off.
 */
export function marbleHandTapBound(
  hinge: MarbleHandTapHinge,
  x: number, y: number, z: number,
): number {
  const dx = x - hinge.pivot[0]
  const dy = y - hinge.pivot[1]
  const dz = z - hinge.pivot[2]
  const along = dot(dx, dy, dz, hinge.proximal)
  if (along <= 0) return 0
  const headroom = MARBLE_HAND_TAP_HEADROOM
  let bound = marbleHandTapFade(Math.abs(dot(dx, dy, dz, hinge.axis)), hinge.radius * headroom)
  bound *= marbleHandTapFade(Math.hypot(dx, dy, dz), hinge.reach * headroom)
  if (hinge.girth !== undefined) {
    const rx = dx - hinge.proximal[0] * along
    const ry = dy - hinge.proximal[1] * along
    const rz = dz - hinge.proximal[2] * along
    bound *= marbleHandTapFade(Math.hypot(rx, ry, rz), hinge.girth * headroom)
  }
  return bound
}

// Printed by `node apps/lab/tools/find-marble-hand-fingers.mjs`, 2026-08-31.
// Rerun it after any rebuild of classical-hand.stl and paste the new table:
// the pivots are read from the mesh's own geodesic branch points, so an
// asset change moves them without changing anything else in this file.
export const MARBLE_HAND_TAP_HINGES: readonly MarbleHandTapHinge[] = [
  {
    finger: 'middle',
    pivot: [-87.999, -24.71, -3.161],
    axis: [0.1986, 0.55784, -0.80583],
    proximal: [0.8082, -0.54382, 0.22597],
    reach: 78.57,
    radius: 14.11,
  },
  {
    finger: 'ring',
    pivot: [-103.01, -43.34, 13.735],
    axis: [0.44942, 0.74345, -0.49528],
    proximal: [0.89519, -0.28815, 0.34002],
    reach: 73.99,
    radius: 13.47,
  },
  {
    finger: 'little',
    pivot: [-115.368, -75.042, 15.526],
    axis: [0.34626, 0.80159, -0.48739],
    proximal: [0.72329, -0.52324, -0.45063],
    reach: 53.41,
    radius: 11.96,
  },
]

// The pinch pair. The pointing index is straight, so it has no curl plane
// to read an axis from; each axis is instead the turn that carries this
// digit's tip toward the OTHER digit's tip, so a positive bend closes the
// pair. Printed by the same finder run as the table above.
export const MARBLE_HAND_PINCH_HINGES: readonly MarbleHandTapHinge[] = [
  {
    finger: 'index',
    pivot: [-85.963, -7.606, -23.696],
    axis: [-0.47426, 0.8331, -0.28466],
    proximal: [0.82556, 0.53316, 0.18492],
    reach: 89.49,
    radius: 44.44,
    girth: 44.54,
  },
  {
    finger: 'thumb',
    pivot: [-122.95, -9.813, -77.373],
    axis: [-0.08485, -0.98192, 0.16919],
    proximal: [0.83045, -0.16352, -0.53255],
    reach: 65.45,
    radius: 16.14,
    girth: 27.09,
  },
]

/** Every hinge the shader knows, in bend-uniform order: the three drummed
 *  fingers first, then the pinch pair. */
export const MARBLE_HAND_HINGES: readonly MarbleHandTapHinge[] =
  [...MARBLE_HAND_TAP_HINGES, ...MARBLE_HAND_PINCH_HINGES]

// ── the two-joint chain ───────────────────────────────────────────────

// The derived middle joint sits 45% of the way down the finger — between
// the anatomical PIP's third and the scan's fused proportions — and bends
// 0.8x the knuckle angle on top of it. Together a full tap turns the tip
// 1.8x the knuckle angle, which is why the authored lift stays modest.
export const MARBLE_HAND_CHAIN_AT = 0.45
export const MARBLE_HAND_CHAIN_GAIN = 0.8
// The distal weight ramps over the next quarter of the reach, mirroring
// MARBLE_HAND_TAP_RAMP at the knuckle: a hard start creases the joint.
export const MARBLE_HAND_CHAIN_RAMP = 0.25

/** The derived middle-joint pivot of `hinge`, in model units. */
export function marbleHandChainPivot(
  hinge: MarbleHandTapHinge,
): readonly [number, number, number] {
  const at = MARBLE_HAND_CHAIN_AT * hinge.reach
  return [
    hinge.pivot[0] + hinge.proximal[0] * at,
    hinge.pivot[1] + hinge.proximal[1] * at,
    hinge.pivot[2] + hinge.proximal[2] * at,
  ]
}

// One finger's share of a period: a slow lift, a faster fall, then a rest
// before its turn comes round again. Holding the rest is what separates a
// drum from a wobble — an envelope that fills the period reads as the hand
// breathing rather than tapping.
const TAP_LIFT = 0.35
const TAP_FALL = 0.2

// Middle, then ring, then little, each a fifth of a period behind the one
// before. The three lifts overlap, so the hand rolls once per period rather
// than knocking three separate times.
export const MARBLE_HAND_TAP_PHASE: readonly number[] = [0, 0.2, 0.4]

/**
 * Bend fraction 0..1 for a finger `phase` (0..1) through its own cycle.
 * Peaks once, returns to exactly 0, and stays there for the rest.
 */
export function marbleHandTapEnvelope(phase: number): number {
  const cycle = phase - Math.floor(phase)
  if (cycle < TAP_LIFT) {
    const rise = cycle / TAP_LIFT
    return 1 - (1 - rise) * (1 - rise)
  }
  if (cycle < TAP_LIFT + TAP_FALL) {
    const fall = (cycle - TAP_LIFT) / TAP_FALL
    return 1 - fall * fall * fall
  }
  return 0
}

function dot(
  ax: number, ay: number, az: number,
  b: readonly [number, number, number],
): number {
  return ax * b[0] + ay * b[1] + az * b[2]
}

/**
 * How much of hinge `hinge`'s bend a model-space point receives: 0 at and
 * behind the knuckle, 1 past the ramp, fading to 0 past the finger's own
 * capsule (headroom, then a band — see MARBLE_HAND_TAP_HEADROOM).
 */
export function marbleHandTapWeight(
  hinge: MarbleHandTapHinge,
  x: number, y: number, z: number,
): number {
  const bound = marbleHandTapBound(hinge, x, y, z)
  if (bound <= 0) return 0
  const along = dot(x - hinge.pivot[0], y - hinge.pivot[1], z - hinge.pivot[2], hinge.proximal)
  const ramp = Math.min(1, along / (MARBLE_HAND_TAP_RAMP * hinge.reach))
  return bound * ramp * ramp * (3 - 2 * ramp)
}

/**
 * The distal joint's share at a point: 0 before the chain pivot, 1 past
 * its ramp. Only meaningful where marbleHandTapWeight is already positive.
 */
export function marbleHandChainWeight(
  hinge: MarbleHandTapHinge,
  x: number, y: number, z: number,
): number {
  const along = dot(x - hinge.pivot[0], y - hinge.pivot[1], z - hinge.pivot[2], hinge.proximal)
  const start = MARBLE_HAND_CHAIN_AT * hinge.reach
  const ramp = Math.min(1, Math.max(0, (along - start) / (MARBLE_HAND_CHAIN_RAMP * hinge.reach)))
  return ramp * ramp * (3 - 2 * ramp)
}

/** Distance from a point to a hinge's curl plane, in model units. */
export function marbleHandTapPlaneDistance(
  hinge: MarbleHandTapHinge,
  x: number, y: number, z: number,
): number {
  return Math.abs(dot(x - hinge.pivot[0], y - hinge.pivot[1], z - hinge.pivot[2], hinge.axis))
}

/**
 * Writes the `aTap` attribute — (finger index or -1, knuckle weight,
 * distal-joint weight) per vertex — onto `geometry`, and returns it.
 * Idempotent: a second call overwrites.
 */
export function buildMarbleHandTapAttribute(
  geometry: BufferGeometry,
  hinges: readonly MarbleHandTapHinge[] = MARBLE_HAND_HINGES,
): Float32BufferAttribute {
  const positions = geometry.getAttribute('position')
  const values = new Float32Array(positions.count * 3)
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const x = positions.getX(vertex)
    const y = positions.getY(vertex)
    const z = positions.getZ(vertex)
    let owner = MARBLE_HAND_TAP_NONE
    let weight = 0
    let chain = 0
    let ownerFull = false
    let nearestPlane = Infinity
    let bestFadedClaim = 0
    for (const [order, hinge] of hinges.entries()) {
      const claim = marbleHandTapWeight(hinge, x, y, z)
      if (claim <= 0) continue
      const full = marbleHandTapBound(hinge, x, y, z) >= 1
      // A full-capsule claim always outranks a fade-band claim (see
      // marbleHandTapBound). Among full claims the nearer curl plane owns
      // the vertex, which is what keeps the web seams closed; among faded
      // claims the largest claim wins.
      if (full) {
        const plane = marbleHandTapPlaneDistance(hinge, x, y, z)
        if (ownerFull && plane >= nearestPlane) continue
        nearestPlane = plane
      } else {
        if (ownerFull || claim <= bestFadedClaim) continue
        bestFadedClaim = claim
      }
      ownerFull ||= full
      owner = order
      weight = claim
      chain = marbleHandChainWeight(hinge, x, y, z)
    }
    values[vertex * 3] = owner
    values[vertex * 3 + 1] = weight
    values[vertex * 3 + 2] = chain
  }
  const attribute = new Float32BufferAttribute(values, 3)
  attribute.name = 'aTap'
  geometry.setAttribute('aTap', attribute)
  return attribute
}

// ── the spring that moves every joint ─────────────────────────────────

export interface MarbleHandSpring {
  bend: number
  velocity: number
}

// Slightly underdamped: the fingertip overshoots its target by a few
// percent and settles, which is the difference between flesh arriving and
// a servo stopping. Critical damping (1.0) read as the old stiffness.
export const MARBLE_HAND_SPRING_HZ = 3.2
export const MARBLE_HAND_SPRING_ZETA = 0.62

/**
 * Advances one joint spring toward `target` by `stepMs`. The bend is
 * floored at zero: an undershoot below rest would unroll the scan's curl
 * and breach the page clearance the pose suite guards.
 */
export function stepMarbleHandSpring(
  spring: MarbleHandSpring,
  target: number,
  stepMs: number,
): void {
  // One long frame integrated whole would overshoot hard; slice it.
  let remaining = Math.min(stepMs, 200) / 1000
  const omega = MARBLE_HAND_SPRING_HZ * 2 * Math.PI
  while (remaining > 0) {
    const dt = Math.min(remaining, 1 / 120)
    remaining -= dt
    const acceleration = omega * omega * (target - spring.bend)
      - 2 * MARBLE_HAND_SPRING_ZETA * omega * spring.velocity
    spring.velocity += acceleration * dt
    spring.bend += spring.velocity * dt
    if (spring.bend < 0) {
      spring.bend = 0
      if (spring.velocity < 0) spring.velocity = 0
    }
  }
}
