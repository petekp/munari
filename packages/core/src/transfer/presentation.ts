// Presentation evidence — the predicate a handoff waits on.
//
// Drawing is not showing (decisions.md #25, #29): three calls
// onAfterRender for color-disabled materials and for off-screen render
// targets, so mesh traversal alone must never release another presenter.
// A transfer states its requirement — transferId, minimum source frame,
// exact presentation revision — and only a receipt earned by a
// color-writing draw to the default framebuffer can satisfy it. The
// consumer mints the transferId and revision; core only checks them. A
// newer generation may satisfy an older minimum, because publications
// merge before an upload. Everything else matches exactly, so a stale
// transfer, a different source, or a reused revision cannot release
// presentation authority.

import type { FrameId } from '../paint/frameSource'

/** The minimum source frame and exact presenter state one transfer needs. */
export interface PresentationRequirement {
  /** Minted by the consumer when a transfer starts. */
  readonly transferId: number
  readonly frame: FrameId
  /** Opaque to core. Monotonic within one presenter. */
  readonly presentationRevision: number
}

/** Evidence that one surface drew an acceptable presentation pass. */
export interface PresentationReceipt {
  readonly transferId: number
  readonly frame: FrameId
  readonly presentationRevision: number
  /** The binding-owned lifetime that produced this evidence. */
  readonly surfaceEpoch: number
}

/**
 * Test presentation evidence against the transfer that requested it.
 *
 * A newer source generation can satisfy an older minimum. Transfer,
 * source, and presentation revision must still match exactly.
 */
export function presentationReceiptSatisfies(
  requirement: PresentationRequirement,
  receipt: PresentationReceipt,
): boolean {
  return (
    receipt.transferId === requirement.transferId &&
    receipt.frame.sourceId === requirement.frame.sourceId &&
    receipt.frame.generation >= requirement.frame.generation &&
    receipt.presentationRevision === requirement.presentationRevision
  )
}
