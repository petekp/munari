import { describe, expect, it } from 'vitest'
import { sampleUvPosition } from '../../../packages/core/src/mapping/uvSampling'

// A unit plane centered on the origin, two triangles, UVs origin bottom-left
// — the geometry every Surface has until a scene gives it another.
const PLANE = {
  position: [-0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 0],
  uv: [0, 1, 1, 1, 0, 0, 1, 0],
  index: [0, 2, 1, 2, 3, 1],
}

describe('where a texture coordinate lands on the geometry', () => {
  it('maps the middle of a plane to the middle of the plane', () => {
    const sample = sampleUvPosition(PLANE.position, PLANE.uv, PLANE.index, 0.5, 0.5)
    expect(sample).not.toBeNull()
    expect(sample!.x).toBeCloseTo(0, 6)
    expect(sample!.y).toBeCloseTo(0, 6)
    expect(sample!.z).toBeCloseTo(0, 6)
    expect(sample!.inside).toBe(true)
  })

  it('maps each corner to its own corner', () => {
    const bottomLeft = sampleUvPosition(PLANE.position, PLANE.uv, PLANE.index, 0, 0)!
    expect([bottomLeft.x, bottomLeft.y]).toEqual([-0.5, -0.5])
    const topRight = sampleUvPosition(PLANE.position, PLANE.uv, PLANE.index, 1, 1)!
    expect([topRight.x, topRight.y]).toEqual([0.5, 0.5])
  })

  it('reports the plane facing normal', () => {
    const sample = sampleUvPosition(PLANE.position, PLANE.uv, PLANE.index, 0.25, 0.75)!
    expect(sample.nx).toBeCloseTo(0, 6)
    expect(sample.ny).toBeCloseTo(0, 6)
    expect(sample.nz).toBeCloseTo(1, 6)
  })

  // The fault this module exists for: a deformed sheet's UVs are no longer a
  // linear remap of its box, so plane math places matter off the surface.
  it('follows a deformed sheet instead of its flat box', () => {
    // The same plane with its right edge folded a quarter turn toward the
    // camera. Plane math would still answer z = 0 at u = 1.
    const position = [-0.5, 0.5, 0, 0.5, 0.5, 0.5, -0.5, -0.5, 0, 0.5, -0.5, 0.5]
    const sample = sampleUvPosition(position, PLANE.uv, PLANE.index, 1, 0.5)!
    expect(sample.x).toBeCloseTo(0.5, 6)
    expect(sample.z).toBeCloseTo(0.5, 6)
  })

  it('reads a non-indexed geometry too', () => {
    const position = [-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0]
    const uv = [0, 0, 1, 0, 0, 1]
    const sample = sampleUvPosition(position, uv, null, 0.25, 0.25)!
    expect(sample.x).toBeCloseTo(-0.25, 6)
    expect(sample.y).toBeCloseTo(-0.25, 6)
  })

  // A UV layout has seams and gutters. An anchor half a texel outside every
  // triangle is a rounding accident, not a request to disappear — and a
  // withheld anchor is a hole in the scene nobody can explain.
  it('uses the nearest triangle when nothing contains the point', () => {
    const sample = sampleUvPosition(PLANE.position, PLANE.uv, PLANE.index, 1.02, 0.5)!
    expect(sample.inside).toBe(false)
    expect(sample.x).toBeCloseTo(0.5, 6)
  })

  it('answers null when there is no triangle at all', () => {
    expect(sampleUvPosition([], [], null, 0.5, 0.5)).toBeNull()
  })

  it('skips a collapsed triangle rather than dividing by zero', () => {
    // A fold that pinched two vertices together: zero UV area, no inside.
    const position = [0, 0, 0, 1, 0, 0, 0, 1, 0, -0.5, 0.5, 0, 0.5, 0.5, 0, 0, -0.5, 0]
    const uv = [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0.5, 0]
    const sample = sampleUvPosition(position, uv, null, 0.5, 0.5)
    expect(sample).not.toBeNull()
    expect(Number.isFinite(sample!.x)).toBe(true)
  })
})
