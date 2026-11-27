// Fiber relief — paper: the sheet's tooth, short fibers laid three ways, and
// the cloudy formation of the pulp, as a slope and a density.
//
// The slope is (−∂h/∂x, −∂h/∂y) at content point `p` (CSS px, y down), a
// unitless rise per CSS px scaled by the finish's detail `depth`.
// The density tints the body (finishNodes.ts). Long or deep fibers read as
// brushed metal, and a cloudy formation alone as frosted glass or leather
// (blind readers on m2 captures, 2026-11-26). Its own chunk, loaded when a
// finish first uses this detail kind (finishLayerCode.ts).

import { type Node } from 'three/webgpu'
import { dot, float, vec2, vec3 } from 'three/tsl'

import { valueNoise } from './finishNoise'

// A paper fiber is this many times longer than it is wide, and the cloudy
// formation of the pulp this many times wider than the tooth. Long or deep
// fibers read as brushed metal (m2 captures, 2026-11-26). By eye, unmeasured.
const FIBER_LENGTH = 4
const FORMATION_SCALE = 14

/**
 * Paper at content point `p`: the sheet's tooth `scale` px across, short
 * fibers as wide laid three ways, and the cloudy formation of the pulp.
 * Returns (density in −1..1, slope x, slope y).
 */
export function fiberRelief(p: Node<'vec2'>, scale: Node<'float'>): Node<'vec3'> {
  let value: Node<'float'> = float(0)
  let slope: Node<'vec2'> = vec2(0, 0)
  const angles = [0.35, 1.45, 2.6]
  angles.forEach((angle, index) => {
    const along = vec2(Math.cos(angle), Math.sin(angle))
    const across = vec2(-Math.sin(angle), Math.cos(angle))
    const fiber = valueNoise(vec2(dot(p, along).div(scale.mul(FIBER_LENGTH)), dot(p, across).div(scale)).add(11.7 * (index + 1)))
    value = value.add(fiber.x)
    // Each fiber is a ridge, so its slope runs across it.
    slope = slope.add(across.mul(fiber.z))
  })
  const tooth = valueNoise(p.div(scale).add(3.7))
  const formation = valueNoise(p.div(scale.mul(FORMATION_SCALE)).add(21.4)).x
  return vec3(value.div(angles.length).mul(0.4).add(formation.mul(0.6)), slope.mul(0.35).add(tooth.yz))
}

export function reliefSlope(p: Node<'vec2'>, scale: Node<'float'>, depth: Node<'float'>): Node<'vec2'> {
  return fiberRelief(p, scale).yz.mul(depth)
}
