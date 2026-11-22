// genie-first-flight — what the first Genie flight after a page load spends.
//
// The law: the first flight of a window pays for work later flights reuse,
// and each part of that work is measured where it runs rather than inferred.
// Per flight this probe records the page's animation-frame gaps, the time
// three spends building node materials, creating pipelines and uploading
// textures, every WebGPU or WebGL compile call the page makes, and, in traced
// browsers, a Chrome trace split by owner (traceBreakdown.ts): JavaScript by
// module, style, layout and paint on the page's main thread, and pipeline
// builds and main-thread tasks in the GPU process. After the flights, each
// distinct pipeline is compiled again from unique source with
// createRenderPipelineAsync, so its own cold compile time is known, labelled by
// the flight that first built it. Traced browsers keep tracing through that
// replay (compileCheck.mjs).
//
// The fault: Pete reported a very noticeable hitch on the first Genie
// interaction after load and none on later ones (2026-11-21). Measured here
// the same night on an Apple Metal-3 adapter: with shaders not yet in any
// cache, the first flight froze frames for 200-250 ms. three builds pipelines
// with the blocking createRenderPipeline, and Dawn runs that call on the GPU
// process's main thread (DeviceBase::APICreateRenderPipeline, 238-314 ms of
// Metal compiles), which stops the page's compositing until it returns. During
// that first flight the page's own main thread never ran a task longer than
// 43 ms.
//
// Caches: Chrome saves Dawn's compiled pipelines on disk per profile, and macOS
// keeps Metal compiles per user in DARWIN_USER_CACHE_DIR/com.google.Chrome.helper,
// shared by every Google Chrome profile. Other Chromium browsers, such as Dia,
// keep their own. A fresh profile is therefore not a cold compile. SHADERS=cached measures what this machine's
// caches already hold; SHADERS=fresh adds an unused local to every entry point,
// unique per load, which is a first visit, or the first load after a shader
// changed.
//
// The flights, in order, on one load: minimize window A (everything cold),
// minimize window B (same sheet material, other window's capture), minimize
// the film window (the film composite material and its FrameSurface), restore
// A (warm). Each engine and shader mode gets BROWSERS fresh profiles of LOADS
// loads each. Even-numbered browsers are traced and odd ones are not, so
// tracing overhead can be read off the frame gaps.
//
// Environment: ENGINES (html-in-canvas,snapdom), SHADERS (cached,fresh),
// BROWSERS (2), LOADS (2), KEEP_TRACES=1 to save each flight's trace,
// COMPILE_CHECK=1 for one more load per browser with no flights that runs
// compileCheck.mjs's compileAsync check, and FIRST_FLIGHT_OUTPUT for the
// summary and traces.
//
// Limits: headless Chrome with a 60 Hz frame clock, a 1280x860 viewport at
// DPR 2, the Vite dev server (React development build), and a lamp press
// rather than a titlebar drag. Compile times belong to this machine's GPU and
// driver; the adapter is recorded and a fallback adapter would show in it.
// There is one film flight per load, so a first-film cost and an every-film
// cost cannot be told apart. This is a diagnostic with no pass threshold; it
// fails only when a flight does not land, the engine is not the one asked
// for, or a traced flight has no CPU samples.
//
// Ownership: run.mjs drives the page and maps page time onto trace time;
// traceBreakdown.ts does the trace arithmetic. The scene is read through one
// observation point added at serve time, the r3f state handed to onCreated.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
import { replaceSource } from '../light/replaceSource.mjs'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'
import { compileCheck, tracedReplay } from './compileCheck.mjs'
import { round, summarize, TAIL_MS, traceSummary } from './flightSummary.mjs'
import { INSTALL } from './pageInstall.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const OUTPUT = process.env.FIRST_FLIGHT_OUTPUT ?? path.join(tmpdir(), 'munari-genie-first-flight')
const ENGINES = (process.env.ENGINES ?? 'html-in-canvas,snapdom').split(',')
const BROWSERS = Number(process.env.BROWSERS ?? 2)
const LOADS = Number(process.env.LOADS ?? 2)
const KEEP_TRACES = process.env.KEEP_TRACES === '1'
// One extra load per browser with no flights, for compileCheck.mjs.
const COMPILE_CHECK = process.env.COMPILE_CHECK === '1'
// cached: shader sources as this machine's GPU caches already hold them.
// fresh: each load's sources are unique, which is a first visit, or the first
// load after a shader changed.
const SHADER_MODES = (process.env.SHADERS ?? 'cached,fresh').split(',')
assert.ok(SHADER_MODES.every((m) => m === 'cached' || m === 'fresh'), 'SHADERS: cached and/or fresh')
assert.ok(ENGINES.every((e) => e === 'html-in-canvas' || e === 'snapdom'), 'ENGINES: html-in-canvas and/or snapdom')
assert.ok(Number.isInteger(BROWSERS) && BROWSERS > 0 && Number.isInteger(LOADS) && LOADS > 0)
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter(Boolean)
  .find((p) => existsSync(p))
assert.ok(CHROME, 'Chrome is required (set CHROME_PATH)')

const VIEWPORT = { width: 1280, height: 860, deviceScaleFactor: 2 }
// Before the press, so the trace's own start-up work is outside the window.
const TRACE_LEAD_MS = 800
const LAND_DEADLINE_MS = 15_000
const TRACE_CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'v8.execute',
  'disabled-by-default-v8.cpu_profiler',
  'disabled-by-default-v8.cpu_profiler.hires',
  'gpu',
  'gpu.dawn',
  'toplevel',
  'blink.user_timing',
]

const RENDERER_HANDOFF = 'onCreated={(state) => state.gl.setClearAlpha(0)}'
const observeRenderer = {
  name: 'genie-first-flight-renderer',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('/scenes/genie/Genie.tsx')) return
    return replaceSource(code, RENDERER_HANDOFF, 'onCreated={(state) => { state.gl.setClearAlpha(0); window.__genieRenderer = state.gl; window.__genieState = state }}')
  },
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function lampPoint(page, win) {
  return page.evaluate((w) => {
    const lamp = document.querySelector(`.gen-slot[data-win="${w}"] .gen-lamp[data-role="minimize"]`)
    if (!lamp) return null
    const r = lamp.getBoundingClientRect()
    const x = r.x + r.width / 2
    const y = r.y + r.height / 2
    return lamp.contains(document.elementFromPoint(x, y)) ? { x, y } : null
  }, win)
}

async function tilePoint(page, win) {
  return page.$eval(`.gen-tile[data-win="${win}"]`, (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
}

/** A lamp under another window cannot be pressed; raise its window first. */
async function pressableLamp(page, win) {
  const point = await lampPoint(page, win)
  if (point) return point
  await page.$eval(`.gen-slot[data-win="${win}"]`, (el) => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9 }))
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9 }))
  })
  await sleep(1200)
  const raised = await lampPoint(page, win)
  assert.ok(raised, `the minimize lamp of ${win} stays covered after raising it`)
  return raised
}

const landed = (kind, win) =>
  kind === 'minimize'
    ? `document.querySelector('.gen-tile[data-win="${win}"]')?.dataset.filled === 'true'`
    : `document.querySelector('.gen-tile[data-win="${win}"]')?.dataset.filled === 'false' && !document.querySelector('.gen-slot[data-win="${win}"]')?.dataset.away`

async function fly(page, { kind, win, mark, traced }) {
  const point = kind === 'minimize' ? await pressableLamp(page, win) : await tilePoint(page, win)
  await page.mouse.move(point.x, point.y, { steps: 4 })
  // Hover repaints the window's capture; let that finish before the press.
  await sleep(700)
  const paintsBefore = await page.evaluate(() => window.__munari.stats())
  if (traced) await page.tracing.start({ categories: TRACE_CATEGORIES })
  await sleep(TRACE_LEAD_MS)
  const pressAt = await page.evaluate((m) => {
    performance.mark(m)
    return performance.now()
  }, mark)
  await page.mouse.down()
  await sleep(30)
  await page.mouse.up()
  await page.waitForFunction(landed(kind, win), { timeout: LAND_DEADLINE_MS })
  const landedAt = await page.evaluate(() => performance.now())
  await sleep(TAIL_MS + 100)
  const trace = traced ? await page.tracing.stop() : null
  const paintsAfter = await page.evaluate(() => window.__munari.stats())
  const log = await page.evaluate(() => {
    const { frames, loaf, api, three, dom, shaders } = window.__ff
    return { frames, loaf, api, three, dom, shaders }
  })
  return { kind, win, mark, pressAt, landedAt, trace, paintsBefore, paintsAfter, log }
}

// One load of the Genie page, settled: fonts loaded, the backend chosen and
// all four windows painted once, then 1.5 s more.
async function openGenie(browser, { engine, shaders, base }) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.setViewport(VIEWPORT)
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
  if (shaders === 'fresh') await page.evaluateOnNewDocument((n) => { window.__ffShaderNonce = n }, 1 + Math.floor(Math.random() * 2 ** 31))
  await page.evaluateOnNewDocument(INSTALL)
  await page.goto(base + (engine === 'snapdom' ? '&capture=snapdom' : ''), { waitUntil: 'load' })
  await page.waitForFunction(
    () =>
      document.fonts.status === 'loaded' &&
      window.__ff.backend !== null &&
      window.__munari?.stats().filter((s) => s.label.startsWith('genie-') && s.paints > 0).length === 4,
    { timeout: 30_000 },
  )
  await sleep(1500)
  const env = await page.evaluate(() => ({ shadersAtLoad: window.__ff.shaders.map((s) => s.hash), engine: window.__munari.engine(), backend: window.__ff.backend, adapter: window.__ff.adapter, webgl: window.__ff.webgl ?? null, dpr: devicePixelRatio, ua: navigator.userAgent }))
  assert.equal(env.engine, engine, 'the page installed a different capture engine')
  return { page, errors, env }
}

let server
const results = []
const checks = []
const deadline = setTimeout(() => {
  console.error('genie-first-flight: hard 15 min deadline hit')
  process.exit(1)
}, 15 * 60_000)
try {
  await mkdir(OUTPUT, { recursive: true })
  server = await createServer({
    root: path.join(ROOT, 'apps/lab'),
    plugins: [observeRenderer],
    cacheDir: path.join(OUTPUT, '.vite'),
    server: { host: '127.0.0.1', port: 0, fs: { allow: [ROOT] } },
    logLevel: 'warn',
  })
  await server.listen()
  const base = `http://127.0.0.1:${server.httpServer.address().port}/?scene=genie&framed`
  for (const engine of ENGINES) for (const shaders of SHADER_MODES) {
    for (let b = 0; b < BROWSERS; b++) {
      const traced = b % 2 === 0
      const profile = await mkdtemp(path.join(OUTPUT, 'profile-'))
      const browser = await puppeteer.launch({
        executablePath: CHROME,
        headless: true,
        userDataDir: profile,
        args: [...WEBGPU_CHROME_ARGS, '--enable-features=CanvasDrawElement', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', ...(process.env.CI ? ['--no-sandbox'] : [])],
      })
      try {
        for (let load = 0; load < LOADS; load++) {
          const { page, errors, env } = await openGenie(browser, { engine, shaders, base })
          const order = ['cerchio', 'quadrato', 'scheda']
          // A: the first candidate whose lamp is pressable now; B: the next.
          let a = null
          for (const w of order) if (!a && (await lampPoint(page, w))) a = w
          a ??= order[0]
          const bWin = order.find((w) => w !== a)
          const plan = [
            { kind: 'minimize', win: a },
            { kind: 'minimize', win: bWin },
            { kind: 'minimize', win: 'triangolo' },
            { kind: 'restore', win: a },
          ]
          const flights = []
          const flightMarks = []
          for (const [i, step] of plan.entries()) {
            const flight = await fly(page, { ...step, mark: `ff-${engine}-${shaders}-${b}-${load}-${i}`, traced })
            const row = { engine, shaders, browser: b, load, order: i + 1, traced, ...summarize(flight), trace: traced ? traceSummary(flight) : null }
            if (traced && KEEP_TRACES) await writeFile(path.join(OUTPUT, `${flight.mark}.json`), Buffer.from(flight.trace))
            flights.push(row)
            flightMarks.push({ pressAt: flight.pressAt, flight: row.flight })
            console.log(JSON.stringify(row))
            await sleep(600)
          }
          // Each pipeline's own cold compile, labelled by the flight that first built it.
          const replayRun = await tracedReplay(page, { traced, categories: TRACE_CATEGORIES, leadMs: TRACE_LEAD_MS })
          const replay = replayRun.rows.map((p) => ({
            ...p,
            firstBuiltBy: flightMarks.findLast((f) => f.pressAt <= p.firstAt)?.flight ?? 'page load',
            coldCompileMs: round(p.coldCompileMs),
          }))
          console.log(JSON.stringify({ engine, shaders, browser: b, load, replay, replayTrace: replayRun.summary }))
          assert.deepEqual(errors, [], 'page errors during the flights')
          results.push({ engine, shaders, browser: b, load, traced, env, flights, replay, replayTrace: replayRun.summary })
          await page.close()
        }
        if (COMPILE_CHECK) {
          const { page, errors, env } = await openGenie(browser, { engine, shaders, base })
          const check = await compileCheck(page, { traced, categories: TRACE_CATEGORIES, leadMs: TRACE_LEAD_MS })
          console.log(JSON.stringify({ engine, shaders, browser: b, compileCheck: check }))
          assert.deepEqual(errors, [], 'page errors during the compile check')
          checks.push({ engine, shaders, browser: b, traced, env, ...check })
          await page.close()
        }
      } finally {
        await browser.close()
        await rm(profile, { recursive: true, force: true })
      }
    }
  }
  await writeFile(path.join(OUTPUT, 'summary.json'), JSON.stringify(results, null, 2))
  if (checks.length) await writeFile(path.join(OUTPUT, 'compile-checks.json'), JSON.stringify(checks, null, 2))
  console.log(`genie-first-flight: ${results.length} loads; summary at ${path.join(OUTPUT, 'summary.json')}`)
} catch (error) {
  console.error('genie-first-flight FAILED:', error)
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
  await server?.close()
}
