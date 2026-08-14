import { describe, expect, it } from 'vitest'
import {
  LOGO_DEFAULTS,
  LOGO_FONTS,
  LOGO_MATTERS,
  LOGO_PALETTE,
  SLOT_FALLBACK_EM,
  SLOT_GAP_EM,
  WAVE_JITTER_MS,
  WAVE_STEP_MS,
  beatPlan,
  makeRng,
  nextBeat,
  rollPose,
  seedWord,
  slotLayout,
  springStep,
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
