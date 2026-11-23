// Review-note law — where a note's paper stands on the teapot body.
//
// The law: a note keeps its own size on the body. Its rows follow the
// body's profile by arc length and its columns follow each row's
// circumference by arc length, so a 232 px note is still 232 px of glaze
// wide at every row. Wrapping by angle alone would stretch the narrow
// shoulder rows and squeeze the belly ones.
//
// Ownership: this file owns the teapot's profile and the three poses a
// note passes through — flat in front of the camera, wrapped on the body,
// and peeling off it. The presenter blends them per vertex; the page
// owns the note's content.

import * as THREE from 'three'

// ── the teapot ────────────────────────────────────────────────────────

/** Profile of the glazed body, (radius, height) in px from the foot. */
const BODY_CONTROL: readonly (readonly [number, number])[] = [
  [128, 14], [150, 38], [178, 82], [194, 132], [190, 184], [172, 230], [142, 268], [112, 292], [100, 300],
]
/** The unglazed foot ring below the body. */
export const FOOT_PROFILE: readonly (readonly [number, number])[] = [
  [0, 0], [118, 0], [124, 3], [127, 9], [128, 14],
]
/** The lid, sitting in the neck with a 2 px gap. */
export const LID_PROFILE: readonly (readonly [number, number])[] = [
  [94, 296], [102, 302], [98, 310], [80, 326], [52, 338], [22, 343], [0, 344],
]
export const KNOB_PROFILE: readonly (readonly [number, number])[] = [
  [0, 343], [16, 344], [22, 352], [20, 362], [12, 368], [0, 370],
]

const PROFILE_SAMPLES = 96

export interface BodyProfile {
  readonly points: readonly THREE.Vector2[]
  /** Cumulative arc length at each point, from the foot up. */
  readonly s: readonly number[]
  readonly length: number
}

function buildProfile(): BodyProfile {
  const curve = new THREE.SplineCurve(BODY_CONTROL.map(([r, y]) => new THREE.Vector2(r, y)))
  const points = curve.getPoints(PROFILE_SAMPLES)
  const s = [0]
  for (let i = 1; i < points.length; i++) s.push(s[i - 1] + points[i].distanceTo(points[i - 1]))
  return { points, s, length: s[s.length - 1] }
}

export const BODY = buildProfile()

/** One row of the body: its radius, its height, and its outward normal (nr, ny). */
export interface BodyRow { r: number; y: number; nr: number; ny: number }

/** The body's row at profile arc length `s`. */
export function bodyAt(s: number, profile: BodyProfile = BODY): BodyRow {
  const { points, s: arc } = profile
  const clamped = THREE.MathUtils.clamp(s, 0, profile.length)
  let i = 1
  while (i < arc.length - 1 && arc[i] < clamped) i++
  const a = points[i - 1], b = points[i]
  const t = (clamped - arc[i - 1]) / Math.max(1e-6, arc[i] - arc[i - 1])
  const dr = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dr, dy) || 1
  // The profile runs upward, so the outward normal is the tangent turned clockwise.
  return { r: a.x + dr * t, y: a.y + dy * t, nr: dy / len, ny: -dr / len }
}

/** Profile arc length at body height `y` (the body rises monotonically). */
export function bodyArcAtHeight(y: number, profile: BodyProfile = BODY): number {
  const { points, s } = profile
  if (y <= points[0].y) return 0
  for (let i = 1; i < points.length; i++) {
    if (points[i].y >= y) {
      const t = (y - points[i - 1].y) / Math.max(1e-6, points[i].y - points[i - 1].y)
      return s[i - 1] + (s[i] - s[i - 1]) * t
    }
  }
  return profile.length
}

// ── where a note may stick ────────────────────────────────────────────

/** A note's centre on the body: azimuth (0 faces the camera at rest) and profile arc length. */
export interface BodyAnchor { theta: number; s: number }

/** Each later note lies this much higher than the one under it, px, so two
 *  notes that overlap stack like paper instead of fighting for depth. */
export const PAPER_STACK = 0.9

/** Paper stands this far off the glaze, px. Enough to clear depth precision
 *  at a 1.7 k px camera distance without reading as a gap. */
export const PAPER_LIFT = 1.6

/** Keep a note's top and bottom rows on the glazed belly, off the foot and the neck. */
export function clampAnchor(anchor: BodyAnchor, noteHeight: number): BodyAnchor {
  const margin = noteHeight / 2 + 14
  return { theta: anchor.theta, s: THREE.MathUtils.clamp(anchor.s, margin + 10, BODY.length - margin - 12) }
}

/**
 * The teapot stands this many times its modelled size, so a note keeps its
 * page size in px while covering less of the belly: 232 px of paper on a
 * 388 px body left no room for a third note beside two others.
 */
export const TEAPOT_SCALE = 1.25

/** A note's footprint on the body, in the teapot's own units. */
export const onBody = (px: number) => px / TEAPOT_SCALE

/** Paper between two notes that sit side by side, px of glaze. */
const NOTE_GAP = 10

/**
 * The nearest anchor to `wanted` where a W×H note covers none of `others`,
 * searched around and up and down the belly by distance in px of glaze.
 * Paper goes where the hand puts it unless that hides a colleague's note.
 * Returns `wanted` when the belly is full.
 */
export function freeAnchor(wanted: BodyAnchor, others: readonly BodyAnchor[], w: number, h: number): BodyAnchor {
  const covers = (a: BodyAnchor) => others.some(o => {
    if (Math.abs(o.s - a.s) >= h + NOTE_GAP) return false
    // Only rows both notes cover can collide; the narrowest of them, where a
    // note's width takes the most angle, is at one end of that band.
    const low = Math.max(o.s, a.s) - h / 2
    const high = Math.min(o.s, a.s) + h / 2
    const r = Math.min(bodyAt(low).r, bodyAt(high).r)
    return Math.abs(Math.atan2(Math.sin(a.theta - o.theta), Math.cos(a.theta - o.theta))) * r < w + NOTE_GAP
  })
  if (!covers(wanted)) return wanted
  const r = bodyAt(wanted.s).r
  let best: BodyAnchor | null = null
  let bestDistance = Infinity
  for (let ds = -h; ds <= h; ds += 8) {
    const s = clampAnchor({ theta: 0, s: wanted.s + ds }, h).s
    for (let step = 0; step * 6 < Math.PI * r; step++) {
      for (const sign of [1, -1]) {
        const candidate = { theta: wanted.theta + (sign * step * 6) / r, s }
        const distance = Math.hypot(step * 6, s - wanted.s)
        if (distance >= bestDistance) break
        if (!covers(candidate)) { best = candidate; bestDistance = distance }
      }
    }
  }
  return best ?? wanted
}

const _p = new THREE.Vector3()

/** Where content point (x, y) of a W×H note stands when wrapped at `anchor`, in teapot space. */
export function wrappedPoint(x: number, y: number, w: number, h: number, anchor: BodyAnchor, out: THREE.Vector3, lift = PAPER_LIFT): THREE.Vector3 {
  const row = bodyAt(anchor.s - (y - h / 2))
  const radius = row.r + row.nr * lift
  const theta = anchor.theta + (x - w / 2) / row.r
  return out.set(Math.sin(theta) * radius, row.y + row.ny * lift, Math.cos(theta) * radius)
}

/** Outward normal of the body under content point (x, y), in teapot space. */
export function wrappedNormal(x: number, y: number, w: number, h: number, anchor: BodyAnchor, out: THREE.Vector3): THREE.Vector3 {
  const row = bodyAt(anchor.s - (y - h / 2))
  const theta = anchor.theta + (x - w / 2) / row.r
  return out.set(Math.sin(theta) * row.nr, row.ny, Math.cos(theta) * row.nr).normalize()
}

// ── peeling ───────────────────────────────────────────────────────────

/** Peel coordinate: 0 at the lifted corner (top right), 1 at the far corner. */
function peelOrder(x: number, y: number, w: number, h: number): number {
  return (1 - x / w) * 0.62 + (y / h) * 0.38
}

/**
 * A wrapped point partway through a peel. `progress` 0 is stuck flat on the
 * glaze; at 1 the whole sheet hangs off the body. The released part rolls
 * away from the glaze about the peel front, the way tape lifts.
 */
export function peeledPoint(x: number, y: number, w: number, h: number, anchor: BodyAnchor, progress: number, out: THREE.Vector3): THREE.Vector3 {
  wrappedPoint(x, y, w, h, anchor, out)
  const front = progress * 1.25
  const behind = front - peelOrder(x, y, w, h)
  if (behind <= 0) return out
  const n = wrappedNormal(x, y, w, h, anchor, _p)
  // Arc length already released behind the front, in px of paper.
  const released = behind * Math.hypot(w, h) * 0.55
  const curl = 150
  const angle = Math.min(released / curl, 1.25)
  out.addScaledVector(n, curl * (1 - Math.cos(angle)) + released * 0.25)
  return out
}

// ── the flat pose ─────────────────────────────────────────────────────

/** A rectangle in canvas px, origin top left. */
export interface CanvasRect { left: number; top: number; width: number; height: number }

/**
 * Content point (x, y) of a note drawn over `rect`, at world depth `depth`,
 * scaled so it projects to exactly the same canvas pixels as the page note.
 * A note held in front of the teapot must not be buried in it, and must not
 * change size at the handoff.
 */
export function flatPoint(x: number, y: number, w: number, h: number, rect: CanvasRect, canvas: { width: number; height: number }, cameraDistance: number, depth: number, out: THREE.Vector3): THREE.Vector3 {
  const sx = rect.left + (x / w) * rect.width
  const sy = rect.top + (y / h) * rect.height
  const f = (cameraDistance - depth) / cameraDistance
  return out.set((sx - canvas.width / 2) * f, (canvas.height / 2 - sy) * f, depth)
}

export const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)
export const easeOut = (u: number) => 1 - Math.pow(1 - u, 3)
