// <Surface.DOM> — the page-side presentation of a source.
//
// The law: the holder is the only thing that knows the page box, and the
// page box is a SCREEN fact. Match-DOM placement reads it every frame from
// this element rather than from a value the layout system published once,
// because scroll, a resize, a font swap, and a sibling's height change all
// move it without any of them re-rendering this component.
//
// Content is rendered here a SECOND time, not moved. The captured copy
// lives in the parked container and this one lives in the page, so both
// stay mounted and neither's local state, scroll position, or focus is
// destroyed by a handoff. `useSurfaceInstance()` is how a source tells the
// two apart when something must happen exactly once.
//
// The fault behind the release order, 2026-08-13: the holder was hidden
// with `display: none` the moment the crossing requested WebGL. That
// collapsed the page box before the mesh had proven a single drawn pixel,
// so match-DOM placed the plane at a zero rect and the crossing-flash gate
// photographed a frame with nothing in it at all. The holder is released by
// VISIBILITY, keeping its layout box, and only once the hold has moved —
// which is a signal from the store, fired inside a draw, not a React commit.
//
// Ownership: this component owns the holder element, its measurement, its
// interactivity, and the page instance of the content. It owns no texture
// and no protocol.

import { use, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { rectIsMeasurable } from '@munari/core'
import {
  SurfaceInstanceContext,
  SurfaceHandleContext,
  SurfacePartContext,
  SurfaceRootContext,
  type SurfaceInstance,
} from './surfaceContext'
import { surfaceStoreOf, type SurfaceHandle } from './surfaceHandle'

export interface SurfaceDOMProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The page copy of the content. Usually the same element as `source`. */
  children?: React.ReactNode
  ref?: React.Ref<HTMLDivElement>
  /** Separated wiring: the handle whose page presentation this declares. */
  surface?: SurfaceHandle
}

export function SurfaceDOM({ children, style, ref, surface, ...rest }: SurfaceDOMProps) {
  const inheritedRoot = use(SurfaceRootContext)
  const contextualPart = use(SurfacePartContext)
  const part = surface && inheritedRoot?.handle !== surface ? null : contextualPart
  const store = surface ? surfaceStoreOf(surface) : inheritedRoot?.store
  if (!store) {
    throw new Error('munari: <Surface.DOM> needs an enclosing <Surface> or `surface={…}`.')
  }
  if (!part && children === undefined) {
    throw new Error('munari: separated <Surface.DOM surface={…}> needs explicit children.')
  }
  const handleValue = useMemo(() => ({ handle: store.handle, store }), [store])
  const [holder, setHolder] = useState<HTMLDivElement | null>(null)

  const setPageRoot = part?.setPageRoot
  useLayoutEffect(() => {
    if (!setPageRoot) return
    setPageRoot(holder)
    return () => setPageRoot(null)
  }, [setPageRoot, holder])

  // Measured, not authored: a Surface that never declared a `size` takes
  // the box the page gave this element, so the raster matches the layout
  // instead of a number somebody guessed and then let drift.
  const setMeasuredSize = part?.setMeasuredSize
  const measuredRef = useRef<readonly [number, number] | null>(null)
  useEffect(() => {
    if (!holder || !setMeasuredSize) return
    const read = () => {
      const rect = holder.getBoundingClientRect()
      if (!rectIsMeasurable(rect)) return
      const next = [Math.round(rect.width), Math.round(rect.height)] as const
      const last = measuredRef.current
      if (last && last[0] === next[0] && last[1] === next[1]) return
      measuredRef.current = next
      setMeasuredSize([next[0], next[1]])
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(holder)
    return () => observer.disconnect()
  }, [holder, setMeasuredSize])

  // The renderer has to be told the page moved. Scroll and visual-viewport
  // changes do not re-render anything, and on a demand Canvas the plane
  // would simply stay where the last drawn frame put it — the Surface slides
  // away from the box it is supposed to be standing in.
  const host = inheritedRoot?.host ?? null
  useEffect(() => {
    if (!host || !holder) return
    const wake = () => host.invalidate()
    window.addEventListener('scroll', wake, { capture: true, passive: true })
    window.addEventListener('resize', wake, { passive: true })
    window.visualViewport?.addEventListener('resize', wake)
    window.visualViewport?.addEventListener('scroll', wake)
    const observer = new ResizeObserver(wake)
    observer.observe(holder)
    return () => {
      window.removeEventListener('scroll', wake, { capture: true })
      window.removeEventListener('resize', wake)
      window.visualViewport?.removeEventListener('resize', wake)
      window.visualViewport?.removeEventListener('scroll', wake)
      observer.disconnect()
    }
  }, [host, holder])

  // Released on the store's HOLD signal, not on a React commit. The signal
  // fires inside the post-draw callback of the frame whose pixels replace
  // this copy, so the two presentations change places between one draw and
  // the browser's composite of it. Waiting for a commit puts a whole frame
  // between them, and that frame is the flicker.
  //
  // A Twin never releases at all: nothing took the hold from it, so the
  // page presentation remains the one reachable DOM instance.
  useLayoutEffect(() => store.declarePresentation('page'), [store])
  useEffect(() => {
    if (!holder) return
    const apply = () => {
      const released = !store.pagePresents()
      // Visibility, not display: the layout box must survive the handoff,
      // because match-DOM reads it every frame and a collapsed box places
      // the plane at nothing.
      holder.style.visibility = released ? 'hidden' : ''
      // `inert` is the whole accessibility story here: it removes the
      // subtree from the tab order, from hit testing, and from the
      // accessibility tree in one property, so the page copy cannot be
      // reached by keyboard while the WebGL copy is the one on screen.
      holder.inert = released
      if (released) holder.setAttribute('aria-hidden', 'true')
      else holder.removeAttribute('aria-hidden')
    }
    apply()
    return store.subscribeHold(apply)
  }, [holder, store])

  // SAFETY: the handle is read after the commit that set `holder`, so it is
  // the live element. Before the first commit there is no div to hand back
  // and null is the honest answer the declared type cannot express.
  useImperativeHandle(ref, () => holder as HTMLDivElement, [holder])

  const instance: SurfaceInstance = 'page'
  return (
    <SurfaceHandleContext value={handleValue}>
      <SurfaceInstanceContext value={instance}>
        <div {...rest} ref={setHolder} style={style}>
          {children === undefined ? part?.source : children}
        </div>
      </SurfaceInstanceContext>
    </SurfaceHandleContext>
  )
}
