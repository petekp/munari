// Material finishes relief — the slope a finish's surface detail adds to
// its normal, per content point, as TSL nodes.
//
// Each detail kind compiles its own noise, so the relief costs nothing for
// a finish without it. The slopes are unitless rises per CSS px, scaled by
// the finish's detailDepth. Paper's fibers and the pulp's formation also
// return a density, which the material uses to tint the body. Long or deep
// fibers read as brushed metal, and a cloudy formation alone as frosted
// glass or leather (blind readers on m2 captures, 2026-11-26).
//
// Ownership: this module builds slope nodes. materialFinishesNodes fades
// them over the rounded edge and decides whether they sit in the coat.

import { type Node } from 'three/webgpu'
import {
  dot,
  float,
  floor,
  fract,
  length,
  min,
  select,
  sin,
  vec2,
  vec3,
} from 'three/tsl'

import type { SurfaceDetail } from './materialFinishesFinish'

// A paper fiber is this many times longer than it is wide, and the cloudy
// formation of the pulp this many times wider than the tooth. Long or deep
// fibers read as brushed metal (m2 captures, 2026-11-26). By eye, unmeasured.
const FIBER_LENGTH = 4
const FORMATION_SCALE = 14

// ── relief ─────────────────────────────────────────────────────────────

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

/**
 * A crumpled sheet as flat facets: the cells of a Voronoi tiling `scale` px
 * across, each tilted by its own random slope in −1..1.
 */
function crumpleSlope(p: Node<'vec2'>, scale: Node<'float'>): Node<'vec2'> {
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
  return slope
}

/**
 * Raised dots on a square grid `scale` px apart, each a paraboloid cap half
 * a cell across. Returns the cap's slope, 1 at its foot.
 */
function dotSlope(p: Node<'vec2'>, scale: Node<'float'>): Node<'vec2'> {
  const offset = fract(p.div(scale)).sub(0.5)
  const capRadius = 0.25
  const onCap = dot(offset, offset).lessThan(capRadius * capRadius)
  return select(onCap, offset.div(-capRadius), vec2(0, 0))
}

/**
 * Embossed hexagonal cells `scale` px across, each a shallow bowl, so the
 * slope breaks sharply at the shared walls. Returns the bowl's slope, 1 at
 * the cell's flat sides.
 */
function honeycombSlope(p: Node<'vec2'>, scale: Node<'float'>): Node<'vec2'> {
  const q = p.div(scale)
  const period = vec2(1, Math.sqrt(3))
  const half = period.mul(0.5)
  const fromA = q.sub(floor(q.div(period)).mul(period)).sub(half)
  const shifted = q.sub(half)
  const fromB = shifted.sub(floor(shifted.div(period)).mul(period)).sub(half)
  const offset = select(dot(fromA, fromA).lessThan(dot(fromB, fromB)), fromA, fromB)
  return offset.mul(2)
}

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

/**
 * The relief's slope (−∂h/∂x, −∂h/∂y) at content point `p` (CSS px, y
 * down). Each octave's slope is its cell gradient times `depth`, so a
 * feature's height grows with its size.
 */
export function reliefSlope(detail: SurfaceDetail, p: Node<'vec2'>, scale: Node<'float'>, depth: Node<'float'>): Node<'vec2'> {
  switch (detail) {
    case 'orange-peel': {
      const coarse = valueNoise(p.div(scale))
      // A second octave on a rotated lattice breaks up the grid.
      const turned = vec2(p.x.mul(0.8).sub(p.y.mul(0.6)), p.x.mul(0.6).add(p.y.mul(0.8)))
      const fine = valueNoise(turned.div(scale.mul(0.43)).add(17.3))
      return coarse.yz.add(fine.yz.mul(0.6)).mul(depth)
    }
    case 'brushed': {
      // Grooves along x: long in x, narrow in y, so the slope is across them.
      const groove = valueNoise(vec2(p.x.div(scale.mul(180)), p.y.div(scale)))
      const hairline = valueNoise(vec2(p.x.div(scale.mul(50)).add(31.7), p.y.div(scale.mul(0.55))))
      return vec2(0, groove.z.add(hairline.z.mul(0.5)).mul(depth))
    }
    case 'pile': {
      // Patches where the pile lies a different way, and fiber grain.
      const patch = valueNoise(p.div(scale))
      const fiber = valueNoise(p.div(1.4).add(9.1))
      return patch.yz.add(fiber.yz.mul(0.25)).mul(depth)
    }
    case 'glaze':
      return valueNoise(p.div(scale)).yz.mul(depth)
    case 'crumple':
      return crumpleSlope(p, scale).mul(depth)
    case 'fiber':
      return fiberRelief(p, scale).yz.mul(depth)
    case 'dots':
      return dotSlope(p, scale).mul(depth)
    case 'honeycomb':
      return honeycombSlope(p, scale).mul(depth)
    case 'none':
      return vec2(0, 0)
  }
}

/** Whether a finish's relief sits in its clear coat rather than its base. */
export function reliefIsInCoat(detail: SurfaceDetail): boolean {
  return detail === 'orange-peel' || detail === 'glaze'
}
