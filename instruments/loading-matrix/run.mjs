// Loading matrix — cold and warm loads of Bench, Knobs and Light, per
// browser and capture engine, recorded by recorder.mjs.
//
// The law: a first visit must not stop frames, show an incomplete scene, or
// shift layout. This probe measures all three on a built lab, so a change to
// how Munari loads is compared on the same scenes, browsers and engines as
// docs/loading/measurements.md (2026-11-26, f844db5).
//
// Each of PROFILES fresh profiles loads a page LOADS times in one browser
// process: the first load is cold, later ones warm (HTTP cache and the GPU
// process's memory caches hold the first load's work). A load settles when
// fonts are loaded, a Surface source has painted, frames are running, no async
// pipeline is pending, and no capture, node build or adapter request has
// started for 2.5 s, after at least 3 s and at most 25 s. Bench loads then
// switch one card to Oil-slick foil and record 3 s.
// TRACE=1 adds a Chrome trace with screenshots per load, for the filmstrip
// and the GPU process's pipeline builds; traced loads carry tracing overhead
// and are not used for the medians.
//
// Serve the lab build yourself on a loopback address (BASE, default
// http://127.0.0.1:5192): WebGPU needs a secure context, and over plain HTTP
// on another address three falls back to WebGL 2 without an error.
//
// Environment: BASE, OUT, BROWSERS (cft156,chrome159), SCENES
// (finish-demo,knobs,light), ENGINES (html-in-canvas,snapdom), PROFILES (3),
// LOADS (2), TRACE, FRAMED.
//
// Limits: headless Chrome paces frames without a display, so a gap shows the
// page produced no frame, not what a monitor showed. One machine, loopback
// serving, three profiles per cell. The recorder's own overhead is unmeasured.
//
// Ownership: this file drives the browsers and writes one JSON line per load;
// summarize.mjs builds the tables.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { INSTALL } from './recorder.mjs'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

const BROWSER_PATHS = {
  cft156: process.env.HOME + '/.cache/puppeteer/chrome/mac_arm-156.0.8078.47/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  chrome159: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
}
const BASE = process.env.BASE ?? 'http://127.0.0.1:5192'
const OUT = process.env.OUT ?? path.join(import.meta.dirname, 'out')
const BROWSERS = (process.env.BROWSERS ?? 'cft156,chrome159').split(',')
const SCENES = (process.env.SCENES ?? 'finish-demo,knobs,light').split(',')
const ENGINES = (process.env.ENGINES ?? 'html-in-canvas,snapdom').split(',')
const PROFILES = Number(process.env.PROFILES ?? 3)
const LOADS = Number(process.env.LOADS ?? 2)
const TRACE = process.env.TRACE === '1'
const FRAMED = process.env.FRAMED === '1'
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const TRACE_CATEGORIES = ['disabled-by-default-devtools.screenshot', 'devtools.timeline', 'blink.user_timing', 'toplevel', 'gpu', 'gpu.dawn']

function urlFor(scene, engine) {
  const q = new URLSearchParams({ scene })
  if (engine === 'snapdom') q.set('capture', 'snapdom')
  if (FRAMED) q.set('framed', '')
  return BASE + '/?' + q
}

const counts = () => window.__ld && {
  pipes: window.__ld.pipes.length, pending: window.__ld.pipes.filter((p) => p.ms === null).length,
  // Uploads, onpaint calls and offscreen renders repeat every frame in an
  // always-running scene, so they do not count toward settling.
  sources: window.__ld.sources.length, three: window.__ld.three.filter((t) => t.what === 'nodes').length,
  decode: window.__ld.decode.length, gpu: window.__ld.gpu.filter((g) => g.ms === null).length,
  fonts: document.fonts.status,
}

// Settled: fonts loaded, a Surface source painted, frames running, and none of
// the counted activity changed for QUIET_MS, at least MIN_MS after load, at
// most MAX_MS. A GPU-process stall leaves the counts unchanged too, so a quiet
// interval alone settled loads mid-stall, before their first capture.
async function settle(page, { QUIET_MS = 2500, MIN_MS = 3000, MAX_MS = 25000 } = {}) {
  const start = Date.now()
  let last = null
  let quietSince = Date.now()
  while (Date.now() - start < MAX_MS) {
    await sleep(250)
    const c = await (await demoFrame(page)).evaluate(counts).catch(() => null)
    const key = JSON.stringify(c)
    if (key !== last) { last = key; quietSince = Date.now() }
    const frameAge = await (await demoFrame(page)).evaluate(() => performance.now() - (window.__ld?.frames.at(-1) ?? 0)).catch(() => Infinity)
    if (c && c.fonts === 'loaded' && c.pending === 0 && c.sources > 0 && frameAge < 100 && Date.now() - start > MIN_MS && Date.now() - quietSince > QUIET_MS) return { settledAfterMs: Date.now() - start, timedOut: false }
  }
  return { settledAfterMs: Date.now() - start, timedOut: true }
}

async function finishSwitch(page) {
  const before = await page.evaluate(() => ({ t: performance.now(), pipes: window.__ld.pipes.length, three: window.__ld.three.length, frames: window.__ld.frames.length, uploads: window.__ld.uploads.length }))
  const clicked = await page.evaluate(() => {
    const button = [...document.querySelectorAll('.fd-finish-group .fd-finish')].find((b) => b.textContent.trim() === 'Oil-slick foil')
    if (!button) return false
    performance.mark('ld:switch')
    button.click()
    return true
  })
  if (!clicked) return { error: 'no Oil-slick foil button' }
  await sleep(3000)
  return page.evaluate((b) => {
    const L = window.__ld
    const t0 = L.marks.find((m) => m.name === 'ld:switch')?.t ?? b.t
    const frames = L.frames.slice(b.frames)
    const gaps = []
    for (let i = 1; i < frames.length; i++) if (frames[i] - frames[i - 1] > 34) gaps.push({ at: +(frames[i - 1] - t0).toFixed(1), gap: +(frames[i] - frames[i - 1]).toFixed(1) })
    const pipes = L.pipes.slice(b.pipes).map((p) => ({ kind: p.kind, at: +(p.start - t0).toFixed(1), ms: p.ms === null ? null : +p.ms.toFixed(1), label: p.label }))
    const nodes = L.three.slice(b.three).filter((x) => x.what === 'nodes')
    return { pipes, nodeBuilds: nodes.length, nodeMs: +nodes.reduce((a, x) => a + x.ms, 0).toFixed(1), maxNodeMs: +Math.max(0, ...nodes.map((x) => x.ms)).toFixed(1), gaps, uploads: L.uploads.length - b.uploads }
  }, before)
}

function dedupeLong(long) {
  // Keep the outermost long event per thread and time.
  long.sort((a, b) => a.t - b.t || b.ms - a.ms)
  const out = []
  for (const e of long) if (!out.some((o) => o.thread === e.thread && o.proc === e.proc && e.t >= o.t && e.t + e.ms <= o.t + o.ms + 1)) out.push(e)
  return out.filter((e) => !/ThreadControllerImpl::RunTask|RunTask/.test(e.name) || e.ms > 50).slice(0, 40)
}

// Catalog demos load inside an iframe of the site shell; read the recorder
// in the frame that holds the scene.
async function demoFrame(page) {
  return page.frames().find((f) => f !== page.mainFrame() && f.url().includes('scene=')) ?? page.mainFrame()
}

async function traceScreens(trace, ld) {
  const json = JSON.parse(Buffer.from(trace).toString('utf8'))
  const events = json.traceEvents ?? json
  const install = events.find((e) => e.name === 'ld:install')
  const pageInstall = ld.marks.find((m) => m.name === 'ld:install')?.t
  if (!install || pageInstall === undefined) return { error: 'no ld:install mark in trace' }
  const offsetMs = install.ts / 1000 - pageInstall
  const shots = events.filter((e) => e.name === 'Screenshot' && e.args?.snapshot).map((e) => ({ t: e.ts / 1000 - offsetMs, jpg: e.args.snapshot }))
  const procs = new Map(events.filter((e) => e.ph === 'M' && e.name === 'process_name').map((e) => [e.pid, e.args.name]))
  const threads = new Map(events.filter((e) => e.ph === 'M' && e.name === 'thread_name').map((e) => [e.pid + ':' + e.tid, e.args.name]))
  const long = events.filter((e) => e.ph === 'X' && e.dur > 30000).map((e) => ({ t: +(e.ts / 1000 - offsetMs).toFixed(0), ms: +(e.dur / 1000).toFixed(1), name: e.name, proc: procs.get(e.pid), thread: threads.get(e.pid + ':' + e.tid) }))
  const dawn = events.filter((e) => e.ph === 'X' && /CreateRenderPipeline|CreateComputePipeline|CreateShaderModule|Compile/i.test(e.name)).map((e) => ({ t: +(e.ts / 1000 - offsetMs).toFixed(0), ms: +(e.dur / 1000).toFixed(1), name: e.name, proc: procs.get(e.pid), thread: threads.get(e.pid + ':' + e.tid) }))
  const dawnByName = {}
  for (const d of dawn) { const k = d.name + ' @' + d.thread; (dawnByName[k] ??= { n: 0, ms: 0, max: 0 }); dawnByName[k].n++; dawnByName[k].ms = +(dawnByName[k].ms + d.ms).toFixed(1); dawnByName[k].max = Math.max(dawnByName[k].max, d.ms) }
  const gpuMainLong = dawn.filter((d) => d.ms > 16 && /CrGpuMain|GpuMain/i.test(d.thread ?? '')).map((d) => [d.t, d.ms, d.name])
  return { shots, long: dedupeLong(long), dawnByName, gpuMainLong }
}

// Per-frame visual signature: a 48x30 grid of mean RGB, computed in the
// browser, which decodes the JPEGs.
async function signatures(browser, shots) {
  const page = await browser.newPage()
  try {
    const out = []
    for (let i = 0; i < shots.length; i += 20) {
      const batch = shots.slice(i, i + 20).map((s) => s.jpg)
      out.push(...(await page.evaluate(async (jpgs) => {
        const W = 48, H = 30
        const canvas = new OffscreenCanvas(W, H)
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        const res = []
        for (const b64 of jpgs) {
          const blob = await (await fetch('data:image/jpeg;base64,' + b64)).blob()
          const bmp = await createImageBitmap(blob)
          ctx.drawImage(bmp, 0, 0, W, H)
          res.push({ w: bmp.width, h: bmp.height, px: Array.from(ctx.getImageData(0, 0, W, H).data.filter((_, k) => k % 4 !== 3)) })
        }
        return res
      }, batch)))
    }
    return out
  } finally { await page.close() }
}

function visual(shots, sigs) {
  const n = sigs.length
  if (!n) return null
  const diff = (a, b) => { let changed = 0; const cells = a.length / 3; for (let k = 0; k < a.length; k += 3) { const d = Math.max(Math.abs(a[k] - b[k]), Math.abs(a[k + 1] - b[k + 1]), Math.abs(a[k + 2] - b[k + 2])); if (d > 10) changed++ } return changed / cells }
  const final = sigs[n - 1].px
  const steps = []
  for (let i = 1; i < n; i++) {
    const d = diff(sigs[i].px, sigs[i - 1].px)
    if (d > 0.002) steps.push({ i, t: +shots[i].t.toFixed(0), changed: +(d * 100).toFixed(1), fromFinal: +(diff(sigs[i].px, final) * 100).toFixed(1) })
  }
  let complete = null
  for (let i = 0; i < n; i++) if (diff(sigs[i].px, final) <= 0.002) { complete = +shots[i].t.toFixed(0); break }
  return { frames: n, size: sigs[0].w + 'x' + sigs[0].h, firstShotT: +shots[0].t.toFixed(0), lastShotT: +shots[n - 1].t.toFixed(0), visuallyCompleteT: complete, steps }
}

/** Upload, paint, decode, fetch, source and long-frame costs of one load. */
function costs(ld, r, sum) {
  return {
    uploads: { n: ld.uploads.length, ms: r(sum(ld.uploads.map((u) => u.ms))), max: r(Math.max(0, ...ld.uploads.map((u) => u.ms))), first: r(ld.uploads[0]?.start), writeBytes: sum(ld.uploads.filter((u) => u.kind === 'write').map((u) => u.bytes ?? 0)) },
    onpaint: { n: ld.onpaint.length, ms: r(sum(ld.onpaint.map((p) => p.ms))), max: r(Math.max(0, ...ld.onpaint.map((p) => p.ms))), first: r(ld.onpaint[0]?.start) },
    decode: { n: ld.decode.length, ms: r(sum(ld.decode.map((d) => d.ms ?? 0))), max: r(Math.max(0, ...ld.decode.map((d) => d.ms ?? 0))), first: r(ld.decode[0]?.start) },
    fetches: ld.fetches.map((f) => [r(f.start), r(f.ms), f.url.slice(0, 40)]).slice(0, 12),
    sources: { n: ld.sources.length, first: r(ld.sources[0]?.t), last: r(ld.sources.at(-1)?.t), engines: [...new Set(ld.sources.map((s) => s.engine))] },
    loaf: { n: ld.loaf.length, blocking: r(sum(ld.loaf.map((l) => l.blocking))), top: ld.loaf.toSorted((a, b) => b.duration - a.duration).slice(0, 5).map((l) => [r(l.start), r(l.duration), r(l.blocking), l.scripts.map((s) => s.invoker + ':' + r(s.d)).join(', ')]) },
  }
}

function summarize(ld, extra) {
  const r = (x) => (x === null || x === undefined ? null : +x.toFixed(1))
  const sum = (a) => a.reduce((s, x) => s + x, 0)
  const pipesSync = ld.pipes.filter((p) => p.kind === 'sync')
  const pipesAsync = ld.pipes.filter((p) => p.kind === 'async')
  const nodes = ld.three.filter((t) => t.what === 'nodes')
  const offscreen = ld.renders.filter((x) => x.target !== 'screen')
  const screen = ld.renders.filter((x) => x.target === 'screen')
  const gaps = []
  for (let i = 1; i < ld.frames.length; i++) if (ld.frames[i] - ld.frames[i - 1] > 50) gaps.push([r(ld.frames[i - 1]), r(ld.frames[i] - ld.frames[i - 1])])
  const marks = Object.fromEntries(ld.marks.filter((m) => m.name.startsWith('ld:') && m.name !== 'ld:install').map((m) => [m.name, r(m.t)]))
  const gpu = (what) => ld.gpu.filter((g) => g.what === what).map((g) => [r(g.start), r(g.ms)])
  return {
    ...extra,
    backend: ld.backend ?? null,
    adapter: ld.adapter,
    fcp: r(ld.paints.find((p) => p.name === 'first-contentful-paint')?.t),
    lcp: r(ld.lcp.at(-1)?.t), lcpEl: ld.lcp.at(-1)?.el ?? null,
    cls: +sum(ld.shifts.filter((s) => !s.input).map((s) => s.v)).toFixed(4), shifts: ld.shifts.map((s) => [r(s.t), +s.v.toFixed(4), s.sources.join(' | ')]),
    fontsReady: r(ld.fonts.find((f) => f.what === 'ready')?.t),
    fontLoads: ld.fonts.filter((f) => f.what === 'done').map((f) => [r(f.t), f.faces.length]),
    attrs: ld.attrs.map((a) => [r(a.t), a.attr, a.value]),
    requestAdapter: gpu('requestAdapter'), requestDevice: gpu('requestDevice'), configure: gpu('configure'),
    shaderModules: ld.counts.shaderModules, shaderKChars: Math.round(ld.counts.shaderChars / 1000), submits: ld.counts.submits,
    pipesSync: { n: pipesSync.length, ms: r(sum(pipesSync.map((p) => p.ms))), max: r(Math.max(0, ...pipesSync.map((p) => p.ms))), first: r(pipesSync[0]?.start), last: r(pipesSync.at(-1)?.start), top: pipesSync.toSorted((a, b) => b.ms - a.ms).slice(0, 4).map((p) => [r(p.start), r(p.ms), p.label]) },
    syncLabels: pipesSync.map((p) => [r(p.start), p.label]),
    asyncLabels: pipesAsync.map((p) => [r(p.start), r(p.ms), p.label]),
    pipesAsync: { n: pipesAsync.length, first: r(pipesAsync[0]?.start), lastDone: r(Math.max(0, ...pipesAsync.map((p) => p.start + (p.ms ?? 0)))), maxMs: r(Math.max(0, ...pipesAsync.map((p) => p.ms ?? 0))) },
    nodeBuilds: { n: nodes.length, ms: r(sum(nodes.map((x) => x.ms))), max: r(Math.max(0, ...nodes.map((x) => x.ms))), first: r(nodes[0]?.start), last: r(nodes.at(-1)?.start) },
    textureUpdates: { n: ld.three.filter((t) => t.what === 'textures').length, ms: r(sum(ld.three.filter((t) => t.what === 'textures').map((x) => x.ms))) },
    ...costs(ld, r, sum),
    renders: { screen: screen.length, firstScreen: r(screen[0]?.start), offscreen: offscreen.length, offscreenMs: r(sum(offscreen.map((x) => x.ms))), offscreenFirst: r(offscreen[0]?.start), offscreenTargets: [...new Set(offscreen.map((x) => x.target))].slice(0, 6) },
    gaps, nGaps: gaps.length,
    marks,
  }
}

await mkdir(OUT, { recursive: true })
const outFile = path.join(OUT, (TRACE ? 'trace-' : 'runs-') + Date.now() + '.jsonl')
for (const browserName of BROWSERS) for (const scene of SCENES) for (const engine of ENGINES) for (let profile = 0; profile < PROFILES; profile++) {
  const userDataDir = await mkdtemp(path.join(OUT, 'profile-'))
  const nonce = 1 + Math.floor(Math.random() * 2 ** 31)
  const args = [...WEBGPU_CHROME_ARGS, '--enable-features=CanvasDrawElement', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
  const browser = await puppeteer.launch({ executablePath: BROWSER_PATHS[browserName], headless: true, userDataDir, args, protocolTimeout: 120000 })
  try {
    const version = await browser.version()
    for (let load = 0; load < LOADS; load++) {
      const page = await browser.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
      await page.setViewport(VIEWPORT)
      await page.evaluateOnNewDocument(INSTALL, { nonce })
      if (TRACE) await page.tracing.start({ categories: TRACE_CATEGORIES, screenshots: true })
      const t0 = Date.now()
      await page.goto(urlFor(scene, engine), { waitUntil: 'load', timeout: 60000 })
      const s = await settle(page)
      let trace = null
      if (TRACE) trace = await page.tracing.stop()
      const frame = await demoFrame(page)
      const framed = frame !== page.mainFrame()
      const ld = await frame.evaluate(() => window.__ld)
      const topLd = framed ? await page.evaluate(() => window.__ld) : ld
      const frameOffset = framed ? await frame.evaluate(() => performance.timeOrigin) - (await page.evaluate(() => performance.timeOrigin)) : 0
      const engineUsed = await frame.evaluate(() => window.__munari?.engine?.() ?? null)
      const extra = { browser: browserName, version, scene, engine, engineUsed, profile, load: load === 0 ? 'cold' : 'warm', wallMs: Date.now() - t0, ...s, errors, framed, frameOffset: +frameOffset.toFixed(1), top: framed ? { fcp: topLd.paints.find((p) => p.name === 'first-contentful-paint')?.t, lcp: topLd.lcp.at(-1)?.t, cls: +topLd.shifts.filter((x) => !x.input).reduce((a, x) => a + x.v, 0).toFixed(4), shifts: topLd.shifts.map((x) => [+x.t.toFixed(0), +x.v.toFixed(4), x.sources[0]]) } : undefined }
      const summary = summarize(ld, extra)
      if (TRACE && trace) {
        const { shots, error, long, dawnByName, gpuMainLong } = await traceScreens(trace, topLd)
        summary.trace = { long, dawnByName, gpuMainLong }
        if (error) summary.visual = { error }
        else {
          const sigs = await signatures(browser, shots)
          summary.visual = visual(shots, sigs)
          const dir = path.join(OUT, 'frames', [browserName, scene, engine, profile, summary.load].join('-'))
          await mkdir(dir, { recursive: true })
          const keep = new Set([0, shots.length - 1, ...(summary.visual?.steps ?? []).flatMap((x) => [x.i - 1, x.i])])
          for (const i of keep) if (shots[i]) await writeFile(path.join(dir, String(Math.round(shots[i].t)).padStart(6, '0') + '.jpg'), Buffer.from(shots[i].jpg, 'base64'))
        }
      }
      if (scene === 'finish-demo' && !TRACE) summary.finishSwitch = await finishSwitch(page)
      await writeFile(outFile, JSON.stringify(summary) + '\n', { flag: 'a' })
      console.log(JSON.stringify({ browser: browserName, scene, engine, profile, load: summary.load, engineUsed, backend: summary.backend, settled: s.settledAfterMs, timedOut: s.timedOut, fcp: summary.fcp, sources: summary.sources.first, pipesSync: summary.pipesSync.n, pipesAsync: summary.pipesAsync.n, vc: summary.visual?.visuallyCompleteT, errors: errors.length }))
      await page.close()
    }
  } finally {
    await browser.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
}
console.log('wrote', outFile)
