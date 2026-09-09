// Demand-mode DOM Surface proof on the real Workspace route.
// The instrument mutates and resizes a static product panel. It never calls
// R3F invalidate; a new DOM paint must wake the renderer and reach pixels.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const labRoot = path.join(repoRoot, 'apps', 'lab')
const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
].filter(Boolean).find(existsSync)
const strict = process.env.STRICT_CAPABILITY === '1'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function skip(reason) {
  const message = `dom-surface-demand gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message)
  process.exit(strict ? 1 : 0)
}

if (!chromePath) skip('no Chrome executable found (set CHROME_PATH)')

let browser
let server
const deadline = setTimeout(() => {
  console.error('dom-surface-demand gate: hard 120s deadline hit')
  process.exit(1)
}, 120_000)

try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--enable-features=CanvasDrawElement',
      // The idle-zero pair: a backgrounded renderer stops compositing,
      // and a paint receipt that fails to wake the renderer must mean
      // the library failed, not that throttling stalled the page.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })
  const probe = await browser.newPage()
  const capable = await probe.evaluate(
    () => 'drawElementImage' in document.createElement('canvas').getContext('2d'),
  )
  await probe.close()
  if (!capable) skip(`Chrome at ${chromePath} has no drawElementImage`)

  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 820, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  // The shell's iframe forwards only the scene name. Open the scene window
  // directly so the probe param reaches the component being measured.
  await page.goto(
    `http://localhost:${port}/?scene=workspace&probe=dom-surface-demand&framed`,
    { waitUntil: 'load' },
  )
  await page.waitForFunction(
    () => window.__domSurfaceDemand?.ready === true,
    { timeout: 20_000 },
  )
  await sleep(600)

  const read = async () => {
    const [sample, screenshot] = await Promise.all([
      page.evaluate(() => {
        const probe = window.__domSurfaceDemand
        return {
          paints: probe.readPaints(),
          sourceHash: probe.readSource(),
          sourceWidth: probe.readSourceWidth(),
        }
      }),
      page.screenshot({ type: 'png' }),
    ])
    let framebufferHash = 2166136261
    for (let i = 0; i < screenshot.length; i += 17) {
      framebufferHash ^= screenshot[i]
      framebufferHash = Math.imul(framebufferHash, 16777619)
    }
    return { ...sample, framebufferHash: framebufferHash >>> 0 }
  }

  const baseline = await read()
  await page.evaluate(() => window.__domSurfaceDemand.mutate())
  await page.waitForFunction(
    (paints) => {
      const probe = window.__domSurfaceDemand
      return probe.readPaints() > paints
    },
    { timeout: 10_000 },
    baseline.paints,
  )
  await sleep(100)
  const mutated = await read()

  await page.evaluate(() => window.__domSurfaceDemand.resize(360))
  await page.waitForFunction(
    () => {
      const probe = window.__domSurfaceDemand
      return probe.readSourceWidth() === 360
    },
    { timeout: 10_000 },
  )
  await sleep(100)
  const resized = await read()
  // A resize earns a trailing upload and an exact backing-store resettle.
  // On a contended CI runner those can land more than 600ms later without
  // being an idle leak. Require eventual quiescence: two consecutive
  // 600ms windows with no new paint, bounded so a real leak still fails.
  let idleBefore = await read()
  let idleAfter = idleBefore
  let stableWindows = 0
  for (let attempt = 0; attempt < 8 && stableWindows < 2; attempt++) {
    await sleep(600)
    idleAfter = await read()
    if (idleAfter.paints === idleBefore.paints) stableWindows++
    else stableWindows = 0
    idleBefore = idleAfter
  }

  const problems = []
  if (mutated.framebufferHash === baseline.framebufferHash) {
    problems.push('mutation: framebuffer pixels did not change')
  }
  if (mutated.sourceHash === baseline.sourceHash) {
    problems.push('mutation: source pixels did not change')
  }
  if (mutated.paints <= baseline.paints) {
    problems.push('mutation: paint ledger did not advance')
  }
  if (resized.sourceWidth !== 360) {
    problems.push(`resize: source width is ${resized.sourceWidth}, expected 360`)
  }
  if (resized.paints <= mutated.paints) {
    problems.push('resize: paint ledger did not advance')
  }
  if (stableWindows < 2) problems.push('idle: paint ledger never became quiescent')
  if (errors.length) problems.push(...errors.map((error) => `page error: ${error}`))

  if (problems.length) {
    console.error(`dom-surface-demand gate FAILED (${problems.length})`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
  } else {
    console.log(
      `dom-surface-demand: paints ${baseline.paints} -> ` +
        `${mutated.paints} -> ${resized.paints}, then idle at ${idleAfter.paints}`,
    )
    console.log('dom-surface-demand gate PASSED')
  }
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
