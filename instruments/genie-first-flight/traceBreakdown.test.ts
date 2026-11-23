import { describe, expect, it } from 'vitest'
import { cpuSamples, gpuProcessBreakdown, mainThreadBreakdown, ownerOf, type TraceEvent } from './traceBreakdown.ts'

const RENDERER = 1
const GPU = 2
const MAIN = 10
const GPU_MAIN = 20
const WORKER = 21

const meta: TraceEvent[] = [
  { name: 'process_name', ph: 'M', pid: RENDERER, tid: 0, ts: 0, args: { name: 'Renderer' } },
  { name: 'process_name', ph: 'M', pid: GPU, tid: 0, ts: 0, args: { name: 'GPU Process' } },
  { name: 'thread_name', ph: 'M', pid: RENDERER, tid: MAIN, ts: 0, args: { name: 'CrRendererMain' } },
  { name: 'thread_name', ph: 'M', pid: GPU, tid: GPU_MAIN, ts: 0, args: { name: 'CrGpuMain' } },
  { name: 'thread_name', ph: 'M', pid: GPU, tid: WORKER, ts: 0, args: { name: 'ThreadPoolForegroundWorker' } },
]

const profile: TraceEvent[] = [
  { name: 'Profile', ph: 'P', pid: RENDERER, tid: MAIN, ts: 0, id: '0x1', args: { data: { startTime: 1_000 } } },
  {
    name: 'ProfileChunk',
    ph: 'P',
    pid: RENDERER,
    tid: 99,
    ts: 0,
    id: '0x1',
    args: {
      data: {
        cpuProfile: {
          nodes: [
            { id: 1, callFrame: { functionName: '(root)' } },
            { id: 2, parent: 1, callFrame: { functionName: 'loop', url: 'http://h/node_modules/.vite/deps/react-three-fiber.esm-X.js' } },
            { id: 3, parent: 2, callFrame: { functionName: 'build', url: 'http://h/node_modules/.vite/deps/three_webgpu.js?v=1' } },
            { id: 4, parent: 1, callFrame: { functionName: '(garbage collector)' } },
            { id: 5, parent: 1, callFrame: { functionName: '(idle)' } },
            { id: 6, parent: 2, callFrame: { functionName: 'rasterize', url: 'http://h/packages/react/src/snapdom.ts' } },
          ],
          samples: [3, 3, 4, 5, 6, 5],
        },
        timeDeltas: [0, 2_000, 2_000, 2_000, 2_000, 2_000],
      },
    },
  },
]

describe('trace breakdown', () => {
  it('rebuilds each sample stack from a chunk recorded on another thread', () => {
    const samples = cpuSamples(profile, RENDERER, MAIN)
    expect(samples.map((s) => s.ts)).toEqual([1_000, 3_000, 5_000, 7_000, 9_000])
    expect(samples[0]?.stack.map((f) => f.functionName)).toEqual(['build', 'loop', '(root)'])
  })

  it('names the innermost owned module and leaves idle time out', () => {
    const [build, , gc, idle, snapdom] = cpuSamples(profile, RENDERER, MAIN)
    expect([build, gc, idle, snapdom].map((s) => (s ? ownerOf(s.stack) : 'missing'))).toEqual(['three', 'gc', null, 'snapdom'])
  })

  it('names lab modules by the path Vite serves them from and keeps injected probe code apart from three', () => {
    const three = { functionName: 'render', url: 'http://h/node_modules/.vite/deps/three_webgpu.js?v=1' }
    expect(ownerOf([{ functionName: 'Panel', url: 'http://h/src/components/TuningPanel.tsx' }])).toBe('lab')
    expect(ownerOf([{ functionName: 'Flight', url: 'http://h/src/scenes/genie/Genie.tsx' }])).toBe('genie')
    expect(ownerOf([{ functionName: 'wrapped', url: 'pptr:evaluateOnNewDocument;x' }, three])).toBe('instrument')
  })

  it('counts only the part of each sample and task inside the window', () => {
    const task: TraceEvent = { name: 'RunTask', ph: 'X', pid: RENDERER, tid: MAIN, ts: 2_000, dur: 8_000 }
    const layout: TraceEvent = { name: 'Layout', ph: 'X', pid: RENDERER, tid: MAIN, ts: 4_000, dur: 4_000 }
    const result = mainThreadBreakdown([...meta, ...profile, task, layout], RENDERER, MAIN, { from: 2_000, to: 6_000 })
    expect(result.owners.three).toBe(3)
    expect(result.owners.gc).toBe(1)
    expect(result.owners.snapdom).toBe(0)
    expect(result.phases.layout).toBe(2)
    expect(result.longestTaskMs).toBe(4)
    expect(result.topFunctions[0]).toEqual({ name: 'build three_webgpu.js', ms: 3 })
  })

  it('separates blocking pipeline builds from worker builds and ignores other processes', () => {
    const events: TraceEvent[] = [
      ...meta,
      { name: 'RunTask', ph: 'X', pid: GPU, tid: GPU_MAIN, ts: 0, dur: 200_000 },
      { name: 'DeviceBase::APICreateRenderPipeline', ph: 'X', cat: 'gpu.dawn', pid: GPU, tid: GPU_MAIN, ts: 1_000, dur: 180_000 },
      { name: 'MTLDevice::newLibraryWithSource', ph: 'X', cat: 'gpu.dawn', pid: GPU, tid: GPU_MAIN, ts: 2_000, dur: 170_000 },
      { name: 'CreatePipelineAsyncEvent::InitializeImpl', ph: 'X', cat: 'gpu.dawn', pid: GPU, tid: WORKER, ts: 0, dur: 50_000 },
      { name: 'DeviceBase::APICreateRenderPipeline', ph: 'X', cat: 'gpu.dawn', pid: RENDERER, tid: MAIN, ts: 0, dur: 90_000 },
      { name: 'RunTask', ph: 'X', pid: RENDERER, tid: MAIN, ts: 0, dur: 300_000 },
    ]
    const result = gpuProcessBreakdown(events, { from: 0, to: 1_000_000 })
    expect(result.sync).toEqual({ ms: 180, maxMs: 180, count: 1 })
    expect(result.async).toEqual({ ms: 50, maxMs: 50, count: 1 })
    expect(result.mainLongestTaskMs).toBe(200)
    expect(result.mainLongestTaskInside[0]).toBe('DeviceBase::APICreateRenderPipeline 180ms')
    expect(result.syncThreads).toEqual(['CrGpuMain'])
    expect(result.asyncThreads).toEqual(['ThreadPoolForegroundWorker'])
  })
})
