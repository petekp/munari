// REGISTRY — flight-card pack charter (2026-08-03)
// This pack is a charter, not yet vendorable source (its README says
// why: the scene machinery is one organism awaiting a second consumer).
// What can drift silently is the charter's claims, so the tuned values
// and scene files are welded here.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  TOSS_SPIN_V0,
  TOSS_SPIN_MAX,
  aeroAmplitude,
} from '../../apps/lab/src/scenes/flight/flightPhysicsLaw'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const scene = () =>
  readFileSync(join(ROOT, 'apps/lab/src/scenes/flight/Flight.tsx'), 'utf8')
const charter = () =>
  readFileSync(join(ROOT, 'registry/flight-card/README.md'), 'utf8')
// The scene's GLSL lives beside it (flightShaders.ts), the way the glass
// pack splits glassSdfShader.ts from glassSdf.tsx. A constant the charter
// quotes from a shader has to be read from the file that holds it.
const shaders = () =>
  readFileSync(join(ROOT, 'apps/lab/src/scenes/flight/flightShaders.ts'), 'utf8')

describe('the charter names the real Flight laws', () => {
  it('the toss constants are the archived tuning', () => {
    expect(TOSS_SPIN_V0).toBe(220)
    expect(TOSS_SPIN_MAX).toBe(7)
  })

  it('the bend amplitude still clears its perceptual floor at a comfortable drag', () => {
    // The full floor suite lives beside the scene; this is the charter's
    // one-line claim (AMP 55 / V0 650, set by measurement) spot-checked so
    // the README cannot cite a retuned law. At the
    // half-saturation speed the square law reads exactly AMP/2 (the gate
    // is fully open far above its 30 px/s threshold).
    expect(aeroAmplitude(650)).toBeCloseTo(55 / 2, 5)
  })
})

describe('the charter names the real scene constants (text weld to the reference)', () => {
  it('folds are 6×3 uv cells with the 0.35 remainder', () => {
    expect(shaders()).toContain('floor(uv * vec2(6.0, 3.0))')
    expect(shaders()).toContain('mix(cellDir, vertDir, 0.35)')
  })

  it('the crumple happens at altitude 55', () => {
    expect(scene()).toContain('const CRUMPLE_Z = 55')
  })

  it('the handoff charter names the ramp the plate owns', () => {
    expect(charter()).toContain('answering the crossing from the plate')
    // The crossing is the altitude, and the landing is exact. Both halves
    // are welded: a driver that lost the floor would never leave the page,
    // and one that lost the zero would never come back to it.
    expect(scene()).toContain('if (target === \'dom\' || !f) return 0')
    expect(scene()).toContain('return Math.max(ADMIT, Math.min(1, f.plate.p.z / LIFT_Z))')
    expect(scene()).toContain('progress={surface.progress}')
    // Stated on the root, not on the handle: `<Surface>` owns view,
    // timing and callbacks, and `useSurface` is identity only.
    expect(scene()).toContain('timing={{ settleMs: 0, durationMs: 1 }}')
    expect(scene()).not.toContain('onFirstUpload=')
    // The shadow is scene matter, not a presenter: it cannot warm write-free,
    // so it hides itself for exactly the frames the page still holds.
    expect(scene()).toContain('sh.visible = crossing > 0')
  })
})
