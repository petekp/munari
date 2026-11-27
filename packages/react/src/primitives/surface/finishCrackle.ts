// Finish crackle — the network of fine lines a crazed glaze shows, as the
// coverage that darkens the body.
//
// Its own chunk, loaded when a finish first uses crackle (finishLayerCode.ts).

import { type Node } from 'three/webgpu'
import { float, floor, length, max, min, smoothstep, vec2 } from 'three/tsl'

import { latticeHash } from './finishNoise'

// Crackle lines are this many CSS px wide where the cell borders meet.
// By eye, unmeasured.
const CRACKLE_LINE_PX = 0.9

/**
 * Coverage of a crackle network at content point `p`, 0 to 1: the borders
 * of a Voronoi tiling with cells `scale` px across. The border is where the
 * nearest and second-nearest cell points are equally far.
 */
export function crackleLines(p: Node<'vec2'>, scale: Node<'float'>): Node<'float'> {
  const q = p.div(scale)
  const cell = floor(q)
  let nearest: Node<'float'> = float(8)
  let second: Node<'float'> = float(8)
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      const neighbor = cell.add(vec2(x, y))
      const point = neighbor.add(vec2(latticeHash(neighbor), latticeHash(neighbor.add(19.19))))
      const distance = length(point.sub(q))
      second = min(max(nearest, distance), second)
      nearest = min(nearest, distance)
    }
  }
  const gap = second.sub(nearest)
  const line = float(CRACKLE_LINE_PX).div(scale)
  // The gap grows at about two per cell unit across a border.
  return float(1).sub(smoothstep(line, line.mul(2.5), gap))
}
