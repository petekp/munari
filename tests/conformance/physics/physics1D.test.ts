// The 1-DOF control kit — feel as force fields, pinned.
//
// The claim under test: a control's feel — the dial's detents and its
// keyboard ratchet — is one tiny integrator run over composable force fields.
// If these hold, the control kit is one physics core plus geometry. No easing curves, no durations: release
// velocity flows into the field and the field decides where things land,
// machine-exact, and stable at a coarse 30 fps timestep — which is what
// semi-implicit Euler is for.

import { describe, expect, it } from 'vitest'
import {
  type Body1D,
  type Field,
  composeFields,
  damping,
  detentField,
  step,
  hopImpulse,
} from '@munari/core'

const STEP = (Math.PI * 2) / 8

function simulate(body: Body1D, field: Field, seconds: number, dt = 1 / 120): Body1D {
  const steps = Math.round(seconds / dt)
  for (let i = 0; i < steps; i++) step(body, field, dt, 2)
  return body
}

describe('detentField (the dial)', () => {
  const field = composeFields(detentField(8, 50), damping(6))

  it('settles machine-exact into the nearest well', () => {
    const a = simulate({ q: 0.4 * STEP, v: 0 }, field, 8)
    expect(Math.abs(a.q)).toBeLessThan(1e-9)
    expect(Math.abs(a.v)).toBeLessThan(1e-9)

    const b = simulate({ q: 0.6 * STEP, v: 0 }, field, 8)
    expect(Math.abs(b.q - STEP)).toBeLessThan(1e-9)
  })

  it('a flick ratchets forward through wells and is fully deterministic', () => {
    const run = (v0: number) => {
      const body: Body1D = { q: 0, v: v0 }
      const trace: number[] = []
      for (let i = 0; i < 10 * 120; i++) {
        step(body, field, 1 / 120, 2)
        trace.push(body.q)
      }
      return { body, trace }
    }
    const a1 = run(14)
    const a2 = run(14)
    expect(a1.trace).toEqual(a2.trace) // bit-for-bit repeatable

    const wells = (q: number) => Math.round(q / STEP)
    expect(wells(a1.body.q)).toBeGreaterThanOrEqual(1) // it ratcheted
    expect(Math.abs(a1.body.q - wells(a1.body.q) * STEP)).toBeLessThan(1e-9)

    const harder = run(20)
    expect(wells(harder.body.q)).toBeGreaterThanOrEqual(wells(a1.body.q))
  })

  it('stays stable at a coarse 30fps timestep despite the stiff field', () => {
    const body: Body1D = { q: 0.3, v: 0 }
    for (let i = 0; i < 300; i++) {
      step(body, field, 1 / 30, 2)
      expect(Math.abs(body.q)).toBeLessThan(10) // never explodes
    }
    expect(Math.abs(body.q)).toBeLessThan(1e-6) // and still settles
  })
})

describe('hopImpulse (the dial keyboard ratchet)', () => {
  // Dial default tuning: 8 detents, k=50, c=6 — the values Dial.tsx ships.
  const field = composeFields(detentField(8, 50), damping(6))

  it('one kick from rest advances exactly one well', () => {
    const kick = hopImpulse(field, STEP)
    const settled = simulate({ q: 0, v: kick }, field, 4)
    expect(Math.round(settled.q / STEP)).toBe(1)
  })

  it('is symmetric: a negative kick lands one well the other way', () => {
    const kick = hopImpulse(field, STEP)
    const settled = simulate({ q: 0, v: -kick }, field, 4)
    expect(Math.round(settled.q / STEP)).toBe(-1)
  })

  it('under the bisected minimum, the body falls back home', () => {
    const kick = hopImpulse(field, STEP)
    // margin is 1.25, so 60% of the returned kick sits well below the barrier
    const settled = simulate({ q: 0, v: kick * 0.6 }, field, 4)
    expect(Math.round(settled.q / STEP)).toBe(0)
  })

  it('adapts to stiffer tuning without skipping wells', () => {
    const stiff = composeFields(detentField(12, 140), damping(9))
    const spacing = (Math.PI * 2) / 12
    const kick = hopImpulse(stiff, spacing)
    const settled = simulate({ q: 0, v: kick }, stiff, 4)
    expect(Math.round(settled.q / spacing)).toBe(1)
  })
})
