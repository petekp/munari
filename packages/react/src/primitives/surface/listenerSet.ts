// A listener set — subscribe and emit for a store's change signals.

/** A listener set whose `emit` walks the live Set, so re-entrant changes behave as a plain `for…of`. */
export function listenerSet() {
  const set = new Set<() => void>()
  return {
    subscribe(listener: () => void): () => void {
      set.add(listener)
      return () => {
        set.delete(listener)
      }
    },
    emit(): void {
      for (const listener of set) listener()
    },
  }
}
