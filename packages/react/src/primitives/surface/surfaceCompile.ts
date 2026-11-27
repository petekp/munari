// Surface compile — the render pipelines of everything a SurfaceCanvas draws,
// built asynchronously before the draw that needs them.
//
// The law: an object stays out of three's render path until every pipeline
// it will draw with has been built with `createRenderPipelineAsync` and sits
// in three's pipeline cache. A Surface presenter is held before its first
// draw (`useSurfaceCompiled`); every other object in a canvas draw is held
// by the canvas (`hold`), which draws it with nothing until its first
// pipelines are built, and with its last built look while a changed
// material builds (decisions.md #81). three 0.186 builds a pipeline it
// lacks at the draw, with the blocking `createRenderPipeline`, and Chrome's
// Dawn runs that call on the GPU process's main thread, where the Metal
// compile stops raster and compositing until it returns, for every canvas
// on the page. The asynchronous call compiles on a Dawn worker instead.
//
// The fault, 2026-11-22 (instruments/genie-first-flight): with shaders no cache
// held, Genie's first flight after load froze frames for 183-250 ms and its
// first film flight for 150-267 ms, on blocking builds of 238-314 and 201-219
// ms. three's own `compileAsync`, called outside a frame, did not help: the
// first real draw built another pipeline with the blocking call, because the
// canvas draws through DirectRenderPipeline, whose target and output context
// node exist only during its render.
//
// So each build is made to describe the later draw exactly:
// - It starts in SurfaceCanvas's render wrapper, inside the draw of the scene
//   that holds the mesh. `compileAsync` picks its render target and builds
//   the first object's node graph against `renderer.contextNode` before its
//   first await, so the build gets that draw's target and output transform.
// - It compiles a stand-in: a shallow clone of the mesh with its world
//   matrix, wearing a clone of the material. three reads the write flags and
//   side when it builds the pipeline, after its first await, so a variant
//   cannot be borrowed from the shared material; each one is its own clone.
// - A presenter draws with more than one set of write flags. Surface.Mesh
//   draws write-free until its page may let go; a material can be born with
//   `colorWrite` off and turned on in a frame (Genie's film composite). So
//   each material is built with its own flags, the same with color on, and
//   with every write off.
// - A transparent DoubleSide material draws two passes, BackSide then
//   FrontSide. `compileAsync` builds both from the material as it stands
//   after the frame, DoubleSide, which no draw uses, so each side is its own
//   single-pass clone.
// - The clones are held until the compilation is released. three keeps a
//   pipeline in its cache only while a render object uses it.
// - three creates the pipeline after that first await, outside the draw, and
//   keys it by the renderer's output settings at that moment. The draw sees
//   DirectRenderPipeline's: no tone mapping, the working color space, and so
//   the canvas's MSAA sample count. At rest the renderer has its own output
//   color space, which takes MSAA away. Measured 2026-11-22: every build came
//   out single-sampled and keyed sRGB, and every first draw created its
//   pipeline again with the blocking call. So while a build is pending, the
//   renderer rests in the draw's output settings, and its own are put back
//   around each canvas draw (`draw`).
// - A pipeline built asynchronously once is cheap to build again: measured
//   2026-11-26 on m2 (Chrome 159), a blocking build of a descriptor whose
//   asynchronous build had finished cost 0.2-1 ms on the GPU process, against
//   53-570 ms cold, even after the asynchronous pipeline was dropped and with
//   a new shader module. So a look held back while its replacement builds,
//   or a bake whose renders were built ahead (`prebuildPipelines`), blocks
//   nothing when three later builds the same descriptor itself.
//
// decisions.md #76 and #81 state the rule.
//
// Ownership: this module builds pipelines, says when they are built, and
// holds back what is not. A build three could not finish still resolves (it
// logs the failure); whether a draw put pixels on screen stays with
// surfacePass's primitive count. Renders into a target are not held: a bake
// drawn once with something missing would keep the gap for good, so a bake

import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { surfaceBelongsToScene } from './surfaceFrame'
import { passMaterials, type Drawable, drawableOf, startBuild, settle } from './surfaceCompileBuild'
import { pipelineKey, sharedKey, sceneKey } from './surfacePipelineKey'
import { createOutputRest } from './surfaceOutputRest'
import { type Look, type HeldObject, NOTHING, CHURN_CHANGES, CHURN_WINDOW_MS, CHURN_REST_MS, UNSEEN_MS, release, snapshotOf } from './surfaceHold'

export { installSurfaceCompiler, surfaceCompilerOf, useSurfaceCompiled } from './surfaceCompiled'

export interface SurfaceCompilation {
  /**
   * Resolves when every build has finished. A build that fails is logged in
   * development and still resolves: the presenter then draws as three
   * builds its pipeline, which blocks a frame but shows the content.
   */
  readonly ready: Promise<void>
  /** Release the clones that hold the pipelines in three's cache. */
  release(): void
}

export interface SurfaceCompiler {
  compile(mesh: THREE.Mesh, material: THREE.Material): SurfaceCompilation
  /** Start every queued compilation whose mesh is in `scene`, under the renderer state of this draw. */
  start(scene: THREE.Object3D, camera: THREE.Camera): void
  /**
   * Hold back, for one canvas draw of `scene`, every object whose pipelines
   * are not built, starting their builds. Returns the undo, to run after the draw.
   */
  hold(scene: THREE.Object3D, camera: THREE.Camera): () => void
  /** A presenter now draws with `compilation`'s pipelines; the canvas holds its later looks. */
  adopt(mesh: THREE.Mesh, compilation: SurfaceCompilation): void
  /** Objects the last canvas draw held back, and builds still running. */
  holding(): number
  /** Run one canvas draw with the renderer's own output settings. */
  draw(render: () => void): void
  dispose(): void
}


// ── the canvas hold ────────────────────────────────────────────────────
type SceneState = { readonly signature: string; readonly environment: THREE.Texture | null; readonly fog: THREE.Scene['fog']; readonly lights: ReadonlySet<THREE.Light> }
type CompilationRecord = { readonly materials: THREE.Material[]; adopted: boolean; builtUnder: SceneState | null }
const compilationMaterials = new WeakMap<SurfaceCompilation, CompilationRecord>()

export function createSurfaceCompiler(renderer: WebGPURenderer, invalidate: () => void): SurfaceCompiler {
  interface QueuedCompilation {
    readonly mesh: THREE.Mesh
    readonly materials: THREE.Material[]
    readonly resolve: () => void
    readonly owned: CompilationRecord
  }
  const queue = new Set<QueuedCompilation>()
  const records = new Map<THREE.Object3D, HeldObject>()
  let held = 0
  // The environment and fog every drawn look was built under.
  let drawnScene: SceneState | null = null
  const stateOf = (scene: THREE.Scene): SceneState => {
    const lights: THREE.Light[] = []
    scene.traverseVisible((object) => {
      if (object instanceof THREE.Light) lights.push(object)
    })
    return { signature: sceneKey(scene, lights, renderer.shadowMap.enabled), environment: scene.environment, fog: scene.fog, lights: new Set(lights) }
  }
  let lastSweep = 0
  const rest = createOutputRest(renderer)
  // three caches a node build when it finishes, so builds of equal keys
  // started together each build in full: 35 of Knobs' meshes built one
  // material's graph at once, 700 ms of main thread (m2, 2026-11-26). A
  // build waits on the running one of its key instead.
  const running = new Map<string, Promise<void>>()
  const build = (scene: THREE.Scene, camera: THREE.Camera, object: THREE.Object3D, materials: THREE.Material[], signature: string, resolve: () => void) => {
    const builds = materials.map((material) => {
      const key = sharedKey(object, material, signature, false)
      const shared = running.get(key)
      if (shared) return shared
      rest.started()
      let started: Promise<void>
      try {
        started = startBuild(renderer, scene, camera, object, material)
      } catch (error) {
        started = Promise.reject(error)
      }
      const done: Promise<void> = started.finally(() => {
        rest.settled()
        if (running.get(key) === done) running.delete(key)
      })
      running.set(key, done)
      return done
    })
    settle(builds, resolve)
  }
  const lookFor = (scene: THREE.Scene, camera: THREE.Camera, object: Drawable, key: string, presenter: boolean, signature: string): Look => {
    const look: Look = { key, signature, materials: passMaterials(object.material, presenter), built: false }
    build(scene, camera, object, look.materials, signature, () => {
      look.built = true
      invalidate()
    })
    return look
  }
  const sweep = (now: number) => {
    if (now - lastSweep < UNSEEN_MS) return
    lastSweep = now
    for (const [object, record] of records) {
      if (now - record.seen < UNSEEN_MS) continue
      release(record.drawn)
      release(record.pending)
      records.delete(object)
    }
  }
  /** What an object draws while its new look builds, under the scene with `signature`. */
  const standIn = (object: Drawable, record: HeldObject | undefined, signature: string): THREE.Material =>
    record?.drawn?.signature === signature ? snapshotOf(record.drawn, object.material) : NOTHING
  /** Whether the object draws as it is now; otherwise what it draws instead. */
  const consult = (object: Drawable, record: HeldObject, key: string, signature: string, scene: THREE.Scene, camera: THREE.Camera, now: number): THREE.Material | null => {
    // An adopted presenter's look was built for the material it wears now.
    if (record.drawn?.key === '') record.drawn = { ...record.drawn, key, signature }
    if (record.drawn?.key === key) {
      release(record.pending)
      record.pending = null
      return null
    }
    if (record.pending?.key === key) {
      if (!record.pending.built) return standIn(object, record, signature)
      release(record.drawn)
      record.drawn = record.pending
      record.pending = null
      return null
    }
    if (now < record.churnUntil) return null
    record.changes = record.changes.filter((time) => now - time < CHURN_WINDOW_MS)
    record.changes.push(now)
    release(record.pending)
    record.pending = null
    if (record.drawn && record.changes.length >= CHURN_CHANGES) {
      record.churnUntil = now + CHURN_REST_MS
      return null
    }
    record.pending = lookFor(scene, camera, object, key, record.presenter, signature)
    return standIn(object, record, signature)
  }
  return {
    compile(mesh, material) {
      const materials = passMaterials(material)
      const owned: CompilationRecord = { materials, adopted: false, builtUnder: null }
      let released = false
      let queued: QueuedCompilation | null = null
      const ready = new Promise<void>((resolve) => {
        queued = { mesh, materials, resolve, owned }
        queue.add(queued)
        invalidate()
      })
      const compilation: SurfaceCompilation = {
        ready,
        release() {
          if (released || owned.adopted) return
          released = true
          if (queued) queue.delete(queued)
          for (const clone of materials) clone.dispose()
        },
      }
      compilationMaterials.set(compilation, owned)
      return compilation
    },
    start(scene, camera) {
      if (queue.size === 0 || !(scene instanceof THREE.Scene)) return
      for (const entry of [...queue]) {
        if (!surfaceBelongsToScene(entry.mesh, scene)) continue
        queue.delete(entry)
        const state = stateOf(scene)
        entry.owned.builtUnder = state
        build(scene, camera, entry.mesh, entry.materials, state.signature, entry.resolve)
      }
    },
    hold(scene, camera) {
      if (!(scene instanceof THREE.Scene)) return () => {}
      const now = performance.now()
      const drawables: Drawable[] = []
      const lights: THREE.Light[] = []
      scene.traverseVisible((object) => {
        if (object instanceof THREE.Light) {
          lights.push(object)
          return
        }
        const drawable = drawableOf(object)
        if (drawable && drawable.material.visible && object.layers.test(camera.layers)) drawables.push(drawable)
      })
      const signature = sceneKey(scene, lights, renderer.shadowMap.enabled)
      const objectRecords = drawables.map((object) => {
        let record = records.get(object)
        if (!record) {
          record = { presenter: false, drawn: null, pending: null, changes: [], churnUntil: 0, seen: now }
          records.set(object, record)
        }
        record.seen = now
        return record
      })
      const swaps: [Drawable, THREE.Material][] = []
      const swap = (object: Drawable, instead: THREE.Material) => {
        swaps.push([object, object.material])
        object.material = instead
      }
      // A new environment, fog or light changes every object's pipeline,
      // and a look built under the old scene blocks if drawn under the new.
      // So the draw keeps the old scene, and every object its old look,
      // until every new look is built.
      const sceneChanged = drawnScene !== null && drawnScene.signature !== signature && objectRecords.some((record) => record.drawn)
      let rollback = false
      if (sceneChanged) {
        drawables.forEach((object, index) => {
          const record = objectRecords[index]
          if (!record) return
          const key = pipelineKey(object, signature, record.presenter)
          if (record.drawn?.key === key) return
          if (record.pending?.key !== key) {
            release(record.pending)
            record.pending = lookFor(scene, camera, object, key, record.presenter, signature)
          }
          if (!record.pending.built) rollback = true
        })
      }
      let restoreScene = () => {}
      if (rollback && drawnScene) {
        const { environment, fog } = scene
        const { lights: drawnLights, signature: drawnSignature } = drawnScene
        // A light that arrived since is hidden; one that left cannot be
        // brought back, and a look drawn without it blocks.
        const arrived = lights.filter((light) => !drawnLights.has(light))
        scene.environment = drawnScene.environment
        scene.fog = drawnScene.fog
        for (const light of arrived) light.visible = false
        restoreScene = () => {
          scene.environment = environment
          scene.fog = fog
          for (const light of arrived) light.visible = true
        }
        drawables.forEach((object, index) => {
          const record = objectRecords[index]
          swap(object, standIn(object, record, drawnSignature))
        })
      } else {
        drawnScene = { signature, environment: scene.environment, fog: scene.fog, lights: new Set(lights) }
        drawables.forEach((object, index) => {
          const record = objectRecords[index]
          if (!record) return
          const instead = consult(object, record, pipelineKey(object, signature, record.presenter), signature, scene, camera, now)
          if (instead) swap(object, instead)
        })
      }
      held = swaps.length
      sweep(now)
      return () => {
        for (const [object, material] of swaps) object.material = material
        restoreScene()
      }
    },
    adopt(mesh, compilation) {
      const owned = compilationMaterials.get(compilation)
      const drawable = drawableOf(mesh)
      if (!owned || owned.adopted || !drawable) return
      owned.adopted = true
      const previous = records.get(mesh)
      release(previous?.drawn ?? null)
      release(previous?.pending ?? null)
      // The look was built under the scene as it stood then. When it has
      // changed since, the next draw rolls back to that scene until the
      // look for the new one is built.
      const builtUnder = owned.builtUnder
      const key = builtUnder ? pipelineKey(drawable, builtUnder.signature, true) : ''
      drawnScene ??= builtUnder
      records.set(mesh, { presenter: true, drawn: { key, signature: builtUnder?.signature ?? '', materials: owned.materials, built: true }, pending: null, changes: [], churnUntil: 0, seen: performance.now() })
    },
    holding: () => held + rest.pending(),
    draw: rest.draw,
    dispose() {
      queue.clear()
      for (const record of records.values()) {
        release(record.drawn)
        release(record.pending)
      }
      records.clear()
      rest.dispose()
    },
  }
}
