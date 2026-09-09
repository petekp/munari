// knobs-hz — frame-rate evidence for the knobs scene against a 120 Hz
// budget (8.33 ms/frame). Not a gate yet: a reporter. The browser runs
// HEADED with vsync and the frame-rate limiter off, so requestAnimation-
// Frame free-runs. Deltas describe throughput under this workload, not
// display cadence or isolated CPU/GPU duration. The 8.33ms reference is
// one 120Hz frame interval, not a claim about observed display refresh.
//
// Four phases, because the scene has four costs:
//   idle  — the standing animation: art orbits, corona, light rig.
//   drag  — a held dial sweep: DOM value churn, live captures, re-bakes.
//           (The dial's readout is checked before and after — a drag
//           that moved nothing measured nothing.)
//   art-  — the same idle with the SVG art hidden: idle minus art- is
//           the artwork's raster/composite share.
//   off   — POWER off: the floor the demo idles at when the lamp dies.
//
// The GPU string is printed first: numbers from SwiftShader are numbers
// about SwiftShader, and the report must say whose they are.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
import { waitForSurfaceInput } from '../surfaceInput.mjs'

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

function stats(deltas) {
  // The first frames after a phase switch carry setup noise; the
  // measurement is the steady state.
  const d = deltas.slice(5).sort((a, b) => a - b)
  const n = d.length
  if (!n) return null
  const q = (p) => d[Math.min(n - 1, Math.round(p * (n - 1)))]
  const mean = d.reduce((s, v) => s + v, 0) / n
  return {
    frames: n,
    mean,
    p50: q(0.5),
    p95: q(0.95),
    p99: q(0.99),
    max: d[n - 1],
    fps: 1000 / mean,
    over: (100 * d.filter((v) => v > BUDGET_MS).length) / n,
  }
}

function row(label, s) {
  const f = (v, w) => v.toFixed(2).padStart(w)
  return (
    `  ${label.padEnd(6)} ${String(s.frames).padStart(6)}  ` +
    `${f(s.mean, 7)} ${f(s.p50, 7)} ${f(s.p95, 7)} ${f(s.p99, 7)} ${f(s.max, 8)}  ` +
    `${f(s.fps, 7)}  ${f(s.over, 6)}%`
  )
}

let server, browser
const deadline = setTimeout(() => {
  console.error('knobs-hz: hard 120s deadline hit')
  process.exit(1)
}, 120_000)

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    // Headed: the honest compositor path and the machine's real GPU.
    headless: false,
    args: [
      '--enable-features=CanvasDrawElement',
      '--disable-gpu-vsync',
      '--disable-frame-rate-limit',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--window-size=1440,940',
    ],
  })
  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
  const problems = []
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

  const gpu = await page.evaluate(() => {
    const gl = window.__r3f.get().gl.getContext()
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    return gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)
  })

  await page.evaluate(() => {
    const S = (window.__hz = { deltas: [], running: false, long: 0 })
    S.begin = () => {
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
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }
    S.end = () => {
      S.running = false
      S.obs?.disconnect()
      return { deltas: S.deltas.slice(), long: S.long }
    }
  })

  const measure = async (ms) => {
    await page.evaluate(() => window.__hz.begin())
    await sleep(ms)
    return page.evaluate(() => window.__hz.end())
  }

  // Phase 1: idle.
  const idle = await measure(4000)

  // Phase 2: the same idle with the artwork hidden — its raster share.
  // Measured BEFORE the drag so the attribution is of the berth state,
  // not of whatever the drag left warm.
  await page.evaluate(() => {
    document.querySelector('.knb-art').style.visibility = 'hidden'
  })
  await sleep(300)
  const artless = await measure(3000)
  await page.evaluate(() => {
    document.querySelector('.knb-art').style.visibility = ''
  })
  await sleep(300)

  // Phase 3: a held dial sweep, driven through the real input path.
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

  const before = await readLaw('hue')
  const dial = await project('[data-munari-anchor="knob:hue"]')
  await page.mouse.move(dial.x, dial.y)
  await page.mouse.down()
  const dragPromise = (async () => {
    // Whole sine periods, so the dial is handed back where it started
    // and the later phases measure the berth state, not a re-hued one.
    const t0 = Date.now()
    while (Date.now() - t0 < 3000) {
      const t = (Date.now() - t0) / 1000
      await page.mouse.move(dial.x, dial.y + 35 * Math.sin(t * Math.PI * 2))
      await sleep(8)
    }
    await page.mouse.move(dial.x, dial.y)
    await page.mouse.up()
  })()
  await sleep(150)
  const duringDrag = readLaw('hue')
  const drag = await measure(2800)
  await dragPromise
  const mid = await duringDrag
  const after = await readLaw('hue')
  const engaged = mid !== before || after !== before

  // Phase 4: POWER off — the demo's own floor. The long settle lets
  // the die-down finish: the art's brightness filter animates while
  // `lit` falls, and a full-viewport filtered re-raster per frame is a
  // transition cost, not the floor this phase exists to measure.
  const powerBefore = await readLaw('power')
  const toggle = await project('[data-munari-anchor="toggle:power"]')
  await page.mouse.click(toggle.x, toggle.y)
  await sleep(1600)
  const powered = await readLaw('power')
  const toggled = powerBefore === true && powered === false
  const off = await measure(3000)

  const sIdle = stats(idle.deltas)
  const sDrag = stats(drag.deltas)
  const sArt = stats(artless.deltas)
  const sOff = stats(off.deltas)
  if (!sIdle || !sDrag || !sArt || !sOff) throw new Error('One or more phases recorded no frame samples')

  console.log(`knobs-hz: gpu = ${gpu}`)
  console.log(`knobs-hz: reference ${BUDGET_MS} ms/frame, vsync off, dpr 2, 1440x900`)
  console.log(`knobs-hz: drag ${engaged ? `engaged (hue ${before} → ${mid} → ${after})` : 'DID NOT ENGAGE — the drag row measured nothing'}`)
  console.log(`knobs-hz: power toggle ${toggled ? 'engaged (power off)' : `DID NOT ENGAGE — power ${powerBefore} → ${powered}`}`)
  console.log('  phase  frames  mean/ms  p50/ms  p95/ms  p99/ms   max/ms    ~fps   >8.33')
  console.log(row('idle', sIdle))
  console.log(row('drag', sDrag))
  console.log(row('art-', sArt))
  console.log(row('off', sOff))
  console.log(
    `  longtasks: idle ${idle.long}, drag ${drag.long}, art- ${artless.long}, off ${off.long}` +
      (problems.length ? `\n  page errors: ${problems.join(' | ')}` : ''),
  )
  const invalid = []
  if (!engaged) invalid.push('the hue drag did not engage')
  if (!toggled) invalid.push('the power toggle did not engage')
  if (problems.length) invalid.push(`${problems.length} page error(s)`)
  const within = sIdle.p95 <= BUDGET_MS && sDrag.p95 <= BUDGET_MS
  const verdict = invalid.length
    ? `INVALID: ${invalid.join('; ')}`
    : `idle and drag free-running p95 ${within ? 'within' : 'exceeds'} the ${BUDGET_MS} ms reference`
  console.log(`knobs-hz: ${verdict}`)
  if (invalid.length) process.exitCode = 1
} catch (error) {
  console.error(`knobs-hz: INVALID: ${String(error)}`)
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
