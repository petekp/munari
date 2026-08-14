// The custody crossing contract.
//
// The crossing is the library's threshold guarantee: content moving
// between compositor custody (the DOM at rest) and canvas custody (a
// mesh wearing the capture) must never spend a frame in nobody's hands.
// Three scenes hand-rolled the protocol before it became law; this
// contract is what "became law" means. The reducer under test is pure —
// a whole crossing simulates as ticks — so every clause here walks real
// protocol time.

import { describe, expect, it } from 'vitest'
import {
  CROSSING_DEFAULTS,
  crossingAmplitude,
  crossingAtRest,
  crossingCustody,
  crossingFrame,
  crossingPresentation,
  crossingRequest,
  type CrossingEvidence,
  type CrossingPhase,
  type CrossingState,
} from '@munari/core'

const T = CROSSING_DEFAULTS
const PHASES: CrossingPhase[] = ['dom', 'lifting', 'renderer', 'landing']
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

describe('custody accounting', () => {
  it('someone presents in every phase — the guarantee in law form', () => {
    for (const phase of PHASES) {
      const { dom, renderer } = crossingCustody(phase)
      expect(dom || renderer).toBe(true)
    }
  })

  it('both present only during lifting: the warm-up is an overlap, not a swap', () => {
    for (const phase of PHASES) {
      const { dom, renderer } = crossingCustody(phase)
      expect(dom && renderer).toBe(phase === 'lifting')
    }
  })

  it('the DOM holds until evidence releases it, and not one phase longer', () => {
    expect(crossingCustody('dom').dom).toBe(true)
    expect(crossingCustody('lifting').dom).toBe(true)
    expect(crossingCustody('renderer').dom).toBe(false)
    expect(crossingCustody('landing').dom).toBe(false)
  })
})

describe('presentation accounting', () => {
  // Custody says who must DRAW; presentation says who may be SEEN.
  // Custody is inclusive (the lifting overlap), presentation exclusive:
  // two composited copies of the same content read as a ghost around
  // every animated element the moment the page's motion displaces one
  // off the other (the logo, 2026-08-14).
  it('exactly one side is composited in every phase — never zero, never both', () => {
    for (const phase of PHASES) {
      const { dom, renderer } = crossingPresentation(phase)
      expect(dom !== renderer).toBe(true)
    }
  })

  it('a composited side is always a drawing side: presentation implies custody', () => {
    for (const phase of PHASES) {
      const shown = crossingPresentation(phase)
      const drawn = crossingCustody(phase)
      if (shown.dom) expect(drawn.dom).toBe(true)
      if (shown.renderer) expect(drawn.renderer).toBe(true)
    }
  })

  it('the renderer draws unseen during lifting and only then — the warm-up is invisible', () => {
    for (const phase of PHASES) {
      const warmingUnseen =
        crossingCustody(phase).renderer && !crossingPresentation(phase).renderer
      expect(warmingUnseen).toBe(phase === 'lifting')
    }
  })

  it('visibility changes hands exactly twice per round trip: at the two swap edges', () => {
    let s = crossingAtRest()
    let presenter = 'dom'
    const handoffs: string[] = []
    const note = (phase: CrossingPhase) => {
      const now = crossingPresentation(phase).dom ? 'dom' : 'renderer'
      if (now !== presenter) handoffs.push(`${presenter}→${now}`)
      presenter = now
    }
    s = crossingRequest(s, true)
    note(s.phase)
    for (let i = 0; i < 500 && !(s.phase === 'renderer' && s.ramp >= 1); i++) {
      s = crossingFrame(s, ALL, 16, T)
      note(s.phase)
    }
    s = crossingRequest(s, false)
    note(s.phase)
    for (let i = 0; i < 500 && s.phase !== 'dom'; i++) {
      s = crossingFrame(s, ALL, 16, T)
      note(s.phase)
    }
    expect(s.phase).toBe('dom')
    expect(handoffs).toEqual(['dom→renderer', 'renderer→dom'])
  })
})

describe('requests', () => {
  it('walks the forward edge: dom → lifting on request, lifting → renderer only on evidence', () => {
    let s = crossingRequest(crossingAtRest(), true)
    expect(s.phase).toBe('lifting')
    // A request alone moves nothing further: frames without evidence hold.
    s = tickUntil(s, NONE, (x) => x.heldMs > T.settleMs * 3)
    expect(s.phase).toBe('lifting')
  })

  it('reverses from lifting back to dom — abandoning a warm-up is free because the DOM never released', () => {
    let s = crossingRequest(crossingAtRest(), true)
    s = crossingFrame(s, NONE, 100, T)
    s = crossingRequest(s, false)
    expect(s).toEqual(crossingAtRest())
  })

  it('reverses from landing back to renderer without re-proving — the canvas never released', () => {
    let s = crossingRequest(crossingAtRest(), true)
    s = tickUntil(s, ALL, (x) => x.phase === 'renderer')
    s = tickUntil(s, ALL, (x) => x.ramp >= 1)
    s = crossingRequest(s, false)
    // Part-way down, the user changes their mind.
    s = crossingFrame(s, ALL, T.rampMs / 3, T)
    const midRamp = s.ramp
    expect(midRamp).toBeGreaterThan(0)
    expect(midRamp).toBeLessThan(1)
    s = crossingRequest(s, true)
    expect(s.phase).toBe('renderer')
    // …and climbs again from where it was, never from a re-proven zero.
    expect(s.ramp).toBe(midRamp)
  })

  it('never skips: no single request crosses the whole threshold', () => {
    for (const phase of PHASES) {
      for (const want of [true, false]) {
        const s = crossingRequest({ phase, ramp: 0.5, heldMs: 0 }, want)
        const hop =
          Math.abs(PHASES.indexOf(s.phase) - PHASES.indexOf(phase))
        expect(hop).toBeLessThanOrEqual(1)
      }
    }
  })

  it('returns the identical state for a no-op ask, so callers can detect it by reference', () => {
    const rest = crossingAtRest()
    expect(crossingRequest(rest, false)).toBe(rest)
    const airborne: CrossingState = { phase: 'renderer', ramp: 1, heldMs: 0 }
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
    expect(s.phase).toBe('renderer')
  })

  it('keeps the ramp at exactly zero until the DOM has released', () => {
    let s = crossingRequest(crossingAtRest(), true)
    while (s.phase === 'lifting') {
      expect(s.ramp).toBe(0)
      s = crossingFrame(s, ALL, 16, T)
    }
    expect(s.phase).toBe('renderer')
    expect(s.ramp).toBe(0)
  })

  it('measures the dwell from the moment lifting began, not from the last receipt', () => {
    let s = crossingRequest(crossingAtRest(), true)
    // Dwell served with no evidence…
    s = tickUntil(s, NONE, (x) => x.heldMs >= T.settleMs)
    expect(s.phase).toBe('lifting')
    // …then the final receipt lands and the very next frame releases.
    s = crossingFrame(s, ALL, 16, T)
    expect(s.phase).toBe('renderer')
  })
})

describe('the ramp', () => {
  it('rises to exactly 1 over rampMs and stops', () => {
    let s: CrossingState = { phase: 'renderer', ramp: 0, heldMs: 0 }
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

  it('lands only at zero: the reverse swap happens at the one amplitude where mesh and page agree', () => {
    let s: CrossingState = { phase: 'landing', ramp: 1, heldMs: 0 }
    while (s.phase === 'landing') {
      expect(s.ramp).toBeGreaterThan(0)
      s = crossingFrame(s, ALL, 16, T)
    }
    expect(s).toEqual(crossingAtRest())
  })

  it('eases with smoothstep: zero velocity at both ends, half way at half ramp', () => {
    expect(crossingAmplitude(0)).toBe(0)
    expect(crossingAmplitude(1)).toBe(1)
    expect(crossingAmplitude(0.5)).toBe(0.5)
    const eps = 1e-4
    expect(crossingAmplitude(eps) / eps).toBeLessThan(0.01)
    expect((1 - crossingAmplitude(1 - eps)) / eps).toBeLessThan(0.01)
  })
})

describe('a whole crossing, both directions', () => {
  it('round-trips dom → renderer → dom with custody accounted on every frame', () => {
    let s = crossingAtRest()
    const observed = new Set<CrossingPhase>([s.phase])
    s = crossingRequest(s, true)
    for (let i = 0; i < 500 && !(s.phase === 'renderer' && s.ramp >= 1); i++) {
      observed.add(s.phase)
      const { dom, renderer } = crossingCustody(s.phase)
      expect(dom || renderer).toBe(true)
      // The forward swap frame: DOM releases only after evidence + dwell.
      if (!dom) expect(s.heldMs).toBeGreaterThanOrEqual(T.settleMs)
      s = crossingFrame(s, ALL, 16, T)
    }
    expect(s.phase).toBe('renderer')
    s = crossingRequest(s, false)
    for (let i = 0; i < 500 && s.phase !== 'dom'; i++) {
      observed.add(s.phase)
      const { dom, renderer } = crossingCustody(s.phase)
      expect(dom || renderer).toBe(true)
      s = crossingFrame(s, ALL, 16, T)
    }
    expect(s).toEqual(crossingAtRest())
    expect(observed).toEqual(new Set(['dom', 'lifting', 'renderer', 'landing']))
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
    s = tickUntil(s, ALL, (x) => x.phase === 'renderer' && x.ramp >= 1)
    expect(s.ramp).toBe(1)
  })
})
