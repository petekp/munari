// Input region rasterizer — retained full pixels with isolated value replacements.
// A value edit may replace only the field's declared independent paint region.
// Full root clipping preserved Controls pixels in the 2026-10-13 probe; the
// adapter owns this cache, while core owns capture scheduling and publication.

import { captureContext, captureMemoryChosen, listenForRepaintSignals } from '@munari/core'

export interface CaptureRegionOptions {
  clip?: { x: number; y: number; width: number; height: number }
  invalidate?: boolean
}

// Controls' focus ring extends four CSS pixels; root clipping preserves its
// background at that margin (docs/incremental-capture.md).
const REGION_PADDING = 4

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
  let storage: 'cpu' | 'gpu' | null = null

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
  const clipFor = (rect: DOMRect) => ({
    x: Math.floor(rect.x + scrollX - REGION_PADDING),
    y: Math.floor(rect.y + scrollY - REGION_PADDING),
    width: Math.ceil(rect.right + scrollX + REGION_PADDING) - Math.floor(rect.x + scrollX - REGION_PADDING),
    height: Math.ceil(rect.bottom + scrollY + REGION_PADDING) - Math.floor(rect.y + scrollY - REGION_PADDING),
  })
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
  const snapshot = (field: HTMLInputElement | null, sx: number, sy: number) => {
    const box = root.getBoundingClientRect()
    const rect = field?.getBoundingClientRect()
    const paint = ancestorPaint(field)
    const key = JSON.stringify([sx, sy, root.offsetWidth, root.offsetHeight, box.x, box.y, box.width, box.height,
      scrollX, scrollY, rect?.x, rect?.y, rect?.width, rect?.height, styles(root), paint.ancestors.map(styles), controlState(field)])
    const clip = rect ? clipFor(rect) : undefined
    const placeholderSupported = clip !== undefined && supportsClippedFields(clip)
    const boundedPaint = fieldPaintIsPlain(field) && paint.boundedPaint
    const eligible = boundedPaint && field !== null && rect !== undefined && paint.untransformed && placeholderSupported
      && supportsGeometry(box, sx, sy) && document.fonts.status === 'loaded'
      && !root.getAnimations({ subtree: true }).some((animation) => animation.playState === 'running')
    return { key, box, rect, clip, eligible, scrollX, scrollY, width: Math.max(1, Math.round(root.offsetWidth * sx)), height: Math.max(1, Math.round(root.offsetHeight * sy)) }
  }

  const canReplaceInput = (state: ReturnType<typeof snapshot>, field: HTMLInputElement | null, value: string | null) =>
    state.eligible && field !== null && cachedEpoch === epoch && cachedKey === state.key
      && cachedValue !== value && pendingInput?.field === field && pendingInput.value === value

  // CPU clipping differed by one pixel in Controls. Keep its full-image
  // path and avoid another bitmap copy (decisions.md #62).
  const usesCpuStorage = () => {
    if (storage !== null) return storage === 'cpu'
    const context = captureContext(canvas)
    if (!context) return false
    storage = context.getContextAttributes().willReadFrequently ? 'cpu' : 'gpu'
    if (storage === 'gpu') return false
    observer.disconnect()
    listeners.abort()
    pendingInput = null
    cachedEpoch = -1
    canvas.width = canvas.height = 0
    return true
  }

  return {
    async rasterize(sx: number, sy: number) {
      if (disposed) throw new Error('munari: input region rasterizer is disposed')
      if (usesCpuStorage()) {
        const invalidate = refreshPending
        refreshPending = false
        return capture(root, sx, sy, { invalidate })
      }
      mutate(observer.takeRecords())
      const field = findField()
      const state = snapshot(field, sx, sy)
      const startedEpoch = epoch
      const input = pendingInput
      const value = field?.value ?? null
      const partial = canReplaceInput(state, field, value)
      const clip = partial ? state.clip : undefined
      const invalidate = refreshPending
      refreshPending = false
      const image = await capture(root, sx, sy, { clip, invalidate })
      await captureMemoryChosen()
      if (disposed || usesCpuStorage()) return image
      mutate(observer.takeRecords())
      const context = captureContext(canvas)
      if (!context) throw new Error('munari: input region cache has no 2D context')
      cachedEpoch = -1
      if (clip) {
        const x = Math.round((clip.x - state.box.x - state.scrollX) * sx)
        const y = Math.round((clip.y - state.box.y - state.scrollY) * sy)
        context.clearRect(x, y, image.width, image.height)
        context.drawImage(image, x, y, image.width, image.height)
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
      canvas.width = canvas.height = 0
    },
  }
}
