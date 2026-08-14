// Genie same-size film-anchor reorder gate.
import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]
  .filter(Boolean)
  .find((candidate) => existsSync(candidate))
if (!chromePath) throw new Error('film-anchor-reorder: Chrome was not found; set CHROME_PATH')

let browser
let server
const deadline = setTimeout(() => {
  console.error('film-anchor-reorder: hard 60s deadline hit')
  process.exit(1)
}, 60_000)

try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--enable-features=CanvasDrawElement',
      '--disable-renderer-backgrounding',
      '--autoplay-policy=no-user-gesture-required',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })
  server = await createServer({ root: 'apps/lab', logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.setViewport({ width: 1100, height: 800, deviceScaleFactor: 1 })
  await page.goto(
    `http://localhost:${port}/?scene=genie&probe=genie-film-reorder`,
    { waitUntil: 'load' },
  )
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('[data-genie-film-role="canvas"]')
      return (
        canvas instanceof HTMLCanvasElement &&
        canvas.dataset.genieFilmReady === 'true' &&
        Number(canvas.dataset.genieFilmGeneration) > 0
      )
    },
    { timeout: 20_000 },
  )

  await page.evaluate(() => {
    window.__filmAnchorEvents = []
    window.__genieFilmProbe = (event) => {
      const slot = document.querySelector('.gen-slot[data-win="triangolo"]')
      const row = { type: event.type, away: slot?.dataset.away === 'true' }
      if (event.type === 'outer-anchor') {
        row.stage = event.stage
        row.generation = event.receipt.paint.frame.generation
        row.paintedSize = [...event.receipt.paint.paintedSize]
        row.anchor = { ...event.receipt.anchors.film }
      } else if ('receipt' in event && event.receipt?.frame) {
        row.generation = event.receipt.frame.generation
      } else if ('frame' in event && event.frame) {
        row.generation = event.frame.generation
      }
      window.__filmAnchorEvents.push(row)
    }
    document
      .querySelector('.gen-slot[data-win="triangolo"] button[data-role="minimize"]')
      .click()
  })
  await page.waitForFunction(
    () => window.__filmAnchorEvents.some((event) => event.type === 'show'),
    { timeout: 20_000 },
  )
  const events = await page.evaluate(() => window.__filmAnchorEvents)
  if (errors.length) throw new Error(errors.join('\n'))

  const before = events.find(
    (event) => event.type === 'outer-anchor' && event.stage === 'before-reorder',
  )
  const accepted = events.find(
    (event) => event.type === 'outer-anchor' && event.stage === 'accepted',
  )
  const presented = events.find((event) => event.type === 'present')
  const shown = events.find((event) => event.type === 'show')
  if (!before || !accepted || !presented || !shown) {
    throw new Error(`missing handoff evidence: ${events.map((event) => event.type).join(', ')}`)
  }
  if (before.paintedSize.join() !== accepted.paintedSize.join())
    throw new Error(`outer size changed: ${before.paintedSize} -> ${accepted.paintedSize}`)
  if (accepted.generation <= before.generation)
    throw new Error(`accepted paint ${accepted.generation} did not follow ${before.generation}`)
  if (before.anchor.vMin === accepted.anchor.vMin && before.anchor.vMax === accepted.anchor.vMax)
    throw new Error('the same-size reorder did not move the film UV anchor')
  if (before.away || accepted.away || presented.away)
    throw new Error('the native film window hid before qualifying presentation')
  if (!shown.away) throw new Error('the native film window did not release at presentation')

  console.log(
    `film-anchor-reorder: paint ${before.generation} -> ${accepted.generation}, ` +
      `same ${accepted.paintedSize.join('x')} box, native release followed presentation`,
  )
  console.log('film-anchor-reorder gate PASSED')
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
