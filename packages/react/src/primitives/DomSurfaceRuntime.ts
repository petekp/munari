import type {
  DomPaintReceipt,
  DomTextureSource,
  FrameId,
  PresentationReceipt,
  PresentationRequirement,
} from '@munari/core'
import { presentationReceiptSatisfies } from '@munari/core'
import type { FrameDrawReceipt } from './FrameSurface'

export interface DomSurfaceRuntime {
  readonly source: DomTextureSource
  readonly surfaceEpoch: number
  recordUpload(): DomPaintReceipt | null
  takeDrawReceipt(): FrameDrawReceipt | null
  beginPresentationPass(
    requirement: PresentationRequirement | undefined,
    outputEligible: boolean,
    colorWrite: boolean,
    warn?: (message: string) => void,
  ): void
  takePresentationReceipt(warn?: (message: string) => void): PresentationReceipt | null
  rejectedPresentationDraws(transferId: number): number
  dispose(): void
}

const frameKey = (frame: FrameId) => `${frame.sourceId}:${frame.generation}`

/** Renderer-order ledger for DOM Surface, split out for mock-free tests. */
export function createDomSurfaceRuntime(
  source: DomTextureSource,
  surfaceEpoch: number,
  invalidate: () => void,
  onPainted: (receipt: DomPaintReceipt) => void,
): DomSurfaceRuntime {
  let active = true
  let pendingFrame: FrameId | null = null
  let lastUploadedFrame: FrameId | null = null
  let pendingPresentation: PresentationRequirement | null = null
  let lastPublishedGeneration = 0
  const drawn = new Set<string>()
  const presented = new Set<string>()
  const rejected = new Map<number, number>()
  const warned = new Set<number>()

  const publishPaint = (receipt: DomPaintReceipt) => {
    if (!active || receipt.frame.generation <= lastPublishedGeneration) return
    lastPublishedGeneration = receipt.frame.generation
    onPainted(receipt)
    // The callback runs first so responsive consumers can commit matching
    // geometry before the demand frame this invalidation requests.
    invalidate()
  }

  const unsubscribe = source.subscribePaint(publishPaint)
  // createDomTextureSource requests its first paint before returning. The
  // platform is deferred today, but this closes a possible first-paint race.
  const existing = source.currentPaint()
  if (existing) publishPaint(existing)

  const rejectPresentation = (
    requirement: PresentationRequirement,
    reason: string,
    warn?: (message: string) => void,
  ) => {
    const count = (rejected.get(requirement.transferId) ?? 0) + 1
    rejected.set(requirement.transferId, count)
    if (!warn || warned.has(requirement.transferId)) return
    warned.add(requirement.transferId)
    warn(
      `munari: Surface transfer ${requirement.transferId} rejected a presentation draw (${reason})`,
    )
  }

  return {
    source,
    surfaceEpoch,
    recordUpload() {
      if (!active) return null
      const receipt = source.currentPaint()
      if (!receipt) return null
      const frame = receipt.frame
      lastUploadedFrame = frame
      if (!drawn.has(frameKey(frame))) pendingFrame = frame
      return receipt
    },
    takeDrawReceipt() {
      if (!active || !pendingFrame) return null
      const frame = pendingFrame
      pendingFrame = null
      const key = frameKey(frame)
      if (drawn.has(key)) return null
      drawn.add(key)
      return { surfaceEpoch, frame }
    },
    beginPresentationPass(requirement, outputEligible, colorWrite, warn) {
      pendingPresentation = null
      if (!active || !requirement) return
      if (!outputEligible) {
        rejectPresentation(requirement, 'off-screen render target', warn)
        return
      }
      if (!colorWrite) {
        rejectPresentation(requirement, 'material color writes are disabled', warn)
        return
      }
      pendingPresentation = requirement
    },
    takePresentationReceipt(warn) {
      if (!active || !pendingPresentation) return null
      const requirement = pendingPresentation
      pendingPresentation = null
      if (!lastUploadedFrame) {
        rejectPresentation(requirement, 'no uploaded paint', warn)
        return null
      }
      const receipt: PresentationReceipt = {
        transferId: requirement.transferId,
        frame: lastUploadedFrame,
        presentationRevision: requirement.presentationRevision,
        surfaceEpoch,
      }
      if (!presentationReceiptSatisfies(requirement, receipt)) {
        rejectPresentation(requirement, 'uploaded paint does not satisfy the requirement', warn)
        return null
      }
      const key = [
        receipt.surfaceEpoch,
        receipt.transferId,
        receipt.presentationRevision,
        receipt.frame.sourceId,
        receipt.frame.generation,
      ].join(':')
      if (presented.has(key)) return null
      presented.add(key)
      return receipt
    },
    rejectedPresentationDraws(transferId) {
      return rejected.get(transferId) ?? 0
    },
    dispose() {
      if (!active) return
      active = false
      pendingFrame = null
      lastUploadedFrame = null
      pendingPresentation = null
      drawn.clear()
      presented.clear()
      rejected.clear()
      warned.clear()
      unsubscribe()
    },
  }
}
