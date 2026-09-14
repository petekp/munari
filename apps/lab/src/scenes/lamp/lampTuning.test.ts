// Panel input normalization preserves stored units and configured ranges.

import { describe, expect, it } from 'vitest'
import { LAMP_GROUPS, lampTuning, normalizeLampInput, normalizeLampTuning, type LampNumberKey } from './lampTuning'

const controls = LAMP_GROUPS.flatMap((group) => group.controls)

function controlFor(key: LampNumberKey) {
  const control = controls.find((item) => item.key === key)
  if (!control) throw new Error(`Missing Lamp control: ${key}`)
  return control
}

describe('Lamp tuning', () => {
  it('restores stored precision while rejecting invalid fields independently', () => {
    const raw = { ...lampTuning, flameScale: 1.37, shadowStrength: NaN, lampHeight: 900 }
    const restored = normalizeLampTuning(raw)
    expect(restored.flameScale).toBe(1.37)
    expect(restored.shadowStrength).toBe(lampTuning.shadowStrength)
    expect(restored.lampHeight).toBe(controlFor('lampHeight').max)
    expect(raw.lampHeight).toBe(900)
    expect(normalizeLampTuning(lampTuning)).toEqual(lampTuning)
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

})
