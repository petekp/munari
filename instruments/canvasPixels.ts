// Canvas pixel readback for WebGPURenderer — what `render()` left on the canvas.
//
// WebGPU has no `readPixels` on the canvas, and its canvas texture is replaced
// once the browser presents. A read is valid only after `render()` returns, in
// the same task, which is when Three has submitted the frame. Coordinates are
// drawing-buffer pixels with y from the bottom, and values are premultiplied,
// as `gl.readPixels` returned them. `getImageData` un-premultiplies, so a
// translucent pixel is multiplied back, within 1 per channel of the stored value.

const readback = document.createElement('canvas')
const readbackContext = readback.getContext('2d', { willReadFrequently: true })!

/** Copy the canvas now, so several pixels can be read from one frame. */
export function snapshotCanvas(canvas: HTMLCanvasElement): (x: number, yFromBottom: number) => number[] {
  readback.width = canvas.width
  readback.height = canvas.height
  readbackContext.clearRect(0, 0, readback.width, readback.height)
  readbackContext.drawImage(canvas, 0, 0)
  return (x, yFromBottom) => {
    const row = canvas.height - 1 - Math.round(yFromBottom)
    const [r = 0, g = 0, b = 0, a = 0] = readbackContext.getImageData(Math.round(x), row, 1, 1).data
    return [Math.round((r * a) / 255), Math.round((g * a) / 255), Math.round((b * a) / 255), a]
  }
}

interface Renders {
  render(...args: never[]): void
}

const afterRenders = new WeakMap<Renders, Set<() => void>>()

/**
 * Run `after` each time `renderer.render` returns. Returns the undo. One
 * wrapper serves every caller on a renderer, so callers can come and go in
 * any order.
 */
export function afterEachRender(renderer: Renders, after: () => void): () => void {
  let callbacks = afterRenders.get(renderer)
  if (!callbacks) {
    const registered = new Set<() => void>()
    callbacks = registered
    afterRenders.set(renderer, registered)
    const original = renderer.render
    renderer.render = (...args: never[]) => {
      original.apply(renderer, args)
      for (const callback of registered) callback()
    }
  }
  callbacks.add(after)
  const registered = callbacks
  return () => void registered.delete(after)
}

interface GpuBackend {
  readonly device?: EventTarget
  readonly gl?: WebGL2RenderingContext
}

/**
 * GPU errors since the last call: WebGPU validation errors, or the WebGL 2
 * fallback's `getError()`. Zero means the device accepted every upload and
 * draw, which is what the probes' `gl.getError() === 0` asserted on WebGL.
 */
/** A WebGPURenderer, or the WebGLRenderer Fiber types it as. */
interface CanvasRenderer {
  readonly domElement: HTMLCanvasElement
  readonly backend?: object
}

export function gpuErrors(renderer: CanvasRenderer): () => number {
  // SAFETY: WebGPUBackend has `device` and WebGLBackend has `gl`; Three's
  // types declare neither on the Backend base, and a GL renderer has none.
  const backend = (renderer.backend ?? {}) as GpuBackend
  let count = 0
  backend.device?.addEventListener('uncapturederror', () => {
    count += 1
  })
  return () => {
    if (backend.gl) {
      while (backend.gl.getError() !== backend.gl.NO_ERROR) count += 1
    }
    const seen = count
    count = 0
    return seen
  }
}
