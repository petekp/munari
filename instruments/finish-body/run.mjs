// Finish body probe — does a finish card ever show the page behind it while
// its Surface moves between the page and the scene?
//
// The law (decisions.md #79): a finish's body color is `--munari-body` on the
// page element and `transparent` on the capture root, except while the
// capture root stands in for the page copy, when it holds the color. Every
// frame of a handoff then shows the card's body, on the page or lit in the
// scene. The fault, m2 2026-11-26: with `transparent` in the stand-in state,
// a lift with a focused field showed the page behind the card for 4 frames on
// the native path.
//
// Each case runs on a fresh page. It gives the settings card a saturated green
// body and records the handoff with a screencast. It then reads a band of the
// card's top padding, where no content sits, in every recorded image. An image
// whose band is mostly the page ground color fails. Before the cases, each
// engine shows a ground-colored patch over the band for one page frame, and
// the recording must catch it. A recording that skips a page frame is
// unverified and retried, up to three times.
//
// The cases: the page takes over, a lift, a field focused on the page and
// then lifted, a body color change in the scene, and a renderer loss after a
// return. A last page clicks a button, a segment and a play control through
// the scene and types into a field, and checks each result in the DOM.
//
// Limits: the band covers one card edge. It does not judge text, other
// cards, or a lit body that drifts toward the ground color without matching it.
//
// Ownership: the lab's finish-demo scene owns the page; this probe owns the
// recording and its judgment. It is a local probe, not in CI (README.md).
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
import { IncompleteScreencastError, requirePageFrameCoverage } from '../screencastCoverage.ts'
import { createScreencastRecorder, scoreScreencast } from '../screencastRecording.ts'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const labRoot = path.join(repoRoot, 'apps', 'lab')
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]
  .filter(Boolean)
  .find((candidate) => existsSync(candidate))
if (!CHROME) throw new Error('finish-body: Chrome was not found; set CHROME_PATH')
const HEADED = process.env.HEADED === '1'
const ENGINES = (process.env.FINISH_BODY_ENGINES ?? 'auto,snapdom').split(',')

// A green and a blue far from the light page ground (about rgb(244, 242, 238)),
// so a lit body never reads as the ground and the ground always does.
const BODY = '#2e7d32'
const CHANGED_BODY = '#1565c0'
// A band pixel matches the ground when its summed RGB distance from the ground
// is at most this. JPEG at quality 100 moves a flat color by under 10.
const GROUND_DISTANCE = 40
// An image shows the ground when more than half its band matches it. A
// missing body matches about 100%; a body on the page or in the scene, 0%.
const SHOWN_FRACTION = 0.5
const ATTEMPTS = 3
const captureOptions = { format: 'jpeg', quality: 100, everyNthFrame: 1, maxWidth: 1440, maxHeight: 900 }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const now = (page) => page.evaluate(() => performance.timeOrigin + performance.now())
const problems = []
let server
let browser
const deadline = setTimeout(() => {
  console.error('finish-body: hard 600s deadline hit')
  browser?.process()?.kill('SIGKILL')
  process.exit(1)
}, 600_000)

// ── page setup ─────────────────────────────────────────────────────────

// Wraps WebGPU device creation so a case can lose every device on demand.
function installDeviceLoss() {
  const gpu = navigator.gpu
  if (!gpu) return
  const requestAdapter = gpu.requestAdapter.bind(gpu)
  gpu.requestAdapter = async (...args) => {
    const adapter = await requestAdapter(...args)
    if (!adapter) return adapter
    const requestDevice = adapter.requestDevice.bind(adapter)
    adapter.requestDevice = async (...deviceArgs) => {
      const device = await requestDevice(...deviceArgs)
      let lose
      const lost = new Promise((resolve) => { lose = resolve })
      Object.defineProperty(device, 'lost', { value: lost })
      window.__loseDevices = [...(window.__loseDevices ?? []), () => { lose({ reason: 'unknown', message: 'finish-body probe' }); device.destroy() }]
      return device
    }
    return adapter
  }
}

async function openBench(port, engine) {
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(installDeviceLoss)
  const forced = engine === 'snapdom' ? '&capture=snapdom' : ''
  await page.goto(`http://localhost:${port}/?scene=finish-demo${forced}`, { waitUntil: 'load' })
  await page.waitForFunction(
    () => document.querySelector('.fd-grid [data-context="settings"]') && document.fonts.status === 'loaded' && window.__munari,
    { timeout: 20_000 },
  )
  await page.mouse.move(2, 2)
  await sleep(2500)
  const actual = await page.evaluate(() => window.__munari.engine())
  const expected = engine === 'snapdom' ? 'snapdom' : 'html-in-canvas'
  if (actual !== expected) throw new Error(`asked for ${engine} and got the ${actual} engine`)
  await page.evaluate(() => [...document.querySelectorAll('.fd-rail--controls .fd-finish')].find((b) => b.textContent.includes('Settings form')).click())
  await setBody(page, BODY)
  await sleep(1500)
  return { page, pageErrors, engine: actual }
}

const setBody = (page, color) => page.evaluate((value) => {
  const input = document.querySelector('.fd-color input[type="color"]')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}, color)

const clickButton = (page, label) => page.evaluate((text) => {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
  if (!button) throw new Error(`no button "${text}"`)
  button.click()
}, label)

// The page copy is the card outside the capture host; it hides while the scene presents.
const inScene = (page) => page.evaluate(() => {
  const copy = [...document.querySelectorAll('.fd-grid [data-context="settings"] .fd-card--settings')].find((card) => !card.closest('[data-munari-source-host]'))
  return copy !== undefined && getComputedStyle(copy).visibility === 'hidden'
})

// The settings card's top padding, inside its corner radii, and the page ground.
const bandOf = (page) => page.evaluate(() => {
  const slot = document.querySelector('.fd-grid [data-context="settings"]')
  const card = slot.querySelector('.fd-card--settings') ?? slot
  const style = getComputedStyle(card)
  const rect = slot.getBoundingClientRect()
  const inset = Math.max(parseFloat(style.borderTopLeftRadius), parseFloat(style.borderTopRightRadius), 8) + 4
  const height = Math.min(parseFloat(style.paddingTop), 14) - 4
  const ground = getComputedStyle(document.querySelector('.fd-page')).backgroundColor.match(/\d+/g).slice(0, 3).map(Number)
  return { x: rect.left + inset, y: rect.top + 3, width: rect.width - 2 * inset, height, ground }
})

// ── recording ──────────────────────────────────────────────────────────

// Runs in the page: the fraction of the band within GROUND_DISTANCE of the ground.
function createBandScorer(_reference, { band, distance }) {
  return {
    inspect(image) {
      const sx = image.width / window.innerWidth
      const sy = image.height / window.innerHeight
      const pixels = image.ctx.getImageData(Math.round(band.x * sx), Math.round(band.y * sy), Math.round(band.width * sx), Math.max(1, Math.round(band.height * sy))).data
      let near = 0
      for (let i = 0; i < pixels.length; i += 4) {
        const d = Math.abs(pixels[i] - band.ground[0]) + Math.abs(pixels[i + 1] - band.ground[1]) + Math.abs(pixels[i + 2] - band.ground[2])
        if (d <= distance) near++
      }
      return { ground: near / (pixels.length / 4) }
    },
    summarize: () => null,
  }
}

// Records `action`, then `settleMs`, and scores every image from the action on.
async function record(page, action, settleMs) {
  const band = await bandOf(page)
  if (band.width < 40 || band.height < 2) throw new Error(`the settings card has no usable padding band: ${JSON.stringify(band)}`)
  const recorder = await createScreencastRecorder(page, captureOptions)
  try {
    await recorder.start()
    await sleep(250)
    const start = await now(page)
    await action()
    await sleep(settleMs)
    const end = await now(page)
    const capture = await recorder.stop({ through: end, timeoutMs: 5000 })
    const firstBefore = capture.frames.findLast((frame) => frame.t <= start)
    const selected = capture.frames.filter((frame) => frame.t >= (firstBefore?.t ?? start))
    const scored = await scoreScreencast(page, capture, {
      selectedIndices: selected.map((frame) => frame.index),
      context: { band, distance: GROUND_DISTANCE },
      createScorer: createBandScorer,
    })
    const rows = scored.rows.map((row) => ({ t: row.t, pageFrame: row.pageFrame, ground: row.value?.ground ?? null }))
    let unverified = null
    try {
      requirePageFrameCoverage(rows, start, end)
    } catch (error) {
      if (!(error instanceof IncompleteScreencastError)) throw error
      unverified = error.message
    }
    const shown = rows.filter((row) => row.ground !== null && row.ground > SHOWN_FRACTION)
    return { images: rows.length, groundImages: shown.length, worst: Math.max(0, ...rows.map((row) => row.ground ?? 0)), unverified, start }
  } finally {
    await recorder.dispose()
  }
}

// ── cases ──────────────────────────────────────────────────────────────

const toPage = async (page) => {
  await clickButton(page, 'Show page HTML')
  await sleep(1500)
}

const CASES = [
  {
    name: 'control: ground over the band for one page frame',
    control: true,
    run: (page) => record(page, () => page.evaluate(async () => {
      const slot = document.querySelector('.fd-grid [data-context="settings"]')
      const rect = slot.getBoundingClientRect()
      const patch = document.createElement('div')
      patch.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;z-index:2147483646;pointer-events:none;background:${getComputedStyle(document.querySelector('.fd-page')).backgroundColor}`
      document.body.append(patch)
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      patch.remove()
    }), 500),
  },
  {
    name: 'the page takes over',
    run: (page) => record(page, () => clickButton(page, 'Show page HTML'), 1500),
    after: async (page) => (await inScene(page)) ? 'the card still presents in the scene' : null,
  },
  {
    name: 'a lift',
    before: toPage,
    run: (page) => record(page, () => clickButton(page, 'Show finishes'), 2500),
    after: async (page) => (await inScene(page)) ? null : 'the card did not return to the scene',
  },
  {
    name: 'a field focused on the page, then lifted',
    before: toPage,
    run: (page) => record(page, async () => {
      await page.evaluate(() => document.querySelector('.fd-grid [data-context="settings"] input[type="text"]').focus())
      await sleep(800)
      await clickButton(page, 'Show finishes')
    }, 2500),
    after: async (page) => {
      const focused = await page.evaluate(() => document.activeElement?.closest('.fd-grid [data-context="settings"]') !== null && document.activeElement?.matches('input[type="text"]'))
      return focused ? null : 'the field lost focus in the lift'
    },
  },
  {
    name: 'a body color change in the scene',
    run: (page) => record(page, () => setBody(page, CHANGED_BODY), 1500),
  },
  {
    name: 'a return, then renderer loss',
    run: (page) => record(page, async () => {
      await clickButton(page, 'Show page HTML')
      await sleep(1500)
      await clickButton(page, 'Show finishes')
      await sleep(2000)
      await page.evaluate(() => { for (const lose of window.__loseDevices ?? []) lose() })
    }, 3000),
    lossExpected: true,
  },
]

async function runCase(port, engine, testCase) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const { page, pageErrors } = await openBench(port, engine)
    try {
      await testCase.before?.(page)
      const result = await testCase.run(page)
      const late = await testCase.after?.(page) ?? null
      const errors = testCase.lossExpected ? [] : pageErrors
      // A ground image is evidence even in an incomplete recording; only a
      // recording that saw none and skipped a page frame is retried.
      if (result.groundImages > 0 || !result.unverified) return { ...result, late, errors }
      console.warn(`  ${engine} · ${testCase.name}: attempt ${attempt} unverified: ${result.unverified}`)
    } finally {
      await page.close()
    }
  }
  return { unverified: `no verified recording in ${ATTEMPTS} attempts` }
}

async function clickChecks(port, engine) {
  const { page, pageErrors } = await openBench(port, engine)
  try {
    const clickAt = async (selector) => {
      const point = await page.evaluate((s) => {
        const element = [...document.querySelectorAll(s)].find((e) => e.closest('.fd-grid'))
        const r = element.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      }, selector)
      await page.mouse.click(point.x, point.y)
      await sleep(400)
    }
    const read = (selector, prop) => page.evaluate((s, p) => [...document.querySelectorAll(s)].filter((e) => e.closest('.fd-grid')).map((e) => e[p]), selector, prop)
    const failures = []
    const bag = await read('.fd-card--product .mf-button', 'textContent')
    await clickAt('.fd-card--product .mf-button')
    const bagAfter = await read('.fd-card--product .mf-button', 'textContent')
    if (bagAfter.join() === bag.join()) failures.push(`the product button did not respond: ${bag} -> ${bagAfter}`)
    const readout = await read('.fd-card--tile .mf-readout', 'textContent')
    await clickAt('.fd-card--tile .mf-segment:nth-child(2)')
    const readoutAfter = await read('.fd-card--tile .mf-readout', 'textContent')
    if (readoutAfter.join() === readout.join()) failures.push(`the segment did not change the readout: ${readout}`)
    const play = await read('.fd-card--media .fd-play', 'textContent')
    await clickAt('.fd-card--media .fd-play')
    const playAfter = await read('.fd-card--media .fd-play', 'textContent')
    if (playAfter.join() === play.join()) failures.push(`the play control did not toggle: ${play}`)
    await clickAt('.fd-card--settings input[type="text"]')
    await page.keyboard.type(' 2')
    const typed = await read('.fd-card--settings input[type="text"]', 'value')
    if (!typed.some((value) => value.endsWith(' 2'))) failures.push(`typing did not reach the field: ${typed}`)
    return { failures, errors: pageErrors, observed: { bagAfter, readoutAfter, playAfter, typed } }
  } finally {
    await page.close()
  }
}

// ── run ────────────────────────────────────────────────────────────────

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: !HEADED,
    args: [
      ...WEBGPU_CHROME_ARGS,
      '--enable-features=CanvasDrawElement',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })
  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  for (const engine of ENGINES) {
    console.log(`\n  ${engine}`)
    for (const testCase of CASES) {
      const result = await runCase(port, engine, testCase)
      const line = `${testCase.name}: ${result.groundImages ?? '?'} of ${result.images ?? '?'} images show the ground (worst band ${((result.worst ?? 0) * 100).toFixed(1)}%)`
      console.log(`    ${line}${result.unverified ? ` · unverified: ${result.unverified}` : ''}`)
      if (testCase.control) {
        if (!(result.groundImages > 0)) problems.push(`${engine}: the control's one-frame ground patch was not seen`)
        continue
      }
      if (result.groundImages > 0) problems.push(`${engine}: ${line}`)
      else if (result.unverified) problems.push(`${engine}: ${testCase.name}: ${result.unverified}`)
      if (result.late) problems.push(`${engine}: ${testCase.name}: ${result.late}`)
      if (result.errors?.length) problems.push(`${engine}: ${testCase.name}: page error ${result.errors[0]}`)
    }
    const clicks = await clickChecks(port, engine)
    console.log(`    clicks through the scene: ${clicks.failures.length === 0 ? 'ok' : clicks.failures.join('; ')} ${JSON.stringify(clicks.observed)}`)
    for (const failure of clicks.failures) problems.push(`${engine}: ${failure}`)
    if (clicks.errors.length) problems.push(`${engine}: clicks: page error ${clicks.errors[0]}`)
  }
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}

if (problems.length) {
  console.error(`\nfinish-body: FAIL\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log('\nfinish-body: ok')
