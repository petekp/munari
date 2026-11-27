// Dots relief — raised dots on a square grid `scale` px apart, each a paraboloid cap half a
// cell across, with a slope of 1 at its foot.
//
// The slope is (−∂h/∂x, −∂h/∂y) at content point `p` (CSS px, y down), a
// unitless rise per CSS px scaled by the finish's detail `depth`.
// Its own chunk, loaded when a finish first uses this detail kind
// (finishLayerCode.ts).

import { type Node } from 'three/webgpu'
import { dot, fract, select, vec2 } from 'three/tsl'

export function reliefSlope(p: Node<'vec2'>, scale: Node<'float'>, depth: Node<'float'>): Node<'vec2'> {
  const offset = fract(p.div(scale)).sub(0.5)
  const capRadius = 0.25
  const onCap = dot(offset, offset).lessThan(capRadius * capRadius)
  return select(onCap, offset.div(-capRadius), vec2(0, 0)).mul(depth)
}
