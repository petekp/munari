// Distortion-wave probe — interaction cost and rendered output are measured separately.
// Timing has no screenshot or CPU profiler observer. Pixel checks reject a skipped wave.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

const base = process.env.WAVE_URL ?? 'http://127.0.0.1:5188/'
const output = path.resolve(process.env.WAVE_OUTPUT ?? 'instruments/distortion-wave/out')
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync)
assert(chrome, 'Set CHROME_PATH to an installed Chrome executable')
const modes = process.argv.slice(2)
const results = []
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
await mkdir(output, { recursive: true })

async function openPage(browser, mode) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.setViewport({ width: 895, height: 774, deviceScaleFactor: 2 })
  const url = new URL(base)
  const query = new URLSearchParams({ scene: 'distortion-wave', framed: '' })
  if (mode === 'snapdom') query.set('capture', 'snapdom')
  url.search = query
  await page.goto(url.href, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.wave-person button')
  if (mode !== 'disabled') {
    await page.waitForSelector('.wave-overlay canvas[data-api-capture-consumer]')
    assert.equal(await page.evaluate(() => window.__munari.engine()), mode === 'native' ? 'html-in-canvas' : 'snapdom')
  }
  await page.mouse.move(5, 5)
  return { page, errors }
}

async function timing(browser, mode) {
  const { page, errors } = await openPage(browser, mode)
  try {
    await page.select('select', '900')
    await wait(400)
    await page.evaluate(() => {
      const data = { frames: [], longtasks: [], marks: [], clicks: [], last: 0 }
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) data.longtasks.push({ start: entry.startTime, duration: entry.duration })
      })
      observer.observe({ type: 'longtask' })
      const loop = now => {
        if (data.last) data.frames.push({ start: data.last, end: now, duration: now - data.last })
        data.last = now
        data.raf = requestAnimationFrame(loop)
      }
      document.addEventListener('click', event => {
        if (event.target.closest('.wave-person button, .wave-theme')) data.clicks.push({ start: performance.now(), committed: null })
      }, true)
      const follow = document.querySelector('.wave-person button')
      const theme = document.querySelector('.wave-page')
      const changes = new MutationObserver(() => {
        const pending = data.clicks.at(-1)
        if (pending && pending.committed === null) pending.committed = performance.now()
      })
      changes.observe(follow, { childList: true, subtree: true, characterData: true })
      changes.observe(theme, { attributes: true, attributeFilter: ['data-theme'] })
      requestAnimationFrame(loop)
      window.waveMeasurement = { data, observer, changes }
    })
    const mark = name => page.evaluate(phase => window.waveMeasurement.data.marks.push({ phase, time: performance.now() }), name)
    await mark('idle'); await wait(1200)
    await mark('first-click'); await page.click('.wave-person button'); await wait(1500)
    assert.equal(await page.$eval('.wave-person button', button => button.textContent), 'Following')
    await mark('repeat-click'); await page.click('.wave-person button'); await wait(1500)
    assert.equal(await page.$eval('.wave-person button', button => button.textContent), 'Follow')
    await mark('pointer-sweep')
    for (const x of [90, 540, 750, 90, 540, 750]) { await page.mouse.move(x, 328, { steps: 4 }); await wait(130) }
    await wait(500)
    await mark('theme'); await page.click('.wave-theme'); await wait(1800)
    assert.equal(await page.$eval('.wave-page', element => element.dataset.theme), 'light')
    await mark('end')
    const raw = await page.evaluate(() => {
      const { data, observer, changes } = window.waveMeasurement
      cancelAnimationFrame(data.raf); observer.disconnect(); changes.disconnect()
      return { ...data, capture: window.__munari.stats() }
    })
    const phases = {}
    for (let i = 0; i < raw.marks.length - 1; i++) {
      const { phase, time } = raw.marks[i], end = raw.marks[i + 1].time
      const frames = raw.frames.filter(frame => frame.start >= time && frame.end < end).map(frame => frame.duration).sort((a, b) => a - b)
      const longtasks = raw.longtasks.filter(task => task.start >= time && task.start < end)
      phases[phase] = { frames: frames.length, p95: frames[Math.floor(frames.length * .95)], max: frames.at(-1), longtasks: longtasks.map(task => task.duration) }
    }
    assert.equal(raw.clicks.length, 3, 'Measure first click, repeated click and theme change')
    assert(raw.clicks.every(click => click.committed !== null), 'Every click must commit native state')
    assert.deepEqual(errors, [])
    await writeFile(path.join(output, `${mode}-timing.json`), JSON.stringify(raw, null, 2))
    return { phases, commitMs: raw.clicks.map(click => click.committed - click.start) }
  } finally { await page.close() }
}

async function compare(page, before, during, native) {
  return page.evaluate(async images => {
    const decode = async data => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
      return context.getImageData(0, 0, canvas.width, canvas.height).data
    }
    const [old, current, next] = await Promise.all(images.map(decode))
    let effectPixels = 0, changedPixels = 0
    for (let i = 0; i < current.length; i += 4) {
      const oldDelta = Math.max(...[0, 1, 2].map(channel => Math.abs(current[i + channel] - old[i + channel])))
      const nextDelta = Math.max(...[0, 1, 2].map(channel => Math.abs(current[i + channel] - next[i + channel])))
      if (oldDelta > 20 && nextDelta > 20) effectPixels++
      if (nextDelta > 0) changedPixels++
    }
    return { effectPixels, changedPixels }
  }, [before, during, native].map(bytes => Buffer.from(bytes).toString('base64')))
}

async function pixels(browser, mode) {
  const { page, errors } = await openPage(browser, mode)
  try {
    await page.select('select', '3600')
    const records = []
    for (const [name, selector, hidden] of [['first', '.wave-person button', false], ['repeat', '.wave-person button', false], ['theme', '.wave-theme', false], ['hidden-control', '.wave-person button', true]]) {
      if (hidden) await page.$eval('.wave-overlay', element => { element.style.visibility = 'hidden' })
      await page.hover(selector)
      await wait(400)
      const before = await page.screenshot()
      const previousState = await page.$eval(selector, element => element.getAttribute('aria-pressed') ?? element.getAttribute('aria-label'))
      await page.click(selector)
      await page.waitForFunction((target, previous) => {
        const element = document.querySelector(target)
        return (element.getAttribute('aria-pressed') ?? element.getAttribute('aria-label')) !== previous
      }, {}, selector, previousState)
      await wait(225)
      const during = await page.screenshot()
      await wait(100)
      const later = await page.screenshot()
      await page.$eval('.wave-overlay', element => { element.style.visibility = 'hidden' })
      const native = await page.screenshot()
      await writeFile(path.join(output, `${mode}-${name}.png`), during)
      await writeFile(path.join(output, `${mode}-${name}-later.png`), later)
      const difference = await compare(page, before, during, native)
      let movingPixels = 0
      if (hidden) assert.equal(difference.effectPixels, 0, 'The hidden-output control must have no wave pixels')
      else {
        const laterDifference = await compare(page, before, later, native)
        movingPixels = (await compare(page, during, later, during)).effectPixels
        assert(difference.effectPixels > 100, `${mode} ${name}: no visible wave`)
        assert(laterDifference.effectPixels > 100 && movingPixels > 100, `${mode} ${name}: the wave must move`)
        await page.$eval('.wave-overlay', element => { element.style.visibility = '' })
      }
      await wait(3300)
      const settled = await page.screenshot()
      await page.$eval('.wave-overlay', element => { element.style.visibility = 'hidden' })
      const settledNative = await page.screenshot()
      const settledDifference = await compare(page, settledNative, settled, settledNative)
      assert.equal(settledDifference.changedPixels, 0, 'A finished effect must leave no pixels behind')
      if (!hidden) await page.$eval('.wave-overlay', element => { element.style.visibility = '' })
      records.push({ name, ...difference, movingPixels, settledPixels: settledDifference.changedPixels })
    }
    assert.deepEqual(errors, [])
    return records
  } finally { await page.close() }
}

for (const mode of modes.length ? modes : ['native', 'snapdom']) {
  assert(['native', 'snapdom', 'disabled'].includes(mode))
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: [...WEBGPU_CHROME_ARGS, ...(mode === 'disabled' ? ['--disable-features=CanvasDrawElement'] : ['--enable-features=CanvasDrawElement'])] })
  try {
    const result = { mode, browser: await browser.version() }
    if (process.env.WAVE_TIMING !== '0') result.timing = await timing(browser, mode)
    if (mode !== 'disabled' && process.env.WAVE_PIXELS !== '0') result.pixels = await pixels(browser, mode)
    results.push(result)
    console.log(JSON.stringify(result))
  } finally { await browser.close() }
}
await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
