// Demand-mode DOM Surface proof on the real Workspace route.
// The instrument mutates and resizes a static product panel. It never calls
// R3F invalidate; the successful DOM paint receipt must wake the renderer.
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
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })
  const probe = await browser.newPage()
  const capable = await probe.evaluate(
    () => typeof document.createElement('canvas').getContext('2d').drawElementImage === 'function',
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
  await page.goto(
    `http://localhost:${port}/?scene=workspace&probe=dom-surface-demand`,
    { waitUntil: 'load' },
  )
  await page.waitForFunction(
    () => window.__domSurfaceDemand?.presented?.frame?.generation > 0,
    { timeout: 20_000 },
  )
  await sleep(600)

  const read = () => page.evaluate(() => {
    const probe = window.__domSurfaceDemand
    return {
      painted: probe.painted,
      drawn: probe.drawn,
      presented: probe.presented,
      framebufferHash: probe.framebufferHash,
    }
  })

  const baseline = await read()
  const mutationGeneration = baseline.painted.frame.generation + 1
  await page.evaluate(() => window.__domSurfaceDemand.mutate())
  await page.waitForFunction(
    (generation, hash) => {
      const probe = window.__domSurfaceDemand
      return (
        probe.presented?.frame?.generation >= generation &&
        probe.framebufferHash !== hash
      )
    },
    { timeout: 10_000 },
    mutationGeneration,
    baseline.framebufferHash,
  )
  const mutated = await read()

  const resizeGeneration = mutated.painted.frame.generation + 1
  await page.evaluate(() => window.__domSurfaceDemand.resize(420))
  await page.waitForFunction(
    (generation) => {
      const probe = window.__domSurfaceDemand
      return (
        probe.painted?.paintedSize?.[0] === 420 &&
        probe.presented?.frame?.generation >= generation
      )
    },
    { timeout: 10_000 },
    resizeGeneration,
  )
  const resized = await read()

  const problems = []
  for (const [name, sample] of [['mutation', mutated], ['resize', resized]]) {
    const paint = sample.painted?.frame
    const draw = sample.drawn?.frame
    const presented = sample.presented?.frame
    if (!paint || !draw || !presented) {
      problems.push(`${name}: missing paint, draw, or presentation receipt`)
    } else if (
      paint.sourceId !== draw.sourceId ||
      paint.sourceId !== presented.sourceId ||
      draw.generation !== presented.generation ||
      presented.generation > paint.generation
    ) {
      problems.push(
        `${name}: receipt order is invalid: paint ${paint.sourceId}:${paint.generation}, ` +
          `draw ${draw.sourceId}:${draw.generation}, presented ${presented.sourceId}:${presented.generation}`,
      )
    }
  }
  if (mutated.framebufferHash === baseline.framebufferHash) {
    problems.push('mutation: framebuffer pixels did not change')
  }
  if (resized.painted?.paintedSize?.[0] !== 420) {
    problems.push(`resize: painted width is ${resized.painted?.paintedSize?.[0]}, expected 420`)
  }
  if (errors.length) problems.push(...errors.map((error) => `page error: ${error}`))

  if (problems.length) {
    console.error(`dom-surface-demand gate FAILED (${problems.length})`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
  } else {
    console.log(
      `dom-surface-demand: generation ${baseline.presented.frame.generation} -> ` +
        `${mutated.presented.frame.generation} -> ${resized.presented.frame.generation}, ` +
        `paint/draw/presentation agree`,
    )
    console.log('dom-surface-demand gate PASSED')
  }
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
