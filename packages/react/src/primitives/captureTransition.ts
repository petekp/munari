// Capture transitions — an app update that waits behind a capture of the content it changes.
//
// The law: each update runs once, in request order. While an effect is
// connected, an update waits until the effect has drawn a capture of the
// outgoing state on screen, so the new state never shows before the effect
// starts. Every wait is bounded: a request the effect has not accepted within
// QUEUED_REQUEST_LIMIT_MS ends every transition and applies every waiting
// update in order (decisions.md #77). With no effect connected, under reduced
// motion, or for a disconnected target, the update runs at once.
//
// The fault, 2026-11-15: an update that threw inside a drain stopped the
// drain, so every update queued behind it was lost (8ba5c01). A throw now
// ends only its own run.
//
// Ownership: the app owns the update and its state. This queue owns order and
// the fallback. An effect (captureTransitionEffect.ts) owns admission, the
// captures and drawing.
import { useState } from 'react'
import { flushSync } from 'react-dom'

/** A waiting request may wait this long for its effect (decisions.md #77). */
export const QUEUED_REQUEST_LIMIT_MS = 1000

/** What an effect reads when it decides whether to accept a request. */
export interface CaptureTransitionRequest<Options> {
  readonly target: HTMLElement
  readonly options: Options
}

export interface QueuedCaptureTransition<Options> extends CaptureTransitionRequest<Options> {
  /** Runs the app's update once. False when it threw. */
  readonly update: () => boolean
  readonly queuedAt: number
}

export interface CaptureTransitionRenderer {
  wake(): void
  finish(): void
  dispose(): void
}

export interface CaptureTransitionQueue<Options> {
  peek(): QueuedCaptureTransition<Options> | undefined
  take(): QueuedCaptureTransition<Options> | undefined
  connect(renderer: CaptureTransitionRenderer): () => void
  finish(): void
}

export const captureTransitionQueue: unique symbol = Symbol('munari.captureTransitionQueue')

export interface CaptureTransition<Options = void> {
  /**
   * Runs `update` once. When a connected effect can draw `target`, the update
   * waits until a capture of the outgoing state covers it on screen. Call it
   * from an event handler or an effect, never during render. The update must
   * be synchronous.
   */
  start(target: HTMLElement | null, update: () => void, ...options: Options extends void ? [] : [options: Options]): void
  /** Applies every waiting update in order and ends running effects. */
  finish(): void
  readonly [captureTransitionQueue]: CaptureTransitionQueue<Options>
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function createCaptureTransition<Options = void>(): CaptureTransition<Options> {
  const pending: QueuedCaptureTransition<Options>[] = []
  let renderer: CaptureTransitionRenderer | null = null
  let settling: Array<() => boolean> | null = null
  let limit: ReturnType<typeof setTimeout> | undefined
  let limitFor: QueuedCaptureTransition<Options> | undefined

  const armLimit = () => {
    const head = pending[0]
    if (head === limitFor) return
    clearTimeout(limit)
    limit = undefined
    limitFor = head
    if (!head) return
    const remaining = Math.max(0, QUEUED_REQUEST_LIMIT_MS - (performance.now() - head.queuedAt))
    limit = setTimeout(() => {
      if (pending[0] === head) finish()
    }, remaining)
  }

  const settle = (stop: (() => void) | undefined, flush: boolean, update?: () => boolean) => {
    const older = pending.splice(0).map(request => request.update)
    armLimit()
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

  const finish = () => {
    if (!settling) settle(renderer?.finish, true)
  }

  const queue: CaptureTransitionQueue<Options> = {
    peek: () => pending[0],
    take() {
      const request = pending.shift()
      armLimit()
      return request
    },
    connect(next) {
      if (renderer) throw new Error('munari: a capture transition has one effect. Create a second transition for a second effect.')
      renderer = next
      return () => {
        if (renderer !== next) return
        renderer = null
        settle(next.dispose, false)
      }
    },
    finish,
  }

  function start(target: HTMLElement | null, update: () => void, ...rest: [options?: Options]) {
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
    if (prefersReducedMotion() || !target?.isConnected) {
      settle(renderer.finish, true, apply)
      return
    }
    // SAFETY: `start`'s public signature requires the options argument unless
    // Options is void, and undefined is the void value.
    const options = rest[0] as Options
    pending.push({ target, options, update: apply, queuedAt: performance.now() })
    armLimit()
    renderer.wake()
  }

  return { start, finish, [captureTransitionQueue]: queue }
}

/** A capture transition owned by this component. Pass it to the effect that draws it. */
export function useCaptureTransition<Options = void>(): CaptureTransition<Options> {
  const [transition] = useState(createCaptureTransition<Options>)
  return transition
}
