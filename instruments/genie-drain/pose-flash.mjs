// pose-flash — does a minimize show one pose of the window's animation, or two?
//
// The fault, measured 2026-09-13 in Chrome 151 on snapDOM: pressing a study
// window's minimize lamp with a real mouse, the page released onto the
// capture from before the lift. The first scene frame showed a dash pattern
// about 10% of the figure's pixels away from the frozen pose, and the demanded
// capture replaced it 20-30 ms later with a second change of about 8%. Every
// minimize did it. The cause was the lift's wait for a current capture being
// bounded by the author's transition timing, which genie sets to 1 ms
// (decisions.md #65, amended).
//
// Only the compositor's frames show this. The page's animations are paused
// and agree with each other throughout; the wrong pose exists only in the
// texture. So this gate reads a screencast of the window's content box and
// counts how many times the picture changes once the page lets go. A correct
// handover changes it once — the page's raster becomes the texture's, 2.03-5.50%
// across 12 minimizes on both engines — and then it holds still until the drain
// moves the window. With the 1 ms wait restored, every snapDOM minimize changed
// it twice (8.76-14.44%, then 6.61-14.16%). HTML-in-canvas did not flash either
// way, so this gate's teeth are on snapDOM.
//
// The press is a real mouse press over a hovered lamp. A scripted `click()`
// skips the hover and the pointerdown that raises the window, and the probes
// that used one missed this fault entirely.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

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
if (!CHROME) throw new Error('pose-flash: Chrome was not found; set CHROME_PATH')
const HEADED = process.env.HEADED === '1'
const ROUNDS = Number(process.env.ROUNDS ?? 3)
// The two windows whose bodies are CSS animations: their dash patterns move
// every frame on the desk, so a stale capture is a visibly different figure.
const WINDOWS = ['cerchio', 'quadrato']
// How long after the page releases the picture is read. The drain first moves
// the window about 110 ms after the release on the measured runs; the flash's
// second change lands within 40 ms of it.
const READ_MS = 80
// Percent of the content box that must change for a frame to count as a
// change. The frozen picture reads 0.00 frame to frame; a correct handover's
// trailing settle reads at most 0.31; the smallest flash change was 6.61.
const CHANGE_PCT = 1

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let server
let browser
const problems = []
const deadline = setTimeout(() => {
  console.error('pose-flash: hard 300s deadline hit')
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
      ...(process.env.CI ? ['--no-sandbox'] : []),
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
      () =>
        document.querySelector('.gen-slot[data-win="cerchio"] .gen-math-pattern') &&
        document.fonts.status === 'loaded' &&
        window.__munari,
      { timeout: 20_000 },
    )
    await sleep(1000)
    const engine = await page.evaluate(() => window.__munari.engine())
    if (engine !== (mode === 'snapdom' ? 'snapdom' : 'html-in-canvas'))
      problems.push(`${mode}: asked for ${mode} and got the ${engine} engine`)

    const client = await page.createCDPSession()
    const frames = []
    client.on('Page.screencastFrame', async (frame) => {
      frames.push({ t: frame.metadata.timestamp * 1000, data: frame.data })
      try {
        await client.send('Page.screencastFrameAck', { sessionId: frame.sessionId })
      } catch {
        // The cast can stop between delivery and acknowledgement.
      }
    })

    for (const win of WINDOWS) {
      const rounds = []
      for (let round = 0; round < ROUNDS; round++) {
        const geometry = await page.evaluate((win) => {
          // Only the window under test is visible, so its box can only ever
          // show that window, the desk, or the sheet carrying it.
          for (const slot of document.querySelectorAll('.gen-slot'))
            slot.style.visibility = slot.dataset.win === win ? '' : 'hidden'
          const slot = document.querySelector(`.gen-slot[data-win="${win}"]`)
          const lamp = slot.querySelector('.gen-lamp[data-role="minimize"]').getBoundingClientRect()
          const figure = slot.querySelector('.gen-math-pattern').getBoundingClientRect()
          const presentation = slot.querySelector('.gen-page-presentation')
          window.__releasedAt = null
          const observer = new MutationObserver(() => {
            if (window.__releasedAt === null && getComputedStyle(presentation).visibility === 'hidden') {
              window.__releasedAt = performance.timeOrigin + performance.now()
              observer.disconnect()
            }
          })
          observer.observe(presentation, { attributes: true, attributeFilter: ['style'] })
          return {
            lamp: { x: lamp.x + lamp.width / 2, y: lamp.y + lamp.height / 2 },
            figure: { x: figure.x, y: figure.y, width: figure.width, height: figure.height },
          }
        }, win)

        await page.mouse.move(geometry.lamp.x + 60, geometry.lamp.y + 80)
        await sleep(150)
        await page.mouse.move(geometry.lamp.x, geometry.lamp.y, { steps: 6 })
        await sleep(500)

        frames.length = 0
        await client.send('Page.startScreencast', {
          format: 'png',
          everyNthFrame: 1,
          maxWidth: 1100,
          maxHeight: 800,
        })
        await sleep(250)
        await page.mouse.down()
        await sleep(50)
        await page.mouse.up()
        await sleep(500)
        await client.send('Page.stopScreencast')
        await sleep(100)
        const releasedAt = await page.evaluate(() => window.__releasedAt)

        const scored =
          releasedAt === null
            ? null
            : await page.evaluate(
                async (shot, box, releasedAt, readMs, changePct) => {
                  const read = async (data) => {
                    const image = new Image()
                    image.src = `data:image/png;base64,${data}`
                    await image.decode()
                    const canvas = document.createElement('canvas')
                    canvas.width = image.width
                    canvas.height = image.height
                    const context = canvas.getContext('2d', { willReadFrequently: true })
                    context.drawImage(image, 0, 0)
                    const sx = image.width / window.innerWidth
                    const sy = image.height / window.innerHeight
                    return context.getImageData(
                      Math.round(box.x * sx),
                      Math.round(box.y * sy),
                      Math.round(box.width * sx),
                      Math.round(box.height * sy),
                    ).data
                  }
                  const before = shot.filter((frame) => frame.t < releasedAt)
                  const after = shot.filter((frame) => frame.t >= releasedAt && frame.t <= releasedAt + readMs)
                  if (!before.length || !after.length) return null
                  let previous = await read(before.at(-1).data)
                  const changes = []
                  for (const frame of after) {
                    const pixels = await read(frame.data)
                    let changed = 0
                    for (let i = 0; i < pixels.length; i += 4) {
                      const delta =
                        Math.abs(pixels[i] - previous[i]) +
                        Math.abs(pixels[i + 1] - previous[i + 1]) +
                        Math.abs(pixels[i + 2] - previous[i + 2])
                      if (delta > 40) changed++
                    }
                    const pct = (100 * changed) / (pixels.length / 4)
                    if (pct > changePct) changes.push(Number(pct.toFixed(2)))
                    previous = pixels
                  }
                  return { changes, frames: after.length }
                },
                frames.map((frame) => ({ t: frame.t, data: frame.data })),
                geometry.figure,
                releasedAt,
                READ_MS,
                CHANGE_PCT,
              )

        if (!scored) {
          problems.push(`${engine} ${win}: round ${round} had no release or no frames around it`)
        } else {
          rounds.push(scored)
        }

        // The minimize has to finish, or a build that never lifted would pass.
        await page.waitForFunction(
          (win) => document.querySelector(`.gen-tile[data-win="${win}"]`)?.dataset.filled === 'true',
          { timeout: 20_000 },
          win,
        )
        await sleep(600)
        await page.evaluate((win) => {
          document
            .querySelector(`.gen-tile[data-win="${win}"]`)
            .dispatchEvent(new MouseEvent('click', { bubbles: true }))
        }, win)
        await page.waitForFunction(
          (win) => document.querySelector(`.gen-slot[data-win="${win}"]`).dataset.away !== 'true',
          { timeout: 20_000 },
          win,
        )
        await sleep(1000)
      }

      console.log(`\n  ${engine} · ${win} · ${rounds.length} minimizes`)
      for (const round of rounds)
        console.log(`    changes after release ${JSON.stringify(round.changes)}  (${round.frames} frames)`)
      const flashed = rounds.filter((round) => round.changes.length > 1)
      if (flashed.length)
        problems.push(
          `${engine} ${win}: ${flashed.length}/${rounds.length} minimizes changed the figure more than once within ${READ_MS}ms of the release`,
        )
    }
    if (pageErrors.length) problems.push(`${engine}: ${pageErrors[0]}`)
    await page.close()
  }
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}

if (problems.length) {
  console.error('\npose-flash: FAIL')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('\npose-flash: PASS — a minimize shows the frozen pose, handed over once')
