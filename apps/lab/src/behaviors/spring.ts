// Closed-form analytic spring solver and stateful spring primitives for UI motion.
//
// The law: solving m*x'' + c*x' + k*x = 0 analytically across underdamped,
// critically damped, and overdamped regimes guarantees frame-rate invariance across
// 60 Hz, 120 Hz, and deterministic M5 manual steps (decisions.md #66, #81), while
// settling cleanly to rest (`active === false`) with zero idle renders.
//
// Ownership: copyable `registry/behaviors` pack (welded to `apps/lab/src/behaviors`).

export interface SpringConfig {
  readonly stiffness: number
  readonly damping: number
  readonly mass?: number
  readonly precision?: number
  readonly velocityPrecision?: number
}

export interface SpringState {
  readonly value: number
  readonly velocity: number
  readonly target: number
}

export interface SpringStepResult {
  readonly state: SpringState
  readonly active: boolean
}

export interface SpringHandle {
  setTarget(target: number): void
  snap(value: number): void
  get(): SpringState
  step(dtMs: number): boolean
}

export interface SpringGroupHandle<K extends string> {
  setTargets(targets: Partial<Record<K, number>>): void
  snap(values: Partial<Record<K, number>>): void
  values(): Record<K, number>
  step(dtMs: number): boolean
  isActive(): boolean
}

// Tuned by eye for UI tactile feel across crisp, gentle, and physical card moves.
export const SPRING_SNAPPY: SpringConfig = {
  stiffness: 420,
  damping: 32,
  mass: 1,
  precision: 0.005,
  velocityPrecision: 0.02,
}

export const SPRING_GENTLE: SpringConfig = {
  stiffness: 180,
  damping: 24,
  mass: 1,
  precision: 0.005,
  velocityPrecision: 0.02,
}

export const SPRING_BOUNCY: SpringConfig = {
  stiffness: 340,
  damping: 18,
  mass: 1,
  precision: 0.005,
  velocityPrecision: 0.02,
}

export const SPRING_FLIGHT: SpringConfig = {
  stiffness: 260,
  damping: 26,
  mass: 1,
  precision: 0.01,
  velocityPrecision: 0.05,
}

export const SPRING_FISHEYE: SpringConfig = {
  stiffness: 320,
  damping: 32,
  mass: 1,
  precision: 0.005,
  velocityPrecision: 0.02,
}

const DEFAULT_PRECISION = 0.001
const DEFAULT_VEL_PRECISION = 0.01
const CRITICAL_EPS = 1e-5

/** Advances a 1D damped harmonic oscillator analytically over `dtSec`. */
export function stepSpring(state: SpringState, dtSec: number, config: SpringConfig): SpringStepResult {
  const prec = config.precision ?? DEFAULT_PRECISION
  const vPrec = config.velocityPrecision ?? DEFAULT_VEL_PRECISION
  const x0 = state.value - state.target
  const v0 = state.velocity

  if (dtSec <= 0) {
    const settled = Math.abs(x0) <= prec && Math.abs(v0) <= vPrec
    if (settled) {
      return { state: { value: state.target, velocity: 0, target: state.target }, active: false }
    }
    return { state, active: true }
  }

  const m = Math.max(1e-6, config.mass ?? 1)
  const k = Math.max(1e-6, config.stiffness)
  const c = Math.max(0, config.damping)
  const w0 = Math.sqrt(k / m)
  const zeta = c / (2 * Math.sqrt(k * m))

  let x = 0
  let v = 0
  if (zeta < 1 - CRITICAL_EPS) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta)
    const decay = Math.exp(-zeta * w0 * dtSec)
    const a = x0
    const b = (v0 + zeta * w0 * x0) / wd
    const cos = Math.cos(wd * dtSec)
    const sin = Math.sin(wd * dtSec)
    x = decay * (a * cos + b * sin)
    v = decay * ((b * wd - zeta * w0 * a) * cos - (a * wd + zeta * w0 * b) * sin)
  } else if (zeta <= 1 + CRITICAL_EPS) {
    const decay = Math.exp(-w0 * dtSec)
    const a = x0
    const b = v0 + w0 * x0
    x = decay * (a + b * dtSec)
    v = decay * (b - w0 * (a + b * dtSec))
  } else {
    const gamma = w0 * Math.sqrt(zeta * zeta - 1)
    const r1 = -zeta * w0 + gamma
    const r2 = -zeta * w0 - gamma
    const c1 = (v0 - r2 * x0) / (r1 - r2)
    const c2 = x0 - c1
    const e1 = Math.exp(r1 * dtSec)
    const e2 = Math.exp(r2 * dtSec)
    x = c1 * e1 + c2 * e2
    v = c1 * r1 * e1 + c2 * r2 * e2
  }

  if (Math.abs(x) <= prec && Math.abs(v) <= vPrec) {
    return { state: { value: state.target, velocity: 0, target: state.target }, active: false }
  }
  return {
    state: { value: state.target + x, velocity: v, target: state.target },
    active: true,
  }
}

/** Creates a stateful 1D analytic spring handle driven in milliseconds. */
export function createSpring(initial: number, config: SpringConfig): SpringHandle {
  let state: SpringState = { value: initial, velocity: 0, target: initial }
  let active = false

  return {
    setTarget(target) {
      if (state.target === target) return
      state = { value: state.value, velocity: state.velocity, target }
      active = true
    },
    snap(value) {
      state = { value, velocity: 0, target: value }
      active = false
    },
    get() {
      return state
    },
    step(dtMs) {
      if (!active) return false
      const res = stepSpring(state, Math.max(0, dtMs) * 0.001, config)
      state = res.state
      active = res.active
      return active
    },
  }
}

function isSpringConfig(value: SpringConfig | Partial<Record<string, SpringConfig>>): value is SpringConfig {
  return 'stiffness' in value && value.stiffness !== undefined
}

/** Creates a keyed group of synchronized analytic springs sharing one `step(dtMs)` check. */
export function createSpringGroup<K extends string>(
  initial: Readonly<Record<K, number>>,
  config: SpringConfig | Readonly<Record<K, SpringConfig>>,
): SpringGroupHandle<K> {
  // SAFETY: Object.keys of Record<K, number> yields K[].
  const keys = Object.keys(initial) as K[]
  // SAFETY: Populated for every key of K in loop immediately below.
  const springs = {} as Record<K, SpringHandle>
  for (const key of keys) {
    const cfg = isSpringConfig(config) ? config : config[key]
    springs[key] = createSpring(initial[key], cfg)
  }

  return {
    setTargets(targets) {
      for (const key of keys) {
        const next = targets[key]
        if (next !== undefined) springs[key].setTarget(next)
      }
    },
    snap(values) {
      for (const key of keys) {
        const next = values[key]
        if (next !== undefined) springs[key].snap(next)
      }
    },
    values() {
      // SAFETY: Populated for every key of K in loop immediately below.
      const out = {} as Record<K, number>
      for (const key of keys) out[key] = springs[key].get().value
      return out
    },
    step(dtMs) {
      let anyActive = false
      for (const key of keys) {
        if (springs[key].step(dtMs)) anyActive = true
      }
      return anyActive
    },
    isActive() {
      for (const key of keys) {
        const st = springs[key].get()
        if (st.value !== st.target || st.velocity !== 0) return true
      }
      return false
    },
  }
}
