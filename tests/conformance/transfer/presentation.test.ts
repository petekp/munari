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
  presentationReceiptSatisfies,
  type PresentationReceipt,
  type PresentationRequirement,
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
