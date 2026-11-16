// Surface transition requests — actions can arrive before their canvas mounts.
// A renderer settles its current action before pending actions fall back to the page.
import { useState } from 'react'
import { flushSync } from 'react-dom'

export interface SurfaceTransitionRequest<Options> {
  readonly target: HTMLElement
  readonly update: () => boolean
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

  const settle = (stop: (() => void) | undefined, flush: boolean, update?: () => boolean) => {
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
    /** Attempts the synchronous update once. A throw stops its effect without rolling back state. */
    run(target: HTMLElement | null, update: () => void, options: Options) {
      const apply = () => {
        try {
          update()
          return true
        } catch (error) {
          queueMicrotask(() => reportError(error))
          return false
        }
      }
      if (settling) {
        settling.push(apply)
        return
      }
      if (!renderer) {
        apply()
        return
      }
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduced || !target?.isConnected) {
        settle(renderer.finish, true, apply)
        return
      }
      pending.push({ target, update: apply, options })
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
