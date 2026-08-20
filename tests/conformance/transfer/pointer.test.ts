// The pointer-ownership contract — who HEARS the pointer, per phase.
//
// Input follows the eye. The crossing already had two per-phase theorems —
// crossingDraws (who must draw) and crossingPresentation (who may be seen) —
// and input silently followed neither: the binding gave the canvas input the
// moment its mesh registered, a full settle dwell before presentation
// changed hands. Measured 2026-08-19 (gate:lifting-pointer): during
// 'lifting', 3/3 real clicks routed to the parked, hidden copy while the
// page copy was the presented one, and hover feedback was dead on the
// visible copy for the whole dwell — a click on visible content silently
// mutating a copy nobody can see. crossingPointer is the third theorem, and
// this contract pins it to the seen side in every phase (decisions.md #33).

import { describe, expect, it } from 'vitest'
import {
  crossingDraws,
  crossingPointer,
  crossingPresentation,
  type CrossingPhase,
} from '@munari/core'

const PHASES: CrossingPhase[] = ['page', 'lifting', 'gl', 'landing']

describe('pointer accounting', () => {
  it('exactly one side hears in every phase — never zero, never both', () => {
    // Zero is a dead click; both is the double-narration fault, one press
    // heard as two by two live copies of the same content.
    for (const phase of PHASES) {
      const { page, gl } = crossingPointer(phase)
      expect(page !== gl).toBe(true)
    }
  })

  it('the side that hears is the side that is seen, in every phase', () => {
    // The whole law. Any phase where these diverge is a click that lands on
    // content the user is not looking at.
    for (const phase of PHASES) {
      expect(crossingPointer(phase)).toEqual(crossingPresentation(phase))
    }
  })

  it('the page hears through lifting — the fault this law exists to forbid', () => {
    // During 'lifting' the canvas draws (warm, unseen) and its mesh is
    // registered, which is exactly the state that misrouted input before
    // this theorem. Drawing must not be hearing.
    expect(crossingPointer('lifting')).toEqual({ page: true, gl: false })
    expect(crossingDraws('lifting').gl).toBe(true)
  })

  it('the canvas hears through landing — the returning excursion is still on screen', () => {
    // Landing composites the canvas all the way to ramp zero, so input
    // stays with it until the page takes the pixels back.
    expect(crossingPointer('landing')).toEqual({ page: false, gl: true })
  })

  it('a hearing side is a drawing side: input implies pixels under it', () => {
    for (const phase of PHASES) {
      const hears = crossingPointer(phase)
      const draws = crossingDraws(phase)
      if (hears.page) expect(draws.page).toBe(true)
      if (hears.gl) expect(draws.gl).toBe(true)
    }
  })
})
