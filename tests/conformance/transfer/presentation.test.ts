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
