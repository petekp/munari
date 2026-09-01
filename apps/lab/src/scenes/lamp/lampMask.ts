// Headline mask — the headline's exact glyphs, rendered off the page, so
// the lamp shader can answer one question: is there ink at this point, and
// at what softness.
//
// The law: this canvas never appears on screen. It exists only to be
// sampled, at the page's own devicePixelRatio, four channels each holding
// the same glyphs pre-blurred by a different amount (see MASK_BLUR_RADII)
// — rasterizing each blur level once here is far cheaper than widening
// every shader tap into a wide blur kernel at every far-shadow pixel.
//
// Ownership: this module owns the offscreen canvas and reading the
// headline's rendered metrics into it. Lamp.tsx owns when to rebuild it and
// how its pixels reach the shader. lampShaders.ts owns mapping a shadow's
// throw distance onto these four levels and mixing between them.

// Room past each line's own box for a descender or diacritic, and for the
// widest pre-blurred pass's own spread past the glyph's sharp edge.
const MASK_MARGIN = 40
const MAX_PIXEL_RATIO = 2
// Canvas-space blur radii for the four packed channels (R, G, B, A —
// sharp, then three widening pre-blurs), sized to span the shader's own
// disc-tap radius range (MIN_PENUMBRA..MAX_PENUMBRA in lampShaders.ts) so
// a fragment sampling any one of these channels sees softness consistent
// with the taps scattering around it at that same throw. Four levels (not
// two) is what turns the shadow's penumbra from a single visible step
// into a continuous widen-with-distance gradient (round 5).
export const MASK_BLUR_RADII = [0, 4, 12, 28] as const

export interface HeadlineMaskRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface HeadlineMask {
  readonly canvas: HTMLCanvasElement
  /** Viewport CSS-pixel rect the canvas covers — the same frame the lamp's
   * own pointer-driven position is measured in. */
  readonly rect: HeadlineMaskRect
}

interface LineLayout {
  readonly text: string
  readonly x: number
  readonly y: number
  readonly font: string
  readonly letterSpacing: string
}

function paintLines(
  context: CanvasRenderingContext2D,
  lines: readonly LineLayout[],
  pixelRatio: number,
  blurPx: number,
) {
  context.save()
  context.scale(pixelRatio, pixelRatio)
  context.fillStyle = '#fff'
  context.textBaseline = 'top'
  context.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none'
  for (const line of lines) {
    context.font = line.font
    context.letterSpacing = line.letterSpacing
    context.fillText(line.text, line.x, line.y)
  }
  context.restore()
}

export function buildHeadlineMask(lines: readonly HTMLElement[]): HeadlineMask | null {
  if (lines.length === 0) return null
  const rects = lines.map((line) => line.getBoundingClientRect())
  const left = Math.min(...rects.map((rect) => rect.left)) - MASK_MARGIN
  const top = Math.min(...rects.map((rect) => rect.top)) - MASK_MARGIN
  const right = Math.max(...rects.map((rect) => rect.right)) + MASK_MARGIN
  const bottom = Math.max(...rects.map((rect) => rect.bottom)) + MASK_MARGIN
  const width = right - left
  const height = bottom - top
  if (width <= 0 || height <= 0) return null

  const pixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO)
  const pixelWidth = Math.ceil(width * pixelRatio)
  const pixelHeight = Math.ceil(height * pixelRatio)

  const layout: LineLayout[] = lines.map((line, index) => {
    const rect = rects[index]
    const style = getComputedStyle(line)
    return {
      text: line.textContent ?? '',
      x: rect.left - left,
      y: rect.top - top,
      font: `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
      letterSpacing: style.letterSpacing,
    }
  })

  // One canvas per blur level, each read back for its own channel below —
  // a canvas can only carry one context.filter blur at a time, so there is
  // no way to paint all four levels in a single pass.
  const sharpInk = paintPass(layout, pixelRatio, MASK_BLUR_RADII[0], pixelWidth, pixelHeight)
  const blur4Ink = paintPass(layout, pixelRatio, MASK_BLUR_RADII[1], pixelWidth, pixelHeight)
  const blur12Ink = paintPass(layout, pixelRatio, MASK_BLUR_RADII[2], pixelWidth, pixelHeight)
  const blur28Ink = paintPass(layout, pixelRatio, MASK_BLUR_RADII[3], pixelWidth, pixelHeight)
  if (!sharpInk || !blur4Ink || !blur12Ink || !blur28Ink) return null

  const canvas = document.createElement('canvas')
  canvas.width = pixelWidth
  canvas.height = pixelHeight
  const context = canvas.getContext('2d')
  if (!context) return null

  // getImageData is always unpremultiplied, so each pass's own alpha byte
  // (not its color, which is flat white) is exactly its ink coverage —
  // reading it straight into a channel skips a manual coverage recompute.
  // This packs the alpha channel with real coverage data (the widest
  // blur) rather than a flat 255 — safe because setLampMaskFrame's
  // texture.colorSpace stays NoColorSpace and premultiplyAlpha defaults to
  // false, so nothing in the upload path treats alpha as opacity.
  const merged = context.createImageData(pixelWidth, pixelHeight)
  for (let i = 0; i < merged.data.length; i += 4) {
    merged.data[i] = sharpInk.data[i + 3]
    merged.data[i + 1] = blur4Ink.data[i + 3]
    merged.data[i + 2] = blur12Ink.data[i + 3]
    merged.data[i + 3] = blur28Ink.data[i + 3]
  }
  context.putImageData(merged, 0, 0)

  return { canvas, rect: { x: left, y: top, width, height } }
}

function paintPass(
  layout: readonly LineLayout[],
  pixelRatio: number,
  blurPx: number,
  pixelWidth: number,
  pixelHeight: number,
): ImageData | null {
  const canvas = document.createElement('canvas')
  canvas.width = pixelWidth
  canvas.height = pixelHeight
  const context = canvas.getContext('2d')
  if (!context) return null
  paintLines(context, layout, pixelRatio, blurPx)
  return context.getImageData(0, 0, pixelWidth, pixelHeight)
}
