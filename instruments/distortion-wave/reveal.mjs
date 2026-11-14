// State reveal — real native reference pixels distinguish a held state from early HTML updates.
// A controlled animation clock isolates ordering; it does not measure input latency.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

const output = path.resolve(process.env.WAVE_OUTPUT ?? 'instruments/distortion-wave/out')
await mkdir(output, { recursive: true })
const modes = process.argv.slice(2)
const results = []
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

async function difference(page, actual, expected, clip) {
  return page.evaluate(async (a, b, region) => {
    const decode = async value => {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${value}`)).blob())
      const canvas = new OffscreenCanvas(image.width, image.height)
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      return context.getImageData(Math.round(region.x * 2), Math.round(region.y * 2), Math.round(region.width * 2), Math.round(region.height * 2)).data
    }
    const [left, right] = await Promise.all([decode(a), decode(b)])
    if (left.length !== right.length) throw new Error('Reference dimensions changed')
    let changed = 0
    let squared = 0
    for (let i = 0; i < left.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) squared += (left[i + channel] - right[i + channel]) ** 2
      if (Math.max(...[0, 1, 2, 3].map(channel => Math.abs(left[i + channel] - right[i + channel]))) > 20) changed++
    }
    return { changed, meanSquared: squared / (left.length / 4 * 3) }
  }, Buffer.from(actual).toString('base64'), Buffer.from(expected).toString('base64'), clip)
}

async function reveal(browser, mode, name) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404 (Not Found)')) errors.push(message.text()) })
  try {
    await page.setViewport({ width: 895, height: 774, deviceScaleFactor: 2 })
    const url = new URL(process.env.WAVE_URL ?? 'http://127.0.0.1:5188/')
    url.search = new URLSearchParams({ scene: 'distortion-wave', framed: '' })
    if (mode === 'snapdom') url.searchParams.set('capture', 'snapdom')
    await page.goto(url.href, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.wave-overlay canvas[data-api-capture-consumer]')
    assert.equal(await page.evaluate(() => window.__munari.engine()), mode === 'native' ? 'html-in-canvas' : 'snapdom')
    await page.select('select', '3600')
    await page.hover('.wave-checklist label:nth-of-type(1)')
    await page.evaluate(() => {
      const base = performance.now()
      window.waveClock = { base, now: base }
      Object.defineProperty(performance, 'now', { configurable: true, value: () => window.waveClock.now })
    })
    const clip = await page.$eval('.wave-checklist', element => {
      const r = element.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })
    const shot = () => page.screenshot()
    const native = async () => {
      await page.$eval('.wave-overlay', element => { element.style.visibility = 'hidden' })
      const image = await shot()
      await page.$eval('.wave-overlay', element => { element.style.visibility = '' })
      return image
    }
    const check = async (index, count) => {
      await page.click(`.wave-checklist label:nth-of-type(${index + 1})`)
      await page.waitForFunction(expected => document.querySelector('.wave-checklist output').textContent === `${expected} / 3`, {}, count)
      await settle(page)
    }
    const theme = async () => {
      await page.click('.wave-theme')
      await page.waitForFunction(() => document.querySelector('.wave-page').dataset.theme === 'dark')
      await settle(page)
    }
    const initial = await native()
    let expected = initial
    let intermediate = initial
    if (name === 'overflow') {
      await page.evaluate(() => {
        window.waveCommits = []
        const output = document.querySelector('.wave-checklist output')
        const observer = new MutationObserver(() => window.waveCommits.push(output.textContent))
        observer.observe(output, { childList: true, subtree: true, characterData: true })
        const inputs = document.querySelectorAll('.wave-checklist input')
        for (let i = 0; i < 10; i++) inputs[i % 3].click()
      })
      await page.waitForFunction(() => window.waveCommits.length === 8)
      assert.deepEqual(await page.evaluate(() => window.waveCommits), ['1 / 3','2 / 3','3 / 3','2 / 3','1 / 3','0 / 3','1 / 3','2 / 3'])
      await settle(page)
    } else if (name === 'theme-first') {
      await theme()
      await check(0, 1)
    } else {
      await check(0, 1)
      intermediate = await native()
      if (name === 'spaced') {
        await page.evaluate(() => { window.waveClock.now = window.waveClock.base + 1000 })
        await settle(page)
        expected = await native()
      }
      if (name === 'theme-second') await theme()
      else if (name === 'other-control') {
        await page.click('.wave-like')
        await page.waitForFunction(() => document.querySelector('.wave-like').getAttribute('aria-pressed') === 'true')
        await settle(page)
      } else await check(1, 2)
    }
    await settle(page)
    const held = await shot()
    const latest = await native()
    const heldMismatch = await difference(page, held, expected, clip)
    const intermediateDistance = await difference(page, held, intermediate, clip)
    const latestDistance = await difference(page, held, latest, clip)
    const hiddenMismatch = await difference(page, latest, expected, clip)
    await writeFile(path.join(output, `${mode}-${name}-held.png`), held)
    await writeFile(path.join(output, `${mode}-${name}-expected.png`), expected)
    await writeFile(path.join(output, `${mode}-${name}-latest.png`), latest)
    const result = { mode, name, heldMismatch, intermediateDistance, latestDistance, hiddenMismatch, errors }
    await writeFile(path.join(output, `${mode}-${name}.json`), JSON.stringify(result, null, 2))
    assert(heldMismatch.meanSquared < latestDistance.meanSquared, `${name}: the outgoing checklist must stay visible before its wave passes`)
    if (name === 'held') assert(heldMismatch.meanSquared < intermediateDistance.meanSquared, 'The older mask must remain above the next outgoing state')
    assert(hiddenMismatch.changed > 100, `${name}: hiding the masks must expose a different state`)
    await page.evaluate(() => { window.waveClock.now = window.waveClock.base + 20000 })
    if (name === 'overflow') {
      await page.waitForFunction(() => window.waveCommits.length === 10)
      assert.deepEqual(await page.$$eval('.wave-checklist input', inputs => inputs.map(input => input.checked)), [false, true, true])
      await page.evaluate(() => { window.waveClock.now = window.waveClock.base + 40000 })
    }
    await settle(page)
    const finalMismatch = await difference(page, await shot(), await native(), clip)
    assert.equal(finalMismatch.changed, 0, `${name}: settled pixels must match the latest native state`)
    await page.waitForFunction(() => document.querySelectorAll('[data-munari-parked]').length === 0)
    assert.deepEqual(errors, [])
    return { ...result, finalMismatch }
  } finally { await page.close() }
}

const cases = ['held', 'spaced', 'other-control', 'theme-first', 'theme-second', 'overflow']
const selectedCases = process.env.WAVE_CASES?.split(',') ?? cases
for (const name of selectedCases) assert(cases.includes(name), `Unknown wave reveal case: ${name}`)

for (const mode of modes.length ? modes : ['native', 'snapdom']) {
  assert(['native', 'snapdom'].includes(mode))
  const args = [...WEBGPU_CHROME_ARGS]
  if (mode === 'native') args.push('--enable-features=CanvasDrawElement')
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args })
  try {
    for (const name of selectedCases) {
      const result = await reveal(browser, mode, name)
      results.push(result)
      console.log(JSON.stringify(result))
    }
  } finally { await browser.close() }
}
await writeFile(path.join(output, 'reveal-results.json'), JSON.stringify(results, null, 2))
