// knobs-hz — Knobs throughput, free-running where the scene allows it.
// The idle phases run headed with vsync and the frame-rate limit off, so
// their RAF deltas describe throughput. Display FPS and isolated CPU/GPU
// durations remain unmeasured. The 8.33ms reference comes from one 120Hz
// display interval.
//
// Four phases, because the scene has four costs:
//   idle  — the standing animation: art orbits, corona, light rig.
//   art-  — the same idle with the SVG art hidden: idle minus art- is
//           the artwork's raster/composite share.
//   off   — POWER off: the floor the demo idles at when the lamp dies.
//   drag  — a held dial sweep: DOM value churn, live captures, re-bakes.
//           (The dial's readout is checked before and after — a drag
//           that moved nothing measured nothing.)
//
// The drag runs in a second browser with vsync ON and reports missed
// display frames instead. Free-running, WebGPU's ~1,200 RAF callbacks/s
// left React's scheduler no task time, so the dial value never moved
// (0 of 5 runs, 2026-10-09, M4 Max; WebGL 2's ~580/s left enough).
//
// The backend and GPU name print first: numbers from SwiftShader are
// numbers about SwiftShader, and the report must say whose they are.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
import { waitForSurfaceInput } from '../surfaceInput.mjs'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const labRoot = path.resolve(here, '..', '..', 'apps', 'lab')

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]
  .filter(Boolean)
  .find((p) => existsSync(p))

if (!CHROME) {
  console.error('knobs-hz: no Chrome executable found (set CHROME_PATH)')
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const BUDGET_MS = 8.33
// An interval past 1.5 display intervals spans at least one vsync the
// page did not present on. The display interval is the drag's own median,
// so a 60 Hz display is judged against 16.7 ms, not the 120 Hz reference.
const MISSED_FRAME_FACTOR = 1.5

function stats(deltas) {
  // The first frames after a phase switch carry setup noise; the
  // measurement is the steady state.
  const d = deltas.slice(5).sort((a, b) => a - b)
  const n = d.length
  if (!n) return null
  // Unlimited RAF callbacks can share a timestamp. Keep zero intervals,
  // but require the clock to advance across the sample.
  if (d.some(value => !Number.isFinite(value) || value < 0))
    throw new Error('frame observer returned a negative or non-finite delta')
  const q = (p) => d[Math.min(n - 1, Math.round(p * (n - 1)))]
  const mean = d.reduce((s, v) => s + v, 0) / n
  if (!Number.isFinite(mean) || mean <= 0) throw new Error('frame observer clock did not advance')
  const p50 = q(0.5)
  return {
    samples: n,
    mean,
    p50,
    p95: q(0.95),
    p99: q(0.99),
    max: d[n - 1],
    callbacksPerSecond: 1000 / mean,
    zeroDeltas: d.filter(value => value === 0).length,
    over: (100 * d.filter((v) => v > BUDGET_MS).length) / n,
    missed: (100 * d.filter((v) => v > p50 * MISSED_FRAME_FACTOR).length) / n,
  }
}

function row(label, s) {
  const f = (v, w) => v.toFixed(2).padStart(w)
  return (
    `  ${label.padEnd(6)} ${String(s.samples).padStart(7)}  ` +
    `${f(s.mean, 7)} ${f(s.p50, 7)} ${f(s.p95, 7)} ${f(s.p99, 7)} ${f(s.max, 8)}  ` +
    `${f(s.callbacksPerSecond, 11)} ${String(s.zeroDeltas).padStart(5)}  ${f(s.over, 6)}%`
  )
}

async function launch(vsync) {
  return puppeteer.launch({
    executablePath: CHROME,
    // Headed: the honest compositor path and the machine's real GPU.
    headless: false,
    args: [
      ...WEBGPU_CHROME_ARGS,
      '--enable-features=CanvasDrawElement',
      ...(vsync ? [] : ['--disable-gpu-vsync', '--disable-frame-rate-limit']),
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--window-size=1440,940',
    ],
  })
}

async function openKnobs(browser, port, problems) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
  page.on('pageerror', (err) => problems.push(String(err)))
  await page.goto(`http://localhost:${port}/?scene=knobs&framed`, { waitUntil: 'load' })
  await page.waitForFunction(
    () => document.querySelector('[data-munari-surface="knobs-panel"] .knb-panel') &&
      window.__r3f?.get().scene.getObjectByName('knobs-panel-surface'),
    { timeout: 15_000 },
  )
  await waitForSurfaceInput(page, 'knobs-panel-surface')
  // Let mounting, first captures, and the art's first bake settle.
  await sleep(3000)

  await page.evaluate(() => {
    const S = (window.__hz = { deltas: [], running: false, long: 0, raf: 0 })
    S.begin = () => {
      if (S.running || S.raf) throw new Error('a timing phase is already running')
      S.deltas.length = 0
      S.long = 0
      S.running = true
      S.obs = new PerformanceObserver((list) => {
        S.long += list.getEntries().length
      })
      S.obs.observe({ entryTypes: ['longtask'] })
      let prev = 0
      const tick = (t) => {
        if (!S.running) return
        if (prev) S.deltas.push(t - prev)
        prev = t
        S.raf = requestAnimationFrame(tick)
      }
      S.raf = requestAnimationFrame(tick)
    }
    S.end = () => {
      S.running = false
      cancelAnimationFrame(S.raf)
      S.raf = 0
      S.long += S.obs?.takeRecords().length ?? 0
      S.obs?.disconnect()
      return { deltas: S.deltas.slice(), long: S.long }
    }
  })

  const measure = async (ms) => {
    await page.evaluate(() => window.__hz.begin())
    await sleep(ms)
    return page.evaluate(() => window.__hz.end())
  }

  // Map the source control's UV through the actual mesh and camera. The
  // scene owns panel placement, so the probe carries no duplicate layout constants.
  const project = (sel) =>
    page.evaluate((s) => {
      const state = window.__r3f.get()
      const source = document.querySelector('[data-munari-source-host][data-munari-surface="knobs-panel"]')
      const element = source?.querySelector(s)
      const mesh = state.scene.getObjectByName('knobs-panel-surface')
      if (!source || !element || !mesh?.geometry) throw new Error(`Cannot project Knobs control ${s}`)
      mesh.geometry.computeBoundingBox()
      const box = mesh.geometry.boundingBox
      const sourceRect = source.getBoundingClientRect()
      const rect = element.getBoundingClientRect()
      if (!box || sourceRect.width <= 0 || sourceRect.height <= 0 || rect.width <= 0 || rect.height <= 0) {
        throw new Error(`Knobs control ${s} has no measurable source box`)
      }
      const u = (rect.left + rect.width / 2 - sourceRect.left) / sourceRect.width
      const v = (rect.top + rect.height / 2 - sourceRect.top) / sourceRect.height
      const point = mesh.position.clone().set(
        box.min.x + (box.max.x - box.min.x) * u,
        box.max.y - (box.max.y - box.min.y) * v,
        0,
      )
      mesh.updateWorldMatrix(true, false)
      mesh.localToWorld(point).project(state.camera)
      const canvas = state.gl.domElement.getBoundingClientRect()
      return {
        x: canvas.left + (point.x + 1) * canvas.width / 2,
        y: canvas.top + (1 - point.y) * canvas.height / 2,
      }
    }, sel)
  const readLaw = (key) =>
    page.evaluate(async (k) => {
      const m = await import('/src/scenes/knobs/knobsLaw.ts')
      return m.knobsValues[k]
    }, key)

  return { page, measure, project, readLaw }
}

let server
const browsers = []
const deadline = setTimeout(() => {
  console.error('knobs-hz: hard 150s deadline hit')
  for (const browser of browsers) browser.process()?.kill('SIGKILL')
  process.exit(1)
}, 150_000)

try {
  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port
  const problems = []

  // ── free-running: idle, art-, off ─────
  const free = await launch(false)
  browsers.push(free)
  const freeRun = await openKnobs(free, port, problems)

  const gpu = await freeRun.page.evaluate(async () => {
    const renderer = window.__r3f.get().gl
    if (renderer.backend.isWebGPUBackend) {
      const info = renderer.backend.device.adapterInfo
      return `webgpu: ${[info.vendor, info.architecture, info.description].filter(Boolean).join(' ')}`
    }
    const gl = renderer.getContext()
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    return `webgl2: ${gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)}`
  })

  // Phase 1: idle.
  const idle = await freeRun.measure(4000)

  // Phase 2: the same idle with the artwork hidden — its raster share.
  await freeRun.page.evaluate(() => {
    const art = document.querySelector('.knb-page > .knb-art')
    if (!art) throw new Error('the native Knobs artwork is missing')
    window.__hz.art = art
    window.__hz.artVisibility = art.style.visibility
    art.style.visibility = 'hidden'
    if (getComputedStyle(art).visibility !== 'hidden') throw new Error('artwork did not become hidden')
  })
  await sleep(300)
  const artless = await freeRun.measure(3000)
  await freeRun.page.evaluate(() => {
    window.__hz.art.style.visibility = window.__hz.artVisibility
  })
  await sleep(300)

  // Phase 3: POWER off — the demo's own floor. The long settle lets
  // the die-down finish: the art's brightness filter animates while
  // `lit` falls, and a full-viewport filtered re-raster per frame is a
  // transition cost, not the floor this phase exists to measure.
  const powerBefore = await freeRun.readLaw('power')
  const toggle = await freeRun.project('[data-munari-anchor="toggle:power"]')
  await freeRun.page.mouse.click(toggle.x, toggle.y)
  await sleep(1600)
  const powered = await freeRun.readLaw('power')
  const toggled = powerBefore === true && powered === false
  const off = await freeRun.measure(3000)
  await free.close()

  // ── display rate: drag ─────
  const paced = await launch(true)
  browsers.push(paced)
  const pacedRun = await openKnobs(paced, port, problems)

  // Phase 4: a held dial sweep, driven through the real input path.
  const before = await pacedRun.readLaw('hue')
  const dial = await pacedRun.project('[data-munari-anchor="knob:hue"]')
  await pacedRun.page.mouse.move(dial.x, dial.y)
  await pacedRun.page.mouse.down()
  const dragPromise = (async () => {
    // Whole sine periods, so the dial is handed back where it started.
    const t0 = Date.now()
    while (Date.now() - t0 < 3000) {
      const t = (Date.now() - t0) / 1000
      await pacedRun.page.mouse.move(dial.x, dial.y + 35 * Math.sin(t * Math.PI * 2))
      await sleep(8)
    }
    await pacedRun.page.mouse.move(dial.x, dial.y)
    await pacedRun.page.mouse.up()
  })()
  await sleep(150)
  const duringDrag = pacedRun.readLaw('hue')
  const drag = await pacedRun.measure(2800)
  await dragPromise
  const mid = await duringDrag
  const after = await pacedRun.readLaw('hue')
  const engaged = mid !== before || after !== before

  const sIdle = stats(idle.deltas)
  const sDrag = stats(drag.deltas)
  const sArt = stats(artless.deltas)
  const sOff = stats(off.deltas)
  if (!sIdle || !sDrag || !sArt || !sOff) throw new Error('One or more phases recorded no frame samples')

  console.log(`knobs-hz: ${gpu}`)
  console.log(`knobs-hz: RAF callback throughput; reference ${BUDGET_MS} ms, vsync off, dpr 2, 1440x900`)
  console.log(`knobs-hz: power toggle ${toggled ? 'engaged (power off)' : `DID NOT ENGAGE — power ${powerBefore} → ${powered}`}`)
  console.log('  phase  samples  mean/ms  p50/ms  p95/ms  p99/ms   max/ms  callbacks/s zeros   >8.33')
  console.log(row('idle', sIdle))
  console.log(row('art-', sArt))
  console.log(row('off', sOff))
  console.log(`knobs-hz: drag at display rate, vsync on: ${engaged ? `engaged (hue ${before} → ${mid} → ${after})` : 'DID NOT ENGAGE — the drag row measured nothing'}`)
  console.log(
    `  drag   ${sDrag.samples} intervals, p50 ${sDrag.p50.toFixed(2)} ms, p99 ${sDrag.p99.toFixed(2)} ms, ` +
      `max ${sDrag.max.toFixed(2)} ms, ${sDrag.missed.toFixed(2)}% past ${MISSED_FRAME_FACTOR}× p50 (missed a display frame)`,
  )
  console.log(
    `  longtasks: idle ${idle.long}, art- ${artless.long}, off ${off.long}, drag ${drag.long}` +
      (problems.length ? `\n  page errors: ${problems.join(' | ')}` : ''),
  )
  const invalid = []
  if (!engaged) invalid.push('the hue drag did not engage')
  if (!toggled) invalid.push('the power toggle did not engage')
  if (problems.length) invalid.push(`${problems.length} page error(s)`)
  const verdict = invalid.length
    ? `INVALID: ${invalid.join('; ')}`
    : `idle free-running p95 ${sIdle.p95 <= BUDGET_MS ? 'within' : 'exceeds'} the ${BUDGET_MS} ms reference; ` +
      `drag missed ${sDrag.missed.toFixed(2)}% of display frames`
  console.log(`knobs-hz: ${verdict}`)
  if (invalid.length) process.exitCode = 1
} catch (error) {
  console.error(`knobs-hz: INVALID: ${String(error)}`)
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
  for (const browser of browsers) await browser.close().catch(() => {})
  await server?.close()
}
