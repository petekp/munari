// Marble-hand knuckles — five hinges read out of an unrigged scan.
//
// The law: the finger a vertex belongs to is decided by the mesh's own
// surface, not by a box drawn around it. Geodesic distance from the sawn
// wrist splits into five branches at the knuckles; each branch's centre
// line is a planar curve whose normal is that finger's flexion axis.
//
// The fault this prevents, 2026-08-31: classical-hand.stl has no skeleton
// and no skin weights, so the tapping law needs pivots typed as constants.
// Numbers pasted from a one-off session cannot be rechecked when the asset
// is rebuilt, and eyeballed pivots put the hinge inside the palm. Running
// this tool reprints the table; the coordinates below the split threshold
// (138.5) are where two digits first fuse, which is what fixes each cut.
//
// Ownership: make-marble-hand.mjs bakes the mesh. This tool only measures
// it. marbleHandTapLaw.ts holds the printed table and the weight function;
// this file must stay the one place the numbers come from.
// Run: node apps/lab/tools/find-marble-hand-fingers.mjs

import { readFileSync } from 'node:fs'

const modelUrl = new URL('../public/models/marble-hand/classical-hand.stl', import.meta.url)
const WRIST_X = -215
const WELD_PRECISION = 10000
// A branch has to carry real surface before its growth means anything. Under
// a hundred welded vertices the tip cap alone can double from one step.
const MIN_BRANCH_VERTICES = 100
// One step down the distance field doubles a finger's vertex count only when
// the cut has reached the palm. 1.5x over two units caught all three knuckles
// with margin: the next lower step multiplies by 2.2, 3.3 and 4.7.
const KNUCKLE_GROWTH = 1.5
const KNUCKLE_STEP = 2
// Twelve bins put 30-40 vertices in each centre-line sample. Fewer bins hide
// the curl; more leaves bins empty at the tip where the finger tapers.
const CENTRE_LINE_BINS = 12

const bytes = readFileSync(modelUrl)
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
const triangleCount = view.getUint32(80, true)
if (bytes.byteLength !== 84 + triangleCount * 50) {
  throw new Error('classical-hand.stl is not the binary STL this tool parses.')
}

const welded = new Map()
const vertices = []
const faces = []
for (let triangle = 0; triangle < triangleCount; triangle++) {
  const record = 84 + triangle * 50
  const face = []
  for (let corner = 0; corner < 3; corner++) {
    const at = record + 12 + corner * 12
    const point = [view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)]
    const key = point.map((value) => Math.round(value * WELD_PRECISION)).join(',')
    let id = welded.get(key)
    if (id === undefined) {
      id = vertices.length
      welded.set(key, id)
      vertices.push(point)
    }
    face.push(id)
  }
  faces.push(face)
}

const neighbors = vertices.map(() => new Set())
for (const face of faces) {
  for (let corner = 0; corner < 3; corner++) {
    const a = face[corner]
    const b = face[(corner + 1) % 3]
    neighbors[a].add(b)
    neighbors[b].add(a)
  }
}

const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const length = (a) => Math.hypot(a[0], a[1], a[2])
const normalize = (a) => { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

// ── geodesic distance from the sawn wrist ─────────────────────────────

function surfaceDistanceFromWrist() {
  const distance = new Float64Array(vertices.length).fill(Infinity)
  const queue = []
  const push = (node, value) => {
    queue.push([value, node])
    let child = queue.length - 1
    while (child > 0) {
      const parent = (child - 1) >> 1
      if (queue[parent][0] <= queue[child][0]) break
      const swap = queue[parent]; queue[parent] = queue[child]; queue[child] = swap
      child = parent
    }
  }
  const pop = () => {
    const top = queue[0]
    const last = queue.pop()
    if (queue.length) {
      queue[0] = last
      let parent = 0
      for (;;) {
        const left = parent * 2 + 1
        const right = left + 1
        let smallest = parent
        if (left < queue.length && queue[left][0] < queue[smallest][0]) smallest = left
        if (right < queue.length && queue[right][0] < queue[smallest][0]) smallest = right
        if (smallest === parent) break
        const swap = queue[smallest]; queue[smallest] = queue[parent]; queue[parent] = swap
        parent = smallest
      }
    }
    return top
  }
  for (const [node, point] of vertices.entries()) if (point[0] === WRIST_X) { distance[node] = 0; push(node, 0) }
  while (queue.length) {
    const [value, node] = pop()
    if (value > distance[node]) continue
    for (const next of neighbors[node]) {
      const step = value + length(subtract(vertices[node], vertices[next]))
      if (step < distance[next]) { distance[next] = step; push(next, step) }
    }
  }
  return distance
}

const distance = surfaceDistanceFromWrist()

function branchFrom(seed, cut) {
  const seen = new Set([seed])
  const stack = [seed]
  const branch = []
  while (stack.length) {
    const node = stack.pop()
    branch.push(node)
    for (const next of neighbors[node]) {
      if (distance[next] > cut && !seen.has(next)) { seen.add(next); stack.push(next) }
    }
  }
  return branch
}

function branchesAbove(cut) {
  const seen = new Set()
  const found = []
  for (let node = 0; node < vertices.length; node++) {
    if (distance[node] <= cut || seen.has(node)) continue
    const branch = branchFrom(node, cut)
    for (const member of branch) seen.add(member)
    if (branch.length >= 15) found.push(branch)
  }
  return found
}

// ── the five digits and their knuckles ────────────────────────────────

let splitCut = null
for (let cut = 200; cut >= 100; cut -= 0.5) {
  if (branchesAbove(cut).length >= 5) splitCut = cut
  else if (splitCut !== null) break
}
if (splitCut === null) throw new Error('The hand never separates into five digits.')

const tips = branchesAbove(splitCut).map((branch) =>
  branch.reduce((far, node) => (distance[node] > distance[far] ? node : far)))
const pointingTip = tips.find((node) => length(vertices[node]) < 20)
if (pointingTip === undefined) throw new Error('No digit reaches the index fingertip at the model origin.')
// The thumb rides beside the palm; the three curled fingers hang under it.
// Sorting the four remaining tips by height separates them without a
// hand-picked plane. Ordering by x then names them middle, ring, little.
const curled = tips
  .filter((node) => node !== pointingTip)
  .sort((a, b) => vertices[a][1] - vertices[b][1])
  .slice(0, 3)
  .sort((a, b) => vertices[b][0] - vertices[a][0])

function symmetricEigenvectors(matrix) {
  let values = matrix.map((row) => row.slice())
  let vectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  for (let sweep = 0; sweep < 100; sweep++) {
    let p = 0
    let q = 1
    let largest = 0
    for (let row = 0; row < 3; row++) {
      for (let column = row + 1; column < 3; column++) {
        if (Math.abs(values[row][column]) > largest) { largest = Math.abs(values[row][column]); p = row; q = column }
      }
    }
    if (largest < 1e-14) break
    const angle = 0.5 * Math.atan2(2 * values[p][q], values[p][p] - values[q][q])
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const rows = values.map((row) => row.slice())
    for (let k = 0; k < 3; k++) {
      rows[p][k] = c * values[p][k] + s * values[q][k]
      rows[q][k] = -s * values[p][k] + c * values[q][k]
    }
    const both = rows.map((row) => row.slice())
    for (let k = 0; k < 3; k++) {
      both[k][p] = c * rows[k][p] + s * rows[k][q]
      both[k][q] = -s * rows[k][p] + c * rows[k][q]
    }
    values = both
    const turned = vectors.map((row) => row.slice())
    for (let k = 0; k < 3; k++) {
      turned[k][p] = c * vectors[k][p] + s * vectors[k][q]
      turned[k][q] = -s * vectors[k][p] + c * vectors[k][q]
    }
    vectors = turned
  }
  return [0, 1, 2]
    .map((k) => ({ value: values[k][k], vector: [vectors[0][k], vectors[1][k], vectors[2][k]] }))
    .sort((a, b) => b.value - a.value)
}

const names = ['middle', 'ring', 'little']
// The thumb is the one digit that is neither pointing nor curled.
const thumbTip = tips.find((node) => node !== pointingTip && !curled.includes(node))
if (thumbTip === undefined) throw new Error('No digit is left over to be the thumb.')

function digitBranch(tip, name) {
  let knuckleCut = 0
  for (let cut = Math.floor(distance[tip]); cut >= 40; cut--) {
    const here = branchFrom(tip, cut).length
    const below = branchFrom(tip, cut - KNUCKLE_STEP).length
    if (here >= MIN_BRANCH_VERTICES && below > here * KNUCKLE_GROWTH) { knuckleCut = cut; break }
  }
  if (knuckleCut === 0) throw new Error(`The ${name} finger never reaches the palm.`)
  return { knuckleCut, finger: branchFrom(tip, knuckleCut) }
}

function digitCentreLine(tip, knuckleCut, finger, name) {
  const span = distance[tip] - knuckleCut
  const centreLine = []
  for (let bin = 0; bin < CENTRE_LINE_BINS; bin++) {
    const from = knuckleCut + span * bin / CENTRE_LINE_BINS
    const to = knuckleCut + span * (bin + 1) / CENTRE_LINE_BINS
    const slice = finger.filter((node) => distance[node] >= from && distance[node] < to)
    if (slice.length < 3) continue
    centreLine.push([0, 1, 2].map((k) => slice.reduce((sum, node) => sum + vertices[node][k], 0) / slice.length))
  }
  if (centreLine.length < 3) throw new Error(`The ${name} finger has no centre line.`)
  return centreLine
}

const hinges = curled.map((tip, order) => {
  const { knuckleCut, finger } = digitBranch(tip, names[order])

  const centreLine = digitCentreLine(tip, knuckleCut, finger, names[order])

  const pivot = centreLine[0]
  const middle = [0, 1, 2].map((k) => centreLine.reduce((sum, point) => sum + point[k], 0) / centreLine.length)
  const covariance = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (const point of centreLine) {
    const offset = subtract(point, middle)
    for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) covariance[row][column] += offset[row] * offset[column]
  }
  const spread = symmetricEigenvectors(covariance)
  const proximal = normalize(subtract(centreLine[1], centreLine[0]))
  const far = normalize(subtract(centreLine[centreLine.length - 1], centreLine[centreLine.length - 2]))
  // The curl turns the tangent one way around the plane normal. Point the
  // axis along that turn, so a positive angle tightens the curl the scan
  // already has. Measured 2026-08-31 over the authored pose envelope: at
  // 0.35 rad that raises the lowest stone from -36.6 to -32.6 model units,
  // while unrolling drops it to -40.9 and would breach the page clearance.
  const curlSense = dot(cross(proximal, far), spread[2].vector)
  const axis = normalize(spread[2].vector.map((value) => (curlSense < 0 ? -value : value)))
  const reach = Math.max(...finger.map((node) => length(subtract(vertices[node], pivot))))
  const radius = Math.max(...finger.map((node) => Math.abs(dot(subtract(vertices[node], pivot), axis))))
  return { name: names[order], knuckleCut, finger, pivot, axis, proximal, reach, radius, spread, tip: vertices[tip] }
})

// ── the pinch pair ────────────────────────────────────────────────────
//
// The pointing index is straight, so its centre line has no curl plane to
// read an axis from. The pinch instead defines each axis as the turn that
// carries this digit's tip toward the OTHER digit's tip: a positive bend
// closes the pair. cross(proximal, toward) is that turn's plane normal.
function pinchHinge(name, tip, towardTip) {
  const { knuckleCut, finger } = digitBranch(tip, name)
  const centreLine = digitCentreLine(tip, knuckleCut, finger, name)
  const pivot = centreLine[0]
  const proximal = normalize(subtract(centreLine[1], centreLine[0]))
  const toward = normalize(subtract(vertices[towardTip], pivot))
  const axis = normalize(cross(proximal, toward))
  const reach = Math.max(...finger.map((node) => length(subtract(vertices[node], pivot))))
  const radius = Math.max(...finger.map((node) => Math.abs(dot(subtract(vertices[node], pivot), axis))))
  // Radial spread off the digit's own line. The pinch plane cuts across a
  // straight digit, so the plane distance alone would fence in half the
  // hand; the girth is what keeps this capsule on its own finger.
  const girth = Math.max(...finger.map((node) => {
    const offset = subtract(vertices[node], pivot)
    const along = dot(offset, proximal)
    return length(subtract(offset, proximal.map((value) => value * along)))
  }))
  return { name, knuckleCut, finger, pivot, axis, proximal, reach, radius, girth, tip: vertices[tip] }
}

const pinchHinges = [
  pinchHinge('index', pointingTip, thumbTip),
  pinchHinge('thumb', thumbTip, pointingTip),
]

// ── what the printed table claims ─────────────────────────────────────

// Mirrors marbleHandTapLaw.ts: 10% headroom on each bound, then an 8-unit
// fade to zero, so the diagnostics below judge the law that actually ships.
const TAP_RAMP = 0.3
const TAP_HEADROOM = 1.1
const TAP_FADE = 8
function fadePast(value, edge) {
  const t = Math.min(1, Math.max(0, (value - edge) / TAP_FADE))
  return 1 - t * t * (3 - 2 * t)
}
function tapBound(hinge, point) {
  const offset = subtract(point, hinge.pivot)
  const along = dot(offset, hinge.proximal)
  if (along <= 0) return 0
  let bound = fadePast(Math.abs(dot(offset, hinge.axis)), hinge.radius * TAP_HEADROOM)
  bound *= fadePast(length(offset), hinge.reach * TAP_HEADROOM)
  if (hinge.girth !== undefined) {
    const radial = length(subtract(offset, hinge.proximal.map((value) => value * along)))
    bound *= fadePast(radial, hinge.girth * TAP_HEADROOM)
  }
  return bound
}
function tapWeight(hinge, point) {
  const bound = tapBound(hinge, point)
  if (bound <= 0) return 0
  const along = dot(subtract(point, hinge.pivot), hinge.proximal)
  const ramp = Math.min(1, along / (TAP_RAMP * hinge.reach))
  return bound * ramp * ramp * (3 - 2 * ramp)
}
// Mirrors the baked arbitration: a full-capsule claim outranks any
// fade-band claim; full claims go to the nearer curl plane, fades to the
// larger claim.
function arbitrate(point, candidates) {
  let best = -1
  let bestFull = false
  let nearestPlane = Infinity
  let bestFadedClaim = 0
  for (const [order, hinge] of candidates.entries()) {
    const claim = tapWeight(hinge, point)
    if (claim <= 0) continue
    const full = tapBound(hinge, point) >= 1
    if (full) {
      const plane = Math.abs(dot(subtract(point, hinge.pivot), hinge.axis))
      if (bestFull && plane >= nearestPlane) continue
      nearestPlane = plane
    } else {
      if (bestFull || claim <= bestFadedClaim) continue
      bestFadedClaim = claim
    }
    bestFull ||= full
    best = order
  }
  return best
}

const round = (value, places) => Number(value.toFixed(places))
const table = [...hinges, ...pinchHinges].map((hinge) => {
  const row = {
    finger: hinge.name,
    pivot: hinge.pivot.map((value) => round(value, 3)),
    axis: hinge.axis.map((value) => round(value, 5)),
    proximal: hinge.proximal.map((value) => round(value, 5)),
    reach: round(hinge.reach, 2),
    radius: round(hinge.radius, 2),
  }
  if (hinge.girth !== undefined) row.girth = round(hinge.girth, 2)
  return row
})

const owner = vertices.map((point) => arbitrate(point, hinges))

const pointing = new Set(branchFrom(pointingTip, splitCut))
const claimed = hinges.map((hinge, order) => {
  const owned = vertices.filter((point, node) => owner[node] === order && tapWeight(hinge, point) > 0).length
  const missed = hinge.finger.filter((node) => owner[node] !== order && tapWeight(hinge, vertices[node]) > 0).length
  return { finger: hinge.name, knuckleCut: hinge.knuckleCut, fingerVertices: hinge.finger.length, owned, lostToNeighbour: missed }
})

// Under five-hinge arbitration, no digit's surface may end up OWNED by a
// different digit's hinge — a claim that loses arbitration is harmless.
const all = [...hinges, ...pinchHinges]
const wrongOwners = all.map((hinge, order) => {
  const strays = []
  for (const other of all) {
    if (other === hinge) continue
    for (const node of other.finger) {
      const best = arbitrate(vertices[node], all)
      if (best === order) strays.push({ digit: other.name, weight: round(tapWeight(hinge, vertices[node]), 3) })
    }
  }
  return { finger: hinge.name, ownsForeignVertices: strays.length,
    worstForeignWeight: round(Math.max(0, ...strays.map((stray) => stray.weight)), 3),
    byDigit: strays.reduce((tally, stray) => ({ ...tally, [stray.digit]: (tally[stray.digit] ?? 0) + 1 }), {}) }
})

console.log(JSON.stringify({
  model: modelUrl.pathname,
  weldedVertices: vertices.length,
  splitCut,
  digitTips: tips.map((node) => vertices[node].map((value) => round(value, 1))),
  hinges: table,
  centreLineFlatness: hinges.map((hinge) => ({
    finger: hinge.name,
    eigenvalues: hinge.spread.map((axis) => round(axis.value, 1)),
  })),
  parallelAxes: [[0, 1], [0, 2], [1, 2]].map(([a, b]) => round(dot(hinges[a].axis, hinges[b].axis), 3)),
  claimed,
  wrongOwners,
  pointingFingerMaxWeight: round(Math.max(0, ...[...pointing].map((node) =>
    Math.max(...hinges.map((hinge) => tapWeight(hinge, vertices[node]))))), 6),
  wristCapMaxWeight: round(Math.max(0, ...vertices.filter((point) => point[0] < -200).map((point) =>
    Math.max(...hinges.map((hinge) => tapWeight(hinge, point))))), 6),
}, null, 2))
