// live-content — is the flying sheet a running page, or a photograph?
//
// The genie window carries a nested shape tunnel that advances continuously.
// The scene's whole claim is that it keeps moving while the sheet is warped,
// and there are two independent ways that claim can quietly fail:
//
//   1. The capture is driven by PAINT. A transform animation is handed to
//      the compositor and repaints nothing, so the tunnel would advance in
//      the DOM and stand perfectly still in the texture. Measured here as
//      paint-counter growth on the window source during a flight.
//
//   2. The page copy and the airborne copy are the same component in two
//      different trees, each with its own animation start time. If their
//      phases differ, the tunnel JUMPS at the custody swap — the one frame
//      the scene most needs to be invisible. Measured here by reading the
//      same tunnel size out of both trees at one instant and differencing it.
//
// Neither is visible in a screenshot, and both would make the demo argue
// against itself.
//
// Both legs run on BOTH gestures, which is not redundancy. This file
// originally exercised only the shift-click flight, and a defect that
// lived exclusively on the grab path — a sheet drawn before its texture
// had pixels — went out under a green suite because no probe here ever
// pressed the titlebar. A gesture that is not measured is not covered,
// however similar it looks to one that is.
import { existsSync } from 'node:fs'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const labRoot = path.join('/Users/petepetrash/Code/munari', 'apps', 'lab')
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
  .filter(Boolean)
  .find((p) => existsSync(p))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let server, browser
const deadline = setTimeout(() => {
  console.error('live-content: hard 150s deadline hit')
  process.exit(1)
}, 150_000)

const problems = []

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--enable-features=CanvasDrawElement', '--disable-renderer-backgrounding'],
  })
  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  const page = await browser.newPage()
  await page.setViewport({ width: 1100, height: 800, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:${port}/?scene=genie`, { waitUntil: 'load' })
  await page.waitForFunction(
    () =>
      document.querySelector('.gen-sheet[data-win="scheda"] .gen-window') &&
      document.fonts.status === 'loaded',
    { timeout: 15_000 },
  )
  // Let the tunnel get well away from its keyframe origin, so a copy
  // that started its clock at mount is obviously out of phase rather
  // than coincidentally close.
  await sleep(2500)

  const centreOf = (sel) =>
    page.evaluate((s) => {
      const b = document.querySelector(s).getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    }, sel)

  // Read the tunnel out of every tree at one instant, then watch the paint
  // counter across a fixed wall-clock window. Both copies must exist for
  // the whole of it, which is why each caller holds its flight open.
  const read = () =>
    page.evaluate(async () => {
      const tunnelOf = (root) => {
        // Depth zero is the visible reference layer. The tunnel also carries
        // one much larger ancestor cycle outside the viewport to hide its
        // finite loop edge; measuring that guard would magnify a harmless
        // sub-frame phase difference into several offscreen pixels.
        const el = root.querySelector('.gen-recursive-shape[data-depth="0"]')
        if (!el) return null
        const cs = getComputedStyle(el)
        return { width: parseFloat(cs.width), height: parseFloat(cs.height) }
      }
      const paints = () =>
        window.__munari?.stats().find((x) => x.label === 'genie-window')?.paints ?? null

      // Scoped to the scheda window, and it has to be: three other
      // windows now stand on the desk, and only this one carries the
      // tunnel. Unscoped, `windows.length` would read 4 at rest and 5
      // in flight, and the copies check — whose whole job is to prove
      // there were TWO trees to compare — would pass on a scene that
      // never took off.
      const windows = [...document.querySelectorAll('.gen-sheet[data-win="scheda"] .gen-window')]
      const both = []
      for (const window of windows) {
        const tunnel = tunnelOf(window)
        if (tunnel) both.push(tunnel)
      }

      const p0 = paints()
      const t0 = performance.now()
      await new Promise((r) => setTimeout(r, 500))
      const p1 = paints()
      const elapsed = (performance.now() - t0) / 1000

      return {
        copies: windows.length,
        both,
        paintsPerSecond: p0 === null || p1 === null ? null : Math.round((p1 - p0) / elapsed),
      }
    })

  const judge = (name, r) => {
    const [a, b] = r.both
    const drift = a && b ? Math.hypot(a.width - b.width, a.height - b.height) : null

    console.log(`\n  ${name}`)
    console.log(`    window copies in flight   ${r.copies}`)
    console.log(`    window source paints/s    ${r.paintsPerSecond}`)
    if (a) console.log(`    page copy tunnel size     ${a.width} × ${a.height}`)
    if (b) console.log(`    airborne tunnel size      ${b.width} × ${b.height}`)
    if (drift !== null) console.log(`    twin phase drift          ${drift.toFixed(2)}px`)

    if (r.copies < 2) problems.push(`${name}: only one window copy existed mid-flight — nothing to compare`)
    if (!r.paintsPerSecond || r.paintsPerSecond < 20)
      problems.push(
        `${name}: the sheet repainted ${r.paintsPerSecond}/s in flight — the tunnel is frozen in the texture`,
      )
    if (drift === null) problems.push(`${name}: could not read the tunnel out of both trees`)
    else if (drift > 2)
      problems.push(
        `${name}: the twins are ${drift.toFixed(1)}px out of phase — the swap frame will jump`,
      )
  }

  // ── the grab, held open ───────────────────────────────────────────────
  // A hand owns t for as long as the pointer is down, so the flight can
  // simply be paused mid-funnel for the length of the measurement.
  const bar = await centreOf('.gen-sheet[data-win="scheda"] .gen-titlebar')
  await page.mouse.move(bar.x + 100, bar.y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(bar.x + 100, bar.y + i * 8)
    await sleep(16)
  }
  judge('drag the titlebar', await read())
  // Back to where it started and release: the commit reads the hand's
  // position, so this returns the window to rest rather than docking it.
  await page.mouse.move(bar.x + 100, bar.y + 4)
  await page.mouse.up()
  await page.waitForFunction(
    () => document.querySelector('.gen-tile[data-win="scheda"]')?.dataset.filled === 'false',
    { timeout: 8000 },
  )
  await sleep(700)

  // ── the untouched flight ──────────────────────────────────────────────
  // Shift-click: the 6x slow flight, so there is a long window in which
  // both copies exist at once and can be read against each other.
  const lamp = await centreOf('.gen-sheet[data-win="scheda"] .gen-lamp[data-role="minimize"]')
  await page.keyboard.down('Shift')
  await page.mouse.click(lamp.x, lamp.y)
  await page.keyboard.up('Shift')
  await sleep(600)
  judge('press the lamp', await read())

  console.log(
    `\nlive-content: ${problems.length === 0 ? 'PASS — the sheet is a running page on both gestures, and the twins agree' : 'FAIL'}`,
  )
  for (const p of problems) console.log(`  ${p}`)
  process.exit(problems.length === 0 ? 0 : 1)
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
