// genie-drain probe — drives the genie scene's whole custody cycle with
// a real pointer and turns each leg into a pass/fail observable. The
// scene's claim is that every stage of the old minimize movie is a place
// a hand can enter; this instrument enters at each of them:
//
//   B  clock minimize   amber lamp → page copy yields (painted swap),
//                       then the dock tile swells shut around it
//                       (docked custody)
//   C  clock restore    tile click → window visible again, tile unlit —
//                       then TYPE into it, proving the round trip landed
//                       on live DOM, not a picture of it
//   D  grab minimize    slow drag of the titlebar past the commit point,
//                       a beat of stillness (velocity estimate decays),
//                       release → position commits it to the dock
//   E  grab restore     slow drag UP from the dock tile itself, release
//                       low → position commits it home
//   F  the catch        slow-motion lamp flight, then a press on the
//                       airborne titlebar and a fast upward throw. Only
//                       a caught sheet can land RESTING — the untouched
//                       clock lands docked — so the final state alone
//                       proves the catch engaged.
//
// Observables are DOM truths, not pixels: the page copy's visibility
// (custody), the tile's data-filled flip (phase), the tile's own
// transform (DOMMatrix m11/m22 > 1.05 — the container actually swelled
// around what it caught, not just a class flip), the input's value
// after typing (the window is still real). Screenshots are saved for
// the human, with captureBeyondViewport:false — the veil probe paid for
// the lesson that the default clipped capture reflows the page.
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const labRoot = path.join(repoRoot, 'apps', 'lab')
const OUT = process.env.PROBE_OUT ?? path.join(here, 'out')

const W = 1100
const H = 800

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean)

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chromePath) {
  console.error('genie-drain probe: no Chrome executable found (set CHROME_PATH)')
  process.exit(1)
}

const LAUNCH_ARGS = [
  '--enable-features=CanvasDrawElement',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function probeCapability(browser) {
  const page = await browser.newPage()
  const capable = await page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d')
    return typeof ctx.drawElementImage === 'function'
  })
  await page.close()
  return capable
}

async function launch(headless) {
  return puppeteer.launch({ executablePath: chromePath, headless, args: LAUNCH_ARGS })
}

let server
let browser
const deadline = setTimeout(() => {
  console.error('genie-drain probe: hard 120s deadline hit')
  process.exit(1)
}, 120_000)

try {
  browser = await launch(true)
  let capable = await probeCapability(browser)
  if (!capable) {
    await browser.close()
    browser = await launch(false)
    capable = await probeCapability(browser)
    if (capable) console.log('genie-drain: capability present headed only — measuring headed')
  }
  if (!capable) {
    console.error(`genie-drain probe: Chrome at ${chromePath} has no drawElementImage`)
    process.exit(1)
  }

  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  mkdirSync(OUT, { recursive: true })
  const page = await browser.newPage()
  const pageProblems = []
  page.on('pageerror', (err) => pageProblems.push(String(err)))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
      pageProblems.push(m.text())
  })

  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:${port}/?scene=genie`, { waitUntil: 'load' })
  await page.waitForFunction(
    () => document.querySelector('.gen-sheet[data-win="scheda"] .gen-window') && document.fonts.status === 'loaded',
    { timeout: 15_000 },
  )
  await sleep(300)

  const shot = (name) =>
    page.screenshot({
      path: path.join(OUT, `${name}.png`),
      clip: { x: 0, y: 0, width: W, height: H },
      captureBeyondViewport: false,
    })

  // Docked now means SWOLLEN, not merely flipped: data-filled is a class
  // the swap frame could set a beat before the tile has actually grown,
  // so the observable reads the tile's own transform (written per-frame
  // by Driver, genieDock.ts's dockPose) via DOMMatrix — m11/m22 both
  // above 1.05 is unreachable at rest (swell tops out at 1.10) and
  // survives the landing ring's squash-and-stretch (which pushes the two
  // axes in opposite directions, not both down at once).
  const waitDocked = () =>
    page.waitForFunction(
      () => {
        const el = document.querySelector('.gen-slot[data-win="scheda"]')
        const tile = document.querySelector('.gen-tile[data-win="scheda"]')
        if (tile.dataset.filled !== 'true') return false
        if (el.dataset.away !== 'true') return false
        const m = new DOMMatrix(getComputedStyle(tile).transform)
        return m.m11 > 1.05 && m.m22 > 1.05
      },
      { timeout: 8000 },
    )
  const waitResting = () =>
    page.waitForFunction(
      () => {
        const el = document.querySelector('.gen-slot[data-win="scheda"]')
        const tile = document.querySelector('.gen-tile[data-win="scheda"]')
        if (el.dataset.away === 'true') return false
        if (tile.dataset.filled !== 'false') return false
        const m = new DOMMatrix(getComputedStyle(tile).transform)
        return m.m11 < 1.02 && m.m22 < 1.02
      },
      { timeout: 8000 },
    )

  const rects = async () =>
    page.evaluate(() => {
      const r = (sel) => {
        const b = document.querySelector(sel).getBoundingClientRect()
        return { x: b.left + b.width / 2, y: b.top + b.height / 2, left: b.left, top: b.top, w: b.width, h: b.height }
      }
      return {
        lamp: r('.gen-sheet[data-win="scheda"] .gen-lamp[data-role="minimize"]'),
        tile: r('.gen-tile[data-win="scheda"]'),
        bar: r('.gen-sheet[data-win="scheda"] .gen-titlebar'),
        win: r('.gen-slot[data-win="scheda"]'),
      }
    })

  // A drag whose release is a POSITION, not a flick: slow steps, then a
  // beat of stillness so the velocity estimate (τ = 35ms) decays to ~0.
  const dragGentle = async (x, y0, y1, steps = 12) => {
    await page.mouse.move(x, y0)
    await page.mouse.down()
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(x, y0 + ((y1 - y0) * i) / steps)
      await sleep(50)
    }
    await sleep(200)
    await page.mouse.up()
  }
  // A throw: the travel happens fast enough that release velocity is way
  // past the commit threshold, and direction decides the fate.
  const dragFlick = async (x, y0, y1, steps = 6) => {
    await page.mouse.move(x, y0)
    await page.mouse.down()
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(x, y0 + ((y1 - y0) * i) / steps)
      await sleep(8)
    }
    await page.mouse.up()
  }

  const isFilled = () =>
    page.evaluate(
      () => document.querySelector('.gen-tile[data-win="scheda"]').dataset.filled === 'true',
    )
  // Failed legs must not cascade: put the app back at rest before a leg
  // that needs it, and fail fast on a leg whose precondition is gone.
  const ensureResting = async () => {
    if (await isFilled()) {
      await page.mouse.click(r.tile.x, r.tile.y)
      await waitResting()
      await sleep(150)
    }
  }

  const results = []
  const stage = async (name, fn) => {
    const t0 = Date.now()
    try {
      await fn()
      results.push({ name, ok: true, ms: Date.now() - t0 })
      console.log(`ok   ${name} (${Date.now() - t0}ms)`)
    } catch (err) {
      results.push({ name, ok: false, ms: Date.now() - t0, err: String(err) })
      console.log(`FAIL ${name} (${Date.now() - t0}ms): ${err}`)
      await shot(`fail-${name.replace(/\s+/g, '-')}`)
    }
  }

  let r = await rects()
  const grip = { x: r.bar.left + r.bar.w * 0.65, y: r.bar.top + r.bar.h / 2 }

  await stage('clock minimize docks', async () => {
    await page.mouse.click(r.lamp.x, r.lamp.y)
    await waitDocked()
    await shot('b-docked')
  })

  await stage('clock restore lands and the window is still real', async () => {
    await page.mouse.click(r.tile.x, r.tile.y)
    await waitResting()
    await sleep(150)
    await page.click('.gen-field')
    await page.type('.gen-field', 'probe')
    const val = await page.$eval('.gen-field', (el) => el.value)
    if (!val.endsWith('probe')) throw new Error(`typed into a ghost: field reads "${val}"`)
    await shot('c-restored')
  })

  await stage('titlebar drag past the commit point docks it', async () => {
    r = await rects()
    // Carry the midline 75% of the way to the dock mouth — well past
    // commitT — then release from stillness: position decides.
    const drop = (r.tile.top - r.win.y) * 0.75
    await dragGentle(grip.x, grip.y, grip.y + drop)
    await waitDocked()
    await shot('d-grab-docked')
  })

  await stage('dock tile drag up pours it home', async () => {
    if (!(await isFilled())) throw new Error('precondition lost: not docked')
    // Grip the tile's center — the tile itself is the grab target now,
    // no separate quad floating over it — and carry it 70% back up,
    // release low: position commits to rest.
    const rise = (r.tile.top - r.win.y) * 0.7
    await dragGentle(r.tile.x, r.tile.y, r.tile.y - rise)
    await waitResting()
    await shot('e-poured-back')
  })

  await stage('a slow-motion flight can be caught and thrown home', async () => {
    await ensureResting()
    // Shift = the 2001 easter egg, 6× slow. 400ms in, the eased top edge
    // has not left rest yet — the airborne titlebar sits where the page
    // one was. Press it, throw upward. The untouched clock would land
    // DOCKED at ~3.7s; landing RESTING is only reachable via the catch.
    await page.keyboard.down('Shift')
    await page.mouse.click(r.lamp.x, r.lamp.y)
    await page.keyboard.up('Shift')
    await sleep(400)
    await dragFlick(grip.x, grip.y, grip.y - 160)
    await waitResting()
    await shot('f-caught-home')
  })

  const failed = results.filter(x => !x.ok)
  if (pageProblems.length) {
    console.log(`\npage problems (${pageProblems.length}):`)
    for (const p of pageProblems.slice(0, 10)) console.log(`  ${p}`)
  }
  const verdict = failed.length === 0 && pageProblems.length === 0
  console.log(`\ngenie-drain: ${verdict ? 'ALL LEGS PASS' : `${failed.length} leg(s) failed, ${pageProblems.length} page problem(s)`}`)
  process.exit(verdict ? 0 : 1)
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
