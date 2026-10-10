// Renderer replacement — a generation number that restarts a scene's own
// WebGPURenderer after its GPU is lost.
//
// The law: a WebGPURenderer that loses its device or context never draws
// again, on WebGPU and on the WebGL 2 fallback (decisions.md #73). Main's
// WebGLRenderer restored itself after `webglcontextrestored`, so Home,
// Lamp, Marble hand's background and Gravity's overlay came back on their
// own; ported, each stayed on its degraded fallback until a remount. The
// restart needs a new canvas too: a WebGL 2 canvas whose context was lost
// hands back the same lost context.
//
// An effect that owns a renderer lists `generation` as a dependency and
// reports a loss with the generation it started under. The first report
// for a generation bumps it, so the effect runs again on a new canvas;
// later reports for that generation are the same loss seen by its other
// renderers. One counter can serve several renderers that should restart
// together, because a GPU process crash loses all of them at once.
//
// SurfaceCanvas applies the same repeated-loss rule to its own renderer. The
// lab's seven standalone renderers share this hook rather than each
// restating that rule.
//
// Ownership: this hook owns the generation and the repeated-loss rule. The
// effect owns its canvas, renderer, and degraded state.

import { useCallback, useMemo, useRef, useState } from 'react'

// A replacement lost sooner than this after it started is not replaced
// again, so a GPU that fails on every frame stops after one retry
// (decisions.md #73).
const REPEATED_LOSS_MS = 10_000

export interface RendererReplacement {
  /** Bumped when a lost renderer is to be replaced. */
  readonly generation: number
  /**
   * Report that a renderer started under `generation` lost its GPU. True
   * when a replacement is coming; false when this was a replacement lost
   * within 10 s, which stays degraded until the scene remounts.
   */
  readonly lost: (generation: number) => boolean
}

export function useRendererReplacement(): RendererReplacement {
  const [generation, setGeneration] = useState(0)
  const current = useRef({ generation: 0, startedAt: Number.NEGATIVE_INFINITY })
  const lost = useCallback((from: number) => {
    const latest = current.current
    if (from !== latest.generation) return true
    if (latest.generation > 0 && performance.now() - latest.startedAt < REPEATED_LOSS_MS) return false
    current.current = { generation: from + 1, startedAt: performance.now() }
    setGeneration(from + 1)
    return true
  }, [])
  return useMemo(() => ({ generation, lost }), [generation, lost])
}
