import { describe, expect, it } from 'vitest'
import { evaluatePeelPoint, peelCreaseLine, type PeelParams } from './frontierPeelLaw'

const BASE: PeelParams = {
  width: 640,
  height: 368,
  amount: 0.54,
  angleRad: 0.46,
  radiusPx: 40,
}

describe('frontierPeelLaw', () => {
  it('leaves the entire sheet flat at z = 0 when amount is 0', () => {
    const flat = { ...BASE, amount: 0 }
    for (const [x, y] of [[0, 0], [320, 184], [640, 368]] as const) {
      expect(evaluatePeelPoint(x, y, flat)).toEqual({ x, y, z: 0 })
    }
  })

  it('is C0 continuous across both the flat-to-cylinder (d = 0) and cylinder-to-flap (d = pi*R) seams', () => {
    const { nx, ny, lineDist } = peelCreaseLine(BASE)
    const pointAtD = (d: number) => {
      const distFromOrigin = lineDist + d
      return evaluatePeelPoint(nx * distFromOrigin, ny * distFromOrigin, BASE)
    }

    const eps = 1e-4
    const beforeCrease = pointAtD(-eps)
    const afterCrease = pointAtD(eps)
    expect(Math.hypot(afterCrease.x - beforeCrease.x, afterCrease.y - beforeCrease.y, (afterCrease.z ?? 0) - (beforeCrease.z ?? 0))).toBeLessThan(1e-3)

    const piR = Math.PI * BASE.radiusPx
    const beforeTop = pointAtD(piR - eps)
    const afterTop = pointAtD(piR + eps)
    expect(Math.hypot(afterTop.x - beforeTop.x, afterTop.y - beforeTop.y, (afterTop.z ?? 0) - (beforeTop.z ?? 0))).toBeLessThan(1e-3)
  })

  it('preserves isometric paper arclength along the curl normal in all three zones', () => {
    const { nx, ny, lineDist } = peelCreaseLine(BASE)
    const ds = 0.05
    const piR = Math.PI * BASE.radiusPx

    for (const d of [-30, BASE.radiusPx * 0.8, BASE.radiusPx * 2.1, piR + 40]) {
      const s0 = lineDist + d
      const s1 = s0 + ds
      const p0 = evaluatePeelPoint(nx * s0, ny * s0, BASE)
      const p1 = evaluatePeelPoint(nx * s1, ny * s1, BASE)
      const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y, (p1.z ?? 0) - (p0.z ?? 0))
      expect(chord / ds).toBeGreaterThan(0.999)
      expect(chord / ds).toBeLessThan(1.002)
    }
  })
})
