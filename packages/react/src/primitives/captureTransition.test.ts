// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureTransitionQueue, createCaptureTransition, QUEUED_REQUEST_LIMIT_MS } from './captureTransition'

function connectedTarget() {
  const target = document.createElement('div')
  document.body.append(target)
  return target
}

function connectRenderer(transition: ReturnType<typeof createCaptureTransition>) {
  const renderer = { wake: vi.fn(), finish: vi.fn(), dispose: vi.fn() }
  const disconnect = transition[captureTransitionQueue].connect(renderer)
  return { renderer, disconnect }
}

describe('capture transition queue', () => {
  let reducedMotion = false
  const reported: Error[] = []

  beforeEach(() => {
    reducedMotion = false
    reported.length = 0
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion }))
    vi.stubGlobal('reportError', (error: Error) => reported.push(error))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  it('applies an update at once when no effect is connected', () => {
    const transition = createCaptureTransition()
    const update = vi.fn()
    transition.start(connectedTarget(), update)
    expect(update).toHaveBeenCalledOnce()
  })

  it('holds updates for a connected effect and applies them once, in request order, on finish', () => {
    const transition = createCaptureTransition()
    const { renderer } = connectRenderer(transition)
    const applied: string[] = []
    transition.start(connectedTarget(), () => applied.push('first'))
    transition.start(connectedTarget(), () => applied.push('second'))
    expect(applied).toEqual([])
    expect(renderer.wake).toHaveBeenCalledTimes(2)

    transition.finish()
    transition.finish()

    expect(applied).toEqual(['first', 'second'])
  })

  it('applies an update made during finish after the updates already waiting', () => {
    const transition = createCaptureTransition()
    const target = connectedTarget()
    const { renderer } = connectRenderer(transition)
    const applied: string[] = []
    renderer.finish.mockImplementation(() => transition.start(target, () => applied.push('during finish')))
    transition.start(target, () => applied.push('waiting'))

    transition.finish()

    expect(applied).toEqual(['waiting', 'during finish'])
  })

  it('keeps applying later updates after one throws, and reports the error', async () => {
    const transition = createCaptureTransition()
    connectRenderer(transition)
    const failure = new Error('update failed')
    const applied: string[] = []
    transition.start(connectedTarget(), () => { throw failure })
    transition.start(connectedTarget(), () => applied.push('later'))

    transition.finish()
    await Promise.resolve()

    expect(applied).toEqual(['later'])
    expect(reported).toEqual([failure])
  })

  it('applies waiting updates in order when the effect disconnects', () => {
    const transition = createCaptureTransition()
    const { renderer, disconnect } = connectRenderer(transition)
    const applied: string[] = []
    transition.start(connectedTarget(), () => applied.push('first'))
    transition.start(connectedTarget(), () => applied.push('second'))

    disconnect()

    expect(applied).toEqual(['first', 'second'])
    expect(renderer.dispose).toHaveBeenCalledOnce()
    const after = vi.fn()
    transition.start(connectedTarget(), after)
    expect(after).toHaveBeenCalledOnce()
  })

  it('applies at once under reduced motion or for a disconnected target, after the updates already waiting', () => {
    const transition = createCaptureTransition()
    connectRenderer(transition)
    const applied: string[] = []
    transition.start(connectedTarget(), () => applied.push('waiting'))
    transition.start(document.createElement('div'), () => applied.push('detached'))
    expect(applied).toEqual(['waiting', 'detached'])

    reducedMotion = true
    transition.start(connectedTarget(), () => applied.push('reduced'))
    expect(applied).toEqual(['waiting', 'detached', 'reduced'])
  })

  it('finishes every transition when the first waiting request outlives the queue limit', () => {
    const transition = createCaptureTransition()
    const { renderer } = connectRenderer(transition)
    const applied: string[] = []
    transition.start(connectedTarget(), () => applied.push('stuck'))
    transition.start(connectedTarget(), () => applied.push('behind'))

    vi.advanceTimersByTime(QUEUED_REQUEST_LIMIT_MS - 1)
    expect(applied).toEqual([])
    vi.advanceTimersByTime(1)

    expect(applied).toEqual(['stuck', 'behind'])
    expect(renderer.finish).toHaveBeenCalledOnce()
  })

  it('times the limit from the request that is first in the queue once its predecessor is accepted', () => {
    const transition = createCaptureTransition()
    const { renderer } = connectRenderer(transition)
    const applied: string[] = []
    transition.start(connectedTarget(), () => applied.push('accepted'))
    vi.advanceTimersByTime(QUEUED_REQUEST_LIMIT_MS / 2)
    transition.start(connectedTarget(), () => applied.push('next'))
    transition[captureTransitionQueue].take()

    vi.advanceTimersByTime(QUEUED_REQUEST_LIMIT_MS / 2)
    expect(renderer.finish).not.toHaveBeenCalled()
    vi.advanceTimersByTime(QUEUED_REQUEST_LIMIT_MS / 2)

    expect(renderer.finish).toHaveBeenCalledOnce()
    expect(applied).toEqual(['next'])
  })

  it('allows one effect per transition', () => {
    const transition = createCaptureTransition()
    connectRenderer(transition)
    expect(() => connectRenderer(transition)).toThrow(/one effect/)
  })
})
