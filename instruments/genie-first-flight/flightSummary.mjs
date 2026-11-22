// One flight's numbers for the genie-first-flight probe — summarize reads the
// page recorder's log (frame gaps against the pre-press baseline, handoff,
// three's work, API calls, long frames, repaints), and traceSummary reads the
// flight's Chrome trace (main-thread owners, GPU-process pipeline builds).
// loadSummary reads the same log for the page load before the first press.
//
// The trace is aligned to page time through the performance.mark set in the
// same evaluate as pressAt. A trace without that mark, or without CPU samples
// on the page's main thread, fails the run instead of reporting zeros.

import assert from 'node:assert/strict'
import { gpuProcessBreakdown, mainThreadBreakdown, threadNames } from './traceBreakdown.ts'

// The frame-gap baseline is read over this stretch before the press.
const BASELINE_MS = 600
// After landing: the dock ring and the final hand-back frames.
export const TAIL_MS = 300

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}
export const round = (x) => Math.round(x * 10) / 10

export function summarize(flight) {
  const { pressAt, landedAt, log } = flight
  const end = landedAt + TAIL_MS
  const gaps = []
  for (let i = 1; i < log.frames.length; i++) gaps.push({ t: log.frames[i], gap: log.frames[i] - log.frames[i - 1] })
  const baseline = median(gaps.filter((g) => g.t > pressAt - BASELINE_MS && g.t <= pressAt).map((g) => g.gap))
  const during = gaps.filter((g) => g.t > pressAt && g.t <= end)
  const longest = during.reduce((a, g) => (g.gap > a.gap ? g : a), { t: pressAt, gap: 0 })
  const inWindow = (e) => e.start >= pressAt - 5 && e.start <= end
  const sum = (rows, what) => rows.filter((r) => r.what === what && inWindow(r)).reduce((a, r) => a + r.ms, 0)
  const count = (rows, what) => rows.filter((r) => r.what === what && inWindow(r)).length
  const handoff = log.dom.find((d) => d.t > pressAt && d.win === flight.win && d.attr === 'data-away')
  const paints = Object.fromEntries(
    flight.paintsAfter.map((s) => [s.label, s.paints - (flight.paintsBefore.find((b) => b.label === s.label)?.paints ?? 0)]),
  )
  return {
    flight: `${flight.kind} ${flight.win}`,
    frames: {
      baselineMs: round(baseline),
      longestGapMs: round(longest.gap),
      longestGapAfterPressMs: round(longest.t - longest.gap - pressAt),
      excessMs: round(during.reduce((a, g) => a + Math.max(0, g.gap - baseline), 0)),
      gapsOver2x: during.filter((g) => g.gap > 2 * baseline).length,
    },
    pressToHandoffMs: handoff ? round(handoff.t - pressAt) : null,
    flightMs: round(landedAt - pressAt),
    three: {
      nodesMs: round(sum(log.three, 'nodes')),
      pipelinesMs: round(sum(log.three, 'pipelines')),
      texturesMs: round(sum(log.three, 'textures')),
      renderMs: round(sum(log.three, 'render')),
      longestRenderMs: round(Math.max(0, ...log.three.filter((r) => r.what === 'render' && inWindow(r)).map((r) => r.ms))),
    },
    api: Object.fromEntries(
      [...new Set(log.api.filter(inWindow).map((r) => r.what))].map((what) => [what, { n: count(log.api, what), ms: round(sum(log.api, what)) }]),
    ),
    longFrames: log.loaf
      .filter((e) => e.start >= pressAt - 5 && e.start <= end && e.duration > 50)
      .map((e) => ({
        atMs: round(e.start - pressAt),
        durationMs: round(e.duration),
        blockingMs: round(e.blocking),
        scripts: e.scripts.filter((s) => s.duration > 5).map((s) => `${s.invoker} ${s.fn || ''} ${(s.url || '').split('/').slice(-2).join('/')} ${round(s.duration)}ms`),
      })),
    paints,
    shaderHashes: log.shaders.filter(inWindow).map((s) => s.hash),
  }
}

// The load from the scene's mount until the page settled: how long the
// prewarm kept data-genie-prewarm at building, every frame gap over
// LOAD_GAP_MS, and each blocking pipeline build with its three label (the
// mipmap pass is mipmap-<format>-<view>). Times are from the mount.
const LOAD_GAP_MS = 50
export function loadSummary(log, settledAt) {
  const mountedAt = log.prewarm[0]?.t
  assert.ok(mountedAt !== undefined, 'the page recorder never saw the scene mount')
  const readyAt = log.prewarm.find((p) => p.value === 'ready')?.t
  const gaps = []
  for (let i = 1; i < log.frames.length; i++) {
    if (log.frames[i] > mountedAt && log.frames[i] <= settledAt) gaps.push({ t: log.frames[i], gap: log.frames[i] - log.frames[i - 1] })
  }
  const loading = (e) => e.start >= mountedAt && e.start <= settledAt
  const asyncBuilds = log.api.filter((a) => a.what === 'createRenderPipelineAsync:resolved' && loading(a))
  return {
    prewarmBuildingMs: readyAt === undefined ? null : round(readyAt - mountedAt),
    settledAfterMs: round(settledAt - mountedAt),
    longestGapMs: round(Math.max(0, ...gaps.map((g) => g.gap))),
    longGaps: gaps.filter((g) => g.gap > LOAD_GAP_MS).map((g) => ({ atMs: round(g.t - g.gap - mountedAt), gapMs: round(g.gap) })),
    blockingPipelines: log.api.filter((a) => a.what === 'createRenderPipeline' && loading(a)).map((a) => ({ atMs: round(a.start - mountedAt), label: a.label ?? null })),
    asyncPipelines: { n: asyncBuilds.length, longestMs: round(Math.max(0, ...asyncBuilds.map((a) => a.ms))) },
    longFrames: log.loaf.filter((e) => loading(e) && e.duration > LOAD_GAP_MS).map((e) => ({ atMs: round(e.start - mountedAt), durationMs: round(e.duration), blockingMs: round(e.blocking) })),
  }
}

export function traceSummary(flight) {
  const events = JSON.parse(Buffer.from(flight.trace).toString('utf8')).traceEvents
  const mark = events.find((e) => e.name === flight.mark && (e.cat ?? '').includes('blink.user_timing'))
  assert.ok(mark, `trace has no mark ${flight.mark}`)
  // The mark carries both clocks: trace microseconds and page milliseconds.
  const offset = mark.ts - flight.pressAt * 1000
  const window = { from: mark.ts, to: (flight.landedAt + TAIL_MS) * 1000 + offset }
  const names = threadNames(events)
  const mainTid = [...names].find(([k, n]) => n === 'CrRendererMain' && k.startsWith(`${mark.pid}:`))?.[0].split(':')[1]
  assert.ok(mainTid, 'trace has no renderer main thread for the page')
  const main = mainThreadBreakdown(events, mark.pid, Number(mainTid), window)
  const sampled = Object.values(main.owners).reduce((a, b) => a + b, 0)
  assert.ok(sampled > 0, `${flight.mark}: no CPU samples on the page's main thread`)
  const r = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)]))
  const gpu = gpuProcessBreakdown(events, window)
  return {
    main: { ...r(main.owners), ...r(main.phases), busyMs: round(main.busyMs), longestTaskMs: round(main.longestTaskMs) },
    topFunctions: main.topFunctions.map((f) => `${f.name} ${round(f.ms)}ms`),
    gpu: { syncCompile: r(gpu.sync), asyncCompile: r(gpu.async), mainBusyMs: round(gpu.mainBusyMs), mainLongestTaskMs: round(gpu.mainLongestTaskMs), mainLongestTaskInside: gpu.mainLongestTaskInside.slice(0, 8) },
  }
}
