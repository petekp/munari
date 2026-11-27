// Observed clears — the presentations a render erases when it clears a
// render target, discarded as the clear happens.
//
// The law: a presentation deferred to the end of the frame is gone once its
// target is cleared, so the host discards it (decisions.md #72). three passes
// a Scene's render its target only in onBeforeRender, so the clear is
// observed there.
//
// Ownership: SurfaceCanvas's render wrapper calls this; the host owns the
// presentations it discards.

import { Color, RenderTarget, Scene, type Camera, type Object3D } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import type { SurfaceHost } from './surfaceHostRegistry'

export function discardClearedTarget(host: SurfaceHost, renderer: WebGPURenderer, scene: Object3D, target = renderer.getRenderTarget()) {
  if (!target || !renderer.autoClearColor) return
  const backgroundClears = scene instanceof Scene && scene.background instanceof Color && !scene.backgroundNode
  if (renderer.autoClear || backgroundClears) host.discardTargetPresentations(target)
}

export function renderWithObservedClear(host: SurfaceHost, renderer: WebGPURenderer, render: WebGPURenderer['render'], scene: Object3D, camera: Camera) {
  if (!(scene instanceof Scene)) {
    discardClearedTarget(host, renderer, scene)
    render(scene, camera)
    return
  }
  const before = scene.onBeforeRender
  const ownedBefore = Object.prototype.hasOwnProperty.call(scene, 'onBeforeRender')
  const observe: Scene['onBeforeRender'] = function (this: Scene, ...args) {
    before.apply(this, args)
    // Scene supplies a fixed target here; Object3D types instead describe geometry.
    const target: unknown = args[3]
    if (target === null || target instanceof RenderTarget) discardClearedTarget(host, renderer, scene, target)
  }
  scene.onBeforeRender = observe
  try {
    render(scene, camera)
  } finally {
    if (scene.onBeforeRender === observe) {
      if (ownedBefore) scene.onBeforeRender = before
      else Reflect.deleteProperty(scene, 'onBeforeRender')
    }
  }
}
