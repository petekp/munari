// Draw pipelines outside SurfaceCanvas — bakes built ahead, and a wait for
// renderers of their own.
//
// The law: no frame waits on a blocking pipeline build (decisions.md #81). A
// bake drawn once with something missing would keep the gap for good, so it
// is built ahead with `prebuildPipelines`. A renderer that draws to the
// screen skips each render whose pipelines are not built
// (`waitForDrawPipelines`).
//
// Ownership: renderers SurfaceCanvas does not own. The canvas hold is
// surfaceCompile.ts's.

import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { isDevelopmentRuntime } from '../../lib/developmentRuntime'
import { type OutputSettings, createOutputRest } from './surfaceOutputRest'
import { CHURN_CHANGES, CHURN_WINDOW_MS } from './surfaceHold'

/** A compileAsync of the pipelines a render of `scene` now would build. */
function compileForDraw(renderer: WebGPURenderer, scene: THREE.Object3D, camera: THREE.Camera, targetScene: THREE.Scene | null = null): Promise<void> {
  // compileAsync reads the target's formats from its render context, which
  // only a draw or initRenderTarget fills in, and takes depth and stencil
  // from the renderer where a draw into a target takes the target's.
  const target = renderer.getRenderTarget()
  if (!target) return renderer.compileAsync(scene, camera, targetScene)
  renderer.initRenderTarget(target)
  const { depth, stencil } = renderer
  renderer.depth = target.depthBuffer
  renderer.stencil = target.stencilBuffer
  try {
    return renderer.compileAsync(scene, camera, targetScene)
  } finally {
    renderer.depth = depth
    renderer.stencil = stencil
  }
}

/**
 * compileForDraw for each object of `scene` on its own, all started now.
 * three makes a compile's render objects one at a time, awaiting each build,
 * and keys each by `renderer.contextNode` as it stands then. A render
 * pipeline sets its context node only for its draw, so in a compile of the
 * whole scene only the first object was keyed by it: on Light the others
 * were built again at the draw, five pipelines with the blocking call (m2,
 * 2026-11-27). A scene background would take that first place, so it is
 * compiled apart.
 */
function compileEachForDraw(renderer: WebGPURenderer, scene: THREE.Object3D, camera: THREE.Camera): Promise<void> {
  if (!(scene instanceof THREE.Scene)) return compileForDraw(renderer, scene, camera)
  const objects: (THREE.Mesh | THREE.Points | THREE.Line | THREE.Sprite)[] = []
  scene.traverseVisible((object) => {
    if ((object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line || object instanceof THREE.Sprite) && object.layers.test(camera.layers)) objects.push(object)
  })
  const builds: Promise<void>[] = []
  const { background, backgroundNode } = scene
  if (background || backgroundNode) builds.push(compileForDraw(renderer, new THREE.Group(), camera, scene))
  scene.background = null
  scene.backgroundNode = null
  try {
    for (const object of objects) {
      // Each child is compiled on its own.
      const children = object.children.filter((child) => child.visible)
      for (const child of children) child.visible = false
      // A material array is compiled one material at a time, under its
      // draw's render objects, which three keys by object and material.
      const { material } = object
      try {
        for (const one of Array.isArray(material) ? material : [material]) {
          object.material = one
          builds.push(compileForDraw(renderer, object, camera, scene))
        }
      } finally {
        object.material = material
        for (const child of children) child.visible = true
      }
    }
  } finally {
    scene.background = background
    scene.backgroundNode = backgroundNode
  }
  return Promise.all(builds).then(() => {})
}

// three 0.186's material cache key (RenderObject.getMaterialCacheKey), which
// keys a material's node build together with the scene's.
const UNKEYED_PROPERTY = /^(is[A-Z]|_)|^(visible|version|uuid|name|opacity|userData)$/

function materialBuildKey(material: THREE.Material): string {
  let key = material.type + material.customProgramCacheKey()
  for (const [name, value] of Object.entries(material)) {
    if (UNKEYED_PROPERTY.test(name)) continue
    if (Number.isFinite(value)) key += name === 'side' ? String(value) : Number(value) !== 0 ? '1' : '0'
    else if (value instanceof THREE.Texture) key += `{${value.mapping}${value.magFilter}${value.minFilter}${value.wrapS}${value.wrapT}}`
    else key += value instanceof Object ? '{}' : String(value)
    key += ','
  }
  return key
}

function geometryBuildKey(geometry: THREE.BufferGeometry): string {
  const attributes = Object.entries(geometry.attributes).map(([name, attribute]) => name + attribute.itemSize)
  return `${attributes.join(',')}${geometry.index ? ' i' : ''} ${Object.keys(geometry.morphAttributes).join(',')}`
}

/**
 * What a render of `scene` now would build node graphs for, as one string.
 * A PMREM bake draws each level with its own mesh and material, whose builds
 * are the same, so objects are keyed by content. three keys a node build by
 * the render target it draws into, so the target is keyed by identity.
 */
function bakeRenderKey(renderer: WebGPURenderer, scene: THREE.Object3D): string {
  const target = renderer.getRenderTarget()
  let key = `${target ? target.texture.uuid : 'screen'} ${renderer.toneMapping} ${renderer.outputColorSpace}`
  if (scene instanceof THREE.Scene) {
    key += ` ${scene.environment?.uuid ?? '-'} ${scene.fog ? scene.fog.constructor.name : '-'}`
    key += scene.background ? (scene.background instanceof THREE.Texture ? scene.background.uuid : 'b') : '-'
  }
  scene.traverseVisible((object) => {
    if (object instanceof THREE.Light) {
      key += ` l${object.id}${object.castShadow ? 's' : ''}`
      return
    }
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line || object instanceof THREE.Sprite)) return
    const materials: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material]
    key += ` ${object.type}${object.receiveShadow ? 'r' : ''} ${geometryBuildKey(object.geometry)}:${materials.map(materialBuildKey).join(';')}`
  })
  return key
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
  // three caches a node build only once its build finishes, so renders
  // with equal keys compiled together each build in full: a PMREM bake's 40
  // renders of one material cost 85 ms of main thread against three's own
  // 15 ms (m2, 2026-11-27). One compile per key builds what all of them draw.
  const compiled = new Set<string>()
  renderer.render = (scene, camera) => {
    if (!renderer.getRenderTarget()) screen = { toneMapping: renderer.toneMapping, outputColorSpace: renderer.outputColorSpace }
    const key = bakeRenderKey(renderer, scene)
    if (compiled.has(key)) return
    compiled.add(key)
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
        void compileEachForDraw(renderer, scene, camera)
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
