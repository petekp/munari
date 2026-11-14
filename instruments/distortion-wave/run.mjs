// Distortion-wave probe — interaction cost and rendered output are measured separately.
// Timing has no screenshot or CPU profiler observer. Pixel checks reject a skipped wave.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { compareWaveImages as compare } from './images.mjs'
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
  await browser.defaultBrowserContext().overridePermissions(new URL(base).origin, ['clipboard-read', 'clipboard-sanitized-write'])
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.setViewport({ width: 895, height: 774, deviceScaleFactor: 2 })
  const url = new URL(base)
  const query = new URLSearchParams({ scene: 'distortion-wave', framed: '' })
  if (mode === 'snapdom') query.set('capture', 'snapdom')
  url.search = query
  await page.goto(url.href, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.wave-like')
  if (mode !== 'disabled') {
    await page.waitForSelector('.wave-overlay canvas[data-api-capture-consumer]')
    assert.equal(await page.evaluate(() => window.__munari.engine()), mode === 'native' ? 'html-in-canvas' : 'snapdom')
  }
  await page.mouse.move(5, 5)
  return { page, errors }
}

async function interactions(browser, mode) {
  const { page, errors } = await openPage(browser, mode)
  try {
    assert.deepEqual(await page.$$eval('.wave-example h2', nodes => nodes.map(node => node.textContent)), ['Like', 'Delete / undo', 'Copy', 'Filters', 'Checklist', 'Color'])
    await page.focus('.wave-like'); await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('.wave-like').getAttribute('aria-pressed') === 'true')
    await page.click('.wave-delete button')
    await page.waitForFunction(() => document.querySelector('.wave-delete button').textContent === 'Undo')
    assert(await page.$eval('.wave-delete button', element => element === document.activeElement))
    await page.keyboard.press('Space')
    await page.waitForFunction(() => document.querySelector('.wave-delete button').textContent === 'Delete')
    await page.click('.wave-copy button')
    await page.waitForFunction(() => document.querySelector('.wave-copy button').textContent === 'Copied')
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await page.$eval('.wave-copy code', element => element.textContent))
    await page.click('.wave-chip:nth-child(2)')
    await page.waitForFunction(() => document.querySelector('.wave-chip:nth-child(2)').getAttribute('aria-pressed') === 'true')
    assert.equal(await page.$eval('.wave-chip', element => element.getAttribute('aria-pressed')), 'true')
    await page.click('.wave-checklist label:nth-of-type(1)')
    await page.waitForFunction(() => document.querySelector('.wave-checklist output').textContent === '1 / 3')
    await page.keyboard.press('Space')
    await page.waitForFunction(() => document.querySelector('.wave-checklist output').textContent === '0 / 3')
    const beforeColor = await page.$eval('.wave-color-patch', element => getComputedStyle(element).backgroundColor)
    await page.click('[aria-label="Coral"]')
    await page.waitForFunction(() => document.querySelector('[aria-label="Coral"]').getAttribute('aria-pressed') === 'true')
    assert.notEqual(await page.$eval('.wave-color-patch', element => getComputedStyle(element).backgroundColor), beforeColor)
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }))
    await page.click('.wave-copy button')
    await page.waitForFunction(() => document.querySelector('.wave-copy button').textContent === 'Try again')
    assert.deepEqual(errors, [])
    return { examples: 6, clipboard: 'read back', deniedCopy: 'reported', keyboard: 'pass', undoFocus: 'preserved' }
  } finally { await page.close() }
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
        if (event.target.closest('.wave-like, .wave-theme')) data.clicks.push({ start: performance.now(), committed: null })
      }, true)
      const like = document.querySelector('.wave-like')
      const theme = document.querySelector('.wave-page')
      const changes = new MutationObserver(() => {
        const pending = data.clicks.at(-1)
        if (pending && pending.committed === null) pending.committed = performance.now()
      })
      changes.observe(like, { attributes: true, attributeFilter: ['aria-pressed'] })
      changes.observe(theme, { attributes: true, attributeFilter: ['data-theme'] })
      requestAnimationFrame(loop)
      window.waveMeasurement = { data, observer, changes }
    })
    const mark = name => page.evaluate(phase => window.waveMeasurement.data.marks.push({ phase, time: performance.now() }), name)
    await mark('idle'); await wait(1200)
    await mark('first-click'); await page.click('.wave-like'); await wait(1500)
    assert.equal(await page.$eval('.wave-like', button => button.getAttribute('aria-pressed')), 'true')
    await mark('repeat-click'); await page.click('.wave-like'); await wait(1500)
    assert.equal(await page.$eval('.wave-like', button => button.getAttribute('aria-pressed')), 'false')
    await mark('pointer-sweep')
    for (const selector of ['.wave-like', '.wave-delete button', '.wave-copy button', '.wave-like', '.wave-delete button', '.wave-copy button']) { await page.hover(selector); await wait(130) }
    await wait(500)
    await mark('theme'); await page.click('.wave-theme'); await wait(1800)
    assert.equal(await page.$eval('.wave-page', element => element.dataset.theme), 'dark')
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


async function pixels(browser, mode) {
  const { page, errors } = await openPage(browser, mode)
  try {
    await page.select('select', '3600')
    const records = []
    const selectedCases = process.env.WAVE_CASES?.split(',')
    const cases = [
      ['first', '.wave-like', false, '.wave-like'],
      ['repeat', '.wave-like', false, '.wave-like'],
      ['interrupt', '.wave-delete button', false, '.wave-delete'],
      ['delete', '.wave-delete button', false, '.wave-delete'],
      ['copy', '.wave-copy button', false, '.wave-copy button'],
      ['chip', '.wave-chip:nth-child(2)', false, '.wave-chip:nth-child(2)'],
      ['checklist', '.wave-checklist label:nth-of-type(1)', false, '.wave-checklist'],
      ['color', '[aria-label="Coral"]', false, '.wave-color'],
      ['theme', '.wave-theme', false, null],
      ['hidden-control', '.wave-like', true, '.wave-like'],
    ]
    for (const name of selectedCases ?? []) assert(cases.some(([known]) => known === name), `Unknown wave pixel case: ${name}`)
    const stateOf = element => element.getAttribute('aria-pressed') ?? element.getAttribute('data-checked') ?? element.getAttribute('aria-label') ?? element.textContent
    for (const [name, selector, hidden, region] of cases) {
      if (selectedCases && !selectedCases.includes(name)) continue
      if (hidden) await page.$eval('.wave-overlay', element => { element.style.visibility = 'hidden' })
      await page.hover(selector)
      await wait(400)
      if (name === 'interrupt') {
        await page.click('.wave-like')
        await page.waitForFunction(() => document.querySelector('.wave-like').getAttribute('aria-pressed') === 'true')
        await wait(200)
      }
      const before = await page.screenshot()
      let allowed = region === null ? null : await page.$eval(region, element => { const r = element.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height} })
      if (name === 'interrupt') allowed = [allowed, await page.$eval('.wave-like', element => { const r = element.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height} })]
      const previousState = await page.$eval(selector, stateOf)
      await page.click(selector)
      await page.waitForFunction((target, previous) => {
        const element = document.querySelector(target)
        return (element.getAttribute('aria-pressed') ?? element.getAttribute('data-checked') ?? element.getAttribute('aria-label') ?? element.textContent) !== previous
      }, {}, selector, previousState)
      await wait(225)
      const during = await page.screenshot()
      await wait(100)
      const later = await page.screenshot()
      await page.$eval('.wave-overlay', element => { element.style.visibility = 'hidden' })
      const native = await page.screenshot()
      await writeFile(path.join(output, `${mode}-${name}.png`), during)
      await writeFile(path.join(output, `${mode}-${name}-later.png`), later)
      const difference = await compare(page, before, during, native, allowed)
      await writeFile(path.join(output, `${mode}-${name}-before.png`), before)
      await writeFile(path.join(output, `${mode}-${name}-native.png`), native)
      assert.equal(difference.outsidePixels, 0, 'The effect must remain inside its target')
      if (name === 'interrupt') assert(difference.regionPixels.every(count => count > 100), 'Both overlapping targets must stay lit')
      let movingPixels = 0
      if (hidden) assert.equal(difference.effectPixels, 0, 'The hidden-output control must have no wave pixels')
      else {
        const laterDifference = await compare(page, before, later, native, allowed)
        assert.equal(laterDifference.outsidePixels, 0, 'The moving effect must remain inside its target')
        const movement = await compare(page, during, later, during, allowed)
        movingPixels = movement.effectPixels
        if (name === 'interrupt') assert(movement.regionPixels.every(count => count > 100), 'Both overlapping waves must keep moving')
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
      records.push({ name, target: allowed, ...difference, movingPixels, settledPixels: settledDifference.changedPixels })
    }
    assert.deepEqual(errors, [])
    return records
  } finally { await page.close() }
}

for (const mode of modes.length ? modes : ['native', 'snapdom']) {
  assert(['native', 'snapdom', 'disabled'].includes(mode))
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: [...WEBGPU_CHROME_ARGS, ...(mode === 'native' ? ['--enable-features=CanvasDrawElement'] : mode === 'disabled' ? ['--disable-features=CanvasDrawElement'] : [])] })
  try {
    const result = { mode, browser: await browser.version() }
    if (process.env.WAVE_INTERACTIONS !== '0') result.interactions = await interactions(browser, mode)
    if (process.env.WAVE_TIMING !== '0') result.timing = await timing(browser, mode)
    if (mode !== 'disabled' && process.env.WAVE_PIXELS !== '0') result.pixels = await pixels(browser, mode)
    results.push(result)
    console.log(JSON.stringify(result))
  } finally { await browser.close() }
}
await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
