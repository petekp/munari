// Held looks — what the canvas hold draws for an object while its new
// pipelines build: its last built look, or nothing.
//
// The law: an object whose pipelines are not built is never drawn as it is
// (decisions.md #81). Its last built look stands in, and an object with none
// draws nothing; three skips an invisible material without building for it.
//
// Ownership: the records and stand-ins; when to hold is surfaceCompile.ts's.

import * as THREE from 'three'

/** A set of stand-in clones whose builds give a look its pipelines. */
export interface Look {
  readonly key: string
  /** The scene the look was built under; drawn under another, it blocks. */
  readonly signature: string
  readonly materials: THREE.Material[]
  built: boolean
}

export interface HeldObject {
  readonly presenter: boolean
  drawn: Look | null
  pending: Look | null
  /** Times of recent new looks, for the churn rule. */
  changes: number[]
  churnUntil: number
  seen: number
}

// Drawn in place of an object whose first pipelines are building: three
// skips an invisible material without building anything for it, and still
// draws the object's children.
export const NOTHING = new THREE.MeshBasicMaterial({ visible: false })

// A material whose pipeline changes this often is animating its shader, and
// holding each version would show only old looks, so it draws as three
// builds it for a while. By judgment, unmeasured.
export const CHURN_CHANGES = 3
export const CHURN_WINDOW_MS = 1000
export const CHURN_REST_MS = 2000
// Records of objects no draw has held for this long are released. By
// judgment: long enough that a toggled object keeps its look.
export const UNSEEN_MS = 10_000

export function release(look: Look | null): void {
  for (const material of look?.materials ?? []) material.dispose()
}

/** The built clone that draws like `material` does now, for the look it stands in for. */
export function snapshotOf(look: Look, material: THREE.Material): THREE.Material {
  return look.materials.find((clone) => clone.colorWrite === material.colorWrite && clone.depthWrite === material.depthWrite && clone.stencilWrite === material.stencilWrite && clone.side === material.side) ?? look.materials[0] ?? NOTHING
}
