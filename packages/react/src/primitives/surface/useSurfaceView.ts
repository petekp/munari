// The view a scene is asking for — one handle, the renderer it should be in,
// and the mount that trails it.
//
// The law: a scene owns WHICH renderer holds its content; the protocol owns
// WHEN the WebGL side may go. Those are two different clocks. A landed
// crossing keeps its presenter mounted through the reclaim linger, so
// unmounting on the view change instead tears the mesh down inside the very
// commit that is handing the pixels back — one frame where neither side
// draws.
//
// The fault, 2026-08-23: the lab's own version of this returned `mounted`
// plus a `released()` the consumer had to wire to `onWebGLReleased` by hand,
// and all five scenes using it wired it separately. Nothing typed the
// obligation — a scene that forgot got the one-frame hole, which reads as a
// flicker at the end of a transition and is invisible in review. It also
// took `'webgl'` for an answer on a browser with no trial, which parks the
// crossing at `lifting` forever; the logo scene shipped exactly that and
// threw on the way back, because react-three-fiber's `onCreated` was still
// pending when the Canvas unmounted.
//
// The split: the request is the scene's, and it is refused here when it
// cannot be honoured. The release is the protocol's, read from
// `isWebGLMounted` rather than asked of the caller.

import { useCallback, useState } from 'react'
import { useSurface, useSurfaceState } from './surfaceHandle'
import type { SurfaceHandle, SurfaceState, SurfaceView } from './surfaceHandle'

export interface SurfaceViewControls {
  /** Give this to the `<Surface surface={…}>` and to the meshes reading it. */
  readonly surface: SurfaceHandle
  /** The renderer being asked for. Pass to `<Surface view={…}>`. */
  readonly view: SurfaceView
  /** What the protocol reports, including `supported`. */
  readonly state: SurfaceState
  /** Mount the WebGL side while this is true. Covers the reclaim linger. */
  readonly mounted: boolean
  /** Ask for a renderer. Asking for one that cannot arrive does nothing. */
  show(view: SurfaceView): void
}

/**
 * One piece of content that can change hands and change back.
 *
 * `show('webgl')` is refused where the trial is absent, so `view` never
 * names a renderer that cannot arrive and a scene reading `view` cannot
 * arm a transition nothing will finish. Read `state.supported` to render a
 * different affordance instead — or `useSupportsDOMSurfaces` where the
 * branch sits above the Surface.
 */
export function useSurfaceView(name?: string): SurfaceViewControls {
  const surface = useSurface(name)
  const state = useSurfaceState(surface)
  const [view, setView] = useState<SurfaceView>('dom')

  // Seeded at store creation and carried forward unchanged, so this is a
  // constant for the handle's life.
  const supported = state.supported
  const show = useCallback(
    (next: SurfaceView) => setView(next === 'webgl' && !supported ? 'dom' : next),
    [supported],
  )

  // The two clocks, OR'd. The request raises it before the protocol has
  // seen anything — the renderer has to exist for the protocol to advance
  // from it — and `isWebGLMounted` holds it up afterwards, through the
  // landing and the reclaim linger, until the pixels are the page's again.
  // Neither term alone spans the whole mount.
  return { surface, view, state, mounted: view === 'webgl' || state.isWebGLMounted, show }
}
