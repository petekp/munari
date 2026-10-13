import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface TraceData {
  url?: string
  functionName?: string
  lineNumber?: number
  columnNumber?: number
  frame?: string
  timerId?: number
  timeout?: number
  singleShot?: boolean
}

interface TraceEvent {
  name: string
  ph: 'M' | 'X' | 'I'
  pid: number
  tid: number
  ts?: number
  dur?: number
  args?: { name?: string; data?: TraceData }
}

const source = 'http://localhost/packages/react/src/snapdom.ts'
const renderer = (tid = 2): TraceEvent => ({ name: 'thread_name', ph: 'M', pid: 1, tid, args: { name: 'CrRendererMain' } })
const event = (name: string, ts: number, dur: number, tid = 2, data?: TraceData): TraceEvent => ({ name, ph: 'X', pid: 1, tid, ts, dur, args: { data } })
const call = (ts: number, url = source, tid = 2): TraceEvent => event('FunctionCall', ts, 10, tid, { url, functionName: 'resolve', lineNumber: 17, columnNumber: 4 })
const timer = (ts: number, frame: string, tid = 2): TraceEvent => ({ name: 'TimerInstall', ph: 'I', pid: 1, tid, ts, args: { data: { frame, timerId: 7, timeout: 0, singleShot: true } } })

function run(events: TraceEvent[]) {
  const directory = mkdtempSync(join(tmpdir(), 'munari-trace-summary-test-'))
  try {
    const fixture = join(directory, 'trace.json')
    writeFileSync(fixture, JSON.stringify({ traceEvents: events }))
    const result = spawnSync(process.execPath, [join(import.meta.dirname, 'trace-summary.mjs'), fixture], { encoding: 'utf8', timeout: 5000 })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    return result
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('trace summary CLI', () => {
  it('unions nested native intervals and counts each containing task once', () => {
    const result = run([
      renderer(),
      event('RunTask', 1000, 4000),
      event('FireAnimationFrame', 1200, 1000), call(1210),
      event('Layout', 1300, 600), event('Layout', 1400, 200),
      event('UpdateLayoutTree', 1550, 600), event('UpdateLayoutTree', 1600, 100),
      event('FireAnimationFrame', 2500, 1000), call(2510),
      event('RunTask', 6000, 2000),
      event('FireAnimationFrame', 6500, 1000), call(6510),
      event('Layout', 6700, 100), event('Layout', 6720, 30),
      event('UpdateLayoutTree', 6780, 150),
      event('RunTask', 100000, 50000),
      event('CpuProfiler::StartProfiling', 100010, 49000),
      event('FireAnimationFrame', 149100, 500), call(149110),
    ])
    expect(result.status).toBe(0)
    const summary = JSON.parse(result.stdout)
    expect(summary.captureContainingTaskMs).toMatchObject({ count: 2, median: 3, max: 4, total: 6 })
    expect(summary.profilerSetupMs).toMatchObject({ count: 1, total: 49 })
    expect(summary.callbacks).toHaveLength(1)
    const callback = summary.callbacks[0]
    expect(callback.callbackIncludingContinuationMs).toMatchObject({ count: 3, total: 3 })
    expect(callback.nativeLayoutMs.total).toBeCloseTo(0.7)
    expect(callback.nativeStyleUpdateMs.total).toBeCloseTo(0.75)
    expect(callback.nativeCombinedMs).toMatchObject({ count: 3, median: 0.23, max: 0.85 })
    expect(callback.nativeCombinedMs.total).toBeCloseTo(1.08)
    expect(callback.captureContainingTaskMs.count).toBe(2)
  })

  it('recovers native promise timers without confusing reused IDs across threads or frames', () => {
    const result = run([
      renderer(), renderer(3),
      event('RunTask', 900, 1300),
      event('FireAnimationFrame', 1000, 1000), call(1010),
      timer(1800, 'capture'),
      event('FireAnimationFrame', 2200, 600, 3), call(2210, 'http://localhost/other.js', 3),
      timer(2400, 'capture', 3),
      event('FireAnimationFrame', 2300, 700), call(2310, 'http://localhost/other.js'),
      timer(2500, 'other-frame'),
      event('RunTask', 3900, 1500),
      event('TimerFire', 4000, 1000, 2, { frame: 'capture', timerId: 7 }), call(4010, ''),
      event('Layout', 4200, 400),
      event('TimerFire', 6000, 1000, 3, { frame: 'capture', timerId: 7 }), call(6010, '', 3),
      event('TimerFire', 8000, 1000, 2, { frame: 'other-frame', timerId: 7 }), call(8010, ''),
    ])
    expect(result.status).toBe(0)
    const summary = JSON.parse(result.stdout)
    expect(summary.callbacks).toHaveLength(2)
    const decoded = summary.callbacks.find((callback: { kind: string }) => callback.kind === 'timer')
    expect(decoded).toMatchObject({ attribution: 'scheduler-frame-callback', location: { url: source, line: 17 } })
    expect(decoded.callbackIncludingContinuationMs).toMatchObject({ count: 1, median: 1, total: 1 })
    expect(decoded.nativeCombinedMs.total).toBeCloseTo(0.4)
    expect(summary.captureContainingTaskMs.count).toBe(2)
  })

  it('fails instead of reporting measurements without renderer or owned-callback evidence', () => {
    const fixtures = [
      [event('RunTask', 1000, 2000), event('FireAnimationFrame', 1200, 1000), call(1210)],
      [renderer(), event('RunTask', 1000, 2000), event('FireAnimationFrame', 1200, 1000), call(1210, 'http://localhost/other.js')],
    ]
    for (const fixture of fixtures) {
      const result = run(fixture)
      expect(result.status).not.toBe(0)
      expect(result.stdout).toBe('')
    }
  })
})
