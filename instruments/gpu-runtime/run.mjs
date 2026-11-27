// Browser acceptance gate (DPR 2) for `@petepetrash/munari/gpu` and `gpu-studio`:
// verifies Flight retained input, rounded-corner click rejection, chrome occlusion,
// offset/scrolled canvas alignment, airborne click & idle-zero; Fisheye warped clicks
// & filter typing; Materials `--munari-body`, exact `#e85d04`, & `@group(2)` backdrop;
// single-retry `device.lost` recovery; and serial no-WebGPU HTML fallback.

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

const DPR = 2
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function launchChrome(extraArgs = WEBGPU_CHROME_ARGS) {
  return puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      ...extraArgs,
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
  await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: DPR })
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
  if (process.env.STRICT_CAPABILITY === '1') {
    const cap = await page.evaluate(() => window.__gpuStudio?.capability())
    assert.equal(cap?.drawElementImage, true, `STRICT_CAPABILITY=1 requires HTML-in-canvas support: ${JSON.stringify(cap)}`)
  }
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
    { b64: base64, sx: x * DPR, sy: y * DPR },
  )
}

async function checkFlight(browser, baseUrl) {
  const { page, errors } = await openStudioPage(browser, baseUrl, 'flight')
  try {
    await page.waitForFunction(() => window.__gpuStudio?.presentation() === 'scene', { timeout: 20_000 })

    // Land card to test DOM -> GPU handoff with edited input text.
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

    // 1. Rounded-corner hit rejection (2px, 2px sits outside 16px border radius).
    const cornerPt = await page.evaluate(() => {
      window.__cornerCardClicks = 0
      const card = document.querySelector('[data-testid="flight-card-root"]')
      card?.addEventListener('click', () => {
        window.__cornerCardClicks += 1
      })
      return window.__gpuStudio?.flightCornerPoint()
    })
    assert.ok(cornerPt, 'Missing flightCornerPoint')
    await page.mouse.move(cornerPt.x, cornerPt.y)
    await page.mouse.click(cornerPt.x, cornerPt.y)
    await sleep(100)
    const cornerState = await page.evaluate(() => ({
      clicks: window.__cornerCardClicks,
      canvasPe: document.querySelector('.gpu-studio-root canvas')?.style.pointerEvents ?? '',
    }))
    assert.equal(cornerState.clicks, 0, 'Rounded-corner transparent pixel accepted click')
    assert.notEqual(cornerState.canvasPe, 'auto', 'Canvas locked pointerEvents on transparent corner')

    // 2. Airborne button click inside retained DOM.
    const pt = await page.evaluate(() => window.__gpuStudio?.flightActionPoint())
    assert.ok(pt, 'Missing airborne flightActionPoint')
    await page.mouse.click(pt.x, pt.y)
    await sleep(150)
    const countText = await page.$eval('[data-testid="flight-count"]', (el) => el.textContent)
    assert.equal(countText, 'clicks: 1', 'Airborne button click did not reach retained DOM handler')

    // 3. Chrome-over-canvas occlusion: DOM overlay above canvas must win hover & click.
    await page.evaluate(({ x, y }) => {
      window.__overlayClicks = 0
      const btn = document.createElement('button')
      btn.dataset.testid = 'chrome-overlay'
      btn.textContent = 'Chrome Overlay'
      btn.style.cssText = `position:fixed;left:${x - 40}px;top:${y - 20}px;width:80px;height:40px;z-index:9999;`
      btn.addEventListener('click', () => {
        window.__overlayClicks += 1
      })
      document.body.append(btn)
    }, pt)
    await page.mouse.move(pt.x, pt.y)
    const peOverChrome = await page.evaluate(
      () => document.querySelector('.gpu-studio-root canvas')?.style.pointerEvents ?? '',
    )
    assert.equal(peOverChrome, 'none', 'Canvas intercepted hover beneath chrome overlay')
    await page.mouse.click(pt.x, pt.y)
    await sleep(120)
    const overlayResult = await page.evaluate(() => {
      const clicks = window.__overlayClicks
      document.querySelector('[data-testid="chrome-overlay"]')?.remove()
      return { clicks, flightCount: document.querySelector('[data-testid="flight-count"]')?.textContent }
    })
    assert.equal(overlayResult.clicks, 1, 'Chrome overlay did not receive occluded click')
    assert.equal(overlayResult.flightCount, 'clicks: 1', 'Surface beneath chrome overlay unexpectedly clicked')

    // 4. Offset + scrolled canvas alignment.
    await page.evaluate(() => {
      const wrap = document.querySelector('.gpu-studio-canvas-wrap')?.parentElement
      if (wrap) {
        wrap.style.marginTop = '120px'
        wrap.style.marginLeft = '40px'
      }
      document.body.style.minHeight = '1800px'
      window.scrollBy(0, 40)
    })
    await sleep(200)
    const offsetPt = await page.evaluate(() => window.__gpuStudio?.flightActionPoint())
    assert.ok(offsetPt, 'Missing offset flightActionPoint')
    await page.mouse.click(offsetPt.x, offsetPt.y)
    await sleep(150)
    const offsetCountText = await page.$eval('[data-testid="flight-count"]', (el) => el.textContent)
    assert.equal(offsetCountText, 'clicks: 2', 'Offset/scrolled canvas button click missed projected DOM target')

    await page.evaluate(() => {
      const wrap = document.querySelector('.gpu-studio-canvas-wrap')?.parentElement
      if (wrap) {
        wrap.style.marginTop = ''
        wrap.style.marginLeft = ''
      }
      document.body.style.minHeight = ''
      window.scrollTo(0, 0)
    })
    await sleep(200)
    const s0 = await page.evaluate(() => window.__gpuStudio.stats())
    await sleep(500)
    const s1 = await page.evaluate(() => window.__gpuStudio.stats())
    assert.equal(s1.renderCount, s0.renderCount, `Flight rendered while idle: ${s0.renderCount} -> ${s1.renderCount}`)
    assert.deepEqual(errors, [], `Flight errors: ${errors.join('; ')}`)
    return { airborneNote, countText: offsetCountText, idleRenders: s1.renderCount - s0.renderCount }
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
        const root = document.querySelector(sel)?.closest('.ui-root')
        return root ? getComputedStyle(root).getPropertyValue('--munari-body').trim() : ''
      }
      return { slots, captureLacquer: readCapture('[data-testid="finish-lacquer"]') }
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
        pureOrange: { x: back.left + 25, y: back.top + 60 },
        overlapGlass: { x: front.left + 40, y: back.top + 60 },
      }
    })
    assert.ok(sampleCoords, 'Missing backdrop geometry rects')
    const orangePx = await sampleBoxCenterRgb(page, sampleCoords.pureOrange.x, sampleCoords.pureOrange.y)
    const refractedPx = await sampleBoxCenterRgb(page, sampleCoords.overlapGlass.x, sampleCoords.overlapGlass.y)
    assert.ok(
      Math.abs(orangePx.r - 232) <= 5 && Math.abs(orangePx.g - 93) <= 5 && Math.abs(orangePx.b - 4) <= 5,
      `Expected exact unlit #e85d04 {232,93,4}, got ${JSON.stringify(orangePx)}`,
    )
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

    assert.equal(await page.evaluate(() => window.__gpuStudio?.simulateLoss()), true)
    await page.waitForFunction(() => window.__gpuStudio?.presentation() === 'scene', { timeout: 20_000 })
    const noteAfterFirst = await page.$eval('[data-testid="flight-note"]', (el) => el.value)
    assert.equal(noteAfterFirst, 'Device loss kept', 'Note lost after first device recovery')

    assert.equal(await page.evaluate(() => window.__gpuStudio?.simulateLoss()), true)
    await sleep(450)
    const presAfterSecond = await page.evaluate(() => window.__gpuStudio?.presentation())
    assert.equal(presAfterSecond, 'page', `Expected permanent page fallback, got ${presAfterSecond}`)

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

async function checkNoWebGpuFallback(baseUrl) {
  const browser = await launchChrome(['--disable-features=WebGPUService', '--disable-gpu'])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: DPR })
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      if (req.url().endsWith('/favicon.ico')) void req.respond({ status: 204, body: '' })
      else void req.continue()
    })
    const errors = []
    page.on('pageerror', (err) => errors.push(`pageerror: ${String(err)}`))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`)
    })
    await page.goto(`${baseUrl}/?scene=gpu-studio&bare=1&tab=flight`, { waitUntil: 'load' })
    await page.waitForFunction(() => Boolean(window.__gpuStudio), { timeout: 10_000 })
    await sleep(300)
    const pres = await page.evaluate(() => window.__gpuStudio?.presentation())
    assert.equal(pres, 'page', `No-WebGPU mode should stay on page DOM, got ${pres}`)
    await page.click('[data-testid="flight-note"]')
    await page.keyboard.type(' + fallback')
    await page.click('[data-testid="flight-action"]')
    const note = await page.$eval('[data-testid="flight-note"]', (el) => el.value)
    const count = await page.$eval('[data-testid="flight-count"]', (el) => el.textContent)
    assert.equal(note, 'Check Gate B14 + fallback')
    assert.equal(count, 'clicks: 1')
    assert.deepEqual(errors, [], `No-WebGPU fallback errors: ${errors.join('; ')}`)
    return { pres, note, count }
  } finally {
    await browser.close()
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

let browser = await launchChrome()
let results
try {
  const flight = await checkFlight(browser, baseUrl)
  const fisheye = await checkFisheye(browser, baseUrl)
  const materials = await checkMaterialsAndBackdrop(browser, baseUrl)
  const deviceLost = await checkDeviceLostRecovery(browser, baseUrl)
  await browser.close()
  browser = null
  const noWebGpuFallback = await checkNoWebGpuFallback(baseUrl)
  results = { gate: 'gpu-runtime', dpr: DPR, flight, fisheye, materials, deviceLost, noWebGpuFallback }
  console.log(JSON.stringify(results, null, 2))
} finally {
  if (browser) await browser.close()
  await server.close()
}
