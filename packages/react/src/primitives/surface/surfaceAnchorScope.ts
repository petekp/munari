// The anchor transaction, on the presenter's side.
//
// The law: an anchor set is ONE transaction against ONE paint, and matter
// placed from it is withheld until a COMPLETE set exists for the generation
// currently drawn on this geometry (docs/decisions.md #29). Children
// declare which keys they need; this scope collects all of them at once or
// none of them, and promotes a collected set only when the pixels it
// describes are the pixels on the mesh.
//
// The fault, 2026-08-15: anchors were read per child, each on whatever
// paint had last landed. During a resize the panel's screws came from one
// paint and its knobs from the next, so every control was plausibly placed
// and the two that moved were the ones being dragged. Nothing logged, and
// the picture is not readable as wrong.
//
// Ownership: this module owns the required set, the collected receipt, and
// the promotion rule. The presenter owns which generation is drawn and
// tells it here; the anchor components own only their own subscription.

import { createContext, use, useCallback, useMemo, useRef } from 'react'
import {
  anchorReceiptMatchesDrawn,
  collectSurfaceAnchors,
  type SourceUvRect,
  type SurfaceAnchorReceipt,
} from '@munari/core'
import type { SurfaceSourceRuntime } from './surfaceSourceRuntime'

export interface SurfaceAnchorScope {
  /** Declare a key the transaction must contain. The return forgets it. */
  require(name: string): () => void
  /** The committed box for `name`, or null while the set is incomplete. */
  box(name: string): SourceUvRect | null
  /** True when the source's texture is horizontally mirrored. */
  mirrorU(): boolean
  subscribe(listener: () => void): () => void
  /** The presenter drew this generation; promote a set that describes it. */
  noteDrawn(sourceId: number, generation: number): void
}

export const SurfaceAnchorContext = createContext<SurfaceAnchorScope | null>(null)

export function useSurfaceAnchorScope(
  runtime: SurfaceSourceRuntime | null,
  captureRoot: HTMLElement | null,
): SurfaceAnchorScope {
  const required = useRef(new Map<string, number>())
  const pending = useRef<SurfaceAnchorReceipt | null>(null)
  const committed = useRef<SurfaceAnchorReceipt | null>(null)
  const listeners = useRef(new Set<() => void>())
  const runtimeRef = useRef(runtime)
  const rootRef = useRef(captureRoot)
  runtimeRef.current = runtime
  rootRef.current = captureRoot

  const announce = useCallback(() => {
    for (const listener of listeners.current) listener()
  }, [])

  // Collected against the paint the runtime last completed, not against the
  // live layout: the boxes have to be true of pixels that exist, and the
  // only pixels that exist are the ones a paint made.
  const collect = useCallback(() => {
    const root = rootRef.current
    const paint = runtimeRef.current?.currentPaint()
    if (!root || !paint) return
    const keys = Array.from(required.current.keys())
    if (keys.length === 0) return
    const receipt = collectSurfaceAnchors(root, paint, keys)
    if (receipt) pending.current = receipt
  }, [])

  return useMemo<SurfaceAnchorScope>(
    () => ({
      require(name) {
        const map = required.current
        map.set(name, (map.get(name) ?? 0) + 1)
        // A new key invalidates the committed set rather than joining it:
        // the transaction is the whole set, and a set collected before this
        // key existed does not contain it.
        committed.current = null
        pending.current = null
        collect()
        announce()
        return () => {
          const live = (map.get(name) ?? 1) - 1
          if (live <= 0) map.delete(name)
          else map.set(name, live)
        }
      },
      box: (name) => committed.current?.anchors[name] ?? null,
      mirrorU: () => runtimeRef.current?.mirrorU() ?? false,
      subscribe(listener) {
        listeners.current.add(listener)
        return () => {
          listeners.current.delete(listener)
        }
      },
      noteDrawn(sourceId, generation) {
        // Re-collected on every drawn generation the pending set does not
        // already describe. A paint is cheap to describe and a layout read
        // here is one per new generation, not one per anchor per frame.
        if (
          !pending.current ||
          !anchorReceiptMatchesDrawn(pending.current, sourceId, generation)
        ) {
          collect()
        }
        const next = pending.current
        if (!next || !anchorReceiptMatchesDrawn(next, sourceId, generation)) return
        if (committed.current === next) return
        committed.current = next
        announce()
      },
    }),
    [collect, announce],
  )
}

export function useSurfaceAnchorContext(component: string): SurfaceAnchorScope {
  const scope = use(SurfaceAnchorContext)
  if (!scope) {
    throw new Error(
      `munari: <${component}> must be rendered inside a <Surface.WebGL>. An anchor ` +
        'is a place on a presenter’s geometry, and outside one there is no ' +
        'geometry to stand on.',
    )
  }
  return scope
}
