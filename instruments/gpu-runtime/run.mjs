// Browser acceptance gate for `@petepetrash/munari/gpu` and `gpu-studio`:
// verifies Flight handoff + retained input + airborne click + idle-zero,
// Fisheye warped row/done clicks + filter typing + idle-zero,
// Materials finishes `--munari-body` + two-pass `@group(2)` backdrop pixels,
// and single-retry `device.lost` recovery + permanent HTML degradation in Chrome.

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
]
  .filter(Boolean)
  .find(existsSync)

assert.ok(chromePath, 'Chrome executable is required (set CHROME_PATH)')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function launchChrome() {
  return puppeteer.launch({
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
}

async function openStudioPage(browser, baseUrl, tab) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 })
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.url().endsWith('/favicon.ico')) void req.respond({ status: 204, body: '' })
    else void req.continue()
  })
  const errors = []
  page.on('pageerror', (err) => {
    console.error('[gpu-runtime pageerror]', err)
    errors.push(`pageerror: ${String(err)}`)
  })
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error('[gpu-runtime console.error]', msg.text())
      errors.push(`console.error: ${msg.text()}`)
    }
  })
  await page.goto(`${baseUrl}/?scene=gpu-studio&bare=1&tab=${tab}`, { waitUntil: 'load' })
  await page.waitForFunction(() => Boolean(window.__gpuStudio), { timeout: 10_000 })
  return { page, errors }
}

async function sampleBoxCenterRgb(page, x, y) {
  const base64 = await page.screenshot({ encoding: 'base64' })
  return page.evaluate(
    async ({ b64, sx, sy }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
      })
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(Math.round(sx), Math.round(sy), 1, 1).data
      return { r: d[0], g: d[1], b: d[2], a: d[3] }
    },
    { b64: base64, sx: x, sy: y },
  )
}

async function checkFlight(browser, baseUrl) {
  const { page, errors } = await openStudioPage(browser, baseUrl, 'flight')
  try {
    await page.waitForFunction(() => window.__gpuStudio?.presentation() === 'scene', { timeout: 20_000 })

    // Land card to test clean DOM -> GPU handoff with edited input text.
    await page.click('[data-testid="flight-toggle"]')
    await page.waitForFunction(() => window.__gpuStudio?.presentation() === 'page', { timeout: 10_000 })

    await page.click('[data-testid="flight-note"]')
    await page.keyboard.type(' -> Seat 14A')
    const editedValue = await page.$eval('[data-testid="flight-note"]', (el) => el.value)
    assert.equal(editedValue, 'Check Gate B14 -> Seat 14A')

    await page.click('[data-testid="flight-toggle"]')
    await page.waitForFunction(() => window.__gpuStudio?.presentation() === 'scene', { timeout: 10_000 })
    await sleep(250)

    const airborneNote = await page.$eval('[data-testid="flight-note"]', (el) => el.value)
    assert.equal(airborneNote, 'Check Gate B14 -> Seat 14A', 'Retained input text lost across lift')

    const pt = await page.evaluate(() => window.__gpuStudio?.flightActionPoint())
    assert.ok(pt, 'Missing airborne flightActionPoint')
    await page.mouse.click(pt.x, pt.y)
    await sleep(150)

    const countText = await page.$eval('[data-testid="flight-count"]', (el) => el.textContent)
    assert.equal(countText, 'clicks: 1', 'Airborne button click did not reach retained DOM handler')

    const s0 = await page.evaluate(() => window.__gpuStudio.stats())
    await sleep(500)
    const s1 = await page.evaluate(() => window.__gpuStudio.stats())
    assert.equal(s1.renderCount, s0.renderCount, `Flight rendered while idle: ${s0.renderCount} -> ${s1.renderCount}`)
    assert.deepEqual(errors, [], `Flight errors: ${errors.join('; ')}`)
    return { airborneNote, countText, idleRenders: s1.renderCount - s0.renderCount }
  } finally {
    await page.close()
  }
}

async function checkFisheye(browser, baseUrl) {
  const { page, errors } = await openStudioPage(browser, baseUrl, 'fisheye')
  try {
    await page.waitForFunction(() => window.__gpuStudio?.presentation() === 'scene', { timeout: 20_000 })
    await page.evaluate(() => window.__gpuStudio?.setFisheyeFocus(12))
    await sleep(250)

    const rowPt = await page.evaluate(() => window.__gpuStudio?.fisheyePoint(9, 'row'))
    assert.ok(rowPt, 'Missing fisheye row point')
    await page.mouse.click(rowPt.x, rowPt.y)
    await sleep(150)
    const clickedText = await page.$eval('[data-testid="fisheye-clicked"]', (el) => el.textContent)
    assert.equal(clickedText, 'row: 9', `Warped fisheye row 9 click missed: ${clickedText}`)

    const donePt = await page.evaluate(() => window.__gpuStudio?.fisheyePoint(9, 'done'))
    assert.ok(donePt, 'Missing fisheye done button point')
    await page.mouse.click(donePt.x, donePt.y)
    await sleep(150)
    const doneText = await page.$eval('[data-testid="fisheye-done-count"]', (el) => el.textContent)
    assert.equal(doneText, 'done: 1', `Warped fisheye Done button missed: ${doneText}`)

    await page.focus('[data-testid="fisheye-filter"]')
    await page.keyboard.type('14')
    await sleep(200)
    const rowsText = await page.$eval('[data-testid="fisheye-visible-count"]', (el) => el.textContent)
    assert.equal(rowsText, 'rows: 1', `Filter typing failed: ${rowsText}`)

    await sleep(250)
    const s0 = await page.evaluate(() => window.__gpuStudio.stats())
    await sleep(500)
    const s1 = await page.evaluate(() => window.__gpuStudio.stats())
    assert.equal(s1.renderCount, s0.renderCount, `Fisheye rendered while idle: ${s0.renderCount} -> ${s1.renderCount}`)
    assert.deepEqual(errors, [], `Fisheye errors: ${errors.join('; ')}`)
    return { clickedText, doneText, rowsText, idleRenders: s1.renderCount - s0.renderCount }
  } finally {
    await page.close()
  }
}

async function checkMaterialsAndBackdrop(browser, baseUrl) {
  const { page, errors } = await openStudioPage(browser, baseUrl, 'materials')
  try {
    await page.waitForFunction(() => window.__gpuStudio?.presentation() === 'scene', { timeout: 20_000 })
    await sleep(300)

    const bodyColors = await page.evaluate(() => {
      const slots = [...document.querySelectorAll('[data-gpu-page-slot]')].map((slot) =>
        getComputedStyle(slot).getPropertyValue('--munari-body').trim(),
      )
      const readCapture = (sel) => {
        const el = document.querySelector(sel)
        const root = el?.closest('.ui-root')
        return root ? getComputedStyle(root).getPropertyValue('--munari-body').trim() : ''
      }
      return {
        slots,
        captureLacquer: readCapture('[data-testid="finish-lacquer"]'),
      }
    })
    assert.equal(bodyColors.slots[0], '#7d1924')
    assert.equal(bodyColors.slots[1], '#1b2247')
    assert.equal(bodyColors.slots[2], '#dce8f8')
    assert.equal(bodyColors.captureLacquer, 'transparent')

    const sampleCoords = await page.evaluate(() => {
      const back = document.querySelector('.gpu-backdrop-back')?.getBoundingClientRect()
      const front = document.querySelector('.gpu-backdrop-front')?.getBoundingClientRect()
      if (!back || !front) return null
      return {
        pureOrange: { x: back.left + 30, y: back.bottom - 20 },
        overlapGlass: { x: front.left + 40, y: back.top + 60 },
      }
    })
    assert.ok(sampleCoords, 'Missing backdrop geometry rects')
    const orangePx = await sampleBoxCenterRgb(page, sampleCoords.pureOrange.x, sampleCoords.pureOrange.y)
    const refractedPx = await sampleBoxCenterRgb(page, sampleCoords.overlapGlass.x, sampleCoords.overlapGlass.y)
    assert.ok(orangePx.r > 180 && orangePx.g < 140, `Expected pass-1 orange backdrop pixel, got ${JSON.stringify(orangePx)}`)
    assert.ok(
      refractedPx.r > 140 && refractedPx.b < refractedPx.r,
      `Expected @group(2) tinted orange refraction pixel differing from #e9ecf1, got ${JSON.stringify(refractedPx)}`,
    )

    assert.deepEqual(errors, [], `Materials errors: ${errors.join('; ')}`)
    return { bodyColors, orangePx, refractedPx }
  } finally {
    await page.close()
  }
}

async function checkDeviceLostRecovery(browser, baseUrl) {
  const { page, errors } = await openStudioPage(browser, baseUrl, 'flight')
  try {
    await page.waitForFunction(() => window.__gpuStudio?.presentation() === 'scene', { timeout: 20_000 })
    await page.evaluate(() => {
      const input = document.querySelector('[data-testid="flight-note"]')
      if (input instanceof HTMLInputElement) {
        input.focus()
        input.value = ''
      }
    })
    await page.focus('[data-testid="flight-note"]')
    await page.keyboard.type('Device loss kept')
    await sleep(100)

    const lost1 = await page.evaluate(() => window.__gpuStudio?.simulateLoss())
    assert.equal(lost1, true, 'First simulateLoss returned false')
    await page.waitForFunction(() => window.__gpuStudio?.presentation() === 'scene', { timeout: 20_000 })
    const noteAfterFirst = await page.$eval('[data-testid="flight-note"]', (el) => el.value)
    assert.equal(noteAfterFirst, 'Device loss kept', 'Note lost after first device recovery')

    const lost2 = await page.evaluate(() => window.__gpuStudio?.simulateLoss())
    assert.equal(lost2, true, 'Second simulateLoss returned false')
    await sleep(450)
    const presAfterSecond = await page.evaluate(() => window.__gpuStudio?.presentation())
    assert.equal(presAfterSecond, 'page', `Expected permanent page fallback after repeated loss, got ${presAfterSecond}`)

    await page.click('[data-testid="flight-note"]')
    await page.keyboard.type(' + editable')
    const finalNote = await page.$eval('[data-testid="flight-note"]', (el) => el.value)
    assert.equal(finalNote, 'Device loss kept + editable')
    assert.deepEqual(errors, [], `Device recovery errors: ${errors.join('; ')}`)
    return { noteAfterFirst, presAfterSecond, finalNote }
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
const port = address && 'port' in address ? address.port : 0
const baseUrl = `http://127.0.0.1:${port}`

const browser = await launchChrome()
try {
  const flight = await checkFlight(browser, baseUrl)
  const fisheye = await checkFisheye(browser, baseUrl)
  const materials = await checkMaterialsAndBackdrop(browser, baseUrl)
  const deviceLost = await checkDeviceLostRecovery(browser, baseUrl)
  console.log(JSON.stringify({ gate: 'gpu-runtime', flight, fisheye, materials, deviceLost }, null, 2))
} finally {
  await browser.close()
  await server.close()
}
