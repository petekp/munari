// Wave cadence — recorded pixels must change, not only animation callbacks.
// The clock verifies recording coverage; a hidden-output control isolates the wave.
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import puppeteer from 'puppeteer-core'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'
import { createScreencastRecorder, scoreScreencast } from '../screencastRecording.ts'
import { requirePageFrameCoverage } from '../screencastCoverage.ts'

const output = path.resolve(process.env.WAVE_OUTPUT ?? 'instruments/distortion-wave/out')
await mkdir(output, { recursive: true })
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: [...WEBGPU_CHROME_ARGS, '--enable-features=CanvasDrawElement'] })
const results = []
try {
  for (const hidden of [false, true]) {
    const page = await browser.newPage()
    let recorder
    try {
      await page.setViewport({ width: 895, height: 774, deviceScaleFactor: 2 })
      await page.evaluateOnNewDocument(() => {
        window.wavePipelines = { phase: 'startup', events: [] }
        for (const name of ['createRenderPipeline', 'createRenderPipelineAsync']) {
          const original = GPUDevice.prototype[name]
          GPUDevice.prototype[name] = function (descriptor) {
            window.wavePipelines.events.push({ phase: window.wavePipelines.phase, time: performance.now(), name })
            return original.call(this, descriptor)
          }
        }
        document.addEventListener('click', event => {
          if (event.target.closest('.wave-like')) window.wavePipelines.phase = 'first-click'
        }, true)
      })
      const url = new URL(process.env.WAVE_URL ?? 'http://127.0.0.1:5188/')
      url.search = new URLSearchParams({ scene: 'distortion-wave', framed: '' })
      await page.goto(url.href, { waitUntil: 'networkidle0' })
      await page.waitForSelector('.wave-overlay canvas[data-api-capture-consumer]')
      assert.equal(await page.evaluate(() => window.__munari.engine()), 'html-in-canvas')
      await page.select('select', '3600')
      if (hidden) await page.$eval('.wave-overlay', element => { element.style.visibility = 'hidden' })
      const rect = await page.$eval('.wave-like', element => {
        const r = element.getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height }
      })
      recorder = await createScreencastRecorder(page, { format: 'png', everyNthFrame: 1, maxWidth: 895, maxHeight: 774 })
      await recorder.start()
      await page.click('.wave-like')
      await page.waitForFunction(() => document.querySelector('.wave-like').getAttribute('aria-pressed') === 'true')
      const committed = await page.evaluate(() => performance.timeOrigin + performance.now())
      await new Promise(resolve => setTimeout(resolve, 1800))
      const capture = await recorder.stop({ through: committed + 1700, timeoutMs: 1000 })
      const scored = await scoreScreencast(page, capture, {
        context: { rect, start: committed + 300, end: committed + 1500 },
        createScorer(_reference, { rect, start, end }) {
          let previous = null
          return {
            inspect(image, frame) {
              if (frame.t < start || frame.t > end) return null
              const sx = image.width / 895, sy = image.height / 774
              const width = Math.ceil(rect.w * sx), height = Math.ceil(rect.h * sy)
              const ink = image.ctx.getImageData(Math.floor(rect.x * sx), Math.floor(rect.y * sy), width, height).data
              let changed = 0
              if (previous) for (let i = 0; i < ink.length; i += 4) {
                if (Math.max(Math.abs(ink[i] - previous[i]), Math.abs(ink[i + 1] - previous[i + 1]), Math.abs(ink[i + 2] - previous[i + 2])) > 1) changed++
              }
              previous = ink
              return { changed, width, height, pixels: Array.from(ink) }
            },
            summarize() { return {} },
          }
        },
      })
      requirePageFrameCoverage(scored.rows, committed + 300, committed + 1500)
      const active = scored.rows.filter(row => row.value !== null)
      const changed = active.filter(row => row.value.changed > 0)
      const gaps = changed.slice(1).map((row, index) => row.t - changed[index].t).sort((a, b) => a - b)
      assert(active.length > 1, 'Observe multiple page frames')
      if (hidden) assert.equal(changed.length, 0, 'The hidden wave must have no changing pixels')
      else assert.equal(changed.length, active.length - 1, 'Every successive recorded frame must show changing wave pixels')
      const result = { hidden, coverage: 'complete', frames: active.length, changed: changed.length, changeGapMs: { median: gaps[Math.floor(gaps.length * .5)], p95: gaps[Math.floor(gaps.length * .95)], max: gaps.at(-1) }, pipelines: await page.evaluate(() => window.wavePipelines) }
      await writeFile(path.join(output, hidden ? 'cadence-hidden.json' : 'cadence-visible.json'), JSON.stringify({ ...result, rows: scored.rows }))
      results.push(result)
      console.log(JSON.stringify(result))
    } finally {
      if (recorder) await recorder.dispose()
      await page.close()
    }
  }
} finally { await browser.close() }
await writeFile(path.join(output, 'cadence.json'), JSON.stringify(results, null, 2))
