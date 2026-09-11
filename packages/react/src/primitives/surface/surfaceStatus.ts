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
  /**
   * The capture engine this Surface's source was built from — `'html-in-canvas'`
   * unless the app installed another one. Here so a demo can badge which
   * machinery is running and documentation can attach limits to a name: the
   * engines are not supersets of each other, and a consumer comparing them
   * has no other way to tell which answered.
   */
  readonly engine: string
}

export function surfaceViewPresentation(value: SurfacePresentation): SurfaceViewPresentation {
  if (value === 'both') throw new Error('A Surface has one presentation. Use element capture when native HTML and a scene image must remain visible together.')
  if (value === 'canvas') return 'scene'
  return value === 'none' ? null : value
}
