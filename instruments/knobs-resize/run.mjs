// knobs-resize gate — one box, one writer, one commit.
//
// The panel's face is captured DOM; its knobs, switches and lamps are
// WebGL standing on that face. Both halves are placed from the same
// measurement, so they can only stand together if they belong to the
// same generation of it. This gate measures whether they do, across a
// resize drag that crosses both of the panel's container-query
// breakpoints.
//
// What it watches, and why these four boxes:
//
//   panel   .knb-panel        the arrangement the DOM actually settled on
//   host    .ui-root          what `drawElementImage` rasterizes
//   canvas  canvas.style      what the replay is scaled against
//   store   canvas.width/height
//
// The replay is `element box x (store / canvas CSS box)`, drawn at the
// origin. So the host IS the frame of the capture: a panel wider than its
// host has that overhang cut off, and a panel shorter than its host leaves
// bare host, which the mesh then stretches over the slab all the same.
//
// The bug this gate was written for: every consumer of the panel's box was
// exactly one drag step behind the face painted for them. 15px of the panel
// went missing off the right edge on every frame of every drag, and at a
// container-query breakpoint the miss was a whole arrangement — the panel
// 463px tall inside a host still declaring 721, so the face landed in the
// top 463/721 = 0.64 of its own texture with the hardware standing at
// full-height positions.
//
// The cause was not the scene's timing, which was already correct: the
// pointer event wrote the width, forced the reflow, read the arrangement
// back and committed, all in one event. It was WHICH REACT ROOT owned the
// state. `<Canvas>` hands its children to the three root inside an
// `async function run()` that awaits `root.configure()` first, so state
// held by the component that renders the Canvas arrives a microtask later
// and commits a frame late — and nothing flushed from the DOM side can
// pull it forward. Measured: with `react-dom`'s `flushSync` around the
// drag, the host's box still ended 21 of 23 pointer events on the previous
// step. State held by a component UNDER the Canvas schedules on the three
// root directly, where r3f's own `flushSync` commits it inside the event.
//
// This gate pins the result rather than the mechanism — any future
// arrangement that strands the panel's geometry on the wrong root, or
// re-introduces a second writer for one box, fails here whatever it is
// called.
//
// Capability policy and launch flags follow instruments/idle-zero.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const labRoot = path.join(repoRoot, 'apps', 'lab')

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean)

const strict = process.env.STRICT_CAPABILITY === '1'

function skip(reason) {
  const msg = `knobs-resize gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : msg)
  if (strict) {
    console.error('STRICT_CAPABILITY=1 — treating the gap as a failure.')
    process.exit(1)
  }
  process.exit(0)
}

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chromePath) skip('no Chrome executable found (set CHROME_PATH)')

const LAUNCH_ARGS = [
  '--enable-features=CanvasDrawElement',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  ...(process.env.CI ? ['--no-sandbox'] : []),
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let server
let browser
const deadline = setTimeout(() => {
  console.error('knobs-resize gate: hard 120s deadline hit')
  process.exit(1)
}, 120_000)

try {
  browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: LAUNCH_ARGS })
  const probe = await browser.newPage()
  const capable = await probe.evaluate(
    () => typeof document.createElement('canvas').getContext('2d').drawElementImage === 'function',
  )
  await probe.close()
  if (!capable) {
    await browser.close()
    skip(`Chrome at ${chromePath} has no drawElementImage even with the feature flag`)
  }

  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  const page = await browser.newPage()
  let pageError = null
  page.on('pageerror', (e) => { pageError ??= String(e) })
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:${port}/?scene=knobs`, { waitUntil: 'load' })
  await page.waitForFunction(
    () => document.querySelector('.knb-panel') && document.querySelector('canvas'),
    { timeout: 15_000 },
  )
  await sleep(2500)

  // One reading per animation frame. A frame is the unit that matters:
  // it is what the compositor can photograph, so a disagreement that
  // never survives to a frame boundary is not a disagreement anyone can
  // see, and one that does is exactly what the eye catches.
  await page.evaluate(() => {
    const panel = document.querySelector('.knb-panel')
    const host = panel.closest('.ui-root')
    const canvas = host.closest('canvas')
    window.__kr = []
    const tick = () => {
      const p = panel.getBoundingClientRect()
      const h = host.getBoundingClientRect()
      window.__kr.push({
        pw: Math.round(p.width), ph: Math.round(p.height),
        hw: Math.round(h.width), hh: Math.round(h.height),
        cw: parseInt(canvas.style.width), ch: parseInt(canvas.style.height),
      })
      window.__krRaf = requestAnimationFrame(tick)
    }
    window.__krRaf = requestAnimationFrame(tick)
  })

  // The grip's page coordinates have to be recomputed before every
  // gesture. It lives in the parked DOM, so its own rect is in capture
  // space; and it moves with the panel, so a coordinate cached across a
  // resize lands on the slab body instead and starts a CARRY rather
  // than a resize — which measures a stationary panel and looks clean.
  const gripAt = () => page.evaluate(() => {
    const g = document.querySelector('.knb-resize-grip')
    const base = document.querySelector('.knb-panel').getBoundingClientRect()
    const r = g.getBoundingClientRect()
    return {
      x: Math.round(window.innerWidth - 26 - Math.round(base.width) + (r.left + r.width / 2 - base.left)),
      y: Math.round(window.innerHeight / 2 - base.height / 2 + (r.top + r.height / 2 - base.top)),
    }
  })

  // Narrow to the stop first, so the grow crosses every breakpoint.
  let g = await gripAt()
  await page.mouse.move(g.x, g.y)
  await page.mouse.down()
  await page.mouse.move(g.x - 300, g.y, { steps: 18 })
  await page.mouse.up()
  await sleep(1500)

  await page.evaluate(() => { window.__kr.length = 0 })
  g = await gripAt()
  await page.mouse.move(g.x, g.y)
  await page.mouse.down()
  await page.mouse.move(g.x + 340, g.y, { steps: 22 })
  await page.mouse.up()
  await sleep(1200)

  const s = await page.evaluate(() => {
    cancelAnimationFrame(window.__krRaf)
    return window.__kr
  })
  if (pageError) throw new Error(`page error during the drag: ${pageError}`)

  // Only frames where something moved. The idle either side of the
  // gesture agrees trivially and would dilute the result to nothing.
  const moving = s.filter((r, i) => i > 0 && (r.pw !== s[i - 1].pw || r.ph !== s[i - 1].ph || r.ch !== s[i - 1].ch))
  if (moving.length < 10) {
    throw new Error(
      `only ${moving.length} moving frames — the gesture did not resize the panel. ` +
        'A run that measured a stationary panel proves nothing; check the grip coordinate.',
    )
  }
  // The panel must actually cross a breakpoint, or the hard case was
  // never exercised and a pass is vacuous.
  const tiers = new Set(moving.map((r) => r.ph))
  if (tiers.size < 2) {
    throw new Error(`the drag stayed inside one arrangement (heights ${[...tiers]}) — no breakpoint was crossed`)
  }

  const split = moving.filter((r) => r.hw !== r.cw || r.hh !== r.ch)
  // BOTH axes. This gate shipped asking only about height, and passed 19 of
  // 21 frames while the panel was a whole drag step wider than the host on
  // all 21 — the right edge of the face cut off for the length of the drag,
  // moving with the hand. Height only disagrees where a container query
  // changes the arrangement, so a height-only check reports the two loud
  // frames and misses the continuous fault underneath them. An instrument
  // that passes the thing you can see is worse than no instrument.
  const cropped = moving.filter((r) => Math.abs(r.hh - r.ph) > 1 || Math.abs(r.hw - r.pw) > 1)

  console.log(`knobs-resize: ${moving.length} moving frames across ${tiers.size} arrangements (${[...tiers].join(', ')}px tall)`)
  console.log(`  host box vs canvas box:  ${moving.length - split.length}/${moving.length} agree`)
  console.log(`  panel box vs host box:   ${moving.length - cropped.length}/${moving.length} agree`)

  let failed = false
  if (split.length) {
    failed = true
    console.error(`\nFAIL: ${split.length} frames where the host box and the canvas box disagree.`)
    console.error('The replay is scaled against the canvas box and drawn at the host box, so')
    console.error('these frames put the face somewhere other than where the mesh maps it.')
    for (const r of split.slice(0, 6)) {
      console.error(`  host ${r.hw}x${r.hh}  canvas ${r.cw}x${r.ch}  (panel ${r.pw}x${r.ph})`)
    }
  }
  if (cropped.length) {
    failed = true
    console.error(`\nFAIL: ${cropped.length} frames where the panel and the host disagree.`)
    console.error('The host is what gets rasterized. A panel WIDER or TALLER than its host has')
    console.error('that overhang cut off; a smaller one leaves bare host, stretched over the slab.')
    for (const r of cropped.slice(0, 6)) {
      console.error(`  panel ${r.pw}x${r.ph}  host ${r.hw}x${r.hh}  (${r.pw - r.hw}, ${r.ph - r.hh})`)
    }
  }
  if (failed) process.exit(1)
  console.log('\nknobs-resize gate PASSED')
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
