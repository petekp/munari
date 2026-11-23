// glassPress — the CTA's press value, a spring from 0 (resting) to 1 (sunk).
//
// Imperative on purpose: stiffness and damping are read from glassTuning on
// every frame, so the tweak sliders stay live without re-rendering anything.
// A retarget keeps the current velocity, so a release mid-press turns around
// smoothly. Midpoint integration at 1/240 s substeps matches motion's closed
// form spring within 0.002 for the tuning ranges (measured 2026-11-22).
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { glassTuning } from './glassTuning'

const PRESS_SUBSTEP = 1 / 240
const PRESS_REST_DELTA = 0.005
const PRESS_REST_SPEED = 0.01

/**
 * The press: how far down the CTA is, from 0 (resting) to 1 (fully sunk).
 *
 * One value drives everything the press does — the panel's depth toward
 * the form, the liquid bulge raised under the finger, and the weight of the
 * strike's spill. Deriving them all from a single spring is what keeps them
 * from disagreeing: three independently animated properties would arrive at
 * slightly different times and the button would look like it was assembled
 * from separate effects rather than pushed.
 *
 * The spring is imperative rather than declarative, and that is deliberate:
 * the stiffness and damping live in the tweak knobs, which by design never
 * re-render anything. A declarative hook would capture whatever config
 * existed at mount and quietly ignore the sliders; reading them at the
 * moment of the press is what makes them live. A retarget keeps the current
 * velocity, so a release mid-press turns around smoothly.
 */
export function usePressSpring() {
  const spring = useRef({ value: 0, velocity: 0, target: 0, frame: 0, last: 0 })
  const press = useMemo(() => ({ get: () => spring.current.value }), [])
  const set = useCallback((to: number) => {
    const s = spring.current
    s.target = to
    if (s.frame) return
    s.last = performance.now()
    const step = (now: number) => {
      const dt = Math.min((now - s.last) / 1000, 0.1)
      s.last = now
      const { pressStiffness: k, pressDamping: c } = glassTuning
      const substeps = Math.max(1, Math.ceil(dt / PRESS_SUBSTEP))
      const h = dt / substeps
      for (let i = 0; i < substeps; i++) {
        const a0 = -k * (s.value - s.target) - c * s.velocity
        const midValue = s.value + s.velocity * (h / 2)
        const midVelocity = s.velocity + a0 * (h / 2)
        s.value += midVelocity * h
        s.velocity += (-k * (midValue - s.target) - c * midVelocity) * h
      }
      const settled =
        Math.abs(s.value - s.target) < PRESS_REST_DELTA &&
        Math.abs(s.velocity) < PRESS_REST_SPEED
      if (settled) {
        s.value = s.target
        s.velocity = 0
        s.frame = 0
      } else {
        s.frame = requestAnimationFrame(step)
      }
    }
    s.frame = requestAnimationFrame(step)
  }, [])
  useEffect(() => {
    const s = spring.current
    return () => {
      cancelAnimationFrame(s.frame)
      s.frame = 0
    }
  }, [])
  return { press, set }
}
