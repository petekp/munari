import { describe, expect, it } from 'vitest'
import {
  LOGO_DEFAULTS,
  LOGO_FONTS,
  LOGO_MATTERS,
  LOGO_PALETTE,
  RIPPLE,
  SLOT_FALLBACK_EM,
  SLOT_GAP_EM,
  STRETCH,
  WAVE_JITTER_MS,
  WAVE_STEP_MS,
  WEAVE,
  beatPlan,
  makeRng,
  nextBeat,
  rollPose,
  seedWord,
  slotLayout,
  springStep,
  strikeSlot,
  stretchAmount,
  waveSteps,
  type LetterPose,
} from './logoLaw'

const K = LOGO_DEFAULTS

describe('logo choreography (logoLaw)', () => {
  it('replays the same word from the same seed — a reroll is a take, not a mood', () => {
    const a = seedWord(6, makeRng(77), K)
    const b = seedWord(6, makeRng(77), K)
    expect(a).toEqual(b)
    expect(seedWord(6, makeRng(78), K)).not.toEqual(a)
  })

  it('never re-rolls a letter into the face, color, or matter it already wears', () => {
    const r = makeRng(1)
    let pose = rollPose(r, { fonts: [], colors: [], matters: [] }, K)
    for (let i = 0; i < 300; i++) {
      const next = rollPose(
        r,
        { fonts: [pose.font], colors: [pose.color], matters: [pose.matter] },
        K,
      )
      expect(next.font).not.toBe(pose.font)
      expect(next.color).not.toBe(pose.color)
      expect(next.matter).not.toBe(pose.matter)
      pose = next
    }
  })

  it('dodges the neighbors it was told about', () => {
    const r = makeRng(2)
    for (let i = 0; i < 300; i++) {
      const avoid = { fonts: [0, 3, 5], colors: [1, 2, 6], matters: [0, 2] }
      const pose = rollPose(r, avoid, K)
      expect(avoid.fonts).not.toContain(pose.font)
      expect(avoid.colors).not.toContain(pose.color)
      expect(avoid.matters).not.toContain(pose.matter)
    }
  })

  it('falls back to the full deck when over-constrained instead of throwing', () => {
    const r = makeRng(3)
    const all = {
      fonts: LOGO_FONTS.map((_, i) => i),
      colors: LOGO_PALETTE.map((_, i) => i),
      matters: LOGO_MATTERS.map((_, i) => i),
    }
    const pose = rollPose(r, all, K)
    expect(pose.font).toBeGreaterThanOrEqual(0)
    expect(pose.font).toBeLessThan(LOGO_FONTS.length)
    expect(pose.color).toBeGreaterThanOrEqual(0)
    expect(pose.color).toBeLessThan(LOGO_PALETTE.length)
    expect(pose.matter).toBeGreaterThanOrEqual(0)
    expect(pose.matter).toBeLessThan(LOGO_MATTERS.length)
  })

  it('only deals weights the chosen face actually ships', () => {
    const r = makeRng(4)
    for (let i = 0; i < 300; i++) {
      const pose = rollPose(r, { fonts: [], colors: [], matters: [] }, K)
      expect(LOGO_FONTS[pose.font].weights).toContain(pose.weight)
    }
  })

  it('keeps every pose inside the knobs that shaped it', () => {
    const r = makeRng(5)
    for (let i = 0; i < 300; i++) {
      const p = rollPose(r, { fonts: [], colors: [], matters: [] }, K)
      expect(Math.abs(p.tilt)).toBeLessThanOrEqual(K.tilt)
      expect(Math.abs(p.dx)).toBeLessThanOrEqual(K.drift)
      expect(Math.abs(p.dy)).toBeLessThanOrEqual(K.drift)
      expect(p.scale).toBeGreaterThanOrEqual(1 - K.squish)
      expect(p.scale).toBeLessThanOrEqual(1 + K.squish)
    }
  })

  it('seeds a word where no two neighbors share a face, color, or matter', () => {
    for (let seed = 10; seed < 40; seed++) {
      const word = seedWord(6, makeRng(seed), K)
      for (let i = 1; i < word.length; i++) {
        expect(word[i].font).not.toBe(word[i - 1].font)
        expect(word[i].color).not.toBe(word[i - 1].color)
        expect(word[i].matter).not.toBe(word[i - 1].matter)
      }
    }
  })
})

describe('the conductor', () => {
  it('swings the beat inside ±swing and never faster than the floor', () => {
    const r = makeRng(6)
    for (let i = 0; i < 300; i++) {
      const beat = nextBeat(r, K)
      expect(beat).toBeGreaterThanOrEqual(Math.max(120, K.tempo * (1 - K.swing)))
      expect(beat).toBeLessThanOrEqual(K.tempo * (1 + K.swing))
    }
  })

  it('lands an ordinary beat on exactly one letter, immediately', () => {
    const r = makeRng(7)
    const calm = { ...K, wave: 0 }
    for (let i = 0; i < 100; i++) {
      const plan = beatPlan(r, 6, calm)
      expect(plan).toHaveLength(1)
      expect(plan[0].delay).toBe(0)
      expect(plan[0].letter).toBeGreaterThanOrEqual(0)
      expect(plan[0].letter).toBeLessThan(6)
    }
  })

  it('sweeps a wave outward from one end — jitter loosens it, never reorders it', () => {
    const r = makeRng(8)
    for (let i = 0; i < 100; i++) {
      const steps = waveSteps(r, 6)
      expect(steps).toHaveLength(6)
      const origin = steps.find((s) => s.delay === 0)!.letter
      expect([0, 5]).toContain(origin)
      for (const s of steps) {
        const dist = Math.abs(s.letter - origin)
        if (dist === 0) continue
        expect(s.delay).toBeGreaterThanOrEqual(dist * WAVE_STEP_MS)
        expect(s.delay).toBeLessThanOrEqual(dist * WAVE_STEP_MS + WAVE_JITTER_MS)
      }
      // Farther letters always fire later: the sweep reads as a sweep.
      const byDist = [...steps].sort(
        (a, b) => Math.abs(a.letter - origin) - Math.abs(b.letter - origin),
      )
      for (let j = 1; j < byDist.length; j++) {
        expect(byDist[j].delay).toBeGreaterThan(byDist[j - 1].delay)
      }
    }
  })

  it('always waves when told to, never when told not to', () => {
    const eager = { ...K, wave: 1 }
    const never = { ...K, wave: 0 }
    expect(beatPlan(makeRng(9), 6, eager)).toHaveLength(6)
    expect(beatPlan(makeRng(9), 6, never)).toHaveLength(1)
  })
})

describe('the fixed grid', () => {
  it('lays slots left to right with the gap and no overlap', () => {
    const { slots, width } = slotLayout('munari')
    expect(slots).toHaveLength(6)
    for (let i = 1; i < slots.length; i++) {
      const prevEnd = slots[i - 1].left + slots[i - 1].width
      expect(slots[i].left).toBeCloseTo(prevEnd + SLOT_GAP_EM, 10)
    }
    const last = slots[slots.length - 1]
    expect(width).toBeCloseTo(last.left + last.width, 10)
  })

  it('gives an unknown glyph the fallback advance instead of zero', () => {
    const { slots } = slotLayout('mx')
    expect(slots[1].width).toBe(SLOT_FALLBACK_EM)
  })
})

describe('the matter spring', () => {
  it('settles on its target', () => {
    let x = 0
    let v = 0
    for (let i = 0; i < 600; i++) [x, v] = springStep(x, v, 100, 1 / 120)
    expect(x).toBeCloseTo(100, 1)
    expect(Math.abs(v)).toBeLessThan(0.5)
  })

  it('overshoots on the way — arrives with mass, not as a fade', () => {
    let x = 0
    let v = 0
    let peak = 0
    for (let i = 0; i < 600; i++) {
      ;[x, v] = springStep(x, v, 100, 1 / 120)
      peak = Math.max(peak, x)
    }
    expect(peak).toBeGreaterThan(100)
  })
})

describe('the motion rig', () => {
  it('ships the weave at identity', () => {
    // The scale and speed dials multiply the shipped weave's numbers
    // (WEAVE.lambda's em wavelengths, WEAVE.w's rad/s), so 1/1/0 must
    // reproduce the gel the letters wear — a drifted default would
    // restyle the idle look under every other clause.
    //
    // Re-pinned three times on 2026-08-14 — a rumble, then erratic
    // shaking, then no wave at all. The clauses below are why the
    // numbers moved each time; they are the report in arithmetic.
    expect(LOGO_DEFAULTS.waveScale).toBe(1)
    expect(LOGO_DEFAULTS.waveSpeed).toBe(1)
    expect(LOGO_DEFAULTS.waveAngle).toBe(0)
    expect(WEAVE.lambda).toEqual([1.4, 0.62])
    expect(WEAVE.w).toEqual([3.5, 5.1])
  })

  it('keeps the resting weave legible as a wave, not a rumble', () => {
    // A wave is legible when ONE crest visibly travels — and the
    // weave is a single field the whole word shares (uWaveOrigin), so
    // the unit that must hold the crests is the WORD, not the glyph.
    // Every floor here is font-free: WEAVE is em-scaled and
    // slotLayout speaks em.
    //
    // A swell can only march when the word holds at least two crests.
    expect(slotLayout('munari').width / WEAVE.lambda[0]).toBeGreaterThanOrEqual(2)
    // Steepness — the orbit radius over the wavelength, jelly × amp ×
    // 2π/λ — is the whole read: it is how far the surge rolls the
    // paint AND how hard the heave tilts the light. Below the floor
    // the wave is a rumour; above the ceiling the letters churn, and
    // at 1 the trochoid cusps.
    const steep = LOGO_DEFAULTS.jelly * WEAVE.amp * ((Math.PI * 2) / WEAVE.lambda[0])
    expect(steep).toBeGreaterThanOrEqual(0.15)
    expect(steep).toBeLessThanOrEqual(0.4)
  })


  it('recycles the deadest ring, never a fresher one', () => {
    // Drum on the buffer the way a hand would: every strike lands in
    // the slot with the SMALLEST birth time. Anything else retires a
    // ring mid-air while an older, dimmer one plays on.
    const births = Array.from({ length: RIPPLE.slots }, () => -1e3)
    for (let n = 0; n < 20; n++) {
      const t = n * 0.21
      const idx = strikeSlot(births)
      expect(births[idx]).toBe(Math.min(...births))
      births[idx] = t
    }
    expect(Math.min(...births)).toBeGreaterThan(20 * 0.21 - RIPPLE.slots * 0.21 - 1e-9)
  })

  it('holds every ring a drumming hand can see', () => {
    // The perceptual budget that sizes the buffer. At three strikes a
    // second — a comfortable drum — a ring stays readable until it
    // decays to ~20% of its struck height, tau·ln5 seconds. The
    // buffer must hold every ring still above that floor, or drumming
    // visibly deletes rings that are still playing.
    expect(3 * RIPPLE.tau * Math.log(5)).toBeLessThan(RIPPLE.slots)
  })

  it('keeps every crest wider than the sheet grid', () => {
    // The sheet steps a vertex every 4 CSS px (SHEET_STEP_PX). At the
    // lab's smallest font every wavelength — the ring's and both of
    // the weave's — must span several of those steps, or the grid
    // carries the crest as facets — the same Nyquist argument that
    // keeps the fine shoulder out of the mesh.
    expect(RIPPLE.lambda * 64).toBeGreaterThanOrEqual(6 * 4)
    expect(Math.min(...WEAVE.lambda) * 64).toBeGreaterThanOrEqual(6 * 4)
  })

  it('stretches with travel and saturates instead of tearing', () => {
    // Zero at rest — the handoff identity's half of the contract —
    // then monotone with speed, and never past STRETCH.max: a throw
    // reads as fast, not as taffy.
    expect(stretchAmount(0)).toBe(0)
    let last = 0
    for (const speed of [60, 150, 300, 600, 1200, 2400, 9600]) {
      const s = stretchAmount(speed)
      expect(s).toBeGreaterThan(last)
      last = s
    }
    expect(last).toBeLessThan(STRETCH.max)
    // The knee sits at ref: half the ceiling exactly, so the curve is
    // in its expressive range at real hand speeds.
    expect(stretchAmount(STRETCH.ref)).toBeCloseTo(STRETCH.max / 2, 10)
  })

  it('cannot read travel from a pixel-snapped position', () => {
    // Why the feed differentiates the UNSNAPPED position (Logo.tsx).
    // A letter's placement is rounded onto the device pixel grid to
    // keep the glyph crisp, so differencing THAT measures the
    // rounding, not the motion: a half-CSS-px quantum at dpr 2,
    // landing or not landing on each frame, is a square wave of
    // half the refresh rate in px/s.
    //
    // It is a bug only because the stretch is sensitive down there —
    // this clause pins that it is. If the rounding noise squashed a
    // letter by under a tenth of the ceiling, the trap would be
    // theoretical; at 120 Hz it squashes by about four percent, on
    // an axis the same noise re-aims every frame, which is a visible
    // frame-rate shimmer (2026-08-15).
    const noise = 0.5 * 120
    expect(stretchAmount(noise)).toBeGreaterThan(STRETCH.max / 10)
  })
})

// Shared sanity: the constraint model needs headroom. Six letters where
// each dodges its own current value plus two neighbors consumes at most
// 3 fonts, 3 colors, and 3 matters — every deck must keep at least one
// card open.
describe('the decks', () => {
  it('leave the rng a real choice under the worst constraint', () => {
    expect(LOGO_FONTS.length).toBeGreaterThan(3)
    expect(LOGO_PALETTE.length).toBeGreaterThan(3)
    expect(LOGO_MATTERS.length).toBeGreaterThan(3)
  })

  it('agree with the poses they deal', () => {
    const word: LetterPose[] = seedWord(6, makeRng(11), K)
    for (const p of word) {
      expect(LOGO_FONTS[p.font]).toBeDefined()
      expect(LOGO_PALETTE[p.color]).toBeDefined()
      expect(LOGO_MATTERS[p.matter]).toBeDefined()
    }
  })
})
