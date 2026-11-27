// Pure fisheye magnification law (copied from apps/lab/src/scenes/fisheye/fisheyeLaw.ts
// so instruments/ stays decoupled from apps/).

export interface FisheyeParams {
  readonly radius: number
  readonly amplitude: number
}

export const FISHEYE_DEFAULTS: FisheyeParams = { radius: 120, amplitude: 2 }

export function fisheyeScale(
  y: number,
  focus: number,
  amplitude: number,
  p: FisheyeParams,
): number {
  const d = Math.abs(y - focus)
  if (d >= p.radius) return 1
  const c = Math.cos((Math.PI * d) / (2 * p.radius))
  return 1 + (amplitude - 1) * c * c
}

export function fisheyeDisplace(
  y: number,
  focus: number,
  amplitude: number,
  p: FisheyeParams,
): number {
  const s = Math.min(p.radius, Math.max(-p.radius, y - focus))
  const grown =
    (s + p.radius) / 2 + (p.radius / (2 * Math.PI)) * Math.sin((Math.PI * s) / p.radius)
  return y + (amplitude - 1) * (grown - p.radius / 2)
}

export function fisheyeDisplaceX(
  x: number,
  y: number,
  center: number,
  focus: number,
  amplitude: number,
  p: FisheyeParams,
): number {
  return center + (x - center) * fisheyeScale(y, focus, amplitude, p)
}

export function fisheyeSource(
  target: number,
  focus: number,
  amplitude: number,
  p: FisheyeParams,
): number {
  const spread = ((amplitude - 1) * p.radius) / 2 + 1
  let lo = target - spread
  let hi = target + spread
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2
    if (fisheyeDisplace(mid, focus, amplitude, p) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
