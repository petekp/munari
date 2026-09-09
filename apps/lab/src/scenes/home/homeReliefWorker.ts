// Relief worker — paints the relief mask off the main thread.
//
// The law: the main thread measures (homeRelief.ts), this worker paints,
// and the reply carries the mask's pixels as a transferred buffer. A reply
// whose id is not the latest request is stale and the page drops it.
//
// Fault: painting the whole page's relief on the main thread stalled a
// frame by 34ms, timed 120ms after every click, right through the
// postcard's launch (probe, 2026-09-05).
//
// Ownership: this file owns the worker's message loop only. homeRelief.ts
// owns the painting; HomeMasthead.tsx owns the worker's lifetime.

import { paintRelief, type Mask, type Painter, type ReliefPlan } from './homeRelief'

export interface ReliefRequest {
  readonly id: number
  readonly plan: ReliefPlan
}

export interface ReliefReply {
  readonly id: number
  readonly mask: Mask | null
}

function offscreenPainter(width: number, height: number): Painter | null {
  return new OffscreenCanvas(width, height).getContext('2d')
}

addEventListener('message', (event: MessageEvent<ReliefRequest>) => {
  const { id, plan } = event.data
  const mask = paintRelief(plan, offscreenPainter)
  const reply: ReliefReply = { id, mask }
  postMessage(reply, { transfer: mask ? [mask.data.buffer] : [] })
})
