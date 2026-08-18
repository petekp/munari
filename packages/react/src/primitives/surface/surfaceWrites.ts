// Pass writes — the warm-up's three flags, borrowed and given back.
//
// The law: a warm-up is a property of one PASS, never of the material. A
// presenter that is still warming draws with color, depth, and stencil
// writes off; the material it drew with belongs to the caller, and the
// values it had before that pass are the values it has after it.
//
// The fault, 2026-08-17: the warm-up wrote the flags straight onto the
// material and computed the next pass's value from what it found there
// (`writing && material.depthWrite !== false`). One warm-up therefore
// disabled depth and stencil writes permanently — the second pass read
// back the `false` the first one wrote and kept it — so a Surface that
// lifted once stopped sorting against the scene around it for the rest of
// the session, and an authored `stencilWrite` never came back at all.
// Three hands the SHARED material to `onBeforeRender`, so the damage
// reached every other mesh using it too.
//
// Ownership: this module owns the borrow and the restore. It decides
// nothing about whether a pass may write — that is the crossing's answer,
// passed in.

/** The three write flags a warm-up turns off. Three's `Material` has them. */
export interface SurfaceMaterialWrites {
  colorWrite: boolean
  depthWrite: boolean
  stencilWrite: boolean
}

/** One presenter's borrow slot: the material touched, and its own values. */
export interface AuthoredWrites {
  material: SurfaceMaterialWrites | null
  colorWrite: boolean
  depthWrite: boolean
  stencilWrite: boolean
}

/** An empty borrow slot. One per presenter, reused for every pass. */
export function authoredWrites(): AuthoredWrites {
  return { material: null, colorWrite: true, depthWrite: true, stencilWrite: false }
}

/**
 * Take the material for one pass. `writing` is the crossing's answer to
 * whether these pixels may be seen; the authored flags are the caller's
 * answer to whether they would be written at all, and a pass writes only
 * where both say so.
 */
export function applyPassWrites(
  authored: AuthoredWrites,
  material: SurfaceMaterialWrites,
  writing: boolean,
): void {
  authored.material = material
  authored.colorWrite = material.colorWrite
  authored.depthWrite = material.depthWrite
  authored.stencilWrite = material.stencilWrite
  material.colorWrite = writing && authored.colorWrite
  material.depthWrite = writing && authored.depthWrite
  material.stencilWrite = writing && authored.stencilWrite
}

/**
 * Give the material back. Idempotent, because the post-draw callback runs
 * once per pass but a restore that ran twice must not re-apply a flag the
 * caller changed in between.
 */
export function restoreAuthoredWrites(authored: AuthoredWrites): void {
  const material = authored.material
  if (!material) return
  authored.material = null
  material.colorWrite = authored.colorWrite
  material.depthWrite = authored.depthWrite
  material.stencilWrite = authored.stencilWrite
}
