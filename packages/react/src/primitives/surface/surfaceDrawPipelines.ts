// Draw pipelines outside SurfaceCanvas — bakes built ahead, and a wait for
// renderers of their own.
//
// The law: no frame waits on a blocking pipeline build (decisions.md #80). A
// bake drawn once with something missing would keep the gap for good, so it
// is built ahead with `prebuildPipelines`. A renderer that draws to the
// screen skips each render whose pipelines are not built
// (`waitForDrawPipelines`). Measured 2026-11-26 on Light, five pipelines the
// wait built were still created again with the blocking call; the cause is
// not known (decisions.md #80).
//
// Ownership: renderers SurfaceCanvas does not own. The canvas hold is
// surfaceCompile.ts's.

import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { isDevelopmentRuntime } from '../../lib/developmentRuntime'
import { type OutputSettings, createOutputRest } from './surfaceOutputRest'
import { CHURN_CHANGES, CHURN_WINDOW_MS } from './surfaceHold'

/** A compileAsync of the pipelines a render of `scene` now would build. */
function compileForDraw(renderer: WebGPURenderer, scene: THREE.Object3D, camera: THREE.Camera): Promise<void> {
  // compileAsync reads the target's formats from its render context, which
  // only a draw or initRenderTarget fills in, and takes depth and stencil
  // from the renderer where a draw into a target takes the target's.
  const target = renderer.getRenderTarget()
  if (!target) return renderer.compileAsync(scene, camera)
  renderer.initRenderTarget(target)
  const { depth, stencil } = renderer
  renderer.depth = target.depthBuffer
  renderer.stencil = target.stencilBuffer
  try {
    return renderer.compileAsync(scene, camera)
  } finally {
    renderer.depth = depth
    renderer.stencil = stencil
  }
}

/**
 * Build ahead, asynchronously, every pipeline `draw` would build: `draw`
 * runs once with each of the renderer's renders replaced by a
 * `compileAsync` of the same object under the same target, and its clears
 * skipped. Resolves once those builds finish, so `draw` run again for real
 * builds nothing that blocks. `draw` must be repeatable, as a PMREM bake on
 * the same generator is. The builds read the dry run's render targets after
 * it returns, so dispose what it made only once this resolves. three reads
 * the output settings when it builds, after the dry run, so the renderer
 * keeps those of the dry run's last screen render until this resolves; draw
 * nothing to the screen meanwhile. Nothing is built ahead on the WebGL 2
 * fallback.
 */
export async function prebuildPipelines(renderer: WebGPURenderer, draw: () => void): Promise<void> {
  await renderer.init()
  if (!('device' in renderer.backend)) return
  const builds: Promise<void>[] = []
  const { render, clear } = renderer
  let screen: OutputSettings | null = null
  renderer.render = (scene, camera) => {
    if (!renderer.getRenderTarget()) screen = { toneMapping: renderer.toneMapping, outputColorSpace: renderer.outputColorSpace }
    builds.push(compileForDraw(renderer, scene, camera))
  }
  renderer.clear = () => {}
  try {
    draw()
  } finally {
    renderer.render = render
    renderer.clear = clear
  }
  const own: OutputSettings = { toneMapping: renderer.toneMapping, outputColorSpace: renderer.outputColorSpace }
  const settings: OutputSettings = screen ?? own
  renderer.toneMapping = settings.toneMapping
  renderer.outputColorSpace = settings.outputColorSpace
  try {
    await Promise.allSettled(builds)
  } finally {
    renderer.toneMapping = own.toneMapping
    renderer.outputColorSpace = own.outputColorSpace
  }
}

/** What a render of `scene` would build pipelines for, as one string. */
function drawKey(renderer: WebGPURenderer, scene: THREE.Object3D): string {
  const target = renderer.getRenderTarget()
  let key = target ? `${target.texture.format}.${target.texture.type}.${target.samples}.${target.depthBuffer}` : 'screen'
  key += ` ${renderer.toneMapping} ${renderer.outputColorSpace}`
  if (scene instanceof THREE.Scene) key += ` ${scene.environment?.uuid ?? '-'} ${scene.fog ? scene.fog.constructor.name : '-'}`
  scene.traverseVisible((object) => {
    if (object instanceof THREE.Light) {
      key += ` l${object.id}${object.castShadow ? 's' : ''}`
      return
    }
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line || object instanceof THREE.Sprite)) return
    const materials: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material]
    key += ` ${object.id}/${object.geometry.id}:${materials.map((material) => material.uuid + '.' + material.version).join(',')}`
  })
  return key
}

export interface DrawPipelineWait {
  /**
   * Run one frame's draws. Inside it, a render of a scene whose pipelines
   * are not built is skipped, so the canvas or target keeps what it last
   * showed, and the builds start. True when no render was skipped: a
   * skipped render leaves a WebGPU canvas with no texture to read this frame.
   */
  draw(render: () => void): boolean
  /** Renders the last frame skipped, and builds still running. */
  building(): number
  dispose(): void
}

/**
 * Skip, on a renderer outside SurfaceCanvas, each render whose
 * pipelines are not built until they are, so no frame waits on a blocking
 * build. A scene's render is skipped whole, which suits a renderer whose
 * scenes change seldom; SurfaceCanvas holds objects one by one instead.
 * `invalidate` runs when a build finishes. Renders outside `draw`, such as
 * a bake whose result is kept, are never skipped.
 */
export function waitForDrawPipelines(renderer: WebGPURenderer, invalidate: () => void): DrawPipelineWait {
  interface SceneDraw {
    readonly key: string
    built: boolean
    readonly changes: number[]
  }
  const rest = createOutputRest(renderer)
  const draws = new WeakMap<THREE.Object3D, SceneDraw>()
  const { render } = renderer
  let drawing = false
  let held = 0
  renderer.render = (scene, camera) => {
    if (!drawing || !('device' in renderer.backend)) return render.call(renderer, scene, camera)
    const key = drawKey(renderer, scene)
    let entry = draws.get(scene)
    if (entry?.key !== key) {
      const now = performance.now()
      const changes = (entry?.changes ?? []).filter((time) => now - time < CHURN_WINDOW_MS)
      changes.push(now)
      // A scene that changes this often draws as it is, as a held object does.
      const churning = changes.length >= CHURN_CHANGES
      const next: SceneDraw = { key, built: churning, changes }
      draws.set(scene, next)
      entry = next
      if (!churning) {
        rest.started()
        void compileForDraw(renderer, scene, camera)
          .catch((error) => {
            if (isDevelopmentRuntime()) console.error('[munari] a pipeline could not be built before its first draw, so it draws as three builds it.', error)
          })
          .finally(() => {
            next.built = true
            rest.settled()
            invalidate()
          })
      }
    }
    if (entry.built) return render.call(renderer, scene, camera)
    held++
  }
  return {
    draw(frame) {
      drawing = true
      held = 0
      try {
        rest.draw(frame)
      } finally {
        drawing = false
      }
      return held === 0
    },
    building: () => held + rest.pending(),
    dispose() {
      renderer.render = render
      rest.dispose()
    },
  }
}
