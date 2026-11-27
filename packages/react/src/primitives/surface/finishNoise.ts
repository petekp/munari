// Finish noise — the lattice hash and value noise that the relief kinds, the
// film and the crackle build on, as TSL nodes.
//
// Ownership: shared by the layer chunks that need it (finishLayerCode.ts);
// it loads with the first of them.

import { type Node } from 'three/webgpu'
import { dot, float, floor, fract, sin, vec2, vec3 } from 'three/tsl'

export const latticeHash = (cell: Node<'vec2'>) => fract(sin(dot(cell, vec2(127.1, 311.7))).mul(43758.5453))

/** Value noise in −1..1 with its gradient per lattice cell: (value, ∂/∂x, ∂/∂y). */
export function valueNoise(p: Node<'vec2'>): Node<'vec3'> {
  const cell = floor(p)
  const f = fract(p)
  const u = f.mul(f).mul(float(3).sub(f.mul(2)))
  const du = f.mul(float(1).sub(f)).mul(6)
  const a = latticeHash(cell)
  const b = latticeHash(cell.add(vec2(1, 0)))
  const c = latticeHash(cell.add(vec2(0, 1)))
  const d = latticeHash(cell.add(vec2(1, 1)))
  const k = a.sub(b).sub(c).add(d)
  const value = a.add(b.sub(a).mul(u.x)).add(c.sub(a).mul(u.y)).add(k.mul(u.x).mul(u.y))
  const dx = du.x.mul(b.sub(a).add(k.mul(u.y)))
  const dy = du.y.mul(c.sub(a).add(k.mul(u.x)))
  return vec3(value.mul(2).sub(1), dx.mul(2), dy.mul(2))
}
