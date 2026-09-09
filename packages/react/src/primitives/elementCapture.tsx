// Element capture keeps native content in place while a separate source supplies pixels.
// Callback refs report attachment and removal; capture frames retain their painted dimensions.
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { detectHtmlInCanvas } from '@munari/core'
import {
  CaptureSource, connectCapture, setCaptureUnavailable, useCaptureHandle,
  type CaptureConnection, type CaptureHandle,
} from './capture'
import type { SurfaceResolution, SurfaceSize } from './surface/surfaceSourceRuntime'
import { useLatest } from './useLatest'

export interface ElementCaptureOptions {
  resolution?: SurfaceResolution
  /** Subtrees deliberately omitted from the captured image. */
  exclude?: string
  onError?: (error: Error) => void
}

export interface ElementCapture extends CaptureHandle {
  /** Attach to the native element. Passing null releases its captured source. */
  ref(element: HTMLElement | null): void
  /** Request a new image after a change outside the observed DOM. */
  refresh(): void
  /** Current viewport position, independent of the last painted frame's dimensions. */
  getBounds(): DOMRect | null
}

let snapshotSequence = 0
const OMIT = 'head,script,style,link,meta,title,[data-api-capture],[data-api-capture-consumer]'
const EVENTS = ['input', 'change', 'pointerover', 'pointerout', 'pointerdown', 'pointerup', 'focusin', 'focusout', 'scroll', 'load', 'transitionend', 'animationend', 'animationstart', 'transitionrun']

function excluded(element: Element, selector: string | undefined): boolean {
  return element.matches(OMIT) || Boolean(selector && element.matches(selector))
}

function unsupported(element: Element, selector: string | undefined): string | null {
  if (excluded(element, selector)) return null
  if (['canvas', 'video', 'audio', 'iframe', 'object', 'embed'].includes(element.localName)) {
    return `Element capture does not copy <${element.localName}> pixels. Exclude it or provide its frames separately.`
  }
  if (element.localName.includes('-') || element.hasAttribute('is') || element.shadowRoot) {
    return 'Element capture does not clone custom elements or shadow roots.'
  }
  if (getComputedStyle(element).maskImage && getComputedStyle(element).maskImage !== 'none') return 'Element capture does not support CSS mask-image.'
  for (const child of element.children) {
    const reason = unsupported(child, selector)
    if (reason) return reason
  }
  return null
}

interface ElementCaptureCopy { element: HTMLElement; size: SurfaceSize }
class UnmeasuredCapture extends Error {}
class UnsupportedCaptureContent extends Error {}
function copyFormValues(source: Element, target: Element) {
    if (source instanceof HTMLInputElement && target instanceof HTMLInputElement) {
      target.value = source.value
      target.checked = source.checked
      target.indeterminate = source.indeterminate
      target.name = ''
    } else if (source instanceof HTMLTextAreaElement && target instanceof HTMLTextAreaElement) target.value = source.value
    else if (source instanceof HTMLSelectElement && target instanceof HTMLSelectElement) target.selectedIndex = source.selectedIndex
}

/** Copies only visual state. No React component, media decoder, or custom element is mounted twice. */
export function copyElementForCapture(element: HTMLElement, exclude?: string): ElementCaptureCopy {
  if (element.ownerDocument !== document) throw new UnsupportedCaptureContent('Element capture uses elements in the current document.')
  const reason = unsupported(element, exclude)
  if (reason) throw new UnsupportedCaptureContent(reason)
  const documentRoot = element === document.body || element === document.documentElement
  const width = documentRoot ? Math.max(element.clientWidth, element.scrollWidth) : element.offsetWidth
  const height = documentRoot ? Math.max(element.clientHeight, element.scrollHeight) : element.offsetHeight
  if (width <= 0 || height <= 0) throw new UnmeasuredCapture('The capture element has no measurable area.')
  const snapshotId = snapshotSequence++
  let index = 0
  const pseudoRules: string[] = []
  const copy = (source: Element): Element | null => {
    if (excluded(source, exclude)) return null
    const target = source.localName === 'html' || source.localName === 'body'
      ? document.createElement('div')
      : source.cloneNode(false)
    if (!(target instanceof Element)) return null
    const id = `capture-${snapshotId}-${index++}`
    target.setAttribute('data-api-snapshot', id)
    target.removeAttribute('id')
    target.removeAttribute('autofocus')
    for (const name of target.getAttributeNames()) {
      if (name.startsWith('on')) target.removeAttribute(name)
    }
    const css = getComputedStyle(source)
    const declarations = Array.from(css, name => `${name}:${css.getPropertyValue(name)};`).join('')
    target.setAttribute('style', `${declarations}animation:none!important;transition:none!important;caret-color:transparent!important;`)
    for (const pseudo of ['::before', '::after']) {
      const computed = getComputedStyle(source, pseudo)
      if (!computed.content || computed.content === 'none' || computed.content === 'normal') continue
      pseudoRules.push(`[data-api-snapshot="${id}"]${pseudo}{${Array.from(computed, name => `${name}:${computed.getPropertyValue(name)};`).join('')}animation:none!important;transition:none!important;}`)
    }
    for (const child of source.childNodes) {
      if (child instanceof Element) {
        const next = copy(child)
        if (next) target.append(next)
      } else if (child.nodeType === Node.TEXT_NODE) target.append(child.cloneNode())
    }
    copyFormValues(source, target)
    target.scrollTop = source.scrollTop
    target.scrollLeft = source.scrollLeft
    return target
  }
  const root = copy(element)
  if (!(root instanceof HTMLElement)) throw new Error('Attach element capture to an HTML element containing the content.')
  root.style.position = 'relative'
  root.style.inset = 'auto'
  root.style.margin = '0'
  root.style.transform = 'none'
  root.style.width = `${width}px`
  root.style.height = `${height}px`
  root.style.boxSizing = 'border-box'
  if (pseudoRules.length) {
    const style = document.createElement('style')
    style.textContent = pseudoRules.join('\n')
    root.append(style)
  }
  return { element: root, size: [width, height] }
}

export function useElementCapture(options: ElementCaptureOptions = {}): ElementCapture {
  const capture = useCaptureHandle()
  const [element, setElement] = useState<HTMLElement | null>(null)
  const attached = useRef<HTMLElement | null>(null)
  const refresh = useRef<() => void>(() => {})
  const errorRef = useLatest(options.onError)
  const { resolution = 'auto', exclude } = options
  const resolutionRef = useLatest(resolution)
  const resolutionKey = Array.isArray(resolution) ? resolution.join(':') : resolution
  const activeConnection = useRef<CaptureConnection | null>(null)
  const ref = useCallback((next: HTMLElement | null) => {
    attached.current = next
    setElement(next)
  }, [])
  const result = useMemo(() => Object.assign(capture, {
    ref, refresh: () => refresh.current(), getBounds: () => attached.current?.getBoundingClientRect() ?? null,
  }), [capture, ref])

  useLayoutEffect(() => {
    if (!element) { setCaptureUnavailable(capture, 'waiting'); return }
    if (!detectHtmlInCanvas().drawElementImage) {
      setCaptureUnavailable(capture, 'unsupported')
      return () => setCaptureUnavailable(capture, 'waiting')
    }
    if (element.ownerDocument !== document) {
      setCaptureUnavailable(capture, 'unsupported', 'Element capture uses elements in the current document.')
      return () => setCaptureUnavailable(capture, 'waiting')
    }
    let connection: CaptureConnection | null = null
    let frame = 0
    let alive = true
    let lastReportedError = ''
    const wrapper = document.createElement('div')
    wrapper.style.cssText = 'display:block;position:relative;margin:0;padding:0;border:0;overflow:hidden;'
    const update = () => {
      frame = 0
      if (!alive) return
      try {
        const copied = copyElementForCapture(element, exclude)
        wrapper.replaceChildren(copied.element)
        wrapper.style.width = `${copied.size[0]}px`
        wrapper.style.height = `${copied.size[1]}px`
        if (!connection) connection = connectCapture(capture, wrapper, copied.size, { resolution: resolutionRef.current, onError: error => errorRef.current?.(error) })
        else connection.setSize(copied.size)
        activeConnection.current = connection
        connection.repaint()
        lastReportedError = ''
        if (element.getAnimations?.({ subtree: true }).some(animation => animation.playState === 'running')) schedule()
      } catch (cause) {
        connection?.dispose()
        connection = null
        activeConnection.current = null
        const error = cause instanceof Error ? cause : new Error(String(cause))
        const status = error instanceof UnmeasuredCapture ? 'waiting'
          : error instanceof UnsupportedCaptureContent ? 'unsupported' : 'error'
        setCaptureUnavailable(capture, status, error.message)
        if (status === 'error' && error.message !== lastReportedError) errorRef.current?.(error)
        lastReportedError = error.message
      }
    }
    const schedule = () => { if (alive && !frame) frame = requestAnimationFrame(update) }
    const onEvent = (event: Event) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-api-capture],[data-api-capture-consumer]')) return
      schedule()
    }
    refresh.current = schedule
    const resize = new ResizeObserver(schedule)
    const subscriptions = new AbortController()
    resize.observe(element)
    const mutations = new MutationObserver(records => {
      if (records.some(record => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement
        return !target?.closest('[data-api-capture],[data-api-capture-consumer]')
      })) schedule()
    })
    mutations.observe(element, { subtree: true, childList: true, attributes: true, characterData: true })
    const styles = new MutationObserver(schedule)
    styles.observe(document.head, { subtree: true, childList: true, attributes: true, characterData: true })
    for (let parent = element.parentElement; parent; parent = parent.parentElement) styles.observe(parent, { attributes: true })
    for (const event of EVENTS) element.addEventListener(event, onEvent, {capture:true,signal:subscriptions.signal})
    window.addEventListener('resize', schedule, {signal:subscriptions.signal})
    document.fonts?.addEventListener('loadingdone', schedule, {signal:subscriptions.signal})
    update()
    return () => {
      alive = false
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      styles.disconnect()
      subscriptions.abort()
      refresh.current = () => {}
      connection?.dispose()
      activeConnection.current = null
      if (!connection) setCaptureUnavailable(capture, 'waiting')
    }
  }, [capture, element, exclude, errorRef, resolutionRef])
  useLayoutEffect(() => activeConnection.current?.setResolution(resolutionRef.current), [resolutionKey, resolutionRef])
  return result
}

type CaptureContentProps = {
  capture: CaptureHandle; size: SurfaceSize; resolution?: SurfaceResolution; onError?: (error: Error) => void
} & ({ children: ReactNode; element?: never } | { element: HTMLElement | null; children?: never })

/** Authored capture content can be React markup or an already-built detached element. */
export function CaptureContent({ children, element, capture, size, resolution = 'auto', onError }: CaptureContentProps) {
  const [ownedRoot, setOwnedRoot] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => { if (element === undefined) setOwnedRoot(document.createElement('div')) }, [element])
  const root = element === undefined ? ownedRoot : element
  const [width, height] = size
  useLayoutEffect(() => {
    if (!root || element !== undefined) return
    root.style.cssText = `position:relative;box-sizing:border-box;visibility:visible;width:${width}px;height:${height}px;`
  }, [root, width, height, element])
  if (!root) return null
  return <>
    {element === undefined && createPortal(children, root)}
    <CaptureSource capture={capture} adopt={root} size={size} resolution={resolution} onError={onError} />
  </>
}
