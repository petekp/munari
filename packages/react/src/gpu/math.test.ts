// Verifies [0, 1] WebGPU camera projection and inverse-world indexed-mesh ray picking.
import { describe, expect, it } from 'vitest'
import {
  computeAabb,
  mat4FromPositionEulerScale,
  mat4Identity,
  mat4Invert,
  mat4Multiply,
  mat4PerspectiveZeroToOne,
  rayFromNdc,
  raycastIndexedMesh,
} from './math'

describe('gpu math & raycaster', () => {
  it('inverts a TRS world matrix cleanly and hits tilted quads with accurate UV', () => {
    const world = mat4FromPositionEulerScale(120, -40, 80, -0.1, 0.25, 0, 1, 1, 1)
    const inv = mat4Identity()
    expect(mat4Invert(world, inv)).toBe(true)

    const prod = mat4Multiply(world, inv)
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        expect(prod[c * 4 + r]).toBeCloseTo(c === r ? 1 : 0, 5)
      }
    }

    const view = mat4FromPositionEulerScale(0, 0, -1000, 0, 0, 0, 1, 1, 1)
    const proj = mat4PerspectiveZeroToOne(42, 1200 / 800, 1, 3000)
    const vp = mat4Multiply(proj, view)
    const invVp = mat4Identity()
    expect(mat4Invert(vp, invVp)).toBe(true)

    const positions = new Float32Array([
      -100, 50, 0,
      100, 50, 0,
      -100, -50, 0,
      100, -50, 0,
    ])
    const uvs = new Float32Array([
      0, 1,
      1, 1,
      0, 0,
      1, 0,
    ])
    const indices = new Uint32Array([0, 2, 1, 1, 2, 3])
    const bounds = computeAabb(positions)

    // Cast ray at the projected world center (x=120, y=-40, z=80) -> should hit u~0.5, v~0.5
    const ndcX = ((vp[0]! * 120 + vp[4]! * -40 + vp[8]! * 80 + vp[12]!) / (vp[3]! * 120 + vp[7]! * -40 + vp[11]! * 80 + vp[15]!))
    const ndcY = ((vp[1]! * 120 + vp[5]! * -40 + vp[9]! * 80 + vp[13]!) / (vp[3]! * 120 + vp[7]! * -40 + vp[11]! * 80 + vp[15]!))
    const ray = rayFromNdc({ ndcX, ndcY, camPos: [0, 0, 1000], invViewProj: invVp })
    const hit = raycastIndexedMesh(ray.origin, ray.dir, world, inv, positions, uvs, indices, bounds)

    expect(hit).not.toBeNull()
    expect(hit!.u).toBeCloseTo(0.5, 3)
    expect(hit!.v).toBeCloseTo(0.5, 3)
    expect(hit!.point[0]).toBeCloseTo(120, 2)
    expect(hit!.point[1]).toBeCloseTo(-40, 2)
  })
})
