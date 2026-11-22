// 3D packaging dieline geometry and dihedral folding law — maps a flat 696x504
// 9-panel live HTML carton net (Front, Left Spine, Right Spine, Back Wall,
// Top Lid, Tuck Tongue, Bottom Base, and 2 Side Dust Flaps) onto a watertight
// 216x216x112 3D box via `deformSurfaceGeometry`.
//
// Dispatches each vertex by `panelIndex = Math.floor(vertexIndex / 4)` rather
// than branching on Float32-reconstructed `uv * size` coordinates, preventing
// IEEE-754 boundary rounding (`Math.fround(352 / 696) * 696 > 352`) from
// misrouting shared seam corners.

import * as THREE from 'three'
import type { SurfaceDeformPoint } from '@petepetrash/munari'

export const DIELINE_W = 696
export const DIELINE_H = 504

export const BOX_LEFT = 136
export const BOX_RIGHT = 352
export const BOX_BACK_RIGHT = 568
export const BOX_TOP = 156
export const BOX_BOTTOM = 372
export const BOX_W = BOX_RIGHT - BOX_LEFT // 216
export const BOX_H = BOX_BOTTOM - BOX_TOP // 216
export const BOX_DEPTH = 112
export const TUCK_HINGE_Y = 44
export const DUST_TOP_Y = 102

type PanelKind =
  | 'front'
  | 'left'
  | 'right'
  | 'back'
  | 'bottom'
  | 'top'
  | 'tuck'
  | 'dust-left'
  | 'dust-right'

interface PanelSpec {
  readonly kind: PanelKind
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
  readonly topTaperingPx?: number
}

const DIELINE_PANELS: readonly PanelSpec[] = [
  { kind: 'front', x0: BOX_LEFT, y0: BOX_TOP, x1: BOX_RIGHT, y1: BOX_BOTTOM },
  { kind: 'left', x0: BOX_LEFT - BOX_DEPTH, y0: BOX_TOP, x1: BOX_LEFT, y1: BOX_BOTTOM },
  { kind: 'right', x0: BOX_RIGHT, y0: BOX_TOP, x1: BOX_RIGHT + BOX_DEPTH, y1: BOX_BOTTOM },
  {
    kind: 'back',
    x0: BOX_RIGHT + BOX_DEPTH,
    y0: BOX_TOP,
    x1: BOX_RIGHT + BOX_DEPTH + BOX_W,
    y1: BOX_BOTTOM,
  },
  { kind: 'bottom', x0: BOX_LEFT, y0: BOX_BOTTOM, x1: BOX_RIGHT, y1: BOX_BOTTOM + BOX_DEPTH },
  { kind: 'top', x0: BOX_LEFT, y0: TUCK_HINGE_Y, x1: BOX_RIGHT, y1: BOX_TOP },
  {
    kind: 'tuck',
    x0: BOX_LEFT + 8,
    y0: 10,
    x1: BOX_RIGHT - 8,
    y1: TUCK_HINGE_Y,
    topTaperingPx: 10,
  },
  {
    kind: 'dust-left',
    x0: BOX_LEFT - BOX_DEPTH + 8,
    y0: DUST_TOP_Y,
    x1: BOX_LEFT - 1,
    y1: BOX_TOP,
    topTaperingPx: 10,
  },
  {
    kind: 'dust-right',
    x0: BOX_RIGHT + 1,
    y0: DUST_TOP_Y,
    x1: BOX_RIGHT + BOX_DEPTH - 8,
    y1: BOX_TOP,
    topTaperingPx: 10,
  },
]

export function foldDielinePoint(
  x: number,
  y: number,
  foldT: number,
  vertexIndex: number,
): SurfaceDeformPoint {
  const t = Math.max(0, Math.min(1, foldT))
  const theta = t * (Math.PI * 0.5)
  const cos1 = Math.cos(theta)
  const sin1 = Math.sin(theta)
  const cos2 = Math.cos(theta * 2)
  const sin2 = Math.sin(theta * 2)

  // Keep the folded 216x216x112 prism centered at (DIELINE_W/2, DIELINE_H/2, 0)
  const shiftX = t * (DIELINE_W * 0.5 - (BOX_LEFT + BOX_RIGHT) * 0.5)
  const shiftY = t * (DIELINE_H * 0.5 - (BOX_TOP + BOX_BOTTOM) * 0.5)
  const zFront = t * (BOX_DEPTH * 0.5)

  const kind = DIELINE_PANELS[Math.floor(vertexIndex / 4)]?.kind ?? 'front'

  let px = x
  let py = y
  let pz = zFront

  if (kind === 'left') {
    const d = Math.max(0, BOX_LEFT - x)
    px = BOX_LEFT - d * cos1
    pz = zFront - d * sin1
  } else if (kind === 'right') {
    const d = Math.max(0, x - BOX_RIGHT)
    px = BOX_RIGHT + d * cos1
    pz = zFront - d * sin1
  } else if (kind === 'back') {
    const hingeX = BOX_RIGHT + BOX_DEPTH * cos1
    const hingeZ = zFront - BOX_DEPTH * sin1
    const d2 = Math.max(0, x - (BOX_RIGHT + BOX_DEPTH))
    px = hingeX + d2 * cos2
    pz = hingeZ - d2 * sin2
  } else if (kind === 'bottom') {
    const d = Math.max(0, y - BOX_BOTTOM)
    py = BOX_BOTTOM + d * cos1
    pz = zFront - d * sin1
  } else if (kind === 'top') {
    const d = Math.max(0, BOX_TOP - y)
    py = BOX_TOP - d * cos1
    pz = zFront - d * sin1
  } else if (kind === 'tuck') {
    const dLid = BOX_TOP - TUCK_HINGE_Y
    const hingeY = BOX_TOP - dLid * cos1
    const hingeZ = zFront - dLid * sin1
    const dTab = Math.max(0, TUCK_HINGE_Y - y)
    // Inset tuck flap 1.2 px inside back wall (`t * 1.2`) to prevent Z-fighting at 100%
    const tuckInset = t * 1.2
    py = hingeY - dTab * cos2
    pz = hingeZ - dTab * sin2 + tuckInset
  } else if (kind === 'dust-left') {
    // Dust flap hinges 90 deg with left spine, then folds 90 deg inward under top lid
    const dx = Math.max(0, BOX_LEFT - x)
    const dy = Math.max(0, BOX_TOP - y)
    const flapTheta = Math.min(Math.PI * 0.5, theta * 1.06)
    const fCos = Math.cos(flapTheta)
    const fSin = Math.sin(flapTheta)
    // In spine-local coords: spine runs along (-cos1, 0, -sin1), inward normal is (+sin1, 0, -cos1)
    const localInward = dy * fSin
    py = BOX_TOP - dy * fCos + t * 1.4
    px = BOX_LEFT - dx * cos1 + localInward * sin1
    pz = zFront - dx * sin1 - localInward * cos1
  } else if (kind === 'dust-right') {
    const dx = Math.max(0, x - BOX_RIGHT)
    const dy = Math.max(0, BOX_TOP - y)
    const flapTheta = Math.min(Math.PI * 0.5, theta * 1.06)
    const fCos = Math.cos(flapTheta)
    const fSin = Math.sin(flapTheta)
    const localInward = dy * fSin
    py = BOX_TOP - dy * fCos + t * 1.4
    px = BOX_RIGHT + dx * cos1 - localInward * sin1
    pz = zFront - dx * sin1 - localInward * cos1
  }

  return {
    x: px + shiftX,
    y: py + shiftY,
    z: pz,
  }
}

export function createDielineCrossGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(DIELINE_PANELS.length * 4 * 3)
  const uvs = new Float32Array(DIELINE_PANELS.length * 4 * 2)
  const creases = new Float32Array(DIELINE_PANELS.length * 4)
  const indices: number[] = []

  DIELINE_PANELS.forEach((p, idx) => {
    const taper = p.topTaperingPx ?? 0
    const corners: readonly (readonly [number, number, number])[] = [
      [p.x0 + taper, p.y0, p.kind === 'bottom' || p.kind === 'right' || p.kind === 'back' ? 1 : 0],
      [p.x1 - taper, p.y0, p.kind === 'bottom' || p.kind === 'left' ? 1 : 0],
      [
        p.x1,
        p.y1,
        p.kind === 'top' || p.kind === 'tuck' || p.kind === 'left' || p.kind.startsWith('dust') ? 1 : 0,
      ],
      [
        p.x0,
        p.y1,
        p.kind === 'top' || p.kind === 'tuck' || p.kind === 'right' || p.kind === 'back' || p.kind.startsWith('dust')
          ? 1
          : 0,
      ],
    ]

    const base = idx * 4
    corners.forEach(([cx, cy, isCrease], cIdx) => {
      const vi = base + cIdx
      positions[vi * 3] = cx - DIELINE_W * 0.5
      positions[vi * 3 + 1] = DIELINE_H * 0.5 - cy
      positions[vi * 3 + 2] = 0
      uvs[vi * 2] = cx / DIELINE_W
      uvs[vi * 2 + 1] = 1 - cy / DIELINE_H
      creases[vi] = isCrease
    })

    indices.push(base + 0, base + 3, base + 2, base + 0, base + 2, base + 1)
  })

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setAttribute('aCrease', new THREE.BufferAttribute(creases, 1))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}
