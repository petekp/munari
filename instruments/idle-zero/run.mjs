// idle-zero gate runner — CI's browser evidence for the archive#3
// economy (idle sources = 0 paints/s). See main.ts for what is
// actually asserted; this file is transport: find Chrome, prove the
// origin-trial surface exists, drive the page, judge the numbers.
//
// Capability policy: drawElementImage is an origin-trial API, so its
// ABSENCE is an environmental gap, not a regression — the gate warns
// loudly and exits 0 (STRICT_CAPABILITY=1 turns that into a failure
// for environments that are supposed to have it). Everything after a
// successful capability probe is real: a page error, a timeout, or a
// nonzero idle delta all fail the gate.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean)

const strict = process.env.STRICT_CAPABILITY === '1'

/** Loud in CI (::warning:: renders as an annotation), honest locally. */
function skip(reason) {
  const msg = `idle-zero gate SKIPPED: ${reason}`
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
  // The archive's known-good pair: a backgrounded renderer stops
  // compositing, and a gate that measures "no paints" must never let
  // throttling manufacture that result for the wrong reason.
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  ...(process.env.CI ? ['--no-sandbox'] : []),
]

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
// The whole gate under one deadline so CI can never hang on it.
const deadline = setTimeout(() => {
  console.error('idle-zero gate: hard 90s deadline hit')
  process.exit(1)
}, 90_000)

try {
  browser = await launch(true)
  let capable = await probeCapability(browser)
  if (!capable && !process.env.CI) {
    // Headless builds can lag the trial surface; a local machine has a
    // display, so try once headed before concluding the machine can't.
    await browser.close()
    browser = await launch(false)
    capable = await probeCapability(browser)
    if (capable) console.log('idle-zero: capability present headed only — measuring headed')
  }
  if (!capable) {
    await browser.close()
    skip(`Chrome at ${chromePath} has no drawElementImage even with the feature flag`)
  }

  server = await createServer({
    configFile: false,
    root: here,
    logLevel: 'warn',
    resolve: {
      alias: { '@anamorph/core': path.join(repoRoot, 'packages', 'core', 'src', 'index.ts') },
    },
    server: { port: 0 },
  })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  const page = await browser.newPage()
  // Past the capability probe, every page-side problem is a real
  // failure — surface it instead of timing out in silence. Resource-load
  // 404s (favicon against a bare vite root) are environmental noise, not
  // page problems; a broken module import surfaces as a pageerror or a
  // vite error overlay message, both still collected.
  const pageProblems = []
  page.on('pageerror', (err) => pageProblems.push(String(err)))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
      pageProblems.push(m.text())
  })

  await page.goto(`http://localhost:${port}/?n=12`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__idleZero?.ready === true, { timeout: 15_000 })

  const inPageCapable = await page.evaluate(() => window.__idleZero.capable)
  if (!inPageCapable) throw new Error('page reports drawElementImage absent after probe said present')

  const result = await page.evaluate(() => window.__idleZero.run())

  const violators = result.idleDeltas
    .map((d, i) => ({ source: `idle-${i}`, delta: d }))
    .filter((v) => v.delta !== 0)
  const perSecond = violators.map((v) => ({ ...v, rate: v.delta / (result.windowMs / 1000) }))

  console.log(
    `idle-zero: ${result.n} sources, ${result.windowMs}ms window — ` +
      `idle deltas [${result.idleDeltas.join(', ')}], provoked +${result.provokedDelta}`,
  )
  if (pageProblems.length) {
    console.error('page errors during the run:')
    for (const p of pageProblems) console.error(`  ${p}`)
    process.exit(1)
  }
  if (violators.length) {
    console.error('IDLE-ZERO VIOLATION — quiescent sources painted:')
    for (const v of perSecond) console.error(`  ${v.source}: +${v.delta} (${v.rate}/s)`)
    console.error('archive#3: the compositor is the only change signal; something added a repaint loop.')
    process.exit(1)
  }
  if (result.provokedDelta <= 0) {
    console.error('LIVENESS FAILURE — a real DOM mutation never advanced paintCount.')
    console.error('The idle result above is vacuous; the onpaint wiring is broken.')
    process.exit(1)
  }
  console.log('idle-zero gate PASSED: 0 idle paints, provocation counted.')
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
