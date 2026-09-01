// Rain glyph mask — the headline's exact ink, reduced to one number per
// column, so a falling drop can land on a letter's curve instead of its
// bounding box.
//
// The law: this rasterizes the h1's rendered text to an offscreen canvas at
// its own computed font and position, then for each CSS-px column across
// its rect keeps only the topmost opaque pixel's viewport y. It never
// appears on screen and never touches rainLaw's drop state — it only turns
// live DOM ink into the plain numbers rainWater.ts already knows how to
// hold water on.
//
// Ownership: this module owns the offscreen canvas and the column
// reduction. rainField.tsx owns when to rebuild it (fonts.ready, resize).

import { RAIN_NO_SURFACE, type GlyphTerrain } from './rainWater'

const MASK_PIXEL_RATIO_CAP = 2
// Half of 255 — the antialiased edge of a glyph stroke crosses this within
// a pixel or two, close enough that the terrain's rim tracks the visible
// letterform rather than its faint feather.
const INK_ALPHA_THRESHOLD = 128

/** Rasterize a single-line heading and reduce it to a per-column ink terrain. */
export function buildGlyphTerrain(h1: HTMLElement): GlyphTerrain | null {
  const rect = h1.getBoundingClientRect()
  const width = Math.round(rect.width)
  const height = Math.round(rect.height)
  if (width <= 0 || height <= 0) return null

  const pixelRatio = Math.min(window.devicePixelRatio, MASK_PIXEL_RATIO_CAP)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * pixelRatio)
  canvas.height = Math.ceil(height * pixelRatio)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null

  const style = getComputedStyle(h1)
  context.scale(pixelRatio, pixelRatio)
  context.fillStyle = '#fff'
  context.textBaseline = 'top'
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  context.letterSpacing = style.letterSpacing
  context.fillText(h1.textContent ?? '', 0, 0)

  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = image.data
  const deviceWidth = canvas.width
  const deviceHeight = canvas.height
  const topInk: number[] = new Array(width).fill(RAIN_NO_SURFACE)
  for (let x = 0; x < width; x++) {
    const deviceX = Math.min(deviceWidth - 1, Math.round(x * pixelRatio))
    for (let deviceY = 0; deviceY < deviceHeight; deviceY++) {
      const alpha = pixels[(deviceY * deviceWidth + deviceX) * 4 + 3]
      if (alpha <= INK_ALPHA_THRESHOLD) continue
      topInk[x] = rect.top + deviceY / pixelRatio
      break
    }
  }

  return { left: rect.left, topInk }
}
