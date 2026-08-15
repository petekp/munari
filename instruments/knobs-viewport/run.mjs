// Knobs small-viewport and keyboard acceptance gate.
import { existsSync } from 'node:fs'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'

const candidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)
const chromePath = candidates.find((candidate) => existsSync(candidate))
const strict = process.env.STRICT_CAPABILITY === '1'
const skip = (reason) => {
  console.warn(`knobs-viewport gate SKIPPED: ${reason}`)
  if (strict) process.exitCode = 1
}

if (!chromePath) {
  skip('no Chrome executable found (set CHROME_PATH)')
  process.exit()
}

const frames = (page, count = 3) =>
  page.evaluate(
    (remaining) =>
      new Promise((resolve) => {
        const next = () => (--remaining <= 0 ? resolve() : requestAnimationFrame(next))
        requestAnimationFrame(next)
      }),
    count,
  )

const viewports = [
  [320, 568],
  [360, 640],
  [390, 667],
  [390, 844],
  [640, 360],
]

let browser
let server
const deadline = setTimeout(() => {
  console.error('knobs-viewport gate: hard 120s deadline hit')
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
  const capability = await browser.newPage()
  const supported = await capability.evaluate(
    () => typeof document.createElement('canvas').getContext('2d').drawElementImage === 'function',
  )
  await capability.close()
  if (!supported) {
    await browser.close()
    browser = null
    skip('Chrome has no drawElementImage support')
  } else {
    server = await createServer({ root: 'apps/lab', logLevel: 'warn', server: { port: 0 } })
    await server.listen()
    const port = server.config.server.port ?? server.httpServer.address().port
    const failures = []
    let baseline = null

    for (const [width, height] of viewports) {
      const page = await browser.newPage()
      const pageErrors = []
      page.on('pageerror', (error) => pageErrors.push(String(error)))
      page.on('console', (message) => {
        if (/ResizeObserver loop|WebGL.*(?:error|context lost)/i.test(message.text()))
          pageErrors.push(message.text())
      })
      await page.setViewport({ width, height, deviceScaleFactor: 1 })
      await page.goto(`http://localhost:${port}/?scene=knobs&probe=knobs-resize`, {
        waitUntil: 'load',
      })
      await page.waitForFunction(
        () => window.__knobsResizeProbe?.snapshot().presented && document.querySelector('.knb-panel'),
        { timeout: 20_000 },
      )
      await frames(page, 8)

      const initial = await page.evaluate(() => {
        const panel = document.querySelector('.knb-panel').getBoundingClientRect()
        const dial = document.querySelector('.knb-dial').getBoundingClientRect()
        const readout = document.querySelector('.knb-dial-value').getBoundingClientRect()
        const scroll = document.querySelector('.knb-page')
        return {
          panelWidth: panel.width,
          dial: [dial.width, dial.height],
          readout: [readout.width, readout.height],
          overflowX: scroll.scrollWidth > scroll.clientWidth,
          overflowY: scroll.scrollHeight > scroll.clientHeight,
          scale: window.__knobsResizeProbe.snapshot().panelScale,
        }
      })
      baseline ??= { dial: initial.dial, readout: initial.readout }
      if (initial.panelWidth !== 320) failures.push(`${width}x${height}: initial width ${initial.panelWidth}`)
      if (initial.dial.join() !== baseline.dial.join()) failures.push(`${width}x${height}: dial scaled`)
      if (initial.readout.join() !== baseline.readout.join()) failures.push(`${width}x${height}: readout scaled`)
      if (!initial.scale || Object.values(initial.scale).some((value) => Math.abs(value - 1) > 1e-6))
        failures.push(`${width}x${height}: panel world scale is not 1`)

      const focusSelectors = [
        ...['complexity', 'chroma', 'hue', 'layers', 'palette', 'speed'].map(
          (key) => `[data-munari-anchor="knob:${key}"]`,
        ),
        '[data-munari-anchor="toggle:power"]',
        '[data-munari-anchor="toggle:mirror"]',
        '[data-munari-anchor="panel:carry"]',
        '[data-munari-anchor="panel:resize"]',
      ]
      for (const selector of focusSelectors) {
        const visible = await page.evaluate(async (target) => {
          const element = document.querySelector(target)
          element.focus()
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          const key = element.dataset.munariAnchor
          const probe = window.__knobsResizeProbe.snapshot()
          const anchor = probe.anchors.anchors[key]
          const panel = document.querySelector('.knb-panel').getBoundingClientRect()
          const scroll = document.querySelector('.knb-page')
          const inset = 26
          const overflowX = scroll.scrollWidth > scroll.clientWidth
          const overflowY = scroll.scrollHeight > scroll.clientHeight
          const panelLeft = overflowX ? inset : innerWidth - inset - panel.width
          const panelTop = overflowY ? inset : (innerHeight - panel.height) / 2
          const left = panelLeft + anchor.uMin * panel.width - scroll.scrollLeft
          const right = panelLeft + anchor.uMax * panel.width - scroll.scrollLeft
          const top = panelTop + (1 - anchor.vMax) * panel.height - scroll.scrollTop
          const bottom = panelTop + (1 - anchor.vMin) * panel.height - scroll.scrollTop
          return {
            focused: document.activeElement === element,
            visible:
              (left + right) / 2 >= -1 &&
              (left + right) / 2 <= innerWidth + 1 &&
              (top + bottom) / 2 >= -1 &&
              (top + bottom) / 2 <= innerHeight + 1,
          }
        }, selector)
        if (!visible.focused || !visible.visible)
          failures.push(`${width}x${height}: ${selector} is not focus-reachable`)
      }

      // Dial keyboard contract: Home/End, ten-step Page Down, and one-step Arrow Up.
      const hue = '[data-munari-anchor="knob:hue"]'
      await page.focus(hue)
      await page.keyboard.press('End')
      await page.keyboard.press('PageDown')
      await page.keyboard.press('ArrowUp')
      const hueValue = await page.$eval(hue, (element) => Number(element.getAttribute('aria-valuenow')))
      if (hueValue !== 270) failures.push(`${width}x${height}: dial keyboard value ${hueValue}`)

      // Resize uses the same transaction. End must preserve 560 logical px and pin the grip.
      const resize = '[data-munari-anchor="panel:resize"]'
      await page.focus(resize)
      await page.keyboard.press('End')
      await page.waitForFunction(() => document.querySelector('.knb-panel').getBoundingClientRect().width === 560)
      await frames(page, 8)
      const grown = await page.evaluate(() => {
        const panel = document.querySelector('.knb-panel').getBoundingClientRect()
        const scroll = document.querySelector('.knb-page')
        const anchor = window.__knobsResizeProbe.snapshot().anchors.anchors['panel:resize']
        const panelLeft = 26
        const right = panelLeft + anchor.uMax * panel.width - scroll.scrollLeft
        return {
          width: panel.width,
          pinned: Math.abs(scroll.scrollLeft - (scroll.scrollWidth - scroll.clientWidth)) <= 1,
          gripVisible: right <= innerWidth + 1 && right >= 0,
        }
      })
      if (grown.width !== 560 || !grown.pinned || !grown.gripVisible)
        failures.push(`${width}x${height}: wide resize did not keep the grip visible`)

      // Focus reveals hue, then a real pointer drag must still reach that DOM dial after scrolling.
      await page.focus(hue)
      await frames(page, 4)
      const before = await page.$eval(hue, (element) => Number(element.getAttribute('aria-valuenow')))
      const point = await page.evaluate(() => window.__knobsResizeProbe.snapshot().projectedHue)
      await page.mouse.move(point.x, point.y)
      await page.mouse.down()
      await page.mouse.move(point.x, point.y - 24, { steps: 4 })
      await page.mouse.up()
      await frames(page, 3)
      const after = await page.$eval(hue, (element) => Number(element.getAttribute('aria-valuenow')))
      if (after === before) failures.push(`${width}x${height}: pointer UV missed hue after scroll`)

      // A larger glass removes overflow but keeps the logical width.
      await page.setViewport({ width: 1000, height: 900, deviceScaleFactor: 1 })
      await frames(page, 8)
      const large = await page.evaluate(() => {
        const panel = document.querySelector('.knb-panel').getBoundingClientRect()
        const scroll = document.querySelector('.knb-page')
        return {
          width: panel.width,
          overflowX: scroll.scrollWidth > scroll.clientWidth,
          overflowY: scroll.scrollHeight > scroll.clientHeight,
        }
      })
      if (large.width !== 560 || large.overflowX || large.overflowY)
        failures.push(`${width}x${height}: large viewport changed width or kept overflow`)
      if (pageErrors.length) failures.push(`${width}x${height}: ${pageErrors.join('; ')}`)
      await page.close()
      console.log(
        `knobs-viewport ${width}x${height}: focus, keyboard, scroll, pointer, and 1:1 scale checked`,
      )
    }

    if (failures.length) {
      throw new Error(`${failures.length} Knobs viewport failures:\n${failures.map((failure) => `  ${failure}`).join('\n')}`)
    }
    console.log('\nknobs-viewport gate PASSED')
  }
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
