// Tweak input contract — a displayed number must be the number rendered.
//
// A 2026-08-30 browser check typed 3.25 into a 0.1-step light control. The
// field showed 3.3 after blur while Three still used 3.25. The scene owns
// normalization, so native number editing and sliders share one conversion.

import { describe, expect, it } from 'vitest'
import { MARBLE_HAND_GROUPS, marbleHandTuning, normalizeMarbleHandInput, type MarbleHandNumberKey } from './marbleHandTuning'

function controlFor(key: MarbleHandNumberKey) {
  const control = MARBLE_HAND_GROUPS.flatMap((group) => group.controls).find((item) => item.key === key)
  if (!control) throw new Error(`Missing tweak control: ${key}`)
  return control
}

describe('marble-hand numeric controls', () => {
  it('snaps typed precision to the same step the light field displays', () => {
    expect(normalizeMarbleHandInput(controlFor('keyIntensity'), 3.25)).toBe(3.3)
  })

  it('converts displayed degrees to the stored radian pose', () => {
    expect(normalizeMarbleHandInput(controlFor('sculptureRoll'), -120)).toBeCloseTo(-Math.PI * 2 / 3, 12)
  })

  it('clamps both ends of a control before the value reaches Three', () => {
    const control = controlFor('scale')
    expect(normalizeMarbleHandInput(control, -10)).toBe(control.min)
    expect(normalizeMarbleHandInput(control, 10)).toBe(control.max)
  })

  it('does not publish incomplete or non-finite input', () => {
    const control = controlFor('heightPx')
    expect(normalizeMarbleHandInput(control, NaN)).toBeNull()
    expect(normalizeMarbleHandInput(control, Infinity)).toBeNull()
  })

  it('starts reflection updates at the existing 20 fps limit', () => {
    expect(marbleHandTuning.reflectionFps).toBe(20)
  })

  it('offers the same reflection frame-rate control for both finishes', () => {
    const group = MARBLE_HAND_GROUPS.find((item) => item.title === 'Reflections')
    expect(group?.material).toBeUndefined()
    expect(group?.controls).toEqual([
      { key: 'reflectionFps', label: 'Reflection frame rate', min: 1, max: 120, step: 1, unit: 'fps' },
    ])
  })

  it('normalizes reflection updates to whole rates within 1–120 fps', () => {
    const control = controlFor('reflectionFps')
    expect(normalizeMarbleHandInput(control, 0)).toBe(1)
    expect(normalizeMarbleHandInput(control, 121)).toBe(120)
    expect(normalizeMarbleHandInput(control, 29.6)).toBe(30)
    expect(normalizeMarbleHandInput(control, NaN)).toBeNull()
    expect(normalizeMarbleHandInput(control, Infinity)).toBeNull()
  })
})
