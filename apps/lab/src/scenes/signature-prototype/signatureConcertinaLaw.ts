// Pure 3D accordion/concertina pleating kinematics (`SignatureConcertina`) —
// partitions a multi-column HTML comparison board into `2 * CONCERTINA_COLS`
// non-shared-edge half-column facets so any subset of columns can fold into
// symmetric 3D mountain pleats (`0 -> +Z_peak -> 0`) while keeping every ridge
// and valley seam `C^0` watertight and pulling unpleated columns side-by-side.

import * as THREE from 'three'
import type { SurfaceDeformPoint } from '@petepetrash/munari'

export const CONCERTINA_COLS = 6
export const COL_W = 130
export const HALF_COL_W = COL_W / 2
export const CONCERTINA_W = CONCERTINA_COLS * COL_W // 780 CSS px
export const CONCERTINA_H = 384 // CSS px
export const MAX_PLEAT_RAD = 1.24 // ~71.0 deg: compresses 130 px -> 42.3 px, Z peak +61.5 px

export interface DiffRowSpec {
  readonly key: string
  readonly val: string
  readonly win?: boolean
}

export interface PipelineColumnSpec {
  readonly id: string
  readonly day: string
  readonly title: string
  readonly accent: string
  readonly editableTag?: boolean
  readonly rows: readonly [DiffRowSpec, DiffRowSpec, DiffRowSpec]
  readonly tasks: readonly [string, string]
}

export const CONCERTINA_COLUMNS: readonly PipelineColumnSpec[] = [
  {
    id: 'mon',
    day: 'MON',
    title: 'Baseline',
    accent: '#0d9488',
    editableTag: true,
    rows: [
      { key: 'SIZE', val: '14.2 kB' },
      { key: 'P95', val: '4.6 ms' },
      { key: 'IDLE', val: '0 fps' },
    ],
    tasks: ['DOM tree lock', 'a11y baseline'],
  },
  {
    id: 'tue',
    day: 'TUE',
    title: 'Schema',
    accent: '#d97706',
    rows: [
      { key: 'SLOTS', val: '9 synced' },
      { key: 'BOX', val: 'ResizeRO' },
      { key: 'SEAM', val: 'C0 weld' },
    ],
    tasks: ['UV box weld', 'Resize hook'],
  },
  {
    id: 'wed',
    day: 'WED',
    title: 'Shaders',
    accent: '#7c3aed',
    rows: [
      { key: 'ALPHA', val: 'Premul' },
      { key: 'LIGHT', val: 'World N' },
      { key: 'TAP', val: 'Mip LOD' },
    ],
    tasks: ['Mip bounce', 'Crease AO'],
  },
  {
    id: 'thu',
    day: 'THU',
    title: 'Pointer',
    accent: '#2563eb',
    rows: [
      { key: 'ROUTE', val: '3D relay' },
      { key: 'FOCUS', val: 'Roving' },
      { key: 'CARET', val: 'Native' },
    ],
    tasks: ['Facet raycast', 'Caret focus'],
  },
  {
    id: 'fri',
    day: 'FRI',
    title: 'Audit',
    accent: '#e11d48',
    rows: [
      { key: 'SNAP', val: 'Parity' },
      { key: '390PX', val: '0px clip' },
      { key: 'FALL', val: 'HTML ok' },
    ],
    tasks: ['390px mobile', 'Zero idle RAF'],
  },
  {
    id: 'sat',
    day: 'SAT',
    title: 'Candidate',
    accent: '#1d4ed8',
    editableTag: true,
    rows: [
      { key: 'SIZE', val: '11.8k -17%', win: true },
      { key: 'P95', val: '1.9ms -59%', win: true },
      { key: 'IDLE', val: '0 fps', win: true },
    ],
    tasks: ['Gates green', 'Ship ready'],
  },
]

export const INITIAL_CHECKED_KEYS: readonly string[] = [
  'mon-0', 'mon-1', 'tue-0', 'tue-1', 'wed-0',
  'thu-0', 'thu-1', 'fri-0', 'sat-0', 'sat-1',
]

function clamp01(v: number): number {
  if (v <= 0) return 0
  if (v >= 1) return 1
  return v
}

function cleanZero(v: number): number {
  return v === 0 ? 0 : v
}

/**
 * Builds a `2 * CONCERTINA_COLS`-strip BufferGeometry (`4` unshared vertices per
 * half-column strip = `48` vertices, `24` triangles) in Munari's centered world
 * frame (`[-W/2..+W/2] x [-H/2..+H/2]`) with exact planar UVs (`[0..1]`) and a
 * `aStripParity` attribute (`0` = left sunward slope, `1` = right valley slope).
 */
export function createConcertinaGeometry(): THREE.BufferGeometry {
  const stripCount = CONCERTINA_COLS * 2
  const positions = new Float32Array(stripCount * 4 * 3)
  const uvs = new Float32Array(stripCount * 4 * 2)
  const stripIndexAttr = new Float32Array(stripCount * 4)
  const indices: number[] = []

  const halfW = CONCERTINA_W * 0.5
  const halfH = CONCERTINA_H * 0.5

  for (let s = 0; s < stripCount; s++) {
    const x0 = s * HALF_COL_W
    const x1 = (s + 1) * HALF_COL_W
    const corners: readonly (readonly [number, number])[] = [
      [x0, 0],
      [x1, 0],
      [x1, CONCERTINA_H],
      [x0, CONCERTINA_H],
    ]

    const baseVert = s * 4
    for (let c = 0; c < 4; c++) {
      const [cx, cy] = corners[c]!
      const vIdx = baseVert + c
      positions[vIdx * 3] = cx - halfW
      positions[vIdx * 3 + 1] = halfH - cy
      positions[vIdx * 3 + 2] = 0

      uvs[vIdx * 2] = cx / CONCERTINA_W
      uvs[vIdx * 2 + 1] = 1 - cy / CONCERTINA_H
      stripIndexAttr[vIdx] = s
    }

    // Counter-clockwise winding facing +Z (`[0]=TL, [1]=TR, [2]=BR, [3]=BL`)
    indices.push(baseVert, baseVert + 3, baseVert + 2)
    indices.push(baseVert, baseVert + 2, baseVert + 1)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setAttribute('aStripIndex', new THREE.BufferAttribute(stripIndexAttr, 1))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

/**
 * Computes the total compressed horizontal width of the 6-column board for a
 * per-column pleat array (`0` = flat 130 px, `1` = pleated 42.3 px).
 */
export function computeBoardSpanPx(colPleats: readonly number[]): number {
  let total = 0
  for (let c = 0; c < CONCERTINA_COLS; c++) {
    const theta = clamp01(colPleats[c] ?? 0) * MAX_PLEAT_RAD
    total += COL_W * Math.cos(theta)
  }
  return total
}

/**
 * Folds a vertex on the concertina board in Munari content-space coordinates
 * (`x: 0..CONCERTINA_W`, `y: 0..CONCERTINA_H`, `z` out of screen), which
 * `deformSurfaceGeometry` centers around `(0, 0, 0)`.
 * Dispatches strictly by `vertexIndex` (`stripIdx = Math.floor(vertexIndex / 4)`,
 * `corner = vertexIndex % 4`) so `Float32Array` UV rounding never tears a crease.
 */
export function foldConcertinaPoint(
  _xCss: number,
  _yCss: number,
  colPleats: readonly number[],
  vertexIndex: number,
): SurfaceDeformPoint {
  const stripCount = CONCERTINA_COLS * 2
  const stripIdx = Math.max(0, Math.min(stripCount - 1, Math.floor(vertexIndex / 4)))
  const corner = ((vertexIndex % 4) + 4) % 4
  const isRightEdge = corner === 1 || corner === 2
  const isBottomEdge = corner === 2 || corner === 3

  const colIdx = Math.floor(stripIdx / 2)
  const isSecondHalf = stripIdx % 2 === 1

  const totalWidth = computeBoardSpanPx(colPleats)
  let cursorX = (CONCERTINA_W - totalWidth) * 0.5

  for (let c = 0; c < colIdx; c++) {
    const prevTheta = clamp01(colPleats[c] ?? 0) * MAX_PLEAT_RAD
    cursorX += COL_W * Math.cos(prevTheta)
  }

  const theta = clamp01(colPleats[colIdx] ?? 0) * MAX_PLEAT_RAD
  const halfSpanX = HALF_COL_W * Math.cos(theta)
  const peakZ = HALF_COL_W * Math.sin(theta)

  let contentX: number
  let contentZ: number

  if (!isSecondHalf) {
    // Left half-column: rises from valley (z = 0) to mountain ridge (z = +peakZ)
    contentX = isRightEdge ? cursorX + halfSpanX : cursorX
    contentZ = isRightEdge ? peakZ : 0
  } else {
    // Right half-column: descends from mountain ridge (z = +peakZ) back to valley (z = 0)
    contentX = isRightEdge ? cursorX + 2 * halfSpanX : cursorX + halfSpanX
    contentZ = isRightEdge ? 0 : peakZ
  }

  const contentY = isBottomEdge ? CONCERTINA_H : 0
  return {
    x: cleanZero(contentX),
    y: contentY,
    z: cleanZero(contentZ),
  }
}
