// restore-flash — can a docked window paint at its desk position before the
// sheet that is supposed to carry it there?
//
// The fault, measured 2026-09-12 in Chrome 151 on both engines: a dock
// restore lifts the Surface while the store still holds the page, which is
// the warm-ride state — the live DOM moves into the parked host and the host
// is made visible over the page copy so the caret and selection stay real.
// That copy is normally showing, so the ride is invisible. A docked genie
// window's copy is hidden by the scene itself (`data-away`), and the ride
// guard read `holder.hidden` — a property CSS never touches — so the window
// painted at its desk rect for 2 frames (html-in-canvas, ~12-29ms) and 2-3
// frames (snapDOM, ~21-41ms) before the drain even started. The desk rect
// changed by 98.8% of its pixels in those frames.
//
// State cannot see this: `data-away` stays 'true' and the page copy stays
// `visibility: hidden` throughout. Only the compositor's own frames show it,
// which is why this gate reads a screencast and not the DOM.
//
// The gate also requires the sheet to still arrive, because "no flash" alone
// would be true of a build that never lifts at all. The law that replaced the
// guard — an unfocused source keeps its live node on the page while the page is
// the one showing — is checked by `probe:api-regressions`, whose fixture withholds
// a required presenter so preparation can be observed without racing a crossing. This
// scene crosses in about three frames, which is too fast to tell "never
// swapped" from "swapped once the scene took over".
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
import { IncompleteScreencastError, installScreencastClock, requireScreencastCoverage } from '../screencastCoverage.ts'

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
if (!CHROME) throw new Error('restore-flash: Chrome was not found; set CHROME_PATH')
const HEADED = process.env.HEADED === '1'
const SLOWCPU = Number(process.env.SLOWCPU ?? 1)
// The window under test is a study pattern: no video, no bouncing marks, so
// every pixel that changes in its rect is the handoff and not its content.
const WIN = 'quadrato'
const ROUNDS = Number(process.env.ROUNDS ?? 3)
if (!Number.isInteger(ROUNDS) || ROUNDS < 1) throw new Error('ROUNDS must be a positive integer')
const CAPTURE_FORMAT = process.env.RESTORE_CAPTURE_FORMAT ?? 'jpeg'
if (!['jpeg', 'png'].includes(CAPTURE_FORMAT)) throw new Error('RESTORE_CAPTURE_FORMAT must be jpeg or png')
const FLASH_CONTROL = process.env.RESTORE_FLASH_CONTROL === '1'
const MAX_ATTEMPTS = ROUNDS * 3
const captureOptions = { format: CAPTURE_FORMAT, everyNthFrame: 1, maxWidth: 1100, maxHeight: 800 }
if (CAPTURE_FORMAT === 'jpeg') captureOptions.quality = 100
// The flash lands within ~50ms of the press; the sheet does not reach the
// desk until ~340ms. A window this wide separates the two with room to spare.
const FLASH_WINDOW_MS = 150
const MAX_FRAME_GAP_MS = 20
// Percent of the desk rect that has to change before a frame counts as
// showing the window. The measured flash changes 98.8%; a frame the sheet has
// not reached yet changes 0.0%. Nothing lands in between.
const SHOWN_PCT = 50

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let server
let browser
const problems = []
const deadline = setTimeout(() => {
  console.error('restore-flash: hard 300s deadline hit')
  process.exit(1)
}, 300_000)

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: !HEADED,
    args: [
      '--enable-features=CanvasDrawElement',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  })
  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  for (const mode of ['auto', 'snapdom']) {
    const page = await browser.newPage()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(String(error)))
    await page.setViewport({ width: 1100, height: 800, deviceScaleFactor: 1 })
    const forced = mode === 'snapdom' ? '&capture=snapdom' : ''
    await page.goto(`http://localhost:${port}/?scene=genie&framed${forced}`, { waitUntil: 'load' })
    await page.waitForFunction(
      (win) =>
        document.querySelector(`.gen-slot[data-win="${win}"]`) &&
        document.fonts.status === 'loaded' &&
        window.__munari,
      { timeout: 20_000 },
      WIN,
    )
    await sleep(1000)
    await page.evaluate(installScreencastClock)

    const client = await page.createCDPSession()
    if (SLOWCPU > 1) await client.send('Emulation.setCPUThrottlingRate', { rate: SLOWCPU })

    const setup = await page.evaluate((win) => {
      // The other windows are hidden so the desk rect can only ever show the
      // window under test, the desk, or the sheet carrying it.
      for (const other of document.querySelectorAll(`.gen-slot:not([data-win="${win}"])`))
        other.style.visibility = 'hidden'
      const slot = document.querySelector(`.gen-slot[data-win="${win}"]`)
      window.__flash = {
        slot,
        samples: [],
        // One sample per animation frame: has the live node been taken into the
        // capture host, and is that host painting over the page copy?
        watch(frames) {
          this.samples = []
          return new Promise((resolve) => {
            let seen = 0
            const tick = () => {
              const host = slot.querySelector('[data-munari-parked]')
              const style = host && getComputedStyle(host)
              this.samples.push({
                away: slot.dataset.away ?? null,
                swapped: Boolean(host?.querySelector('[data-api-live]')),
                riding: Boolean(
                  host &&
                    host.style.transform &&
                    (style.visibility === 'visible' ? style.opacity !== '0' : false),
                ),
              })
              if (++seen < frames) requestAnimationFrame(tick)
              else resolve()
            }
            tick()
          })
        },
      }
      return {
        engine: window.__munari.engine(),
        desk: slot.querySelector('.gen-window').getBoundingClientRect().toJSON(),
      }
    }, WIN)

    if (setup.engine !== (mode === 'snapdom' ? 'snapdom' : 'html-in-canvas'))
      problems.push(`${mode}: asked for ${mode} and got the ${setup.engine} engine`)

    if (FLASH_CONTROL) {
      const { x, y, width, height } = setup.desk
      const picture = await page.screenshot({ clip: { x, y, width, height }, encoding: 'base64' })
      await page.evaluate(async ({ picture, desk }) => {
        const image = new Image()
        image.src = `data:image/png;base64,${picture}`
        await image.decode()
        image.style.cssText = `position:fixed;left:${desk.x}px;top:${desk.y}px;width:${desk.width}px;height:${desk.height}px;z-index:2147483646;pointer-events:none;display:none`
        document.body.append(image)
        window.__restoreFlashControl = image
      }, { picture, desk: setup.desk })
    }

    const frames = []
    client.on('Page.screencastFrame', async (frame) => {
      frames.push({ t: frame.metadata.timestamp * 1000, data: frame.data })
      try {
        await client.send('Page.screencastFrameAck', { sessionId: frame.sessionId })
      } catch {
        // The cast can stop between delivery and acknowledgement.
      }
    })

    const press = (selector, flash = false) =>
      page.evaluate(({ sel, flash }) => {
        const at = performance.timeOrigin + performance.now()
        if (flash) {
          window.__restoreFlashControl.style.display = 'block'
          setTimeout(() => { window.__restoreFlashControl.style.display = 'none' }, 40)
        }
        document.querySelector(sel).dispatchEvent(new MouseEvent('click', { bubbles: true }))
        return at
      }, { sel: selector, flash })

    const rounds = []
    let attempts = 0
    for (let attempt = 0; rounds.length < ROUNDS && attempt < MAX_ATTEMPTS; attempt++) {
      attempts++
      // Minimize first, so the window is in its bay to be restored from.
      const minimizeWatch = page.evaluate(() => window.__flash.watch(20))
      await press(`.gen-slot[data-win="${WIN}"] .gen-lamp[data-role="minimize"]`)
      await minimizeWatch
      const minimizeSamples = await page.evaluate(() => window.__flash.samples)
      await page.waitForFunction(
        (win) => document.querySelector(`.gen-tile[data-win="${win}"]`).dataset.filled === 'true',
        { timeout: 20_000 },
        WIN,
      )
      await sleep(600)

      frames.length = 0
      await client.send('Page.startScreencast', captureOptions)
      // Docked frames first: the last one before the press is the reference
      // every later frame is differenced against.
      await sleep(250)
      const restoreWatch = page.evaluate(() => window.__flash.watch(45))
      const pressedAt = await press(`.gen-tile[data-win="${WIN}"]`, FLASH_CONTROL)
      await restoreWatch
      await page.waitForFunction(
        (win) => document.querySelector(`.gen-slot[data-win="${win}"]`).dataset.away !== 'true',
        { timeout: 20_000 },
        WIN,
      )
      await sleep(300)
      await client.send('Page.stopScreencast')
      await sleep(100)
      const restoreSamples = await page.evaluate(() => window.__flash.samples)
      frames.sort((left, right) => left.t - right.t)
      let coverageError = null
      try {
        requireScreencastCoverage(frames, pressedAt, pressedAt + FLASH_WINDOW_MS, MAX_FRAME_GAP_MS)
      } catch (error) {
        if (!(error instanceof IncompleteScreencastError)) throw error
        coverageError = error.message
      }

      const scored = await page.evaluate(
        async (shot, desk, clickAt, flashWindow, shownPct, format) => {
          const read = async (data) => {
            const image = new Image()
            image.src = `data:image/${format};base64,${data}`
            await image.decode()
            const canvas = document.createElement('canvas')
            canvas.width = image.width
            canvas.height = image.height
            const context = canvas.getContext('2d', { willReadFrequently: true })
            context.drawImage(image, 0, 0)
            const sx = image.width / window.innerWidth
            const sy = image.height / window.innerHeight
            return context.getImageData(
              Math.round(desk.left * sx),
              Math.round(desk.top * sy),
              Math.round(desk.width * sx),
              Math.round(desk.height * sy),
            ).data
          }
          const before = shot.filter((frame) => frame.t < clickAt)
          if (!before.length) return null
          const reference = await read(before.at(-1).data)
          let flash = 0
          let sheetAt = null
          for (const frame of shot) {
            const dt = Math.round(frame.t - clickAt)
            if (dt < 0) continue
            const pixels = await read(frame.data)
            let changed = 0
            for (let i = 0; i < pixels.length; i += 4) {
              const delta =
                Math.abs(pixels[i] - reference[i]) +
                Math.abs(pixels[i + 1] - reference[i + 1]) +
                Math.abs(pixels[i + 2] - reference[i + 2])
              if (delta > 30) changed++
            }
            const pct = (100 * changed) / (pixels.length / 4)
            if (pct <= shownPct) continue
            if (dt <= flashWindow) flash++
            else sheetAt ??= dt
          }
          return { flash, sheetAt, frames: shot.length }
        },
        frames.map((frame) => ({ t: frame.t, data: frame.data })),
        setup.desk,
        pressedAt,
        FLASH_WINDOW_MS,
        SHOWN_PCT,
        CAPTURE_FORMAT,
      )

      const rides = [...minimizeSamples, ...restoreSamples].filter((sample) => sample.riding).length
      // Observed faults fail even in an incomplete recording. Only missing
      // evidence is retried, and every required round still needs full coverage.
      const failed = scored && (scored.flash > 0 || scored.sheetAt === null || rides > 0)
      if (failed || pageErrors.length) {
        problems.push(`${setup.engine}: attempt ${attempt + 1}: observed restore failure ${JSON.stringify({ ...scored, rides, pageErrors })}`)
        break
      }
      if (!scored || coverageError) {
        console.warn(`${setup.engine}: recording ${attempt + 1}/${MAX_ATTEMPTS} unverified: ${coverageError ?? 'no reference frame'}`)
        continue
      }
      rounds.push({
        ...scored,
        minimizeSwaps: minimizeSamples.filter((sample) => sample.swapped).length,
        restoreSwaps: restoreSamples.filter((sample) => sample.swapped).length,
        rides,
      })
    }

    if (rounds.length !== ROUNDS)
      problems.push(`${setup.engine}: completed ${rounds.length}/${ROUNDS} verified restores within ${MAX_ATTEMPTS} recording attempts`)

    console.log(`\n  ${setup.engine} · ${rounds.length} verified restores / ${attempts} attempts · ${CAPTURE_FORMAT} · cpu /${SLOWCPU}`)
    for (const round of rounds)
      console.log(
        `    flash frames ${round.flash}  swapped samples minimize ${round.minimizeSwaps} / restore ${round.restoreSwaps}  rides ${round.rides}  sheet at desk ${round.sheetAt ?? 'never'}ms  (${round.frames} compositor frames)`,
      )

    if (pageErrors.length) problems.push(`${setup.engine}: ${pageErrors[0]}`)
    await page.close()
  }
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}

if (problems.length) {
  console.error('\nrestore-flash: FAIL')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('\nrestore-flash: PASS — a dock restore shows nothing at the desk until the sheet gets there')
