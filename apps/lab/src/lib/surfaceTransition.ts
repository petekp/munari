// Surface transition requests — actions can arrive before their canvas mounts.
// A renderer settles its current action before pending actions fall back to the page.
import { useState } from 'react'
import { flushSync } from 'react-dom'

export interface SurfaceTransitionRequest<Options> {
  readonly target: HTMLElement
  readonly update: () => void
  readonly options: Options
}

interface TransitionRenderer {
  wake: () => void
  finish: () => void
  dispose: () => void
}

function createSurfaceTransition<Options>() {
  const pending: SurfaceTransitionRequest<Options>[] = []
  let renderer: TransitionRenderer | null = null
  let settling: Array<() => void> | null = null

  const settle = (stop: (() => void) | undefined, flush: boolean, update?: () => void) => {
    const older = pending.splice(0).map(request => request.update)
    if (update) older.push(update)
    if (settling) {
      settling.push(...older)
      stop?.()
      return
    }

    settling = older
    try {
      stop?.()
      const drain = () => {
        for (const action of older) action()
      }
      if (flush && older.length > 0) flushSync(drain)
      else drain()
    } finally {
      settling = null
    }
  }

  return {
    /** Applies a synchronous state update that does not throw. */
    run(target: HTMLElement | null, update: () => void, options: Options) {
      if (settling) {
        settling.push(update)
        return
      }
      if (!renderer) {
        update()
        return
      }
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduced || !target?.isConnected) {
        settle(renderer.finish, true, update)
        return
      }
      pending.push({ target, update, options })
      renderer.wake()
    },
    finish() {
      if (!settling) settle(renderer?.finish, true)
    },
    peek: () => pending[0],
    take: () => pending.shift(),
    connect(next: TransitionRenderer) {
      if (renderer) throw new Error('A surface transition already has a renderer')
      renderer = next
      return () => {
        if (renderer !== next) return
        renderer = null
        settle(next.dispose, false)
      }
    },
  }
}

export type SurfaceTransition<Options = void> = ReturnType<typeof createSurfaceTransition<Options>>

export function useSurfaceTransition<Options = void>(): SurfaceTransition<Options> {
  const [transition] = useState(createSurfaceTransition<Options>)
  return transition
}
