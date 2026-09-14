// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import {
  createSurfaceHost,
  mountSurfaceHost,
  resetSurfaceHosts,
  resolveSurfaceHost,
  surfaceHost,
  type SurfaceHostRuntime,
} from './surfaceHostRegistry'

interface RecordingRuntime extends SurfaceHostRuntime {
  readonly busy: boolean[]
  frames: number
}

const runtime = (): RecordingRuntime => {
  const record: RecordingRuntime = {
    busy: [],
    frames: 0,
    invalidate: () => {
      record.frames += 1
    },
    setBusy: (busy) => {
      record.busy.push(busy)
    },
  }
  return record
}

beforeEach(resetSurfaceHosts)

describe('host identity', () => {
  it('returns one host per id, and a distinct default', () => {
    expect(surfaceHost('a')).toBe(surfaceHost('a'))
    expect(surfaceHost('a')).not.toBe(surfaceHost('b'))
    expect(surfaceHost()).toBe(surfaceHost())
    expect(surfaceHost()).not.toBe(surfaceHost('a'))
  })

  it('resolves the default host before any Canvas mounts', () => {
    // A page tree that commits before the Canvas below it is ordinary
    // React, not a mistake — registration is allowed to precede the host.
    expect(resolveSurfaceHost()).toBe(surfaceHost())
  })

  it('resolves the single mounted host when the caller named none', () => {
    const only = surfaceHost('scene')
    mountSurfaceHost(only)
    expect(resolveSurfaceHost()).toBe(only)
  })

  it('refuses to guess between several mounted hosts', () => {
    // Null is the ambiguity fault. Picking one silently produces a Surface
    // that renders in the wrong canvas with nothing anywhere saying so.
    mountSurfaceHost(surfaceHost('left'))
    mountSurfaceHost(surfaceHost('right'))
    expect(resolveSurfaceHost()).toBeNull()
    expect(resolveSurfaceHost('right')).toBe(surfaceHost('right'))
  })

  it('forgets a host runtime when its Canvas unmounts', () => {
    const host = surfaceHost('gone')
    const unmount = mountSurfaceHost(host)
    host.runtime = runtime()
    unmount.release()
    expect(host.runtime).toBeNull()
    expect(resolveSurfaceHost()).toBe(surfaceHost())
    // A registration that outlives its Canvas is harmless, not a throw.
    expect(() => host.invalidate()).not.toThrow()
  })

  it('announces renderer bootstrap once the mounted host has a runtime', () => {
    const host = surfaceHost('boot')
    const mount = mountSurfaceHost(host)
    const seen: Array<SurfaceHostRuntime | null> = []
    const release = host.subscribeRuntime(() => seen.push(host.runtime))
    const live = runtime()
    host.setRuntime(live)
    expect(host.mounted()).toBe(true)
    expect(seen).toEqual([live])
    release()
    mount.release()
  })
})

describe('registration', () => {
  it('hands back a stable empty snapshot', () => {
    // `useSyncExternalStore` compares by reference; a fresh [] per read is
    // an infinite render loop, not a slow one.
    const host = surfaceHost()
    expect(host.sources()).toBe(host.sources())
    expect(host.presenters()).toBe(host.presenters())
  })

  it('replaces by key without the old release deleting the new entry', () => {
    const host = surfaceHost()
    const container = document.createElement('div')
    const release = host.registerSource({ key: 'k', container, content: 'first' })
    host.registerSource({ key: 'k', container, content: 'second' })
    release()
    expect(host.sources()).toHaveLength(1)
    expect(host.sources()[0]?.content).toBe('second')
  })

  it('notifies subscribers on both directions', () => {
    const host = surfaceHost()
    const sources: string[][] = [], presenters: string[][] = []
    const stopSources = host.subscribeSources(() => sources.push(host.sources().map(entry => entry.key)))
    const stopPresenters = host.subscribePresenters(() => presenters.push(host.presenters().map(entry => entry.key)))
    const leaveSource = host.registerSource({ key: 's', container: document.createElement('div'), content: null })
    expect(sources).toEqual([['s']])
    expect(presenters).toEqual([])
    const leavePresenter = host.registerPresenter({ key: 'p', element: createElement('mesh') })
    expect(presenters).toEqual([['p']])
    leaveSource()
    expect(sources).toEqual([['s'], []])
    expect(presenters).toEqual([['p']])
    leavePresenter()
    expect(presenters).toEqual([['p'], []])
    stopSources(); stopPresenters()
  })

  it('snapshots ticks so one unregistering itself cannot skip the next', () => {
    const host = surfaceHost()
    const seen: string[] = []
    let releaseA = () => {}
    releaseA = host.registerTick(() => {
      seen.push('a')
      releaseA()
    })
    host.registerTick(() => seen.push('b'))
    for (const tick of host.ticks()) tick(16)
    expect(seen).toEqual(['a', 'b'])
  })
})

describe('work claims', () => {
  it('promotes on the first claim and restores on the last release', () => {
    const host = surfaceHost()
    const r = runtime()
    host.runtime = r
    const a = host.claimWork()
    const b = host.claimWork()
    expect(r.busy).toEqual([true])
    a()
    a()
    // One Surface settling must not strand another's frames — this is the
    // fault the boolean flag produced on 2026-08-16.
    expect(r.busy).toEqual([true])
    expect(host.workClaims()).toBe(1)
    b()
    b()
    expect(r.busy).toEqual([true, false])
    expect(host.workClaims()).toBe(0)
  })

  it('draws one more frame after the last release', () => {
    // Scene removal is not presentation removal until the renderer draws
    // the scene without the object.
    const host = surfaceHost()
    const r = runtime()
    host.runtime = r
    const release = host.claimWork()
    const beforeRelease = r.frames
    release()
    expect(r.frames).toBe(beforeRelease + 1)
  })
})

describe('the frame tail', () => {
  it('closes deferred presentations only when the frame reached the screen', () => {
    // A post-processed scene draws every presenter into a target, so the
    // presenter's own post-draw callback is not a presentation boundary.
    const host = surfaceHost()
    const proven: string[] = []
    host.deferPresentation(() => proven.push('a'))
    host.deferPresentation(() => proven.push('b'))
    expect(host.deferredPresentations()).toBe(2)
    host.closeFrameTail(true)
    expect(proven).toEqual(['a', 'b'])
    expect(host.deferredPresentations()).toBe(0)
    host.closeFrameTail(true)
    expect(proven).toEqual(['a', 'b'])
  })

  it('a draw into a target leaves the deferrals pending', () => {
    // Post-processing renders the scene off screen FIRST and composites
    // second. Draining at the scene pass would throw every presenter away
    // one pass before the one that shows them.
    const host = surfaceHost()
    const proven: string[] = []
    host.deferPresentation(() => proven.push('a'))
    host.closeFrameTail(false)
    expect(proven).toEqual([])
    expect(host.deferredPresentations()).toBe(1)
    host.closeFrameTail(true)
    expect(proven).toEqual(['a'])
    expect(host.deferredPresentations()).toBe(0)
  })

  it('discards a frame that ended without reaching the screen', () => {
    // The composite pass was skipped or the context went away. Nothing was
    // shown, so nothing is proven and the presenters stay warming.
    const host = surfaceHost()
    const proven: string[] = []
    host.deferPresentation(() => proven.push('a'))
    host.discardFrameTail()
    host.closeFrameTail(true)
    expect(proven).toEqual([])
    expect(host.deferredPresentations()).toBe(0)
  })

  it('a closer that defers again waits for the next frame', () => {
    // Draining before the closers run is what makes this terminate: a
    // closer that reaches back into the host must not see this frame's
    // list a second time.
    const host = surfaceHost()
    const order: number[] = []
    let round = 0
    const again = () => {
      order.push(++round)
      if (round < 2) host.deferPresentation(again)
    }
    host.deferPresentation(again)
    host.closeFrameTail(true)
    expect(order).toEqual([1])
    host.closeFrameTail(true)
    expect(order).toEqual([1, 2])
  })
})

describe('mount bookkeeping', () => {
  it('a Strict Mode remount is one host, not a duplicate id', async () => {
    // React 18 Strict Mode mounts, then unmounts, then mounts again — and
    // the second registration runs BEFORE the first cleanup. A boolean
    // membership would drop a Canvas that is still on screen.
    const fault = vi.spyOn(console, 'error').mockImplementation(() => {})
    const host = surfaceHost('scene')
    const first = mountSurfaceHost(host)
    const second = mountSurfaceHost(host)
    first.release()
    await Promise.resolve()
    expect(fault).not.toHaveBeenCalled()
    expect(resolveSurfaceHost()).toBe(host)
    second.release()
    expect(resolveSurfaceHost()).toBe(surfaceHost())
    fault.mockRestore()
  })

  it('faults when two Canvases claim one id, and keeps both alive', async () => {
    // The id names exactly one Canvas. Two of them is a scene mistake, and
    // the cost of guessing is a Surface presenting into the wrong canvas —
    // so it is said out loud, and neither host loses its runtime.
    const fault = vi.spyOn(console, 'error').mockImplementation(() => {})
    const firstHost = createSurfaceHost('scene')
    const secondHost = createSurfaceHost('scene')
    const first = mountSurfaceHost(firstHost)
    const second = mountSurfaceHost(secondHost)
    await Promise.resolve()
    expect(fault).toHaveBeenCalledOnce()
    expect(String(fault.mock.calls[0]?.[0])).toContain('id="scene"')
    expect(String(fault.mock.calls[0]?.[0])).toContain('Each Canvas keeps its own renderer')
    first.host.runtime = runtime()
    second.host.runtime = runtime()
    expect(first.host).not.toBe(second.host)
    expect(resolveSurfaceHost('scene')).toBeNull()
    first.release()
    expect(second.host.runtime).not.toBeNull()
    expect(resolveSurfaceHost('scene')).toBe(second.host)
    second.release()
    expect(second.host.runtime).toBeNull()
    fault.mockRestore()
  })

  it('a release called twice does not uncount a live mount', () => {
    const host = surfaceHost('scene')
    const first = mountSurfaceHost(host)
    mountSurfaceHost(host)
    first.release()
    first.release()
    expect(resolveSurfaceHost()).toBe(host)
  })

})

describe('ownership', () => {
  it('reports the duplicate once, not once per commit', async () => {
    const fault = vi.spyOn(console, 'error').mockImplementation(() => {})
    mountSurfaceHost(createSurfaceHost('scene'))
    mountSurfaceHost(createSurfaceHost('scene'))
    mountSurfaceHost(createSurfaceHost('scene'))
    await Promise.resolve()
    expect(fault).toHaveBeenCalledOnce()
    fault.mockRestore()
  })
})
