// Home relief — the page content, rendered off the page as masks the light
// shader samples: the headline's exact glyphs, and every element that
// declares itself raised or sunk with `data-relief`.
//
// The law: these pixels never appear on screen. Rects are stored relative
// to an anchor element, not the viewport, so scrolling moves the mask's
// frame per frame without repainting it. The packed channels leave as raw
// bytes, never through a canvas: a 2D canvas stores premultiplied pixels,
// and wherever the alpha channel was zero it zeroed the other three
// (the well channels vanished, 2026-09-05).
//
// Fault: the lamp spike measured in viewport coordinates on a page that
// never scrolled. The overview scrolls, and the first attempt at reusing the
// spike put the headline's shadow two screens away from the headline.
//
// Relief is measured on the main thread (a box list, cheap) and painted
// wherever a 2D context can be had: homeReliefWorker.ts paints it off the
// main thread, because a whole-page repaint on the main thread stalled a
// frame by 34ms right through the postcard's launch (probe, 2026-09-05).
//
// Ownership: this module owns the offscreen canvases and reading DOM
// boxes into them. HomeMasthead.tsx owns when to rebuild and how the pixels
// reach the shader. homeLight.ts owns what the channels mean.

import { packShadowDistances, shadowDistances, SHADOW_DISTANCE_RANGE } from './homeShadowField'

const INK_MARGIN = 40
const RELIEF_MARGIN = 60
const MAX_PIXEL_RATIO = 2
// Rounded boxes need less outline detail than the headline. Half resolution
// keeps the worker's distance transform small; decision #50 pins the pixels.
const RELIEF_RATIO = 0.5
/** Which `data-relief` values the mask paints, and into which channel pair. */
export const RELIEF_KINDS = ['raised', 'well'] as const
export type ReliefKind = (typeof RELIEF_KINDS)[number]

export interface AnchoredRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface Mask {
  /** RGBA bytes: a signed distance in RG and a second in BA, each 16 bits. */
  readonly data: Uint8Array
  readonly width: number
  readonly height: number
  /** The area the pixels cover, in CSS px relative to the anchor's box. */
  readonly rect: AnchoredRect
}

export interface InkMask extends Mask {
  readonly alpha: Uint8Array
  readonly ratio: number
}

interface LineLayout {
  readonly text: string
  readonly x: number
  readonly y: number
  readonly font: string
  readonly letterSpacing: string
  readonly lineHeight: number
}

function pixelRatio(): number {
  return Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO)
}

/** A 2D context from either world; the painters use only what both share. */
export type Painter = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
export type PainterFactory = (width: number, height: number) => Painter | null

/** A context on a DOM canvas, for the main thread. */
export function domPainter(width: number, height: number): Painter | null {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas.getContext('2d')
}

function pass(width: number, height: number, ratio: number, create: PainterFactory, paint: (context: Painter) => void): ImageData | null {
  const pixelWidth = Math.ceil(width * ratio)
  const pixelHeight = Math.ceil(height * ratio)
  const context = create(pixelWidth, pixelHeight)
  if (!context) return null
  context.save()
  context.scale(ratio, ratio)
  context.fillStyle = '#fff'
  paint(context)
  context.restore()
  return context.getImageData(0, 0, pixelWidth, pixelHeight)
}

function matchesInkPixels(previous: InkMask, image: ImageData, rect: AnchoredRect, ratio: number): boolean {
  if (previous.ratio !== ratio || previous.width !== image.width || previous.height !== image.height ||
    previous.rect.x !== rect.x || previous.rect.y !== rect.y || previous.rect.width !== rect.width || previous.rect.height !== rect.height) return false
  const alpha = previous.alpha
  for (let i = 0; i < alpha.length; i++) if (alpha[i] !== image.data[i * 4 + 3]) return false
  return true
}

/** The headline's glyph outlines as a signed distance field. */
export function buildInkMask(anchor: HTMLElement, lines: readonly HTMLElement[], previous?: InkMask): InkMask | null {
  if (lines.length === 0) return null
  const base = anchor.getBoundingClientRect()
  const rects = lines.map((line) => line.getBoundingClientRect())
  const left = Math.min(...rects.map((rect) => rect.left)) - INK_MARGIN
  const top = Math.min(...rects.map((rect) => rect.top)) - INK_MARGIN
  const width = Math.max(...rects.map((rect) => rect.right)) + INK_MARGIN - left
  const height = Math.max(...rects.map((rect) => rect.bottom)) + INK_MARGIN - top
  if (width <= 0 || height <= 0) return null

  const layout: LineLayout[] = []
  // Each styled text run owns its font and baseline. Painting a whole mixed
  // line with its parent's font puts the monospace and 3D words in wrong shadows.
  for (const line of lines) {
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim() || !node.parentElement) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      const rect = range.getBoundingClientRect()
      const style = getComputedStyle(node.parentElement)
      layout.push({
        text: node.textContent,
        x: rect.left - left,
        y: rect.top - top,
        font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
        letterSpacing: style.letterSpacing,
        lineHeight: rect.height,
      })
    }
  }
  const ratio = pixelRatio()
  const paintLines = (context: Painter) => {
    context.textBaseline = 'alphabetic'
    for (const line of layout) {
      context.font = line.font
      context.letterSpacing = line.letterSpacing
      const metrics = context.measureText(line.text)
      const baseline = line.y + (line.lineHeight + metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2
      context.fillText(line.text, line.x, baseline)
    }
  }
  const image = pass(width, height, ratio, domPainter, paintLines)
  if (!image) return null
  const rect = { x: left - base.left, y: top - base.top, width, height }
  // Compare the browser's actual coverage, rather than guessing which font or
  // layout changes affect it. Repeated startup/resize notifications then reuse
  // the distance field and its GPU texture without losing subtle glyph changes.
  if (previous && matchesInkPixels(previous, image, rect, ratio)) return previous
  const alpha = new Uint8Array(image.width * image.height)
  for (let i = 0; i < alpha.length; i++) alpha[i] = image.data[i * 4 + 3]!
  return {
    data: packShadowDistances(shadowDistances(image.data, image.width, image.height, ratio)),
    width: image.width,
    height: image.height,
    rect, alpha, ratio,
  }
}

/** One raised or sunk box, in CSS px relative to the mask's origin. */
export interface ReliefBox {
  readonly kind: ReliefKind
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly radius: number
}

/** Everything a painter needs, measured on the main thread; safe to post to a worker. */
export interface ReliefPlan {
  readonly boxes: readonly ReliefBox[]
  readonly width: number
  readonly height: number
  readonly rect: AnchoredRect
}

/**
 * Every `[data-relief]` element under `root`, measured as a box. The whole
 * page is measured, not a window around the viewport: a window meant
 * content scrolling in from beyond it had no shadow until the scroll
 * settled and the mask was rebuilt (2026-09-05).
 */
export function measureRelief(anchor: HTMLElement, root: HTMLElement): ReliefPlan | null {
  const base = anchor.getBoundingClientRect()
  const found: { kind: ReliefKind; rect: DOMRect; radius: number }[] = []
  for (const element of root.querySelectorAll<HTMLElement>('[data-relief]')) {
    const kind = element.dataset.relief
    if (kind !== 'raised' && kind !== 'well') continue
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    if (element.closest('[hidden], [aria-hidden="true"]')) continue
    const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0
    found.push({ kind, rect, radius })
  }
  if (found.length === 0) return null
  const left = Math.min(...found.map((b) => b.rect.left)) - RELIEF_MARGIN
  const top = Math.min(...found.map((b) => b.rect.top)) - RELIEF_MARGIN
  const width = Math.max(...found.map((b) => b.rect.right)) + RELIEF_MARGIN - left
  const height = Math.max(...found.map((b) => b.rect.bottom)) + RELIEF_MARGIN - top
  if (width <= 0 || height <= 0) return null
  return {
    boxes: found.map((b) => ({ kind: b.kind, x: b.rect.left - left, y: b.rect.top - top, width: b.rect.width, height: b.rect.height, radius: b.radius })),
    width,
    height,
    rect: { x: left - base.left, y: top - base.top, width, height },
  }
}

/**
 * Paint raised and recessed outlines, then pack their signed distances.
 * This runs in the existing worker; light movement never rebuilds it.
 */
export function paintRelief(plan: ReliefPlan, create: PainterFactory): Mask | null {
  const pixelWidth = Math.ceil(plan.width * RELIEF_RATIO)
  const pixelHeight = Math.ceil(plan.height * RELIEF_RATIO)
  const distances = (kind: ReliefKind) => {
    const field = new Float32Array(pixelWidth * pixelHeight).fill(SHADOW_DISTANCE_RANGE)
    const boxes = plan.boxes.filter(box => box.kind === kind)
    if (!boxes.length) return field
    const context = create(pixelWidth, pixelHeight)
    if (!context) return null
    context.save()
    context.scale(RELIEF_RATIO, RELIEF_RATIO)
    context.fillStyle = '#fff'
    for (const box of boxes) {
      context.beginPath()
      context.roundRect(box.x, box.y, box.width, box.height, box.radius)
      context.fill()
    }
    context.restore()
    // Keep the original raster grid. Beyond this padded bound the packed field
    // saturates to +256 CSS px, so an exact transform there cannot change a byte.
    // One extra pixel includes the antialiased contour (decision #58).
    const padding = Math.ceil(SHADOW_DISTANCE_RANGE * RELIEF_RATIO) + 1
    const left = Math.max(0, Math.floor(Math.min(...boxes.map(box => box.x)) * RELIEF_RATIO) - padding)
    const top = Math.max(0, Math.floor(Math.min(...boxes.map(box => box.y)) * RELIEF_RATIO) - padding)
    const right = Math.min(pixelWidth, Math.ceil(Math.max(...boxes.map(box => box.x + box.width)) * RELIEF_RATIO) + padding)
    const bottom = Math.min(pixelHeight, Math.ceil(Math.max(...boxes.map(box => box.y + box.height)) * RELIEF_RATIO) + padding)
    if (right <= left || bottom <= top) return field
    const image = context.getImageData(left, top, right - left, bottom - top)
    const cropped = shadowDistances(image.data, image.width, image.height, RELIEF_RATIO)
    for (let row = 0; row < image.height; row++) field.set(cropped.subarray(row * image.width, (row + 1) * image.width), (top + row) * pixelWidth + left)
    return field
  }
  const raised = distances('raised')
  const well = distances('well')
  if (!raised || !well) return null
  return {
    data: packShadowDistances(raised, well),
    width: pixelWidth,
    height: pixelHeight,
    rect: plan.rect,
  }
}
