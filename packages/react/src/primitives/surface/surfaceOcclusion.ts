// Scene occlusion of a Surface hit — a nearer visible mesh that is not a
// Surface takes the pointer from the Surface behind it (decisions.md #78).
//
// The law: a ray hit on a Surface counts only when no other mesh is strictly
// nearer along the same ray. Three exclusions keep pass-through props cheap
// to declare: a mesh hidden by its own or an ancestor's `visible = false` is
// skipped, because three's Raycaster tests layers and never visibility; a
// Surface's own descendants are skipped, so an overlay drawn as a child of
// its Surface does not block it; and a mesh whose `raycast` is a no-op never
// intersects, which is how a scene opts a prop out.
//
// The fault: until 0.6.0 only meshes with R3F handlers that stopped
// propagation could block. CanvasPointerGate raycast Surface meshes alone,
// and R3F delivers only to objects with handlers, so a press on a teapot's
// spout focused the note wrapped behind it (review-notes, 23 Nov 2026). The
// native route had no occlusion check at all.
//
// Ownership: SurfaceMesh marks its mesh and asks `sceneMeshCovers` from its
// raycast, which every relay consumer (the gate, R3F delivery, the arrival
// move) goes through. The native route controller asks it for the pointer's
// point. The scene owns which props opt out.

import * as THREE from 'three'

const surfaces = new WeakSet<THREE.Object3D>()

/** Count `mesh` as a Surface: it never blocks, and its descendants never block it. */
export function markSurfaceMesh(mesh: THREE.Object3D): () => void {
  surfaces.add(mesh)
  return () => {
    surfaces.delete(mesh)
  }
}

// A mesh coplanar with a Surface, such as a decal or a backing card, hits the
// same ray at the same distance up to float32 rounding of the two world
// matrices. Float32 keeps about seven significant digits; 1e-4 of the
// distance leaves three orders of magnitude for the matrix products and is
// 0.1 mm at a metre, below any separation a reader could see. Ties go to the
// Surface.
const TIE = 1e-4

interface Blocker {
  readonly distance: number
  readonly object: THREE.Object3D
}

interface RayBlockers {
  readonly root: THREE.Object3D
  readonly key: readonly number[]
  readonly blockers: readonly Blocker[]
}

// One traversal per ray, shared by every Surface asked about it in the same
// task: R3F calls each interactive object's raycast with one raycaster per
// event, so three Surfaces under one move would otherwise walk the scene
// three times. Cleared on the next microtask, because the scene may move
// before the next event reuses the raycaster with an identical ray.
const cache = new WeakMap<THREE.Raycaster, RayBlockers>()
let clearQueued = false
const cached = new Set<THREE.Raycaster>()

function rayKey(raycaster: THREE.Raycaster): number[] {
  const { origin, direction } = raycaster.ray
  return [origin.x, origin.y, origin.z, direction.x, direction.y, direction.z, raycaster.near, raycaster.far, raycaster.layers.mask]
}

function sameKey(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function materialIsVisible(material: THREE.Material | THREE.Material[]): boolean {
  return Array.isArray(material) ? material.some((one) => one.visible) : material.visible
}

function collect(object: THREE.Object3D, raycaster: THREE.Raycaster, out: Blocker[], scratch: THREE.Intersection[]): void {
  if (!object.visible) return
  if (!surfaces.has(object) && object instanceof THREE.Mesh && raycaster.layers.test(object.layers) && materialIsVisible(object.material)) {
    scratch.length = 0
    object.raycast(raycaster, scratch)
    for (const hit of scratch) out.push({ distance: hit.distance, object })
  }
  for (const child of object.children) collect(child, raycaster, out, scratch)
}

function sceneRoot(object: THREE.Object3D): THREE.Object3D {
  let root = object
  while (root.parent) root = root.parent
  return root
}

function blockersAlong(raycaster: THREE.Raycaster, root: THREE.Object3D): readonly Blocker[] {
  const key = rayKey(raycaster)
  const hit = cache.get(raycaster)
  if (hit && hit.root === root && sameKey(hit.key, key)) return hit.blockers
  const blockers: Blocker[] = []
  collect(root, raycaster, blockers, [])
  cache.set(raycaster, { root, key, blockers })
  cached.add(raycaster)
  if (!clearQueued) {
    clearQueued = true
    queueMicrotask(() => {
      clearQueued = false
      for (const one of cached) cache.delete(one)
      cached.clear()
    })
  }
  return blockers
}

function descendsFrom(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let node = object.parent; node; node = node.parent) if (node === ancestor) return true
  return false
}

/**
 * Does a visible mesh that is not a Surface stand strictly nearer than
 * `distance` along `raycaster`'s ray, in the scene `surface` belongs to?
 * Meshes that descend from `surface` do not count.
 */
export function sceneMeshCovers(surface: THREE.Object3D, raycaster: THREE.Raycaster, distance: number): boolean {
  const limit = distance * (1 - TIE)
  for (const blocker of blockersAlong(raycaster, sceneRoot(surface))) {
    if (blocker.distance < limit && !descendsFrom(blocker.object, surface)) return true
  }
  return false
}
