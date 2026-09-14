// Tweak input contract — a displayed number must be the number rendered.
//
// A 2026-08-30 browser check typed 3.25 into a 0.1-step light control. The
// field showed 3.3 after blur while Three still used 3.25. The scene owns
// normalization, so native number editing and sliders share one conversion.

import { describe, expect, it } from 'vitest'
import { MARBLE_HAND_GROUPS, marbleHandTuning, normalizeMarbleHandInput, normalizeMarbleHandTuning, type MarbleHandNumberKey } from './marbleHandTuning'

function controlFor(key: MarbleHandNumberKey) {
  const control = MARBLE_HAND_GROUPS.flatMap((group) => group.controls).find((item) => item.key === key)
  if (!control) throw new Error(`Missing tweak control: ${key}`)
  return control
}

describe('marble-hand numeric controls', () => {
  it('restores radians exactly and repairs invalid stored fields independently', () => {
    const raw = { ...marbleHandTuning, maxTilt: 0.123456789, scale: 99, heightPx: NaN, chromeTint: '#AaBBcc', strokeColor: 'invalid', tapEnabled: false }
    const restored = normalizeMarbleHandTuning(raw)
    expect(restored.maxTilt).toBe(raw.maxTilt)
    expect(restored.scale).toBe(controlFor('scale').max)
    expect(restored.heightPx).toBe(marbleHandTuning.heightPx)
    expect(restored.chromeTint).toBe('#aabbcc')
    expect(restored.strokeColor).toBe(marbleHandTuning.strokeColor)
    expect(restored.tapEnabled).toBe(false)
    expect(raw.scale).toBe(99)
    expect(normalizeMarbleHandTuning(marbleHandTuning)).toEqual(marbleHandTuning)
  })

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

  it('allows the full physical roughness range without changing mirror precision', () => {
    const control = controlFor('chromeRoughness')
    expect(normalizeMarbleHandInput(control, 0.7534)).toBe(0.753)
    expect(normalizeMarbleHandInput(control, -1)).toBe(0)
    expect(normalizeMarbleHandInput(control, 2)).toBe(1)
  })

  it('expands every movement control while preserving its input precision', () => {
    expect(normalizeMarbleHandInput(controlFor('poseDamping'), 80.3)).toBe(80.5)
    expect(normalizeMarbleHandInput(controlFor('poseDamping'), 121)).toBe(120)
    expect(normalizeMarbleHandInput(controlFor('velocityTilt'), 0.05674)).toBe(0.0567)
    expect(normalizeMarbleHandInput(controlFor('velocityTilt'), 0.09)).toBe(0.08)
  })

  it('stores the expanded motion angles in radians and clamps at half a turn', () => {
    for (const key of ['maxTilt', 'maxSpin', 'pressPitch'] as const) {
      const control = controlFor(key)
      expect(normalizeMarbleHandInput(control, 135.04)).toBeCloseTo(Math.PI * 0.75, 12)
      expect(normalizeMarbleHandInput(control, 181)).toBeCloseTo(Math.PI, 12)
      expect(normalizeMarbleHandInput(control, -181)).toBeCloseTo(key === 'pressPitch' ? -Math.PI : 0, 12)
    }
  })

  it('waits over a second before drumming, at a readable depth', () => {
    expect(marbleHandTuning.tapIdleDelayMs).toBeGreaterThan(1000)
    expect(marbleHandTuning.tapLiftRad).toBeGreaterThan(0)
    expect(marbleHandTuning.tapLiftRad).toBeLessThan(Math.PI / 2)
  })

  it('bounds both pinch controls without reversing the gesture', () => {
    for (const key of ['pinchIndexRad', 'pinchThumbRad'] as const) {
      expect(normalizeMarbleHandInput(controlFor(key), -5)).toBe(0)
      expect(normalizeMarbleHandInput(controlFor(key), 90)).toBeCloseTo(Math.PI / 4, 12)
    }
  })

  it('never lets the panel drive the tap into an unlifted or negative bend', () => {
    const control = controlFor('tapLiftRad')
    expect(normalizeMarbleHandInput(control, -5)).toBe(0)
    expect(normalizeMarbleHandInput(control, 90)).toBeCloseTo(Math.PI / 3, 12)
    expect(normalizeMarbleHandInput(controlFor('tapIdleDelayMs'), 0)).toBe(200)
    expect(normalizeMarbleHandInput(controlFor('tapPeriodMs'), 5000)).toBe(2000)
  })

  it('offers the same screen-pixel stroke controls for both finishes', () => {
    const group = MARBLE_HAND_GROUPS.find((item) => item.title === 'Stroke')
    expect(group?.material).toBeUndefined()
    expect(group?.controls.map((control) => control.key).sort()).toEqual(['strokeOpacity', 'strokeWidthPx'])
  })

  it('normalizes stroke width to quarter pixels within 0–12 pixels', () => {
    const control = controlFor('strokeWidthPx')
    expect(normalizeMarbleHandInput(control, -1)).toBe(0)
    expect(normalizeMarbleHandInput(control, 13)).toBe(12)
    expect(normalizeMarbleHandInput(control, 2.34)).toBe(2.25)
    expect(normalizeMarbleHandInput(control, NaN)).toBeNull()
    expect(normalizeMarbleHandInput(control, Infinity)).toBeNull()
  })

  it('normalizes stroke opacity without publishing an invalid alpha', () => {
    const control = controlFor('strokeOpacity')
    expect(normalizeMarbleHandInput(control, -0.1)).toBe(0)
    expect(normalizeMarbleHandInput(control, 1.1)).toBe(1)
    expect(normalizeMarbleHandInput(control, 0.83)).toBe(0.85)
    expect(normalizeMarbleHandInput(control, NaN)).toBeNull()
    expect(normalizeMarbleHandInput(control, Infinity)).toBeNull()
  })

  it('offers the same reflection frame-rate control for both finishes', () => {
    const group = MARBLE_HAND_GROUPS.find((item) => item.title === 'Reflections')
    expect(group?.material).toBeUndefined()
    expect(group?.controls.map((control) => control.key)).toEqual(['reflectionFps'])
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
