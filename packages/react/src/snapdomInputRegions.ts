// Input region rasterizer — retained full pixels with isolated value replacements.
// A value edit may replace only the field's declared independent paint region.
// Full root clipping preserved Controls pixels in the 2026-10-13 probe; the
// adapter owns this cache, while core owns capture scheduling and publication.

import { captureContext, captureMemoryChosen, listenForRepaintSignals } from '@munari/core'

export interface CaptureRegionOptions {
  clip?: { x: number; y: number; width: number; height: number }
  invalidate?: boolean
  retainRootLayout?: boolean
}

export class UnsupportedRegionCaptureError extends Error {}

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
  const listeners = new AbortController()
  let disposed = false
  let epoch = 0
  let cachedEpoch = -1
  let cachedKey = ''
  let cachedValue: string | null = null
  let currentField: HTMLInputElement | null = null
  let pendingInput: { field: HTMLInputElement; value: string; version: number } | null = null
  let inputVersion = 0
  let refreshPending = false
  let cpuStorage: boolean | null = null
  let regionCanvas: HTMLCanvasElement | null = null
  let regionSupported = true

  const releaseCachedBitmaps = () => {
    canvas.width = canvas.height = 0
    if (regionCanvas) regionCanvas.width = regionCanvas.height = 0
    regionCanvas = null
    cachedEpoch = -1
    cachedKey = ''
    cachedValue = null
  }

  const invalidated = () => {
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

  const styles = (element: Element) => {
    const style = getComputedStyle(element)
    return Array.from(style, (property) => `${property}:${style.getPropertyValue(property)}`).join(';')
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
    const ancestors: Element[] = []
    let element: Element | null = field
    let untransformed = true
    let boundedPaint = true
    while (element) {
      if (root.contains(element)) ancestors.push(element)
      else if (!observedAncestors.has(element)) {
        observer.observe(element, { attributes: true, attributeOldValue: true })
        observedAncestors.add(element)
      }
      const style = getComputedStyle(element)
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
    const key = JSON.stringify([sx, sy, root.offsetWidth, root.offsetHeight, box.x, box.y, box.width, box.height,
      scrollX, scrollY, rect?.x, rect?.y, rect?.width, rect?.height, styles(root), paint.ancestors.map(styles), controlState(field)])
    const clip = rect ? clipFor(rect) : undefined
    const placeholderSupported = clip !== undefined && supportsClippedFields(clip)
    const boundedPaint = fieldPaintIsPlain(field) && paint.boundedPaint
    const cpuEligible = !cpuStorage || supportsCpuField(field, rect, clip, box)
    const eligible = cpuEligible && boundedPaint && field !== null && rect !== undefined && paint.untransformed && placeholderSupported
      && supportsGeometry(box, sx, sy) && document.fonts.status === 'loaded'
      && !root.getAnimations({ subtree: true }).some((animation) => animation.playState === 'running')
    return { key, box, rect, clip, eligible, scrollX, scrollY, width: Math.max(1, Math.round(root.offsetWidth * sx)), height: Math.max(1, Math.round(root.offsetHeight * sy)) }
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
      const input = pendingInput
      const value = field?.value ?? null
      const clip = inputClip(state, field, value)
      const invalidate = refreshPending
      refreshPending = false
      let image: HTMLImageElement
      try {
        image = await capture(root, sx, sy, { clip, invalidate, retainRootLayout: cpuStorage === true })
      } catch (cause) {
        if (disposed || !(cause instanceof UnsupportedRegionCaptureError) || !clip) throw cause
        regionSupported = false
        releaseCachedBitmaps()
        return capture(root, sx, sy, { invalidate: true })
      }
      await captureMemoryChosen()
      if (disposed) return image
      mutate(observer.takeRecords())
      const context = captureContext(canvas)
      if (!context) throw new Error('munari: input region cache has no 2D context')
      cpuStorage ??= context.getContextAttributes().willReadFrequently === true
      cachedEpoch = -1
      if (clip) {
        const x = Math.round((clip.x - state.box.x - state.scrollX) * sx)
        const y = Math.round((clip.y - state.box.y - state.scrollY) * sy)
        if (cpuStorage && state.rect) {
          regionCanvas ??= document.createElement('canvas')
          regionCanvas.width = Math.min(state.width, Math.max(1, x + image.width))
          regionCanvas.height = Math.min(state.height, Math.max(1, y + image.height))
          const regionContext = captureContext(regionCanvas)
          if (!regionContext) throw new Error('munari: input region bitmap has no 2D context')
          // CPU SVG antialiasing depends on its draw origin. Rasterize at the
          // source origin before cropping bitmap pixels (decisions.md #62).
          regionContext.drawImage(image, x, y, image.width, image.height)
          const left = (Math.floor(state.rect.x + state.scrollX) - state.box.x - state.scrollX) * sx
          const top = (Math.floor(state.rect.y + state.scrollY) - state.box.y - state.scrollY) * sy
          const width = (Math.ceil(state.rect.right + state.scrollX) - Math.floor(state.rect.x + state.scrollX)) * sx
          const height = (Math.ceil(state.rect.bottom + state.scrollY) - Math.floor(state.rect.y + state.scrollY)) * sy
          context.clearRect(left, top, width, height)
          context.drawImage(regionCanvas, left, top, width, height, left, top, width, height)
        } else {
          context.clearRect(x, y, image.width, image.height)
          context.drawImage(image, x, y, image.width, image.height)
        }
      } else {
        canvas.width = state.width
        canvas.height = state.height
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
      }
      cachedEpoch = startedEpoch
      cachedKey = state.key
      cachedValue = value
      if (pendingInput?.version === input?.version) pendingInput = null
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
