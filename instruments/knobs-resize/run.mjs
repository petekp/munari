// Knobs responsive-presentation gate.
//
// This runs the real Knobs route. It proves that each captured DOM paint,
// keyed anchor map, uploaded draw, and presented framebuffer name the same
// source generation while the panel crosses both container-query boundaries.
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const labRoot = path.join(repoRoot, 'apps', 'lab')
const outputDir = path.join(here, 'out')
const dump = process.env.DUMP === '1'

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean)

const strict = process.env.STRICT_CAPABILITY === '1'
function skip(reason) {
  const message = `knobs-resize gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message)
  if (strict) process.exitCode = 1
}

const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate))
if (!chromePath) {
  skip('no Chrome executable found (set CHROME_PATH)')
  process.exit()
}

const args = [
  '--enable-features=CanvasDrawElement',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  ...(process.env.CI ? ['--no-sandbox'] : []),
]
const nextFrames = (page, count = 2) =>
  page.evaluate(
    (frames) =>
      new Promise((resolve) => {
        const step = () => (--frames <= 0 ? resolve() : requestAnimationFrame(step))
        requestAnimationFrame(step)
      }),
    count,
  )

async function writeDump(dpr, result) {
  if (!dump || !result.worst) return
  await mkdir(outputDir, { recursive: true })
  const prefix = path.join(outputDir, `dpr-${dpr}`)
  await writeFile(`${prefix}-samples.json`, JSON.stringify(result, null, 2))
  for (const key of ['sourceImage', 'frameImage']) {
    const value = result.worst[key]
    if (!value) continue
    const bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64')
    await writeFile(`${prefix}-${key === 'sourceImage' ? 'source' : 'frame'}.png`, bytes)
  }
}

async function runAtDpr(browser, origin, dpr) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    const text = message.text()
    if (/ResizeObserver loop|WebGL.*(?:error|context lost)/i.test(text)) errors.push(text)
  })
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: dpr })
  await page.goto(`${origin}/?scene=knobs&probe=knobs-resize`, { waitUntil: 'load' })
  await page.waitForFunction(
    () =>
      window.__knobsResizeProbe?.snapshot().presented &&
      document.querySelector('[data-knobs-resize-marker="source"]'),
    { timeout: 20_000 },
  )

  await page.evaluate(() => {
    const panel = document.querySelector('.knb-panel')
    const host = panel.closest('.ui-root')
    const source = host.closest('canvas')
    const frame =
      document.querySelector('canvas.knb-overlay') ??
      document.querySelector('.knb-overlay canvas')
    if (!panel || !host || !source || !frame) {
      throw new Error(
        `Knobs probe boxes are incomplete: panel=${Boolean(panel)} host=${Boolean(host)} ` +
          `source=${Boolean(source)} frame=${Boolean(frame)}`,
      )
    }

    const scratch = document.createElement('canvas')
    const scratchContext = scratch.getContext('2d', { willReadFrequently: true })
    const tiny = document.createElement('canvas')
    tiny.width = 8
    tiny.height = 8
    const tinyContext = tiny.getContext('2d', { willReadFrequently: true })
    const state = { samples: [], phase: 'idle', raf: 0, worst: null }

    const marker = (context, width, height, expectedX, expectedY, radius) => {
      const left = Math.max(0, Math.floor(expectedX - radius))
      const top = Math.max(0, Math.floor(expectedY - radius))
      const right = Math.min(width, Math.ceil(expectedX + radius))
      const bottom = Math.min(height, Math.ceil(expectedY + radius))
      if (right <= left || bottom <= top) return null
      const image = context.getImageData(left, top, right - left, bottom - top)
      let x = 0
      let y = 0
      let count = 0
      for (let py = 0; py < image.height; py++) {
        for (let px = 0; px < image.width; px++) {
          const index = (py * image.width + px) * 4
          if (
            image.data[index] > 240 &&
            image.data[index + 1] < 24 &&
            image.data[index + 2] > 240 &&
            image.data[index + 3] > 240
          ) {
            // Compare texel addresses. `u * storeWidth` names an address,
            // not the center-sampling coordinate half a texel beyond it.
            x += left + px
            y += top + py
            count++
          }
        }
      }
      return count ? { x: x / count, y: y / count, count } : null
    }

    const nonblank = (canvas) => {
      tinyContext.clearRect(0, 0, 8, 8)
      tinyContext.drawImage(canvas, 0, 0, 8, 8)
      const pixels = tinyContext.getImageData(0, 0, 8, 8).data
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] > 8 && pixels[index - 3] + pixels[index - 2] + pixels[index - 1] > 12)
          return true
      }
      return false
    }

    const tick = () => {
      const probe = window.__knobsResizeProbe.snapshot()
      const panelBox = panel.getBoundingClientRect()
      const hostBox = host.getBoundingClientRect()
      const sourceBox = source.getBoundingClientRect()
      const frameBox = frame.getBoundingClientRect()
      const anchor = probe.anchors?.anchors['probe:hue']
      const hardwareAnchor = probe.anchors?.anchors['knob:hue']
      const projected = probe.projectedHue
      let sourceMarker = null
      let frameMarker = null
      let sourceError = null
      let sourceDelta = null
      let anchorError = null
      let frameError = null

      if (anchor) {
        const expectedU = (anchor.uMin + anchor.uMax) / 2
        const expectedV = (anchor.vMin + anchor.vMax) / 2
        const expectedX = expectedU * source.width
        const expectedY = (1 - expectedV) * source.height
        const context = source.getContext('2d', { willReadFrequently: true })
        sourceMarker = marker(context, source.width, source.height, expectedX, expectedY, 12 * devicePixelRatio)
        if (sourceMarker) {
          sourceDelta = {
            x: sourceMarker.x - expectedX,
            y: sourceMarker.y - expectedY,
          }
          sourceError = Math.max(
            Math.abs(sourceMarker.x / source.width - expectedU) * source.width,
            Math.abs(1 - sourceMarker.y / source.height - expectedV) * source.height,
          )
        }
      }
      if (anchor && hardwareAnchor) {
        anchorError = Math.max(
          Math.abs(
            (anchor.uMin + anchor.uMax - hardwareAnchor.uMin - hardwareAnchor.uMax) *
              source.width /
              2,
          ),
          Math.abs(
            (anchor.vMin + anchor.vMax - hardwareAnchor.vMin - hardwareAnchor.vMax) *
              source.height /
              2,
          ),
        )
      }

      if (projected) {
        if (scratch.width !== frame.width) scratch.width = frame.width
        if (scratch.height !== frame.height) scratch.height = frame.height
        scratchContext.clearRect(0, 0, scratch.width, scratch.height)
        scratchContext.drawImage(frame, 0, 0)
        const scaleX = frame.width / frameBox.width
        const scaleY = frame.height / frameBox.height
        const expectedX = (projected.x - frameBox.left) * scaleX
        const expectedY = (projected.y - frameBox.top) * scaleY
        frameMarker = marker(
          scratchContext,
          scratch.width,
          scratch.height,
          expectedX,
          expectedY,
          10 * devicePixelRatio,
        )
        if (frameMarker) {
          frameError = Math.max(
            Math.abs(frameMarker.x / scaleX + frameBox.left - projected.x),
            Math.abs(frameMarker.y / scaleY + frameBox.top - projected.y),
          )
        }
      }

      const sample = {
        phase: state.phase,
        pw: panelBox.width,
        ph: panelBox.height,
        hw: hostBox.width,
        hh: hostBox.height,
        cw: sourceBox.width,
        ch: sourceBox.height,
        sw: source.width,
        sh: source.height,
        paint: probe.paint?.frame.generation ?? null,
        draw: probe.draw?.frame.generation ?? null,
        presented: probe.presented?.frame.generation ?? null,
        anchor: probe.anchors?.paint.frame.generation ?? null,
        sourceError,
        sourceDelta,
        anchorError,
        frameError,
        sourcePixels: sourceMarker?.count ?? 0,
        framePixels: frameMarker?.count ?? 0,
        sourceBlank: !nonblank(source),
        frameBlank: !nonblank(scratch),
      }
      state.samples.push(sample)
      const score = Math.max(sourceError ?? 99, frameError ?? 99)
      if (!state.worst || score > state.worst.score) {
        state.worst = {
          score,
          sample,
          sourceImage: source.toDataURL('image/png'),
          frameImage: scratch.toDataURL('image/png'),
        }
      }
      state.raf = requestAnimationFrame(tick)
    }
    window.__kr = state
    state.raf = requestAnimationFrame(tick)
  })

  const gripAt = () =>
    page.evaluate(() => {
      const grip = document.querySelector('.knb-resize-grip').getBoundingClientRect()
      const panel = document.querySelector('.knb-panel').getBoundingClientRect()
      return {
        x: window.innerWidth - 26 - panel.width + (grip.left + grip.width / 2 - panel.left),
        y: window.innerHeight / 2 - panel.height / 2 + (grip.top + grip.height / 2 - panel.top),
      }
    })

  const drag = async (phase, delta) => {
    const start = await gripAt()
    await page.evaluate((value) => { window.__kr.phase = value }, phase)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    for (let step = 1; step <= 44; step++) {
      await page.mouse.move(start.x + (delta * step) / 44, start.y)
      await nextFrames(page)
    }
    await page.mouse.up()
    await nextFrames(page, 8)
  }

  await drag('setup', -500)
  await page.evaluate(() => { window.__kr.samples.length = 0 })
  await drag('grow', 500)
  await drag('shrink', -500)
  await page.evaluate(() => { window.__kr.phase = 'quiet' })
  await nextFrames(page, 10)

  const result = await page.evaluate(() => {
    cancelAnimationFrame(window.__kr.raf)
    return { samples: window.__kr.samples, worst: window.__kr.worst }
  })
  await writeDump(dpr, result)
  await page.close()
  if (errors.length) throw new Error(`DPR ${dpr} page errors:\n${errors.join('\n')}`)

  const moving = result.samples.filter((sample, index, all) => {
    if (sample.phase !== 'grow' && sample.phase !== 'shrink') return false
    const previous = all[index - 1]
    return previous && (sample.pw !== previous.pw || sample.ph !== previous.ph)
  })
  if (moving.length < 30) throw new Error(`DPR ${dpr}: only ${moving.length} moving render samples`)

  const phaseHeights = (phase) => new Set(moving.filter((sample) => sample.phase === phase).map((sample) => Math.round(sample.ph)))
  for (const phase of ['grow', 'shrink']) {
    const heights = phaseHeights(phase)
    if (![463, 721, 835].every((height) => heights.has(height))) {
      throw new Error(`DPR ${dpr}: ${phase} missed an arrangement (${[...heights].join(', ')})`)
    }
  }

  const failures = []
  for (const sample of moving) {
    if (
      Math.abs(sample.pw - sample.hw) > 1 ||
      Math.abs(sample.ph - sample.hh) > 1 ||
      Math.abs(sample.hw - sample.cw) > 1 ||
      Math.abs(sample.hh - sample.ch) > 1
    ) failures.push(`box ${sample.pw}x${sample.ph}/${sample.hw}x${sample.hh}/${sample.cw}x${sample.ch}`)
    const densityX = sample.sw / (sample.cw * dpr)
    const densityY = sample.sh / (sample.ch * dpr)
    if (densityX < 1 / 1.4 || densityX > 1.4 || densityY < 1 / 1.4 || densityY > 1.4)
      failures.push(`density ${densityX.toFixed(2)}x${densityY.toFixed(2)}`)
    if (
      sample.paint == null ||
      sample.draw == null ||
      sample.presented == null ||
      sample.anchor == null ||
      sample.paint !== sample.draw ||
      sample.draw !== sample.presented ||
      sample.presented !== sample.anchor
    ) failures.push(`generation p${sample.paint}/d${sample.draw}/r${sample.presented}/a${sample.anchor}`)
    if (sample.sourceError == null || sample.sourceError > 1)
      failures.push(`source marker ${sample.sourceError}`)
    if (sample.anchorError == null || sample.anchorError > 1)
      failures.push(`anchor marker ${sample.anchorError}`)
    if (sample.frameError == null || sample.frameError > 1)
      failures.push(`frame marker ${sample.frameError}`)
    if (sample.sourceBlank || sample.frameBlank) failures.push('blank frame')
  }

  const quiet = result.samples.filter((sample) => sample.phase === 'quiet').slice(-8)
  if (quiet.length < 8) failures.push(`only ${quiet.length} quiet frames`)
  for (const sample of quiet) {
    if (sample.sw !== Math.round(sample.cw * dpr) || sample.sh !== Math.round(sample.ch * dpr))
      failures.push(`unsettled store ${sample.sw}x${sample.sh} for ${sample.cw}x${sample.ch}@${dpr}`)
  }
  if (failures.length) {
    throw new Error(
      `DPR ${dpr}: ${failures.length} responsive presentation failures\n` +
        failures.slice(0, 12).map((failure) => `  ${failure}`).join('\n'),
    )
  }

  console.log(
    `knobs-resize DPR ${dpr}: ${moving.length} moving frames; ` +
      'three arrangements both ways; boxes, density, generations, and markers agree',
  )
}

let server
let browser
const deadline = setTimeout(() => {
  console.error('knobs-resize gate: hard 180s deadline hit')
  process.exit(1)
}, 180_000)

try {
  browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args })
  const capabilityPage = await browser.newPage()
  const capable = await capabilityPage.evaluate(
    () => 'drawElementImage' in document.createElement('canvas').getContext('2d'),
  )
  await capabilityPage.close()
  if (!capable) {
    await browser.close()
    browser = null
    skip(`Chrome at ${chromePath} has no drawElementImage even with the feature flag`)
  } else {
    server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
    await server.listen()
    const port = server.config.server.port ?? server.httpServer.address().port
    const origin = `http://localhost:${port}`
    const dprs = process.env.DPR ? [Number(process.env.DPR)] : [1, 2]
    for (const dpr of dprs) await runAtDpr(browser, origin, dpr)
    console.log('\nknobs-resize gate PASSED')
  }
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
