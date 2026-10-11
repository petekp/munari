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
  presentationReceiptSatisfies,
  presentationRoute,
  type PresentationReceipt,
  type PresentationRequirement,
  type PresentationRoute,
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
// per-Surface — a write-free draw of the incoming group — and the route
// is how a pass reports which kind it was. Getting the answer wrong is a
// released page over pixels that never reached the screen.

const pass = (patch: Partial<SurfacePassEvidence> = {}): SurfacePassEvidence => ({
  defaultFramebuffer: true,
  colorWrite: true,
  depthWrite: true,
  stencilWrite: false,
  drawable: true,
  ...patch,
})

describe('presentationRoute', () => {
  const noColor = { colorWrite: false }
  const writeFree = { colorWrite: false, depthWrite: false, stencilWrite: false }
  const cases: ReadonlyArray<
    readonly [string, Partial<SurfacePassEvidence>, boolean, PresentationRoute]
  > = [
    ['nothing to draw proves nothing', { drawable: false }, true, 'empty'],
    // Emptiness outranks every other fact about the pass.
    ['nothing to draw, write-free', { drawable: false, ...writeFree }, true, 'empty'],
    ['nothing to draw, off-screen, no host', { drawable: false, defaultFramebuffer: false }, false, 'empty'],
    // The hole: an invisible mesh that writes depth or stencil still
    // subtracts itself from the visible scene behind it, so it is no warm-up.
    ['no color, depth, or stencil is a warm-up', writeFree, true, 'warm-up'],
    ['a warm-up into a target is still a warm-up', { ...writeFree, defaultFramebuffer: false }, false, 'warm-up'],
    ['color off with depth on is not a warm-up', { ...noColor, depthWrite: true, stencilWrite: false }, true, 'color-off'],
    ['color off with stencil on is not a warm-up', { ...noColor, depthWrite: false, stencilWrite: true }, true, 'color-off'],
    ['color off into a target is not a warm-up', { ...noColor, defaultFramebuffer: false }, true, 'color-off'],
    // The browser composites the default framebuffer this frame, so the
    // host's presence does not change the answer.
    ['color to the default framebuffer, with a host', {}, true, 'now'],
    ['color to the default framebuffer, without a host', {}, false, 'now'],
    // A post-processed scene draws every presenter into a target. Reading
    // that draw as presentation releases the page one frame early.
    ['color to a target defers to the host tail', { defaultFramebuffer: false }, true, 'tail'],
    ['color to a target with no host cannot present', { defaultFramebuffer: false }, false, 'no-host'],
  ]

  it.each(cases)('%s', (_name, patch, hasHost, expected) => {
    expect(presentationRoute(pass(patch), hasHost)).toBe(expected)
  })
})

describe('host-tail evidence', () => {
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
