// View callbacks — a Surface's public presentation callbacks, translated from
// the handle's canvas and page names into scene and page.
//
// The law: public callbacks name presentations as `SurfaceViewPresentation`
// does; the handle's own names stay internal.
//
// Ownership: Surface.Root and SceneSurface.Root pass these to the handle.

import { useMemo } from 'react'
import type { SurfaceControls } from '../Surface'
import type { SurfaceDestination, SurfacePresentation } from './surfaceHandle'
import { surfaceViewPresentation } from './surfaceStatus'
import { useLatest } from '../useLatest'

export function useViewCallbacks(controls: SurfaceControls) {
  const latest = useLatest(controls)
  return useMemo(() => ({
    onPresentationChange: (presentation: SurfacePresentation) => latest.current.onPresentationChange?.(surfaceViewPresentation(presentation)),
    onMotionComplete: (destination: SurfaceDestination) => latest.current.onMotionComplete?.(destination === 'canvas' ? 'scene' : 'page'),
  }), [latest])
}
