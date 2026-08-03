// CONFORMANCE CONTRACT — chrome (typechecked, not yet run)
// Ported from three-ui@362c5a1 app/scenes/lab014Plate.test.ts (shadow-quad slice) (archive#56)
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

// ---- CONTRACT HOLES ------------------------------------------------
interface ShadowFrame {
  verts: [THREE.Vector2, THREE.Vector2, THREE.Vector2, THREE.Vector2]
  quadHalf: THREE.Vector2
  cardHalf: THREE.Vector2
}
declare function makeShadowFrame(): ShadowFrame
/**
 * The shadow quad's frame: vertices for the inflated footprint plus the
 * two half-extents the fragment shader is told about. The contract is
 * that the numbers NEVER LIE — `quadHalf` must be the quad's true
 * half-extent in its own edge directions, because the shader
 * reconstructs "px from the card" as `(vUv·2−1)·quadHalf` and evaluates
 * the measured shadow layers at that coordinate. `proj` is the projected
 * footprint in `corners` order (TL, TR, BR, BL); `verts` comes back in
 * PlaneGeometry vertex order (TL, TR, BL, BR).
 */
declare function shadowQuadFrame(
  proj: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3],
  margin: number,
  out: ShadowFrame,
): ShadowFrame
// --------------------------------------------------------------------

describe('shadow quad frame — the mapping never lies', () => {
  const rect = (w: number, h: number, cx = 0, cy = 0) =>
    [
      new THREE.Vector3(cx - w / 2, cy + h / 2, 0), // TL
      new THREE.Vector3(cx + w / 2, cy + h / 2, 0), // TR
      new THREE.Vector3(cx + w / 2, cy - h / 2, 0), // BR
      new THREE.Vector3(cx - w / 2, cy - h / 2, 0), // BL
    ] as [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]

  it('at rest the quad reaches the FULL margin past every edge', () => {
    // The bug this guards: the old radial push gave a 514×157 card only
    // margin·sin(diag) ≈ 0.29·margin of quad below its bottom edge while
    // quadHalf claimed the full margin — so the shader evaluated every
    // below-card pixel 2–3σ too far out, and the rest shadow (whose whole
    // fringe lives within ~12 px of the edge: spread −12, σ 9, offset 6)
    // rendered entirely underneath the card. Rest = shadowless, then the
    // DOM's fringe popped in at the swap.
    const out = makeShadowFrame()
    shadowQuadFrame(rect(514, 157.5), 33, out)

    expect(out.cardHalf.x).toBeCloseTo(257, 6)
    expect(out.cardHalf.y).toBeCloseTo(78.75, 6)
    expect(out.quadHalf.x).toBeCloseTo(290, 6)
    expect(out.quadHalf.y).toBeCloseTo(111.75, 6)
    for (const v of out.verts) {
      // True extents equal the claimed extents — the contract itself.
      expect(Math.abs(v.x)).toBeCloseTo(out.quadHalf.x, 6)
      expect(Math.abs(v.y)).toBeCloseTo(out.quadHalf.y, 6)
    }
  })

  it('margin 0 reproduces the projected parallelogram exactly', () => {
    // A planar rect projected along a fixed direction IS a parallelogram,
    // so the two half-edge vectors summarize it without loss. Shear one and
    // round-trip it.
    const proj = rect(320, 180, 40, -25)
    for (const v of proj) v.x += v.y * 0.35 // shear from a tilted plate
    const out = makeShadowFrame()
    shadowQuadFrame(proj, 0, out)

    // verts come back TL, TR, BL, BR; proj is TL, TR, BR, BL.
    const want = [proj[0], proj[1], proj[3], proj[2]]
    for (let i = 0; i < 4; i++) {
      expect(out.verts[i]!.x).toBeCloseTo(want[i]!.x, 6)
      expect(out.verts[i]!.y).toBeCloseTo(want[i]!.y, 6)
    }
  })

  it('an edge-on card cannot hand the GPU a NaN', () => {
    const out = makeShadowFrame()
    shadowQuadFrame(rect(320, 0), 10, out)
    for (const v of out.verts) {
      expect(Number.isFinite(v.x)).toBe(true)
      expect(Number.isFinite(v.y)).toBe(true)
    }
  })
})
