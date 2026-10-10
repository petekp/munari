// useSurfaceDriver — hand a Surface's excursion ramp to a scene.
//
// The law: a driver decides HOW the crossing moves, never whether the page
// may let go. The lift gate and the exact-zero landing are the protocol's;
// the shape of the motion between them is the scene's,
// which is what lets a card fly on real physics instead of a duration
// somebody guessed.
//
// Ownership: this hook owns the installation and its removal. The step
// function is read through a ref, so a scene may pass a fresh closure every
// render — reinstalling per render would restart the motion every commit.

import { use, useEffect } from 'react'
import { useLatest } from '../useLatest'
import { SurfaceHandleContext } from './surfaceContext'
import {
  surfaceStoreOf,
  type SurfaceDriverFrame,
  type SurfaceDriverStep,
  type SurfaceHandle,
  type SurfaceStore,
} from './surfaceHandle'

/** The explicit handle's store, else the enclosing Surface's, else null. */
export function useSurfaceStoreOf(surface?: SurfaceHandle): SurfaceStore | null {
  const context = use(SurfaceHandleContext)
  return surface ? surfaceStoreOf(surface) : (context?.store ?? null)
}

/**
 * Drive the enclosing Surface's ramp, or pass an explicit handle second.
 * Passing `null` gives the ramp back to the built-in step.
 */
export function useSurfaceDriver(
  step: SurfaceDriverStep | null,
  surface?: SurfaceHandle,
): void {
  const store = useSurfaceStoreOf(surface)
  const stepRef = useLatest(step)
  const driving = step !== null

  useEffect(() => {
    if (!store || !driving) return
    store.drive((frame: SurfaceDriverFrame) => stepRef.current?.(frame) ?? frame.progress)
    return () => store.drive(null)
  }, [store, driving, stepRef])
}
