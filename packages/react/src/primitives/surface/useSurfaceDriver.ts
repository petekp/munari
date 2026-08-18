// useSurfaceDriver — hand a Surface's excursion ramp to a scene.
//
// The law: a driver decides HOW the crossing moves, never whether the page
// may let go. The lift gate, the settle dwell, and the exact-zero landing
// are the protocol's; the shape of the motion between them is the scene's,
// which is what lets a card fly on real physics instead of a duration
// somebody guessed.
//
// Ownership: this hook owns the installation and its removal. The step
// function is read through a ref, so a scene may pass a fresh closure every
// render — reinstalling per render would restart the motion every commit.

import { use, useEffect } from 'react'
import { useLatest } from '../useLatest'
import { SurfaceRootContext } from './surfaceContext'
import {
  surfaceStoreOf,
  type SurfaceDriverFrame,
  type SurfaceDriverStep,
  type SurfaceHandle,
} from './surfaceHandle'

/**
 * Drive `surface`'s ramp, or the enclosing `<Surface>`'s when no handle is
 * given. Passing `null` gives the ramp back to the built-in timed motion.
 */
export function useSurfaceDriver(
  surface: SurfaceHandle | null | undefined,
  step: SurfaceDriverStep | null,
): void {
  const root = use(SurfaceRootContext)
  const store = surface ? surfaceStoreOf(surface) : (root?.store ?? null)
  const stepRef = useLatest(step)
  const driving = step !== null

  useEffect(() => {
    if (!store || !driving) return
    store.drive((frame: SurfaceDriverFrame) => stepRef.current?.(frame) ?? frame.progress)
    return () => store.drive(null)
  }, [store, driving, stepRef])
}
