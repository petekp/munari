// Honeycomb relief — embossed hexagonal cells `scale` px across, each a shallow bowl, so the
// slope breaks sharply at the shared walls; 1 at the cell's flat sides.
//
// The slope is (−∂h/∂x, −∂h/∂y) at content point `p` (CSS px, y down), a
// unitless rise per CSS px scaled by the finish's detail `depth`.
// Its own chunk, loaded when a finish first uses this detail kind
// (finishLayerCode.ts).

import { type Node } from 'three/webgpu'
import { dot, floor, select, vec2 } from 'three/tsl'

export function reliefSlope(p: Node<'vec2'>, scale: Node<'float'>, depth: Node<'float'>): Node<'vec2'> {
  const q = p.div(scale)
  const period = vec2(1, Math.sqrt(3))
  const half = period.mul(0.5)
  const fromA = q.sub(floor(q.div(period)).mul(period)).sub(half)
  const shifted = q.sub(half)
  const fromB = shifted.sub(floor(shifted.div(period)).mul(period)).sub(half)
  const offset = select(dot(fromA, fromA).lessThan(dot(fromB, fromB)), fromA, fromB)
  return offset.mul(2).mul(depth)
}
