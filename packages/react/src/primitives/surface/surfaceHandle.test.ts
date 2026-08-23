// @vitest-environment happy-dom
//
// The handle's contract: identity only.
//
// Three properties are pinned here because each one fails silently. A
// handle that allocates would leak for every piece of content a data store
// holds off screen. A handle that publishes per frame would put a React
// commit between every pair of frames of a transition, which shows up as
// jank rather than as an error. And a controller ledger that ignores tokens
// ends up released while a live component believes it holds the identity —
// Strict Mode produces that ordering on every development mount.
//
// No JSX here: the runner only discovers `.test.ts`, and widening test
// discovery across the workspace is not worth one module's contract.
import { StrictMode, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { crossingProgress } from '@munari/core'
import {
  createSurface,
  createSurfaceStore,
  surfaceStoreOf,
  useSurfaceController,
  useSurfaceControls,
  useSurfaceStore,
  type SurfaceControls,
  type SurfaceView,
} from './surfaceHandle'

// React reads this global to decide whether renders must be wrapped in
// `act`. It is React's own contract, not ours, so it is declared rather
// than asserted onto globalThis at the point of use.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = false

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  container.remove()
})

describe('a handle owns no DOM and no renderer resource', () => {
  it('a created handle registers nothing and starts on the page', () => {
    const store = createSurfaceStore('panel')
    expect(store.hasController()).toBe(false)
    expect(store.epoch()).toBe(0)
    expect(store.getState()).toMatchObject({
      targetView: 'dom',
      presentedView: 'dom',
      ready: false,
      isChanging: false,
      isWebGLMounted: false,
    })
    expect(store.handle.progress.get()).toBe(0)
  })

  it('a handle whose components have all unmounted reports zero registrations', () => {
    // The retained-handle case: a store keeps handles for content that is
    // not on screen, and every one of them must be inert.
    const store = createSurfaceStore()
    const release = store.registerPresenter('a')
    store.acquire(1)
    expect(store.getState().ready).toBe(false)
    store.prove('a', store.readinessLifetime(), store.epoch())
    expect(store.getState().ready).toBe(true)
    release()
    store.release(1)
    expect(store.getState().ready).toBe(false)
    expect(store.hasController()).toBe(false)
  })
})

describe('the controller ledger', () => {
  it('acquire, release, and reacquire advance the epoch', () => {
    const store = createSurfaceStore()
    expect(store.acquire(1)).toBe(true)
    expect(store.epoch()).toBe(1)
    store.release(1)
    expect(store.acquire(2)).toBe(true)
    expect(store.epoch()).toBe(2)
  })

  it('a second controller is refused and the incumbent keeps the identity', () => {
    const store = createSurfaceStore()
    store.acquire(1)
    expect(store.acquire(2)).toBe(false)
    expect(store.epoch()).toBe(1)
    // The refused controller cannot release the identity it never held.
    store.release(2)
    expect(store.hasController()).toBe(true)
  })

  it('reports the duplicate through onError, naming the handle', () => {
    const store = createSurfaceStore('panel')
    const errors: Error[] = []
    store.setCallbacks({ onError: (error) => errors.push(error) })
    // A token no component can mint, so the incumbent here is unambiguously
    // not the component below — re-acquiring with the SAME token is
    // idempotent by design, and would report no fault.
    store.acquire(-1)

    const Second = () => {
      useSurfaceController(store)
      return null
    }
    const root = createRoot(container)
    flushSync(() => root.render(createElement(Second)))
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('panel')
    flushSync(() => root.unmount())
  })

  it("Strict Mode's double invoke leaves the live mount holding", () => {
    // React runs the first mount's cleanup AFTER the second mount's setup.
    // A ledger that released unconditionally would end up free while the
    // component on screen believes it holds the identity, and every
    // registration made after that point is attributed to nobody.
    const store = createSurfaceStore()
    const Controller = () => {
      useSurfaceController(store)
      return null
    }
    const root = createRoot(container)
    flushSync(() =>
      root.render(createElement(StrictMode, null, createElement(Controller))),
    )
    expect(store.hasController()).toBe(true)
    flushSync(() => root.unmount())
    expect(store.hasController()).toBe(false)
  })
})

describe('controlled options and the latest callback', () => {
  let seen: ReturnType<typeof useSurfaceStore> | null = null

  // Declared once, outside the helper: a component type created per render
  // is a DIFFERENT type to React, which remounts the tree and hands back a
  // fresh handle — the exact thing these cases claim does not happen.
  const Host = (props: SurfaceControls) => {
    const store = useSurfaceStore('panel')
    useSurfaceControls(store, props)
    seen = store
    return null
  }

  const render = (root: ReturnType<typeof createRoot>, options: SurfaceControls) => {
    flushSync(() => root.render(createElement(Host, options)))
  }

  it('view is read on every render, and the handle stays stable across them', () => {
    const root = createRoot(container)
    render(root, { view: 'dom' })
    const first = seen
    expect(first?.getState().targetView).toBe('dom')
    render(root, { view: 'webgl' })
    expect(seen).toBe(first)
    expect(seen?.getState().targetView).toBe('webgl')
    flushSync(() => root.unmount())
  })

  it('the newest callback runs without resetting the handle', () => {
    const root = createRoot(container)
    const heard: string[] = []
    render(root, { view: 'dom', onPresentedViewChange: () => heard.push('first') })
    const store = seen
    render(root, { view: 'dom', onPresentedViewChange: () => heard.push('second') })
    expect(seen).toBe(store)
    // Drive a full forward crossing: a controller (receipts are refused
    // without one), one presenter, proven, then the settle dwell and the ramp.
    store?.acquire(1)
    store?.registerPresenter('a')
    store?.prove('a', store.readinessLifetime(), store.epoch())
    store?.request('webgl')
    store?.tick(500)
    expect(heard).toEqual(['second'])
    flushSync(() => root.unmount())
  })

  it('releases component callbacks when the controller unmounts', () => {
    const root = createRoot(container)
    const heard: SurfaceView[] = []
    render(root, { view: 'dom', onPresentedViewChange: (view) => heard.push(view) })
    const store = seen
    flushSync(() => root.unmount())
    store?.acquire(1)
    store?.registerPresenter('a')
    store?.prove('a', store.readinessLifetime(), store.epoch())
    store?.request('webgl')
    store?.tick(500)
    expect(heard).toEqual([])
  })

  it('timing is controlled: a longer settle holds the page longer', () => {
    const store = createSurfaceStore()
    store.acquire(1)
    store.setTiming({ settleMs: 1000, rampMs: 600 })
    store.registerPresenter('a')
    store.prove('a', store.readinessLifetime(), store.epoch())
    store.request('webgl')
    store.tick(500)
    expect(store.getState().presentedView).toBe('dom')
    store.tick(600)
    expect(store.getState().presentedView).toBe('webgl')
  })
})

describe('semantic publication', () => {
  it('subscribers hear phase changes, not frames', () => {
    // The ramp moves every frame. A subscriber woken by each new value
    // would commit React between every pair of frames of a transition.
    const store = createSurfaceStore()
    store.acquire(1)
    let heard = 0
    store.subscribe(() => {
      heard += 1
    })
    store.registerPresenter('a')
    store.prove('a', store.readinessLifetime(), store.epoch())
    store.request('webgl')
    store.tick(500) // lifting → gl: one semantic change
    const afterHandoff = heard
    store.tick(16)
    store.tick(16)
    store.tick(16)
    // The ramp advanced three times and published nothing.
    expect(store.handle.progress.get()).toBeGreaterThan(0)
    expect(heard).toBe(afterHandoff)
  })

  it('progress windows are zero at both handoff edges', () => {
    const store = createSurfaceStore()
    expect(store.handle.progress.between(0.2, 0.8)).toBe(0)
    expect(store.handle.progress.pulse(0.2, 0.8)).toBe(0)
  })

  it('a source replacement voids readiness and starts a new lifetime', () => {
    const store = createSurfaceStore()
    store.acquire(1)
    store.registerPresenter('a')
    const first = store.readinessLifetime()
    store.prove('a', first, store.epoch())
    expect(store.getState().ready).toBe(true)
    store.replaceSource()
    expect(store.getState().ready).toBe(false)
    // The old lifetime's receipt cannot prove the new source.
    store.prove('a', first, store.epoch())
    expect(store.getState().ready).toBe(false)
    store.prove('a', store.readinessLifetime(), store.epoch())
    expect(store.getState().ready).toBe(true)
  })

  it('reversal mid-crossing returns the hold without skipping the far side', () => {
    const store = createSurfaceStore()
    store.acquire(1)
    store.registerPresenter('a')
    store.prove('a', store.readinessLifetime(), store.epoch())
    store.request('webgl')
    store.tick(500)
    expect(store.getState().presentedView).toBe('webgl')
    store.tick(300) // ramp half way
    const midway = store.handle.progress.get()
    expect(midway).toBeGreaterThan(0)
    expect(midway).toBeLessThan(1)
    const back: SurfaceView = 'dom'
    store.request(back)
    store.tick(300)
    expect(store.handle.progress.get()).toBe(0)
    expect(store.getState().presentedView).toBe('dom')
  })
})

describe('the two-stage receipt', () => {
  // A warm-up opens the lift gate; only a color-writing draw releases the
  // page (decisions.md #25). Making stage one wait for color is a deadlock:
  // color is exactly what the lift gate is deciding whether to allow.
  const exclusiveStore = () => {
    const store = createSurfaceStore('panel')
    store.acquire(1)
    store.setExclusive(true)
    store.registerPresenter('a')
    return store
  }

  it('a warm-up opens the lift gate without releasing the page', () => {
    const store = exclusiveStore()
    store.prove('a', store.readinessLifetime(), store.epoch())
    store.request('webgl')
    store.tick(500)
    // Presentation authority has moved, which is what authorizes the next
    // draw to write color. The page is still what is ON SCREEN until that
    // draw completes.
    expect(store.canvasPresents()).toBe(true)
    expect(store.holdsPage()).toBe(true)
    expect(store.getState().presentedView).toBe('dom')
  })

  it('the page is released by the color-writing draw, in that draw', () => {
    const store = exclusiveStore()
    const heard: boolean[] = []
    store.subscribeHold(() => heard.push(store.holdsPage()))
    store.prove('a', store.readinessLifetime(), store.epoch())
    store.request('webgl')
    store.tick(500)
    store.present('a', store.epoch())
    expect(store.holdsPage()).toBe(false)
    expect(heard).toEqual([false])
    expect(store.getState().presentedView).toBe('webgl')
  })

  // Input follows the eye (decisions.md #33), and the eye follows the HOLD:
  // hearing must not move at the phase turn, because the pixels move in
  // that frame's draw — a phase-read here would let the canvas hear clicks
  // while the page copy is still the one on screen.
  it('the canvas hears the pointer only once the releasing draw has run', () => {
    const store = exclusiveStore()
    store.prove('a', store.readinessLifetime(), store.epoch())
    store.request('webgl')
    store.tick(500)
    // Presentation authority has moved; the page is still on screen.
    expect(store.canvasPresents()).toBe(true)
    expect(store.canvasHearsPointer()).toBe(false)
    store.present('a', store.epoch())
    expect(store.canvasHearsPointer()).toBe(true)
  })

  it('hearing returns to the page with the hold, at the reclaim', () => {
    const store = exclusiveStore()
    store.prove('a', store.readinessLifetime(), store.epoch())
    store.request('webgl')
    store.tick(500)
    store.present('a', store.epoch())
    store.request('dom')
    store.tick(5000)
    expect(store.holdsPage()).toBe(true)
    expect(store.canvasHearsPointer()).toBe(false)
  })

  it('a Twin always hears — hearing is an exclusivity question', () => {
    const store = createSurfaceStore('twin')
    store.acquire(1)
    expect(store.canvasHearsPointer()).toBe(true)
  })

  it('toggling exclusivity notifies the hold listeners', () => {
    // The one hearing flip with no hold movement: a Twin gaining `view`.
    // The edge bursts listen on the hold, so this edge reaches them too.
    const store = createSurfaceStore('twin')
    store.acquire(1)
    let heard = 0
    store.subscribeHold(() => heard++)
    store.setExclusive(true)
    expect(heard).toBe(1)
    expect(store.canvasHearsPointer()).toBe(false)
    store.setExclusive(true)
    expect(heard).toBe(1)
    store.setExclusive(false)
    expect(heard).toBe(2)
    expect(store.canvasHearsPointer()).toBe(true)
  })

  it('a color-writing draw before the lift gate releases nothing', () => {
    // A resident presentation of a Surface that is still the page's.
    const store = exclusiveStore()
    store.present('a', store.epoch())
    expect(store.holdsPage()).toBe(true)
  })

  it('one presenter of two cannot release the page on its own', () => {
    // Atomic: a page copy hidden while one part is still warming is a word
    // with a hole in it.
    const store = exclusiveStore()
    store.registerPresenter('b')
    store.prove('a', store.readinessLifetime(), store.epoch())
    store.prove('b', store.readinessLifetime(), store.epoch())
    store.request('webgl')
    store.tick(500)
    store.present('a', store.epoch())
    expect(store.holdsPage()).toBe(true)
    store.present('b', store.epoch())
    expect(store.holdsPage()).toBe(false)
  })

  it('a presenter that remounts mid-crossing does not take its presentation with it', () => {
    // Strict Mode remounts every presenter on a development mount, and a
    // presenter declared in the same commit that starts the crossing can
    // draw between the two. Its stage-two entry has to leave with it: kept,
    // it reads as "already presented", the new instance's own draw returns
    // at the duplicate guard, and the page is never released.
    const store = createSurfaceStore('panel')
    store.acquire(1)
    store.setExclusive(true)
    const release = store.registerPresenter('a')
    store.prove('a', store.readinessLifetime(), store.epoch())
    store.request('webgl')
    store.tick(500)

    // The unmount half of the remount lands first, so the draw already in
    // flight arrives with nothing registered and releases nothing.
    release()
    store.present('a', store.epoch())
    expect(store.holdsPage()).toBe(true)

    store.registerPresenter('a')
    store.prove('a', store.readinessLifetime(), store.epoch())
    store.present('a', store.epoch())
    expect(store.holdsPage()).toBe(false)
  })

  it('the page takes the hold back at the end of the return, with no proof', () => {
    const store = exclusiveStore()
    store.prove('a', store.readinessLifetime(), store.epoch())
    store.request('webgl')
    store.tick(500)
    store.present('a', store.epoch())
    expect(store.holdsPage()).toBe(false)
    store.request('dom')
    store.tick(700) // the whole ramp home
    expect(store.holdsPage()).toBe(true)
    // And a second lift has to earn its release again.
    store.request('webgl')
    store.tick(500)
    expect(store.holdsPage()).toBe(true)
    store.present('a', store.epoch())
    expect(store.holdsPage()).toBe(false)
  })

  it('a Twin never releases its page copy', () => {
    const store = createSurfaceStore()
    store.acquire(1)
    store.registerPresenter('a')
    store.prove('a', store.readinessLifetime(), store.epoch())
    store.present('a', store.epoch())
    expect(store.holdsPage()).toBe(true)
  })

  it('a receipt from a departed controller proves nothing', () => {
    // A host-tail receipt is minted during a draw and closed at the end of
    // the frame. A Surface whose controller unmounted in between must not be
    // proven by pixels nobody speaks for any more.
    const store = exclusiveStore()
    const epoch = store.epoch()
    store.release(1)
    store.acquire(2)
    store.prove('a', store.readinessLifetime(), epoch)
    expect(store.getState().ready).toBe(false)
  })
})

describe('a scene-owned ramp', () => {
  /** An exclusive Surface already past the lift gate. */
  const airborne = () => {
    const store = createSurfaceStore('panel')
    store.acquire(1)
    store.setExclusive(true)
    store.registerPresenter('a')
    store.prove('a', store.readinessLifetime(), store.epoch())
    store.request('webgl')
    store.tick(500)
    store.present('a', store.epoch())
    return store
  }

  it('takes the ramp the driver answers instead of the clock', () => {
    const store = airborne()
    store.drive(() => 0.25)
    store.tick(16)
    expect(store.handle.progress.get()).toBeCloseTo(crossingProgress(0.25), 6)
  })

  it('tells the driver where the crossing is and where it is going', () => {
    const store = airborne()
    const seen: unknown[] = []
    store.drive((frame) => {
      seen.push({ phase: frame.phase, target: frame.target, progress: frame.progress })
      return 0.5
    })
    store.tick(16)
    expect(seen).toEqual([{ phase: 'gl', target: 'webgl', progress: 0 }])
  })

  // A driver that decides the page may let go would make the whole evidence
  // rule optional. The gate is the protocol's, always.
  it('cannot buy its way past the lift gate', () => {
    const store = createSurfaceStore('panel')
    store.acquire(1)
    store.setExclusive(true)
    store.registerPresenter('a')
    store.drive(() => 1)
    store.request('webgl')
    store.tick(500)
    expect(store.holdsPage()).toBe(true)
    expect(store.handle.progress.get()).toBe(0)
  })

  it('reports a driver that answered something that is not a number', () => {
    const errors: Error[] = []
    const store = airborne()
    store.setCallbacks({ onError: (error) => errors.push(error) })
    store.drive(() => Number.NaN)
    store.tick(16)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('driver answered NaN')
    // And the ramp stayed where it was rather than teleporting.
    expect(store.handle.progress.get()).toBe(0)
  })

  // The fault: an exponential decay reaches 1e-9 and stays there, so the
  // page never takes the hold back and the content sits in WebGL at a
  // progress nobody can see is not zero.
  it('lands exactly when the driver decays toward zero', () => {
    const store = airborne()
    let ramp = 1
    store.drive(() => ramp)
    store.tick(16)
    expect(store.holdsPage()).toBe(false)
    store.request('dom')
    ramp = 1e-9
    store.tick(16)
    expect(store.getState().presentedView).toBe('webgl')
    ramp = 0
    store.tick(16)
    expect(store.getState().presentedView).toBe('dom')
    expect(store.handle.progress.get()).toBe(0)
    expect(store.holdsPage()).toBe(true)
  })

  it('gives the ramp back to the timed motion when the driver is removed', () => {
    const store = airborne()
    store.drive(() => 0.3)
    store.tick(16)
    const driven = store.handle.progress.get()
    expect(driven).toBeCloseTo(crossingProgress(0.3), 6)
    store.drive(null)
    store.tick(600)
    expect(store.handle.progress.get()).toBeGreaterThan(driven)
  })
})

describe('the public handle is identity only', () => {
  // The store drives the protocol — acquire, tick, present, release. A
  // public `createSurface` that answered with one would put every one of
  // those in reach of a caller who only wanted a name to pass around, and
  // the components below it would be arguing with them for the pixels.
  it('createSurface answers with a handle, not the store', () => {
    const handle = createSurface('panel')
    expect(Object.keys(handle)).toEqual(['progress'])
    expect(handle.progress.get()).toBe(0)
  })

  it('the name reaches the store behind the handle', () => {
    const handle = createSurface('panel')
    expect(surfaceStoreOf(handle).name).toBe('panel')
  })

  it('two handles are two identities', () => {
    const first = createSurface()
    const second = createSurface()
    expect(surfaceStoreOf(first)).not.toBe(surfaceStoreOf(second))
  })

  it('refuses an object shaped like a handle', () => {
    const impostor = { progress: createSurface().progress }
    expect(() => surfaceStoreOf(impostor)).toThrow(/not a Surface handle/)
  })

  it('a handle created and never mounted registers nothing', () => {
    const handle = createSurface('panel')
    const store = surfaceStoreOf(handle)
    expect(store.hasController()).toBe(false)
    expect(store.getState().ready).toBe(false)
    expect(store.parts()).toEqual([])
  })
})
