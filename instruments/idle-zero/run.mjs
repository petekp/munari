// idle-zero gate runner — CI's browser evidence for the upload-on-paint
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
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

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
  ...WEBGPU_CHROME_ARGS,
  '--enable-features=CanvasDrawElement',
  // The known-good pair: a backgrounded renderer stops
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
    return ctx !== null && 'drawElementImage' in ctx
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

  console.log(`idle-zero: ${await browser.version()}`)
  server = await createServer({
    configFile: false,
    root: here,
    logLevel: 'warn',
    resolve: {
      alias: { '@munari/core': path.join(repoRoot, 'packages', 'core', 'src', 'index.ts') },
    },
    server: { port: 0 },
  })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  const run = async (recurringPaint) => {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(String(error)))
    page.on('console', message => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
        errors.push(message.text())
      }
    })
    try {
      await page.goto(`http://localhost:${port}/?n=12`, { waitUntil: 'load' })
      await page.waitForFunction(() => window.__idleZero?.ready === true, { timeout: 15_000 })
      assert.equal(await page.evaluate(() => window.__idleZero.capable), true, 'The fixture must retain capture capability')
      const result = await page.evaluate(recurringPaint => window.__idleZero.run({ recurringPaint }), recurringPaint)
      assert.deepEqual(errors, [], 'Idle measurement reported browser errors')
      assert.equal(result.n, 12, 'All requested sources must be measured')
      assert.deepEqual(result.profiles.map(profile => profile.live), [false, true], 'Both quiet profiles must be measured')
      for (const profile of result.profiles) {
        assert.equal(profile.idleDeltas.length, result.n, 'Every source needs an idle sample')
        assert.ok(profile.idleDeltas.every(value => Number.isInteger(value) && value >= 0), 'Idle samples must be valid paint deltas')
        assert.ok(Number.isFinite(profile.windowMs) && profile.windowMs > 0, 'The idle window must have a valid duration')
        console.log(`idle-zero: ${recurringPaint ? 'recurring-paint control' : 'normal'} ${profile.live ? 'live' : 'frozen'} · ${profile.windowMs}ms · deltas [${profile.idleDeltas.join(', ')}] · requests ${profile.recurringRequests} · callbacks ${profile.recurringCallbacks}`)
      }
      assert.ok(Number.isInteger(result.provokedDelta) && result.provokedDelta > 0, 'A real DOM mutation must advance paintCount')
      console.log(`idle-zero: ${recurringPaint ? 'control' : 'normal'} mutation +${result.provokedDelta}`)
      return result
    } finally {
      await page.close()
    }
  }
  const requireQuiet = (result) => {
    const violations = result.profiles.flatMap(profile => profile.idleDeltas.flatMap((delta, source) =>
      delta === 0 ? [] : [`${profile.live ? 'live' : 'frozen'} source ${source}: +${delta}`],
    ))
    assert.equal(violations.length, 0, `Quiescent sources painted: ${violations.join('; ')}`)
  }

  const result = await run(false)
  requireQuiet(result)
  const control = await run(true)
  assert.ok(control.profiles.every(profile => profile.recurringRequests > 0 && profile.recurringCallbacks > 0), 'Recurring requests must reach actual compositor callbacks in both profiles')
  assert.ok(control.profiles[0].idleDeltas.every(delta => delta === 0), 'Frozen sources must decline the recurring callbacks')
  assert.ok(control.profiles[1].idleDeltas[0] > 0, 'Recurring callbacks must repaint the live source')
  assert.throws(() => requireQuiet(control), /Quiescent sources painted: live source 0:/)
  console.log('idle-zero gate PASSED: frozen and live idle paints stayed zero; recurring live paints failed the same oracle.')
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
