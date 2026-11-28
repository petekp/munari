// Wave 1 browser acceptance gate (DPR 2) for `@petepetrash/munari/gpu`:
// verifies zero Three.js / R3F scripts load on `?scene=finish-demo` and
// `?scene=gpu-studio`, tests retained DOM interaction + key-light drag +
// analytic pointer tilt on FinishDemo, Genie funnel deform minimize/restore,
// and real pointer hover over Fisheye without test hooks.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
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
const THREE_URL_RE = /(?:^|\/)(?:three(?:[./_-]|$)|three-mesh-bvh|@react-three)/i
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function openWave1Page(browser, url) {
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

async function checkFinishDemo(browser, baseUrl) {
  const { page, threeUrls, errors } = await openWave1Page(browser, `${baseUrl}/?scene=finish-demo`)
  try {
    await page.waitForFunction(
      () => {
        const slots = [...document.querySelectorAll('[data-gpu-page-slot]')]
        return slots.length === 4 && slots.every((s) => getComputedStyle(s).visibility === 'hidden')
      },
      { timeout: 25_000 },
    )
    await sleep(300)

    const bodyColors = await page.evaluate(() =>
      [...document.querySelectorAll('[data-gpu-page-slot]')].map((s) =>
        getComputedStyle(s).getPropertyValue('--munari-body').trim(),
      ),
    )
    assert.equal(bodyColors.length, 4)
    assert.ok(bodyColors.every((c) => c.length > 0), `Expected finish --munari-body on all slots, got ${JSON.stringify(bodyColors)}`)

    // Sample empty padding inside the 3rd card (Dashboard tile · Lacquer) to prove
    // the finish shader draws its crimson body rather than `.ui-root` white.
    const lacquerPt = await page.evaluate(() => {
      const slot = document.querySelectorAll('[data-gpu-page-slot]')[2]
      if (!slot) return null
      const r = slot.getBoundingClientRect()
      return { x: r.left + r.width * 0.85, y: r.top + r.height * 0.45 }
    })
    assert.ok(lacquerPt, 'Missing Lacquer Dashboard tile slot')
    const lacquerShot = await page.screenshot({
      encoding: 'base64',
      clip: { x: Math.round(lacquerPt.x), y: Math.round(lacquerPt.y), width: 1, height: 1 },
    })
    const lacquerSample = await page.evaluate((b64) => {
      return new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
          const c = document.createElement('canvas')
          c.width = 1
          c.height = 1
          const ctx = c.getContext('2d')
          ctx.drawImage(img, 0, 0)
          const d = ctx.getImageData(0, 0, 1, 1).data
          resolve({ r: d[0], g: d[1], b: d[2], a: d[3] })
        }
        img.src = `data:image/png;base64,${b64}`
      })
    }, lacquerShot)
    assert.ok(
      lacquerSample.r > 70 && lacquerSample.r > lacquerSample.g * 1.8 && lacquerSample.r > lacquerSample.b * 1.8,
      `Expected crimson Lacquer finish body on Dashboard tile (got ${JSON.stringify(lacquerSample)})`,
    )

    // Click retained product button through WebGPU Surface raycaster (offset from its capture root onto its grid slot).
    const bagPt = await page.evaluate(() => {
      const card = document.querySelector('[data-context="product"]')
      const slot = card?.querySelector('[data-gpu-page-slot]')
      const btn = card?.querySelector('button')
      if (!slot || !btn) return null
      const sr = slot.getBoundingClientRect()
      const ur = (btn.closest('.ui-root') ?? slot).getBoundingClientRect()
      const br = btn.getBoundingClientRect()
      return { x: sr.left + (br.left - ur.left) + br.width / 2, y: sr.top + (br.top - ur.top) + br.height / 2 }
    })
    assert.ok(bagPt, 'Missing Product card button')
    await page.mouse.move(bagPt.x, bagPt.y)
    await sleep(40)
    await page.mouse.click(bagPt.x, bagPt.y)
    await sleep(150)
    const bagText = await page.$eval('[data-context="product"] button', (el) => el.textContent?.trim())
    assert.equal(bagText, 'In bag: 1', `Product click missed retained handler: ${bagText}`)

    // Drag key light handle cleanly.
    const handlePt = await page.evaluate(() => {
      const el = document.querySelector('.mf-light-handle')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    assert.ok(handlePt, 'Missing .mf-light-handle')
    await page.mouse.move(handlePt.x, handlePt.y)
    await page.mouse.down()
    await page.mouse.move(handlePt.x + 80, handlePt.y - 40, { steps: 5 })
    await page.mouse.up()
    const movedHandle = await page.evaluate(() => {
      const el = document.querySelector('.mf-light-handle')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    assert.ok(movedHandle, 'Missing moved .mf-light-handle')
    assert.ok(
      Math.abs(movedHandle.x - handlePt.x) > 40 && Math.abs(movedHandle.y - handlePt.y) > 20,
      `Key light handle did not move on drag: ${JSON.stringify(handlePt)} -> ${JSON.stringify(movedHandle)}`,
    )

    // Scroll `'Tilt to pointer'` into the rail viewport, enable it, verify pointer moves wake renders, then settle to 0 idle renders.
    const tiltBtnPt = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Tilt to pointer')
      if (!btn) return null
      btn.scrollIntoView({ block: 'center' })
      const r = btn.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    assert.ok(tiltBtnPt, 'Missing Tilt to pointer button')
    await page.mouse.click(tiltBtnPt.x, tiltBtnPt.y)
    const tiltPressed = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Tilt to pointer')
      return btn?.getAttribute('aria-pressed')
    })
    assert.equal(tiltPressed, 'true', 'Tilt to pointer button did not activate on click')
    await page.waitForFunction(() => (window.__finishDemoStats?.()?.workClaims ?? 1) === 0, { timeout: 10_000 })
    const tiltBefore = await page.evaluate(() => window.__finishDemoStats?.().renderCount ?? 0)
    await page.mouse.move(640, 420, { steps: 6 })
    await page.waitForFunction(
      (prev) => (window.__finishDemoStats?.().renderCount ?? 0) > prev,
      { timeout: 5_000 },
      tiltBefore,
    )
    await page.waitForFunction(() => (window.__finishDemoStats?.()?.workClaims ?? 1) === 0, { timeout: 10_000 })
    await sleep(120)
    const t0 = await page.evaluate(() => window.__finishDemoStats?.())
    await sleep(400)
    const t1 = await page.evaluate(() => window.__finishDemoStats?.())
    assert.equal(t1.renderCount, t0.renderCount, `FinishDemo rendered while tilt idle: ${t0.renderCount} -> ${t1.renderCount}`)

    if (process.env.M4_DEMO_DIR) {
      mkdirSync(process.env.M4_DEMO_DIR, { recursive: true })
      const shot = await page.screenshot({ encoding: 'base64' })
      writeFileSync(path.join(process.env.M4_DEMO_DIR, 'finish-demo.png'), Buffer.from(shot, 'base64'))
    }

    assert.deepEqual(threeUrls, [], `finish-demo unexpectedly requested Three.js modules: ${threeUrls.join(', ')}`)
    assert.deepEqual(errors, [], `finish-demo errors: ${errors.join('; ')}`)
    return { cardsInScene: 4, bagText, keyMoved: true, tiltIdleRenders: t1.renderCount - t0.renderCount, zeroThreeModules: true }
  } finally {
    await page.close()
  }
}

async function checkGenieAndRealHover(browser, baseUrl) {
  const { page, threeUrls, errors } = await openWave1Page(browser, `${baseUrl}/?scene=gpu-studio&bare=1&tab=genie`)
  try {
    await page.waitForFunction(() => window.__gpuStudio?.presentation() === 'scene', { timeout: 20_000 })
    await sleep(250)

    await page.focus('[data-testid="genie-note"]')
    await page.keyboard.type('!')
    const beforeNote = await page.$eval('[data-testid="genie-note"]', (el) => el.value)
    assert.equal(beforeNote, 'Funnel stays live DOM!')

    // Trigger minimize from retained DOM button inside the warping sheet.
    const minPt = await page.evaluate(() => {
      const slot = document.querySelector('.gpu-genie-desk [data-gpu-page-slot]')
      const btn = document.querySelector('[data-testid="genie-minimize-btn"]')
      if (!slot || !btn) return null
      const sr = slot.getBoundingClientRect()
      const ur = (btn.closest('.ui-root') ?? slot).getBoundingClientRect()
      const br = btn.getBoundingClientRect()
      return { x: sr.left + (br.left - ur.left) + br.width / 2, y: sr.top + (br.top - ur.top) + br.height / 2 }
    })
    assert.ok(minPt, 'Missing genie-minimize-btn')
    await page.mouse.move(minPt.x, minPt.y)
    await sleep(40)
    await page.mouse.click(minPt.x, minPt.y)

    await page.waitForFunction(() => (window.__gpuStudio?.genieState()?.progress ?? 0) > 0.2, { timeout: 5_000 })
    if (process.env.M4_DEMO_DIR) {
      await sleep(120)
      mkdirSync(process.env.M4_DEMO_DIR, { recursive: true })
      const shot = await page.screenshot({ encoding: 'base64' })
      writeFileSync(path.join(process.env.M4_DEMO_DIR, 'gpu-studio-genie.png'), Buffer.from(shot, 'base64'))
    }
    await page.waitForFunction(
      () => {
        const s = window.__gpuStudio?.genieState()
        const stats = window.__gpuStudio?.stats()
        return Boolean(s && s.minimized && s.settled && s.progress > 0.99 && stats && stats.workClaims === 0)
      },
      { timeout: 10_000 },
    )
    await sleep(100)

    // Verify idle-zero once minimized funnel settles.
    const s0 = await page.evaluate(() => window.__gpuStudio.stats())
    await sleep(400)
    const s1 = await page.evaluate(() => window.__gpuStudio.stats())
    assert.equal(s1.renderCount, s0.renderCount, `Genie rendered while minimized idle: ${s0.renderCount} -> ${s1.renderCount}`)

    // Restore from dock tile and confirm retained input state survived.
    await page.click('[data-testid="genie-dock"]')
    await page.waitForFunction(
      () => {
        const s = window.__gpuStudio?.genieState()
        return Boolean(s && !s.minimized && s.settled && s.progress < 0.01)
      },
      { timeout: 10_000 },
    )
    const afterNote = await page.$eval('[data-testid="genie-note"]', (el) => el.value)
    assert.equal(afterNote, 'Funnel stays live DOM!')

    // Switch to Fisheye tab, wait to settle, then drive real slotted pointer hover (no setFisheyeFocus hook).
    await page.click('[data-testid="tab-fisheye"]')
    await page.waitForFunction(() => Boolean(document.querySelector('[data-testid="fisheye-row-10"]')), { timeout: 10_000 })
    await page.waitForFunction(() => (window.__gpuStudio?.stats().workClaims ?? 1) === 0, { timeout: 10_000 })
    await sleep(100)
    const hoverPt = await page.evaluate(() => {
      const slot = document.querySelector('.gpu-fisheye-wrap [data-gpu-page-slot]')
      const el = document.querySelector('[data-testid="fisheye-row-10"]')
      if (!slot || !el) return null
      const sr = slot.getBoundingClientRect()
      const ur = (el.closest('.ui-root') ?? slot).getBoundingClientRect()
      const rr = el.getBoundingClientRect()
      return {
        x: sr.left + (rr.left - ur.left) + rr.width / 2,
        y: sr.top + (rr.top - ur.top) + rr.height / 2,
        domY: rr.top - ur.top + rr.height / 2,
      }
    })
    assert.ok(hoverPt, 'Missing slotted fisheye-row-10')
    const rendersBeforeHover = await page.evaluate(() => window.__gpuStudio.stats().renderCount)
    await page.mouse.move(hoverPt.x, hoverPt.y)
    await page.waitForFunction(
      (targetDomY) => {
        const fs = window.__gpuStudio?.fisheyeState()
        return Boolean(fs && fs.amp > 1.2 && Math.abs(fs.focusDomY - targetDomY) < 40)
      },
      { timeout: 5_000 },
      hoverPt.domY,
    )
    const rendersAfterHover = await page.evaluate(() => window.__gpuStudio.stats().renderCount)
    assert.ok(rendersAfterHover > rendersBeforeHover, 'Real Fisheye hover did not wake GPU renders')

    // Drag Glass Refract over Backdrop Signal via trusted viewport pointer events.
    await page.click('[data-testid="tab-materials"]')
    await page.waitForFunction(() => Boolean(document.querySelector('[data-testid="backdrop-glass"]')), { timeout: 10_000 })
    await page.waitForFunction(() => (window.__gpuStudio?.stats().workClaims ?? 1) === 0, { timeout: 10_000 })
    await sleep(100)
    const glassPt = await page.evaluate(() => {
      const slot = document.querySelector('.gpu-backdrop-front [data-gpu-page-slot]')
      if (!slot) return null
      const sr = slot.getBoundingClientRect()
      return { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2 }
    })
    assert.ok(glassPt, 'Missing slotted backdrop-glass')
    const rendersBeforeDrag = await page.evaluate(() => window.__gpuStudio.stats().renderCount)
    await page.mouse.move(glassPt.x, glassPt.y)
    await page.mouse.down()
    await page.mouse.move(glassPt.x - 50, glassPt.y, { steps: 5 })
    await page.mouse.up()
    await sleep(120)
    const rendersAfterDrag = await page.evaluate(() => window.__gpuStudio.stats().renderCount)
    assert.ok(rendersAfterDrag > rendersBeforeDrag, 'Glass card drag did not drive GPU renders')

    assert.deepEqual(threeUrls, [], `gpu-studio unexpectedly requested Three.js modules: ${threeUrls.join(', ')}`)
    assert.deepEqual(errors, [], `gpu-studio wave1 errors: ${errors.join('; ')}`)
    return { genieNote: afterNote, genieIdleRenders: s1.renderCount - s0.renderCount, fisheyeHoverWoke: true, glassDragged: true, zeroThreeModules: true }
  } finally {
    await page.close()
  }
}

async function checkFlightLandingAndIdle(browser, baseUrl) {
  const { page, threeUrls, errors } = await openWave1Page(browser, `${baseUrl}/?scene=gpu-studio&bare=1&tab=flight`)
  try {
    await page.waitForFunction(() => window.__gpuStudio?.presentation() === 'scene', { timeout: 20_000 })
    await page.waitForFunction(() => (window.__gpuStudio?.stats().workClaims ?? 1) === 0, { timeout: 10_000 })

    // Landing must descend smoothly while staying in 'scene', before settling into 'page'.
    const beforeLand = await page.evaluate(() => window.__gpuStudio.stats().renderCount)
    await page.click('[data-testid="flight-toggle"]')
    await sleep(90)
    const midLand = await page.evaluate(() => ({
      presentation: window.__gpuStudio.presentation(),
      renderCount: window.__gpuStudio.stats().renderCount,
    }))
    assert.equal(midLand.presentation, 'scene', 'Flight snapped straight to page instead of descending smoothly')
    assert.ok(midLand.renderCount > beforeLand, 'Flight landing did not render transition frames')

    await page.waitForFunction(() => window.__gpuStudio?.presentation() === 'page', { timeout: 10_000 })

    // Re-lifting returns cleanly to 'scene' and settles to zero idle renders.
    await page.click('[data-testid="flight-toggle"]')
    await page.waitForFunction(
      () =>
        window.__gpuStudio?.presentation() === 'scene' &&
        (window.__gpuStudio?.stats().workClaims ?? 1) === 0,
      { timeout: 10_000 },
    )
    await sleep(100)
    const f0 = await page.evaluate(() => window.__gpuStudio.stats())
    await sleep(400)
    const f1 = await page.evaluate(() => window.__gpuStudio.stats())
    assert.equal(f1.renderCount, f0.renderCount, `Flight rendered while settled lifted: ${f0.renderCount} -> ${f1.renderCount}`)

    assert.deepEqual(threeUrls, [], `gpu-studio flight unexpectedly requested Three.js modules: ${threeUrls.join(', ')}`)
    assert.deepEqual(errors, [], `gpu-studio flight errors: ${errors.join('; ')}`)
    return { smoothDescendFrames: midLand.renderCount - beforeLand, settledIdleRenders: f1.renderCount - f0.renderCount, zeroThreeModules: true }
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
  const finishDemo = await checkFinishDemo(browser, baseUrl)
  const genieAndHover = await checkGenieAndRealHover(browser, baseUrl)
  const flight = await checkFlightLandingAndIdle(browser, baseUrl)
  console.log(JSON.stringify({ gate: 'gpu-wave1', dpr: DPR, finishDemo, genieAndHover, flight }, null, 2))
} finally {
  await browser.close()
  await server.close()
}
