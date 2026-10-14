// GPU queue diagnostics — source/read attribution across texture submission.
// Queue completion includes earlier submitted work and callback scheduling,
// not visible presentation (docs/performance-diagnosis.md). Controls
// submission took 1.2 ms median at 6× on 2026-10-14; capture took far longer.
// This module owns checkpoints; the performance observer owns phase bounds.
import assert from 'node:assert/strict'
import path from 'node:path'

export function gpuDiagnosticPlugin(root) {
  return {
    name: 'munari-gpu-diagnostic', enforce: 'pre',
    transform(source, id) {
      if (new URLSearchParams(id.split('?')[1] ?? '').has('raw')) return null
      const file = path.relative(root, id.split('?')[0]).replaceAll(path.sep, '/')
      if (file !== 'packages/react/src/primitives/surface/surfaceSourceRuntime.ts') return null
      const marker = 'texture.onUpdate = () => {'
      assert.equal(source.split(marker).length - 1, 1, 'Expected one texture update callback')
      return source.replace(marker, `${marker}
    window.__munariGpuDiagnostics.onUpload(source.canvas, {sourceId:source.sourceId,read:pendingUploadRead,generation:pendingUploadGeneration,version:texture?.version,width:source.canvas.width,height:source.canvas.height});`)
    },
  }
}

export function installGpuDiagnostics() {
  const perf = window.__munariPerf
  if (!perf) throw new Error('Install the performance observer before GPU diagnostics')
  if (window.__munariGpuDiagnostics) throw new Error('GPU diagnostics already installed')
  const copies = [], checkpoints = []
  const canvasCopies = new WeakMap(), queueIds = new WeakMap()
  let copySequence = 0, checkpointSequence = 0, queueSequence = 0
  const queueId = queue => {
    if (!queueIds.has(queue)) queueIds.set(queue, ++queueSequence)
    return queueIds.get(queue)
  }
  const phase = () => perf.active ? perf.started : null
  const record = (kind, item) => {
    if (perf.active && perf.started === item.phaseStarted) perf.record(kind, {...item})
  }
  const stringifyError = error => error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const identityForCanvas = canvas => {
    for (const {source} of perf.sources.values()) {
      if (source.canvas !== canvas) continue
      const paint = source.currentPaint()
      return {sourceId:source.sourceId,read:paint?.read ?? null,generation:paint?.frame.generation ?? null}
    }
    return null
  }
  const copySize = size => {
    if (Array.isArray(size)) return {width:size[0],height:size[1] ?? 1,depthOrArrayLayers:size[2] ?? 1}
    return {width:size?.width ?? null,height:size?.height ?? 1,depthOrArrayLayers:size?.depthOrArrayLayers ?? 1}
  }
  const snapshot = (phaseStarted = null) => ({
    support: {...support},
    scope: 'CPU copy submission and queue-prefix completion; neither isolated GPU upload duration nor visible presentation',
    copies: copies.filter(item => phaseStarted === null || item.phaseStarted === phaseStarted).map(item => ({...item})),
    checkpoints: checkpoints.filter(item => phaseStarted === null || item.phaseStarted === phaseStarted).map(item => ({...item,copyIds:[...item.copyIds]})),
  })
  const support = {
    copyExternalImageToTexture: Boolean(globalThis.GPUQueue?.prototype?.copyExternalImageToTexture),
    rendererContext: 'not-observed',
    onSubmittedWorkDone: 'not-observed',
  }
  let originalCopy = null, observedCopy = null
  if (support.copyExternalImageToTexture) {
    originalCopy = GPUQueue.prototype.copyExternalImageToTexture
    observedCopy = function (source, destination, size) {
      const phaseStarted = phase()
      const identity = phaseStarted === null ? null : identityForCanvas(source?.source)
      if (!identity) return originalCopy.call(this, source, destination, size)
      const item = {
        copyId:++copySequence,phaseStarted,...identity,queueId:queueId(this),...copySize(size),
        startedAt:performance.now(),endedAt:null,callMs:null,status:'submitted',error:null,
      }
      try {
        return originalCopy.call(this, source, destination, size)
      } catch (error) {
        item.status = 'threw'
        item.error = stringifyError(error)
        throw error
      } finally {
        item.endedAt = performance.now()
        item.callMs = item.endedAt - item.startedAt
        copies.push(item)
        const previous = canvasCopies.get(source.source) ?? []
        previous.push(item)
        canvasCopies.set(source.source, previous)
        record('gpuCopySubmission', item)
      }
    }
    GPUQueue.prototype.copyExternalImageToTexture = observedCopy
  }
  const api = {
    snapshot,
    onUpload(canvas, identity) {
      const phaseStarted = phase()
      if (phaseStarted === null) return
      const observed = canvasCopies.get(canvas) ?? []
      canvasCopies.delete(canvas)
      const matching = observed.filter(item => item.phaseStarted === phaseStarted && item.status === 'submitted')
      const item = {
        checkpointId:++checkpointSequence,checkpointType:'upload-prefix',phaseStarted,...identity,
        copyIds:matching.map(copy => copy.copyId),copyAttribution:matching.length ? 'source-canvas' : 'no-native-copy-observed',queueId:null,calledAt:performance.now(),
        settledAt:null,latencyMs:null,status:'pending',reason:null,
      }
      checkpoints.push(item)
      let queue
      try {
        const renderer = window.__r3f?.gl
        if (!renderer?.getContext) {
          support.rendererContext = 'unavailable'
          item.status = 'unsupported'; item.reason = 'renderer-unavailable'
        } else {
          const context = renderer.getContext()
          if (!context?.getConfiguration) {
            support.rendererContext = 'no-getConfiguration'
            item.status = 'unsupported'; item.reason = 'webgpu-context-unavailable'
          } else {
            const configuration = context.getConfiguration()
            support.rendererContext = configuration ? 'configured' : 'unconfigured'
            queue = configuration?.device?.queue
            if (!queue?.onSubmittedWorkDone) {
              support.onSubmittedWorkDone = 'unavailable'
              item.status = 'unsupported'; item.reason = 'queue-completion-unavailable'
            }
          }
        }
        if (item.status === 'unsupported') {
          record('gpuQueueCheckpoint', item)
          return
        }
        support.onSubmittedWorkDone = 'available'
        item.queueId = queueId(queue)
        if (matching.some(copy => copy.queueId !== item.queueId)) {
          item.status = 'unattributed'; item.reason = 'copy-and-renderer-queues-differ'
          record('gpuQueueCheckpoint', item)
          return
        }
        item.calledAt = performance.now()
        const completion = queue.onSubmittedWorkDone()
        record('gpuQueueCheckpoint', item)
        completion.then(() => {
          item.settledAt = performance.now()
          item.latencyMs = item.settledAt - item.calledAt
          item.status = 'resolved'
          record('gpuQueueCheckpointResolved', item)
        }, error => {
          item.settledAt = performance.now()
          item.latencyMs = item.settledAt - item.calledAt
          item.status = 'rejected'; item.reason = stringifyError(error)
          record('gpuQueueCheckpointRejected', item)
        })
      } catch (error) {
        item.settledAt = performance.now()
        item.latencyMs = item.settledAt - item.calledAt
        item.status = 'rejected'; item.reason = stringifyError(error)
        record('gpuQueueCheckpointRejected', item)
      }
    },
    dispose() {
      if (observedCopy && GPUQueue.prototype.copyExternalImageToTexture === observedCopy) GPUQueue.prototype.copyExternalImageToTexture = originalCopy
      if (perf.stop === observedStop) perf.stop = originalStop
    },
  }
  const originalStop = perf.stop
  const observedStop = function (...args) {
    const phaseStarted = this.started
    const result = originalStop.apply(this, args)
    result.gpuDiagnostics = snapshot(phaseStarted)
    return result
  }
  perf.stop = observedStop
  window.__munariGpuDiagnostics = api
}
