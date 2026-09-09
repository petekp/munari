// @vitest-environment happy-dom
// Ten-second diagnostics never grant presentation or schedule renderer work.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSurfaceStore } from './surfaceHandle'
import { mountSurfaceHost, resetSurfaceHosts, surfaceHost } from './surfaceHostRegistry'
import { watchSurfaceValidation } from './surfaceValidation'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('DEV', true)
  class WithTrial { drawElementImage() {} }
  vi.stubGlobal('CanvasRenderingContext2D', WithTrial)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); resetSurfaceHosts() })
function waitingSurface() {
  const store = createSurfaceStore('waiting')
  store.acquire(1); store.declarePresentation('page'); store.declarePresentation('canvas'); store.request('canvas')
  return store
}

describe('waiting diagnostics', () => {
  it('warns once without onError or work and cancels the next episode on mount', async () => {
    const store = waitingSurface(), host = surfaceHost()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {}), error = vi.fn()
    store.setCallbacks({ onError: error })
    store.setRendererAvailable(false)
    const stop = watchSurfaceValidation(store, host)
    await vi.advanceTimersByTimeAsync(9999)
    expect(warning).not.toHaveBeenCalled()
    expect(store.hasProtocolWork()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(warning).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10000)
    expect(warning).toHaveBeenCalledTimes(1)
    expect(error).not.toHaveBeenCalled()
    expect(store.getState().presented).toBe('page')
    store.request('page'); store.request('canvas')
    await vi.advanceTimersByTimeAsync(9000)
    const mount = mountSurfaceHost(host)
    mount.host.setRuntime({ invalidate() {}, setBusy() {} })
    store.setRendererAvailable(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(warning).toHaveBeenCalledTimes(1)
    stop(); mount.release()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('does not reset a preparation deadline on unrelated notifications and starts a new evidence episode', async () => {
    const store = waitingSurface(), mount = mountSurfaceHost(surfaceHost())
    mount.host.setRuntime({ invalidate() {}, setBusy() {} })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stop = watchSurfaceValidation(store, mount.host)
    await vi.advanceTimersByTimeAsync(9000)
    store.replaceSource()
    await vi.advanceTimersByTimeAsync(1000)
    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning.mock.calls[0]?.[0]).toContain('a scene presenter')
    store.registerPresenter('late')
    await vi.advanceTimersByTimeAsync(10000)
    expect(warning).toHaveBeenCalledTimes(2)
    expect(warning.mock.calls[1]?.[0]).toContain('usable source frame')
    store.prove('late', store.readinessLifetime(), store.epoch())
    vi.runAllTicks()
    expect(vi.getTimerCount()).toBe(0)
    stop(); mount.release()
  })
  it('has no diagnostic timers in production or unsupported fallback', () => {
    const scheduled = vi.spyOn(globalThis, 'setTimeout')
    const stop = watchSurfaceValidation(waitingSurface(), surfaceHost(), false)
    vi.runAllTicks()
    expect(scheduled.mock.calls).toEqual([])
    stop()
    vi.stubEnv('DEV', true)
    class WithoutTrial {}
    vi.stubGlobal('CanvasRenderingContext2D', WithoutTrial)
    const stopUnsupported = watchSurfaceValidation(waitingSurface(), surfaceHost())
    vi.runAllTicks()
    expect(vi.getTimerCount()).toBe(0)
    stopUnsupported()
  })
})
