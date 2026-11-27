// Step 1 substrate, fallback, overlap, DPR 2 snap, glass backdrop, and device.lost checks.

import assert from 'node:assert/strict'
import { launchChrome, sleep } from './sliceChecks.mjs'

async function sampleScreenshotZones(page) {
  const base64 = await page.screenshot({ encoding: 'base64' })
  return page.evaluate(async (b64) => {
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
    const sample = (x, y) => {
      const d = ctx.getImageData(x, y, 1, 1).data
      return { r: d[0], g: d[1], b: d[2], a: d[3] }
    }
    // Zones are at top:20, width:160, height:120; sample corner (away from 'Ag' text center)
    return {
      backdrop: sample(10, 10),
      zoneA: sample(40, 40),
      zoneB: sample(220, 40),
      zoneC: sample(400, 40),
      zoneD: sample(580, 40),
    }
  }, base64)
}

export async function runStep1(baseUrl) {
  let browser
  try {
    browser = await launchChrome(['--enable-unsafe-swiftshader'])
    const page = await browser.newPage()
    await page.setViewport({ width: 900, height: 420, deviceScaleFactor: 1 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`${baseUrl}/probe.html`, { waitUntil: 'load' })
    await page.waitForFunction(() => Boolean(window.__webgpuProbe), { timeout: 20_000 })
    const probe = await page.evaluate(() => window.__webgpuProbe)
    assert.equal(probe.ok, true, `Step 1 probe failed: ${probe.failure ?? JSON.stringify(probe)}`)
    assert.equal(probe.claim1?.ok, true, `Claim 1 failed: ${JSON.stringify(probe.claim1)}`)
    assert.equal(probe.claim3?.ok, true, `Claim 3 failed: ${JSON.stringify(probe.claim3)}`)
    assert.equal(probe.claim5?.ok, true, `Claim 5 failed: ${JSON.stringify(probe.claim5)}`)
    assert.deepEqual(probe.uncapturedErrors, [], `Uncaptured WebGPU errors: ${probe.uncapturedErrors?.join('; ')}`)
    assert.equal(probe.claim2Ready, true, 'Claim 2 canvases did not render')

    const composite = await sampleScreenshotZones(page)
    const diffBvsA = Math.max(
      Math.abs(composite.zoneB.r - composite.zoneA.r),
      Math.abs(composite.zoneB.g - composite.zoneA.g),
      Math.abs(composite.zoneB.b - composite.zoneA.b),
    )
    assert.ok(diffBvsA <= 2, `Zone B diverged from Zone A native HTML by ${diffBvsA}: ${JSON.stringify(composite)}`)
    assert.ok(
      composite.zoneC.r > composite.backdrop.r + 80 && composite.zoneC.g > composite.backdrop.g + 40,
      `Zone C additive glow over transparent pixels did not brighten backdrop: ${JSON.stringify(composite)}`,
    )
    assert.ok(
      Math.abs(composite.zoneD.r - composite.backdrop.r) <= 2 && Math.abs(composite.zoneD.g - composite.backdrop.g) <= 2,
      `Zone D straight-alpha negative control unexpectedly brightened: ${JSON.stringify(composite)}`,
    )
    assert.deepEqual(errors, [], `Page errors in Step 1: ${errors.join('; ')}`)
    return { hardware: probe, composite }
  } finally {
    await browser?.close()
  }
}

export async function runFallbackProbe(baseUrl) {
  let browser
  try {
    browser = await launchChrome(['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    const page = await browser.newPage()
    await page.setViewport({ width: 900, height: 420, deviceScaleFactor: 1 })
    await page.goto(`${baseUrl}/probe.html?fallback=1`, { waitUntil: 'load' })
    await page.waitForFunction(() => Boolean(window.__webgpuProbe), { timeout: 20_000 })
    return await page.evaluate(() => window.__webgpuProbe)
  } finally {
    await browser?.close()
  }
}

export async function runOverlapCheck(baseUrl) {
  let browser
  try {
    browser = await launchChrome(['--enable-unsafe-swiftshader'])
    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 860, deviceScaleFactor: 1 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`${baseUrl}/scenes.html?scene=overlap`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__overlapMicro?.ready === true, { timeout: 20_000 })
    await sleep(200)
    const b64 = await page.screenshot({ encoding: 'base64' })
    const samples = await page.evaluate(async (pngB64) => {
      const img = new Image()
      img.src = `data:image/png;base64,${pngB64}`
      await new Promise((res, rej) => {
        img.onload = res
        img.onerror = rej
      })
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const sample = (x, y) => {
        const d = ctx.getImageData(x, y, 1, 1).data
        return { r: d[0], g: d[1], b: d[2], a: d[3] }
      }
      return {
        backdrop: sample(100, 100),
        cardA: sample(400, 460),
        cardB: sample(780, 380),
        overlap: sample(600, 430),
      }
    }, b64)
    const gpuErrors = await page.evaluate(() => window.__microWebGpuErrors ?? [])
    assert.deepEqual(gpuErrors, [], `WebGPU errors in overlap check: ${gpuErrors.join('; ')}`)
    assert.deepEqual(errors, [], `Page errors in overlap check: ${errors.join('; ')}`)
    assert.ok(Math.abs(samples.backdrop.r - 40) <= 2 && Math.abs(samples.backdrop.g - 101) <= 2 && Math.abs(samples.backdrop.b - 180) <= 2)
    const maxDiff = (x, y) => Math.max(Math.abs(x.r - y.r), Math.abs(x.g - y.g), Math.abs(x.b - y.b))
    assert.ok(maxDiff(samples.cardA, samples.backdrop) >= 20, `Card A invisible: ${JSON.stringify(samples)}`)
    assert.ok(maxDiff(samples.cardB, samples.backdrop) >= 20, `Card B invisible: ${JSON.stringify(samples)}`)
    assert.ok(maxDiff(samples.overlap, samples.cardA) >= 15 && maxDiff(samples.overlap, samples.cardB) >= 15, `Overlap did not composite both cards: ${JSON.stringify(samples)}`)
    return samples
  } finally {
    await browser?.close()
  }
}

export async function runDpr2SnapCheck(baseUrl) {
  let browser
  try {
    browser = await launchChrome(['--enable-unsafe-swiftshader'])
    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 860, deviceScaleFactor: 2 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`${baseUrl}/scenes.html?scene=dpr2`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__overlapMicro?.ready === true, { timeout: 20_000 })
    await sleep(200)
    const b64 = await page.screenshot({ encoding: 'base64' })
    const profile = await page.evaluate(async (pngB64) => {
      const img = new Image()
      img.src = `data:image/png;base64,${pngB64}`
      await new Promise((res, rej) => {
        img.onload = res
        img.onerror = rej
      })
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const measureColumn = (centerCssX, topStartPx, topEndPx) => {
        const devX = Math.round(centerCssX * 2)
        const vals = []
        for (let y = topStartPx; y <= topEndPx; y++) {
          vals.push(ctx.getImageData(devX, y, 1, 1).data[0])
        }
        let maxPeak = 0
        let grayRows = 0
        let maxStep = 0
        for (let i = 0; i < vals.length; i++) {
          if (vals[i] > maxPeak) maxPeak = vals[i]
          if (vals[i] >= 20 && vals[i] <= 235) grayRows++
          if (i > 0) {
            const step = Math.abs(vals[i] - vals[i - 1])
            if (step > maxStep) maxStep = step
          }
        }
        return { devX, maxPeak, grayRows, maxStep, vals }
      }
      return {
        imageWidth: img.width,
        imageHeight: img.height,
        unsnappedHalfPx: measureColumn(600 - 200.25, 792, 808),
        snappedHalfPx: measureColumn(600 + 200.25, 792, 808),
        unsnappedOnePx: measureColumn(600 - 200.25, 852, 868),
        snappedOnePx: measureColumn(600 + 200.25, 852, 868),
      }
    }, b64)
    const gpuErrors = await page.evaluate(() => window.__microWebGpuErrors ?? [])
    assert.deepEqual(gpuErrors, [], `WebGPU errors in DPR 2 check: ${gpuErrors.join('; ')}`)
    assert.deepEqual(errors, [], `Page errors in DPR 2 check: ${errors.join('; ')}`)
    assert.equal(profile.imageWidth, 2400, 'Expected DPR 2 2400px screenshot width')
    assert.ok(
      profile.snappedOnePx.grayRows === 0 &&
        profile.snappedOnePx.maxStep >= 245 &&
        profile.unsnappedOnePx.grayRows >= 2 &&
        profile.unsnappedOnePx.maxStep <= 180,
      `DPR 2 pixelGridSnap did not eliminate fractional-phase smear: ${JSON.stringify(profile)}`,
    )
    return profile
  } finally {
    await browser?.close()
  }
}

export async function runGlassBackdropCheck(baseUrl) {
  let browser
  try {
    browser = await launchChrome(['--enable-unsafe-swiftshader'])
    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 860, deviceScaleFactor: 1 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`${baseUrl}/scenes.html?scene=glass-backdrop`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__overlapMicro?.ready === true, { timeout: 20_000 })
    await sleep(200)
    const b64 = await page.screenshot({ encoding: 'base64' })
    const samples = await page.evaluate(async (pngB64) => {
      const img = new Image()
      img.src = `data:image/png;base64,${pngB64}`
      await new Promise((res, rej) => {
        img.onload = res
        img.onerror = rej
      })
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const sample = (x, y) => {
        const d = ctx.getImageData(x, y, 1, 1).data
        return { r: d[0], g: d[1], b: d[2], a: d[3] }
      }
      return {
        pageBackdrop: sample(900, 100),
        baseOrangeLeft: sample(420, 430),
        refractedRight: sample(640, 430),
      }
    }, b64)
    const gpuErrors = await page.evaluate(() => window.__microWebGpuErrors ?? [])
    assert.deepEqual(gpuErrors, [], `WebGPU errors in GlassBackdropSlice: ${gpuErrors.join('; ')}`)
    assert.deepEqual(errors, [], `Page errors in GlassBackdropSlice: ${errors.join('; ')}`)
    const maxDiff = (x, y) => Math.max(Math.abs(x.r - y.r), Math.abs(x.g - y.g), Math.abs(x.b - y.b))
    assert.ok(maxDiff(samples.baseOrangeLeft, { r: 200, g: 80, b: 40 }) <= 3, `Base orange card mismatch: ${JSON.stringify(samples)}`)
    assert.ok(maxDiff(samples.refractedRight, { r: 200, g: 80, b: 40 }) <= 4, `Backdrop glass decode/refract drifted: ${JSON.stringify(samples)}`)
    return samples
  } finally {
    await browser?.close()
  }
}

export async function runDeviceLostRecoveryCheck(baseUrl) {
  let browser
  try {
    browser = await launchChrome(['--enable-unsafe-swiftshader'])
    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 860, deviceScaleFactor: 1 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`${baseUrl}/scenes.html?scene=flight&material=manifest`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__flightMicro?.ready === true, { timeout: 20_000 })

    await page.click('.flight-input')
    await page.keyboard.press('End')
    await page.keyboard.type(' + kept across loss')
    await page.evaluate(() => window.__flightMicro.lift())
    await page.waitForFunction(() => window.__flightMicro.state().presentation === 'scene', { timeout: 10_000 })
    await sleep(300)

    const destroyed1 = await page.evaluate(() => window.__flightMicro.simulateLoss())
    assert.equal(destroyed1, true, 'First simulateLoss returned false')
    await page.waitForFunction(() => window.__flightMicro.state().rendererLosses === 1, { timeout: 10_000 })
    await page.waitForFunction(() => window.__flightMicro.state().presentation === 'scene', { timeout: 10_000 })
    const afterRecover = await page.evaluate(() => window.__flightMicro.state())
    assert.equal(afterRecover.note, 'initial note + kept across loss', 'Retained note lost across device recovery')
    assert.equal(afterRecover.pageHidden, true, 'Recovered scene did not re-present cleanly')

    const destroyed2 = await page.evaluate(() => window.__flightMicro.simulateLoss())
    assert.equal(destroyed2, true, 'Second simulateLoss returned false')
    await page.waitForFunction(() => window.__flightMicro.state().rendererLosses === 2, { timeout: 10_000 })
    await sleep(600)
    const afterRepeated = await page.evaluate(() => window.__flightMicro.state())
    assert.equal(afterRepeated.presentation, 'page', 'Repeated loss within 10s did not degrade to page')
    assert.equal(afterRepeated.pageHidden, false, 'Page slot stayed hidden after repeated device loss')
    assert.equal(afterRepeated.note, 'initial note + kept across loss', 'Retained note lost on repeated loss')
    assert.deepEqual(errors, [], `Page errors during device.lost recovery: ${errors.join('; ')}`)
    return { afterRecover, afterRepeated }
  } finally {
    await browser?.close()
  }
}
