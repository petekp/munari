// Orange-peel relief — two octaves of value noise, the second on a rotated lattice so the grid breaks up.
//
// The slope is (−∂h/∂x, −∂h/∂y) at content point `p` (CSS px, y down), a
// unitless rise per CSS px scaled by the finish's detail `depth`.
// Its own chunk, loaded when a finish first uses this detail kind
// (finishLayerCode.ts).

import { type Node } from 'three/webgpu'
import { vec2 } from 'three/tsl'

import { valueNoise } from './finishNoise'

export function reliefSlope(p: Node<'vec2'>, scale: Node<'float'>, depth: Node<'float'>): Node<'vec2'> {
  const coarse = valueNoise(p.div(scale))
  const turned = vec2(p.x.mul(0.8).sub(p.y.mul(0.6)), p.x.mul(0.6).add(p.y.mul(0.8)))
  const fine = valueNoise(turned.div(scale.mul(0.43)).add(17.3))
  return coarse.yz.add(fine.yz.mul(0.6)).mul(depth)
}
