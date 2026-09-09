// Surface observations distinguish author intent, preparation, and accepted presentation.
// The retained-content API does not collapse a simultaneous legacy hold into one side.
import type { SurfacePresentation } from './surfaceHandle'

export type SurfaceViewPresentation = 'page' | 'scene' | null
export type SurfaceViewDestination = 'page' | 'scene'

export interface SurfaceStatus {
  readonly requestedInScene: boolean
  readonly presentation: SurfaceViewPresentation
  readonly sceneReady: boolean
  readonly isTransitioning: boolean
  readonly supported: boolean
  readonly reason: string | null
}

export function surfaceViewPresentation(value: SurfacePresentation): SurfaceViewPresentation {
  if (value === 'both') throw new Error('A Surface has one presentation. Use element capture when native HTML and a scene image must remain visible together.')
  if (value === 'canvas') return 'scene'
  return value === 'none' ? null : value
}
