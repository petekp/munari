// Panel input normalization preserves stored units and configured ranges.

import { describe, expect, it } from 'vitest'
import {
  PLUME_GROUPS,
  normalizePlumeInput,
  normalizePlumeTuning,
  plumeTuning,
  type PlumeNumberKey,
} from './plumeTuning'

const controls = PLUME_GROUPS.flatMap((group) => group.controls)

function controlFor(key: PlumeNumberKey) {
  const control = controls.find((item) => item.key === key)
  if (!control) throw new Error(`Missing Plume control: ${key}`)
  return control
}

describe('Plume tuning', () => {
  it('restores stored clocks and fractions without snapping unrelated valid fields', () => {
    const raw = { ...plumeTuning, holdMs: 1549, particleSize: 1.37, rise: Infinity, inkColor: 'invalid', particleColor: '#AaBBcc' }
    const restored = normalizePlumeTuning(raw)
    expect(restored.holdMs).toBe(1549)
    expect(restored.particleSize).toBe(1.37)
    expect(restored.rise).toBe(plumeTuning.rise)
    expect(restored.inkColor).toBe(plumeTuning.inkColor)
    expect(restored.particleColor).toBe('#aabbcc')
    expect(raw.particleColor).toBe('#AaBBcc')
    expect(normalizePlumeTuning(plumeTuning)).toEqual(plumeTuning)
  })

  it('exposes each numeric and color value exactly once', () => {
    const nonNumeric = new Set([
      'fontFamily', 'releaseUnit', 'backgroundColor', 'inkColor', 'particleColor', 'sparkColor',
    ])
    const numericKeys = Object.keys(plumeTuning)
      .filter((key) => !nonNumeric.has(key))
      .sort()
    expect(controls.map((control) => control.key).sort()).toEqual(numericKeys)
    expect(PLUME_GROUPS.flatMap((group) => group.colors ?? []).map((control) => control.key).sort())
      .toEqual(['backgroundColor', 'inkColor', 'particleColor', 'sparkColor'])
  })

  it('keeps every default within its range and exactly on its input step', () => {
    for (const control of controls) {
      expect(control.step, control.key).toBeGreaterThan(0)
      expect(control.min, control.key).toBeLessThan(control.max)
      expect(normalizePlumeInput(control, plumeTuning[control.key]), control.key)
        .toBe(plumeTuning[control.key])
    }
  })

  it('rejects incomplete and non-finite number input before it reaches a shader', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(normalizePlumeInput(controlFor('particleSize'), value)).toBeNull()
    }
  })

  it('clamps every numeric control at both ends', () => {
    for (const control of controls) {
      expect(normalizePlumeInput(control, control.min - control.step * 10), control.key).toBe(control.min)
      expect(normalizePlumeInput(control, control.max + control.step * 10), control.key).toBe(control.max)
    }
  })

  it('snaps fractional sizes and negative tracking to the visible precision', () => {
    expect(normalizePlumeInput(controlFor('particleSize'), 3.37)).toBe(3.25)
    expect(normalizePlumeInput(controlFor('tint'), 0.446)).toBe(0.45)
    expect(normalizePlumeInput(controlFor('letterSpacing'), -0.0326)).toBe(-0.035)
    expect(normalizePlumeInput(controlFor('letterSpacing'), 0.0176)).toBe(0.02)
    expect(normalizePlumeInput(controlFor('ghostBlur'), 2.26)).toBe(2.3)
  })

  it('stores clocks in milliseconds without changing the display scale', () => {
    expect(normalizePlumeInput(controlFor('holdMs'), 1549)).toBe(1500)
    expect(normalizePlumeInput(controlFor('durationMs'), 7251)).toBe(7300)
    expect(normalizePlumeInput(controlFor('staggerMs'), 491)).toBe(500)
    expect(normalizePlumeInput(controlFor('reducedDurationMs'), 624)).toBe(620)
    expect(controlFor('durationMs').unit).toBe('ms')
    expect(controlFor('durationMs').displayScale).toBeUndefined()
  })

  it('normalizes spark opacity to the precision of its control', () => {
    const sparks = controlFor('sparkAmount')
    expect(sparks.displayScale).toBe(100)
    expect(sparks.unit).toBe('%')
    expect(normalizePlumeInput(sparks, 0.127)).toBe(0.125)
  })
})
