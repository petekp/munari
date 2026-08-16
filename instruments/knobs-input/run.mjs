// Real-route acceptance for the shared canvas pointer gate and Knobs gesture
// cleanup. It uses Chrome's input domain so touch and pen enter through the
// same browser path as physical devices.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

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

function skip(reason) {
  const message = `knobs-input gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message)
  process.exit(strict ? 1 : 0)
}

if (!chromePath) skip('no Chrome executable found (set CHROME_PATH)')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let browser
let server
const deadline = setTimeout(() => {
  console.error('knobs-input gate: hard 120s deadline hit')
  process.exit(1)
}, 120_000)

try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--enable-features=CanvasDrawElement',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })
  const probe = await browser.newPage()
  const capable = await probe.evaluate(
    () => 'drawElementImage' in document.createElement('canvas').getContext('2d'),
  )
  await probe.close()
  if (!capable) skip(`Chrome at ${chromePath} has no drawElementImage`)

  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port
  const page = await browser.newPage()
  const cdp = await page.createCDPSession()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1, hasTouch: true })
  let pageError = null
  page.on('pageerror', (error) => { pageError ??= String(error) })

  const load = async () => {
    await page.goto(`http://localhost:${port}/?scene=knobs`, { waitUntil: 'load' })
    await page.waitForFunction(
      () => document.querySelector('.knb-panel') && document.querySelector('canvas'),
      { timeout: 15_000 },
    )
    await sleep(1200)
    await page.evaluate(() => {
      window.__ki = { pointers: [], events: [], clicks: [] }
      const panel = document.querySelector('.knb-panel')
      const recordPointer = (event) => {
        window.__ki.events.push(event.type)
        window.__ki.pointers.push({
          event: event.type,
          id: event.pointerId,
          type: event.pointerType,
          primary: event.isPrimary,
          buttons: event.buttons,
          pressure: event.pressure,
          width: event.width,
          height: event.height,
          tiltX: event.tiltX,
          tiltY: event.tiltY,
          twist: event.twist,
          shift: event.shiftKey,
        })
      }
      panel.addEventListener('pointerdown', recordPointer)
      panel.addEventListener('pointerup', recordPointer)
      panel.addEventListener('pointercancel', recordPointer)
      document.addEventListener('click', (event) => {
        window.__ki.clicks.push({
          target: event.target.className || event.target.tagName,
          relayed: event[Symbol.for('munari.relayed')] === true,
        })
      })
    })
  }

  const visiblePoint = (selector) => page.evaluate((sel) => {
    const panel = document.querySelector('.knb-panel').getBoundingClientRect()
    const target = document.querySelector(sel).getBoundingClientRect()
    return {
      x: window.innerWidth - 26 - panel.width + target.left - panel.left + target.width / 2,
      y: window.innerHeight / 2 - panel.height / 2 + target.top - panel.top + target.height / 2,
    }
  }, selector)

  const touch = async (point, kind = 'tap', id = 31) => {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: point.x, y: point.y, id, radiusX: 6, radiusY: 8, force: 0.64 }],
    })
    if (kind === 'cancel') {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    } else {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    await sleep(120)
  }

  const pen = async (point) => {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: point.x, y: point.y,
      button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen',
      force: 0.71, tiltX: 19, tiltY: -12, twist: 87, modifiers: 8,
    })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: point.x, y: point.y,
      button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen',
      force: 0, tiltX: 19, tiltY: -12, twist: 87, modifiers: 8,
    })
    await sleep(120)
  }

  const failures = []
  const require = (condition, message) => { if (!condition) failures.push(message) }

  // Cold touch: no move precedes the contact. The first contact must toggle
  // the real parked DOM control and create one relayed click only.
  await load()
  let point = await visiblePoint('.knb-toggle[aria-label="power"]')
  const powerBefore = await page.$eval('.knb-toggle[aria-label="power"]', (el) => el.getAttribute('aria-pressed'))
  await touch(point)
  let result = await page.evaluate(() => ({
    pressed: document.querySelector('.knb-toggle[aria-label="power"]').getAttribute('aria-pressed'),
    pointers: window.__ki.pointers,
    clicks: window.__ki.clicks,
  }))
  require(result.pressed !== powerBefore, `cold touch did not toggle power: ${powerBefore} -> ${result.pressed}`)
  require(result.pointers[0]?.type === 'touch', `cold touch lost pointer type: ${JSON.stringify(result.pointers[0])}`)
  require(result.pointers[0]?.primary === true && result.pointers[0]?.buttons === 1, `cold touch lost primary or buttons: ${JSON.stringify(result.pointers[0])}`)
  require(result.pointers[0]?.width >= 10 && result.pointers[0]?.height >= 12, 'touch dimensions were not preserved')
  require(result.clicks.length === 1 && result.clicks[0].relayed, `touch produced duplicate or native page clicks: ${JSON.stringify(result.clicks)}`)

  // Cold pen: reload removes prior hover and canvas solidity. Preserve pen
  // identity, pressure, tilt, twist, and modifiers through the relay.
  await load()
  point = await visiblePoint('.knb-toggle[aria-label="mirror"]')
  const mirrorBefore = await page.$eval('.knb-toggle[aria-label="mirror"]', (el) => el.getAttribute('aria-pressed'))
  await pen(point)
  result = await page.evaluate(() => ({
    pressed: document.querySelector('.knb-toggle[aria-label="mirror"]').getAttribute('aria-pressed'),
    pointer: window.__ki.pointers[0],
    events: window.__ki.events,
    clicks: window.__ki.clicks,
  }))
  require(result.pressed !== mirrorBefore, `cold pen did not toggle mirror: ${mirrorBefore} -> ${result.pressed}; events ${result.events}`)
  require(result.pointer?.type === 'pen' && result.pointer.id > 0, `pen identity was lost: ${JSON.stringify(result.pointer)}`)
  require(result.pointer?.primary === true && result.pointer?.buttons === 1, `pen primary or buttons were lost: ${JSON.stringify(result.pointer)}`)
  require(result.pointer?.pressure > 0.6, `pen pressure was lost: ${JSON.stringify(result.pointer)}`)
  require(result.pointer?.tiltX === 19 && result.pointer?.tiltY === -12, `pen tilt was lost: ${JSON.stringify(result.pointer)}`)
  require(result.pointer?.twist === 87 && result.pointer?.shift, `pen twist or modifier was lost: ${JSON.stringify(result.pointer)}`)
  require(result.clicks.length === 1 && result.clicks[0].relayed, `pen produced duplicate or native page clicks: ${JSON.stringify(result.clicks)}`)

  // Mouse hover arms matter, and clear art stays transparent to the page.
  await load()
  point = await visiblePoint('.knb-dial[aria-label="hue"]')
  await page.mouse.move(40, 40)
  await page.mouse.move(point.x, point.y)
  await sleep(50)
  let pointerEvents = await page.$eval('canvas', (canvas) => canvas.style.pointerEvents)
  require(pointerEvents === 'auto', `mouse hover did not arm the canvas: ${pointerEvents}`)
  await page.mouse.move(40, 40)
  await sleep(50)
  pointerEvents = await page.$eval('canvas', (canvas) => canvas.style.pointerEvents)
  require(pointerEvents === 'none', `clear art did not pass through: ${pointerEvents}`)
  await page.mouse.click(40, 40)
  const clearClicks = await page.evaluate(() => window.__ki.clicks)
  require(
    clearClicks.length === 1 && !clearClicks[0].relayed && clearClicks[0].target !== 'CANVAS',
    `clear-art click did not reach the page: ${JSON.stringify(clearClicks)}`,
  )

  // Cancel must not activate the control and must release the canvas claim.
  await load()
  point = await visiblePoint('.knb-toggle[aria-label="power"]')
  await touch(point, 'cancel', 41)
  result = await page.evaluate(() => ({
    pressed: document.querySelector('.knb-toggle[aria-label="power"]').getAttribute('aria-pressed'),
    pointerEvents: document.querySelector('canvas').style.pointerEvents,
    clicks: window.__ki.clicks,
  }))
  require(result.pressed === 'true', `cancel activated the control: ${result.pressed}`)
  require(result.pointerEvents === 'none', `cancel left the canvas claimed: ${result.pointerEvents}`)
  require(result.clicks.length === 0, `cancel emitted a click: ${JSON.stringify(result.clicks)}`)

  // A release lost to page focus must leave resize idle. A later buttonless
  // move must not continue changing width.
  await load()
  point = await visiblePoint('.knb-resize-grip')
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x - 40, point.y)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  const widthAfterBlur = await page.$eval('.knb-panel', (panel) => panel.getBoundingClientRect().width)
  await page.mouse.move(point.x + 140, point.y)
  await sleep(100)
  const lost = await page.evaluate((width) => ({
    width,
    now: document.querySelector('.knb-panel').getBoundingClientRect().width,
    resizing: document.querySelector('.knb-panel').classList.contains('knb-resizing'),
  }), widthAfterBlur)
  require(Math.abs(lost.now - lost.width) < 1, `lost release kept resizing: ${lost.width} -> ${lost.now}`)
  require(!lost.resizing, 'lost release left .knb-resizing active')
  await page.mouse.up()

  if (pageError) failures.push(`page error: ${pageError}`)
  if (failures.length) {
    console.error(`knobs-input gate FAILED (${failures.length})`)
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exitCode = 1
  } else {
    console.log('knobs-input: cold touch, cold pen, hover, cancel, lost release, pass-through, and click ownership agree')
    console.log('knobs-input gate PASSED')
  }
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
