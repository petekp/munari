// Chrome deterministic keyframe film & verify harness (DPR 2):
// drives `?frameloop=manual` via `stepGpuFrame`/`settleGpuFrames`, stitches
// multi-frame PNG filmstrips for Flight landing, Genie funnel, and Materials
// pointer sweep, and asserts zero snaps, seamless z=0 handoff, and zero post-landing flicker.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'
import { computeRegionDiff, verifyTransitionSequence } from './filmHelpers.mjs'

const here = import.meta.dirname
const repoRoot = path.resolve(here, '..', '..')
const labRoot = path.join(repoRoot, 'apps', 'lab')
const DPR = 2
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
]
  .filter(Boolean)
  .find(existsSync)

assert.ok(chromePath, 'Chrome executable is required (set CHROME_PATH)')

function parseOutDir(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) return path.resolve(process.cwd(), argv[++i])
  }
  return process.env.M5_FILM_DIR ? path.resolve(process.cwd(), process.env.M5_FILM_DIR) : '/tmp/munari-m5-film'
}

async function openManualPage(browser, url) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: DPR })
  await page.setRequestInterception(true)
  const errors = []
  page.on('request', (req) => {
    if (req.url().endsWith('/favicon.ico')) void req.respond({ status: 204, body: '' })
    else void req.continue()
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${String(err)}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  await page.goto(url, { waitUntil: 'load' })
  return { page, errors }
}

async function pumpUntilScene(page) {
  let reachedScene = false
  for (let i = 0; i < 60; i++) {
    const state = await page.evaluate(() => {
      if (!window.__gpuStudio) return null
      window.__gpuStudio.step(0)
      return { pres: window.__gpuStudio.presentation(), stats: window.__gpuStudio.stats() }
    })
    if (state?.pres === 'scene') {
      reachedScene = true
      break
    }
    await sleep(50)
  }
  assert.equal(reachedScene, true, 'Surface never reached scene presentation')
  await page.evaluate(() => window.__gpuStudio.settle({ dtMs: 16, maxSteps: 180 }))
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

async function stepManual(page, totalMs, dtMs = 16) {
  const count = Math.max(1, Math.round(totalMs / dtMs))
  await page.evaluate(
    ({ n, dt }) => {
      for (let i = 0; i < n; i++) window.__gpuStudio.step(dt)
    },
    { n: count, dt: dtMs },
  )
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

async function stitchAndAnalyze(page, frames, region, outFile) {
  const { sw, sh, cropsB64, stitchedB64 } = await page.evaluate(
    async ({ shots, rect, dpr }) => {
      const loadImg = (b64) =>
        new Promise((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = reject
          img.src = `data:image/png;base64,${b64}`
        })
      const imgs = await Promise.all(shots.map((s) => loadImg(s.b64)))
      const sx = Math.max(0, Math.round(rect.left * dpr))
      const sy = Math.max(0, Math.round(rect.top * dpr))
      const sw = Math.min(imgs[0].width - sx, Math.round(rect.width * dpr))
      const sh = Math.min(imgs[0].height - sy, Math.round(rect.height * dpr))

      const readCropB64 = (img) => {
        const c = document.createElement('canvas')
        c.width = sw
        c.height = sh
        const ctx = c.getContext('2d')
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
        const bytes = new Uint8Array(ctx.getImageData(0, 0, sw, sh).data.buffer)
        let bin = ''
        const chunk = 0x8000
        for (let i = 0; i < bytes.length; i += chunk) {
          bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
        }
        return btoa(bin)
      }

      const header = 36
      const gap = 12
      const strip = document.createElement('canvas')
      strip.width = imgs.length * sw + (imgs.length - 1) * gap
      strip.height = sh + header
      const sctx = strip.getContext('2d')
      sctx.fillStyle = '#0f172a'
      sctx.fillRect(0, 0, strip.width, strip.height)
      sctx.font = 'bold 20px system-ui, sans-serif'
      imgs.forEach((img, idx) => {
        const dx = idx * (sw + gap)
        sctx.fillStyle = '#f8fafc'
        sctx.fillText(shots[idx].label, dx + 8, 25)
        sctx.drawImage(img, sx, sy, sw, sh, dx, header, sw, sh)
      })
      const stitched = strip.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
      return { sw, sh, cropsB64: imgs.map(readCropB64), stitchedB64: stitched }
    },
    { shots: frames, rect: region, dpr: DPR },
  )
  writeFileSync(outFile, Buffer.from(stitchedB64, 'base64'))
  const crops = cropsB64.map((b64) => Buffer.from(b64, 'base64'))
  const fullBox = { left: 0, top: 0, width: sw, height: sh }
  const adjacent = []
  for (let i = 1; i < crops.length; i++) adjacent.push(computeRegionDiff(crops[i - 1], crops[i], sw, sh, fullBox, 1))
  const matrix = crops.map((cA) => crops.map((cB) => computeRegionDiff(cA, cB, sw, sh, fullBox, 1)))
  return { adjacent, endToEnd: matrix[0][crops.length - 1], frameDiff: (a, b) => matrix[a][b] }
}

async function runFlightFilm(browser, baseUrl, outDir) {
  const { page, errors } = await openManualPage(browser, `${baseUrl}/?scene=gpu-studio&bare=1&tab=flight&frameloop=manual`)
  try {
    await pumpUntilScene(page)
    const region = await page.evaluate(() => {
      const slot = document.querySelector('[data-gpu-page-slot]')
      const controls = document.querySelector('.gpu-studio-controls')
      const r = slot.getBoundingClientRect()
      const controlsBottom = controls ? controls.getBoundingClientRect().bottom : 0
      const top = Math.max(controlsBottom + 4, r.top - 44)
      return { left: r.left - 44, top, width: r.width + 88, height: Math.max(40, r.bottom + 44 - top) }
    })
    const shots = [{ label: 'scene z=32', b64: await page.screenshot({ encoding: 'base64' }) }]
    await page.click('[data-testid="flight-toggle"]')
    for (const dt of [64, 80, 112]) {
      await stepManual(page, dt, 16)
      shots.push({ label: `+${dt}ms`, b64: await page.screenshot({ encoding: 'base64' }) })
    }

    // Step 16ms at a time while still in 'scene' until right before the atomic 'page' return.
    let preReturnShot = shots[shots.length - 1].b64
    let settledSteps = 0
    while (settledSteps < 90) {
      await stepManual(page, 16, 16)
      settledSteps += 1
      const pres = await page.evaluate(() => window.__gpuStudio.presentation())
      const snap = await page.screenshot({ encoding: 'base64' })
      if (pres === 'page') {
        shots.push({ label: 'scene z≈0', b64: preReturnShot })
        shots.push({ label: '1st page', b64: snap })
        break
      }
      preReturnShot = snap
    }
    assert.equal(await page.evaluate(() => window.__gpuStudio.presentation()), 'page', 'Flight failed to return to page under manual clock')

    // Force a post-return GPU pass and idle settle window to confirm zero double-shadow flicker.
    await stepManual(page, 16, 16)
    await sleep(80)
    assert.equal(await page.evaluate(() => window.__gpuStudio.presentation()), 'page')
    shots.push({ label: '+16ms/+80ms page', b64: await page.screenshot({ encoding: 'base64' }) })

    const analysis = await stitchAndAnalyze(page, shots, region, path.join(outDir, 'flight-landing-filmstrip.png'))
    const descentDiffs = analysis.adjacent.slice(0, shots.length - 3).map((d) => d.meanAbsDiff)
    const descVerdict = verifyTransitionSequence(descentDiffs, analysis.frameDiff(0, shots.length - 3).meanAbsDiff, {
      minTotalDiff: 1.5,
      maxAdjacentDiff: 45,
    })
    assert.ok(descVerdict.ok, `Flight descent film verify failed: ${descVerdict.reasons.join('; ')}`)

    const handoffDiff = analysis.frameDiff(shots.length - 3, shots.length - 2)
    assert.ok(
      handoffDiff.meanAbsDiff < 2.5 && handoffDiff.p95AbsDiff <= 6,
      `Flight landing handoff continuity failed (${JSON.stringify(handoffDiff)})`,
    )
    const postReturnDiff = analysis.frameDiff(shots.length - 2, shots.length - 1)
    assert.ok(
      postReturnDiff.meanAbsDiff < 0.25 && postReturnDiff.maxAbsDiff <= 2,
      `Post-landing HTML flicker detected (${JSON.stringify(postReturnDiff)})`,
    )
    assert.deepEqual(errors, [], `Flight manual film errors: ${errors.join('; ')}`)
    return {
      frames: shots.length,
      totalDiff: analysis.endToEnd.meanAbsDiff,
      handoffDiff,
      postReturnDiff,
    }
  } finally {
    await page.close()
  }
}

async function runGenieFilm(browser, baseUrl, outDir) {
  const { page, errors } = await openManualPage(browser, `${baseUrl}/?scene=gpu-studio&bare=1&tab=genie&frameloop=manual`)
  try {
    await pumpUntilScene(page)
    const region = await page.evaluate(() => {
      const desk = document.querySelector('.gpu-genie-desk')
      const r = desk.getBoundingClientRect()
      return { left: r.left - 16, top: r.top - 16, width: r.width + 32, height: r.height + 32 }
    })
    const shots = [{ label: 'open t=0', b64: await page.screenshot({ encoding: 'base64' }) }]
    await page.click('[data-testid="genie-toggle"]')
    for (const dt of [64, 80, 96]) {
      await stepManual(page, dt, 16)
      shots.push({ label: `+${dt}ms`, b64: await page.screenshot({ encoding: 'base64' }) })
    }
    const settled = await page.evaluate(() => {
      const res = window.__gpuStudio.settle({ dtMs: 16, maxSteps: 180 })
      return res
    })
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    shots.push({ label: 'minimized', b64: await page.screenshot({ encoding: 'base64' }) })
    assert.equal(settled.settled, true, 'Genie did not settle cleanly under manual clock')

    const analysis = await stitchAndAnalyze(page, shots, region, path.join(outDir, 'genie-funnel-filmstrip.png'))
    const verdict = verifyTransitionSequence(analysis.adjacent.map((d) => d.meanAbsDiff), analysis.endToEnd.meanAbsDiff, {
      minTotalDiff: 1.5,
      maxAdjacentDiff: 45,
    })
    assert.ok(verdict.ok, `Genie funnel film verify failed: ${verdict.reasons.join('; ')}`)
    assert.deepEqual(errors, [], `Genie manual film errors: ${errors.join('; ')}`)
    return { frames: shots.length, totalDiff: analysis.endToEnd.meanAbsDiff, settledSteps: settled.steps }
  } finally {
    await page.close()
  }
}

async function runMaterialsSweepFilm(browser, baseUrl, outDir) {
  const { page, errors } = await openManualPage(browser, `${baseUrl}/?scene=gpu-studio&bare=1&tab=materials&frameloop=manual`)
  try {
    await pumpUntilScene(page)
    const region = await page.evaluate(() => {
      const grid = document.querySelector('.gpu-materials-grid')
      const r = grid.getBoundingClientRect()
      return { left: r.left - 12, top: r.top - 12, width: r.width + 24, height: r.height + 24 }
    })
    const shots = []
    for (const x of [360, 500, 640, 780, 920]) {
      await page.mouse.move(x, 300)
      await stepManual(page, 16, 16)
      shots.push({ label: `x=${x}`, b64: await page.screenshot({ encoding: 'base64' }) })
    }
    const analysis = await stitchAndAnalyze(page, shots, region, path.join(outDir, 'materials-sweep-filmstrip.png'))
    const adjacentMeans = analysis.adjacent.map((d) => d.meanAbsDiff)
    const maxStep = Math.max(0, ...adjacentMeans)
    assert.ok(
      maxStep < 18 && analysis.endToEnd.meanAbsDiff >= 0.8 && Math.min(...adjacentMeans) >= 0.15,
      `Materials pointer sweep invalid (maxStep=${maxStep}, endToEnd=${analysis.endToEnd.meanAbsDiff}, adjacent=${JSON.stringify(adjacentMeans)})`,
    )
    assert.deepEqual(errors, [], `Materials sweep film errors: ${errors.join('; ')}`)
    return { frames: shots.length, adjacentMeans, totalDiff: analysis.endToEnd.meanAbsDiff }
  } finally {
    await page.close()
  }
}

const outDir = parseOutDir(process.argv.slice(2))
mkdirSync(outDir, { recursive: true })

const server = await createServer({
  configFile: path.join(labRoot, 'vite.config.ts'),
  root: labRoot,
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 0, strictPort: false },
})
await server.listen()
const address = server.httpServer.address()
const baseUrl = `http://127.0.0.1:${address && 'port' in address ? address.port : 0}`

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: [
    ...WEBGPU_CHROME_ARGS,
    '--enable-features=CanvasDrawElement',
    '--ignore-gpu-blocklist',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    ...(process.env.CI ? ['--no-sandbox'] : []),
  ],
})

try {
  const flight = await runFlightFilm(browser, baseUrl, outDir)
  const genie = await runGenieFilm(browser, baseUrl, outDir)
  const materialsSweep = await runMaterialsSweepFilm(browser, baseUrl, outDir)
  console.log(JSON.stringify({ gate: 'gpu-film', dpr: DPR, outDir, flight, genie, materialsSweep }, null, 2))
} finally {
  await browser.close()
  await server.close()
}
