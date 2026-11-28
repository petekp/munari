import { describe, expect, it } from 'vitest'
import { getGpuHostStats, getOrCreateGpuHost, hostInternals, settleGpuFrames, stepGpuFrame } from './host'

describe('manual GPU clock stepping', () => {
  it('advances deterministically by dtMs and settles when work claims drop to zero', () => {
    const id = 'manual-clock-test'
    const host = getOrCreateGpuHost(id)
    const internal = hostInternals.get(host)
    expect(internal).toBeDefined()
    if (!internal) return
    const calls: number[] = []
    let release: (() => void) | null = host.claimWork()

    internal.setManualStepper((dtMs) => {
      calls.push(dtMs)
      host.elapsedMs += dtMs
      host.renderCount += 1
      if (calls.length >= 3 && release) {
        release()
        release = null
      }
      return true
    })

    const first = stepGpuFrame(id, 16)
    expect(first).toEqual({ stepped: true, renderCount: 1, elapsedMs: 16, workClaims: 1 })

    const settled = settleGpuFrames(id, { dtMs: 16, maxSteps: 20 })
    expect(settled).toEqual({ steps: 2, settled: true, renderCount: 3, elapsedMs: 48, workClaims: 0 })
    expect(getGpuHostStats(id)).toEqual({ renderCount: 3, workClaims: 0, elapsedMs: 48 })
    expect(calls).toEqual([16, 16, 16])

    const lingering = host.claimWork()
    const capped = settleGpuFrames(id, { dtMs: 16, maxSteps: 4 })
    expect(capped).toEqual({ steps: 4, settled: false, renderCount: 7, elapsedMs: 112, workClaims: 1 })

    expect(stepGpuFrame(id, Number.NaN)).toEqual({
      stepped: true,
      renderCount: 8,
      elapsedMs: 112,
      workClaims: 1,
    })
    expect(settleGpuFrames(id, { dtMs: Number.NaN, maxSteps: Number.POSITIVE_INFINITY }).settled).toBe(false)

    lingering()
    internal.setManualStepper(null)
    expect(settleGpuFrames(id)).toEqual({ steps: 0, settled: false, renderCount: 248, elapsedMs: 3952, workClaims: 0 })
    expect(settleGpuFrames('missing-host-id')).toEqual({
      steps: 0,
      settled: false,
      renderCount: 0,
      elapsedMs: 0,
      workClaims: 0,
    })
  })
})
