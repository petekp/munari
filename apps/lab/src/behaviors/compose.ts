// Composable `onFrame` Surface behaviors backed by closed-form analytic springs.
//
// The law: behaviors run independently and `composeBehaviors` keeps the demand
// canvas active (`return true`) until every constituent behavior settles, yielding
// `0` idle renders at rest while remaining identical across 60 Hz & 120 Hz.
//
// Ownership: copyable `registry/behaviors` pack (welded to `apps/lab/src/behaviors`).

import type { SurfaceFrameContext, SurfacePose } from '@petepetrash/munari/gpu'
import { SPRING_FLIGHT, SPRING_SNAPPY, createSpringGroup, type SpringConfig } from './spring'

export type SurfaceBehavior<TUniforms = never> = (ctx: SurfaceFrameContext<TUniforms>) => boolean | void

export interface LiftPoseTarget {
  readonly x?: number
  readonly y?: number
  readonly z?: number
  readonly rx?: number
  readonly ry?: number
}

export interface LiftBehaviorHandle<TUniforms = never> {
  readonly behavior: SurfaceBehavior<TUniforms>
  setLifted(lifted: boolean): void
  snapLifted(lifted: boolean): void
  values(): Readonly<Record<'x' | 'y' | 'z' | 'rx' | 'ry', number>>
}

export interface PointerTiltHandle<TUniforms = never> {
  readonly behavior: SurfaceBehavior<TUniforms>
  setPointer(nx: number, ny: number): void
  reset(): void
}

/** Composes multiple `SurfaceBehavior` callbacks into one `onFrame` handler. */
export function composeBehaviors<TUniforms = never>(
  ...behaviors: readonly SurfaceBehavior<TUniforms>[]
): SurfaceBehavior<TUniforms> {
  return (ctx) => {
    let keepGoing = false
    for (const behavior of behaviors) {
      if (behavior(ctx) === true) keepGoing = true
    }
    return keepGoing
  }
}

const DEFAULT_REST_POSE: Required<LiftPoseTarget> = { x: 0, y: 0, z: 0, rx: 0, ry: 0 }
const DEFAULT_LIFTED_POSE: Required<LiftPoseTarget> = { x: 14, y: 10, z: 32, rx: -0.04, ry: 0.06 }

function resolveLiftPose(
  target: LiftPoseTarget | undefined,
  defaults: Required<LiftPoseTarget>,
): Required<LiftPoseTarget> {
  return {
    x: target?.x ?? defaults.x,
    y: target?.y ?? defaults.y,
    z: target?.z ?? defaults.z,
    rx: target?.rx ?? defaults.rx,
    ry: target?.ry ?? defaults.ry,
  }
}

/** Drives lifted/landed pose offsets around `ctx.basePose` using analytic springs. */
export function createLiftBehavior<TUniforms = never>(options: {
  readonly initialLifted?: boolean
  readonly lifted?: LiftPoseTarget
  readonly rest?: LiftPoseTarget
  readonly config?: SpringConfig
}): LiftBehaviorHandle<TUniforms> {
  const rest = resolveLiftPose(options.rest, DEFAULT_REST_POSE)
  const lifted = resolveLiftPose(options.lifted, DEFAULT_LIFTED_POSE)
  const initPose = options.initialLifted ? lifted : rest
  const springs = createSpringGroup<'x' | 'y' | 'z' | 'rx' | 'ry'>(
    { ...initPose },
    options.config ?? SPRING_FLIGHT,
  )

  return {
    behavior(ctx) {
      const active = springs.step(ctx.dtMs)
      const v = springs.values()
      const pose: SurfacePose = {
        ...ctx.pose,
        x: ctx.pose.x + v.x,
        y: ctx.pose.y + v.y,
        z: ctx.pose.z + v.z,
        rx: (ctx.pose.rx ?? 0) + v.rx,
        ry: (ctx.pose.ry ?? 0) + v.ry,
      }
      ctx.setPose(pose)
      return active
    },
    setLifted(isLifted) {
      springs.setTargets(isLifted ? lifted : rest)
    },
    snapLifted(isLifted) {
      springs.snap(isLifted ? lifted : rest)
    },
    values() {
      return springs.values()
    },
  }
}

/** Adds additive pointer-driven pitch/yaw rotation around the current pose. */
export function createPointerTiltBehavior<TUniforms = never>(
  maxAngleRad = 0.08,
  config: SpringConfig = SPRING_SNAPPY,
): PointerTiltHandle<TUniforms> {
  const springs = createSpringGroup<'rx' | 'ry'>({ rx: 0, ry: 0 }, config)

  return {
    behavior(ctx) {
      const active = springs.step(ctx.dtMs)
      const tilt = springs.values()
      ctx.setPose({
        ...ctx.pose,
        rx: (ctx.pose.rx ?? 0) + tilt.rx,
        ry: (ctx.pose.ry ?? 0) + tilt.ry,
      })
      return active
    },
    setPointer(nx, ny) {
      springs.setTargets({
        rx: -ny * maxAngleRad,
        ry: nx * maxAngleRad,
      })
    },
    reset() {
      springs.setTargets({ rx: 0, ry: 0 })
    },
  }
}
