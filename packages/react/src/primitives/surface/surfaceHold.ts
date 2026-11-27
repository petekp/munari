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
  /** The shared keys of every build the look needs, crossings included. */
  readonly keys: readonly string[]
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

function disposeLook(look: Look | null): void {
  if (!look) return
  for (const material of look.materials) material.dispose()
  look.materials.length = 0
}

/**
 * The shared keys whose pipelines a built look's clones keep in three's
 * cache. An object new to the hold whose keys are all here draws at once: a
 * FrameSurface mounted again over the same source is a new mesh and
 * material with the same keys, and holding it showed one clear frame per
 * remount (gate:frame-surface, 2026-11-27).
 */
export interface BuiltLooks {
  /** Count a look whose builds have finished. */
  add(look: Look): void
  has(keys: readonly string[]): boolean
  /** Dispose a look's clones, and stop counting its keys. */
  release(look: Look | null): void
}

export function createBuiltLooks(): BuiltLooks {
  const counts = new Map<string, number>()
  const counted = new WeakSet<Look>()
  return {
    add(look) {
      if (counted.has(look)) return
      counted.add(look)
      for (const key of look.keys) counts.set(key, (counts.get(key) ?? 0) + 1)
    },
    has: (keys) => keys.every((key) => (counts.get(key) ?? 0) > 0),
    release(look) {
      if (look && counted.delete(look)) {
        for (const key of look.keys) {
          const left = (counts.get(key) ?? 1) - 1
          if (left > 0) counts.set(key, left)
          else counts.delete(key)
        }
      }
      disposeLook(look)
    },
  }
}

/** The built clone that draws like `material` does now, for the look it stands in for. */
export function snapshotOf(look: Look, material: THREE.Material): THREE.Material {
  return look.materials.find((clone) => clone.colorWrite === material.colorWrite && clone.depthWrite === material.depthWrite && clone.stencilWrite === material.stencilWrite && clone.side === material.side) ?? look.materials[0] ?? NOTHING
}
