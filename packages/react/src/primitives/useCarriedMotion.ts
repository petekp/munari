// Carried motion, bound to React.
//
// The kernel owns the law (packages/core motionCarrier): one clock, one
// evaluation per frame, readers never advance time. This hook owns the
// clock's driver and the page-side output, which is the half the kernel
// is not allowed to know: a rAF loop that ticks the carrier and hands
// the fresh sample to `apply` — the consumer's style writer. The mesh
// side reads `sample()` inside useFrame and gets the same number,
// because sampling never re-evaluates.
//
// The loop runs from mount to unmount, across every crossing phase —
// that is the point. A carried motion never eases flat and is EXEMPT
// from the crossing's settle dwell: both presenters output one source
// of truth, so the swap lands mid-flight with position and velocity
// intact. Size `settleMs` to the compositor-clocked transitions that
// remain (hops, color fades), not to this.
//
// Two honest notes. First, ordering: this loop and r3f's are separate
// rAF callbacks in the same frame; if the renderer's runs first, the
// mesh reads the previous frame's sample — one frame of staleness,
// sub-pixel at idle-motion speeds, and never a double image because
// presentation custody shows only one side at a time. Second, cost:
// carrying moves the motion from the compositor's free thread onto the
// main thread. A page under heavy script load will stutter a carried
// motion where a CSS animation would have glided — which is why
// carrying is a per-motion declaration and not what Surfaces do to
// your animations by default (docs/authoring.md keeps the ease-flat
// pattern for everything compositor-clocked).

import { useEffect, useMemo } from 'react'
import { createMotionCarrier } from '@munari/core'
import { useLatest } from './useLatest'

export interface CarriedMotion<T> {
  /** This frame's value — every reader in the frame sees the same
   *  number. Read it inside useFrame for the mesh side. */
  sample: () => T
}

export function useCarriedMotion<T>(
  program: (tMs: number) => T,
  apply: (value: T) => void,
): CarriedMotion<T> {
  // The program and applier are read through refs so a re-created
  // closure (a knob changed, a take re-rolled) swaps the math without
  // resetting the carrier's epoch — the motion keeps its place in time.
  const programRef = useLatest(program)
  const applyRef = useLatest(apply)

  const carrier = useMemo(
    () => createMotionCarrier((tMs: number) => programRef.current(tMs)),
    [programRef],
  )

  useEffect(() => {
    let id = 0
    const loop = (nowMs: number) => {
      applyRef.current(carrier.tick(nowMs))
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [carrier, applyRef])

  return useMemo(() => ({ sample: carrier.sample }), [carrier])
}
