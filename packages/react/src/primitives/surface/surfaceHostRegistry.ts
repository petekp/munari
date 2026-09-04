// The Canvas host registry — the document-scoped meeting point between a
// page tree and a scene tree.
//
// The law: registration is by NAME, never by React context. A page-side
// `<Surface.Mesh>` and a Canvas-side `<Surface source>` are declared in
// trees that cannot see each other — react-dom's portals do not cross the
// three.js reconciler, and the R3F scene is not an ancestor of the page —
// so the only thing both sides can hold is a string. One unnamed host is
// the default; several hosts without an explicit `canvas` id is a fault
// reported in development, because silently picking one produces a Surface
// that renders in the wrong canvas and nothing says so.
//
// Two directions cross here, and they are not symmetric. INWARD is a React
// element that must be rendered by the R3F reconciler (a page-declared
// WebGL presentation). OUTWARD is a DOM container that must be filled by a
// react-dom portal (a Canvas-declared source). Each side publishes to a
// store the other side subscribes to, so neither owns the other's commit.
//
// Work scheduling is reference-counted rather than boolean. A Canvas with
// `frameloop="demand"` is promoted while ANY registered Surface has work —
// a source painting, a handoff warming, a driver running — and returns to
// the caller's mode when the last claim is released. A boolean would let
// one Surface's release strand every other Surface's frames, which reads as
// a scene that freezes the moment a second panel settles.

import { hostTailPresents } from '@munari/core'
import type { ReactElement, ReactNode } from 'react'
import type { Object3D } from 'three'

/** A Canvas host's public name. One unnamed host needs no id. */
export type SurfaceCanvasId = string

/** One Canvas-declared source waiting for a react-dom portal to fill it. */
export interface SurfaceSourceEntry {
  readonly key: string
  /** The parked element the portal renders into. */
  readonly container: HTMLElement
  readonly content: ReactNode
}

/** One page-declared WebGL presentation waiting for the R3F reconciler. */
export interface SurfacePresenterEntry {
  readonly key: string
  readonly element: ReactElement
}

/**
 * What the host can do once its renderer exists. Installed by the bridge
 * component inside the Canvas and cleared on unmount, so every method here
 * is called through a null check — a registration can outlive a renderer.
 */
export interface SurfaceHostRuntime {
  invalidate(): void
  /** Promote to a continuous loop, or restore the caller's idle mode. */
  setBusy(busy: boolean): void
}

export interface SurfaceHost {
  readonly id: SurfaceCanvasId | undefined
  runtime: SurfaceHostRuntime | null
  setRuntime(runtime: SurfaceHostRuntime | null): void
  subscribeRuntime(listener: () => void): () => void
  mounted(): boolean
  registerSource(entry: SurfaceSourceEntry): () => void
  sources(): readonly SurfaceSourceEntry[]
  subscribeSources(listener: () => void): () => void
  registerPresenter(entry: SurfacePresenterEntry): () => void
  presenters(): readonly SurfacePresenterEntry[]
  subscribePresenters(listener: () => void): () => void
  /**
   * Advance one registered Surface per renderer frame.
   *
   * Every source's capture and every handoff's protocol run from ONE
   * `useFrame` inside the Canvas rather than one per Surface. Thirty-three
   * resident panels would otherwise install thirty-three frame callbacks
   * whose only job is to ask a counter whether it moved.
   */
  registerTick(tick: (dtMs: number) => void): () => void
  ticks(): readonly ((dtMs: number) => void)[]
  /**
   * Announce a presenter's mesh, for the pointer gate.
   *
   * The gate raycasts against exactly these objects and nothing else, so a
   * full-page Canvas is clear everywhere a Surface is not. Registered by the
   * presenter rather than found by traversal because a scene's own matter is
   * not Munari's to speak for.
   */
  registerObject(object: Object3D): () => void
  objects(): readonly Object3D[]
  /** Request continuous frames until the returned release is called. */
  claimWork(): () => void
  /** Live claims — the count the busy decision is made from. */
  workClaims(): number
  invalidate(): void
  /**
   * A presenter wrote color into an off-screen target this frame, so its
   * own post-draw callback is not a presentation boundary. `close` runs at
   * the frame tail if — and only if — the frame reached the screen.
   */
  deferPresentation(close: () => void): void
  /** Deferred presenters waiting on this frame's tail. */
  deferredPresentations(): number
  /**
   * The renderer finished a draw. Deferrals close only on a draw that
   * reached the default framebuffer; a draw into a target leaves them
   * pending, because a post-processed frame renders the scene off screen
   * FIRST and composites second, and draining at the scene pass would throw
   * away every presenter a moment before the pass that presents them.
   */
  closeFrameTail(reachedScreen: boolean): void
  /**
   * A frame ended without ever reaching the screen. Whatever deferred
   * during it is discarded and stays unproven until a frame that does.
   */
  discardFrameTail(): void
}

// The empty tuples are shared so a host with nothing registered hands back
// the same array identity every time. `useSyncExternalStore` compares
// snapshots by reference, and a fresh `[]` per read is an infinite render
// loop, not a slow one.
const NO_SOURCES: readonly SurfaceSourceEntry[] = Object.freeze([])
const NO_PRESENTERS: readonly SurfacePresenterEntry[] = Object.freeze([])
const NO_OBJECTS: readonly Object3D[] = Object.freeze([])

function createHost(id: SurfaceCanvasId | undefined): SurfaceHost {
  const sourceMap = new Map<string, SurfaceSourceEntry>()
  const presenterMap = new Map<string, SurfacePresenterEntry>()
  const sourceListeners = new Set<() => void>()
  const presenterListeners = new Set<() => void>()
  const runtimeListeners = new Set<() => void>()
  const tickSet = new Set<(dtMs: number) => void>()
  const objectSet = new Set<Object3D>()
  let objectSnapshot: readonly Object3D[] = NO_OBJECTS
  let sourceSnapshot: readonly SurfaceSourceEntry[] = NO_SOURCES
  let presenterSnapshot: readonly SurfacePresenterEntry[] = NO_PRESENTERS
  // Snapshotted rather than iterated live: a tick may unregister itself (a
  // source disposing on its own error path), and mutating a Set mid-`for`
  // silently skips the next entry — which reads as one panel out of many
  // that simply stops capturing.
  let tickSnapshot: readonly ((dtMs: number) => void)[] = []
  let claims = 0
  // Presenters that wrote color into a render target this frame. A
  // post-processed scene draws every Surface this way, so without a tail
  // nothing ever proves and the crossing hangs in 'lifting' forever.
  let deferred: (() => void)[] = []

  const host: SurfaceHost = {
    id,
    runtime: null,
    setRuntime(runtime) {
      if (host.runtime === runtime) return
      host.runtime = runtime
      for (const listener of runtimeListeners) listener()
    },
    subscribeRuntime(listener) {
      runtimeListeners.add(listener)
      return () => runtimeListeners.delete(listener)
    },
    mounted: () => mounts.has(host),
    registerSource(entry) {
      sourceMap.set(entry.key, entry)
      sourceSnapshot = Array.from(sourceMap.values())
      for (const listener of sourceListeners) listener()
      return () => {
        // Identity-checked: a re-registration under the same key (a source
        // whose content changed) replaces the entry, and the OLD entry's
        // release must not then delete the new one.
        if (sourceMap.get(entry.key) !== entry) return
        sourceMap.delete(entry.key)
        sourceSnapshot = sourceMap.size === 0 ? NO_SOURCES : Array.from(sourceMap.values())
        for (const listener of sourceListeners) listener()
      }
    },
    sources: () => sourceSnapshot,
    subscribeSources(listener) {
      sourceListeners.add(listener)
      return () => {
        sourceListeners.delete(listener)
      }
    },
    registerPresenter(entry) {
      presenterMap.set(entry.key, entry)
      presenterSnapshot = Array.from(presenterMap.values())
      for (const listener of presenterListeners) listener()
      return () => {
        if (presenterMap.get(entry.key) !== entry) return
        presenterMap.delete(entry.key)
        presenterSnapshot =
          presenterMap.size === 0 ? NO_PRESENTERS : Array.from(presenterMap.values())
        for (const listener of presenterListeners) listener()
      }
    },
    presenters: () => presenterSnapshot,
    subscribePresenters(listener) {
      presenterListeners.add(listener)
      return () => {
        presenterListeners.delete(listener)
      }
    },
    registerTick(tick) {
      tickSet.add(tick)
      tickSnapshot = Array.from(tickSet)
      return () => {
        if (!tickSet.delete(tick)) return
        tickSnapshot = Array.from(tickSet)
      }
    },
    ticks: () => tickSnapshot,
    registerObject(object) {
      objectSet.add(object)
      objectSnapshot = Array.from(objectSet)
      return () => {
        if (!objectSet.delete(object)) return
        objectSnapshot = objectSet.size === 0 ? NO_OBJECTS : Array.from(objectSet)
      }
    },
    objects: () => objectSnapshot,
    claimWork() {
      claims += 1
      if (claims === 1) host.runtime?.setBusy(true)
      host.runtime?.invalidate()
      let live = true
      return () => {
        if (!live) return
        live = false
        claims -= 1
        if (claims === 0) {
          host.runtime?.setBusy(false)
          // One last frame after the final release. Scene removal is not
          // presentation removal until the renderer draws without the
          // object, and a demand Canvas that stops here retains the last
          // pixels of whatever just released.
          host.runtime?.invalidate()
        }
      }
    },
    workClaims: () => claims,
    invalidate() {
      host.runtime?.invalidate()
    },
    deferPresentation(close) {
      deferred.push(close)
    },
    deferredPresentations: () => deferred.length,
    closeFrameTail(reachedScreen) {
      if (!hostTailPresents({ deferred: deferred.length, reachedScreen })) return
      // Drained before the closers run: a closer proving readiness can
      // settle a crossing, and anything that reaches back into the host
      // from there must not see this frame's list a second time.
      const closing = deferred
      deferred = []
      for (const close of closing) close()
    },
    discardFrameTail() {
      if (deferred.length === 0) return
      deferred = []
    },
  }
  return host
}

// Document-scoped, not module-scoped-per-tree: two React roots on one page
// share a document, and a page-side Surface must be able to find a Canvas
// mounted by the other root. The key is the id; `undefined` collapses to
// the empty string so the default host has an ordinary map entry.
const hosts = new Map<string, SurfaceHost>()
// Counted, not a set membership. Strict Mode mounts, unmounts and mounts
// again with the second registration ahead of the first cleanup, so a
// boolean membership would drop a host that is still on screen. Distinct
// Canvas instances carry distinct host objects even when their public ids
// collide, so an effect replay and an id collision remain different facts.
const mounts = new Map<SurfaceHost, number>()
// Reported once per id while the duplicate stands, not once per Canvas:
// a third Canvas or a Strict Mode effect replay must not repeat the same
// fault every commit.
const faulted = new Set<string>()

/**
 * Mint the private host owned by one Canvas instance.
 *
 * This is deliberately different from `surfaceHost`, which is the pending
 * meeting point page-side declarations can reach before a Canvas mounts.
 * Two Canvas instances with one public id must never share this object:
 * the renderer runtime, frame tail, scheduler claims, and pointer objects
 * all belong to one physical canvas.
 */
export function createSurfaceHost(id?: SurfaceCanvasId): SurfaceHost {
  return createHost(id)
}

/**
 * The host for `id`, created on first ask.
 *
 * Registration is allowed to precede the Canvas — a page-side Surface can
 * commit before the Canvas below it does — so this never fails. What can
 * fail is RESOLUTION, and that is `resolveSurfaceHost`'s job.
 */
export function surfaceHost(id?: SurfaceCanvasId): SurfaceHost {
  const key = id ?? ''
  let host = hosts.get(key)
  if (!host) {
    host = createHost(id)
    hosts.set(key, host)
  }
  return host
}

/** What a Canvas gets back for mounting a host. */
export interface SurfaceHostMount {
  /**
   * The host this Canvas owns. The first Canvas may adopt the pending host
   * that page-side declarations reached before it mounted; every duplicate
   * keeps its own candidate, so neither renderer can overwrite the other.
   */
  readonly host: SurfaceHost
  release(): void
}

/**
 * Mark a host as backed by a live Canvas.
 *
 * Two Canvases carrying the same `id` keep TWO private hosts. The id is
 * then ambiguous to page-side declarations and the collision is said out
 * loud; neither renderer, scheduler, or frame tail is borrowed by the
 * other.
 *
 * The fault waits a microtask before it believes the count. A remount runs
 * the new registration before the old cleanup (Strict Mode, Fast Refresh, a
 * changed key), which is momentarily indistinguishable from two Canvases and
 * is over by the end of the commit.
 */
export function mountSurfaceHost(candidate: SurfaceHost): SurfaceHostMount {
  const key = candidate.id ?? ''
  const current = mountedSurfaceHosts().filter((host) => (host.id ?? '') === key)
  const pending = hosts.get(key)
  // A page tree may have registered against the pending host before the
  // first Canvas committed. The first Canvas adopts it. Once one physical
  // Canvas is live, every later Canvas keeps its distinct candidate.
  const host = current.length === 0 && pending && !mounts.has(candidate) ? pending : candidate
  if (!hosts.has(key)) hosts.set(key, host)

  const live = (mounts.get(host) ?? 0) + 1
  mounts.set(host, live)
  const distinct = mountedSurfaceHosts().filter((entry) => (entry.id ?? '') === key)
  if (distinct.length > 1 && !faulted.has(key)) {
    queueMicrotask(() => {
      const stillDistinct = mountedSurfaceHosts().filter((entry) => (entry.id ?? '') === key)
      if (stillDistinct.length < 2 || faulted.has(key)) return
      faulted.add(key)
      console.error(
        `[munari] two <SurfaceCanvas${host.id ? ` id="${host.id}"` : ''}> hosts are ` +
          'mounted under the same id. Each Canvas keeps its own renderer, but page-side ' +
          'Surfaces cannot choose between them. Give each Canvas its own id and name it ' +
          'from `<Surface canvas="…">`.',
      )
    })
  }
  let released = false
  return {
    host,
    release() {
      if (released) return
      released = true
      const remaining = (mounts.get(host) ?? 1) - 1
      if (remaining > 0) {
        mounts.set(host, remaining)
        // Another Canvas still stands behind this host, so its renderer is
        // not this unmount's to clear.
        return
      }
      mounts.delete(host)
      const remainingForId = mountedSurfaceHosts().filter((entry) => (entry.id ?? '') === key)
      if (remainingForId.length < 2) faulted.delete(key)
      host.setRuntime(null)
    },
  }
}

export function mountedSurfaceHosts(): readonly SurfaceHost[] {
  return Array.from(mounts.keys())
}

/**
 * The host a page-side declaration should register with.
 *
 * `id` wins outright. Without one, exactly one mounted Canvas is
 * unambiguous and anything else is not: `null` here is the "several
 * canvases without an explicit association" fault, reported by the caller
 * with the surface's own name attached. Before any Canvas mounts the
 * default host is returned, because a page tree that commits first is
 * ordinary React, not a mistake.
 */
export function resolveSurfaceHost(id?: SurfaceCanvasId): SurfaceHost | null {
  if (id !== undefined) {
    const live = mountedSurfaceHosts().filter((host) => host.id === id)
    if (live.length === 0) return surfaceHost(id)
    if (live.length === 1) return live[0] ?? null
    return null
  }
  const live = mountedSurfaceHosts()
  if (live.length === 0) return surfaceHost()
  if (live.length === 1) return live[0] ?? null
  return null
}

/** Test seam: forget every host. Never called by the library itself. */
export function resetSurfaceHosts(): void {
  hosts.clear()
  mounts.clear()
  faulted.clear()
}
