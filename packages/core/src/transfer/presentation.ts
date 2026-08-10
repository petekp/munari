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
