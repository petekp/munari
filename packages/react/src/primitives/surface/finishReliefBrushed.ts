// Brushed relief — grooves and hairlines along x, long in x and narrow in y, so the slope runs across them.
//
// The slope is (−∂h/∂x, −∂h/∂y) at content point `p` (CSS px, y down), a
// unitless rise per CSS px scaled by the finish's detail `depth`.
// Its own chunk, loaded when a finish first uses this detail kind
// (finishLayerCode.ts).

import { type Node } from 'three/webgpu'
import { vec2 } from 'three/tsl'

import { valueNoise } from './finishNoise'

export function reliefSlope(p: Node<'vec2'>, scale: Node<'float'>, depth: Node<'float'>): Node<'vec2'> {
  const groove = valueNoise(vec2(p.x.div(scale.mul(180)), p.y.div(scale)))
  const hairline = valueNoise(vec2(p.x.div(scale.mul(50)).add(31.7), p.y.div(scale.mul(0.55))))
  return vec2(0, groove.z.add(hairline.z.mul(0.5)).mul(depth))
}
