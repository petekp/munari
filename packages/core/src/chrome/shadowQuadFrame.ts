// The shadow quad's frame — geometry and shader uniforms built from ONE
// computation so they can't disagree.
// Ported from three-ui@362c5a1 app/scenes/lab014Plate.ts (the shadow-quad
// slice) (archive#56).
//
// Vector parameters are the structural `Vec2` pair (decisions.md #4):
// THREE.Vector2/Vector3 pass through unchanged, satisfying `Vec2Readonly`
// by shape (z, if present, is simply never read). Where the oracle used
// vector METHODS on scratch objects (`.length()`, `.divideScalar()`), core
// writes the arithmetic out longhand instead — a scratch vector would have
// to be one of three's own, which core can't import, and the oracle's own
// module-scope `_eu`/`_ev`/`_fc` reuse-buffers are exactly the kind of
// allocation this file has no library left to make.

import { Vec2, type Vec2Like, type Vec2Readonly } from '../math/vec2'

/**
 * The shadow quad's frame: vertices for the inflated footprint plus the two
 * half-extents the fragment shader is told about. The contract is that the
 * numbers NEVER LIE — `quadHalf` must be the quad's true half-extent in its
 * own edge directions, because the shader reconstructs "px from the card" as
 * `(vUv·2−1)·quadHalf` and evaluates the measured shadow layers at that
 * coordinate.
 *
 * The old construction pushed each corner radially away from the centroid,
 * which inflates a wide card's quad by only `margin·sin(diag)` vertically
 * (≈0.29·margin at 514×157) while claiming the full margin in `quadHalf`.
 * That stretch made every pixel below the card evaluate the shadow 2–3σ
 * farther out than it really was — at altitude a squished halo, at rest
 * (spread −12, σ 9: the whole fringe within ~12 px of the edge) it pushed the
 * ENTIRE visible shadow underneath the card quad. The card came to rest
 * shadowless and the DOM's fringe popped in at the swap.
 *
 * A planar rectangle projected along a fixed light direction is exactly a
 * parallelogram, so the projected corners are summarized without loss by two
 * half-edge vectors; the quad is rebuilt from them with the margin added
 * ALONG EACH AXIS. At rest the parallelogram is the card's own rect and the
 * p-space metric is the CSS pixel grid — identity, which is what the
 * measured layers assume.
 */
export interface ShadowFrameLike {
  verts: [Vec2Like, Vec2Like, Vec2Like, Vec2Like]
  quadHalf: Vec2Like
  cardHalf: Vec2Like
}

/** What `makeShadowFrame` allocates when no caller-owned target exists. */
export interface ShadowFrame {
  verts: [Vec2, Vec2, Vec2, Vec2]
  quadHalf: Vec2
  cardHalf: Vec2
}

export function makeShadowFrame(): ShadowFrame {
  return {
    verts: [new Vec2(), new Vec2(), new Vec2(), new Vec2()],
    quadHalf: new Vec2().set(1, 1),
    cardHalf: new Vec2().set(1, 1),
  }
}

/**
 * `proj` is the projected footprint in `corners` order (TL, TR, BR, BL — z,
 * if the caller's vector type carries one, ignored: this frame is a
 * screen-space quantity); `verts` comes back in PlaneGeometry vertex order
 * (TL, TR, BL, BR). Everything is written into `out`, allocation-free —
 * generic so a caller's own vector type (e.g. real `THREE.Vector2`s living
 * on a persistent geometry) comes back out intact, the same pattern as
 * `mapping/camera.ts`'s `screenToPlane`/`carryToPlane`.
 */
export function shadowQuadFrame<F extends ShadowFrameLike>(
  proj: readonly [Vec2Readonly, Vec2Readonly, Vec2Readonly, Vec2Readonly],
  margin: number,
  out: F,
): F {
  const [tl, tr, br, bl] = proj
  const fcx = (tl.x + tr.x + br.x + bl.x) / 4
  const fcy = (tl.y + tr.y + br.y + bl.y) / 4
  // Half-edge vectors of the parallelogram (averaged across the two parallel
  // edges, which are equal up to float noise for a true projection). Scalar,
  // not scratch Vec2s — see the file header.
  let eux = (tr.x + br.x - tl.x - bl.x) / 4
  let euy = (tr.y + br.y - tl.y - bl.y) / 4
  let evx = (tl.x + tr.x - bl.x - br.x) / 4
  let evy = (tl.y + tr.y - bl.y - br.y) / 4
  // An edge-on card has no footprint to speak of; keep the frame finite so
  // the normalize below can't hand the GPU a NaN quad.
  const lu = Math.max(Math.hypot(eux, euy), 1e-3)
  const lv = Math.max(Math.hypot(evx, evy), 1e-3)
  eux /= lu
  euy /= lu
  evx /= lv
  evy /= lv
  out.cardHalf.set(lu, lv)
  out.quadHalf.set(lu + margin, lv + margin)
  const qhx = out.quadHalf.x
  const qhy = out.quadHalf.y
  // PlaneGeometry vertex order: TL (−1,+1), TR (+1,+1), BL (−1,−1), BR (+1,−1).
  const SX = [-1, 1, -1, 1]
  const SY = [1, 1, -1, -1]
  for (let i = 0; i < 4; i++) {
    const sx = SX[i]!
    const sy = SY[i]!
    out.verts[i]!.set(fcx + eux * qhx * sx + evx * qhy * sy, fcy + euy * qhx * sx + evy * qhy * sy)
  }
  return out
}
