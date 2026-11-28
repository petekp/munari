// Verifies closed-form analytic spring frame-rate invariance (60 Hz vs 120 Hz vs single step),
// rest settlement, composeBehaviors demand coordination, and registry/lab byte-weld identity.

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SPRING_BOUNCY,
  SPRING_GENTLE,
  SPRING_SNAPPY,
  createSpring,
  createSpringGroup,
  stepSpring,
  type SpringConfig,
  type SpringState,
} from '../../registry/behaviors/spring'
import { composeBehaviors, createLiftBehavior, createPointerTiltBehavior } from '../../registry/behaviors/compose'
import type { SurfaceFrameContext, SurfacePose } from '../../packages/react/src/gpu'

const ROOT = resolve(import.meta.dirname, '..', '..')

function simulateSteps(initial: SpringState, config: SpringConfig, steps: number, dtSec: number) {
  let state = initial
  let active = true
  for (let i = 0; i < steps; i++) {
    const res = stepSpring(state, dtSec, config)
    state = res.state
    active = res.active
  }
  return { state, active }
}

describe('registry/behaviors pack', () => {
  it('matches analytic trajectories across 60 Hz, 120 Hz, and single-step integration', () => {
    const regimes: readonly { readonly name: string; readonly cfg: SpringConfig }[] = [
      { name: 'underdamped', cfg: { ...SPRING_BOUNCY, precision: 1e-9, velocityPrecision: 1e-9 } },
      { name: 'critical', cfg: { stiffness: 100, damping: 20, mass: 1, precision: 1e-9, velocityPrecision: 1e-9 } },
      { name: 'overdamped', cfg: { ...SPRING_GENTLE, stiffness: 80, damping: 40, precision: 1e-9, velocityPrecision: 1e-9 } },
    ]
    const initial: SpringState = { value: 0, velocity: 12, target: 32 }

    for (const { cfg } of regimes) {
      const hz60 = simulateSteps(initial, cfg, 60, 1 / 60)
      const hz120 = simulateSteps(initial, cfg, 120, 1 / 120)
      const oneShot = simulateSteps(initial, cfg, 1, 1)

      expect(hz60.state.value).toBeCloseTo(hz120.state.value, 6)
      expect(hz60.state.velocity).toBeCloseTo(hz120.state.velocity, 6)
      expect(hz60.state.value).toBeCloseTo(oneShot.state.value, 6)
      expect(hz60.state.velocity).toBeCloseTo(oneShot.state.velocity, 6)
    }
  })

  it('settles springs to rest and stops asking for demand frames via composeBehaviors', () => {
    const sp = createSpring(0, SPRING_SNAPPY)
    sp.setTarget(40)
    expect(sp.step(16)).toBe(true)
    for (let i = 0; i < 300; i++) sp.step(16)
    expect(sp.step(16)).toBe(false)
    expect(sp.get()).toEqual({ value: 40, velocity: 0, target: 40 })

    const grp = createSpringGroup({ x: 0, y: 10 }, SPRING_SNAPPY)
    grp.setTargets({ x: 20 })
    const a = () => grp.step(16)
    const b = () => false
    const composed = composeBehaviors(a, b)
    // SAFETY: only `composed` behaviors access their closures in this synthetic unit call.
    const dummyCtx = {} as SurfaceFrameContext
    expect(composed(dummyCtx)).toBe(true)
    for (let i = 0; i < 300; i++) composed(dummyCtx)
    expect(composed(dummyCtx)).toBe(false)
    expect(grp.values()).toEqual({ x: 20, y: 10 })
    expect(grp.isActive()).toBe(false)
  })

  it('stacks pose offsets additively through ctx.pose in composeBehaviors', () => {
    const lift = createLiftBehavior({ initialLifted: true })
    const tilt = createPointerTiltBehavior(0.1)
    tilt.setPointer(1, -1)
    const composed = composeBehaviors(lift.behavior, tilt.behavior)
    const base: SurfacePose = { x: 10, y: 20, z: 0, rx: 0, ry: 0 }
    let cur: SurfacePose = base
    let finalPose: SurfacePose = base
    // SAFETY: exercise only the fields read by `createLiftBehavior` and `createPointerTiltBehavior`.
    const ctx = {
      dtMs: 16,
      elapsedMs: 16,
      basePose: base,
      get pose() {
        return cur
      },
      setPose(p) {
        cur = p
        finalPose = p
      },
    } as SurfaceFrameContext
    for (let i = 0; i < 120; i++) {
      cur = base
      composed(ctx)
    }
    expect(finalPose.z).toBeGreaterThan(25)
    expect(finalPose.rx ?? 0).toBeCloseTo(-0.04 + 0.1, 2)
    expect(finalPose.ry ?? 0).toBeCloseTo(0.06 + 0.1, 2)
  })

  it('byte-welds registry/behaviors files to apps/lab/src/behaviors', () => {
    for (const file of ['spring.ts', 'compose.ts']) {
      const a = readFileSync(join(ROOT, 'registry/behaviors', file), 'utf8')
      const b = readFileSync(join(ROOT, 'apps/lab/src/behaviors', file), 'utf8')
      expect(b).toBe(a)
    }
  })
})
