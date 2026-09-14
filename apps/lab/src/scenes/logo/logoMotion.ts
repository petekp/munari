// Letter motion — the idle float and the hop between poses, on one carried clock.
//
// The law: a page letter and its scene twin read the same sample every frame,
// so a crossing can take the word at any moment, mid-hop included
// (decisions.md #30).
//
// The hop was a 620 ms CSS transform transition while the scene chased the
// same pose on its own spring. The two agreed only at rest, so the crossing
// waited the ease out behind a 670 ms dwell. Measured 2026-09-13 with the
// dwell removed: the page released 55-75 ms after a press with a hop 300-408 ms
// into its ease, and the swap frame changed up to 1.8 points more of the word
// than a crossing at rest (decisions.md #68).
//
// Ownership: this module owns the program. `Logo.tsx` and `MunariLogo.tsx`
// write each sample to their DOM letters; `logoScene.tsx` reads the same
// sample for the meshes.

import { springStep, type LetterPose } from './logoLaw'

/** A letter's hop, in the pose's own units: em, em, degrees, scale. */
export interface LetterHop {
  dx: number
  dy: number
  tilt: number
  scale: number
}

export interface LogoMotionSample {
  /** The idle float, em per letter. */
  float: number[]
  hops: LetterHop[]
}

interface Spring {
  x: number
  v: number
}

type HopSprings = Record<keyof LetterHop, Spring>

// The spring is integrated in steps no longer than this. `springStep` is
// explicit, and the carrier's clock can hand it a 100 ms frame.
const MAX_STEP_S = 1 / 60

const HOP_KEYS = ['dx', 'dy', 'tilt', 'scale'] as const

export function logoMotionProgram({
  floats,
  poses,
  floatAmplitude,
  reduced,
}: {
  floats: readonly { dur: number; delay: number }[]
  poses: { readonly current: readonly LetterPose[] }
  floatAmplitude: () => number
  reduced: MediaQueryList
}): (tMs: number) => LogoMotionSample {
  let amp = 0
  let lastT = 0
  const springs: HopSprings[] = []
  return (t) => {
    const dt = Math.min(t - lastT, 100)
    lastT = t
    const target = reduced.matches ? 0 : floatAmplitude()
    amp += (target - amp) * (1 - Math.exp(-dt / 150))
    const float = floats.map((f) => -Math.cos(((t - f.delay) / f.dur) * Math.PI * 2) * amp)
    const hops = poses.current.map((pose, i) => {
      // Seeded at the pose, so a letter is born standing where it belongs.
      const s = (springs[i] ??= {
        dx: { x: pose.dx, v: 0 },
        dy: { x: pose.dy, v: 0 },
        tilt: { x: pose.tilt, v: 0 },
        scale: { x: pose.scale, v: 0 },
      })
      for (const key of HOP_KEYS) {
        const spring = s[key]
        if (reduced.matches) {
          spring.x = pose[key]
          spring.v = 0
          continue
        }
        for (let left = dt / 1000; left > 0; left -= MAX_STEP_S) {
          const [x, v] = springStep(spring.x, spring.v, pose[key], Math.min(left, MAX_STEP_S))
          spring.x = x
          spring.v = v
        }
      }
      return { dx: s.dx.x, dy: s.dy.x, tilt: s.tilt.x, scale: s.scale.x }
    })
    return { float, hops }
  }
}

/** The transform a hop puts on a page letter. */
export function letterTransform(hop: LetterHop): string {
  return `translate(${hop.dx}em, ${hop.dy}em) rotate(${hop.tilt}deg) scale(${hop.scale})`
}
