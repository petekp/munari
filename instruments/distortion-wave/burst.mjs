// Burst feedback — independent waves overlap while every native action is preserved.
// Same-target image comparisons use a controlled animation clock, never for timing claims.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'
import { compareWaveImages } from './images.mjs'

const output = path.resolve(process.env.WAVE_OUTPUT ?? 'instruments/distortion-wave/out')
await mkdir(output, { recursive: true })
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const results = []
const modes = process.argv.slice(2)

async function openPage(browser, mode) {
  const page = await browser.newPage()
  await page.setViewport({ width: 895, height: 774, deviceScaleFactor: 2 })
  const url = new URL(process.env.WAVE_URL ?? 'http://127.0.0.1:5188/')
  url.search = new URLSearchParams({ scene: 'distortion-wave', framed: '' })
  if (mode === 'snapdom') url.searchParams.set('capture', 'snapdom')
  await page.goto(url.href, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.wave-overlay canvas[data-api-capture-consumer]')
  await page.select('select', '3600')
  return page
}

async function sameTarget(browser, mode, double) {
  const page = await openPage(browser, mode)
  try {
    await page.click('.wave-person button')
    await page.waitForFunction(() => document.querySelector('.wave-person button').textContent === 'Following')
    await page.evaluate(() => {
      const base = performance.now()
      window.waveClock = { now: base, base }
      Object.defineProperty(performance, 'now', { configurable: true, value: () => window.waveClock.now })
    })
    if (double) { await page.click('.wave-plan button'); await wait(120) }
    await page.evaluate(() => { window.waveClock.now = window.waveClock.base + 200 })
    await page.click('.wave-plan button')
    await wait(120)
    await page.evaluate(() => { window.waveClock.now = window.waveClock.base + 400 })
    await wait(100)
    assert.equal(await page.$eval('.wave-plan button', element => element.getAttribute('aria-pressed')), 'true')
    const image = await page.screenshot()
    const rect = await page.$eval('.wave-plan', element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
    await writeFile(path.join(output, `${mode}-${double ? 'double' : 'single'}.png`), image)
    return { image, rect }
  } finally { await page.close() }
}

async function nested(browser, mode, pageFirst, withButton) {
  const page = await openPage(browser, mode)
  try {
    await page.evaluate(() => {
      const base = performance.now()
      window.waveClock = { base, now: base }
      Object.defineProperty(performance, 'now', { configurable: true, value: () => window.waveClock.now })
    })
    const button = async () => {
      await page.click('.wave-plan button')
      await wait(120)
      await page.waitForFunction(() => document.querySelectorAll('[data-munari-parked]').length === 0)
    }
    if (!pageFirst && withButton) await button()
    await page.evaluate(first => { window.waveClock.now = window.waveClock.base + (first ? 0 : 350) }, pageFirst)
    await page.click('.wave-theme')
    await page.waitForFunction(() => document.querySelector('.wave-page').dataset.theme === 'light')
    if (pageFirst && withButton) {
      await page.evaluate(() => { window.waveClock.now = window.waveClock.base + 350 })
      await button()
    }
    await page.evaluate(() => { window.waveClock.now = window.waveClock.base + 800 })
    await wait(100)
    const image = await page.screenshot()
    const rect = await page.$eval('.wave-plan', element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
    await writeFile(path.join(output, `${mode}-${pageFirst ? 'page-first' : 'button-first'}-${withButton ? 'both' : 'page'}.png`), image)
    return { image, rect }
  } finally { await page.close() }
}

async function rapid(browser, mode) {
  const page = await openPage(browser, mode)
  await page.select('select', '1800')
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  try {
    await page.evaluate(() => {
      const captures = new Set()
      const data = { frames: [], longtasks: [], clicks: [], captures: 0, sourceEvents: [], last: 0 }
      const sources = new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node instanceof Element && node.hasAttribute('data-munari-parked') && !captures.has(node)) { captures.add(node); data.sourceEvents.push({ action: data.clicks.length, time: performance.now() }) }
        }
        data.captures = captures.size
      })
      sources.observe(document.body, { childList: true, subtree: true })
      const tasks = new PerformanceObserver(list => { for (const entry of list.getEntries()) data.longtasks.push(entry.duration) })
      tasks.observe({ type: 'longtask' })
      document.addEventListener('click', event => {
        if (event.target.closest('[aria-label="Upvote"]')) data.clicks.push({ start: performance.now(), committed: null })
      }, true)
      const values = new MutationObserver(() => {
        const value = Number(document.querySelector('.wave-stepper output').textContent)
        const pending = data.clicks[value - 43]
        if (pending && pending.committed === null) { pending.committed = performance.now(); pending.value = value }
      })
      values.observe(document.querySelector('.wave-stepper output'), { childList: true, subtree: true, characterData: true })
      const tick = now => { if (data.last) data.frames.push(now - data.last); data.last = now; data.raf = requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
      window.waveBurst = { data, sources, tasks, values }
    })
    for (let i = 0; i < 12; i++) { await page.click('[aria-label="Upvote"]'); await wait(60) }
    await page.waitForFunction(() => document.querySelector('.wave-stepper output').textContent === '54')
    await wait(250)
    const raw = await page.evaluate(() => {
      const { data, sources, tasks, values } = window.waveBurst
      cancelAnimationFrame(data.raf); sources.disconnect(); tasks.disconnect(); values.disconnect()
      return data
    })
    await writeFile(path.join(output, `${mode}-burst-raw.json`), JSON.stringify(raw, null, 2))
    assert.equal(raw.clicks.length, 12)
    assert(raw.clicks.every(click => click.committed !== null))
    assert(raw.captures > 0, 'The initial gesture must create a source in this engine')
    assert.deepEqual(raw.clicks.map(click => click.value), Array.from({ length: 12 }, (_, index) => 43 + index))

    await page.screenshot({ path: path.join(output, `${mode}-burst.png`) })
    await wait(3900)
    assert.equal(await page.$$eval('[data-munari-parked]', elements => elements.length), 0)
    await page.evaluate(() => { const button = document.querySelector('[aria-label="Upvote"]'); button.click(); button.click() })
    await page.waitForFunction(() => document.querySelector('.wave-stepper output').textContent === '56')
    await page.evaluate(() => { window.themeFrames = []; window.themeLast = 0; const tick = now => { if (window.themeLast) window.themeFrames.push(now - window.themeLast); window.themeLast = now; window.themeRaf = requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
    for (let i = 0; i < 4; i++) { await page.click('.wave-theme'); await wait(60) }
    await page.waitForFunction(() => document.querySelector('.wave-page').dataset.theme === 'dark' && document.querySelectorAll('[data-munari-parked]').length === 0)
    const themeFrames = await page.evaluate(() => { cancelAnimationFrame(window.themeRaf); return window.themeFrames })
    assert.equal(await page.$eval('.wave-page', element => element.dataset.theme), 'dark')
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
    await page.click('[aria-label="Upvote"]')
    await page.waitForFunction(() => document.querySelector('.wave-stepper output').textContent === '57')
    await page.waitForFunction(() => document.querySelectorAll('[data-munari-parked]').length === 0)
    assert.deepEqual(errors, [])
    return { captures: raw.captures, actions: raw.clicks.length, maxRafGapMs: Math.max(...raw.frames), longtasks: raw.longtasks, maxBurstCommitMs: Math.max(...raw.clicks.slice(1).map(click => click.committed - click.start)), pendingInterruption: 'pass', themeOverlap: 'pass', maxThemeRafGapMs: Math.max(...themeFrames), reducedMotion: 'pass' }
  } finally { await page.close() }
}

for (const mode of modes.length ? modes : ['native', 'snapdom']) {
  assert(['native', 'snapdom'].includes(mode))
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: [...WEBGPU_CHROME_ARGS, ...(mode === 'native' ? ['--enable-features=CanvasDrawElement'] : [])] })
  try {
    const single = await sameTarget(browser, mode, false)
    const double = await sameTarget(browser, mode, true)
    const scoring = await browser.newPage()
    await scoring.setViewport({ width: 895, height: 774, deviceScaleFactor: 2 })
    const difference = await compareWaveImages(scoring, single.image, double.image, single.image, single.rect)
    const nestedRegions = []
    for (const pageFirst of [true, false]) {
      const pageOnly = await nested(browser, mode, pageFirst, false)
      const both = await nested(browser, mode, pageFirst, true)
      const delta = await compareWaveImages(scoring, pageOnly.image, both.image, pageOnly.image, both.rect)
      assert(delta.regionPixels[0] > 100, 'A button pulse must remain visible during the page wave in either click order')
      nestedRegions.push(delta.regionPixels[0])
    }
    await scoring.close()
    assert(difference.regionPixels[0] > 100, 'Two same-target waves must differ from one wave at the same final clock and native state')
    const result = { mode, sameTargetChangedPixels: difference.regionPixels[0], nestedRegions, rapid: await rapid(browser, mode) }
    results.push(result); console.log(JSON.stringify(result))
  } finally { await browser.close() }
}
await writeFile(path.join(output, 'burst-results.json'), JSON.stringify(results, null, 2))
