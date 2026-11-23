// Capture copy — a fullscreen pass that copies a borrowed capture into an effect's own target.
// A capture texture is reused by the next capture, so an effect that keeps pixels copies them.
import { passMaterial } from '@petepetrash/munari/advanced'
import {
  DataTexture,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  type RenderTarget,
  type Texture,
} from 'three'
import { texture } from 'three/tsl'
import type { WebGPURenderer } from 'three/webgpu'

export function createCaptureCopy() {
  const placeholder = new DataTexture(new Uint8Array(4), 1, 1)
  placeholder.needsUpdate = true
  placeholder.colorSpace = SRGBColorSpace
  const map = texture(placeholder)
  const material = passMaterial()
  material.outputNode = map
  const geometry = new PlaneGeometry(2, 2)
  const scene = new Scene()
  scene.add(new Mesh(geometry, material))
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)

  return {
    render(gl: WebGPURenderer, target: RenderTarget, source?: Texture, clear = true) {
      const previous = gl.getRenderTarget()
      const autoClear = gl.autoClear
      gl.autoClear = clear
      map.value = source ?? placeholder
      gl.setRenderTarget(target)
      try {
        gl.render(scene, camera)
      } finally {
        gl.setRenderTarget(previous)
        gl.autoClear = autoClear
        map.value = placeholder
      }
    },
    dispose() {
      material.dispose()
      geometry.dispose()
      placeholder.dispose()
    },
  }
}
