// Outward source content — the stable bridge between the R3F and DOM trees.
//
// The law: a source update changes the portal's CHILD, never the portal's
// registration. The registration owns DOM identity. Removing it for one
// effect cleanup unmounts the live controls, so a focused checkbox fell back
// to `<body>` after every FocusScene state update on 2026-08-18.
//
// Ownership: this store holds one React node and notifies the DOM renderer.
// The source host publishes; the portal-side component subscribes. Neither
// side creates another React root.

import { useSyncExternalStore, type ReactNode } from 'react'

export interface SurfaceOutwardContentStore {
  read(): ReactNode
  publish(content: ReactNode): void
  subscribe(listener: () => void): () => void
}

export function createSurfaceOutwardContentStore(): SurfaceOutwardContentStore {
  let content: ReactNode = null
  const listeners = new Set<() => void>()

  return {
    read: () => content,
    publish(next) {
      if (Object.is(content, next)) return
      content = next
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function SurfaceOutwardContent({ store }: { store: SurfaceOutwardContentStore }) {
  return useSyncExternalStore(store.subscribe, store.read, store.read)
}
