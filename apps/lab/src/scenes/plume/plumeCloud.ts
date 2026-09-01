// Plume cloud — one deterministic billboard grid over the writing box.
//
// The law: every grain starts at the exact texture footprint it samples, so
// the field reconstructs the DOM before motion. Release times are stamped
// from paint-matched Surface anchors, never from a live layout beside an old
// texture.
//
// The fault behind the quad layout, measured in the candidates bench on
// 2026-08-20: Surface presenters are meshes, not THREE.Points, and point
// size is capped at 63px on some Intel drivers. Quads avoid both limits.
// Ownership: this module owns buffers and anchor-to-cell stamping only.

import * as THREE from 'three'
import type { SourceUvRect } from '@petepetrash/munari'
import type { TimedUnit } from './plumeLaw'

const CORNERS: readonly (readonly [number, number])[] = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
]

const UNRELEASED = 1e9

export interface PlumeGrid {
  readonly geometry: THREE.BufferGeometry
  readonly width: number
  readonly height: number
  readonly cols: number
  readonly rows: number
  readonly cellWidth: number
  readonly cellHeight: number
}

function hash01(value: number): number {
  const x = Math.sin(value * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

export function buildPlumeGrid(width: number, height: number, pitch: number): PlumeGrid {
  const cols = Math.max(1, Math.ceil(width / pitch))
  const rows = Math.max(1, Math.ceil(height / pitch))
  const cells = cols * rows
  const position = new Float32Array(cells * 4 * 3)
  const corner = new Float32Array(cells * 4 * 2)
  const uv = new Float32Array(cells * 4 * 2)
  const seed = new Float32Array(cells * 4 * 3)
  const release = new Float32Array(cells * 4)
  const index = new Uint32Array(cells * 6)
  release.fill(UNRELEASED)

  const cellWidth = width / cols
  const cellHeight = height / rows
  let vertex = 0
  let face = 0
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const u = (col + 0.5) / cols
      const down = (row + 0.5) / rows
      const x = (u - 0.5) * width
      const y = (0.5 - down) * height
      const cell = row * cols + col
      const seeds = [hash01(cell + 1), hash01(cell + 1013), hash01(cell + 7919)]
      const base = vertex
      for (const [cornerX, cornerY] of CORNERS) {
        position[vertex * 3] = x
        position[vertex * 3 + 1] = y
        corner[vertex * 2] = cornerX
        corner[vertex * 2 + 1] = cornerY
        uv[vertex * 2] = u
        uv[vertex * 2 + 1] = 1 - down
        seed[vertex * 3] = seeds[0] ?? 0
        seed[vertex * 3 + 1] = seeds[1] ?? 0
        seed[vertex * 3 + 2] = seeds[2] ?? 0
        vertex++
      }
      index[face++] = base
      index[face++] = base + 1
      index[face++] = base + 2
      index[face++] = base
      index[face++] = base + 2
      index[face++] = base + 3
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geometry.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2))
  geometry.setAttribute('aUv', new THREE.BufferAttribute(uv, 2))
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3))
  geometry.setAttribute('aRelease', new THREE.BufferAttribute(release, 1))
  geometry.setIndex(new THREE.BufferAttribute(index, 1))
  // Particles intentionally leave the source box. A source-fitted sphere would
  // cull the effect at the exact point it becomes visible.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4000)
  return { geometry, width, height, cols, rows, cellWidth, cellHeight }
}

function clampCell(value: number, max: number): number {
  return Math.min(max - 1, Math.max(0, value))
}

/** Stamp absolute release seconds into every cell covered by a unit box. */
export function stampPlumeReleases(
  grid: PlumeGrid,
  units: readonly TimedUnit[],
  anchors: Readonly<Record<string, SourceUvRect>>,
): void {
  const attribute = grid.geometry.getAttribute('aRelease')
  if (!(attribute instanceof THREE.BufferAttribute)) return
  const release = attribute.array
  release.fill(UNRELEASED)

  for (const unit of units) {
    const box = anchors[unit.id]
    if (!box) continue
    const colStart = clampCell(Math.floor(box.uMin * grid.cols), grid.cols)
    const colEnd = clampCell(Math.ceil(box.uMax * grid.cols) - 1, grid.cols)
    const rowStart = clampCell(Math.floor((1 - box.vMax) * grid.rows), grid.rows)
    const rowEnd = clampCell(Math.ceil((1 - box.vMin) * grid.rows) - 1, grid.rows)
    const releaseSeconds = unit.releaseAt / 1000
    for (let row = rowStart; row <= rowEnd; row++) {
      for (let col = colStart; col <= colEnd; col++) {
        const cell = row * grid.cols + col
        const start = cell * 4
        release[start] = releaseSeconds
        release[start + 1] = releaseSeconds
        release[start + 2] = releaseSeconds
        release[start + 3] = releaseSeconds
      }
    }
  }
  attribute.needsUpdate = true
}
