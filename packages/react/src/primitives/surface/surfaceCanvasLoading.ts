// Canvas loading — what a SurfaceCanvas reports to an enclosing <Loading>.
//
// The law: a canvas is shown once its renderer has drawn a frame that held
// nothing back for its pipelines (decisions.md #80 and #81). A lost renderer
// starts over, because what it drew is gone.
//
// Ownership: SurfaceCanvas reports each draw; <Loading> decides what the
// report means for the page.

import { useLayoutEffect, useMemo, useState } from 'react'
import { useLoadingMember, type LoadingMember } from '../loading'
import { useLatest } from '../useLatest'
import type { SurfaceCanvasId } from './surfaceHostRegistry'

export interface CanvasDrawReport {
  /** After each canvas draw, with how many objects and builds it held back. */
  drew(holding: number): void
  /** A draw has finished with nothing held back, and none since has held anything. */
  complete(): boolean
  /** The renderer was lost: what it drew no longer counts. */
  reset(): void
  subscribe(listener: () => void): () => void
}

function createCanvasDrawReport(): CanvasDrawReport {
  let complete = false
  const listeners = new Set<() => void>()
  return {
    drew(holding) {
      const next = holding === 0
      if (next === complete) return
      complete = next
      for (const listener of [...listeners]) listener()
    },
    complete: () => complete,
    reset() {
      complete = false
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

/** Registers the canvas with an enclosing `<Loading>` and returns the report its draws feed. */
export function useCanvasLoading(id: SurfaceCanvasId | undefined, created: boolean, rendererLost: boolean): CanvasDrawReport {
  const [drawReport] = useState(createCanvasDrawReport)
  const canvasState = useLatest({ created, rendererLost })
  const loadingMember = useMemo<LoadingMember>(() => ({
    kind: 'surface-canvas',
    label: id ?? null,
    read: () => {
      if (!canvasState.current.created || canvasState.current.rendererLost) return { status: 'waiting', waitingFor: 'renderer' }
      if (!drawReport.complete()) return { status: 'waiting', waitingFor: 'presentation' }
      return { status: 'shown', presentation: 'scene', engine: null }
    },
  }), [id, canvasState, drawReport])
  const loadingChanged = useLoadingMember(loadingMember)
  useLayoutEffect(() => drawReport.subscribe(loadingChanged), [drawReport, loadingChanged])
  useLayoutEffect(loadingChanged, [created, rendererLost, loadingChanged])
  return drawReport
}
