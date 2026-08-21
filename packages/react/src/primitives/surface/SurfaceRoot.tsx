// <Surface> — one piece of content, named once, wherever it is declared.
//
// The law: the root owns IDENTITY and the SOURCE; it owns no pixels. It
// decides nothing about where anything is drawn, which is what lets the
// same declaration serve three wirings — a page tree tunnelling a mesh
// inward, a scene tree portalling content outward, and two trees connected
// by a handle. Which of the three is in play is read from where the root
// stands (an R3F host above it or not), never from a prop: a caller who
// could assert the wrong one would get a Surface that renders nowhere and
// says nothing.
//
// The fault behind the host tick, 2026-08-16: the protocol was advanced
// from the root's own `requestAnimationFrame`. On a `frameloop="demand"`
// Canvas that loop kept running while the renderer slept, so a crossing
// completed — readiness settled, the page released — in frames that were
// never drawn, and the DOM disappeared under a canvas showing the previous
// second. The protocol now advances only from the host's single frame
// callback, so protocol time and renderer time cannot diverge.
//
// Ownership: this component owns the handle's controller claim, the part
// ledger, the source host, and the protocol tick. It owns no mesh, no
// material, and no placement.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { trackPointerPlace, type SurfaceChrome, type SurfacePartId } from '@munari/core'
import {
  useSurfaceController,
  useSurfaceControls,
  useSurfaceStore,
  surfaceStoreOf,
  type SurfaceControls,
  type SurfaceHandle,
  type SurfaceStore,
} from './surfaceHandle'
import {
  DEFAULT_PART,
  SurfaceRootContext,
  nextSurfaceInstanceId,
  type SurfaceRootValue,
  type SurfaceWiring,
} from './surfaceContext'
import { resolveSurfaceHost, type SurfaceCanvasId, type SurfaceHost } from './surfaceHostRegistry'
import { useSurfaceHostContext } from './surfaceHostContext'
import { SurfaceSourceHost } from './surfaceSourceHost'
import type { SurfaceResolution, SurfaceSize, SurfaceSourceRuntime } from './surfaceSourceRuntime'

/**
 * Everything true of a Surface however its content arrives.
 *
 * `view`, `timing`, and the callbacks are HERE and nowhere else: one
 * declaration writes what the Surface is doing, so a handle created above
 * cannot disagree with the root presenting it.
 */
interface SurfaceControlledProps extends SurfaceControls {
  /** Names the Canvas host to present in. Required past the first one. */
  canvas?: SurfaceCanvasId
  onFocusWithinChange?: (focused: boolean) => void
  children?: React.ReactNode
}

/** How a root's own content is captured, for the roots that carry any. */
export interface SurfaceContentOptions {
  size?: SurfaceSize
  resolution?: SurfaceResolution
  mirrorU?: boolean
  /** `'always'` re-rasterizes every frame; `'auto'` follows the DOM. */
  paint?: 'auto' | 'always'
  onChrome?: (chrome: SurfaceChrome) => void
}

// The multipart member's shape for those same fields. Stated as an
// explicit "none of these" rather than left off, so `<Surface size={…}>`
// with the parts below carrying their own sources is a compile error and
// not a silently ignored prop.
type WithoutContentOptions = { [K in keyof SurfaceContentOptions]?: never }

/**
 * Where a root's pixels come from: React content, a detached element, or
 * `<Surface.Part>` children. Exactly one, and the union says so — `source`
 * and `adopt` together is a Surface with two answers to which element is
 * captured, and the one that loses is invisible at runtime.
 */
export type SurfaceContentProps =
  | ({
      /** React content Munari captures. */
      source: React.ReactNode
      adopt?: never
    } & SurfaceContentOptions)
  | ({
      /** A detached element Munari takes ownership of instead. */
      adopt: HTMLElement
      source?: never
    } & SurfaceContentOptions)
  | ({ source?: never; adopt?: never } & WithoutContentOptions)

/**
 * Who names this Surface: this root (`name`), or the handle it was handed
 * (`surface`). Never both — a handle is already named, and a second name
 * beside it is one nothing reads.
 */
export type SurfaceIdentityProps =
  | {
      /** Separated wiring: present a handle another tree already declared. */
      surface: SurfaceHandle
      name?: never
    }
  | { surface?: never; name?: string }

export type SurfaceProps = SurfaceControlledProps &
  SurfaceIdentityProps &
  SurfaceContentProps

export function SurfaceRoot({
  surface,
  name,
  source,
  adopt,
  canvas,
  view,
  timing,
  size,
  resolution,
  mirrorU,
  paint,
  onPresentedViewChange,
  onMotionComplete,
  onReady,
  onWebGLReleased,
  onFocusWithinChange,
  onChrome,
  onError,
  children,
}: SurfaceProps) {
  // A handle passed in was created elsewhere and is already installed; only
  // the unpassed case mints one. Both paths call the same hooks, so the
  // owned store is created either way and simply goes unused — the cost is
  // one plain object, and the alternative is a conditional hook.
  const ownStore = useSurfaceStore({ name })
  const store: SurfaceStore = surface ? surfaceStoreOf(surface) : ownStore
  useSurfaceController(store)
  // The controlled half, written by THIS declaration whether the handle is
  // this root's or one it was handed.
  useSurfaceControls(store, {
    view,
    timing,
    onPresentedViewChange,
    onMotionComplete,
    onReady,
    onWebGLReleased,
    onError,
  })

  // `view` is what makes this an exclusive handoff. Without it the Surface
  // is a Twin: the DOM keeps the hold forever and the WebGL side is an
  // additional presentation of it, never a replacement.
  const exclusive = view !== undefined
  useLayoutEffect(() => store.setExclusive(exclusive), [store, exclusive])

  // Tracked from the ROOT, not only the presenter: a presenter mounted at
  // press time (flight-only meshes) installs its tracker after the last
  // trusted event, so the arrival burst read a null place and a still
  // pointer lost its hover across the flip (2026-08-20). Ref-counted, so
  // doubling up with the presenter's own tracker costs nothing.
  useEffect(() => trackPointerPlace(), [])

  const contextHost = useSurfaceHostContext()
  const wiring: SurfaceWiring = contextHost ? 'canvas' : 'page'
  const host = useResolvedHost(store, wiring, contextHost, canvas)

  // The protocol advances from the renderer's frame, and only while there
  // is something for it to advance — a crossing under way, or a linger
  // still holding the WebGL side mounted after one landed.
  useEffect(() => {
    if (!host) return
    let claim: (() => void) | null = null
    const release = host.registerTick((dtMs) => {
      store.tick(dtMs)
      const state = store.getState()
      const working = state.isChanging || state.isWebGLMounted
      if (working) {
        if (!claim) claim = host.claimWork()
      } else if (claim) {
        claim()
        claim = null
      }
    })
    return () => {
      release()
      claim?.()
    }
  }, [host, store])

  // Minted per root instance, never derived from `name`. Two unnamed
  // Surfaces are two identities and their cross-tree registrations have to
  // say so; a Strict Mode remount mints a second one, which is correct —
  // the replacement's registrations are its own.
  const [instanceId] = useState(nextSurfaceInstanceId)

  const [measured, setMeasured] = useState<ReadonlyMap<SurfacePartId, SurfaceSize | null>>(
    () => new Map(),
  )
  const reportMeasuredSize = useCallback((id: SurfacePartId, next: SurfaceSize | null) => {
    setMeasured((current) => {
      if (current.get(id) === next) return current
      const copy = new Map(current)
      copy.set(id, next)
      return copy
    })
  }, [])

  // The expected set is a COUNT per part, not a boolean. Strict Mode and
  // any ordinary remount run the new registration before the old cleanup,
  // so a boolean would be cleared by the departing copy and the part would
  // drop out of the readiness set it is still in.
  const expectedRef = useRef(new Map<SurfacePartId, number>())
  const expectPart = useCallback((id: SurfacePartId) => {
    const map = expectedRef.current
    map.set(id, (map.get(id) ?? 0) + 1)
    return () => {
      const live = (map.get(id) ?? 1) - 1
      if (live <= 0) map.delete(id)
      else map.set(id, live)
    }
  }, [])

  const root = useMemo<SurfaceRootValue>(
    () => ({
      store,
      handle: store.handle,
      host,
      canvas,
      name: store.name,
      instanceId,
      wiring,
      exclusive,
      expectPart,
      registerPartPresenter: expectPart,
      reportMeasuredSize,
      measuredSize: (id) => measured.get(id) ?? null,
      partRuntime: (id): SurfaceSourceRuntime | null => store.part(id)?.runtime ?? null,
    }),
    [
      store,
      host,
      canvas,
      instanceId,
      wiring,
      exclusive,
      expectPart,
      reportMeasuredSize,
      measured,
    ],
  )

  // A root carrying its own content IS a part — the single-source case is
  // the one-part case with the name filled in, so anchors, readiness, and
  // the part publication have one code path rather than two.
  const single = source !== undefined || adopt !== undefined

  return (
    <SurfaceRootContext value={root}>
      {single ? (
        <SurfaceSourceHost
          root={root}
          id={DEFAULT_PART}
          source={source}
          adopt={adopt}
          size={size}
          resolution={resolution}
          mirrorU={mirrorU}
          paint={paint}
          onFocusWithinChange={onFocusWithinChange}
          onChrome={onChrome}
        >
          {children}
        </SurfaceSourceHost>
      ) : (
        children
      )}
    </SurfaceRootContext>
  )
}

/**
 * The host this root presents in.
 *
 * Inside a Canvas the answer is the one above; outside, it is looked up by
 * name. The ambiguity fault — several mounted Canvases and no `canvas` prop
 * — is reported once per resolution rather than silently resolved, because
 * picking one produces a Surface that renders in the wrong canvas and
 * nothing anywhere says so.
 */
function useResolvedHost(
  store: SurfaceStore,
  wiring: SurfaceWiring,
  contextHost: SurfaceHost | null,
  canvas: SurfaceCanvasId | undefined,
): SurfaceHost | null {
  // Resolve once per authored id. A page declaration that arrives first
  // gets the pending host the first Canvas adopts. If a duplicate Canvas
  // appears later, this Surface must keep its existing association rather
  // than unregister from a healthy renderer because the public id became
  // ambiguous after the fact. A Surface born while the duplicate stands
  // resolves null and reports the fault below.
  const pageHost = useMemo(
    () => (wiring === 'page' ? resolveSurfaceHost(canvas) : null),
    [wiring, canvas],
  )
  const resolved = wiring === 'canvas' ? contextHost : pageHost
  useEffect(() => {
    if (wiring === 'canvas' || resolved) return
    store.reportError(
      new Error(
        `Surface${store.name ? ` "${store.name}"` : ''} found several <SurfaceCanvas> ` +
          'hosts and no way to choose. Give each canvas an `id` and name one with ' +
          '`<Surface canvas="…">`.',
      ),
    )
  }, [wiring, resolved, store])
  return resolved
}
