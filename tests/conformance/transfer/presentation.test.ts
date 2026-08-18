// The receipt predicate — what may release a presenter, pinned.
//
// A handoff that swaps presenters on the wrong evidence shows a hole or
// a doubled image on a real screen (decisions.md #25–#27). Each
// rejection below is one wrong-release shape: an older generation (the
// draw used pixels from before the ones the transfer promised), a stale
// transferId (evidence from an abandoned transfer), a different source
// (the right revision from the wrong canvas), a reused or future
// revision. The one asymmetry is deliberate: a NEWER generation from
// the required source satisfies an older minimum, because several
// publications may merge into one upload and a receipt names only the
// frame that was actually uploaded.

import { describe, expect, it } from 'vitest'

import {
  hostTailPresents,
  passIsWarmUp,
  passNeedsHostTail,
  passPresentsDirectly,
  presentationReceiptSatisfies,
  type PresentationReceipt,
  type PresentationRequirement,
  type SurfacePassEvidence,
} from '@munari/core'

const requirement: PresentationRequirement = {
  transferId: 12,
  frame: { sourceId: 4, generation: 8 },
  presentationRevision: 23,
}

const receipt = (
  patch: Partial<PresentationReceipt> = {},
): PresentationReceipt => ({
  transferId: 12,
  frame: { sourceId: 4, generation: 8 },
  presentationRevision: 23,
  surfaceEpoch: 7,
  ...patch,
})

describe('presentationReceiptSatisfies', () => {
  it('accepts an exact receipt', () => {
    expect(presentationReceiptSatisfies(requirement, receipt())).toBe(true)
  })

  it('accepts a newer generation from the required source', () => {
    expect(
      presentationReceiptSatisfies(
        requirement,
        receipt({ frame: { sourceId: 4, generation: 11 } }),
      ),
    ).toBe(true)
  })

  it('rejects an older generation from the required source', () => {
    expect(
      presentationReceiptSatisfies(
        requirement,
        receipt({ frame: { sourceId: 4, generation: 7 } }),
      ),
    ).toBe(false)
  })

  it('rejects a stale transfer', () => {
    expect(
      presentationReceiptSatisfies(requirement, receipt({ transferId: 11 })),
    ).toBe(false)
  })

  it('rejects a different source even when its generation is newer', () => {
    expect(
      presentationReceiptSatisfies(
        requirement,
        receipt({ frame: { sourceId: 5, generation: 100 } }),
      ),
    ).toBe(false)
  })

  it('rejects a stale or newer presentation revision', () => {
    expect(
      presentationReceiptSatisfies(
        requirement,
        receipt({ presentationRevision: 22 }),
      ),
    ).toBe(false)
    expect(
      presentationReceiptSatisfies(
        requirement,
        receipt({ presentationRevision: 24 }),
      ),
    ).toBe(false)
  })
})

// ── what one draw pass was ───────────────────────────────────────────────
// Several Surfaces share one composited canvas, so canvas opacity cannot
// hide one warming Surface while the others stay visible. The warm-up is
// per-Surface — a write-free draw of the incoming group — and these three
// predicates are how a pass reports which kind it was. Getting the answer
// wrong is a released page over pixels that never reached the screen.

const pass = (patch: Partial<SurfacePassEvidence> = {}): SurfacePassEvidence => ({
  defaultFramebuffer: true,
  colorWrite: true,
  depthWrite: true,
  stencilWrite: false,
  ...patch,
})

describe('warm-up passes', () => {
  it('a pass with no color, depth, or stencil write is a warm-up', () => {
    expect(
      passIsWarmUp(pass({ colorWrite: false, depthWrite: false, stencilWrite: false })),
    ).toBe(true)
  })

  it('a color-disabled pass that still writes depth is not a warm-up', () => {
    // This is the hole. An invisible mesh that writes depth occludes the
    // visible scene behind it, so the Surface warming up is subtracted from
    // a frame it was supposed to leave untouched.
    expect(passIsWarmUp(pass({ colorWrite: false, depthWrite: true, stencilWrite: false }))).toBe(
      false,
    )
    expect(passIsWarmUp(pass({ colorWrite: false, depthWrite: false, stencilWrite: true }))).toBe(
      false,
    )
  })

  it('a warm-up never presents, by either route', () => {
    const warm = pass({ colorWrite: false, depthWrite: false, stencilWrite: false })
    expect(passPresentsDirectly(warm)).toBe(false)
    expect(passNeedsHostTail(warm)).toBe(false)
  })
})

describe('presenter and host-tail evidence', () => {
  it('color into the default framebuffer presents directly', () => {
    expect(passPresentsDirectly(pass())).toBe(true)
    expect(passNeedsHostTail(pass())).toBe(false)
  })

  it('color into an off-screen target defers to the host tail', () => {
    // A post-processed scene draws every presenter into a target. Reading
    // that draw as presentation releases the page one frame early, and the
    // seam appears only once a consumer adds an effect composer to a scene
    // that worked yesterday.
    const deferred = pass({ defaultFramebuffer: false })
    expect(passPresentsDirectly(deferred)).toBe(false)
    expect(passNeedsHostTail(deferred)).toBe(true)
  })

  it('the host tail closes presentation only when the frame reached the screen', () => {
    expect(hostTailPresents({ deferred: 2, reachedScreen: true })).toBe(true)
    // The composite pass was skipped, or the context was lost: nothing was
    // shown, so nothing is proven.
    expect(hostTailPresents({ deferred: 2, reachedScreen: false })).toBe(false)
  })

  it('a tail with nothing deferred proves nothing', () => {
    // Every frame ends with a draw to the screen. Only a frame that
    // actually carried a deferred presenter closes that presenter's proof.
    expect(hostTailPresents({ deferred: 0, reachedScreen: true })).toBe(false)
  })
})
