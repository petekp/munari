// One-off: full frame history of the veil gate (window.__veilGateLog,
// DEV-only ring buffer) across load, scroll, and one resize — to see
// which frames ran, when the demand loop died, and what fed setSize.
import { existsSync } from 'node:fs'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const repoRoot = '/Users/petepetrash/Code/munari'
const labRoot = path.join(repoRoot, 'apps', 'lab')

const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean).find((p) => existsSync(p))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let server, browser
const deadline = setTimeout(() => { console.error('deadline'); process.exit(1) }, 120_000)
try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--enable-features=CanvasDrawElement'],
  })
  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error('PAGEERROR', String(e)))
  await page.setViewport({ width: 1000, height: 800, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:${port}/?scene=veil`, { waitUntil: 'load' })
  await page.waitForFunction(
    () => {
      const s = window.__munari?.stats().find((x) => x.label === 'veil-sheet')
      return s && s.paints > 0 && document.fonts.status === 'loaded'
    },
    { timeout: 15_000 },
  )
  const dump = (tag) =>
    page.evaluate(() => {
      const log = window.__veilGateLog ?? []
      window.__veilGateLog = []
      return log
    }).then((log) => {
      console.log(`── ${tag} (${log.length} frames)`)
      // Compress runs of identical state: print first/last of each run.
      let prev = null
      let runStart = null
      const sig = (r) => JSON.stringify([r.pw, r.ph, r.liveW, r.liveH, r.matched, r.gate, r.muGate])
      for (const r of log) {
        if (prev && sig(r) === sig(prev)) { runStart ??= prev; prev = r; continue }
        if (runStart) { console.log('   ⋮ (same until)', JSON.stringify(prev)); runStart = null }
        console.log('  ', JSON.stringify(r))
        prev = r
      }
      if (runStart) console.log('   ⋮ (same until)', JSON.stringify(prev))
    })

  const shot = (name) =>
    page.screenshot({
      clip: { x: 200, y: 640, width: 600, height: 35 },
      path: `/private/tmp/claude-501/-Users-petepetrash-Code-munari/56383707-a454-4401-803e-97503befeaac/scratchpad/veil-shot-${name}.png`,
    })

  await sleep(600)
  await dump('load settle @1000')
  await page.evaluate(() => { document.querySelector('.veil-page').scrollTop = 150 })
  await sleep(900)
  await shot('a-post-scroll')
  await dump('after scroll + SCREENSHOT')
  await page.setViewport({ width: 1400, height: 800, deviceScaleFactor: 1 })
  await sleep(900)
  await shot('b-post-resize')
  await dump('after resize to 1400 + SCREENSHOT')
  await sleep(400)
  await shot('c-again')
  await shot('d-again')
  await dump('after two more screenshots')
  const stats = await page.evaluate(() => window.__munari?.stats())
  console.log('stats:', JSON.stringify(stats))
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
