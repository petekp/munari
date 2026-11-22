// Canvas origin — whether a canvas's pixels may be uploaded to the GPU.
//
// A canvas that has drawn cross-origin content is tainted, and the browser
// refuses to upload it. FrameSurface checks its source with
// `canvasIsOriginClean` and uploads `blankCanvas()` in its place while the
// source is tainted.
//
// Ownership: this module answers the question; FrameSurface decides what to draw.

let originProbe: CanvasRenderingContext2D | null | undefined

/**
 * Whether a canvas's pixels may be uploaded, checked without creating a
 * context on the caller's canvas: drawing it into a private canvas carries its
 * taint there. True where no DOM exists to check with.
 */
export function canvasIsOriginClean(canvas: HTMLCanvasElement): boolean {
  if (originProbe === undefined) {
    originProbe = globalThis.document?.createElement('canvas').getContext('2d', { willReadFrequently: true }) ?? null
  }
  if (!originProbe || canvas.width === 0 || canvas.height === 0) return true
  // Setting the size clears the probe's own taint from an earlier check.
  originProbe.canvas.width = 1
  originProbe.canvas.height = 1
  try {
    originProbe.drawImage(canvas, 0, 0, 1, 1)
    originProbe.getImageData(0, 0, 1, 1)
    return true
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') return false
    throw error
  }
}

export function blankCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  return canvas
}
