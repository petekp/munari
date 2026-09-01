// Lamp tuning contract — every displayed slider reaches one stored value,
// and that value's default equals the constant it replaced (see
// lampTuning.ts's own why-this-number comments), so opening the panel and
// leaving every slider untouched renders identically to round 5.

import { describe, expect, it } from 'vitest'
import { LAMP_GROUPS, lampTuning, normalizeLampInput, type LampNumberKey } from './lampTuning'

const controls = LAMP_GROUPS.flatMap((group) => group.controls)

function controlFor(key: LampNumberKey) {
  const control = controls.find((item) => item.key === key)
  if (!control) throw new Error(`Missing Lamp control: ${key}`)
  return control
}

describe('Lamp tuning', () => {
  it('keeps the shipped constants as the frozen reset preset', () => {
    expect(Object.isFrozen(lampTuning)).toBe(true)
    expect(lampTuning).toEqual({
      flameScale: 1,
      flickerRate: 1,
      flickerAmplitude: 0.1,
      coreBrightness: 1,
      penumbraGrowth: 0.5,
      maxBlurLevel: 3,
      opacityFalloff: 1,
      shadowStrength: 0.55,
      poolIntensity: 1,
      poolWarmth: 1,
      poolRadius: 1,
      pageFlicker: 0.6,
      lampHeight: 44,
      modelScale: 1,
    })
  })

  it('exposes each tuning field as exactly one control', () => {
    const numericKeys = Object.keys(lampTuning).sort()
    expect(controls.map((control) => control.key).sort()).toEqual(numericKeys)
  })

  it('keeps every default within its range and exactly on its input step', () => {
    for (const control of controls) {
      expect(control.step, control.key).toBeGreaterThan(0)
      expect(control.min, control.key).toBeLessThan(control.max)
      expect(normalizeLampInput(control, lampTuning[control.key]), control.key)
        .toBe(lampTuning[control.key])
    }
  })

  it('rejects incomplete and non-finite number input before it reaches a shader', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(normalizeLampInput(controlFor('flameScale'), value)).toBeNull()
    }
  })

  it('clamps every numeric control at both ends', () => {
    for (const control of controls) {
      expect(normalizeLampInput(control, control.min - control.step * 10), control.key).toBe(control.min)
      expect(normalizeLampInput(control, control.max + control.step * 10), control.key).toBe(control.max)
    }
  })

  it('snaps fractional input to the visible precision', () => {
    expect(normalizeLampInput(controlFor('flameScale'), 1.37)).toBe(1.35)
    expect(normalizeLampInput(controlFor('shadowStrength'), 0.552)).toBe(0.55)
    expect(normalizeLampInput(controlFor('lampHeight'), 44.6)).toBe(45)
  })

  it('returns percentage edits to fractional storage before normalization', () => {
    for (const control of controls.filter((item) => item.displayScale === 100)) {
      const displayed = lampTuning[control.key] * 100
      expect(normalizeLampInput(control, displayed / 100), control.key).toBe(lampTuning[control.key])
    }
  })
})
