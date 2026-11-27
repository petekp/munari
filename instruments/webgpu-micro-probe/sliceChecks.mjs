// Browser slice checks for FlightSlice and FisheyeSlice plus PNG diff helper.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

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

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launchChrome(extraArgs = []) {
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
      ...extraArgs,
    ],
  })
}

export async function runFlightCheck(baseUrl, material = 'wgsl', captureAirborne = false) {
  let browser
  try {
    browser = await launchChrome(['--enable-unsafe-swiftshader'])
    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 860, deviceScaleFactor: 1 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    const matQuery = material === 'wgsl' ? '' : `&material=${material}`
    await page.goto(`${baseUrl}/scenes.html?scene=flight${matQuery}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__flightMicro?.ready === true, { timeout: 20_000 })

    await page.click('.flight-input')
    await page.keyboard.press('End')
    await page.keyboard.type(' + edited')
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })
    await sleep(100)
    const beforeLift = await page.evaluate(() => window.__flightMicro.state())
    assert.equal(beforeLift.presentation, 'page')
    assert.equal(beforeLift.note, 'initial note + edited')

    await page.evaluate(() => window.__flightMicro.lift())
    await page.waitForFunction(() => window.__flightMicro.state().presentation === 'scene', { timeout: 10_000 })
    await sleep(captureAirborne ? 850 : 250)
    const screenshot = captureAirborne ? await page.screenshot({ encoding: 'base64' }) : null
    const airborne = await page.evaluate(() => window.__flightMicro.state())
    assert.equal(airborne.pageHidden, true, 'Page slot should be hidden once scene presents')
    assert.equal(airborne.note, 'initial note + edited', 'Retained input value lost on lift')

    const incPt = await page.evaluate(() => window.__flightMicro.buttonPoint('increment'))
    assert.ok(incPt, 'Missing airborne button point')
    await page.mouse.click(incPt.x, incPt.y)
    await sleep(150)
    const afterClick = await page.evaluate(() => window.__flightMicro.state())
    assert.equal(afterClick.count, 1, 'Airborne button click did not relay into retained DOM')

    await page.evaluate(() => window.__flightMicro.land())
    await page.waitForFunction(() => window.__flightMicro.state().presentation === 'page', { timeout: 10_000 })
    await sleep(200)
    const landed = await page.evaluate(() => window.__flightMicro.state())
    assert.equal(landed.pageHidden, false, 'Page slot stayed hidden after landing')
    assert.equal(landed.count, 1, 'Count state lost on landing')
    assert.equal(landed.note, 'initial note + edited', 'Input value lost on landing')

    const s0 = await page.evaluate(() => window.__flightMicro.stats())
    await sleep(1000)
    const s1 = await page.evaluate(() => window.__flightMicro.stats())
    assert.equal(s1.renderCount, s0.renderCount, `Flight rendered while idle: ${s0.renderCount} -> ${s1.renderCount}`)
    assert.equal(s1.paints, s0.paints, `Flight painted while idle: ${s0.paints} -> ${s1.paints}`)
    const gpuErrors = await page.evaluate(() => window.__microWebGpuErrors ?? [])
    assert.deepEqual(gpuErrors, [], `WebGPU validation errors in FlightSlice: ${gpuErrors.join('; ')}`)
    assert.deepEqual(errors, [], `Page errors in FlightSlice: ${errors.join('; ')}`)
    return {
      beforeLift,
      airborne,
      afterClick,
      landed,
      idleDelta: { renders: s1.renderCount - s0.renderCount, paints: s1.paints - s0.paints },
      screenshot,
    }
  } finally {
    await browser?.close()
  }
}

export async function runFisheyeCheck(baseUrl, material = 'wgsl', captureWarped = false) {
  let browser
  try {
    browser = await launchChrome(['--enable-unsafe-swiftshader'])
    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 860, deviceScaleFactor: 1 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    const matQuery = material === 'wgsl' ? '' : `&material=${material}`
    await page.goto(`${baseUrl}/scenes.html?scene=fisheye${matQuery}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__fisheyeMicro?.ready === true, { timeout: 20_000 })
    await page.waitForFunction(() => window.__fisheyeMicro.state().presented === 'scene', { timeout: 20_000 })
    await sleep(250)

    const clickAndRead = async (x, y) => {
      const bc = await page.evaluate(() => window.__fisheyeMicro.clicks.length)
      const ba = await page.evaluate(() => window.__fisheyeMicro.acts.length)
      await page.mouse.click(x, y)
      await sleep(120)
      return page.evaluate((prevC, prevA) => ({
        click: window.__fisheyeMicro.clicks.length > prevC ? window.__fisheyeMicro.clicks[window.__fisheyeMicro.clicks.length - 1] : null,
        act: window.__fisheyeMicro.acts.length > prevA ? window.__fisheyeMicro.acts[window.__fisheyeMicro.acts.length - 1] : null,
      }), bc, ba)
    }

    const FOCUS = 36 + 14.5 * 22
    await page.evaluate((f) => window.__fisheyeMicro.lock(f, 1), FOCUS)
    await sleep(200)
    const flat10 = await page.evaluate(() => window.__fisheyeMicro.rowScreenCenter(10))
    const flatRes = await clickAndRead(flat10.x, flat10.y)
    assert.equal(flatRes.click?.row, 10, `Flat row 10 click missed: ${JSON.stringify(flatRes)}`)

    await page.evaluate((f) => window.__fisheyeMicro.lock(f, 2), FOCUS)
    await sleep(250)
    const screenshot = captureWarped ? await page.screenshot({ encoding: 'base64' }) : null
    const warpedHits = {}
    for (const row of [9, 14, 19]) {
      const pt = await page.evaluate((r) => window.__fisheyeMicro.rowScreenCenter(r), row)
      const shiftY = Math.round(pt.y - pt.flatY)
      const res = await clickAndRead(pt.x, pt.y)
      assert.equal(res.click?.row, row, `Warped row ${row} missed: ${JSON.stringify(res)}`)
      assert.equal(res.click?.instance, 'source', 'Click did not route to parked source')
      warpedHits[`row${row}`] = { shiftY, heard: res.click?.row }
    }

    const act9 = await page.evaluate(() => window.__fisheyeMicro.actPoint(9))
    const actRes = await clickAndRead(act9.x, act9.y)
    assert.equal(actRes.act?.row, 9, `Warped off-center Done button missed: ${JSON.stringify(actRes)}`)
    assert.equal(actRes.click, null, 'Off-center Done button leaked to row click')

    const filterPt = await page.evaluate(() => window.__fisheyeMicro.filterPoint())
    await page.mouse.click(filterPt.x, filterPt.y)
    await sleep(100)
    await page.keyboard.type('relay')
    await sleep(150)
    const filtered = await page.evaluate(() => window.__fisheyeMicro.filter())
    assert.equal(filtered.value, 'relay', `Filter input did not receive keystrokes: ${JSON.stringify(filtered)}`)
    assert.ok(filtered.matches > 0 && filtered.matches < 28)

    await page.evaluate(() => window.__fisheyeMicro.unlock())
    await page.mouse.move(10, 10)
    await sleep(800)
    const s0 = await page.evaluate(() => window.__fisheyeMicro.stats())
    await sleep(1000)
    const s1 = await page.evaluate(() => window.__fisheyeMicro.stats())
    assert.equal(s1.renderCount, s0.renderCount, `Fisheye rendered while idle: ${s0.renderCount} -> ${s1.renderCount}`)
    assert.equal(s1.paints, s0.paints, `Fisheye painted while idle: ${s0.paints} -> ${s1.paints}`)
    const gpuErrors = await page.evaluate(() => window.__microWebGpuErrors ?? [])
    assert.deepEqual(gpuErrors, [], `WebGPU validation errors in FisheyeSlice: ${gpuErrors.join('; ')}`)
    assert.deepEqual(errors, [], `Page errors in FisheyeSlice: ${errors.join('; ')}`)
    return {
      warpedHits,
      act9Shift: { x: Math.round(act9.x - act9.flatX), y: Math.round(act9.y - act9.flatY) },
      filtered,
      idleDelta: { renders: s1.renderCount - s0.renderCount, paints: s1.paints - s0.paints },
      screenshot,
    }
  } finally {
    await browser?.close()
  }
}

export async function diffPngPair(b64A, b64B) {
  let browser
  try {
    browser = await launchChrome(['--enable-unsafe-swiftshader'])
    const page = await browser.newPage()
    return await page.evaluate(async (aStr, bStr) => {
      const decode = async (b64) => {
        const img = new Image()
        img.src = `data:image/png;base64,${b64}`
        await new Promise((res, rej) => {
          img.onload = res
          img.onerror = rej
        })
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0)
        return { width: img.width, height: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data }
      }
      const a = await decode(aStr)
      const b = await decode(bStr)
      if (a.width !== b.width || a.height !== b.height) {
        return { width: a.width, height: a.height, maxDelta: 255, differingPixelsOver2: a.width * a.height }
      }
      let maxDelta = 0
      let differingPixelsOver2 = 0
      const pixels = a.width * a.height
      for (let i = 0; i < a.data.length; i += 4) {
        const d = Math.max(
          Math.abs(a.data[i] - b.data[i]),
          Math.abs(a.data[i + 1] - b.data[i + 1]),
          Math.abs(a.data[i + 2] - b.data[i + 2]),
        )
        if (d > maxDelta) maxDelta = d
        if (d > 2) differingPixelsOver2++
      }
      return { width: a.width, height: a.height, totalPixels: pixels, maxDelta, differingPixelsOver2 }
    }, b64A, b64B)
  } finally {
    await browser?.close()
  }
}
