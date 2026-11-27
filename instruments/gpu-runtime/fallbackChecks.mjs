// Serial fallback browser checks for `@petepetrash/munari/gpu`: verifies
// graceful fallback to page DOM when WebGPU or all capture paths are off, and
// snapDOM capture fallback when only `CanvasDrawElement` is disabled.

import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

async function withFallbackPage(chromePath, chromeArgs, url, dpr, run) {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      ...chromeArgs,
      '--ignore-gpu-blocklist',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: dpr })
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
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForFunction(() => Boolean(window.__gpuStudio), { timeout: 10_000 })
    return await run(page, errors)
  } finally {
    await browser.close()
  }
}

export async function checkNoWebGpuFallback(ctx) {
  return withFallbackPage(
    ctx.chromePath,
    ['--disable-features=WebGPUService', '--disable-gpu', '--enable-features=CanvasDrawElement'],
    `${ctx.baseUrl}/?scene=gpu-studio&bare=1&tab=flight`,
    ctx.dpr,
    async (page, errors) => {
      await ctx.sleep(300)
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
    },
  )
}

export async function checkNoNativeCaptureWithSnapdom(ctx) {
  return withFallbackPage(
    ctx.chromePath,
    [...WEBGPU_CHROME_ARGS, '--disable-features=CanvasDrawElement'],
    `${ctx.baseUrl}/?scene=gpu-studio&bare=1&tab=flight`,
    ctx.dpr,
    async (page, errors) => {
      const cap = await page.evaluate(() => window.__gpuStudio?.capability())
      assert.equal(cap?.drawElementImage, false, `Expected CanvasDrawElement disabled: ${JSON.stringify(cap)}`)
      await page.waitForFunction(() => window.__gpuStudio?.presentation() === 'scene', { timeout: 20_000 })
      await page.click('[data-testid="flight-toggle"]')
      await page.waitForFunction(() => window.__gpuStudio?.presentation() === 'page', { timeout: 10_000 })
      await page.click('[data-testid="flight-note"]')
      await page.keyboard.type(' + snapdom')
      await page.click('[data-testid="flight-toggle"]')
      await page.waitForFunction(() => window.__gpuStudio?.presentation() === 'scene', { timeout: 10_000 })
      await ctx.sleep(250)
      const pt = await page.evaluate(() => window.__gpuStudio?.flightActionPoint())
      assert.ok(pt, 'Missing flightActionPoint in snapDOM scene fallback')
      await page.mouse.click(pt.x, pt.y)
      await ctx.sleep(150)
      const note = await page.$eval('[data-testid="flight-note"]', (el) => el.value)
      const count = await page.$eval('[data-testid="flight-count"]', (el) => el.textContent)
      assert.equal(note, 'Check Gate B14 + snapdom')
      assert.equal(count, 'clicks: 1')
      await ctx.sleep(200)
      const s0 = await page.evaluate(() => window.__gpuStudio.stats())
      await ctx.sleep(500)
      const s1 = await page.evaluate(() => window.__gpuStudio.stats())
      assert.equal(
        s1.renderCount,
        s0.renderCount,
        `SnapDOM fallback rendered while idle: ${s0.renderCount} -> ${s1.renderCount}`,
      )
      assert.deepEqual(errors, [], `No-native snapDOM fallback errors: ${errors.join('; ')}`)
      return {
        drawElementImage: cap?.drawElementImage,
        pres: 'scene',
        note,
        count,
        idleRenders: s1.renderCount - s0.renderCount,
      }
    },
  )
}

export async function checkNoNativeCaptureNoSnapdom(ctx) {
  return withFallbackPage(
    ctx.chromePath,
    [...WEBGPU_CHROME_ARGS, '--disable-features=CanvasDrawElement'],
    `${ctx.baseUrl}/?scene=gpu-studio&bare=1&tab=flight&capture=none`,
    ctx.dpr,
    async (page, errors) => {
      await ctx.sleep(350)
      const cap = await page.evaluate(() => window.__gpuStudio?.capability())
      assert.equal(cap?.drawElementImage, false, `Expected CanvasDrawElement disabled: ${JSON.stringify(cap)}`)
      const pres = await page.evaluate(() => window.__gpuStudio?.presentation())
      assert.equal(pres, 'page', `No-capture mode should stay on page DOM cleanly, got ${pres}`)
      await page.click('[data-testid="flight-note"]')
      await page.keyboard.type(' + no-capture')
      await page.click('[data-testid="flight-action"]')
      const note = await page.$eval('[data-testid="flight-note"]', (el) => el.value)
      const count = await page.$eval('[data-testid="flight-count"]', (el) => el.textContent)
      assert.equal(note, 'Check Gate B14 + no-capture')
      assert.equal(count, 'clicks: 1')
      assert.deepEqual(errors, [], `No-capture fallback errors: ${errors.join('; ')}`)
      return { drawElementImage: cap?.drawElementImage, pres, note, count }
    },
  )
}
