// Crumple relief — a crumpled sheet as flat facets: the cells of a Voronoi tiling `scale` px
// across, each tilted by its own random slope in −1..1.
//
// The slope is (−∂h/∂x, −∂h/∂y) at content point `p` (CSS px, y down), a
// unitless rise per CSS px scaled by the finish's detail `depth`.
// Its own chunk, loaded when a finish first uses this detail kind
// (finishLayerCode.ts).

import { type Node } from 'three/webgpu'
import { float, floor, length, min, select, vec2 } from 'three/tsl'

import { latticeHash } from './finishNoise'

export function reliefSlope(p: Node<'vec2'>, scale: Node<'float'>, depth: Node<'float'>): Node<'vec2'> {
  const q = p.div(scale)
  const cell = floor(q)
  let nearest: Node<'float'> = float(8)
  let slope: Node<'vec2'> = vec2(0, 0)
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      const neighbor = cell.add(vec2(x, y))
      const point = neighbor.add(vec2(latticeHash(neighbor), latticeHash(neighbor.add(19.19))))
      const distance = length(point.sub(q))
      const tilt = vec2(latticeHash(neighbor.add(41.3)), latticeHash(neighbor.add(73.9))).mul(2).sub(1)
      slope = select(distance.lessThan(nearest), tilt, slope)
      nearest = min(nearest, distance)
    }
  }
  return slope.mul(depth)
}
