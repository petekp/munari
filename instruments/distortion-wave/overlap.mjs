// Wave overlap — sustained input must not replace a control background with opaque black.
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import puppeteer from 'puppeteer-core'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'
import { createScreencastRecorder, scoreScreencast } from '../screencastRecording.ts'
import { requirePageFrameCoverage } from '../screencastCoverage.ts'

const output = path.resolve(process.env.WAVE_OUTPUT ?? 'instruments/distortion-wave/out')
await mkdir(output, { recursive: true })
const mode = process.argv[2] ?? 'native'
const clicks = Number(process.env.WAVE_CLICKS ?? 12)
assert(Number.isInteger(clicks) && clicks > 0 && clicks <= 64)
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: [...WEBGPU_CHROME_ARGS, ...(mode === 'native' ? ['--enable-features=CanvasDrawElement'] : [])] })
const page = await browser.newPage()
const errors = []
page.on('pageerror', error => errors.push(String(error)))
page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404 (Not Found)')) errors.push(message.text()) })
let recorder
try {
  await page.setViewport({ width: 895, height: 774, deviceScaleFactor: 2 })
  const url = new URL(process.env.WAVE_URL ?? 'http://127.0.0.1:5188/')
  url.search = new URLSearchParams({ scene: 'distortion-wave', framed: '' })
  if (mode === 'snapdom') url.searchParams.set('capture', 'snapdom')
  await page.goto(url.href, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.wave-overlay canvas[data-api-capture-consumer]')
  assert.equal(await page.evaluate(() => window.__munari.engine()), mode === 'native' ? 'html-in-canvas' : 'snapdom')
  await page.$eval('.wave-color-patch', element => element.scrollIntoView({ block: 'center' }))
  await page.hover('[aria-label="Violet"]')
  const rect = await page.$eval('.wave-color-patch', element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })
  await page.evaluate(() => {
    window.waveColors = []
    const name = document.querySelector('.wave-color-options > span')
    new MutationObserver(() => window.waveColors.push(name.textContent)).observe(name, {childList:true, subtree:true, characterData:true})
  })
  recorder = await createScreencastRecorder(page, { format: 'png', everyNthFrame: 1, maxWidth: 895, maxHeight: 774 })
  await recorder.start()
  const started = await page.evaluate(() => performance.timeOrigin + performance.now())
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  await wait(100)
  const colors = ['Coral', 'Sky', 'Leaf', 'Violet']
  for (let i = 0; i < clicks; i++) { await page.click(`[aria-label="${colors[i % colors.length]}"]`); await wait(40) }
  await page.waitForFunction(expected => window.waveColors.length === expected, {}, clicks)
  const changes = await page.evaluate(() => window.waveColors)
  assert.deepEqual(changes, Array.from({ length: clicks }, (_, index) => colors[index % colors.length]))
  await wait(400)
  const ended = await page.evaluate(() => performance.timeOrigin + performance.now())
  const capture = await recorder.stop({ through: ended, timeoutMs: 1000 })
  const scored = await scoreScreencast(page, capture, {
    context: { rect },
    createScorer(_reference, { rect }) {
      let worst = null
      return {
        inspect(image, frame) {
          const sx = image.width / 895, sy = image.height / 774
          const width = Math.floor(rect.w * sx), height = Math.floor(rect.h * sy)
          const pixels = image.ctx.getImageData(Math.round(rect.x * sx), Math.round(rect.y * sy), width, height).data
          let black = 0
          for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) < 5) black++
          const value = { black, total: width * height, fraction: black / (width * height) }
          if (!worst || value.fraction > worst.fraction) worst = { ...value, t: frame.t, image: image.ctx.canvas.toDataURL('image/png') }
          return value
        },
        summarize() { return { worst } },
      }
    },
  })
  let coverage = 'complete'
  try { requirePageFrameCoverage(scored.rows, started + 100, ended - 100) } catch (error) { coverage = error.message }
  const baseline = scored.rows.filter(row => row.t >= started && row.t < started + 100)
  assert(baseline.length > 0, 'Observe the native background before input')
  assert(baseline.every(row => row.value.fraction < 0.01), 'The native background must be outside the black-pixel threshold')
  const worst = scored.summary.worst
  await writeFile(path.join(output, `${mode}-worst.png`), Buffer.from(worst.image.split(',')[1], 'base64'))
  const result = { mode, clicks, changes, started, ended, rect, errors, coverage, worst: { ...worst, image: undefined }, rows: scored.rows }
  await writeFile(path.join(output, `${mode}-overlap.json`), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ ...result, rows: scored.rows.length }))
  assert(worst.fraction < 0.01, 'Repeated capture must preserve the background under every wave')
  assert.equal(coverage, 'complete')
  assert.deepEqual(errors, [])
} finally {
  if (recorder) await recorder.dispose()
  await browser.close()
}
