// Native fallback gestures in Flight, Genie, Knobs, Selection and Logo.
//
// A Surface without capture capability keeps its DOM and reports the reason,
// so nothing throws from the outside. What breaks is a gesture that arms a
// transition only a renderer can finish: knobs carry/resize, genie minimize,
// or flight drag (2026-08-23). Each scene must complete its native gestures
// and finish with an empty error console.

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'
import { checkDegradedFlight } from './degradedFlight.mjs'
import { checkDegradedScenes } from './degradedScenes.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const labRoot = path.join(repoRoot, 'apps', 'lab')
const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
].filter(Boolean).find(existsSync)
const strict = process.env.STRICT_CAPABILITY === '1'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function skip(reason) {
  const message = `degraded gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message)
  process.exit(strict ? 1 : 0)
}

if (!chromePath) skip('no Chrome executable found (set CHROME_PATH)')

let browser
let server
const deadline = setTimeout(() => {
  console.error('degraded gate: hard 240s deadline hit')
  browser?.process()?.kill('SIGKILL')
  process.exit(1)
}, 240_000)

const problems = []
const note = (message) => problems.push(message)

try {
  // Explicitly disable CanvasDrawElement so Chrome 157+ (which enables it by
  // default) exercises the native fallback path rather than skipping.
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      ...WEBGPU_CHROME_ARGS,
      '--disable-features=CanvasDrawElement',
      '--enable-unsafe-swiftshader',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })
  server = await createServer({ root: labRoot, logLevel: 'silent', server: { port: 0 } })
  await server.listen()
  const port = server.httpServer.address().port

  let page
  let errors = []
  const go = async (scene, ready) => {
    await page?.close()
    errors = []
    page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 820, deviceScaleFactor: 1 })
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
    page.on('pageerror', (error) => errors.push(String(error)))
    page.on('response', response => { if (response.status() >= 400 && new URL(response.url()).pathname !== '/favicon.ico') errors.push(`HTTP ${response.status()} ${response.url()}`) })
    page.on('requestfailed', request => { if (new URL(request.url()).pathname !== '/favicon.ico') errors.push(`${request.failure()?.errorText} ${request.url()}`) })
    page.on('console', (message) => {
      const text = message.text()
      if (message.type() !== 'error') return
      if (text.startsWith('Failed to load resource')) return
      errors.push(text)
    })
    await page.goto(`http://localhost:${port}/?scene=${scene}&bare&capture=none`, { waitUntil: 'load' })
    await page.waitForSelector(ready, { timeout: 20_000 })
    await sleep(500)
    const capability = await page.evaluate(() => 'drawElementImage' in CanvasRenderingContext2D.prototype)
    if (capability) note(`${scene}: the served page enabled capture, so this is not a native fallback run`)
  }
  const settle = async (scene) => {
    if (errors.length) note(`${scene}: console/page errors — ${errors.join(' | ')}`)
  }
  const centre = (selector, nth = 0) =>
    page.evaluate(
      ({ selector, nth }) => {
        const el = document.querySelectorAll(selector)[nth]
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      },
      { selector, nth },
    )
  const dragSteps = async (from, to, steps, onStep) => {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    for (let i = 1; i <= steps; i++) {
      const x = from.x + ((to.x - from.x) * i) / steps
      const y = from.y + ((to.y - from.y) * i) / steps
      await page.mouse.move(x, y)
      await sleep(40)
      if (onStep) await onStep(i, Math.round(x), Math.round(y))
    }
    await page.mouse.up()
    await sleep(450)
  }

  {
    const probe = await browser.newPage()
    const capable = await probe.evaluate(
      () => 'drawElementImage' in document.createElement('canvas').getContext('2d'),
    )
    await probe.close()
    if (capable) {
      await browser.close()
      browser = null
      await server.close()
      server = null
      skip(`Chrome at ${chromePath} kept CanvasDrawElement enabled despite --disable-features=CanvasDrawElement`)
    }
  }

  const context = { go, currentPage: () => page, centre, dragSteps, settle, sleep, note }
  await checkDegradedFlight(context)
  await checkDegradedScenes(context)

  if (problems.length) {
    console.error(`degraded gate FAILED (${problems.length}):`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log('degraded gate PASSED — native fallback gestures in five scenes')
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
