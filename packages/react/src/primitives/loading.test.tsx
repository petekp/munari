// @vitest-environment happy-dom
import { act, createElement as h, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Loading, useLoadingStatus, useLoadingWait, type LoadingReport, type LoadingStatus } from './loading'

const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0
let clock = 0
let root: Root | null = null

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  frames.clear()
  vi.unstubAllGlobals()
})

function runFrames(count: number, step = 16) {
  for (let index = 0; index < count; index++) {
    clock += step
    const due = [...frames.values()]
    frames.clear()
    act(() => {
      for (const callback of due) callback(clock)
    })
  }
}

function render(node: ReactNode) {
  if (!root) {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  const target = root
  act(() => target.render(node))
}

function Wait({ label, state }: { label: string; state: boolean | Error }) {
  useLoadingWait(label, state)
  return null
}

it('loads after a wait clears and two checks agree, and reports it once', () => {
  const loaded = vi.fn<(report: LoadingReport) => void>()
  render(h(Loading, { onLoaded: loaded }, h(Wait, { label: 'data', state: false })))
  runFrames(5)
  expect(loaded).not.toHaveBeenCalled()
  render(h(Loading, { onLoaded: loaded }, h(Wait, { label: 'data', state: true })))
  runFrames(1)
  expect(loaded).not.toHaveBeenCalled()
  runFrames(5)
  expect(loaded).toHaveBeenCalledTimes(1)
  expect(loaded.mock.calls[0]?.[0].entries).toEqual([{ kind: 'wait', label: 'data', status: 'done' }])
})

it('sends one late notice from frame time and keeps waiting', () => {
  const loaded = vi.fn()
  const late = vi.fn()
  render(h(Loading, { onLoaded: loaded, late: { afterMs: 100, onLate: late } }, h(Wait, { label: 'data', state: false })))
  runFrames(4, 16)
  expect(late).not.toHaveBeenCalled()
  runFrames(1, 5000)
  runFrames(1, 16)
  expect(late).not.toHaveBeenCalled()
  runFrames(1, 16)
  expect(late).toHaveBeenCalledTimes(1)
  runFrames(20, 16)
  expect(late).toHaveBeenCalledTimes(1)
  expect(loaded).not.toHaveBeenCalled()
  render(h(Loading, { onLoaded: loaded, late: { afterMs: 100, onLate: late } }, h(Wait, { label: 'data', state: true })))
  runFrames(3)
  expect(loaded).toHaveBeenCalledTimes(1)
})

it('holds on an error until the wait changes', () => {
  const loaded = vi.fn()
  render(h(Loading, { onLoaded: loaded }, h(Wait, { label: 'data', state: new Error('fetch failed') })))
  runFrames(5)
  expect(loaded).not.toHaveBeenCalled()
  render(h(Loading, { onLoaded: loaded }, h(Wait, { label: 'data', state: true })))
  runFrames(3)
  expect(loaded).toHaveBeenCalledTimes(1)
})

it('waits for a nested boundary unless it is independent', () => {
  const outer = vi.fn()
  const tree = (independent: boolean, ready: boolean) =>
    h(Loading, { onLoaded: outer }, h(Loading, { independent }, h(Wait, { label: 'inner', state: ready })))
  render(tree(false, false))
  runFrames(5)
  expect(outer).not.toHaveBeenCalled()
  render(tree(false, true))
  runFrames(5)
  expect(outer).toHaveBeenCalledTimes(1)
  act(() => root?.unmount())
  root = null
  const independentOuter = vi.fn()
  render(h(Loading, { onLoaded: independentOuter }, h(Loading, { independent: true }, h(Wait, { label: 'inner', state: false }))))
  runFrames(5)
  expect(independentOuter).toHaveBeenCalledTimes(1)
})

it('publishes the waiting entries and then the loaded status', () => {
  const seen: LoadingStatus[] = []
  function Status() {
    seen.push(useLoadingStatus())
    return null
  }
  render(h(Loading, null, h(Status), h(Wait, { label: 'data', state: false })))
  runFrames(2)
  expect(seen.at(-1)).toEqual({ status: 'waiting', entries: [{ kind: 'wait', label: 'data', status: 'waiting', waitingFor: 'app' }] })
  render(h(Loading, null, h(Status), h(Wait, { label: 'data', state: true })))
  runFrames(3)
  expect(seen.at(-1)?.status).toBe('loaded')
})
