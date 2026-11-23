// The film probe hooks — what Genie hands to a browser probe that watches
// the film window's handoff, and the one edit a probe makes to it.
//
// The law: nothing in the scene reads these. A probe installs
// `window.__genieFilmProbe` or loads the page with
// `?probe=genie-film-reorder`; without either, every hook is inert.
//
// Ownership: Genie.tsx emits the events and runs the reorder; the gates in
// instruments/genie-drain read them.

import { createRef } from 'react'
import type { PresentationReceipt, SourceUvRect } from '@petepetrash/munari'
import type { FrameDrawReceipt, FrameId, FrameSource } from '@petepetrash/munari/advanced'

export type GenieFilmProbeEvent =
  | {
      type: 'require'
      token: number
      direction: 'minimizing' | 'restoring'
      frame: FrameId
      presentationRevision: number
      source: FrameSource
      canvas: HTMLCanvasElement | null
      video: HTMLVideoElement | null
    }
  | { type: 'receipt'; token: number; receipt: FrameDrawReceipt }
  | {
      type: 'outer-anchor'
      token: number
      stage: 'before-reorder' | 'accepted'
      /** The outer source's paint count when this set was committed. */
      generation: number
      paintedSize: readonly [number, number]
      anchor: SourceUvRect
    }
  | { type: 'accept'; token: number; receipt: FrameDrawReceipt }
  | { type: 'present'; token: number; receipt: PresentationReceipt }
  | { type: 'show'; token: number; frame: FrameId }
  | { type: 'land'; token: number; wall: 0 | 1; frame?: FrameId }
  | { type: 'reveal'; token: number; frame: FrameId }
  | { type: 'release'; token: number; wall: 0 | 1 }
  | { type: 'revoke'; token: number; reason: 'renderer-lost' }

/** Hand one step of the film's handoff to whoever is watching. Nothing in
 *  the scene reads this; the hook is installed by a probe or by hand. */
export function probeFilm(event: GenieFilmProbeEvent): void {
  window.__genieFilmProbe?.(event)
}

export const REORDER_PROBE = new URLSearchParams(window.location.search).get('probe') === 'genie-film-reorder'
/** The film window's own sheet on the page, which the reorder probe edits
 *  the way an app edits its content. The capture holds a copy of it. */
export const filmPageSheet = createRef<HTMLDivElement>()
