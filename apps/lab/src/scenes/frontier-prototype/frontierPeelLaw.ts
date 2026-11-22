// Isometric cylindrical paper-peel law — pure C1-continuous rolling curl in content px.
//
// Given a card of size [w, h] (origin top-left, +X right, +Y down) and peel progress
// `amount` in [0, 1], points with signed distance d <= 0 from the crease stay flat at z = 0;
// 0 < d <= pi*R wrap around a cylinder of radius R; d > pi*R fold back isometrically at z >= 2R.

import type { SurfaceDeformPoint } from '@petepetrash/munari'

export interface PeelParams {
  readonly width: number
  readonly height: number
  /** Normalized peel progress: 0 = flat, 1 = deep peel across card. */
  readonly amount: number
  /** Inward curl normal angle in radians (+X right, +Y down). ~0.68 rad = bottom-right corner. */
  readonly angleRad: number
  /** Rolling cylinder radius in CSS pixels. */
  readonly radiusPx: number
}

export interface PeelCrease {
  readonly nx: number
  readonly ny: number
  readonly lineDist: number
  readonly maxDist: number
}

export function peelCreaseLine(params: PeelParams): PeelCrease {
  const nx = Math.cos(params.angleRad)
  const ny = Math.sin(params.angleRad)
  const maxDist = Math.max(1, params.width * nx + params.height * ny)
  const clamped = Math.max(0, Math.min(1, params.amount))
  const lineDist = maxDist * (1 - clamped * 0.86)
  return { nx, ny, lineDist, maxDist }
}

export function evaluatePeelPoint(
  x: number,
  y: number,
  params: PeelParams,
): SurfaceDeformPoint {
  if (params.amount <= 0.0005) {
    return { x, y, z: 0 }
  }
  const { nx, ny, lineDist } = peelCreaseLine(params)
  const r = Math.max(12, params.radiusPx)
  const d = x * nx + y * ny - lineDist
  if (d <= 0) {
    return { x, y, z: 0 }
  }
  const piR = Math.PI * r
  if (d <= piR) {
    const alpha = d / r
    const shift = r * Math.sin(alpha) - d
    return {
      x: x + shift * nx,
      y: y + shift * ny,
      z: r * (1 - Math.cos(alpha)),
    }
  }
  const over = d - piR
  const shift = piR - 2 * d
  return {
    x: x + shift * nx,
    y: y + shift * ny,
    // Gentle 0.04 slope prevents z-fighting where deep folds overlap the curl crest.
    z: 2 * r + over * 0.04,
  }
}
