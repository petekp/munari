// The bouncing marks — the genie window's live content, and the shape
// of the lesson the wormhole taught (genie.css's section comment is
// the short form):
//
//   The LAW is a pure step: three equal-mass convex bodies in a box,
//   elastic off the walls and off one another. Each body collides on
//   its TRUE silhouette — the circle on its circle, the square on its
//   box, the triangle on its three edges — traced from the same SVG
//   geometry the eye sees, so a graze past the triangle's empty
//   corner is a miss, not a bounce. genieBounce.test.ts pins it.
//
//   The HARNESS is one module-level simulation driven by one rAF loop,
//   writing plain inline transforms. Main-thread on purpose: a
//   compositor animation is rendered from a cached raster on the page
//   but re-painted geometrically in the capture, and the two are
//   allowed to disagree in both sharpness and TIME — the measured
//   fat-vs-crisp stroke jump and ~60ms ring displacement at the
//   custody swap. A style write has one clock and one raster path, so
//   the page and the texture cannot diverge. And because every mounted
//   copy of the window subscribes to the SAME simulation, the page
//   copy and the airborne copy draw identical numbers on every frame —
//   twin agreement is by construction, not by phase-pinning.

import { genieKnobs } from './genieKnobs'

export interface Vec {
  x: number
  y: number
}

/** A body's collision silhouette, relative to its center. Bodies
 *  translate but never rotate, so a polygon's vertices are fixed
 *  offsets and the axis-aligned walls can read extents straight off
 *  them. Polygons must be convex — the contact law is SAT. */
export type BounceShape = { kind: 'circle'; r: number } | { kind: 'poly'; verts: Vec[] }

export interface BounceBody {
  x: number
  y: number
  vx: number
  vy: number
  shape: BounceShape
}

/** How far the silhouette reaches from the center toward each wall. */
function extents(s: BounceShape): { l: number; r: number; t: number; b: number } {
  if (s.kind === 'circle') return { l: s.r, r: s.r, t: s.r, b: s.r }
  let l = 0
  let r = 0
  let t = 0
  let b = 0
  for (const v of s.verts) {
    if (-v.x > l) l = -v.x
    if (v.x > r) r = v.x
    if (-v.y > t) t = -v.y
    if (v.y > b) b = v.y
  }
  return { l, r, t, b }
}

/** The body's shadow on a unit axis, as a [min, max] interval. */
function project(b: BounceBody, ax: number, ay: number): [number, number] {
  const c = b.x * ax + b.y * ay
  if (b.shape.kind === 'circle') return [c - b.shape.r, c + b.shape.r]
  let min = Infinity
  let max = -Infinity
  for (const v of b.shape.verts) {
    const p = c + v.x * ax + v.y * ay
    if (p < min) min = p
    if (p > max) max = p
  }
  return [min, max]
}

/** The separating axes one body contributes against another: a
 *  polygon its edge normals; a circle the axis toward the other
 *  body's closest feature (center, or nearest polygon vertex) — the
 *  standard complete axis set for convex SAT with circles. */
function axesOf(b: BounceBody, other: BounceBody): Vec[] {
  if (b.shape.kind === 'circle') {
    if (other.shape.kind === 'circle') return [{ x: other.x - b.x, y: other.y - b.y }]
    let best: Vec = { x: other.x - b.x, y: other.y - b.y }
    let bestD = Infinity
    for (const v of other.shape.verts) {
      const dx = other.x + v.x - b.x
      const dy = other.y + v.y - b.y
      const d = dx * dx + dy * dy
      if (d < bestD) {
        bestD = d
        best = { x: dx, y: dy }
      }
    }
    return [best]
  }
  const verts = b.shape.verts
  const out: Vec[] = []
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i]
    const q = verts[(i + 1) % verts.length]
    out.push({ x: q.y - p.y, y: p.x - q.x })
  }
  return out
}

/** SAT contact: null if any axis separates; otherwise the minimum-
 *  overlap axis is the contact normal (oriented a → b) and the
 *  overlap is the penetration depth. */
function contact(a: BounceBody, b: BounceBody): { nx: number; ny: number; depth: number } | null {
  let depth = Infinity
  let nx = 0
  let ny = 0
  for (const axis of [...axesOf(a, b), ...axesOf(b, a)]) {
    const len = Math.hypot(axis.x, axis.y)
    if (len === 0) continue
    const ax = axis.x / len
    const ay = axis.y / len
    const [minA, maxA] = project(a, ax, ay)
    const [minB, maxB] = project(b, ax, ay)
    const overlap = Math.min(maxA, maxB) - Math.max(minA, minB)
    if (overlap <= 0) return null
    if (overlap < depth) {
      depth = overlap
      nx = ax
      ny = ay
    }
  }
  if ((b.x - a.x) * nx + (b.y - a.y) * ny < 0) {
    nx = -nx
    ny = -ny
  }
  return { nx, ny, depth }
}

/** One physics step, in place. Pairs first: bodies that approach swap
 *  their contact-normal velocity components — the equal-mass elastic
 *  exchange — and split the overlap evenly. Then walls mirror, using
 *  each silhouette's own extents (position reflects about the wall so
 *  contact time inside the step is honoured); walls run last so the
 *  frame always ends contained. Total kinetic energy is invariant; the
 *  contract test pins that, containment, shape-true misses, and
 *  slanted-edge deflection. */
export function bounceStep(bodies: BounceBody[], dt: number, w: number, h: number): void {
  for (const b of bodies) {
    b.x += b.vx * dt
    b.y += b.vy * dt
  }
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]
      const b = bodies[j]
      const c = contact(a, b)
      if (!c) continue
      const approach = (a.vx - b.vx) * c.nx + (a.vy - b.vy) * c.ny
      if (approach > 0) {
        a.vx -= approach * c.nx
        a.vy -= approach * c.ny
        b.vx += approach * c.nx
        b.vy += approach * c.ny
      }
      const half = c.depth / 2
      a.x -= c.nx * half
      a.y -= c.ny * half
      b.x += c.nx * half
      b.y += c.ny * half
    }
  }
  for (const b of bodies) {
    const e = extents(b.shape)
    if (b.x - e.l < 0) {
      b.x = 2 * e.l - b.x
      b.vx = Math.abs(b.vx)
    } else if (b.x + e.r > w) {
      b.x = 2 * (w - e.r) - b.x
      b.vx = -Math.abs(b.vx)
    }
    if (b.y - e.t < 0) {
      b.y = 2 * e.t - b.y
      b.vy = Math.abs(b.vy)
    } else if (b.y + e.b > h) {
      b.y = 2 * (h - e.b) - b.y
      b.vy = -Math.abs(b.vy)
    }
  }
}

/** The marks and their rest radii. Colors are the dock's own. */
export const BOUNCE_MARKS = [
  { id: 'quadrato', color: '#3978e6', r: 34 },
  { id: 'cerchio', color: '#e9a426', r: 30 },
  { id: 'triangolo', color: '#e75b4d', r: 36 },
] as const

type MarkId = (typeof BOUNCE_MARKS)[number]['id']

/** The collision silhouette, traced from the SVG geometry itself
 *  (viewBox 0..100 drawn into a box of side 2r, so px = (svg − 50)
 *  / 50 · r). One source for eye and law: resize the figure and the
 *  bounds follow. */
export function markShape(id: MarkId, r: number): BounceShape {
  const u = (n: number) => ((n - 50) / 50) * r
  if (id === 'cerchio') return { kind: 'circle', r: (46 / 50) * r }
  if (id === 'quadrato')
    return {
      kind: 'poly',
      verts: [
        { x: u(4), y: u(4) },
        { x: u(96), y: u(4) },
        { x: u(96), y: u(96) },
        { x: u(4), y: u(96) },
      ],
    }
  return {
    kind: 'poly',
    verts: [
      { x: u(50), y: u(5) },
      { x: u(96), y: u(95) },
      { x: u(4), y: u(95) },
    ],
  }
}

// Seed positions are fractions of the court; headings are fixed so a
// reload is the same scene. No randomness anywhere — the motion's
// variety comes from the collisions.
const SEEDS = [
  { fx: 0.26, fy: 0.34, heading: 0.61 },
  { fx: 0.68, fy: 0.28, heading: 2.53 },
  { fx: 0.52, fy: 0.68, heading: 4.42 },
]

// ── the one simulation ──────────────────────────────────────────────

interface Court {
  marks: HTMLElement[]
}

const courts = new Set<Court>()
let bodies: BounceBody[] | null = null
let courtW = 0
let courtH = 0
let raf = 0
let last = 0

function seed(): BounceBody[] {
  return BOUNCE_MARKS.map((m, i) => ({
    x: SEEDS[i].fx * courtW,
    y: SEEDS[i].fy * courtH,
    vx: Math.cos(SEEDS[i].heading),
    vy: Math.sin(SEEDS[i].heading),
    shape: markShape(m.id, m.r * genieKnobs.markScale * genieKnobs.markBounds),
  }))
}

function write(court: Court): void {
  if (!bodies) return
  const s = genieKnobs.markScale
  for (let i = 0; i < court.marks.length; i++) {
    const b = bodies[i]
    const base = BOUNCE_MARKS[i].r
    court.marks[i].style.transform =
      `translate(${(b.x - base).toFixed(2)}px, ${(b.y - base).toFixed(2)}px) scale(${s})`
  }
}

function tick(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05)
  last = now
  if (bodies) {
    // Speed, size, and bounds are live knobs: direction integrates,
    // magnitude and silhouette obey the panel on every frame.
    const s = genieKnobs.markScale * genieKnobs.markBounds
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]
      const mag = Math.hypot(b.vx, b.vy) || 1
      b.vx = (b.vx / mag) * genieKnobs.markSpeed
      b.vy = (b.vy / mag) * genieKnobs.markSpeed
      b.shape = markShape(BOUNCE_MARKS[i].id, BOUNCE_MARKS[i].r * s)
    }
    bounceStep(bodies, dt, courtW, courtH)
    for (const court of courts) write(court)
  }
  raf = requestAnimationFrame(tick)
}

/** Subscribe a mounted window copy. The first live-sized court fixes
 *  the box and seeds the bodies; every copy after that only draws.
 *  Returns the unsubscribe. */
export function registerBounceCourt(root: HTMLElement): () => void {
  const court: Court = {
    marks: Array.from(root.querySelectorAll<HTMLElement>('.gen-bounce')),
  }
  courts.add(court)
  if (!bodies) {
    const rect = root.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      courtW = rect.width
      courtH = rect.height
      bodies = seed()
    }
  }
  write(court) // in place before the copy's first paint
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!raf && !still) {
    last = performance.now()
    raf = requestAnimationFrame(tick)
  }
  return () => {
    courts.delete(court)
    if (courts.size === 0 && raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
  }
}
