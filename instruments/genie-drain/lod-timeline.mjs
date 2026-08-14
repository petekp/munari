// lod-timeline — what texture resolution a sheet actually flies at.
//
// genie-drain proves the handoff cycle happens; this proves it happens
// SHARP. The two are structurally different questions: every observable
// in genie-drain is a DOM truth (visibility, dataset flags, a typed
// value, a transform matrix), and a window can pass all of them while
// being drawn from a quarter-resolution raster. It did.
//
// The bug this was written for: the window arrived from the dock badly
// blurred, and only on the way OUT. Dynamic LOD sizes a Surface's
// texture from its mesh's projected screen size, reading the geometry's
// bounding sphere — which three computes lazily ONCE and never
// invalidates when vertex positions change. The genie Driver rewrites
// every vertex each frame, so the tier is decided by whatever the warp
// looked like at one arbitrary instant. On a restore that instant is
// the sheet parked in the dock mouth, waiting for its first paint:
//
//   MINIMIZE   scale=2 for the whole flight            (sharp)
//   RESTORE    2 → 1.5 → 1 → 0.5 → 0.25 by t=657ms     (a 460x340
//              window drawn from a 115x85 raster, at full size)
//
// The fix is not a better measurement. Even measured correctly the
// sheet IS small mid-pour, so an honest LOD would still hand the
// landing a texture too coarse for full size. A sheet in flight must
// not re-raster at all: its content is frozen, so its resolution has to
// be too (Genie.tsx pins `resolution={2}`). Re-run this after touching
// the flight geometry, the drive, or that prop — a flat timeline at the
// pinned tier is the pass.
import { existsSync } from 'node:fs'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const repoRoot = '/Users/petepetrash/Code/munari'
const labRoot = path.join(repoRoot, 'apps', 'lab')

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
  .filter(Boolean)
  .find((p) => existsSync(p))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let server, browser
const deadline = setTimeout(() => {
  console.error('lod-timeline: hard 120s deadline hit')
  process.exit(1)
}, 120_000)

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
  // deviceScaleFactor 2: the tier ladder is relative to device pixels, so
  // a 1x capture would hide a drop that a retina user sees plainly.
  await page.setViewport({ width: 1100, height: 800, deviceScaleFactor: 2 })
  await page.goto(`http://localhost:${port}/?scene=genie`, { waitUntil: 'load' })
  await page.waitForFunction(
    () => document.querySelector('.gen-sheet[data-win="scheda"] .gen-window') && document.fonts.status === 'loaded',
    { timeout: 15_000 },
  )
  await sleep(400)

  // Sample the window source's tier once per animation frame. The source
  // exists only while a flight is in the air, so `null` brackets each
  // leg — mount on the left, unmount on the right.
  const sample = (ms) =>
    page.evaluate(async (dur) => {
      const out = []
      const t0 = performance.now()
      while (performance.now() - t0 < dur) {
        const s = window.__munari?.stats().find((x) => x.label === 'genie-window')
        out.push({ t: Math.round(performance.now() - t0), scale: s ? s.scale : null })
        await new Promise((r) => requestAnimationFrame(r))
      }
      return out
    }, ms)

  // Only transitions are interesting; a flat leg prints two lines.
  const summarize = (name, rows) => {
    const edges = []
    for (const r of rows) {
      const last = edges[edges.length - 1]
      if (!last || last.scale !== r.scale) edges.push(r)
    }
    console.log(`\n${name}: ${rows.length} frames`)
    for (const e of edges) console.log(`   t=${String(e.t).padStart(4)}ms  scale=${e.scale}`)
    const tiers = new Set(edges.map((e) => e.scale).filter((s) => s !== null))
    return tiers
  }

  const center = (sel) =>
    page.evaluate((s) => {
      const b = document.querySelector(s).getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    }, sel)

  const lamp = await center('.gen-sheet[data-win="scheda"] .gen-lamp[data-role="minimize"]')
  const tile = await center('.gen-tile[data-win="scheda"]')

  await page.mouse.click(lamp.x, lamp.y)
  const downTiers = summarize('MINIMIZE (full size → dock mouth)', await sample(1400))
  await sleep(400)

  // The restore has to be sampled from BEFORE the click: the collapse
  // starts in the first frames, while the sheet is still held at the
  // mouth waiting on its first paint.
  const restore = sample(1600)
  await sleep(30)
  await page.mouse.click(tile.x, tile.y)
  const upTiers = summarize('RESTORE (dock mouth → full size)', await restore)

  const steady = downTiers.size === 1 && upTiers.size === 1
  console.log(
    `\nlod-timeline: ${
      steady
        ? `PASS — one tier per leg, no re-raster in flight (${[...upTiers][0]}x)`
        : `FAIL — the sheet re-rasterized mid-flight (down: ${[...downTiers].join('→')}, up: ${[...upTiers].join('→')})`
    }`,
  )
  process.exit(steady ? 0 : 1)
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
