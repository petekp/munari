// Input region rasterizer — retained full pixels with isolated value replacements.
// A value edit may replace only the field's declared independent paint region.
// Full root clipping preserved Controls pixels in the 2026-10-13 probe; the
// adapter owns this cache, while core owns capture scheduling and publication.

import { captureContext, captureMemoryChosen, listenForRepaintSignals } from '@munari/core'
import { createInputSvgTemplate } from './snapdomInputSvg'
import { prepareInputTextPainter, type InputTextPainter } from './snapdomInputText'

export interface CaptureRegionOptions {
  clip?: { x: number; y: number; width: number; height: number }
  invalidate?: boolean
  retainRootLayout?: boolean
}

export class UnsupportedRegionCaptureError extends Error {}

interface SerializedStyle {
  readonly names: readonly string[]
  readonly values: readonly string[]
  readonly serialized: string
}

// Controls' focus ring extends four CSS pixels; root clipping preserves its
// background at that margin (docs/incremental-capture.md).
const REGION_PADDING = 4
// CPU capture includes one extra CSS pixel beyond the measured focus ring (decisions.md #62).
const CPU_REGION_PADDING = REGION_PADDING + 1

export function createInputRegionRasterizer(
  root: HTMLElement,
  selector: string,
  capture: (root: HTMLElement, sx: number, sy: number, options?: CaptureRegionOptions) => Promise<HTMLImageElement>,
) {
  const document = root.ownerDocument
  const canvas = document.createElement('canvas')
  const observedAncestors = new WeakSet<Element>()
  let styleCache = new WeakMap<Element, SerializedStyle>()
  const listeners = new AbortController()
  let disposed = false
  let epoch = 0
  let cachedEpoch = -1
  let cachedKey = ''
  let cachedValue: string | null = null
  let cachedScroll: readonly [number, number] = [0, 0]
  let cachedInputVersion = -1
  let currentField: HTMLInputElement | null = null
  let pendingInput: { field: HTMLInputElement; value: string; version: number } | null = null
  let inputVersion = 0
  let refreshPending = false
  let cpuStorage: boolean | null = null
  let regionCanvas: HTMLCanvasElement | null = null
  let regionSupported = true
  let inputSvg: ReturnType<typeof createInputSvgTemplate> = null
  let textPainter: InputTextPainter | null = null
  let textPreparation: { template: NonNullable<ReturnType<typeof createInputSvgTemplate>>; controller: AbortController } | null = null

  const discardTextPainter = () => {
    textPreparation?.controller.abort()
    textPreparation = null
    textPainter?.dispose()
    textPainter = null
  }

  const releaseCachedBitmaps = () => {
    styleCache = new WeakMap()
    discardTextPainter()
    inputSvg = null
    canvas.width = canvas.height = 0
    if (regionCanvas) regionCanvas.width = regionCanvas.height = 0
    regionCanvas = null
    cachedEpoch = -1
    cachedKey = ''
    cachedValue = null
  }

  const invalidated = () => {
    discardTextPainter()
    inputSvg = null
    epoch++
    pendingInput = null
  }
  const invalidate = () => { refreshPending = true; invalidated() }
  const findField = () => {
    const fields = Array.from(root.querySelectorAll(selector))
    const focused = fields.filter((field) => field === document.activeElement)
    const candidate = focused.length === 1 ? focused[0] : null
    const field = candidate instanceof HTMLInputElement && candidate.type === 'text' ? candidate : null
    if (field !== currentField) {
      currentField = field
      invalidated()
    }
    return field
  }
  const mutate = (records: MutationRecord[]) => {
    const attributes = new Map<Element, Map<string, string | null>>()
    let changed = false
    for (const record of records) {
      if (document.head?.contains(record.target)) refreshPending = true
      if (record.type !== 'attributes' || !(record.target instanceof Element) || !record.attributeName) {
        changed = true
        continue
      }
      let target = attributes.get(record.target)
      if (!target) {
        target = new Map()
        attributes.set(record.target, target)
      }
      if (!target.has(record.attributeName)) target.set(record.attributeName, record.oldValue)
    }
    for (const [target, values] of attributes) {
      for (const [name, before] of values) {
        if (target.getAttribute(name) === before) continue
        if (target !== currentField || name !== 'value') changed = true
      }
    }
    if (changed) invalidated()
  }
  const observer = new MutationObserver(mutate)
  observer.observe(root, { subtree: true, attributes: true, attributeOldValue: true, childList: true, characterData: true })
  if (document.head) observer.observe(document.head, { subtree: true, attributes: true, attributeOldValue: true, childList: true, characterData: true })
  document.defaultView?.addEventListener('resize', invalidate, { signal: listeners.signal })
  // Document capture runs before core's root listener can queue the DOM read.
  listenForRepaintSignals(document, (event) => {
    const stylesheetLoaded = event.type === 'load' && event.target instanceof HTMLLinkElement && event.target.relList.contains('stylesheet')
    if (stylesheetLoaded) { invalidate(); return }
    if (event.target !== document.fonts && (!(event.target instanceof Node) || !root.contains(event.target))) return
    const field = findField()
    if (event instanceof InputEvent && event.type === 'input' && event.target === field && field && !event.isComposing) {
      pendingInput = { field, value: field.value, version: ++inputVersion }
      return
    }
    if (event.type === 'scroll' && event.target === field && pendingInput?.field === field) return
    invalidated()
  }, listeners.signal)
  document.fonts.addEventListener('loading', invalidated, { signal: listeners.signal })
  for (const name of ['pointerover', 'pointerout']) {
    document.addEventListener(name, (event) => {
      if (event.target instanceof Node && root.contains(event.target)) invalidated()
    }, { capture: true, signal: listeners.signal })
  }

  const styles = (element: Element, style: CSSStyleDeclaration) => {
    const previous = styleCache.get(element)
    const count = style.length
    let unchanged = 0
    if (previous && previous.names.length === count) {
      for (; unchanged < count; unchanged++) {
        const name = style.item(unchanged)
        if (name !== previous.names[unchanged] || style.getPropertyValue(name) !== previous.values[unchanged]) break
      }
      if (unchanged === count) return previous.serialized
    }
    const names = previous?.names.slice(0, unchanged) ?? []
    const values = previous?.values.slice(0, unchanged) ?? []
    const parts = names.map((name, index) => `${name}:${values[index]}`)
    for (let index = unchanged; index < count; index++) {
      const name = style.item(index)
      const value = style.getPropertyValue(name)
      names.push(name)
      values.push(value)
      parts.push(`${name}:${value}`)
    }
    const serialized = parts.join(';')
    styleCache.set(element, { names, values, serialized })
    return serialized
  }
  const controlState = (field: HTMLInputElement | null) => Array.from(root.querySelectorAll('input,textarea,select'), (control) => {
    if (control instanceof HTMLInputElement) {
      return [control === field ? null : control.value, control === field ? null : control.defaultValue, control.type, control.checked,
        control.indeterminate, control.disabled, control.readOnly, control.required, control.validity.valid,
        control.placeholder, control.matches(':placeholder-shown'), control.scrollTop, control === field ? null : control.scrollLeft]
    }
    if (control instanceof HTMLTextAreaElement) {
      return [control.value, control.defaultValue, control.disabled, control.readOnly, control.required,
        control.validity.valid, control.scrollTop, control.scrollLeft]
    }
    if (control instanceof HTMLSelectElement) {
      return [control.value, control.selectedIndex, control.disabled, control.required, control.validity.valid,
        Array.from(control.options, (option) => [option.selected, option.disabled])]
    }
    return null
  })
  const ancestorPaint = (field: HTMLInputElement | null) => {
    const ancestors: Array<{ element: Element; style: CSSStyleDeclaration }> = []
    let element: Element | null = field
    let untransformed = true
    let boundedPaint = true
    while (element) {
      const style = getComputedStyle(element)
      if (root.contains(element)) ancestors.push({ element, style })
      else if (!observedAncestors.has(element)) {
        observer.observe(element, { attributes: true, attributeOldValue: true })
        observedAncestors.add(element)
      }
      if (style.filter !== 'none' || style.backdropFilter !== 'none' || style.textShadow !== 'none' || style.mixBlendMode !== 'normal') boundedPaint = false
      if (style.transform !== 'none' || style.translate !== 'none' || style.rotate !== 'none' || style.scale !== 'none') untransformed = false
      element = element.parentElement
    }
    return { ancestors, untransformed, boundedPaint }
  }
  const supportsPlaceholder = (field: HTMLInputElement | HTMLTextAreaElement | null) => {
    let placeholderSupported = true
    if (field?.placeholder) {
      const id = field.id
      const anchor = field.getAttribute('data-munari-anchor')
      placeholderSupported = Boolean((id && Array.from(root.querySelectorAll('[id]')).filter((node) => node.id === id).length === 1)
        || (anchor && Array.from(root.querySelectorAll('[data-munari-anchor]')).filter((node) => node.getAttribute('data-munari-anchor') === anchor).length === 1))
    }
    return placeholderSupported
  }
  const clipFor = (rect: DOMRect) => {
    const padding = cpuStorage ? CPU_REGION_PADDING : REGION_PADDING
    return {
      x: Math.floor(rect.x + scrollX - padding),
      y: Math.floor(rect.y + scrollY - padding),
      width: Math.ceil(rect.right + scrollX + padding) - Math.floor(rect.x + scrollX - padding),
      height: Math.ceil(rect.bottom + scrollY + padding) - Math.floor(rect.y + scrollY - padding),
    }
  }
  const supportsClippedFields = (clip: NonNullable<CaptureRegionOptions['clip']>) => {
    for (const field of root.querySelectorAll('input[placeholder],textarea[placeholder]')) {
      if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) continue
      const rect = field.getBoundingClientRect()
      const x = rect.x + scrollX, y = rect.y + scrollY
      if (x >= clip.x + clip.width || x + rect.width <= clip.x || y >= clip.y + clip.height || y + rect.height <= clip.y) continue
      if (!supportsPlaceholder(field)) return false
    }
    return true
  }
  const fieldPaintIsPlain = (field: HTMLInputElement | null) => {
    if (field) {
      for (const pseudo of ['::before', '::after']) {
        const content = getComputedStyle(field, pseudo).content
        if (content && content !== 'none' && content !== 'normal') return false
      }
    }
    return true
  }
  const supportsGeometry = (box: DOMRect, sx: number, sy: number) =>
    Number.isInteger(sx) && Number.isInteger(sy) && sx > 0 && sy > 0
      && Number.isInteger(box.x + scrollX) && Number.isInteger(box.y + scrollY)
      && box.width === root.offsetWidth && box.height === root.offsetHeight
  const hasOnlyInsetShadows = (shadow: string) => {
    if (shadow === 'none') return true
    let depth = 0
    let start = 0
    for (let index = 0; index < shadow.length; index++) {
      const character = shadow[index]
      if (character === '(') depth++
      else if (character === ')') depth--
      else if (character === ',' && depth === 0) {
        if (!/\binset\b/.test(shadow.slice(start, index))) return false
        start = index + 1
      }
    }
    return depth === 0 && /\binset\b/.test(shadow.slice(start))
  }
  const clipFitsRoot = (clip: NonNullable<CaptureRegionOptions['clip']>, box: DOMRect) =>
    clip.x >= box.x + scrollX && clip.y >= box.y + scrollY
      && clip.x + clip.width <= box.right + scrollX && clip.y + clip.height <= box.bottom + scrollY
  const supportsCpuField = (
    field: HTMLInputElement | null,
    rect: DOMRect | undefined,
    clip: CaptureRegionOptions['clip'],
    box: DOMRect,
  ) => {
    if (!field || !rect || !clip || !clipFitsRoot(clip, box)) return false
    const style = getComputedStyle(field)
    if (!hasOnlyInsetShadows(style.boxShadow) || style.outlineStyle === 'auto') return false
    if (style.outlineStyle === 'none' || style.outlineStyle === 'hidden') return true
    const width = Number.parseFloat(style.outlineWidth)
    const offset = Number.parseFloat(style.outlineOffset)
    return Number.isFinite(width) && Number.isFinite(offset)
      && width + Math.max(0, offset) <= CPU_REGION_PADDING
  }
  const snapshot = (field: HTMLInputElement | null, sx: number, sy: number) => {
    const box = root.getBoundingClientRect()
    const rect = field?.getBoundingClientRect()
    const paint = ancestorPaint(field)
    const rootStyle = paint.ancestors.find((entry) => entry.element === root)?.style ?? getComputedStyle(root)
    const ancestorStyles = paint.ancestors.filter((entry) => entry.element !== root).map((entry) => styles(entry.element, entry.style))
    const key = JSON.stringify([sx, sy, root.offsetWidth, root.offsetHeight, box.x, box.y, box.width, box.height,
      scrollX, scrollY, rect?.x, rect?.y, rect?.width, rect?.height, styles(root, rootStyle), ancestorStyles, controlState(field)])
    const clip = rect ? clipFor(rect) : undefined
    const placeholderSupported = clip !== undefined && supportsClippedFields(clip)
    const boundedPaint = fieldPaintIsPlain(field) && paint.boundedPaint
    const cpuEligible = !cpuStorage || supportsCpuField(field, rect, clip, box)
    const eligible = cpuEligible && boundedPaint && field !== null && rect !== undefined && paint.untransformed && placeholderSupported
      && supportsGeometry(box, sx, sy) && document.fonts.status === 'loaded'
      && !root.getAnimations({ subtree: true }).some((animation) => animation.playState === 'running')
    return { key, box, rect, clip, eligible, scrollX, scrollY, width: Math.max(1, Math.round(root.offsetWidth * sx)), height: Math.max(1, Math.round(root.offsetHeight * sy)) }
  }

  const prepareText = (
    template: ReturnType<typeof createInputSvgTemplate>,
    state: ReturnType<typeof snapshot>,
    field: HTMLInputElement | null,
    value: string | null,
    scale: readonly [number, number],
  ) => {
    if (!template || !field || value === null || textPreparation?.template === template || !state.rect || !state.clip) return
    discardTextPainter()
    const controller = new AbortController()
    const startedEpoch = epoch
    textPreparation = { template, controller }
    void prepareInputTextPainter({
      template, root, field, value, target: canvas, rootBox: state.box, fieldBox: state.rect,
      clip: state.clip, scaleX: scale[0], scaleY: scale[1], signal: controller.signal,
    }).then((painter) => {
      if (disposed || controller.signal.aborted || inputSvg !== template || cachedEpoch !== startedEpoch || cachedKey !== state.key) {
        painter?.dispose()
        if (textPreparation?.controller === controller) {
          controller.abort()
          textPreparation = null
        }
        return
      }
      textPainter = painter
    }, () => {
      controller.abort()
      if (textPreparation?.controller === controller) textPreparation = null
    })
  }

  const composeImage = (
    image: HTMLImageElement,
    state: ReturnType<typeof snapshot>,
    clip: CaptureRegionOptions['clip'],
    sx: number,
    sy: number,
  ) => {
    const context = captureContext(canvas)
    if (!context) throw new Error('munari: input region cache has no 2D context')
    cpuStorage ??= context.getContextAttributes().willReadFrequently === true
    cachedEpoch = -1
    if (clip && state.rect) {
      const x = Math.round((clip.x - state.box.x - state.scrollX) * sx)
      const y = Math.round((clip.y - state.box.y - state.scrollY) * sy)
      const left = (Math.floor(state.rect.x + state.scrollX) - state.box.x - state.scrollX) * sx
      const top = (Math.floor(state.rect.y + state.scrollY) - state.box.y - state.scrollY) * sy
      const width = (Math.ceil(state.rect.right + state.scrollX) - Math.floor(state.rect.x + state.scrollX)) * sx
      const height = (Math.ceil(state.rect.bottom + state.scrollY) - Math.floor(state.rect.y + state.scrollY)) * sy
      if (cpuStorage) {
        regionCanvas ??= document.createElement('canvas')
        const bufferWidth = Math.min(state.width, Math.max(1, x + image.width))
        const bufferHeight = Math.min(state.height, Math.max(1, y + image.height))
        if (regionCanvas.width !== bufferWidth) regionCanvas.width = bufferWidth
        if (regionCanvas.height !== bufferHeight) regionCanvas.height = bufferHeight
        const regionContext = captureContext(regionCanvas)
        if (!regionContext) throw new Error('munari: input region bitmap has no 2D context')
        // CPU SVG antialiasing depends on its draw origin. Rasterize at the
        // source origin before cropping bitmap pixels (decisions.md #62).
        regionContext.clearRect(x, y, image.width, image.height)
        regionContext.drawImage(image, x, y, image.width, image.height)
        context.clearRect(left, top, width, height)
        context.drawImage(regionCanvas, left, top, width, height, left, top, width, height)
      } else {
        context.clearRect(left, top, width, height)
        context.save()
        try {
          context.beginPath()
          context.rect(left, top, width, height)
          context.clip()
          context.drawImage(image, x, y, image.width, image.height)
        } finally {
          context.restore()
        }
      }
    } else {
      canvas.width = state.width
      canvas.height = state.height
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
    }
  }
  const clearPendingInput = (version: number | undefined) => {
    if (pendingInput?.version === version) pendingInput = null
  }

  const unchangedInput = (
    state: ReturnType<typeof snapshot>,
    value: string | null,
    scroll: readonly [number, number],
  ) => state.eligible && cachedEpoch === epoch && cachedKey === state.key && cachedValue === value && cachedInputVersion === inputVersion
    && cachedScroll[0] === scroll[0] && cachedScroll[1] === scroll[1]

  const reusableSvg = (
    clip: CaptureRegionOptions['clip'],
    field: HTMLInputElement | null,
    value: string | null,
    scroll: readonly [number, number],
  ) => clip && field && value !== null && inputSvg?.canReuse(field, value, scroll) ? inputSvg : null

  const paintText = (
    template: ReturnType<typeof createInputSvgTemplate>,
    field: HTMLInputElement | null,
    value: string | null,
    scroll: readonly [number, number],
  ) => {
    if (!template || !field || value === null || textPreparation?.template !== template || !textPainter?.canReuse(field, value, scroll)) return false
    const previousEpoch = cachedEpoch
    cachedEpoch = -1
    if (!textPainter.paint(value)) {
      cachedEpoch = previousEpoch
      return false
    }
    cachedEpoch = epoch
    cachedValue = value
    cachedInputVersion = inputVersion
    clearPendingInput(pendingInput?.version)
    return true
  }

  const captureImage = async (
    template: ReturnType<typeof createInputSvgTemplate>,
    value: string | null,
    sx: number,
    sy: number,
    options: CaptureRegionOptions,
  ) => {
    try {
      return template && value !== null ? await template.render(value) : await capture(root, sx, sy, options)
    } catch (cause) {
      if (disposed || !(cause instanceof UnsupportedRegionCaptureError) || !options.clip) throw cause
      regionSupported = false
      releaseCachedBitmaps()
      return capture(root, sx, sy, { invalidate: true })
    }
  }

  const retainSvg = (
    template: ReturnType<typeof createInputSvgTemplate>,
    image: HTMLImageElement,
    captured: {
      clip: CaptureRegionOptions['clip']; field: HTMLInputElement | null; value: string | null;
      scroll: readonly [number, number]; epoch: number;
    },
  ) => {
    if (captured.clip && captured.field && captured.value !== null && captured.epoch === epoch) {
      inputSvg = template ?? createInputSvgTemplate(image, captured.field, captured.value, captured.scroll)
    }
  }

  const inputClip = (state: ReturnType<typeof snapshot>, field: HTMLInputElement | null, value: string | null) =>
    regionSupported && state.eligible && field !== null && cachedEpoch === epoch && cachedKey === state.key
      && cachedValue !== value && pendingInput?.field === field && pendingInput.value === value
      ? state.clip : undefined

  return {
    async rasterize(sx: number, sy: number) {
      if (disposed) throw new Error('munari: input region rasterizer is disposed')
      mutate(observer.takeRecords())
      if (!regionSupported) {
        const invalidate = refreshPending
        refreshPending = false
        return capture(root, sx, sy, { invalidate })
      }
      const field = findField()
      const state = snapshot(field, sx, sy)
      const startedEpoch = epoch
      const startedInputVersion = inputVersion
      const input = pendingInput
      const value = field?.value ?? null
      const clip = inputClip(state, field, value)
      const invalidate = refreshPending
      refreshPending = false
      const scroll: readonly [number, number] = [field?.scrollLeft ?? 0, field?.scrollTop ?? 0]
      if (!invalidate && unchangedInput(state, value, scroll)) {
        clearPendingInput(input?.version)
        return canvas
      }
      const template = reusableSvg(clip, field, value, scroll)
      if (paintText(template, field, value, scroll)) return canvas
      if (!template || textPreparation?.template !== template) discardTextPainter()
      inputSvg = null
      const image = await captureImage(template, value, sx, sy, { clip, invalidate, retainRootLayout: true })
      if (!regionSupported) return image
      await captureMemoryChosen()
      if (disposed) return image
      mutate(observer.takeRecords())
      composeImage(image, state, clip, sx, sy)
      retainSvg(template, image, { clip, field, value, scroll, epoch: startedEpoch })
      cachedEpoch = startedEpoch
      cachedKey = state.key
      cachedValue = value
      cachedScroll = scroll
      cachedInputVersion = startedInputVersion
      clearPendingInput(input?.version)
      prepareText(inputSvg, state, field, value, [sx, sy])
      return canvas
    },
    invalidate,
    dispose() {
      if (disposed) return
      disposed = true
      observer.disconnect()
      listeners.abort()
      pendingInput = null
      releaseCachedBitmaps()
    },
  }
}
