// Surface loading — what a Surface and a SceneSurface report to an enclosing
// <Loading>, and when a lazy Surface starts preparing.
//
// The law: a Surface is shown once it presents in the scene, or once it
// stays on the page for a stated reason; a SceneSurface has no page to fall
// back to, so without capture it is unavailable (decisions.md #43 and #81). A
// lazy Surface defers until its page presentation nears the viewport and does
// not hold its <Loading> meanwhile, as a lazy image does not hold `load`.
//
// Ownership: the store reports presentation; <Loading> decides what the
// reports mean for the page.

import { useLayoutEffect, useMemo } from 'react'
import { useLoadingMember, type LoadingMember } from '../loading'
import { useLatest } from '../useLatest'
import type { SurfaceStore } from './surfaceHandle'

// A lazy Surface starts preparing this far outside the viewport: the margin
// CSS Containment suggests for `content-visibility: auto` (docs/loading/
// decisions.md D6). No measurement here sizes it.
const LAZY_ROOT_MARGIN = '50%'

export interface SurfaceLoadingFacts {
  readonly inScene: boolean
  /** Lazy and not yet near the viewport. */
  readonly deferred: boolean
  readonly browserSupported: boolean
  /** Why a part refused capture, or null. */
  readonly reason: string | null
}

export function useSurfaceLoading(store: SurfaceStore, facts: SurfaceLoadingFacts): void {
  const latest = useLatest(facts)
  const member = useMemo<LoadingMember>(() => ({
    kind: 'surface',
    label: store.name ?? null,
    read: () => {
      const { inScene: requested, deferred: waitsForView, browserSupported: supported, reason: refused } = latest.current
      if (waitsForView) return { status: 'deferred' }
      if (!requested) return { status: 'shown', presentation: 'page', reason: null }
      const status = store.getStatus()
      if (!supported || refused || !status.supported) return { status: 'shown', presentation: 'page', reason: { cause: 'support', message: refused ?? status.reason ?? 'capture unavailable' } }
      if (status.presentation === 'scene') return { status: 'shown', presentation: 'scene', engine: status.engine }
      return { status: 'waiting', waitingFor: 'presentation' }
    },
  }), [store, latest])
  const loadingChanged = useLoadingMember(member)
  useLayoutEffect(() => store.subscribe(loadingChanged), [store, loadingChanged])
  const { inScene, deferred, browserSupported, reason } = facts
  useLayoutEffect(loadingChanged, [inScene, deferred, browserSupported, reason, loadingChanged])
}

export function useSceneSurfaceLoading(store: SurfaceStore): void {
  const member = useMemo<LoadingMember>(() => ({
    kind: 'scene-surface',
    label: store.name ?? null,
    read: () => {
      const status = store.getStatus()
      if (!status.supported) return { status: 'unavailable', reason: { cause: 'support', message: status.reason ?? 'capture unavailable' } }
      if (status.presentation === 'scene') return { status: 'shown', presentation: 'scene', engine: status.engine }
      return { status: 'waiting', waitingFor: 'presentation' }
    },
  }), [store])
  const loadingChanged = useLoadingMember(member)
  useLayoutEffect(() => store.subscribe(loadingChanged), [store, loadingChanged])
}

/** Calls `onNear` once `element` comes within the lazy margin of the viewport. A null element observes nothing. */
export function useNearViewport(element: HTMLElement | null, onNear: () => void): void {
  useLayoutEffect(() => {
    if (!element) return
    const observer = new IntersectionObserver((records) => {
      if (records.some((record) => record.isIntersecting)) onNear()
    }, { rootMargin: LAZY_ROOT_MARGIN })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, onNear])
}
