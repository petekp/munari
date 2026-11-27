// Pipeline builds — the stand-in clones whose asynchronous builds give an
// object its pipelines before it draws.
//
// The law: a build describes the later draw exactly, so it starts inside that
// draw, from a clone per set of write flags and per side. Each rule and the
// fault that produced it is in surfaceCompile.ts's preamble.
//
// Ownership: this module starts builds and reports their end; what is held,
// and for how long, is surfaceCompile.ts's.

import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { isDevelopmentRuntime } from '../../lib/developmentRuntime'

interface WriteFlags {
  readonly colorWrite: boolean
  readonly depthWrite: boolean
  readonly stencilWrite: boolean
}

const WRITE_FREE: WriteFlags = { colorWrite: false, depthWrite: false, stencilWrite: false }

export const flagsKey = (flags: WriteFlags) => `${flags.colorWrite}${flags.depthWrite}${flags.stencilWrite}`

/**
 * One clone per pipeline the material's draws can use. A presenter draws
 * with its own flags, with color on and write-free; any other object only
 * with its own (`presenter` false).
 */
export function passMaterials(material: THREE.Material, presenter = true): THREE.Material[] {
  const authored: WriteFlags = { colorWrite: material.colorWrite, depthWrite: material.depthWrite, stencilWrite: material.stencilWrite }
  const flagSets = new Map<string, WriteFlags>()
  for (const flags of presenter ? [authored, { ...authored, colorWrite: true }, WRITE_FREE] : [authored]) flagSets.set(flagsKey(flags), flags)
  const twoPass = material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass
  const sides = twoPass ? [THREE.BackSide, THREE.FrontSide] : [material.side]
  return [...flagSets.values()].flatMap((flags) =>
    sides.map((side) => {
      const clone = material.clone()
      clone.colorWrite = flags.colorWrite
      clone.depthWrite = flags.depthWrite
      clone.stencilWrite = flags.stencilWrite
      clone.side = side
      return clone
    }),
  )
}

/**
 * The builds that give each of `clones`' node builds a pipeline under each
 * other set of write flags of the same side. A draw that changes a
 * material's flags keeps the node build its render object began with, and
 * three's WGSL for one key is not always the same text: the page's first
 * physical-material build ordered its functions differently from later
 * ones, so a clone built with color on did not give the pipeline the
 * write-free one's render object later drew with color on, which three
 * built with the blocking call (Bench, m2, 2026-11-27).
 */
export function crossings(clones: readonly THREE.Material[]): { readonly built: THREE.Material; readonly flags: WriteFlags }[] {
  return clones.flatMap((built) =>
    clones
      .filter((other) => other.side === built.side && flagsKey(other) !== flagsKey(built))
      .map((other) => ({ built, flags: { colorWrite: other.colorWrite, depthWrite: other.depthWrite, stencilWrite: other.stencilWrite } })),
  )
}

/** An object three draws with one material. */
export type Drawable = THREE.Object3D & { material: THREE.Material }

export function drawableOf(object: THREE.Object3D): Drawable | null {
  if (!(object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line || object instanceof THREE.Sprite)) return null
  // A batched mesh keys its pipeline by its own data textures, which a
  // stand-in would not share.
  if (object instanceof THREE.BatchedMesh) return null
  // SAFETY: the checks above admit only classes that carry a material, and an array is refused.
  return object.material instanceof THREE.Material ? (object as Drawable) : null
}

/**
 * Begin one build. Everything up to `compileAsync`'s first await runs here,
 * inside the caller's draw. A scene background would be collected ahead of
 * the stand-in and build first, pushing the stand-in's node build past that
 * await, so the background is lifted for the synchronous part only.
 */
export function startBuild(renderer: WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, object: THREE.Object3D, material: THREE.Material): Promise<void> {
  const standIn = object.clone(false)
  // three keys an instanced mesh's build by its uuid.
  standIn.uuid = object.uuid
  // SAFETY: drawableOf and compile() admit only objects three draws with a material.
  const drawable = standIn as Drawable
  drawable.material = material
  standIn.matrixAutoUpdate = false
  standIn.matrix.copy(object.matrixWorld)
  standIn.matrixWorld.copy(object.matrixWorld)
  standIn.visible = true
  standIn.frustumCulled = false
  let collected = false
  standIn.onBeforeRender = () => {
    collected = true
  }
  // three keys a compile's lights by its scene and builds its nodes later,
  // from whatever lights that scene's last draw saw. A held draw hides the
  // lights that arrived since, so a build keyed by the real scene would be
  // for the old lights. A view of the scene of its own keeps this build's
  // lights as they are now, and reads everything else from the scene.
  const view: THREE.Scene = Object.create(scene)
  view.background = null
  view.backgroundNode = null
  const built = renderer.compileAsync(standIn, camera, view)
  if (collected) return built
  return built.then(() => {
    throw new Error('the mesh was not collected for the compile; check its layers against the camera')
  })
}

export function settle(builds: Promise<void>[], resolve: () => void): void {
  void Promise.allSettled(builds).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected' && isDevelopmentRuntime()) {
        console.error('[munari] a pipeline could not be built before its first draw, so it draws as three builds it.', result.reason)
      }
    }
    resolve()
  })
}
