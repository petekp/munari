// Quality probe — what each cost a quality level could trade does to frame
// time, first-frame time, GPU memory and pixels, on the lab's finish pages.
//
// Modes (MODE=…):
// - frame: the glass bench page (?compare=glass&finish=<preset>&count=12),
//   12 cards of one preset over a full-screen backdrop Surface, 1440 × 900
//   CSS px at DPR 2. Each sample is the median of 6 batches of 30 back-to-back
//   frames, each batch awaited to the GPU queue (the glass-finish branch's bench method),
//   so it counts CPU encoding and GPU work together. Rounds interleave the
//   configurations, and each load is a new browser context.
// - first: the material-finishes page (three cards, one preset), each sample
//   in a new browser with a new profile, so Dawn's shader caches start
//   empty. It records navigation to the first frame on which every card
//   presents in the scene, the environment bake's marks, and the longest
//   gap between animation frames before that.
// - pixels-finishes / pixels-glass: a screenshot at DPR 2 of each
//   configuration against the baseline, per card: the largest and mean
//   absolute channel difference (0–255) and the share of device pixels whose
//   largest channel difference is over 2. "again" repeats the baseline in a
//   new load, so its row is the run-to-run floor.
//
// GPU memory is the bytes of live textures created through
// GPUDevice.createTexture, counted from each descriptor (size, format, mip
// levels, sample count). The canvas's own swap-chain textures are not
// created that way and are not counted.
//
// The settings reach the library through hooks.mjs, which must be applied
// first. Limits: one machine and GPU; a lab dev server; the cards' own
// rectangles only; differences are against the baseline render, not a
// ground truth.
//
//   LAB_URL=http://127.0.0.1:5183 OUT=<dir> MODE=frame node instruments/quality/run.mjs

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'
import { decodePng, encodePng } from './png.mjs'

const MODE = process.env.MODE
const LAB_URL = process.env.LAB_URL ?? 'http://127.0.0.1:5183'
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = process.env.OUT
const ROUNDS = Number(process.env.ROUNDS ?? 3)
if (!OUT) throw new Error('Set OUT to an output directory')
mkdirSync(OUT, { recursive: true })
const only = (name, list) => (process.env[name] ? list.filter((item) => process.env[name].split(',').includes(item.id ?? item)) : list)

const ARGS = [...WEBGPU_CHROME_ARGS, '--enable-features=CanvasDrawElement', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding']
const SCALE = Number(process.env.SCALE ?? 2)
const TILT = process.env.TILT === 'pointer' ? 'pointer' : 'none'
const TILT_POINT = { x: 1300, y: 120 }
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: SCALE }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

// ── configurations ─────────────────────────────────────────────────────

const PLAIN = { coat: null, sheen: null, anisotropy: null, film: null, scatter: null, detail: null, crackle: null }
const CONFIGS = [
  { id: 'base', quality: {} },
  { id: 'again', quality: {}, pixelsOnly: true },
  { id: 'dpr1.5', quality: { dpr: 1.5 } },
  { id: 'dpr1', quality: { dpr: 1 } },
  { id: 'dpr3', quality: { dpr: 3 }, frameOnly: true },
  { id: 'msaa4', quality: { msaa: true } },
  { id: 'pmrem128', quality: { pmremSize: 128 } },
  { id: 'pmrem64', quality: { pmremSize: 64 } },
  { id: 'res1', quality: { resolution: 1 } },
  { id: 'taps4', quality: { taps: 4 }, glassOnly: true },
  { id: 'onetap', quality: { oneTapBlurPx: 1e9 }, glassOnly: true },
  { id: 'nodetail', quality: { finish: { detail: null, crackle: null } }, opaqueOnly: true },
  { id: 'plain', quality: { finish: PLAIN }, opaqueOnly: true },
]
const FINISH_PRESETS = [
  'lacquer-crimson', 'polymer-charcoal', 'aluminum-blue', 'velvet-midnight', 'ceramic-celadon',
  'foil-holographic', 'foil-oil-slick', 'foil-crumpled', 'paper-office', 'paper-kraft',
  'paper-cold-press', 'rubber-black', 'rubber-grip', 'rubber-silicone', 'wax-candle',
  'wax-beeswax', 'wax-silicone',
]
const GLASS_PRESETS = ['glass-clear', 'glass-cobalt', 'glass-frosted', 'glass-crystal']
const isGlass = (preset) => preset.startsWith('glass-')
const applies = (config, preset) => (!config.glassOnly || isGlass(preset)) && (!config.opaqueOnly || !isGlass(preset))

// ── page instrumentation ───────────────────────────────────────────────

function pageInit(quality) {
  window.__quality = quality
  const BYTES = { r8unorm: 1, rg8unorm: 2, rgba8unorm: 4, 'rgba8unorm-srgb': 4, bgra8unorm: 4, 'bgra8unorm-srgb': 4, rgba16float: 8, rg16float: 4, r16float: 2, rgba32float: 16, rg32float: 8, r32float: 4, depth16unorm: 2, depth24plus: 4, 'depth24plus-stencil8': 4, depth32float: 4, 'depth32float-stencil8': 5, rgb10a2unorm: 4 }
  const live = new Map()
  window.__gpuMemory = () => {
    let bytes = 0
    const byFormat = {}
    for (const { bytes: size, format } of live.values()) {
      bytes += size
      byFormat[format] = (byFormat[format] ?? 0) + size
    }
    return { bytes, textures: live.size, byFormat }
  }
  if ('GPUDevice' in globalThis) {
    const create = GPUDevice.prototype.createTexture
    GPUDevice.prototype.createTexture = function (descriptor) {
      const texture = create.call(this, descriptor)
      const size = descriptor.size
      const [w, h, d] = Array.isArray(size) ? [size[0], size[1] ?? 1, size[2] ?? 1] : [size.width, size.height ?? 1, size.depthOrArrayLayers ?? 1]
      let texels = 0
      for (let level = 0; level < (descriptor.mipLevelCount ?? 1); level++) texels += Math.max(1, w >> level) * Math.max(1, h >> level) * d
      const samples = descriptor.sampleCount ?? 1
      live.set(texture, { bytes: texels * (BYTES[descriptor.format] ?? 4) * samples, format: descriptor.format + (samples > 1 ? ' x' + samples : '') })
      const destroy = texture.destroy.bind(texture)
      texture.destroy = () => {
        live.delete(texture)
        destroy()
      }
      return texture
    }
  }
  // The first frame on which every material-finishes card's page copy is
  // hidden, which the library does when the scene presents it; and the
  // longest gap between animation frames until then.
  window.__presented = null
  window.__longestGap = 0
  let last = null
  const watch = (now) => {
    if (last !== null) window.__longestGap = Math.max(window.__longestGap, now - last)
    last = now
    const copies = [...document.querySelectorAll('.mf-cards .mf-card')].filter((card) => !card.closest('[data-munari-source-host]'))
    if (copies.length > 0 && copies.every((card) => getComputedStyle(card).visibility === 'hidden')) {
      window.__presented = performance.now()
      return
    }
    requestAnimationFrame(watch)
  }
  requestAnimationFrame(watch)
}

async function launch() {
  return puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: null, protocolTimeout: 180_000, args: ARGS })
}

async function openPage(context, url, quality) {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.setViewport(VIEWPORT)
  await page.evaluateOnNewDocument(pageInit, quality)
  await page.goto(url, { waitUntil: 'load' })
  return { page, errors }
}

const finishUrl = (preset, light = 'point') => LAB_URL + '/?scene=material-finishes&bare&finish=' + preset + '&text=unlit&light=' + light + '&tilt=' + TILT
const benchUrl = (preset, count) => LAB_URL + '/?scene=material-finishes&compare=glass&bare&finish=' + preset + '&count=' + count
const glassUrl = () => LAB_URL + '/?scene=material-finishes&compare=glass&bare'

async function engineOf(page) {
  return page.evaluate(() => window.__munari?.engine?.() ?? null)
}

// ── frame ──────────────────────────────────────────────────────────────

async function frameMode() {
  const presets = only('PRESETS', process.env.PRESETS ? [...FINISH_PRESETS, ...GLASS_PRESETS] : ['polymer-charcoal', 'lacquer-crimson', 'velvet-midnight', 'foil-holographic', 'wax-beeswax', 'paper-kraft', 'glass-clear', 'glass-frosted', 'glass-crystal'])
  const configs = only('CONFIGS', CONFIGS.filter((config) => !config.pixelsOnly && config.id !== 'res1'))
  const count = Number(process.env.COUNT ?? 12)
  const browser = await launch()
  const rows = []
  try {
    for (let round = 0; round < ROUNDS; round++) {
      for (const config of configs) {
        for (const preset of presets) {
          if (!applies(config, preset)) continue
          const context = await browser.createBrowserContext()
          try {
            const { page, errors } = await openPage(context, benchUrl(preset, count), config.quality)
            await page.waitForFunction((n) => (window.__glassPresented?.length ?? 0) >= n && '__glassBench' in window, { timeout: 60_000 }, count)
            await sleep(1500)
            const batches = await page.evaluate(() => window.__glassBench(30, 6))
            const memory = await page.evaluate(() => window.__gpuMemory())
            const canvas = await page.evaluate(() => { const c = document.querySelector('canvas'); return { width: c.width, height: c.height } })
            const row = { round, config: config.id, preset, ms: median(batches), batches, memory, canvas, engine: await engineOf(page), errors }
            rows.push(row)
            console.log(round + ' ' + config.id + ' ' + preset + ' ' + row.ms.toFixed(3) + ' ms  ' + (memory.bytes / 1e6).toFixed(1) + ' MB  ' + canvas.width + 'x' + canvas.height + (errors.length ? '  errors=' + errors.length : ''))
          } catch (error) {
            rows.push({ round, config: config.id, preset, failed: String(error) })
            console.log(round + ' ' + config.id + ' ' + preset + ' FAILED ' + error)
          } finally {
            await context.close()
          }
        }
      }
    }
    return { chrome: await browser.version(), count, rows }
  } finally {
    await browser.close()
  }
}

// ── first frame ────────────────────────────────────────────────────────

async function firstMode() {
  const configs = only('CONFIGS', [
    ...CONFIGS.filter((config) => ['base', 'dpr1', 'msaa4', 'pmrem128', 'pmrem64', 'res1'].includes(config.id)),
    { id: 'softbox', quality: {}, light: 'softbox' },
  ])
  const preset = process.env.PRESET ?? 'lacquer-crimson'
  const samples = Number(process.env.SAMPLES ?? 5)
  const rows = []
  let chrome = null
  for (let sample = 0; sample < samples; sample++) {
    for (const config of configs) {
      const browser = await launch()
      chrome ??= await browser.version()
      try {
        const { page, errors } = await openPage(browser.defaultBrowserContext(), finishUrl(preset, config.light ?? 'point'), config.quality)
        await page.waitForFunction(() => window.__presented !== null, { timeout: 60_000 })
        await sleep(2000)
        const result = await page.evaluate(() => ({
          presented: window.__presented,
          longestGap: window.__longestGap,
          marks: performance.getEntriesByType('mark').filter((mark) => mark.name.startsWith('munari:bake:')).map((mark) => [mark.name, mark.startTime]),
          memory: window.__gpuMemory(),
          renderer: window.__qualityRenderer?.() ?? null,
        }))
        rows.push({ sample, config: config.id, preset, ...result, engine: await engineOf(page), errors })
        console.log(sample + ' ' + config.id + ' presented=' + result.presented.toFixed(0) + ' gap=' + result.longestGap.toFixed(0) + ' mem=' + (result.memory.bytes / 1e6).toFixed(1) + 'MB ' + JSON.stringify(result.marks.map(([n, t]) => n.split(':').slice(2).join(':') + '=' + t.toFixed(0))))
      } catch (error) {
        rows.push({ sample, config: config.id, preset, failed: String(error) })
        console.log(sample + ' ' + config.id + ' FAILED ' + error)
      } finally {
        await browser.close()
      }
    }
  }
  return { chrome, preset, rows }
}

// ── pixels ─────────────────────────────────────────────────────────────

async function stableShot(page) {
  let last = null
  let repeats = 0
  for (let attempt = 0; attempt < 40; attempt++) {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await sleep(200)
    const shot = Buffer.from(await page.screenshot({ type: 'png' }))
    if (last && shot.equals(last)) {
      repeats += 1
      if (repeats >= 2) return shot
    } else repeats = 0
    last = shot
  }
  throw new Error('the page never held still')
}

function compare(a, b, rects) {
  return rects.map(({ x, y, width, height }) => {
    let max = 0
    let sum = 0
    let over = 0
    let pixels = 0
    for (let row = y; row < y + height; row++) {
      for (let column = x; column < x + width; column++) {
        const index = (row * a.width + column) * 4
        const dr = Math.abs(a.data[index] - b.data[index])
        const dg = Math.abs(a.data[index + 1] - b.data[index + 1])
        const db = Math.abs(a.data[index + 2] - b.data[index + 2])
        const largest = Math.max(dr, dg, db)
        max = Math.max(max, largest)
        sum += dr + dg + db
        if (largest > 2) over += 1
        pixels += 1
      }
    }
    return { max, mean: sum / (3 * pixels), over2: over / pixels }
  })
}

function crop(image, { x, y, width, height }) {
  const data = new Uint8Array(width * height * 4)
  for (let row = 0; row < height; row++) data.set(image.data.subarray(((y + row) * image.width + x) * 4, ((y + row) * image.width + x + width) * 4), row * width * 4)
  return { width, height, data }
}

async function cardRects(page, selector) {
  return page.evaluate((s, scale) => [...document.querySelectorAll(s)]
    .filter((card) => !card.closest('[data-munari-source-host]'))
    .map((card) => {
      const box = card.getBoundingClientRect()
      return { x: Math.round(box.x * scale), y: Math.round(box.y * scale), width: Math.round(box.width * scale), height: Math.round(box.height * scale) }
    }), selector, SCALE)
}

async function pixelsMode(glass) {
  const presets = glass ? ['compare'] : only('PRESETS', FINISH_PRESETS)
  const pool = process.env.CONFIGS ? CONFIGS : CONFIGS.filter((config) => !config.frameOnly)
  const configs = only('CONFIGS', pool.filter((config) => (glass ? !config.opaqueOnly : !config.glassOnly && config.id !== 'nodetail' && config.id !== 'plain')))
  const selector = glass ? '[data-glass-card]' : '.mf-cards .mf-card'
  const browser = await launch()
  const results = []
  const worst = new Map()
  try {
    for (const preset of presets) {
      let baseline = null
      for (const config of configs) {
        const context = await browser.createBrowserContext()
        try {
          const { page, errors } = await openPage(context, glass ? glassUrl() : finishUrl(preset), config.quality)
          if (glass) await page.waitForFunction(() => (window.__glassPresented?.length ?? 0) >= 8, { timeout: 60_000 })
          else await page.waitForFunction(() => window.__presented !== null, { timeout: 60_000 })
          await page.evaluate(() => document.fonts.ready)
          if (TILT === 'pointer') await page.mouse.move(TILT_POINT.x, TILT_POINT.y, { steps: 8 })
          await sleep(1500)
          const image = decodePng(await stableShot(page))
          const rects = await cardRects(page, selector)
          if (config.id === 'base') {
            baseline = { image, rects }
            results.push({ preset, config: config.id, rects, engine: await engineOf(page), errors })
            console.log(preset + ' base cards=' + rects.length)
            continue
          }
          const cards = compare(baseline.image, image, baseline.rects)
          results.push({ preset, config: config.id, cards, engine: await engineOf(page), errors })
          const score = Math.max(...cards.map((card) => card.over2)) + Math.max(...cards.map((card) => card.mean)) / 1000
          const held = worst.get(config.id)
          if (!held || score > held.score) worst.set(config.id, { score, preset, baseline: baseline.image, image, rects: baseline.rects })
          console.log(preset + ' ' + config.id + ' max=' + Math.max(...cards.map((c) => c.max)) + ' mean=' + Math.max(...cards.map((c) => c.mean)).toFixed(3) + ' over2=' + (100 * Math.max(...cards.map((c) => c.over2))).toFixed(2) + '%' + (errors.length ? ' errors=' + errors.length : ''))
        } catch (error) {
          results.push({ preset, config: config.id, failed: String(error) })
          console.log(preset + ' ' + config.id + ' FAILED ' + error)
        } finally {
          await context.close()
        }
      }
    }
    for (const [config, held] of worst) {
      const left = Math.max(0, Math.min(...held.rects.map((r) => r.x)) - 20)
      const top = Math.max(0, Math.min(...held.rects.map((r) => r.y)) - 20)
      const right = Math.min(held.image.width, Math.max(...held.rects.map((r) => r.x + r.width)) + 20)
      const bottom = Math.min(held.image.height, Math.max(...held.rects.map((r) => r.y + r.height)) + 20)
      const union = { x: left, y: top, width: right - left, height: bottom - top }
      writeFileSync(join(OUT, 'worst-' + config + '-' + held.preset + '-base.png'), encodePng(crop(held.baseline, union)))
      writeFileSync(join(OUT, 'worst-' + config + '-' + held.preset + '.png'), encodePng(crop(held.image, union)))
    }
    return { chrome: await browser.version(), results }
  } finally {
    await browser.close()
  }
}

const deadline = setTimeout(() => {
  console.error('quality: hard 90 min deadline hit')
  process.exit(1)
}, 90 * 60_000)
let output
if (MODE === 'frame') output = await frameMode()
else if (MODE === 'first') output = await firstMode()
else if (MODE === 'pixels-finishes') output = await pixelsMode(false)
else if (MODE === 'pixels-glass') output = await pixelsMode(true)
else throw new Error('MODE must be frame, first, pixels-finishes or pixels-glass')
clearTimeout(deadline)
writeFileSync(join(OUT, MODE + '.json'), JSON.stringify(output, null, 2))
const failed = (output.rows ?? output.results).filter((row) => row.failed)
console.log('quality: ' + MODE + ' done, ' + failed.length + ' failed')
process.exit(failed.length ? 1 : 0)
