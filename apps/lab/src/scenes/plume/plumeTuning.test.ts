// Plume tuning contract — every displayed setting reaches one stored value.
//
// The 2026-08-31 panel exposes type, timing, particles, motion, and color
// together, plus two selects that are not numbers: the typeface and the
// release unit. A field may display a percentage, but copying and resetting
// must preserve the fractional shader value and millisecond clock.

import { describe, expect, it } from 'vitest'
import {
  PLUME_GROUPS,
  defaultPlumeEffects,
  normalizePlumeInput,
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
  it('keeps the reviewed type and particle settings as the frozen reset preset', () => {
    expect(Object.isFrozen(plumeTuning)).toBe(true)
    expect(Object.isFrozen(defaultPlumeEffects)).toBe(true)
    expect(plumeTuning).toEqual({
      fontFamily: 'sans',
      typeScale: 1,
      fontWeight: 900,
      lineHeight: 1.16,
      letterSpacing: -0.035,
      textWidth: 1000,
      releaseUnit: 'character',
      holdMs: 1500,
      durationMs: 7200,
      staggerMs: 1520,
      reducedDurationMs: 620,
      pitch: 2,
      particleSize: 1.25,
      sizeVariation: 0.32,
      particleGrowth: 2.6,
      particleOpacity: 0.71,
      particleSoftness: 0.55,
      lifetimeVariation: 0.72,
      rise: 320,
      spread: 80,
      depth: 257,
      turbulence: 3,
      billow: 0.5,
      shading: 0.55,
      depthFog: 0.69,
      turbulenceSpeed: 1,
      draftStrength: 1,
      draftDamping: 5,
      inkColor: '#33254a',
      backgroundColor: '#e5ddea',
      particleColor: '#6e5c8e',
      sparkColor: '#ef694b',
      tint: 0,
      sparkAmount: 0,
      ghostOpacity: 0.06,
      ghostBlur: 5,
    })
    expect(defaultPlumeEffects).toEqual({
      wisps: true,
      afterglow: true,
      embers: true,
      draft: true,
    })
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

  it('returns percentage edits to fractional storage before normalization', () => {
    const sparks = controlFor('sparkAmount')
    expect(sparks.displayScale).toBe(100)
    expect(sparks.unit).toBe('%')
    expect(normalizePlumeInput(sparks, 12.7 / (sparks.displayScale ?? 1))).toBe(0.125)

    for (const control of controls.filter((item) => item.displayScale === 100)) {
      const displayed = plumeTuning[control.key] * 100
      expect(normalizePlumeInput(control, displayed / 100), control.key).toBe(plumeTuning[control.key])
    }
  })
})
