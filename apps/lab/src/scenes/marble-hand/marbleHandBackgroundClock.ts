// The background clock — one published second for two renderers.
//
// The law: the page canvas and the hand's reflection copy of the same
// shader must read the SAME number, not two readings of the same wall
// clock. The fault, 2026-08-31: the reflection sampled performance.now()
// inside the R3F frame while the page canvas sampled it in its own rAF,
// so the reflected field ran up to 16 ms ahead of the page it mirrors and
// the two silhouettes disagreed along every moving edge.
//
// Ownership: this module owns elapsed time and its running state. The page
// canvas owns when a frame is published; every other reader is handed that
// same number synchronously. Nothing here touches the DOM or a renderer.

export interface MarbleBackgroundClock {
  /** Publish a new value from wall time. Only the page canvas calls this. */
  sample(nowMs?: number): number
  /** The last published value, in seconds. */
  now(): number
  running(): boolean
  pause(nowMs?: number): void
  resume(nowMs?: number): void
  freezeAt(seconds: number): void
  /**
   * Take every published value, starting with the current one. Reading
   * `now()` from a second render loop would lag by a frame whenever that
   * loop's rAF happens to run before the page canvas's.
   */
  subscribe(listener: (seconds: number) => void): () => void
}

export function createMarbleBackgroundClock(): MarbleBackgroundClock {
  let published = 0
  let held = 0
  // Wall time of the last resume, or null while the clock is holding. The
  // held total is what makes a resume continue instead of restarting.
  let startedMs: number | null = null
  const listeners = new Set<(seconds: number) => void>()

  const publish = (seconds: number) => {
    published = seconds
    for (const listener of listeners) listener(seconds)
  }
  const elapsed = (nowMs: number) => startedMs === null ? held : held + (nowMs - startedMs) / 1000

  return {
    sample(nowMs = performance.now()) {
      publish(elapsed(nowMs))
      return published
    },
    now: () => published,
    running: () => startedMs !== null,
    pause(nowMs = performance.now()) {
      if (startedMs === null) return
      held = elapsed(nowMs)
      startedMs = null
      publish(held)
    },
    resume(nowMs = performance.now()) {
      if (startedMs !== null) return
      startedMs = nowMs
    },
    freezeAt(seconds) {
      held = seconds
      startedMs = null
      publish(seconds)
    },
    subscribe(listener) {
      listeners.add(listener)
      listener(published)
      return () => { listeners.delete(listener) }
    },
  }
}

// One clock per document. The page canvas and the environment's reflection
// copy are separate React trees, so a prop or context could not join them.
export const marbleBackgroundClock = createMarbleBackgroundClock()

// The still every reduced-motion reader sees. Chosen because all four
// fields have left their t = 0 symmetry by then and none is mid-sweep.
export const MARBLE_BACKGROUND_REDUCED_TIME = 37.5
