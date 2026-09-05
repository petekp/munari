// @vitest-environment happy-dom
//
// The phantom claim: a store parked in 'gl' after `view` demotes to
// `undefined` must not hold a busy claim once its presenter has unmounted.
//
// Two scenes in `apps/lab` (`Gallery.tsx`, `Refraction.tsx`) demote `view`
// from `'webgl'` to `undefined` on landing to suppress a one-frame flash of
// the leaving page. That demotion issues no `request('dom')`, so the store's
// crossing is left parked in 'gl', and the consumer unmounts the mesh with
// it. `SurfaceRoot` decides whether to hold a `host.claimWork()` from
// `isChanging || (isWebGLMounted && presenterRegistered)`: a genuine Twin
// keeps its presenter registered (claim holds, host keeps rendering it);
// a demoted, presenter-less store does not (claim releases, the
// `frameloop='demand'` Canvas is not pinned to 'always' over an empty
// scene). These tests pin the published contract that decision reads and
// the two invariants it has to hold in both cases.
import { describe, expect, it } from 'vitest'
import { createSurfaceStore } from './surfaceHandle'
import {
  createSurfaceHost,
  type SurfaceHost,
  type SurfaceHostRuntime,
} from './surfaceHostRegistry'

// The predicate `SurfaceRoot`'s tick evaluates. Stated here so the
// scheduling invariants below describe the requirement rather than reach
// into the component: a future predicate refactor has to keep producing
// this answer for the cases named here, or these tests fail.
const working = (state: {
  isChanging: boolean
  isWebGLMounted: boolean
  presenterRegistered: boolean
}): boolean => state.isChanging || (state.isWebGLMounted && state.presenterRegistered)

// A `RecordingRuntime` stands in for the bridge `SurfaceCanvas` installs:
// it records every `setBusy` promotion so a parked claim shows up as a
// `true` that never turns to `false`, and a released claim shows up as the
// `false` that follows it. The real bridge promotes a `frameloop='demand'`
// Canvas to 'always'; here the boolean IS the promotion.
const recordingRuntime = (host: SurfaceHost) => {
  const busy: boolean[] = []
  const runtime: SurfaceHostRuntime = {
    invalidate() {},
    setBusy(value: boolean) {
      busy.push(value)
    },
  }
  host.runtime = runtime
  return { busy }
}

// Drive one host frame exactly as `SurfaceCanvas` does: every registered
// tick, once. The tick registered below mirrors `SurfaceRoot`'s: it runs
// `store.tick`, reads the published state, and holds a claim while there is
// work.
const frame = (host: SurfaceHost, dtMs: number): void => {
  for (const tick of host.ticks()) tick(dtMs)
}

// Install `SurfaceRoot`'s tick. Returns the uninstaller, which also
// releases any live claim — the claim a parked store holds is what the
// assertions below need to read first.
const installTick = (host: SurfaceHost, store: ReturnType<typeof createSurfaceStore>) => {
  let claim: (() => void) | null = null
  const release = host.registerTick((dtMs) => {
    store.tick(dtMs)
    if (working(store.getState())) {
      if (!claim) claim = host.claimWork()
    } else if (claim) {
      claim()
      claim = null
    }
  })
  return () => {
    release()
    claim?.()
  }
}

// Lift a fresh exclusive store into 'gl' the way the gallery does: a fast
// crossing (`settleMs: 0, rampMs: 1`), one presenter, proven and presented.
const liftToGl = (store: ReturnType<typeof createSurfaceStore>) => {
  store.acquire(1)
  store.setExclusive(true)
  store.setTiming({ settleMs: 0, rampMs: 1 })
  const releasePresenter = store.registerPresenter('a')
  store.prove('a', store.readinessLifetime(), store.epoch())
  store.request('webgl')
  return { releasePresenter }
}

describe('presenterRegistered is published on SurfaceState', () => {
  it('tracks the readiness ledger and notifies on register and unregister', () => {
    const store = createSurfaceStore()
    expect(store.getState().presenterRegistered).toBe(false)
    let notifications = 0
    store.subscribe(() => {
      notifications += 1
    })
    const release = store.registerPresenter('a')
    expect(store.getState().presenterRegistered).toBe(true)
    expect(notifications).toBe(1)
    release()
    expect(store.getState().presenterRegistered).toBe(false)
    expect(notifications).toBe(2)
  })

  it('does not notify when nothing semantic changes', () => {
    // The reference-equality short-circuit in `publish()` must cover
    // `presenterRegistered`, or `useSyncExternalStore` re-renders every
    // frame a parked store is tickled for.
    const store = createSurfaceStore()
    store.acquire(1)
    store.setExclusive(true)
    store.setTiming({ settleMs: 0, rampMs: 1 })
    store.registerPresenter('a')
    store.prove('a', store.readinessLifetime(), store.epoch())
    store.request('webgl')
    store.tick(500) // lifting → gl
    store.tick(16) // ramp to 1
    let notifications = 0
    store.subscribe(() => {
      notifications += 1
    })
    // Ticking a 'gl' store at ramp 1 advances nothing semantic.
    store.tick(16)
    store.tick(16)
    expect(notifications).toBe(0)
  })
})

describe('the busy-claim predicate', () => {
  it('holds the claim for a Twin whose mesh stays mounted', () => {
    // The invariant a genuine Twin relies on: a presenter that never
    // unmounts keeps the host rendering it. Widening the predicate to drop
    // the `presenterRegistered` term, or replacing it with a linger window,
    // would release this claim and stop rendering a permanently-mounted
    // WebGL side.
    const host = createSurfaceHost()
    const { busy } = recordingRuntime(host)
    const store = createSurfaceStore('panel')
    const stop = installTick(host, store)
    const { releasePresenter } = liftToGl(store)
    frame(host, 500)
    frame(host, 16)
    store.present('a', store.epoch())
    // Demote to a Twin that KEEPS its mesh mounted: no request('dom'), and
    // the presenter stays registered. The claim must hold.
    for (let i = 0; i < 300; i++) frame(host, 16)
    expect(host.workClaims()).toBe(1)
    expect(busy).toContain(true)
    expect(busy).not.toContain(false)
    releasePresenter()
    stop()
  })

  it('releases the claim when the presenter unmounts on landing', () => {
    // The gallery/refraction landing: the mesh unmounts (presenter
    // unregisters) and the view demotes to undefined (no request('dom')),
    // leaving the store parked in 'gl' with isWebGLMounted still true. The
    // claim releases the moment the presenter is gone — without this, a
    // presenter-less store pins the host busy over an empty scene forever.
    const host = createSurfaceHost()
    const { busy } = recordingRuntime(host)
    const store = createSurfaceStore('panel')
    const stop = installTick(host, store)
    const { releasePresenter } = liftToGl(store)
    frame(host, 500)
    frame(host, 16)
    store.present('a', store.epoch())
    releasePresenter()
    for (let i = 0; i < 300; i++) frame(host, 16)
    expect(host.workClaims()).toBe(0)
    expect(busy).toContain(false)
    stop()
  })
})
