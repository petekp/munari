// Wave 2 browser acceptance gate (DPR 2) for `@petepetrash/munari/gpu`:
// verifies zero Three.js / R3F scripts load on `?scene=slider`, `?scene=fisheye`,
// and `?scene=tear-planner`, checks scene presentation, live TearPlanner checkbox/
// text interaction + Tear-off page transition, and zero idle renders after settle.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

const here = import.meta.dirname
const repoRoot = path.resolve(here, '..', '..')
const labRoot = path.join(repoRoot, 'apps', 'lab')

const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
].filter(Boolean).find(existsSync)

assert.ok(chromePath, 'Chrome executable is required (set CHROME_PATH)')

const DPR = 2
const THREE_URL_RE = /(?:^|\/)(?:three(?:[./_-]|$)|three-mesh-bvh|@react-three)/i
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function openWave2Page(browser, url) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: DPR })
  await page.setRequestInterception(true)
  const threeUrls = []
  const errors = []
  page.on('request', (req) => {
    const reqUrl = req.url()
    if (THREE_URL_RE.test(reqUrl)) threeUrls.push(reqUrl)
    if (reqUrl.endsWith('/favicon.ico')) void req.respond({ status: 204, body: '' })
    else void req.continue()
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${String(err)}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  await page.goto(url, { waitUntil: 'load' })
  return { page, threeUrls, errors }
}

async function assertZeroIdle(page, canvasId, label) {
  await page.waitForFunction(
    (id) => {
      const s = window.__munari?.gpuStats?.(id)
      return s && s.renderCount > 0 && s.workClaims === 0
    },
    { timeout: 10_000 },
    canvasId,
  )
  await sleep(120)
  const s0 = await page.evaluate((id) => window.__munari.gpuStats(id), canvasId)
  await sleep(400)
  const s1 = await page.evaluate((id) => window.__munari.gpuStats(id), canvasId)
  assert.equal(s1.renderCount, s0.renderCount, `${label} rendered while idle: ${s0.renderCount} -> ${s1.renderCount}`)
  return s1.renderCount - s0.renderCount
}

async function checkSlider(browser, baseUrl) {
  const { page, threeUrls, errors } = await openWave2Page(browser, `${baseUrl}/?scene=slider&bare=1`)
  try {
    await page.waitForFunction(() => window.__slider?.state().presented === 'scene', { timeout: 20_000 })
    const idleRenders = await assertZeroIdle(page, 'munari-slider', 'Slider')
    assert.deepEqual(threeUrls, [], `slider unexpectedly requested Three.js modules: ${threeUrls.join(', ')}`)
    assert.deepEqual(errors, [], `slider wave2 errors: ${errors.join('; ')}`)
    return { presented: 'scene', idleRenders, zeroThreeModules: true }
  } finally {
    await page.close()
  }
}

async function checkFisheye(browser, baseUrl) {
  const { page, threeUrls, errors } = await openWave2Page(browser, `${baseUrl}/?scene=fisheye&bare=1`)
  try {
    await page.waitForFunction(() => window.__fisheye?.state().presented === 'scene', { timeout: 20_000 })
    const idleRenders = await assertZeroIdle(page, 'munari-fisheye', 'Fisheye')
    assert.deepEqual(threeUrls, [], `fisheye unexpectedly requested Three.js modules: ${threeUrls.join(', ')}`)
    assert.deepEqual(errors, [], `fisheye wave2 errors: ${errors.join('; ')}`)
    return { presented: 'scene', idleRenders, zeroThreeModules: true }
  } finally {
    await page.close()
  }
}

async function checkTearPlanner(browser, baseUrl) {
  const { page, threeUrls, errors } = await openWave2Page(browser, `${baseUrl}/?scene=tear-planner&bare=1`)
  try {
    await page.waitForFunction(
      () => {
        const slots = [...document.querySelectorAll('[data-gpu-page-slot]')]
        const s = window.__munari?.gpuStats?.('munari-tear-planner')
        return slots.length === 2 && s && s.renderCount > 0 && slots.every((el) => getComputedStyle(el).visibility === 'hidden')
      },
      { timeout: 20_000 },
    )
    const initialIdleRenders = await assertZeroIdle(page, 'munari-tear-planner', 'TearPlanner initial')

    const initialWeekday = await page.$eval('.tp-statement', (el) => el.textContent)
    assert.ok(initialWeekday?.includes('Monday'), `Expected initial Monday statement, got ${initialWeekday}`)

    // Edit top sheet blank task line through live DOM & verify carry-over after Tear off.
    const box = await page.evaluate(() => {
      const layer = document.querySelector('.tp-layer[data-top="true"]')
      const slot = document.querySelector('.tp-slot')
      const sheet = layer?.querySelector('.tp-sheet')
      const inputs = [...(layer?.querySelectorAll('.tp-task') ?? [])]
      const blank = inputs.find((el) => el instanceof HTMLInputElement && el.value === '')
      if (!slot || !sheet || !blank) return null
      const sr = slot.getBoundingClientRect()
      const pr = sheet.getBoundingClientRect()
      const er = blank.getBoundingClientRect()
      return {
        x: sr.left + (er.left - pr.left) + er.width / 2,
        y: sr.top + (er.top - pr.top) + er.height / 2,
      }
    })
    assert.ok(box, 'Missing blank task input on TearPlanner top sheet')
    await page.mouse.click(box.x, box.y)
    await page.keyboard.type('Verify WebGPU sheet')
    const typedMonday = await page.evaluate(() =>
      [...document.querySelectorAll('.tp-layer[data-top="true"] .tp-task')].some(
        (el) => el instanceof HTMLInputElement && el.value === 'Verify WebGPU sheet',
      ),
    )
    assert.equal(typedMonday, true, 'Typing into WebGPU TearPlanner sheet input failed before Tear off')

    await page.click('.tp-tear')
    await page.waitForFunction(
      () => document.querySelector('.tp-statement')?.textContent?.includes('Tuesday'),
      { timeout: 15_000 },
    )
    const settledIdleRenders = await assertZeroIdle(page, 'munari-tear-planner', 'TearPlanner after tear')
    const carriedFound = await page.evaluate(() =>
      [...document.querySelectorAll('.tp-layer[data-top="true"] .tp-task')].some(
        (el) => el instanceof HTMLInputElement && el.value === 'Verify WebGPU sheet',
      ),
    )
    assert.equal(carriedFound, true, 'Typed task did not carry onto Tuesday sheet')

    assert.deepEqual(threeUrls, [], `tear-planner unexpectedly requested Three.js modules: ${threeUrls.join(', ')}`)
    assert.deepEqual(errors, [], `tear-planner wave2 errors: ${errors.join('; ')}`)
    return {
      initialIdleRenders,
      settledIdleRenders,
      carriedTaskToTuesday: true,
      zeroThreeModules: true,
    }
  } finally {
    await page.close()
  }
}

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
  const slider = await checkSlider(browser, baseUrl)
  const fisheye = await checkFisheye(browser, baseUrl)
  const tearPlanner = await checkTearPlanner(browser, baseUrl)
  console.log(JSON.stringify({ gate: 'gpu-wave2', dpr: DPR, slider, fisheye, tearPlanner }, null, 2))
} finally {
  await browser.close()
  await server.close()
}
