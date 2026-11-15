// Lab frame reads — DOM paint identity travels with the borrowed texture.
// A capture can finish after a newer edit, so readiness uses the DOM read,
// rather than the completion generation or the mutable texture version.
import {
  captureEngine,
  setCaptureEngine,
  type DomPaintReceipt,
  type DomTextureSource,
  type SurfaceManualPresenter,
} from '@petepetrash/munari/advanced'
import type { Mesh, Texture } from 'three'

export interface LabSurfaceFrame {
  readonly texture: Texture
  readonly paint: DomPaintReceipt
}

const sources = new WeakMap<HTMLCanvasElement, DomTextureSource>()

export function observeSurfaceSources() {
  const engine = captureEngine()
  setCaptureEngine({
    ...engine,
    createSource(...args) {
      const source = engine.createSource(...args)
      sources.set(source.canvas, source)
      return source
    },
  })
}

function sourceOf(texture: Texture | null) {
  const image: unknown = texture?.image
  return image instanceof HTMLCanvasElement ? sources.get(image) : undefined
}

export function readSurfaceFrame(texture: Texture): LabSurfaceFrame | null {
  const paint = sourceOf(texture)?.currentPaint()
  return paint ? { texture, paint } : null
}

export function waitForSurfaceFrame(
  texture: Texture,
  matches: (content: HTMLElement) => boolean,
  signal: AbortSignal,
): Promise<LabSurfaceFrame | null> {
  const source = sourceOf(texture)
  if (!source || signal.aborted) return Promise.resolve(null)

  return new Promise((resolve) => {
    let minimumRead: number | null = null
    let sawMatchingPaint = false
    let raf = 0
    const finish = (frame: LabSurfaceFrame | null) => {
      cancelAnimationFrame(raf)
      signal.removeEventListener('abort', abort)
      resolve(frame)
    }
    const abort = () => finish(null)
    const check = () => {
      if (!matches(source.element)) {
        minimumRead = null
        sawMatchingPaint = false
      } else if (minimumRead === null) {
        minimumRead = source.nextRead()
        source.repaint({ immediate: true })
      } else {
        // Native paint receipts can precede the canvas copy completing.
        // Inspect in a frame after the engine has had a chance to resolve it.
        const frame = readSurfaceFrame(texture)
        if (frame && frame.paint.read >= minimumRead) {
          if (!source.drawTrailsPaint || sawMatchingPaint) {
            finish(frame)
            return
          }
          sawMatchingPaint = true
        }
      }
      raf = requestAnimationFrame(check)
    }
    signal.addEventListener('abort', abort, { once: true })
    check()
  })
}

interface SampledFrame {
  frame: LabSurfaceFrame
  presenter: SurfaceManualPresenter
}

export function drawSurfaceOutput(
  mesh: Mesh,
  draw: () => void,
  sampled: readonly SampledFrame[],
) {
  const { onBeforeRender, onAfterRender } = mesh
  let began: { call: number; triangles: number } | null = null
  let presented = false
  mesh.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
    onBeforeRender.call(this, renderer, scene, camera, geometry, material, group)
    began = null
    if (renderer.getRenderTarget() !== null || scene.overrideMaterial || material !== mesh.material || !material.colorWrite) return
    const { calls, triangles } = renderer.info.render
    began = { call: calls, triangles }
  }
  mesh.onAfterRender = function (renderer, scene, camera, geometry, material, group) {
    const { calls, triangles } = renderer.info.render
    presented ||= began !== null && calls === began.call && triangles > began.triangles &&
      renderer.getRenderTarget() === null && material === mesh.material && material.colorWrite
    onAfterRender.call(this, renderer, scene, camera, geometry, material, group)
  }
  try {
    draw()
  } finally {
    mesh.onBeforeRender = onBeforeRender
    mesh.onAfterRender = onAfterRender
  }
  if (!presented) return
  for (const { frame, presenter } of sampled) {
    if (sourceOf(frame.texture)?.currentPaint()?.frame !== frame.paint.frame) continue
    presenter.prove()
    presenter.present()
  }
}
