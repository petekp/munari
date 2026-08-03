// REGISTRY — flight-card pack charter (2026-08-03)
// This pack is a charter, not yet vendorable source (its README says
// why: the laws are kernel contracts, the scene machinery is one
// organism awaiting a second consumer). What CAN drift silently is the
// charter's claims — the constants table and the "lives in the kernel"
// assertions — so those are welded here, glass-pack style: the kernel
// halves by import, the scene halves by text.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TOSS_SPIN_V0, TOSS_SPIN_MAX, aeroAmplitude } from '@anamorph/core'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const scene = () =>
  readFileSync(join(ROOT, 'apps/lab/src/scenes/Flight.tsx'), 'utf8')

describe('the charter names real kernel surface', () => {
  it('the toss constants are the archived tuning', () => {
    expect(TOSS_SPIN_V0).toBe(220)
    expect(TOSS_SPIN_MAX).toBe(7)
  })

  it('the bend amplitude still clears its perceptual floor at a comfortable drag', () => {
    // The full floor suite lives with the physics contracts; this is the
    // charter's one-line claim (AMP 55 / V0 650, set by measurement)
    // spot-checked so the README cannot cite a retuned kernel: at the
    // half-saturation speed the square law reads exactly AMP/2 (the gate
    // is fully open far above its 30 px/s threshold).
    expect(aeroAmplitude(650)).toBeCloseTo(55 / 2, 5)
  })
})

describe('the charter names the real scene constants (text weld to the reference)', () => {
  it('folds are 6×3 uv cells with the 0.35 remainder', () => {
    expect(scene()).toContain('floor(uv * vec2(6.0, 3.0))')
    expect(scene()).toContain('mix(cellDir, vertDir, 0.35)')
  })

  it('the crumple happens at altitude 55', () => {
    expect(scene()).toContain('const CRUMPLE_Z = 55')
  })
})
