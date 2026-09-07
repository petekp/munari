// Home relief — the page's matter, rendered off the page as masks the light
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

const INK_MARGIN = 40
const RELIEF_MARGIN = 60
const MAX_PIXEL_RATIO = 2
// Relief is boxes and a 6px blur: nothing in it needs more than half a
// pixel per CSS px, and the whole page repaints in a quarter of the time.
const RELIEF_RATIO = 0.5
/** Glyph ink: sharp, then three widening pre-blurs, one per channel. */
export const INK_BLUR_RADII = [0, 4, 12, 28] as const
/** Relief blurs: the raised foot's soft edge, and the well rim's. */
export const RAISED_BLUR = 6
const WELL_BLUR = 3
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
  /** RGBA bytes, `width` × `height` device pixels, one coverage per channel. */
  readonly data: Uint8Array
  readonly width: number
  readonly height: number
  /** The area the pixels cover, in CSS px relative to the anchor's box. */
  readonly rect: AnchoredRect
}

interface LineLayout {
  readonly text: string
  readonly x: number
  readonly y: number
  readonly font: string
  readonly letterSpacing: string
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

// getImageData is unpremultiplied, so each pass's alpha byte is its exact
// coverage; four passes pack into one RGBA buffer.
function pack(passes: readonly (ImageData | null)[], rect: AnchoredRect): Mask | null {
  const [a, b, c, d] = passes
  if (!a || !b || !c || !d) return null
  const data = new Uint8Array(a.data.length)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = a.data[i + 3]
    data[i + 1] = b.data[i + 3]
    data[i + 2] = c.data[i + 3]
    data[i + 3] = d.data[i + 3]
  }
  return { data, width: a.width, height: a.height, rect }
}

/** The headline's glyphs, one line element each, in four blur levels. */
export function buildInkMask(anchor: HTMLElement, lines: readonly HTMLElement[]): Mask | null {
  if (lines.length === 0) return null
  const base = anchor.getBoundingClientRect()
  const rects = lines.map((line) => line.getBoundingClientRect())
  const left = Math.min(...rects.map((rect) => rect.left)) - INK_MARGIN
  const top = Math.min(...rects.map((rect) => rect.top)) - INK_MARGIN
  const width = Math.max(...rects.map((rect) => rect.right)) + INK_MARGIN - left
  const height = Math.max(...rects.map((rect) => rect.bottom)) + INK_MARGIN - top
  if (width <= 0 || height <= 0) return null

  const layout: LineLayout[] = lines.map((line, index) => {
    const rect = rects[index]
    const style = getComputedStyle(line)
    return {
      text: line.textContent ?? '',
      x: rect.left - left,
      y: rect.top - top,
      font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
      letterSpacing: style.letterSpacing,
    }
  })
  const ratio = pixelRatio()
  const paintLines = (blur: number) => (context: Painter) => {
    context.textBaseline = 'top'
    context.filter = blur > 0 ? `blur(${blur}px)` : 'none'
    for (const line of layout) {
      context.font = line.font
      context.letterSpacing = line.letterSpacing
      context.fillText(line.text, line.x, line.y)
    }
  }
  return pack(
    INK_BLUR_RADII.map((blur) => pass(width, height, ratio, domPainter, paintLines(blur))),
    { x: left - base.left, y: top - base.top, width, height },
  )
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
 * matter scrolling in from beyond it had no shadow until the scroll
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
 * Paints a plan: raised into R/G (sharp, blurred), wells into B/A, at half
 * resolution — boxes need no subpixel ink.
 */
export function paintRelief(plan: ReliefPlan, create: PainterFactory): Mask | null {
  // A canvas blur is in device px whatever the transform, so it is scaled here.
  const paintKind = (kind: ReliefKind, blur: number) => (context: Painter) => {
    context.filter = blur > 0 ? `blur(${blur * RELIEF_RATIO}px)` : 'none'
    for (const box of plan.boxes) {
      if (box.kind !== kind) continue
      context.beginPath()
      context.roundRect(box.x, box.y, box.width, box.height, box.radius)
      context.fill()
    }
  }
  const { width, height } = plan
  return pack(
    [
      pass(width, height, RELIEF_RATIO, create, paintKind('raised', 0)),
      pass(width, height, RELIEF_RATIO, create, paintKind('raised', RAISED_BLUR)),
      pass(width, height, RELIEF_RATIO, create, paintKind('well', 0)),
      pass(width, height, RELIEF_RATIO, create, paintKind('well', WELL_BLUR)),
    ],
    plan.rect,
  )
}
