// Scene occlusion of a Surface hit — a nearer visible mesh that is not a
// Surface takes the pointer from the Surface behind it (decisions.md #78).
//
// The law: a ray hit on a Surface counts only when no other mesh is strictly
// nearer along the same ray. Only a THREE.Mesh blocks (InstancedMesh and
// SkinnedMesh included); Points, Lines and Sprites never do. A mesh blocks
// only on the layers of the canvas's R3F raycaster, whichever route asks, and
// only where three draws it: a mesh hidden by its own or an ancestor's
// `visible = false` is skipped, because three's Raycaster tests layers and
// never visibility, and so is a hit on a material, or a material group, with
// `visible: false`. Opacity and `colorWrite` do not count, so a fully
// transparent mesh is a hit proxy that blocks. A Surface's own descendants are
// skipped, so an overlay drawn as a child of its Surface does not block it;
// and a mesh whose `raycast` is a no-op never intersects, which is how a
// scene opts a prop out.
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
import { lastPointerPlace } from '@munari/core'

/** What the occlusion test reads from the R3F root a Surface draws in. */
export interface OcclusionCanvas {
  /** R3F advances it once at the start of each frame it runs, before any `useFrame` callback. */
  readonly clock: { readonly elapsedTime: number }
  readonly raycaster: THREE.Raycaster
}

const surfaces = new WeakMap<THREE.Object3D, () => OcclusionCanvas>()

/** Count `mesh` as a Surface: it never blocks, and its descendants never block it. */
export function markSurfaceMesh(mesh: THREE.Object3D, canvas: () => OcclusionCanvas): () => void {
  surfaces.set(mesh, canvas)
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

// Two raycasters that build a ray from the same pointer point agree to float64
// rounding, near 1e-15. A quarter-pixel pointer step across a 1280 px, 50°
// view turns the ray by about 2e-4 rad. 1e-9 accepts the first and never the
// second.
const SAME_RAY = 1e-9

// A frame asks along at most three distinct rays: the gate's, R3F's and the
// native route's. Four keeps them all.
const WALKS_KEPT = 4

interface Blocker {
  readonly distance: number
  readonly object: THREE.Object3D
}

interface Walk {
  readonly origin: THREE.Vector3
  readonly direction: THREE.Vector3
  readonly near: number
  readonly mask: number
  readonly frame: number
  /** How far along the ray the walk looked. */
  readonly reach: number
  readonly blockers: readonly Blocker[]
}

// One walk per ray per R3F frame, shared by every caller that asks along it:
// the gate and R3F build separate raycasters for one pointer event, R3F asks
// each Surface under the ray, and the deform replay and the gate's recheck ask
// again at a still pointer. The next frame ends the reuse, because the scene
// may move in it. A walk taken inside a frame misses a move that a later
// callback in that frame makes, for one frame. Keyed by the raycaster until
// 25 Nov 2026, review notes raycast its 36,864-triangle teapot 6.2 times per
// pointer move at two frames per move, 23-25 ms.
const walks = new WeakMap<THREE.Object3D, readonly Walk[]>()

// The walk's own raycaster, so bounding `far` by the Surface's distance never
// touches a raycaster R3F or the gate owns. three's Mesh.raycast skips a mesh
// whose bounding sphere the ray enters beyond `far`, so a heavy mesh behind
// the Surface costs a sphere test, not its triangle loop.
const walker = new THREE.Raycaster()

function sameVector(a: THREE.Vector3, b: THREE.Vector3): boolean {
  const close = (x: number, y: number) => Math.abs(x - y) <= SAME_RAY * Math.max(1, Math.abs(x))
  return close(a.x, b.x) && close(a.y, b.y) && close(a.z, b.z)
}

function materialIsVisible(material: THREE.Material | THREE.Material[]): boolean {
  return Array.isArray(material) ? material.some((one) => one.visible) : material.visible
}

function hitIsVisible(mesh: THREE.Mesh, hit: THREE.Intersection): boolean {
  const { material } = mesh
  if (!Array.isArray(material)) return material.visible
  return material[hit.face?.materialIndex ?? 0]?.visible === true
}

function collect(object: THREE.Object3D, raycaster: THREE.Raycaster, out: Blocker[], scratch: THREE.Intersection[]): void {
  if (!object.visible) return
  if (!surfaces.has(object) && object instanceof THREE.Mesh && raycaster.layers.test(object.layers) && materialIsVisible(object.material)) {
    scratch.length = 0
    object.raycast(raycaster, scratch)
    for (const hit of scratch) if (hitIsVisible(object, hit)) out.push({ distance: hit.distance, object })
  }
  for (const child of object.children) collect(child, raycaster, out, scratch)
}

function sceneRoot(object: THREE.Object3D): THREE.Object3D {
  let root = object
  while (root.parent) root = root.parent
  return root
}

function blockersAlong(raycaster: THREE.Raycaster, surface: THREE.Object3D, limit: number): readonly Blocker[] {
  const root = sceneRoot(surface)
  const canvas = surfaces.get(surface)?.()
  const mask = canvas ? canvas.raycaster.layers.mask : raycaster.layers.mask
  // NaN matches no earlier walk. An unmarked mesh has no frame clock, and R3F
  // resets its clock to 0 when the frameloop changes, so 0 names no one frame.
  const frame = canvas && canvas.clock.elapsedTime > 0 ? canvas.clock.elapsedTime : Number.NaN
  const reach = Math.min(raycaster.far, limit)
  const { origin, direction } = raycaster.ray
  const kept = (walks.get(root) ?? []).filter((walk) => walk.frame === frame)
  const same = kept.find(
    (walk) => walk.mask === mask && walk.near === raycaster.near && sameVector(walk.origin, origin) && sameVector(walk.direction, direction),
  )
  if (same && same.reach >= reach) return same.blockers
  walker.ray.copy(raycaster.ray)
  walker.near = raycaster.near
  walker.far = reach
  walker.layers.mask = mask
  walker.camera = raycaster.camera
  walker.params = raycaster.params
  const blockers: Blocker[] = []
  collect(root, walker, blockers, [])
  const walk = { origin: origin.clone(), direction: direction.clone(), near: raycaster.near, mask, frame, reach, blockers }
  walks.set(root, [...kept.filter((one) => one !== same), walk].slice(-WALKS_KEPT))
  return blockers
}

function descendsFrom(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let node = object.parent; node; node = node.parent) if (node === ancestor) return true
  return false
}

/**
 * Is the trusted pointer still where r3f last heard it? r3f's `events.update`
 * replays that event, and once the gate clears the canvas it goes stale. A
 * pointer that left a note over the spout kept hovering the note as the wheel
 * turned the spout away, and the relayed moves spun the wheel (review-notes,
 * 25 Nov 2026).
 */
export function pointerIsWhereR3fHeardIt(heard: { readonly clientX: number; readonly clientY: number } | null): boolean {
  const place = lastPointerPlace()
  return heard !== null && place !== null && heard.clientX === place.x && heard.clientY === place.y
}

/**
 * Does a visible mesh that is not a Surface stand strictly nearer than
 * `distance` along `raycaster`'s ray, in the scene `surface` belongs to?
 * Meshes that descend from `surface` do not count.
 */
export function sceneMeshCovers(surface: THREE.Object3D, raycaster: THREE.Raycaster, distance: number): boolean {
  const limit = distance * (1 - TIE)
  for (const blocker of blockersAlong(raycaster, surface, limit)) {
    if (blocker.distance < limit && !descendsFrom(blocker.object, surface)) return true
  }
  return false
}
