// Softbox pixel comparison — each softbox source against three's own tables,
// on every material-finishes preset, with the key in three places.
//
// For each preset and source it loads the lab's material-finishes scene
// (?bare, light=softbox, softbox=<source>) at 1440 × 900 CSS px, DPR 2, moves
// the key through three viewport positions, waits for three identical
// screenshots in a row, and compares each card's pixels with the same
// capture under softbox=three. "three-again" repeats the baseline in a new
// page load, so its numbers are the run-to-run floor; "point" is the point key,
// the difference a softbox makes at all. A card's numbers are the largest and
// the mean absolute channel difference (0–255, RGB) and the share of its
// device pixels whose largest channel difference is over 2.
//
// Limits: one machine, one GPU and one Chrome; the cards' own rectangles
// only; a source whose tables fail to load would draw the point key, so the
// table sources must show their decode mark before any capture.
//
// Run on m2 against a lab dev server:
//   LAB_URL=http://127.0.0.1:5185 OUT=<dir> node instruments/softbox-size/pixels.mjs

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'
import { decodePng, encodePng } from './png.mjs'

const LAB_URL = process.env.LAB_URL ?? 'http://127.0.0.1:5185'
const OUT = process.env.OUT
if (!OUT) throw new Error('Set OUT to an output directory')
mkdirSync(OUT, { recursive: true })

const PRESETS = (process.env.PRESETS?.split(',') ?? [
  'lacquer-crimson', 'polymer-charcoal', 'aluminum-blue', 'velvet-midnight', 'ceramic-celadon',
  'foil-holographic', 'foil-oil-slick', 'foil-crumpled', 'paper-office', 'paper-kraft',
  'paper-cold-press', 'rubber-black', 'rubber-grip', 'rubber-silicone', 'wax-candle',
  'wax-beeswax', 'wax-silicone',
])
const CONFIGS = [
  { id: 'three', light: 'softbox', softbox: 'three', tables: true },
  { id: 'three-again', light: 'softbox', softbox: 'three', tables: true },
  { id: 'half64', light: 'softbox', softbox: 'half64', tables: true },
  { id: 'half32', light: 'softbox', softbox: 'half32', tables: true },
  { id: 'representative', light: 'softbox', softbox: 'representative', tables: false },
  { id: 'point', light: 'point', softbox: 'three', tables: false },
].filter((config) => !process.env.CONFIGS || config.id === 'three' || process.env.CONFIGS.split(',').includes(config.id))
// Viewport fractions: the studio's start, upper left, and right of center.
const POSITIONS = [[0.517, 0.687], [0.25, 0.4], [0.8, 0.55]]
const CARDS = ['.mf-product', '.mf-form', '.mf-control']

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function stableShot(page) {
  let last = null
  let repeats = 0
  for (let attempt = 0; attempt < 30; attempt++) {
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
  for (let row = 0; row < height; row++) {
    data.set(image.data.subarray(((y + row) * image.width + x) * 4, ((y + row) * image.width + x + width) * 4), row * width * 4)
  }
  return { width, height, data }
}

const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  defaultViewport: null,
  protocolTimeout: 120_000,
  args: [...WEBGPU_CHROME_ARGS, '--enable-features=CanvasDrawElement', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
})
const results = []
const baselines = new Map()
const worst = new Map()
let rects = null
let union = null
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  const environment = { chrome: await browser.version() }
  for (const preset of PRESETS) {
    for (const config of CONFIGS) {
      errors.length = 0
      const url = `${LAB_URL}/?scene=material-finishes&bare&finish=${preset}&text=unlit&light=${config.light}&tilt=none&softbox=${config.softbox}`
      await page.goto(url, { waitUntil: 'load' })
      await page.waitForSelector('.mf-cards')
      await page.evaluate(() => document.fonts.ready)
      if (config.tables) {
        await page.waitForFunction(() => performance.getEntriesByName('munari:softbox-tables:decoded').length > 0, { timeout: 30_000 })
      }
      if (!environment.float32Filterable) {
        environment.float32Filterable = await page.evaluate(async () => {
          const adapter = await navigator.gpu?.requestAdapter()
          return adapter ? adapter.features.has('float32-filterable') : null
        })
      }
      await sleep(1500)
      if (!rects) {
        rects = await page.evaluate((selectors) => selectors.map((selector) => {
          const box = document.querySelector(selector).getBoundingClientRect()
          return { x: Math.round(box.x * 2), y: Math.round(box.y * 2), width: Math.round(box.width * 2), height: Math.round(box.height * 2) }
        }), CARDS)
        const left = Math.min(...rects.map((r) => r.x)) - 40
        const top = Math.min(...rects.map((r) => r.y)) - 40
        const right = Math.max(...rects.map((r) => r.x + r.width)) + 40
        const bottom = Math.max(...rects.map((r) => r.y + r.height)) + 40
        union = { x: Math.max(left, 0), y: Math.max(top, 0), width: Math.min(right, 2880) - Math.max(left, 0), height: Math.min(bottom, 1800) - Math.max(top, 0) }
      }
      const shots = []
      for (const [index, [x, y]] of POSITIONS.entries()) {
        await page.evaluate(async ({ x, y, light }) => {
          const tuning = await import('/src/scenes/material-finishes/materialFinishesTuning.ts')
          tuning.studio.keyX = x
          tuning.studio.keyY = y
          tuning.placeKey(light)
        }, { x, y, light: config.light })
        const image = decodePng(await stableShot(page))
        shots.push(image)
        const key = `${preset}@${index}`
        if (config.id === 'three') {
          baselines.set(key, image)
          continue
        }
        const baseline = baselines.get(key)
        const cards = compare(baseline, image, rects)
        const record = { preset, config: config.id, position: index, cards }
        results.push(record)
        const score = Math.max(...cards.map((card) => card.over2)) + Math.max(...cards.map((card) => card.mean)) / 1000
        const held = worst.get(config.id)
        if (!held || score > held.score) worst.set(config.id, { score, preset, position: index, baseline, image })
      }
      const moved = compare(shots[0], shots[1], rects).some((card) => card.max > 0)
      const marks = await page.evaluate(() => performance.getEntriesByName('munari:softbox-tables:decoded').length)
      results.push({ preset, config: config.id, check: { keyMovesCards: moved, tablesDecoded: marks, errors: [...errors] } })
      console.log(`${preset} ${config.id} moved=${moved} marks=${marks} errors=${errors.length}`)
    }
  }
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ environment, rects, positions: POSITIONS, results }, null, 2))
  for (const [config, held] of worst) {
    const name = `worst-${config}-${held.preset}-p${held.position}`
    writeFileSync(join(OUT, `${name}-three.png`), encodePng(crop(held.baseline, union)))
    writeFileSync(join(OUT, `${name}-${config}.png`), encodePng(crop(held.image, union)))
    console.log(`worst ${config}: ${held.preset} position ${held.position}`)
  }
} finally {
  await browser.close()
}
