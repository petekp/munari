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
  it('opens and resets to the exported chrome finish', () => {
    expect(marbleHandTuning).toMatchObject({
      materialMode: 'chrome',
      chromeRoughness: 0.364,
      chromeReflectionIntensity: 2.95,
      chromeTint: '#eef2f7',
    })
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
    expect(control).toMatchObject({ min: 0, max: 1, step: 0.001 })
    expect(normalizeMarbleHandInput(control, 0.7534)).toBe(0.753)
    expect(normalizeMarbleHandInput(control, -1)).toBe(0)
    expect(normalizeMarbleHandInput(control, 2)).toBe(1)
  })

  it('expands every movement control while preserving its input precision', () => {
    const movement = MARBLE_HAND_GROUPS.find((group) => group.title === 'Movement')
    expect(movement?.controls.map(({ key, min, max, step, degrees }) => ({ key, min, max, step, degrees })))
      .toEqual([
        { key: 'poseDamping', min: 2, max: 120, step: 0.5, degrees: undefined },
        { key: 'velocityTilt', min: 0, max: 0.08, step: 0.0001, degrees: undefined },
        { key: 'maxTilt', min: 0, max: 180, step: 0.1, degrees: true },
        { key: 'maxSpin', min: 0, max: 180, step: 0.1, degrees: true },
        { key: 'pressPitch', min: -180, max: 180, step: 0.1, degrees: true },
      ])
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

  it('keeps the reviewed movement defaults within the expanded ranges', () => {
    expect(marbleHandTuning).toMatchObject({
      poseDamping: 7.5,
      velocityTilt: 0.0111,
      maxTilt: 0.12,
      maxSpin: 0.3490658503988659,
      pressPitch: -0.2565634000431664,
      sculptureRoll: 1.9355701404617116,
      sculpturePitch: 0.582939970166106,
    })
  })

  it('waits over a second before drumming, at a readable depth', () => {
    // 0.22rad at the knuckle is 0.396rad at the tip through the 1.8x
    // two-joint chain — the depth the flat 0.35rad hinge used to give.
    expect(marbleHandTuning).toMatchObject({
      tapEnabled: true,
      tapIdleDelayMs: 1200,
      tapPeriodMs: 720,
      tapLiftRad: 0.22,
    })
    const group = MARBLE_HAND_GROUPS.find((item) => item.title === 'Idle tap')
    expect(group?.controls.map(({ key, min, max, step, degrees }) => ({ key, min, max, step, degrees })))
      .toEqual([
        { key: 'tapIdleDelayMs', min: 200, max: 5000, step: 50, degrees: undefined },
        { key: 'tapPeriodMs', min: 200, max: 2000, step: 10, degrees: undefined },
        { key: 'tapLiftRad', min: 0, max: 60, step: 0.5, degrees: true },
      ])
  })

  it('closes the pinch pair short of touching, from a panel that cannot reverse it', () => {
    expect(marbleHandTuning).toMatchObject({
      pinchEnabled: true,
      pinchIndexRad: 0.46,
      pinchThumbRad: 0.36,
    })
    const group = MARBLE_HAND_GROUPS.find((item) => item.title === 'Pinch')
    expect(group?.controls.map(({ key, min, max, step, degrees }) => ({ key, min, max, step, degrees })))
      .toEqual([
        { key: 'pinchIndexRad', min: 0, max: 45, step: 0.5, degrees: true },
        { key: 'pinchThumbRad', min: 0, max: 45, step: 0.5, degrees: true },
      ])
    expect(normalizeMarbleHandInput(controlFor('pinchIndexRad'), -5)).toBe(0)
    expect(normalizeMarbleHandInput(controlFor('pinchThumbRad'), 90)).toBeCloseTo(Math.PI / 4, 12)
  })

  it('never lets the panel drive the tap into an unlifted or negative bend', () => {
    const control = controlFor('tapLiftRad')
    expect(normalizeMarbleHandInput(control, -5)).toBe(0)
    expect(normalizeMarbleHandInput(control, 90)).toBeCloseTo(Math.PI / 3, 12)
    expect(normalizeMarbleHandInput(controlFor('tapIdleDelayMs'), 0)).toBe(200)
    expect(normalizeMarbleHandInput(controlFor('tapPeriodMs'), 5000)).toBe(2000)
  })

  it('starts reflection updates at the exported 120 fps limit', () => {
    expect(marbleHandTuning.reflectionFps).toBe(120)
  })

  it('starts and resets with a narrow, partly transparent stroke', () => {
    expect(marbleHandTuning).toMatchObject({
      strokeEnabled: true,
      strokeWidthPx: 2,
      strokeColor: '#171914',
      strokeOpacity: 0.85,
    })
  })

  it('keeps the exported light, exposure, and soft shadow settings exact', () => {
    expect(marbleHandTuning).toMatchObject({
      ambientIntensity: 0.25,
      keyIntensity: 1.2,
      lightX: -170,
      lightY: 270,
      lightZ: 950,
      exposure: 0.45,
      roomBounce: 0.29,
      shadowIntensity: 0.8,
      shadowRadius: 10.5,
    })
  })

  it('offers the same screen-pixel stroke controls for both finishes', () => {
    const group = MARBLE_HAND_GROUPS.find((item) => item.title === 'Stroke')
    expect(group?.material).toBeUndefined()
    expect(group?.controls).toEqual([
      { key: 'strokeWidthPx', label: 'Stroke width', min: 0, max: 12, step: 0.25, unit: 'px' },
      { key: 'strokeOpacity', label: 'Stroke opacity', min: 0, max: 1, step: 0.05 },
    ])
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
