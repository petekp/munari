import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
// @ts-expect-error Browser instrumentation is an untyped JavaScript module.
import { installGpuDiagnostics } from './gpu-diagnostics.mjs'

interface CopySource {
  source: { width?: number; height?: number }
}

interface CopyDestination {
  mipLevel?: number
}

type CopyExtent = [number, number] | { width: number; height: number }

function measurement() {
  let now = 1
  let nativeError: Error | null = null
  class Queue {
    copyExternalImageToTexture(_source: CopySource, _destination: CopyDestination, _size: CopyExtent) {
      now += 2
      if (nativeError) throw nativeError
    }
    onSubmittedWorkDone() {
      return new Promise<void>((resolve, reject) => {
        this.resolve = resolve
        this.reject = reject
      })
    }
    resolve = () => {}
    reject = (_error: Error) => {}
  }
  const queue = new Queue()
  const canvas = {}, otherCanvas = {}
  const source = { sourceId: 7, canvas, currentPaint: () => ({ read: 9, frame: { generation: 3 } }) }
  const otherSource = { sourceId: 8, canvas: otherCanvas, currentPaint: () => ({ read: 4, frame: { generation: 2 } }) }
  const events: string[] = []
  const perf = {
    sources: new Map([[7, { source }], [8, { source: otherSource }]]),
    active: true, started: 10, events,
    record(kind: string) { this.events.push(kind) },
    stop() { this.active = false; return { events: this.events } },
  }
  interface MeasurementContext {
    getConfiguration?: () => { device: { queue: Queue } }
  }
  const renderer = { getContext: (): MeasurementContext => ({ getConfiguration: () => ({ device: { queue } }) }) }
  const browser = { __munariPerf: perf, __r3f: { gl: renderer } }
  const api = runInNewContext(`(${installGpuDiagnostics.toString()})(); window.__munariGpuDiagnostics`, {
    window: browser, GPUQueue: Queue, performance: { now: () => now }, Error,
  })
  return {
    api, perf, renderer, queue, Queue, canvas, otherCanvas, source,
    advance(ms: number) { now += ms },
    failCopy(error: Error) { nativeError = error },
  }
}

const upload = { sourceId: 7, read: 9, generation: 3, width: 20, height: 10 }

describe('GPU diagnostic measurement', () => {
  it('preserves late completion in its original phase without changing the stopped snapshot', async () => {
    const m = measurement()
    m.queue.copyExternalImageToTexture({ source: m.canvas }, {}, [20, 10])
    m.api.onUpload(m.canvas, upload)
    const stopped = m.perf.stop()
    expect(stopped).toMatchObject({ gpuDiagnostics: { checkpoints: [{ status: 'pending', latencyMs: null }] } })
    m.perf.active = true
    m.perf.started = 20
    m.advance(12)
    m.queue.resolve()
    await Promise.resolve()
    expect(m.api.snapshot(10).checkpoints).toMatchObject([{ phaseStarted: 10, status: 'resolved', latencyMs: 12 }])
    expect(m.api.snapshot(20).checkpoints).toEqual([])
    expect(m.perf.events).not.toContain('gpuQueueCheckpointResolved')
    expect(stopped).toMatchObject({ gpuDiagnostics: { checkpoints: [{ status: 'pending', latencyMs: null }] } })
  })

  it('attributes each upload to its source canvas and preserves the read captured at submission', () => {
    const m = measurement()
    m.perf.active = false
    m.queue.copyExternalImageToTexture({ source: m.canvas }, {}, [20, 10])
    m.perf.active = true
    m.queue.copyExternalImageToTexture({ source: {} }, {}, [20, 10])
    m.queue.copyExternalImageToTexture({ source: m.canvas }, {}, [20, 10])
    m.queue.copyExternalImageToTexture({ source: m.otherCanvas }, {}, { width: 30, height: 15 })
    m.source.currentPaint = () => ({ read: 10, frame: { generation: 4 } })
    m.api.onUpload(m.otherCanvas, { sourceId: 8, read: 4, generation: 2 })
    m.api.onUpload(m.canvas, upload)
    const snapshot = m.api.snapshot(10)
    expect(snapshot.copies).toMatchObject([
      { copyId: 1, sourceId: 7, read: 9, generation: 3, width: 20, height: 10, callMs: 2 },
      { copyId: 2, sourceId: 8, read: 4, generation: 2, width: 30, height: 15, callMs: 2 },
    ])
    expect(snapshot.copies).toHaveLength(2)
    expect(snapshot.checkpoints).toMatchObject([
      { sourceId: 8, read: 4, copyIds: [2], copyAttribution: 'source-canvas' },
      { sourceId: 7, read: 9, copyIds: [1], copyAttribution: 'source-canvas' },
    ])
  })

  it('refuses to attribute completion from a different renderer queue to the copy', () => {
    const m = measurement()
    const copyQueue = new m.Queue()
    copyQueue.copyExternalImageToTexture({ source: m.canvas }, {}, [20, 10])
    m.api.onUpload(m.canvas, upload)
    expect(m.api.snapshot(10).checkpoints).toMatchObject([{
      copyIds: [1], status: 'unattributed', reason: 'copy-and-renderer-queues-differ',
      latencyMs: null, settledAt: null,
    }])
  })

  it('retains queue rejection and unsupported evidence while propagating the original copy exception', async () => {
    const m = measurement()
    m.queue.copyExternalImageToTexture({ source: m.canvas }, {}, [20, 10])
    m.api.onUpload(m.canvas, upload)
    m.advance(6)
    m.queue.reject(new Error('device lost'))
    await Promise.resolve()
    m.renderer.getContext = () => ({})
    m.api.onUpload(m.canvas, { ...upload, read: 10 })
    const error = new Error('copy fault')
    m.failCopy(error)
    let caught: unknown
    try {
      m.queue.copyExternalImageToTexture({ source: m.canvas }, {}, [20, 10])
    } catch (failure) {
      caught = failure
    }
    expect(caught).toBe(error)
    const snapshot = m.api.snapshot(10)
    expect(snapshot.checkpoints).toMatchObject([
      { status: 'rejected', reason: 'Error: device lost', latencyMs: 6 },
      { status: 'unsupported', reason: 'webgpu-context-unavailable', latencyMs: null, settledAt: null },
    ])
    expect(snapshot.copies).toMatchObject([
      { status: 'submitted', error: null },
      { status: 'threw', error: 'Error: copy fault', callMs: 2 },
    ])
  })
})
