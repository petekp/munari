// The marble page capture — full native page paint, used only by the hand.
//
// The law: capture has no page presenter. On 2026-08-30 the colour-field
// model reflected four swatches but no type; this source captures all of
// the native subtree while leaving its visible node and input unchanged.
//
// Ownership: this component owns a hidden, inert DOM mirror and its change
// subscriptions. Surface owns the capture texture. The environment borrows
// that texture and owns only its filtered reflection targets.

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  Surface,
  useSurfaceHandle,
  useSurfacePaintedSize,
  useSurfaceTextureOf,
  useSurfaceSupport,
  type SurfaceHandle,
  type SurfaceSize,
} from '@petepetrash/munari'
import type * as THREE from 'three'
import { cloneMarbleHandPage } from './marbleHandPageMirror'

export interface MarblePageCaptureState {
  texture: THREE.Texture | null
  width: number
  height: number
  revision: number
  sourceRevision: number
  ready: boolean
  status: 'waiting' | 'ready' | 'unsupported' | 'error'
  error?: string
}

export function createMarblePageCaptureState(): MarblePageCaptureState {
  return { texture: null, width: 0, height: 0, revision: 0, sourceRevision: 0, ready: false, status: 'waiting' }
}

// Native state changes at boundaries, not on every pointer move. One queued
// frame coalesces the event, its React commit, and the resulting DOM edits.
const PAGE_EVENTS = [
  'input', 'change', 'pointerover', 'pointerout', 'pointerdown', 'pointerup',
  'pointercancel', 'focusin', 'focusout', 'keydown', 'keyup', 'scroll', 'load',
]
const WINDOW_EVENTS = ['resize', 'pointerup', 'pointercancel', 'blur']

function captureWrapper(): HTMLDivElement {
  const wrapper = document.createElement('div')
  wrapper.setAttribute('data-marble-page-capture', '')
  wrapper.setAttribute('aria-hidden', 'true')
  wrapper.inert = true
  wrapper.style.cssText = 'position:relative;display:block;box-sizing:border-box;margin:0;padding:0;border:0;overflow:hidden;'
  return wrapper
}

export function MarbleHandPageCapture({ page, target }: {
  page: RefObject<HTMLElement | null>
  target: MarblePageCaptureState
}) {
  const supported = useSurfaceSupport()
  const surface = useSurfaceHandle('marble-hand-native-page')
  const [wrapper] = useState(captureWrapper)
  const [size, setSize] = useState<SurfaceSize | null>(null)
  const reportError = useCallback((error: Error) => {
    target.ready = false
    target.status = 'error'
    target.error = error.message
  }, [target])

  useLayoutEffect(() => {
    target.ready = false
    target.texture = null
    target.status = supported ? 'waiting' : 'unsupported'
    target.error = undefined
    if (!supported) return

    let alive = true
    let raf = 0
    let root: HTMLElement | null = null
    const schedule = () => {
      if (alive && !raf) raf = requestAnimationFrame(mirror)
    }
    const resize = new ResizeObserver(schedule)
    const mutations = new MutationObserver(schedule)
    const styles = new MutationObserver(schedule)
    const mirror = () => {
      raf = 0
      if (!alive) return
      if (!root) {
        root = page.current
        // Canvas mounts in a separate reconciler. Its first effect can run
        // before the native ref exists, so wait without mounting a blank source.
        if (!root) { schedule(); return }
        resize.observe(root)
        mutations.observe(root, { subtree: true, childList: true, attributes: true, characterData: true })
        for (const event of PAGE_EVENTS) root.addEventListener(event, schedule, true)
      }
      const width = root.offsetWidth
      const height = root.offsetHeight
      if (width <= 0 || height <= 0) return
      try {
        wrapper.replaceChildren(cloneMarbleHandPage(root, width, height))
        target.sourceRevision += 1
        setSize((current) => current?.[0] === width && current[1] === height ? current : [width, height])
      } catch (cause) {
        reportError(cause instanceof Error ? cause : new Error(String(cause)))
      }
    }

    styles.observe(document.head, { subtree: true, childList: true, attributes: true, characterData: true })
    styles.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    styles.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] })
    for (const event of WINDOW_EVENTS) window.addEventListener(event, schedule, true)
    document.head.addEventListener('load', schedule, true)
    document.fonts.addEventListener('loadingdone', schedule)
    document.fonts.addEventListener('loadingerror', schedule)
    void document.fonts.ready.then(schedule)
    mirror()

    // Own every subscription here. The alive guard also makes the uncancellable
    // fonts.ready promise harmless after this capture has left the scene.
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      resize.disconnect()
      mutations.disconnect()
      styles.disconnect()
      for (const event of PAGE_EVENTS) root?.removeEventListener(event, schedule, true)
      for (const event of WINDOW_EVENTS) window.removeEventListener(event, schedule, true)
      document.head.removeEventListener('load', schedule, true)
      document.fonts.removeEventListener('loadingdone', schedule)
      document.fonts.removeEventListener('loadingerror', schedule)
      target.texture = null
      target.ready = false
      target.status = 'waiting'
    }
  }, [page, wrapper, supported, target, reportError])

  if (!supported || !size) return null
  return (
    <Surface surface={surface} renderIn="none" adopt={wrapper} size={size} resolution={1} mirrorU={false} onError={reportError}>
      <PublishPageCapture surface={surface} target={target} />
    </Surface>
  )
}

function PublishPageCapture({ surface, target }: {
  surface: SurfaceHandle
  target: MarblePageCaptureState
}) {
  const texture = useSurfaceTextureOf(surface)
  const paintedSize = useSurfacePaintedSize()
  const last = useRef<{ texture: THREE.Texture | null; version: number }>({ texture: null, version: -1 })

  useLayoutEffect(() => () => {
    last.current.texture = null
    last.current.version = -1
    target.texture = null
    target.ready = false
  }, [target])

  useFrame(() => {
    const [width, height] = paintedSize()
    // A CanvasTexture exists before its first successful paint. Surface's
    // onReady describes presenters, of which this source intentionally has none.
    if (!texture || width <= 0 || height <= 0) return
    if (last.current.texture === texture && last.current.version === texture.version) return
    last.current.texture = texture
    last.current.version = texture.version
    texture.name = 'marble-hand-native-page'
    target.texture = texture
    target.width = width
    target.height = height
    target.revision += 1
    target.ready = true
    target.status = 'ready'
    target.error = undefined
  })
  return null
}
