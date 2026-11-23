// Trace breakdown — where a stretch of a Chrome trace went, split by owner.
//
// The law: a hitch is named by the work that filled it, measured on the
// thread that did the work. The page's main thread is split by JavaScript
// module (innermost frame with a known URL wins), garbage collection, and
// style, layout and paint. The GPU process is split into pipeline compiles,
// which Dawn runs on worker threads, and the tasks on its main thread, where
// the page's raster and the canvas's frames are executed.
//
// The fault this serves: Genie's first window flight after load hitches and
// later flights do not (Pete, 2026-11-21). The page's main thread showed no
// task long enough to explain it in the first trace; a 153 ms Metal library
// compile on a GPU-process worker and a 155 ms task on the GPU main thread
// did. A breakdown that reads only the page's main thread would report that
// hitch as idle time.
//
// Ownership: this module reads a trace that the runner already collected
// and does arithmetic on it. Collecting the trace, choosing the window and
// mapping page clocks onto trace time belong to run.mjs.

export interface CallFrame {
  functionName: string
  /** Absent for native and V8-internal frames. */
  url?: string
}

export interface ProfileNode {
  id: number
  callFrame: CallFrame
  parent?: number
}

export interface TraceEventData {
  startTime?: number
  cpuProfile?: { nodes?: ProfileNode[]; samples?: number[] }
  timeDeltas?: number[]
}

export interface TraceEvent {
  name: string
  ph: string
  pid: number
  tid: number
  ts: number
  dur?: number
  cat?: string
  id?: string
  args?: { name?: string; data?: TraceEventData }
}

export interface TraceWindow {
  /** Trace microseconds. */
  from: number
  to: number
}

export const OWNERS = [
  'three',
  'snapdom',
  'munari',
  'genie',
  'react',
  'lab',
  'instrument',
  'other-js',
  'gc',
  'program',
] as const
export type Owner = (typeof OWNERS)[number]

export const PHASES = ['style', 'layout', 'paint'] as const
export type Phase = (typeof PHASES)[number]

// Vite serves prebundled dependencies from /node_modules/.vite/deps/ and the
// workspace's own modules by source path, so the URL names the owner. The lab
// is Vite's root, so its modules are served from /src/. Scripts the probe
// injects through puppeteer carry pptr: URLs and wrap three's calls, so without
// their own owner the probe's overhead would be charged to three.
const URL_OWNERS: readonly (readonly [Owner, RegExp])[] = [
  ['three', /\/deps\/three[._]/],
  ['snapdom', /@zumer_snapdom|\/src\/snapdom/],
  ['munari', /\/packages\/(core|react)\/src\//],
  ['genie', /\/scenes\/genie\//],
  ['react', /\/deps\/(client-|react-three-fiber|react[._-])/],
  ['instrument', /^pptr:/],
  ['lab', /^https?:\/\/[^/]+\/src\//],
]

const PHASE_OF: ReadonlyMap<string, Phase> = new Map([
  ['UpdateLayoutTree', 'style'],
  ['RecalculateStyles', 'style'],
  ['Layout', 'layout'],
  ['PrePaint', 'paint'],
  ['Paint', 'paint'],
  ['Layerize', 'paint'],
  ['Commit', 'paint'],
])

// Dawn's trace names for the two ways a pipeline gets built. The synchronous
// API call runs on the GPU process's main thread, where it blocks every other
// command queued there, the page's raster and compositing included. The
// asynchronous one runs on a Dawn worker. Each nests shader translation and
// the Metal library compile inside it.
const SYNC_PIPELINE = new Set(['DeviceBase::APICreateRenderPipeline', 'DeviceBase::APICreateComputePipeline'])
const ASYNC_PIPELINE = 'CreatePipelineAsyncEvent::InitializeImpl'

const TOP_FUNCTIONS = 6

export interface Sample {
  ts: number
  dur: number
  /** Innermost frame first. */
  stack: readonly CallFrame[]
}

const key = (pid: number, tid: number) => `${pid}:${tid}`

export function threadNames(events: readonly TraceEvent[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const e of events) {
    if (e.ph === 'M' && e.name === 'thread_name' && e.args?.name !== undefined) names.set(key(e.pid, e.tid), e.args.name)
  }
  return names
}

export function processNames(events: readonly TraceEvent[]): Map<number, string> {
  const names = new Map<number, string>()
  for (const e of events) {
    if (e.ph === 'M' && e.name === 'process_name' && e.args?.name !== undefined) names.set(e.pid, e.args.name)
  }
  return names
}

interface ProfileTimeline {
  nodes: Map<number, ProfileNode>
  /** Sample times and the leaf node each sample landed in, in order. */
  times: number[]
  leaves: number[]
}

// A profile's chunks can be emitted from a thread other than the profiled
// one, so they are matched by profile id within the process.
function readProfile(events: readonly TraceEvent[], pid: number, id: string, start: number): ProfileTimeline {
  const timeline: ProfileTimeline = { nodes: new Map(), times: [], leaves: [] }
  let t = start
  for (const e of events) {
    if (e.name !== 'ProfileChunk' || e.pid !== pid || e.id !== id) continue
    const profile = e.args?.data?.cpuProfile
    const deltas = e.args?.data?.timeDeltas ?? []
    for (const node of profile?.nodes ?? []) timeline.nodes.set(node.id, node)
    for (const [i, leaf] of (profile?.samples ?? []).entries()) {
      t += deltas[i] ?? 0
      timeline.times.push(t)
      timeline.leaves.push(leaf)
    }
  }
  return timeline
}

function stackOf(nodes: Map<number, ProfileNode>, leaf: number): CallFrame[] {
  const stack: CallFrame[] = []
  for (let node = nodes.get(leaf); node; node = node.parent === undefined ? undefined : nodes.get(node.parent)) {
    stack.push(node.callFrame)
  }
  return stack
}

/** The CPU samples V8 recorded on one thread, each with its whole stack. */
export function cpuSamples(events: readonly TraceEvent[], pid: number, tid: number): Sample[] {
  const out: Sample[] = []
  for (const e of events) {
    if (e.name !== 'Profile' || e.pid !== pid || e.tid !== tid || e.id === undefined) continue
    const { nodes, times, leaves } = readProfile(events, pid, e.id, e.args?.data?.startTime ?? e.ts)
    for (let i = 0; i + 1 < times.length; i++) {
      const at = times[i]
      const next = times[i + 1]
      const leaf = leaves[i]
      if (at === undefined || next === undefined || leaf === undefined) continue
      out.push({ ts: at, dur: next - at, stack: stackOf(nodes, leaf) })
    }
  }
  return out.sort((a, b) => a.ts - b.ts)
}

/** Null for a sample that spent its time idle, which is not the page's work. */
export function ownerOf(stack: readonly CallFrame[]): Owner | null {
  const leaf = stack[0]?.functionName
  if (leaf === '(idle)' || leaf === '(root)') return null
  if (leaf === '(garbage collector)') return 'gc'
  if (leaf === '(program)') return 'program'
  for (const frame of stack) {
    if (!frame.url) continue
    for (const [owner, pattern] of URL_OWNERS) if (pattern.test(frame.url)) return owner
  }
  return 'other-js'
}

const overlap = (start: number, dur: number, w: TraceWindow) => Math.max(0, Math.min(start + dur, w.to) - Math.max(start, w.from))

export interface FunctionCost {
  name: string
  ms: number
}

export interface MainThreadBreakdown {
  /** Milliseconds of CPU samples by owner. */
  owners: Record<Owner, number>
  /** The innermost frames that held the most samples, heaviest first. */
  topFunctions: FunctionCost[]
  phases: Record<Phase, number>
  longestTaskMs: number
  busyMs: number
}

export function mainThreadBreakdown(events: readonly TraceEvent[], pid: number, tid: number, w: TraceWindow): MainThreadBreakdown {
  const ownerMs = {
    three: 0,
    snapdom: 0,
    munari: 0,
    genie: 0,
    react: 0,
    lab: 0,
    instrument: 0,
    'other-js': 0,
    gc: 0,
    program: 0,
  } satisfies Record<Owner, number>
  const self = new Map<string, number>()
  for (const s of cpuSamples(events, pid, tid)) {
    const owner = ownerOf(s.stack)
    const inside = overlap(s.ts, s.dur, w) / 1000
    if (!owner || inside === 0) continue
    ownerMs[owner] += inside
    const leaf = s.stack[0]
    const name = leaf ? `${leaf.functionName || '(anonymous)'} ${(leaf.url ?? '').split('/').pop()?.split('?')[0] ?? ''}`.trim() : '?'
    self.set(name, (self.get(name) ?? 0) + inside)
  }
  const topFunctions = [...self].sort((a, b) => b[1] - a[1]).slice(0, TOP_FUNCTIONS).map(([name, ms]) => ({ name, ms }))
  const phases = { style: 0, layout: 0, paint: 0 } satisfies Record<Phase, number>
  let longest = 0
  let busy = 0
  for (const e of events) {
    if (e.ph !== 'X' || e.pid !== pid || e.tid !== tid || e.dur === undefined) continue
    const inside = overlap(e.ts, e.dur, w) / 1000
    if (inside === 0) continue
    const phase = PHASE_OF.get(e.name)
    if (phase) phases[phase] += inside
    if (e.name === 'RunTask') {
      busy += inside
      longest = Math.max(longest, inside)
    }
  }
  return { owners: ownerMs, topFunctions, phases, longestTaskMs: longest, busyMs: busy }
}

export interface CompileTotals {
  ms: number
  maxMs: number
  count: number
}

export interface GpuProcessBreakdown {
  /** Pipelines created through the blocking API call. */
  sync: CompileTotals
  /** Pipelines created on Dawn's workers. */
  async: CompileTotals
  /** Tasks on the GPU process's main thread. */
  mainBusyMs: number
  mainLongestTaskMs: number
  /** The deepest events that cover at least half of that longest task. */
  mainLongestTaskInside: string[]
  /** The threads each kind of build ran on, by trace thread name. */
  syncThreads: string[]
  asyncThreads: string[]
}

export function gpuProcessBreakdown(events: readonly TraceEvent[], w: TraceWindow): GpuProcessBreakdown {
  const processes = processNames(events)
  const threads = threadNames(events)
  const gpu = new Set([...processes].filter(([, name]) => name === 'GPU Process').map(([pid]) => pid))
  const sync: CompileTotals = { ms: 0, maxMs: 0, count: 0 }
  const async: CompileTotals = { ms: 0, maxMs: 0, count: 0 }
  const syncThreads = new Set<string>()
  const asyncThreads = new Set<string>()
  for (const e of events) {
    if (!gpu.has(e.pid) || e.ph !== 'X' || e.dur === undefined) continue
    const totals = SYNC_PIPELINE.has(e.name) ? sync : e.name === ASYNC_PIPELINE ? async : null
    const inside = totals ? overlap(e.ts, e.dur, w) / 1000 : 0
    if (!totals || inside === 0) continue
    totals.ms += inside
    totals.maxMs = Math.max(totals.maxMs, inside)
    totals.count++
    ;(totals === sync ? syncThreads : asyncThreads).add(threads.get(key(e.pid, e.tid)) ?? `tid ${e.tid}`)
  }
  let mainBusy = 0
  let mainLongest = 0
  let longestTask: TraceEvent | null = null
  for (const e of events) {
    if (!gpu.has(e.pid) || e.ph !== 'X' || e.name !== 'RunTask' || e.dur === undefined) continue
    if (threads.get(key(e.pid, e.tid)) !== 'CrGpuMain') continue
    const inside = overlap(e.ts, e.dur, w) / 1000
    mainBusy += inside
    if (inside > mainLongest) {
      mainLongest = inside
      longestTask = e
    }
  }
  const mainLongestTaskInside = longestTask ? coveringEvents(events, longestTask) : []
  return { sync, async, mainBusyMs: mainBusy, mainLongestTaskMs: mainLongest, mainLongestTaskInside, syncThreads: [...syncThreads], asyncThreads: [...asyncThreads] }
}

/** Events nested in a task that each last at least half of it, outermost first. */
function coveringEvents(events: readonly TraceEvent[], task: TraceEvent): string[] {
  const dur = task.dur ?? 0
  return events
    .filter((e) => e !== task && e.ph === 'X' && e.pid === task.pid && e.tid === task.tid && e.ts >= task.ts && e.ts + (e.dur ?? 0) <= task.ts + dur && (e.dur ?? 0) >= dur / 2)
    .sort((a, b) => (b.dur ?? 0) - (a.dur ?? 0))
    .map((e) => `${e.name} ${Math.round((e.dur ?? 0) / 100) / 10}ms`)
}
