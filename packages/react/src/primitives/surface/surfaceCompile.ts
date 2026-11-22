// Surface compile — a presenter's render pipelines, built asynchronously
// before its first draw.
//
// The law: a presenter stays out of three's render path until every pipeline
// it will draw with has been built with `createRenderPipelineAsync` and sits
// in three's pipeline cache. three 0.186 builds a pipeline it lacks at the
// draw, with the blocking `createRenderPipeline`, and Chrome's Dawn runs that
// call on the GPU process's main thread, where the Metal compile stops raster
// and compositing until it returns. The asynchronous call compiles on a Dawn
// worker instead.
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
//
// decisions.md #76 states the rule.
//
// Ownership: this module builds pipelines and says when they are built. A
// build three could not finish still resolves (it logs the failure); whether
// a draw put pixels on screen stays with surfacePass's primitive count.

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type RootState } from '@react-three/fiber'
import type { WebGPURenderer } from 'three/webgpu'
import { surfaceBelongsToScene } from './surfaceFrame'
import { isDevelopmentRuntime } from '../../lib/developmentRuntime'

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
  /** Run one canvas draw with the renderer's own output settings. */
  draw(render: () => void): void
  dispose(): void
}

interface OutputSettings {
  toneMapping: THREE.ToneMapping
  outputColorSpace: string
}

interface WriteFlags {
  readonly colorWrite: boolean
  readonly depthWrite: boolean
  readonly stencilWrite: boolean
}

const WRITE_FREE: WriteFlags = { colorWrite: false, depthWrite: false, stencilWrite: false }

const flagsKey = (flags: WriteFlags) => `${flags.colorWrite}${flags.depthWrite}${flags.stencilWrite}`

/** One clone per pipeline the material's draws can use. */
export function passMaterials(material: THREE.Material): THREE.Material[] {
  const authored: WriteFlags = { colorWrite: material.colorWrite, depthWrite: material.depthWrite, stencilWrite: material.stencilWrite }
  const flagSets = new Map<string, WriteFlags>()
  for (const flags of [authored, { ...authored, colorWrite: true }, WRITE_FREE]) flagSets.set(flagsKey(flags), flags)
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
 * Begin one build. Everything up to `compileAsync`'s first await runs here,
 * inside the caller's draw. A scene background would be collected ahead of
 * the stand-in and build first, pushing the stand-in's node build past that
 * await, so the background is lifted for the synchronous part only.
 */
function startBuild(renderer: WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, mesh: THREE.Mesh, material: THREE.Material): Promise<void> {
  const standIn = mesh.clone(false)
  standIn.material = material
  standIn.matrixAutoUpdate = false
  standIn.matrix.copy(mesh.matrixWorld)
  standIn.matrixWorld.copy(mesh.matrixWorld)
  standIn.visible = true
  standIn.frustumCulled = false
  let collected = false
  standIn.onBeforeRender = () => {
    collected = true
  }
  const { background, backgroundNode } = scene
  scene.background = null
  scene.backgroundNode = null
  let built: Promise<void>
  try {
    built = renderer.compileAsync(standIn, camera, scene)
  } finally {
    scene.background = background
    scene.backgroundNode = backgroundNode
  }
  if (collected) return built
  return built.then(() => {
    throw new Error('the mesh was not collected for the compile; check its layers against the camera')
  })
}

interface QueuedCompilation {
  readonly mesh: THREE.Mesh
  readonly materials: THREE.Material[]
  readonly resolve: () => void
}

function settle(builds: Promise<void>[], resolve: () => void): void {
  void Promise.allSettled(builds).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected' && isDevelopmentRuntime()) {
        console.error('[munari] a Surface presenter could not build a pipeline before its first draw, so it draws as three builds it.', result.reason)
      }
    }
    resolve()
  })
}

export function createSurfaceCompiler(renderer: WebGPURenderer, invalidate: () => void): SurfaceCompiler {
  const queue = new Set<QueuedCompilation>()
  let pendingBuilds = 0
  // The renderer's own output settings while it rests in the draw's.
  let own: OutputSettings | null = null
  const restInDrawSettings = () => {
    renderer.toneMapping = THREE.NoToneMapping
    renderer.outputColorSpace = THREE.ColorManagement.workingColorSpace
  }
  // A write made while the renderer rests is the caller's new setting. A
  // write of the resting value itself cannot be told apart and is lost.
  const takeWrites = (settings: OutputSettings) => {
    if (renderer.toneMapping !== THREE.NoToneMapping) settings.toneMapping = renderer.toneMapping
    if (renderer.outputColorSpace !== THREE.ColorManagement.workingColorSpace) settings.outputColorSpace = renderer.outputColorSpace
  }
  const buildSettled = () => {
    pendingBuilds--
    if (pendingBuilds > 0 || !own) return
    takeWrites(own)
    renderer.toneMapping = own.toneMapping
    renderer.outputColorSpace = own.outputColorSpace
    own = null
  }
  return {
    compile(mesh, material) {
      const materials = passMaterials(material)
      let released = false
      let queued: QueuedCompilation | null = null
      const ready = new Promise<void>((resolve) => {
        queued = { mesh, materials, resolve }
        queue.add(queued)
        invalidate()
      })
      return {
        ready,
        release() {
          if (released) return
          released = true
          if (queued) queue.delete(queued)
          for (const clone of materials) clone.dispose()
        },
      }
    },
    start(scene, camera) {
      if (queue.size === 0 || !(scene instanceof THREE.Scene)) return
      for (const entry of [...queue]) {
        if (!surfaceBelongsToScene(entry.mesh, scene)) continue
        queue.delete(entry)
        const builds = entry.materials.map((material) => {
          pendingBuilds++
          let build: Promise<void>
          try {
            build = startBuild(renderer, scene, camera, entry.mesh, material)
          } catch (error) {
            build = Promise.reject(error)
          }
          return build.finally(buildSettled)
        })
        settle(builds, entry.resolve)
      }
    },
    // Builds start inside `render`, where the renderer already has the draw's
    // settings, so its own are read after the draw has put them back.
    draw(render) {
      if (own) {
        takeWrites(own)
        renderer.toneMapping = own.toneMapping
        renderer.outputColorSpace = own.outputColorSpace
      }
      try {
        render()
      } finally {
        if (pendingBuilds > 0) {
          own = { toneMapping: renderer.toneMapping, outputColorSpace: renderer.outputColorSpace }
          restInDrawSettings()
        } else {
          own = null
        }
      }
    },
    dispose() {
      queue.clear()
      if (own) {
        takeWrites(own)
        renderer.toneMapping = own.toneMapping
        renderer.outputColorSpace = own.outputColorSpace
        own = null
      }
    },
  }
}

const compilers = new WeakMap<RootState['gl'] | WebGPURenderer, SurfaceCompiler>()

/** Install the compiler SurfaceCanvas runs for its renderer. Returns the uninstall. */
export function installSurfaceCompiler(renderer: WebGPURenderer, compiler: SurfaceCompiler): () => void {
  compilers.set(renderer, compiler)
  return () => {
    if (compilers.get(renderer) === compiler) compilers.delete(renderer)
    compiler.dispose()
  }
}

/** The compiler for a renderer a SurfaceCanvas created; null for any other. */
export function surfaceCompilerOf(renderer: RootState['gl'] | WebGPURenderer): SurfaceCompiler | null {
  return compilers.get(renderer) ?? null
}

/**
 * Whether `mesh` may draw: false until every pipeline its current material
 * draws with is built. Outside a SurfaceCanvas there is no compiler and the
 * answer is true at once. With `wait` false the mesh draws at once too.
 *
 * Only a presenter's first material is held back, and only when `wait` held
 * at its first frame. Hiding a mesh that has already drawn would take pixels
 * off a screen the page no longer covers, so a material replaced after that
 * draws as three builds it.
 */
export function useSurfaceCompiled(mesh: THREE.Mesh | null, wait = true): boolean {
  const gl = useThree((state) => state.gl)
  const [compiledMesh, setCompiledMesh] = useState<THREE.Mesh | null>(null)
  const pending = useRef<{ readonly mesh: THREE.Mesh; readonly material: THREE.Material; readonly compilation: SurfaceCompilation } | null>(null)
  const compiled = mesh !== null && compiledMesh === mesh

  useFrame(() => {
    if (!mesh || compiled) return
    const material = mesh.material
    const current = pending.current
    if (current?.mesh === mesh && current.material === material) return
    current?.compilation.release()
    pending.current = null
    const compiler = surfaceCompilerOf(gl)
    if (!wait || !compiler || Array.isArray(material)) {
      setCompiledMesh(mesh)
      return
    }
    const compilation = compiler.compile(mesh, material)
    const record = { mesh, material, compilation }
    pending.current = record
    void compilation.ready.then(() => {
      if (pending.current === record) setCompiledMesh(mesh)
    })
  })

  useEffect(
    () => () => {
      pending.current?.compilation.release()
      pending.current = null
    },
    [],
  )
  return compiled || !wait
}
