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

// ── what one draw pass was ───────────────────────────────────────────────
// Several Surfaces share one composited canvas, so canvas opacity cannot
// hide a warming Surface while other Surfaces' pixels stay visible. The
// warm-up is per-Surface instead: the incoming group is drawn with color,
// depth, and stencil writes disabled, which may compile its program and
// upload its texture but cannot punch a hole in the scene around it. The
// three predicates below are how a pass says which of those it was.

/** What the renderer was doing when it drew one presenter. */
export interface SurfacePassEvidence {
  /** The pass targeted the default framebuffer, not an off-screen target. */
  readonly defaultFramebuffer: boolean
  /** The material wrote color. A write-free warm-up does not. */
  readonly colorWrite: boolean
  /** Depth writes were enabled. A warm-up disables these too. */
  readonly depthWrite: boolean
  /** Stencil writes were enabled. A warm-up disables these too. */
  readonly stencilWrite: boolean
}

/**
 * A warm-up pass: no color, no depth, no stencil. It is allowed to run
 * while another renderer still holds the pixels, and it proves nothing.
 *
 * All three writes must be off. A pass that disabled color but left depth
 * on still occludes visible matter behind it, which is the hole the
 * shared-canvas warm-up exists to avoid.
 */
export function passIsWarmUp(pass: SurfacePassEvidence): boolean {
  return !pass.colorWrite && !pass.depthWrite && !pass.stencilWrite
}

/**
 * The pass proves presentation on its own: color reached the default
 * framebuffer, so the browser will composite these pixels this frame and
 * the outgoing renderer may release inside the post-draw callback.
 */
export function passPresentsDirectly(pass: SurfacePassEvidence): boolean {
  return pass.defaultFramebuffer && pass.colorWrite
}

/**
 * The pass wrote color into an off-screen target. A post-processed scene
 * draws every presenter this way, so the presenter's own post-draw callback
 * is NOT a presentation boundary — the frame has not reached the screen and
 * a composite pass could still discard it. Presentation for such a pass is
 * closed by the host's tail (`hostTailPresents`) at the end of the frame.
 *
 * Reading a target draw as presentation is the expensive version of this
 * mistake: the page releases one frame early, and the seam appears only in
 * scenes that have post-processing — which is to say, only after a consumer
 * adds an effect composer to a Surface scene that worked yesterday.
 */
export function passNeedsHostTail(pass: SurfacePassEvidence): boolean {
  return !pass.defaultFramebuffer && pass.colorWrite
}

/** What the host saw at the end of one rendered frame. */
export interface SurfaceHostTail {
  /** Presenters that wrote color into a target during this frame. */
  readonly deferred: number
  /** The frame ended with a color-writing draw to the default framebuffer. */
  readonly reachedScreen: boolean
}

/**
 * Does the host's tail close presentation for the passes that deferred to
 * it? A frame whose deferred presenters never reached the screen — the
 * composite pass was skipped, the renderer bailed, the context was lost —
 * closes nothing, and every deferred presenter stays unproven.
 */
export function hostTailPresents(tail: SurfaceHostTail): boolean {
  return tail.deferred > 0 && tail.reachedScreen
}
