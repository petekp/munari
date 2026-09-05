// The crossing contract.
//
// The crossing is the library's threshold guarantee: content moving
// between the page's hold (the DOM at rest) and the canvas's hold (a
// mesh wearing the capture) must never spend a frame in nobody's hands.
// Independent consumers repeated the protocol before it became law. The
// reducer under test is pure —
// a whole crossing simulates as ticks — so every clause here walks real
// protocol time.

import { describe, expect, it } from 'vitest'
import {
  CROSSING_DEFAULTS,
  crossingAtRest,
  crossingDraws,
  crossingFrame,
  crossingPresentation,
  crossingProgress,
  crossingRequest,
  type CrossingEvidence,
  type CrossingPhase,
  type CrossingState,
} from '@munari/core'

const T = CROSSING_DEFAULTS
const PHASES: CrossingPhase[] = ['page', 'lifting', 'gl', 'landing']
const ALL: CrossingEvidence = { presented: 6, required: 6 }
const NONE: CrossingEvidence = { presented: 0, required: 6 }

/** Tick the reducer at a fixed frame rate until a predicate holds. */
function tickUntil(
  state: CrossingState,
  evidence: CrossingEvidence,
  done: (s: CrossingState) => boolean,
  dtMs = 16,
  maxFrames = 500,
): CrossingState {
  for (let i = 0; i < maxFrames; i++) {
    if (done(state)) return state
    state = crossingFrame(state, evidence, dtMs, T)
  }
  throw new Error(`protocol never reached the expected state: ${JSON.stringify(state)}`)
}

describe('drawing accounting', () => {
  it('someone draws in every phase — the guarantee in law form', () => {
    for (const phase of PHASES) {
      const { page, gl } = crossingDraws(phase)
      expect(page || gl).toBe(true)
    }
  })

  it('both draw only during lifting: the warm-up is an overlap, not a swap', () => {
    for (const phase of PHASES) {
      const { page, gl } = crossingDraws(phase)
      expect(page && gl).toBe(phase === 'lifting')
    }
  })

  it('the page holds until evidence releases it, and not one phase longer', () => {
    expect(crossingDraws('page').page).toBe(true)
    expect(crossingDraws('lifting').page).toBe(true)
    expect(crossingDraws('gl').page).toBe(false)
    expect(crossingDraws('landing').page).toBe(false)
  })
})

describe('presentation accounting', () => {
  // Drawing says who must DRAW; presentation says who may be SEEN.
  // Drawing is inclusive (the lifting overlap), presentation exclusive:
  // two composited copies of the same content read as a ghost around
  // every animated element the moment the page's motion displaces one
  // off the other (decisions.md #29).
  it('exactly one side is composited in every phase — never zero, never both', () => {
    for (const phase of PHASES) {
      const { page, gl } = crossingPresentation(phase)
      expect(page !== gl).toBe(true)
    }
  })

  it('a composited side is always a drawing side: presentation implies drawing', () => {
    for (const phase of PHASES) {
      const shown = crossingPresentation(phase)
      const drawn = crossingDraws(phase)
      if (shown.page) expect(drawn.page).toBe(true)
      if (shown.gl) expect(drawn.gl).toBe(true)
    }
  })

  it('the canvas draws unseen during lifting and only then — the warm-up is invisible', () => {
    for (const phase of PHASES) {
      const warmingUnseen = crossingDraws(phase).gl && !crossingPresentation(phase).gl
      expect(warmingUnseen).toBe(phase === 'lifting')
    }
  })

  it('visibility changes hands exactly twice per round trip: at the two handoff edges', () => {
    let s = crossingAtRest()
    let presenter = 'page'
    const handoffs: string[] = []
    const note = (phase: CrossingPhase) => {
      const now = crossingPresentation(phase).page ? 'page' : 'gl'
      if (now !== presenter) handoffs.push(`${presenter}→${now}`)
      presenter = now
    }
    s = crossingRequest(s, true)
    note(s.phase)
    for (let i = 0; i < 500 && !(s.phase === 'gl' && s.ramp >= 1); i++) {
      s = crossingFrame(s, ALL, 16, T)
      note(s.phase)
    }
    s = crossingRequest(s, false)
    note(s.phase)
    for (let i = 0; i < 500 && s.phase !== 'page'; i++) {
      s = crossingFrame(s, ALL, 16, T)
      note(s.phase)
    }
    expect(s.phase).toBe('page')
    expect(handoffs).toEqual(['page→gl', 'gl→page'])
  })
})

describe('requests', () => {
  it('walks the forward edge: page → lifting on request, lifting → gl only on evidence', () => {
    let s = crossingRequest(crossingAtRest(), true)
    expect(s.phase).toBe('lifting')
    // A request alone moves nothing further: frames without evidence hold.
    s = tickUntil(s, NONE, (x) => x.heldMs > T.settleMs * 3)
    expect(s.phase).toBe('lifting')
  })

  it('reverses from lifting back to page — abandoning a warm-up is free because the page never released', () => {
    let s = crossingRequest(crossingAtRest(), true)
    s = crossingFrame(s, NONE, 100, T)
    s = crossingRequest(s, false)
    expect(s).toEqual(crossingAtRest())
  })

  it('reverses from landing back to gl without re-proving — the canvas never released', () => {
    let s = crossingRequest(crossingAtRest(), true)
    s = tickUntil(s, ALL, (x) => x.phase === 'gl')
    s = tickUntil(s, ALL, (x) => x.ramp >= 1)
    s = crossingRequest(s, false)
    // Part-way down, the user changes their mind.
    s = crossingFrame(s, ALL, T.rampMs / 3, T)
    const midRamp = s.ramp
    expect(midRamp).toBeGreaterThan(0)
    expect(midRamp).toBeLessThan(1)
    s = crossingRequest(s, true)
    expect(s.phase).toBe('gl')
    // …and climbs again from where it was, never from a re-proven zero.
    expect(s.ramp).toBe(midRamp)
  })

  it('never skips: no single request crosses the whole threshold', () => {
    for (const phase of PHASES) {
      for (const want of [true, false]) {
        const s = crossingRequest({ phase, ramp: 0.5, heldMs: 0 }, want)
        const hop = Math.abs(PHASES.indexOf(s.phase) - PHASES.indexOf(phase))
        expect(hop).toBeLessThanOrEqual(1)
      }
    }
  })

  it('returns the identical state for a no-op ask, so callers can detect it by reference', () => {
    const rest = crossingAtRest()
    expect(crossingRequest(rest, false)).toBe(rest)
    const airborne: CrossingState = { phase: 'gl', ramp: 1, heldMs: 0 }
    expect(crossingRequest(airborne, true)).toBe(airborne)
  })
})

describe('the lift gate', () => {
  it('holds while any presenter is unproven, however long the dwell', () => {
    let s = crossingRequest(crossingAtRest(), true)
    s = tickUntil(s, { presented: 5, required: 6 }, (x) => x.heldMs > T.settleMs * 4)
    expect(s.phase).toBe('lifting')
  })

  it('holds through the settle dwell even with all presenters proven — the page must ease flat', () => {
    let s = crossingRequest(crossingAtRest(), true)
    // Evidence complete almost immediately; the dwell still governs.
    s = crossingFrame(s, ALL, T.settleMs - 20, T)
    expect(s.phase).toBe('lifting')
    s = crossingFrame(s, ALL, 20, T)
    expect(s.phase).toBe('gl')
  })

  it('keeps the ramp at exactly zero until the page has released', () => {
    let s = crossingRequest(crossingAtRest(), true)
    while (s.phase === 'lifting') {
      expect(s.ramp).toBe(0)
      s = crossingFrame(s, ALL, 16, T)
    }
    expect(s.phase).toBe('gl')
    expect(s.ramp).toBe(0)
  })

  it('measures the dwell from the moment lifting began, not from the last receipt', () => {
    let s = crossingRequest(crossingAtRest(), true)
    // Dwell served with no evidence…
    s = tickUntil(s, NONE, (x) => x.heldMs >= T.settleMs)
    expect(s.phase).toBe('lifting')
    // …then the final receipt lands and the very next frame releases.
    s = crossingFrame(s, ALL, 16, T)
    expect(s.phase).toBe('gl')
  })

  it('refuses a content-less lift: zero evidence does not read as proven', () => {
    // A crossing with nothing to prove (`required` is zero) has declared no
    // content; `0 >= 0` must not complete the lift (decisions.md #37). The
    // binding's request gate holds an empty Surface out of 'lifting' in the
    // first place; this is the gate's own refusal of the empty case.
    let s = crossingRequest(crossingAtRest(), true)
    expect(s.phase).toBe('lifting')
    s = tickUntil(s, { presented: 0, required: 0 }, (x) => x.heldMs >= T.settleMs * 3)
    expect(s.phase).toBe('lifting')
    expect(s.ramp).toBe(0)
  })

  it('a lone required presenter still completes the lift', () => {
    // Guard against over-refusal: a crossing that requires one presenter and
    // has proven it must still land. `required > 0` reads a single presenter
    // as content; a part-set-completeness predicate would have refused it.
    let s = crossingRequest(crossingAtRest(), true)
    s = tickUntil(s, { presented: 1, required: 1 }, (x) => x.phase === 'gl')
    expect(s.phase).toBe('gl')
  })
})

describe('the ramp', () => {
  it('rises to exactly 1 over rampMs and stops', () => {
    let s: CrossingState = { phase: 'gl', ramp: 0, heldMs: 0 }
    let elapsed = 0
    while (s.ramp < 1) {
      s = crossingFrame(s, ALL, 16, T)
      elapsed += 16
      expect(s.ramp).toBeLessThanOrEqual(1)
    }
    expect(elapsed).toBeGreaterThanOrEqual(T.rampMs)
    expect(elapsed).toBeLessThanOrEqual(T.rampMs + 32)
    expect(crossingFrame(s, ALL, 16, T).ramp).toBe(1)
  })

  it('lands only at zero: the reverse handoff happens at the one progress where mesh and page agree', () => {
    let s: CrossingState = { phase: 'landing', ramp: 1, heldMs: 0 }
    while (s.phase === 'landing') {
      expect(s.ramp).toBeGreaterThan(0)
      s = crossingFrame(s, ALL, 16, T)
    }
    expect(s).toEqual(crossingAtRest())
  })

  it('eases with smoothstep: zero velocity at both ends, half way at half ramp', () => {
    expect(crossingProgress(0)).toBe(0)
    expect(crossingProgress(1)).toBe(1)
    expect(crossingProgress(0.5)).toBe(0.5)
    const eps = 1e-4
    expect(crossingProgress(eps) / eps).toBeLessThan(0.01)
    expect((1 - crossingProgress(1 - eps)) / eps).toBeLessThan(0.01)
  })
})

describe('a whole crossing, both directions', () => {
  it('round-trips page → gl → page with the drawing law honored on every frame', () => {
    let s = crossingAtRest()
    const observed = new Set<CrossingPhase>([s.phase])
    s = crossingRequest(s, true)
    for (let i = 0; i < 500 && !(s.phase === 'gl' && s.ramp >= 1); i++) {
      observed.add(s.phase)
      const { page, gl } = crossingDraws(s.phase)
      expect(page || gl).toBe(true)
      // The forward handoff frame: the page releases only after evidence + dwell.
      if (!page) expect(s.heldMs).toBeGreaterThanOrEqual(T.settleMs)
      s = crossingFrame(s, ALL, 16, T)
    }
    expect(s.phase).toBe('gl')
    s = crossingRequest(s, false)
    for (let i = 0; i < 500 && s.phase !== 'page'; i++) {
      observed.add(s.phase)
      const { page, gl } = crossingDraws(s.phase)
      expect(page || gl).toBe(true)
      s = crossingFrame(s, ALL, 16, T)
    }
    expect(s).toEqual(crossingAtRest())
    expect(observed).toEqual(new Set(['page', 'lifting', 'gl', 'landing']))
  })

  it('survives an indecisive user: rapid reversals stay inside the four phases and re-arrive cleanly', () => {
    let s = crossingAtRest()
    // A fixed flip pattern (law files cannot use randomness sources, and a
    // contract should not): flip every 5 frames for 60 frames, then commit.
    for (let i = 0; i < 60; i++) {
      if (i % 5 === 0) s = crossingRequest(s, (i / 5) % 2 === 0)
      s = crossingFrame(s, ALL, 16, T)
      expect(PHASES).toContain(s.phase)
      expect(s.ramp).toBeGreaterThanOrEqual(0)
      expect(s.ramp).toBeLessThanOrEqual(1)
    }
    s = crossingRequest(s, true)
    s = tickUntil(s, ALL, (x) => x.phase === 'gl' && x.ramp >= 1)
    expect(s.ramp).toBe(1)
  })
})
