import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { guardPointerCapture } from '@munari/core'
import { useLatest } from './useLatest'

// The DOM half of a Surface that hosts live UI.
//
// `Surface` takes markup and rasterizes it. Everything past a static string —
// a React tree, a portal target, or both — needs the same small pile of
// container plumbing, and each piece of it is load-bearing for a reason that
// took a bug to find. Every host-owning primitive (`SurfaceApp` today)
// is built on this, so those reasons are paid for once.

export interface SourceHost {
  /** Hand to `Surface`'s `onSource`. */
  mount: (el: HTMLElement) => () => void
  /** The container, once the Surface has a source to hang it in. */
  host: HTMLElement | null
  /** Is anything mounted in the container right now? */
  occupied: boolean
}

export interface SourceHostOptions {
  /** CSS pixel size to DECLARE on the container — see the note in `mount`. */
  width: number
  height: number
  /** Class for the container: `ui-root` for opaque UI, `ui-layer` for glass. */
  className: string
  /** A React tree the container owns outright, as opposed to portaled content. */
  content?: ReactNode
  /** Receives the container when it exists, and `null` when it goes away. */
  onHost?: (el: HTMLElement | null) => void
  /** Fires on mount and on every child added or removed. */
  onChildList?: (host: HTMLElement) => void
}

export function useSourceHost({
  width,
  height,
  className,
  content,
  onHost,
  onChildList,
}: SourceHostOptions): SourceHost {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [occupied, setOccupied] = useState(false)

  // Everything `mount` reads is read through a ref, so `mount` never changes
  // identity. It is handed to `Surface`'s `onSource` — a lifecycle hook that
  // runs once and is never re-run — and a caller passing an inline `content`
  // or an arrow `onHost` would otherwise churn it every render.
  const widthRef = useLatest(width)
  const heightRef = useLatest(height)
  const classNameRef = useLatest(className)
  const contentRef = useLatest(content)
  const onHostRef = useLatest(onHost)
  const onChildListRef = useLatest(onChildList)
  const rootRef = useRef<Root | null>(null)

  const mount = useCallback((el: HTMLElement) => {
    const node = document.createElement('div')
    node.className = classNameRef.current

    // Declare the size rather than let layout find it. `drawElementImage`
    // rasterizes an element at its own layout box — and a portal container's
    // children are `position: fixed`, hence out of flow, contributing nothing
    // to their parent's height. An undeclared container measures zero and
    // draws an empty rectangle, with clean paints and no error anywhere
    // (docs/platform.md). For an ordinary content root the same
    // declaration is merely house style; here it is the whole picture.
    node.style.width = `${widthRef.current}px`
    node.style.height = `${heightRef.current}px`
    el.appendChild(node)

    // Parked matter must never hold the real pointer. A drag consumer inside
    // (react-resizable-panels calls `setPointerCapture` per move) would
    // otherwise capture pointerId 1 — the actual mouse — and every trusted
    // pointer event retargets to the parked element: the canvas goes
    // silent mid-gesture.
    const unguard = guardPointerCapture(node)

    // The container is built HERE, not hoisted into a `useMemo`, because it
    // may own a React root. A hoisted node outlives a Surface source
    // teardown, so the next mount would call `createRoot` on a container
    // whose previous root is still waiting on its unmount microtask. React
    // throws, the throw lands inside r3f's `CanvasImpl`, the canvas is torn
    // down, and the GL context goes with it. Cost one context loss to
    // learn.
    if (contentRef.current !== undefined) {
      const root = createRoot(node)
      // The first render is FLUSHED, not scheduled. A concurrent initial
      // render leaves the container mounted and empty until React's commit
      // lands a task later — and the capture pipeline is armed in the same
      // effect that calls `mount`, so Chrome can paint the bare container
      // in that gap. The capture is then a blank card wearing `.ui-root`'s
      // opaque background (any `:has(> …)` override the content would
      // carry cannot match a child that does not exist), and it fires the
      // Surface's first-upload AND first-presented receipts — the custody
      // receipts certify pixels, not the right pixels. On a warm remount
      // the gap is several composited frames wide: the crossing-flash gate
      // photographed six white cards over the logo (2026-08-13). Flushing
      // means the source never exists without its content; later updates
      // stay concurrent because a LIVE tree mid-update is ordinary React,
      // while an EMPTY root pretending to be the app is not.
      flushSync(() => root.render(contentRef.current))
      rootRef.current = root
    }

    setHost(node)
    onHostRef.current?.(node)

    return () => {
      const root = rootRef.current
      rootRef.current = null
      onHostRef.current?.(null)
      setHost(null)
      unguard()
      node.remove()
      // Unmounting synchronously here would land inside the outer root's
      // commit phase (React warns and defers anyway) — do it cleanly.
      if (root) queueMicrotask(() => root.unmount())
    }
    // Stable ref identities only — `mount` never changes, which is the point.
  }, [classNameRef, widthRef, heightRef, contentRef, onHostRef])

  // Re-render an owned tree in place. Never tears the root down and rebuilds
  // it: that would take focus, form values, and selection with it.
  useEffect(() => {
    if (content !== undefined) rootRef.current?.render(content)
  }, [content])

  // Keep the declared size current — for a container sized by measurement,
  // this is where a resize actually reaches the DOM.
  //
  // Before paint, not after. `drawElementImage` rasterizes the host at its
  // own layout box, so the declared size IS the size of the next capture.
  // Written from a passive effect, a resize reaches the DOM one paint too
  // late and every capture during a drag is one step behind the geometry
  // it is stretched over — the controls on the face slide against the
  // hardware standing on them. Worse, a commit React chose to defer can
  // land its own stale size on top of a fresher write a consumer made
  // synchronously inside the pointer event, which reads as a wobble
  // rather than a lag. A layout effect writes inside the commit that
  // knows the number, before anyone can photograph the container.
  useLayoutEffect(() => {
    if (!host) return
    host.style.width = `${width}px`
    host.style.height = `${height}px`
  }, [host, width, height])

  // What is in the container?
  //
  // `childList` fires exactly when a portaled thing opens or closes and at no
  // other time — and it is the only signal available, because that content is
  // mounted by a *different* React root portaling in, so nothing in this tree
  // re-runs when a popover opens.
  //
  // This is not the MutationObserver the house rules ban. That prohibition is
  // about Surface's PAINT path, where `onpaint` is already the better change
  // signal. This one answers "what exists", which the compositor never
  // reports, and it never triggers a repaint.
  useEffect(() => {
    if (!host) return
    const sync = () => {
      setOccupied(host.childElementCount > 0)
      onChildListRef.current?.(host)
    }
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(host, { childList: true })
    return () => mo.disconnect()
  }, [host, onChildListRef])

  return { mount, host, occupied }
}
