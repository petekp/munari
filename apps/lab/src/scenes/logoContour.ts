// The outline law: where does a letter END?
//
// The matter shader treats a lifted letter's alpha as a HEIGHT field and
// lights it (logoShaders). That buys shading, not shape — the mesh is
// still a flat rectangle, and a rectangle has no edges to catch a light.
// To give a letter real thickness something has to know its OUTLINE, and
// the honest source for that is the same thing everything else here
// reads: the live capture's alpha. Not the font's outlines. A font file
// would only ever work for text; the captured alpha works for any DOM
// subtree a Surface can hold, which is the whole point of the bench.
//
// So: marching squares over the alpha grid, at a chosen level. The
// classic, and the right tool — it is exact on the grid, it interpolates
// each crossing to sub-texel precision, and it handles the two things a
// wordmark actually needs: HOLES (the counter of an 'a') and DISJOINT
// PIECES (the dot and the stem of an 'i').
//
// Three details worth stating, because each one is a bug someone else
// has already written:
//
//   · Rings are linked by EDGE IDENTITY, not by comparing float
//     endpoints. Two cells that share an edge compute the same crossing
//     from the same two samples, so the floats would in fact match — but
//     only by luck of arithmetic. Keying on the edge's grid index makes
//     the link exact by construction, and gives every crossed edge
//     exactly two neighbors, which is what makes the walk terminate.
//   · The grid is PADDED with a ring of zeros. Ink that runs to the
//     border would otherwise open a ring, and an open ring is not a
//     shape. With the pad, every contour closes.
//   · Winding is decided by CONTAINMENT, not by the case table. Counting
//     how many rings enclose a ring is a few hundred point-in-polygon
//     tests on a handful of rings; getting a marching-squares case table
//     oriented correctly is a day of sign errors. Even depth is an outer
//     ring (forced counter-clockwise), odd depth is a hole (forced
//     clockwise) — which is exactly the winding the wall builder
//     (logoSlab) needs for its faces to point out of the material.
//
// Pure: no three, no GPU, no DOM. The samples arrive as a plain array
// from logoFields.readAlphaField and leave as normalized rings, so the
// contract is a unit test (logoContour.test.ts) rather than a screenshot.

export interface ContourOptions {
  /** The level the outline traces, in the SAME units as the samples —
   *  0.5 for a 0..1 mask, 128 for bytes. Half coverage is the
   *  perceptual edge of an antialiased glyph. */
  threshold?: number
  /** Douglas–Peucker tolerance in TEXELS. A traced outline carries one
   *  point per crossed cell edge; almost all of them sit on straight
   *  runs. 0 keeps every point. */
  simplify?: number
  /** Rings enclosing less than this many texels² are speckle — a stray
   *  antialiased pixel, a font's hinting crumb — and get dropped. */
  minArea?: number
}

/** One connected piece of ink: an outer ring and the rings it encloses.
 *  Coordinates are NORMALIZED to the sample grid — u and v both run 0..1
 *  across the box the samples covered, v up — so a consumer scales them
 *  by its own box and never needs to know the readback resolution. */
export interface ContourShape {
  /** Counter-clockwise, flat `[u0, v0, u1, v1, …]`, not closed (the last
   *  point does not repeat the first). */
  outer: number[]
  /** Clockwise, same units. */
  holes: number[][]
}

const DEFAULTS = { threshold: 0.5, simplify: 0.75, minArea: 6 }

/** Twice the signed area of a flat ring. Positive is counter-clockwise
 *  in a y-up frame. Exported because it is the winding test AND the
 *  speckle test, and both deserve to be checked directly. */
export function ringArea(ring: number[]): number {
  let sum = 0
  const n = ring.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    sum += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1]
  }
  return sum / 2
}

/** Crossing-number test: is (x, y) inside this ring? Winding-agnostic. */
export function pointInRing(ring: number[], x: number, y: number): boolean {
  let inside = false
  const n = ring.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2]
    const yi = ring[i * 2 + 1]
    const xj = ring[j * 2]
    const yj = ring[j * 2 + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Douglas–Peucker over a closed ring. A ring has no ends to anchor, so
 *  it is cut at two far-apart points — index 0 and whatever lies
 *  farthest from it — and each open chain is simplified between them.
 *  Cutting at a near pair would let the algorithm shave off the ring's
 *  own extremes. */
export function simplifyRing(ring: number[], tol: number): number[] {
  const n = ring.length / 2
  if (tol <= 0 || n < 5) return ring
  let far = 0
  let best = -1
  for (let i = 1; i < n; i++) {
    const dx = ring[i * 2] - ring[0]
    const dy = ring[i * 2 + 1] - ring[1]
    const d = dx * dx + dy * dy
    if (d > best) {
      best = d
      far = i
    }
  }
  const head = chain(ring, 0, far, tol)
  const tail = chain(ring, far, n, tol)
  // Both chains end on their cut point, and the next chain starts there
  // — drop each chain's last point so the join is not doubled.
  const out = head.slice(0, -2).concat(tail.slice(0, -2))
  return out.length >= 6 ? out : ring
}

/** Douglas–Peucker on the open chain ring[from…to], where `to` may be
 *  `n` meaning "wrap back to index 0". Endpoints always survive. */
function chain(ring: number[], from: number, to: number, tol: number): number[] {
  const n = ring.length / 2
  const idx: number[] = []
  for (let i = from; i <= to; i++) idx.push(i % n)
  const keep = new Uint8Array(idx.length)
  keep[0] = 1
  keep[keep.length - 1] = 1
  const stack: [number, number][] = [[0, idx.length - 1]]
  const tol2 = tol * tol
  while (stack.length > 0) {
    const [a, b] = stack.pop()!
    if (b - a < 2) continue
    const ax = ring[idx[a] * 2]
    const ay = ring[idx[a] * 2 + 1]
    const bx = ring[idx[b] * 2]
    const by = ring[idx[b] * 2 + 1]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    let worst = -1
    let at = -1
    for (let i = a + 1; i < b; i++) {
      const px = ring[idx[i] * 2]
      const py = ring[idx[i] * 2 + 1]
      // Squared distance from the point to the segment — or to the
      // shared endpoint when the segment is degenerate.
      let d2: number
      if (len2 < 1e-12) {
        d2 = (px - ax) * (px - ax) + (py - ay) * (py - ay)
      } else {
        const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2))
        const qx = ax + t * dx - px
        const qy = ay + t * dy - py
        d2 = qx * qx + qy * qy
      }
      if (d2 > worst) {
        worst = d2
        at = i
      }
    }
    if (worst > tol2 && at > 0) {
      keep[at] = 1
      stack.push([a, at], [at, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < idx.length; i++) {
    if (keep[i]) out.push(ring[idx[i] * 2], ring[idx[i] * 2 + 1])
  }
  return out
}

/**
 * Trace `alpha` (row-major, row 0 at the BOTTOM — the order a GL
 * readback hands back) into normalized shapes.
 *
 * Returns outer rings paired with the holes they enclose, largest ring
 * first. An empty or fully-covered grid both return sensibly: nothing,
 * and one ring around the whole box.
 */
export function traceContour(
  alpha: ArrayLike<number>,
  w: number,
  h: number,
  options: ContourOptions = {},
): ContourShape[] {
  const t = options.threshold ?? DEFAULTS.threshold
  const tol = options.simplify ?? DEFAULTS.simplify
  const minArea = options.minArea ?? DEFAULTS.minArea
  if (w < 1 || h < 1) return []

  // The padded grid: one ring of zeros around the samples, so ink at the
  // border still closes. Padded (i, j) reads sample (i-1, j-1).
  const W = w + 2
  const H = h + 2
  const at = (i: number, j: number) =>
    i <= 0 || j <= 0 || i >= W - 1 || j >= H - 1 ? 0 : alpha[(j - 1) * w + (i - 1)]

  // Edge ids. A horizontal edge spans (i, j)→(i+1, j); a vertical edge
  // spans (i, j)→(i, j+1). Every crossed edge is shared by exactly two
  // cells, so every id collects exactly two neighbors.
  const hCount = (W - 1) * H
  const total = hCount + W * (H - 1)
  const linkA = new Int32Array(total).fill(-1)
  const linkB = new Int32Array(total).fill(-1)
  const join = (e1: number, e2: number) => {
    if (linkA[e1] < 0) linkA[e1] = e2
    else linkB[e1] = e2
    if (linkA[e2] < 0) linkA[e2] = e1
    else linkB[e2] = e1
  }

  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const a = at(i, j)
      const b = at(i + 1, j)
      const c = at(i + 1, j + 1)
      const d = at(i, j + 1)
      const code =
        (a >= t ? 1 : 0) | (b >= t ? 2 : 0) | (c >= t ? 4 : 0) | (d >= t ? 8 : 0)
      if (code === 0 || code === 15) continue
      const eB = j * (W - 1) + i
      const eT = (j + 1) * (W - 1) + i
      const eL = hCount + j * W + i
      const eR = hCount + j * W + i + 1
      switch (code) {
        // One corner in (or one corner out — the contour is the same
        // line either way, which is why the cases pair up).
        case 1:
        case 14:
          join(eL, eB)
          break
        case 2:
        case 13:
          join(eB, eR)
          break
        case 4:
        case 11:
          join(eR, eT)
          break
        case 7:
        case 8:
          join(eL, eT)
          break
        // Two adjacent corners in: the contour runs straight across.
        case 3:
        case 12:
          join(eL, eR)
          break
        case 6:
        case 9:
          join(eB, eT)
          break
        // The saddles, where two contours cross one cell and the case
        // alone cannot say which corners are connected. The cell's mean
        // decides: if the middle is ink, the two ink corners are one
        // band and the contour isolates the other pair.
        default: {
          const solid = (a + b + c + d) / 4 >= t
          if ((code === 5) === solid) {
            join(eB, eR)
            join(eL, eT)
          } else {
            join(eL, eB)
            join(eR, eT)
          }
        }
      }
    }
  }

  // Where on its edge does the contour cross? Linear between the two
  // samples — this is where the sub-texel accuracy comes from, and why
  // a traced outline is smoother than the grid it came from.
  const cut = (v0: number, v1: number) =>
    v1 === v0 ? 0.5 : Math.min(1, Math.max(0, (t - v0) / (v1 - v0)))
  const px = (e: number) => {
    if (e < hCount) {
      const j = Math.floor(e / (W - 1))
      const i = e - j * (W - 1)
      return [i + cut(at(i, j), at(i + 1, j)), j]
    }
    const k = e - hCount
    const j = Math.floor(k / W)
    const i = k - j * W
    return [i, j + cut(at(i, j), at(i, j + 1))]
  }

  // Walk each chain of linked edges back to where it started.
  const seen = new Uint8Array(total)
  const rings: number[][] = []
  for (let e = 0; e < total; e++) {
    if (linkA[e] < 0 || seen[e]) continue
    const ring: number[] = []
    let prev = -1
    let cur = e
    for (;;) {
      seen[cur] = 1
      const p = px(cur)
      ring.push(p[0], p[1])
      const a = linkA[cur]
      const b = linkB[cur]
      const next = a === prev ? b : a
      if (next < 0 || next === e || seen[next]) break
      prev = cur
      cur = next
    }
    if (ring.length >= 6) rings.push(ring)
  }

  // Speckle out, then nest. Depth is how many other rings enclose this
  // one: even is an outer ring, odd is a hole, and a hole belongs to the
  // smallest ring that contains it.
  const kept = rings.filter((r) => Math.abs(ringArea(r)) >= minArea)
  const areas = kept.map((r) => Math.abs(ringArea(r)))
  const depth = kept.map((r, i) =>
    kept.reduce(
      (n, other, k) => (k !== i && pointInRing(other, r[0], r[1]) ? n + 1 : n),
      0,
    ),
  )

  const norm = (ring: number[], ccw: boolean) => {
    const s = simplifyRing(ring, tol)
    const out: number[] = []
    // Padded grid point i sits at the center of sample i-1, so u runs
    // (i - 0.5) / w. The same shift on both axes; v is already up.
    for (let k = 0; k < s.length; k += 2) {
      out.push((s[k] - 0.5) / w, (s[k + 1] - 0.5) / h)
    }
    if (ringArea(out) > 0 === ccw) return out
    const flipped: number[] = []
    for (let k = out.length - 2; k >= 0; k -= 2) flipped.push(out[k], out[k + 1])
    return flipped
  }

  const shapes: ContourShape[] = []
  const owner = new Map<number, number>()
  for (let i = 0; i < kept.length; i++) {
    if (depth[i] % 2 !== 0) continue
    owner.set(i, shapes.length)
    shapes.push({ outer: norm(kept[i], true), holes: [] })
  }
  for (let i = 0; i < kept.length; i++) {
    if (depth[i] % 2 === 0) continue
    let parent = -1
    for (let k = 0; k < kept.length; k++) {
      if (k === i || depth[k] % 2 !== 0) continue
      if (!pointInRing(kept[k], kept[i][0], kept[i][1])) continue
      if (parent < 0 || areas[k] < areas[parent]) parent = k
    }
    const slot = parent >= 0 ? owner.get(parent) : undefined
    if (slot !== undefined) shapes[slot].holes.push(norm(kept[i], false))
  }

  return shapes
}
