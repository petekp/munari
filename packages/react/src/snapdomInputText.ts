// Input text painter — browser text over a retained blank input bitmap.
// A direct edit must match the accepted SVG's seed pixels before it can run.
// Detached Canvas text changed 1,527 Controls pixels in the 2026-10-13 probe;
// the 2× matrix also rejected fractional horizontal phases (decision #62).
// This module owns text eligibility and bitmaps; the region owner invalidates
// its snapshot, and core owns publication.

import { captureContext } from '@munari/core'

export interface InputTextSnapshot {
  canReuse(field: HTMLInputElement, value: string, scroll: readonly [number, number]): boolean
  blank(): Promise<HTMLImageElement>
  fontsEmbedded(): Promise<boolean>
}

interface InputTextPainterOptions {
  readonly template: InputTextSnapshot
  readonly root: HTMLElement
  readonly field: HTMLInputElement
  readonly value: string
  readonly target: HTMLCanvasElement
  readonly rootBox: DOMRectReadOnly
  readonly fieldBox: DOMRectReadOnly
  readonly clip: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly scaleX: number
  readonly scaleY: number
  readonly signal: AbortSignal
}

interface TextPaint {
  readonly font: string
  readonly color: string
  readonly smoothing: string
  readonly lang: string
  readonly kerning: 'normal' | 'none'
  readonly letterSpacing: string
  readonly wordSpacing: string
  readonly textX: number
  readonly contentTop: number
  readonly contentWidth: number
  readonly contentHeight: number
  readonly fieldTop: number
  readonly fieldHeight: number
}

interface FieldPixels {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

type TextGeometry = Pick<TextPaint, 'textX' | 'contentTop' | 'contentWidth' | 'contentHeight' | 'fieldTop' | 'fieldHeight'>

const initialTextProperties = [
  ['writing-mode', 'horizontal-tb'],
  ['font-style', 'normal'],
  ['font-stretch', '100%'],
  ['font-feature-settings', 'normal'],
  ['font-variation-settings', 'normal'],
  ['font-variant', 'normal'],
  ['font-size-adjust', 'none'],
  ['font-optical-sizing', 'auto'],
  ['text-rendering', 'auto'],
  ['text-transform', 'none'],
  ['text-indent', '0px'],
  ['text-decoration-line', 'none'],
  ['-webkit-text-stroke-width', '0px'],
  ['-webkit-text-security', 'none'],
] as const

const optionalInitialFontProperties = [
  ['font-palette', 'normal'],
  ['font-language-override', 'normal'],
  ['font-synthesis-weight', 'auto'],
  ['font-synthesis-style', 'auto'],
  ['font-synthesis-small-caps', 'auto'],
  ['font-synthesis-position', 'auto'],
] as const

const hasInitialOptionalFontProperties = (style: CSSStyleDeclaration) =>
  optionalInitialFontProperties.every(([property, initial]) => {
    const value = style.getPropertyValue(property)
    return value === '' || value === initial
  })

type TextBounds = Pick<DOMRectReadOnly, 'left' | 'top' | 'right' | 'bottom'>

const radiusLength = (value: string, axis: number) => {
  const lengths = value.split(' ')
  const length = lengths[axis] ?? lengths[0] ?? ''
  return /^\d+(?:\.\d+)?px$/.test(length) ? Number.parseFloat(length) : NaN
}

const clippingBoxContainsText = (element: HTMLElement, style: CSSStyleDeclaration, text: TextBounds) => {
  const rect = element.getBoundingClientRect()
  const left = rect.left + element.clientLeft, top = rect.top + element.clientTop
  const right = left + element.clientWidth, bottom = top + element.clientHeight
  if (text.left < left || text.right > right || text.top < top || text.bottom > bottom) return false
  const radii = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius]
  const radiusX = Math.max(...radii.map((radius) => radiusLength(radius, 0)))
  const radiusY = Math.max(...radii.map((radius) => radiusLength(radius, 1)))
  return text.left >= left + radiusX && text.right <= right - radiusX
    || text.top >= top + radiusY && text.bottom <= bottom - radiusY
}

const supportsTextPaint = (field: HTMLElement, root: HTMLElement, bounds: TextBounds) => {
  let element: HTMLElement | null = field
  while (element) {
    const style = getComputedStyle(element)
    if (style.opacity !== '1' || style.clipPath !== 'none' || style.clip !== 'auto' || style.maskImage !== 'none' || style.zoom !== '1') return false
    const clips = element === field || style.overflowX !== 'visible' || style.overflowY !== 'visible' || /(?:^| )(?:paint|strict|content)(?: |$)/.test(style.contain)
    if (clips && !clippingBoxContainsText(element, style, bounds)) return false
    if (element === root) return true
    element = element.parentElement
  }
  return false
}

const unscrolledInput = (field: HTMLInputElement) =>
  field.type === 'text' && field.list === null && field.ownerDocument.activeElement === field
    && field.selectionStart !== null && field.selectionStart === field.selectionEnd
    && field.scrollLeft === 0 && field.scrollTop === 0 && field.ownerDocument.fonts.status === 'loaded'

const readTextGeometry = (style: CSSStyleDeclaration, fieldBox: DOMRectReadOnly, rootBox: DOMRectReadOnly): TextGeometry | null => {
  const paddingLeft = Number.parseFloat(style.paddingLeft)
  const paddingRight = Number.parseFloat(style.paddingRight)
  const paddingTop = Number.parseFloat(style.paddingTop)
  const paddingBottom = Number.parseFloat(style.paddingBottom)
  const borderLeft = Number.parseFloat(style.borderLeftWidth)
  const borderRight = Number.parseFloat(style.borderRightWidth)
  const borderTop = Number.parseFloat(style.borderTopWidth)
  const borderBottom = Number.parseFloat(style.borderBottomWidth)
  const lineHeight = Number.parseFloat(style.lineHeight)
  const lengths = [paddingLeft, paddingRight, paddingTop, paddingBottom, borderLeft, borderRight, borderTop, borderBottom, lineHeight]
  if (!lengths.every(Number.isFinite) || paddingTop !== paddingBottom || borderTop !== borderBottom) return null
  const contentHeight = fieldBox.height - borderTop - borderBottom - paddingTop - paddingBottom
  const contentWidth = fieldBox.width - borderLeft - borderRight - paddingLeft - paddingRight
  if (contentHeight <= 0 || contentWidth <= 0 || lineHeight <= 0 || lineHeight > contentHeight) return null
  return {
    textX: fieldBox.x - rootBox.x + borderLeft + paddingLeft,
    contentTop: fieldBox.y - rootBox.y + borderTop + paddingTop,
    contentWidth,
    contentHeight,
    fieldTop: fieldBox.y - rootBox.y,
    fieldHeight: fieldBox.height,
  }
}

const textIsUncovered = (root: HTMLElement, field: HTMLInputElement, rootBox: DOMRectReadOnly, paint: TextPaint) => {
  const left = rootBox.x + paint.textX, top = rootBox.y + paint.contentTop
  const right = left + paint.contentWidth, bottom = top + paint.contentHeight
  for (const element of root.querySelectorAll('*')) {
    if (element.contains(field) || field.contains(element)) continue
    for (const rect of element.getClientRects()) {
      if (rect.width > 0 && rect.height > 0 && rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top) return false
    }
  }
  return true
}

const readTextPaint = (root: HTMLElement, field: HTMLInputElement, fieldBox: DOMRectReadOnly, rootBox: DOMRectReadOnly): TextPaint | null => {
  const style = getComputedStyle(field)
  if (!unscrolledInput(field)) return null
  if (style.direction !== 'ltr' || !['left', 'start'].includes(style.textAlign)) return null
  if (!style.font || style.getPropertyValue('-webkit-text-fill-color') !== style.color) return null
  if (!initialTextProperties.every(([name, value]) => style.getPropertyValue(name) === value)) return null
  if (!hasInitialOptionalFontProperties(style)) return null
  const kerning = style.fontKerning
  if (kerning !== 'auto' && kerning !== 'normal' && kerning !== 'none') return null
  const smoothing = style.getPropertyValue('-webkit-font-smoothing')
  const geometry = readTextGeometry(style, fieldBox, rootBox)
  if (!smoothing || !geometry) return null
  const left = rootBox.x + geometry.textX, top = rootBox.y + geometry.contentTop
  if (!supportsTextPaint(field, root, { left, top, right: left + geometry.contentWidth, bottom: top + geometry.contentHeight })) return null
  return {
    ...geometry,
    font: style.font,
    color: style.color,
    smoothing,
    lang: field.closest('[lang]')?.getAttribute('lang') ?? field.ownerDocument.documentElement.lang,
    kerning: kerning === 'none' ? 'none' : 'normal',
    letterSpacing: style.letterSpacing === 'normal' ? '0px' : style.letterSpacing,
    wordSpacing: style.wordSpacing === 'normal' ? '0px' : style.wordSpacing,
  }
}

const attachTextCanvas = (canvas: HTMLCanvasElement, paint: TextPaint) => {
  // Chromium applies the field's font-smoothing setting only while the canvas is connected.
  canvas.style.cssText = 'all:initial!important;display:none!important'
  canvas.style.setProperty('-webkit-font-smoothing', paint.smoothing, 'important')
  canvas.lang = paint.lang
  if (!canvas.isConnected) canvas.ownerDocument.body.appendChild(canvas)
}

const configureText = (context: CanvasRenderingContext2D, paint: TextPaint) => {
  context.font = paint.font
  context.fillStyle = paint.color
  context.textAlign = 'left'
  context.textBaseline = 'alphabetic'
  context.direction = 'ltr'
  context.fontKerning = paint.kerning
  context.fontStretch = 'normal'
  context.fontVariantCaps = 'normal'
  context.letterSpacing = paint.letterSpacing
  context.wordSpacing = paint.wordSpacing
  context.textRendering = 'auto'
}

const textFits = (metrics: TextMetrics, paint: TextPaint, ascent: number, descent: number) =>
  metrics.fontBoundingBoxAscent === ascent && metrics.fontBoundingBoxDescent === descent
    && metrics.width <= paint.contentWidth
    && metrics.actualBoundingBoxLeft <= 0 && metrics.actualBoundingBoxRight <= paint.contentWidth

const drawText = (context: CanvasRenderingContext2D, paint: TextPaint, value: string, baseline: number) => {
  context.save()
  try {
    context.setTransform(2, 0, 0, 2, 0, 0)
    context.globalAlpha = 1
    context.globalCompositeOperation = 'source-over'
    context.filter = 'none'
    context.shadowBlur = context.shadowOffsetX = context.shadowOffsetY = 0
    configureText(context, paint)
    context.beginPath()
    context.rect(paint.textX, paint.contentTop, paint.contentWidth, paint.contentHeight)
    context.clip()
    context.fillText(value, paint.textX, baseline)
  } finally {
    context.restore()
  }
}

const equalPixels = (expected: Uint8ClampedArray, observed: Uint8ClampedArray) =>
  expected.length === observed.length && expected.every((channel, index) => channel === observed[index])

const clearCanvas = (canvas: HTMLCanvasElement) => {
  canvas.remove()
  canvas.width = canvas.height = 0
}

const fieldPixelsFit = (pixels: FieldPixels, canvas: HTMLCanvasElement) =>
  [pixels.left, pixels.top, pixels.width, pixels.height].every(Number.isInteger)
    && pixels.left >= 0 && pixels.top >= 0 && pixels.width > 0 && pixels.height > 0
    && pixels.left + pixels.width <= canvas.width && pixels.top + pixels.height <= canvas.height

const readFieldPixels = (canvas: HTMLCanvasElement, pixels: FieldPixels) => {
  const context = captureContext(canvas)
  if (!context) return null
  try {
    return context.getImageData(pixels.left, pixels.top, pixels.width, pixels.height).data
  } catch {
    return null
  }
}

const seedFitsInput = (metrics: TextMetrics, paint: TextPaint) =>
  [metrics.fontBoundingBoxAscent, metrics.fontBoundingBoxDescent].every(Number.isFinite)
    && textFits(metrics, paint, metrics.fontBoundingBoxAscent, metrics.fontBoundingBoxDescent)
    && metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent > 0

const usesCpuCapturePolicy = (canvas: HTMLCanvasElement) =>
  captureContext(canvas)?.getContextAttributes().willReadFrequently === true

const createCertifiedPainter = (
  options: InputTextPainterOptions,
  paint: TextPaint,
  pixels: FieldPixels,
  blank: HTMLCanvasElement,
  ascent: number,
  descent: number,
  targetWidth: number,
  targetHeight: number,
) => {
  const baseline = paint.fieldTop + (paint.fieldHeight - ascent - descent) / 2 + ascent
  let disposed = false
  let attached = false
  const canReuse = (field: HTMLInputElement, value: string, scroll: readonly [number, number]) =>
    !disposed && !options.signal.aborted && field === options.field && value.length > 0 && field.value === value
      && scroll[0] === 0 && scroll[1] === 0 && unscrolledInput(field)
      && options.target.width === targetWidth && options.target.height === targetHeight
      && options.template.canReuse(field, value, scroll)

  return {
    canReuse,
    paint(value: string) {
      if (!canReuse(options.field, value, [0, 0])) return false
      if (!attached) {
        attachTextCanvas(options.target, paint)
        attached = true
      }
      const context = captureContext(options.target)
      if (!context) return false
      configureText(context, paint)
      if (!textFits(context.measureText(value), paint, ascent, descent)) return false
      context.save()
      try {
        context.setTransform(1, 0, 0, 1, 0, 0)
        context.globalAlpha = 1
        context.globalCompositeOperation = 'source-over'
        context.filter = 'none'
        context.shadowBlur = context.shadowOffsetX = context.shadowOffsetY = 0
        context.clearRect(pixels.left, pixels.top, pixels.width, pixels.height)
        context.drawImage(blank, pixels.left, pixels.top)
        drawText(context, paint, value, baseline)
      } finally {
        context.restore()
      }
      return true
    },
    dispose() {
      if (disposed) return
      disposed = true
      clearCanvas(blank)
      if (attached) options.target.remove()
    },
  }
}

export type InputTextPainter = ReturnType<typeof createCertifiedPainter>

const canPrepareText = (options: InputTextPainterOptions) =>
  !options.signal.aborted && options.root.contains(options.field)
    && usesCpuCapturePolicy(options.target)
    && options.scaleX === 2 && options.scaleY === 2 && options.value.length > 0
    && options.template.canReuse(options.field, options.value, [0, 0])

export async function prepareInputTextPainter(options: InputTextPainterOptions): Promise<InputTextPainter | null> {
  const { field, value, target, rootBox, fieldBox, clip, scaleX, scaleY, template, signal } = options
  if (!canPrepareText(options)) return null
  const paint = readTextPaint(options.root, field, fieldBox, rootBox)
  if (!paint || !Number.isInteger(paint.textX * scaleX)) return null
  if (!textIsUncovered(options.root, field, rootBox, paint)) return null
  const document = field.ownerDocument
  const view = document.defaultView
  if (!view || !document.body || target.ownerDocument !== document) return null
  const pixels = {
    left: (Math.floor(fieldBox.x + view.scrollX) - rootBox.x - view.scrollX) * scaleX,
    top: (Math.floor(fieldBox.y + view.scrollY) - rootBox.y - view.scrollY) * scaleY,
    width: (Math.ceil(fieldBox.right + view.scrollX) - Math.floor(fieldBox.x + view.scrollX)) * scaleX,
    height: (Math.ceil(fieldBox.bottom + view.scrollY) - Math.floor(fieldBox.y + view.scrollY)) * scaleY,
  }
  if (!fieldPixelsFit(pixels, target)) return null
  const clipX = Math.round((clip.x - rootBox.x - view.scrollX) * scaleX)
  const clipY = Math.round((clip.y - rootBox.y - view.scrollY) * scaleY)
  const targetWidth = target.width, targetHeight = target.height
  const expected = readFieldPixels(target, pixels)
  if (!expected) return null
  if (!await template.fontsEmbedded() || signal.aborted) return null
  const certificate = document.createElement('canvas')
  certificate.width = targetWidth
  certificate.height = targetHeight
  attachTextCanvas(certificate, paint)
  const certificateContext = captureContext(certificate)
  if (!certificateContext) { clearCanvas(certificate); return null }
  configureText(certificateContext, paint)
  const metrics = certificateContext.measureText(value)
  const ascent = metrics.fontBoundingBoxAscent, descent = metrics.fontBoundingBoxDescent
  if (!seedFitsInput(metrics, paint)) {
    clearCanvas(certificate)
    return null
  }
  const baseline = paint.fieldTop + (paint.fieldHeight - ascent - descent) / 2 + ascent
  const blank = document.createElement('canvas')
  blank.width = pixels.width
  blank.height = pixels.height
  let retained = false
  const releasePending = () => { clearCanvas(certificate); clearCanvas(blank) }
  signal.addEventListener('abort', releasePending, { once: true })
  try {
    const image = await template.blank()
    if (signal.aborted) return null
    const blankContext = captureContext(blank)
    if (!blankContext) return null
    // SVG CPU edge samples depend on source origin. Crop only after its
    // full-layout raster has been drawn at the accepted region's origin.
    certificateContext.drawImage(image, clipX, clipY, image.width, image.height)
    blankContext.drawImage(certificate, pixels.left, pixels.top, pixels.width, pixels.height, 0, 0, pixels.width, pixels.height)
    certificateContext.clearRect(pixels.left, pixels.top, pixels.width, pixels.height)
    certificateContext.drawImage(blank, pixels.left, pixels.top)
    drawText(certificateContext, paint, value, baseline)
    const observed = certificateContext.getImageData(pixels.left, pixels.top, pixels.width, pixels.height).data
    if (!equalPixels(expected, observed)) return null
    const painter = createCertifiedPainter(options, paint, pixels, blank, ascent, descent, targetWidth, targetHeight)
    retained = true
    return painter
  } catch {
    return null
  } finally {
    signal.removeEventListener('abort', releasePending)
    clearCanvas(certificate)
    if (!retained) clearCanvas(blank)
  }
}
