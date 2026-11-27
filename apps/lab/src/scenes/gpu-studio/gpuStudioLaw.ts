// Pure lens, projection, and pose helpers for GpuStudio — zero framework imports.

import type { GpuViewport, SurfacePose } from '@petepetrash/munari/gpu'

export interface FisheyeParams {
  readonly radius: number
  readonly amplitude: number
}

export const FISHEYE_PARAMS: FisheyeParams = { radius: 120, amplitude: 2 }

export function fisheyeScale(y: number, focus: number, amplitude: number, p: FisheyeParams): number {
  const d = Math.abs(y - focus)
  if (d >= p.radius) return 1
  const c = Math.cos((Math.PI * d) / (2 * p.radius))
  return 1 + (amplitude - 1) * c * c
}

export function fisheyeDisplace(y: number, focus: number, amplitude: number, p: FisheyeParams): number {
  const s = Math.min(p.radius, Math.max(-p.radius, y - focus))
  const grown = (s + p.radius) / 2 + (p.radius / (2 * Math.PI)) * Math.sin((Math.PI * s) / p.radius)
  return y + (amplitude - 1) * (grown - p.radius / 2)
}

export function fisheyeDisplaceX(
  x: number,
  y: number,
  focus: number,
  amplitude: number,
  p: FisheyeParams,
): number {
  return x * fisheyeScale(y, focus, amplitude, p)
}

export function domMatchPose(rect: DOMRect, viewport: GpuViewport): SurfacePose {
  return {
    x: rect.left - viewport.left + rect.width / 2 - viewport.width / 2,
    y: viewport.height / 2 - (rect.top - viewport.top + rect.height / 2),
    z: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    sx: 1,
    sy: 1,
    sz: 1,
  }
}

export interface ScreenPoint {
  readonly x: number
  readonly y: number
}

/** Rotate + translate a local surface point and perspective-project to viewport client pixels. */
export function projectSurfaceLocalPoint(
  pose: SurfacePose,
  localX: number,
  localY: number,
  localZ: number,
  viewport: GpuViewport,
): ScreenPoint {
  const rx = pose.rx ?? 0
  const ry = pose.ry ?? 0
  const rz = pose.rz ?? 0
  let x = localX * (pose.sx ?? 1)
  let y = localY * (pose.sy ?? 1)
  let z = localZ * (pose.sz ?? 1)

  if (rx !== 0) {
    const c = Math.cos(rx)
    const s = Math.sin(rx)
    const ny = y * c - z * s
    const nz = y * s + z * c
    y = ny
    z = nz
  }
  if (ry !== 0) {
    const c = Math.cos(ry)
    const s = Math.sin(ry)
    const nx = x * c + z * s
    const nz = -x * s + z * c
    x = nx
    z = nz
  }
  if (rz !== 0) {
    const c = Math.cos(rz)
    const s = Math.sin(rz)
    const nx = x * c - y * s
    const ny = x * s + y * c
    x = nx
    y = ny
  }

  const wx = pose.x + x
  const wy = pose.y + y
  const wz = pose.z + z
  const dist = Math.max(1, viewport.cameraZ - wz)
  const scale = viewport.cameraZ / dist
  return {
    x: viewport.left + viewport.width / 2 + wx * scale,
    y: viewport.top + viewport.height / 2 - wy * scale,
  }
}
