import { describe, expect, it } from 'vitest'
import {
  AUDIBLE_ARRIVAL,
  BAT_HZ,
  MM_PER_PX,
  PAN_MAX,
  SLAB_HZ,
  leverVoice,
  panFor,
  ringDecay,
  ringHz,
} from './knobsAudio'
import { KNOB, TOGGLE } from './knobsGeometry'
import { LEVER_SPRING, LEVER_THROW } from './knobsPhysics'

// Only the law is pinned here. The Web Audio graph needs a browser and a
// user gesture, and a test that mocked both would pin the mock. What a
// test CAN hold is the thing that actually breaks: the sound drifting
// away from the hardware it is supposed to be the sound of.

describe('the scene scale', () => {
  it('a rotary is 20 mm across, which is what sizes everything else', () => {
    expect(KNOB.skirtRadius * 2 * MM_PER_PX).toBeCloseTo(20, 9)
  })

  it('the bat is a small part — under a centimetre', () => {
    const batMm = TOGGLE.leverLength * MM_PER_PX
    expect(batMm).toBeGreaterThan(5)
    expect(batMm).toBeLessThan(10)
  })
})

describe('ringing — bigger parts sound lower, tighter parts die sooner', () => {
  it('frequency goes as 1/size', () => {
    expect(ringHz(5)).toBeCloseTo(ringHz(10) * 2, 9)
    expect(ringHz(20)).toBeCloseTo(ringHz(10) / 2, 9)
  })

  it('the decay is the same number of cycles for the same Q', () => {
    // τ = Q/(πf), so τ·f is Q/π whatever the note. Same material, same
    // ring — which is the whole reason Q is the only per-part choice.
    expect(ringDecay(400, 20) * 400).toBeCloseTo(ringDecay(4000, 20) * 4000, 9)
  })

  it('a damper part rings shorter at the same pitch', () => {
    expect(ringDecay(1000, 5)).toBeLessThan(ringDecay(1000, 50))
  })
})

describe('the sound comes from where the panel is', () => {
  it('a panel left of centre is heard on the left, and right on the right', () => {
    // The sign is the whole law and the easy thing to invert. NDC is
    // negative to the left, and a stereo pan is negative to the left, so
    // the two agree and nothing here should ever flip them.
    expect(panFor(-0.8)).toBeLessThan(0)
    expect(panFor(0.8)).toBeGreaterThan(0)
  })

  it('the middle of the glass is both speakers', () => {
    expect(panFor(0)).toBe(0)
  })

  it('the edge of the glass is not the edge of the field', () => {
    // A panel parked against the right edge must still be inside the
    // pair. Hard panning is what makes a room sound like a headphone
    // demo instead of an object on a desk.
    expect(Math.abs(panFor(1))).toBeLessThan(0.8)
    expect(Math.abs(panFor(1))).toBeGreaterThan(0.3)
  })

  it('a panel carried off the glass stops panning at the edge', () => {
    // A carry gesture can drag the panel past NDC ±1. StereoPanner
    // clamps anyway, but then the far edge and twice the far edge would
    // be indistinguishable here — so the clamp is ours, and pinned.
    expect(panFor(4)).toBe(PAN_MAX)
    expect(panFor(-4)).toBe(-PAN_MAX)
  })

  it('moves monotonically across the glass', () => {
    const across = [-1, -0.5, 0, 0.5, 1].map(panFor)
    for (let i = 1; i < across.length; i++) expect(across[i]).toBeGreaterThan(across[i - 1])
  })
})

describe('the switch sounds like the switch', () => {
  it('the bat is bright and the slab is low — set by their sizes', () => {
    expect(BAT_HZ).toBeGreaterThan(SLAB_HZ * 5)
    // Both stay inside what a person can hear and place.
    expect(SLAB_HZ).toBeGreaterThan(80)
    expect(BAT_HZ).toBeLessThan(8000)
  })

  it('the release is the thumb — the one hard event in the motion', () => {
    expect(leverVoice().release).toBe(LEVER_THROW)
  })

  it('the arrival is silent, so the switch makes exactly one sound', () => {
    // This is the whole sonic consequence of a critically damped lever.
    // A bat that eases into its stop has nothing to hit.
    const { arrival, rattle } = leverVoice()
    expect(arrival).toBeLessThan(AUDIBLE_ARRIVAL)
    expect(rattle).toBe(0)
  })

  it('a bouncing lever would get its clack back on its own', () => {
    // The gate is measured, not decided. Put the old ringing spring back
    // and the arrival must climb past the threshold — otherwise the tie
    // between the physics and the sound is decorative.
    const original = { ...LEVER_SPRING }
    try {
      Object.assign(LEVER_SPRING, { stiffness: 900, damping: 19 })
      const rung = leverVoice()
      expect(rung.arrival).toBeGreaterThan(AUDIBLE_ARRIVAL)
      expect(rung.rattle).toBeGreaterThan(0)
    } finally {
      Object.assign(LEVER_SPRING, original)
    }
  })

  it('the travel is a real sweep, not an instant', () => {
    // If the arrival ever does sound, it has to be separable from the
    // release or the two smear into one noise.
    expect(leverVoice().travel).toBeGreaterThan(0.05)
  })
})
