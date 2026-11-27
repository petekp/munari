// Pile relief — patches where the pile lies a different way, and fiber grain.
//
// The slope is (−∂h/∂x, −∂h/∂y) at content point `p` (CSS px, y down), a
// unitless rise per CSS px scaled by the finish's detail `depth`.
// Its own chunk, loaded when a finish first uses this detail kind
// (finishLayerCode.ts).

import { type Node } from 'three/webgpu'
import { valueNoise } from './finishNoise'

export function reliefSlope(p: Node<'vec2'>, scale: Node<'float'>, depth: Node<'float'>): Node<'vec2'> {
  const patch = valueNoise(p.div(scale))
  const fiber = valueNoise(p.div(1.4).add(9.1))
  return patch.yz.add(fiber.yz.mul(0.25)).mul(depth)
}
