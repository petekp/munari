// Glaze relief — one octave of value noise, the slow undulation of a fired glaze.
//
// The slope is (−∂h/∂x, −∂h/∂y) at content point `p` (CSS px, y down), a
// unitless rise per CSS px scaled by the finish's detail `depth`.
// Its own chunk, loaded when a finish first uses this detail kind
// (finishLayerCode.ts).

import { type Node } from 'three/webgpu'
import { valueNoise } from './finishNoise'

export function reliefSlope(p: Node<'vec2'>, scale: Node<'float'>, depth: Node<'float'>): Node<'vec2'> {
  return valueNoise(p.div(scale)).yz.mul(depth)
}
