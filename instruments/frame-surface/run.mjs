// Real-Chrome receipt and RGB gate for the public frame-backed Surface.
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

const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate))
if (!chromePath) {
  console.error('frame-surface gate: no Chrome executable found (set CHROME_PATH)')
  process.exit(1)
}

let server
let browser
const deadline = setTimeout(() => {
  console.error('frame-surface gate: hard 45s deadline hit')
  process.exit(1)
}, 45_000)

try {
  server = await createServer({
    configFile: false,
    root: here,
    logLevel: 'warn',
    resolve: {
      alias: {
        '@munari/core': path.join(repoRoot, 'packages', 'core', 'src', 'index.ts'),
        '@petepetrash/munari/advanced': path.join(
          repoRoot, 'packages', 'react', 'src', 'advanced.ts',
        ),
        '@petepetrash/munari': path.join(repoRoot, 'packages', 'react', 'src', 'index.ts'),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 0,
      fs: { allow: [repoRoot, here] },
    },
  })
  await server.listen()

  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      // Headless has no GPU here; SwiftShader supplies a real WebGL
      // context so the render path under test exists at all.
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
      // The idle-zero pair: a backgrounded renderer stops compositing,
      // and a receipt that never arrives must mean the library failed,
      // not that throttling starved the frameloop.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 512, height: 256, deviceScaleFactor: 1 })
  const pageProblems = []
  page.on('pageerror', (error) => pageProblems.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) {
      pageProblems.push(message.text())
    }
  })

  const url = server.resolvedUrls.local[0]
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__frameSurfaceGate?.ready === true, {
    timeout: 10_000,
  })

  let gateTimeout
  let result
  try {
    result = await Promise.race([
      page.evaluate(() => window.__frameSurfaceGate.run()),
      new Promise((_, reject) => {
        gateTimeout = setTimeout(
          () => reject(new Error('frame-surface gate: result timed out')),
          15_000,
        )
      }),
    ])
  } catch (error) {
    console.error('frame-surface gate debug:', await page.evaluate(() => window.__frameSurfaceGate.debug()))
    throw error
  } finally {
    clearTimeout(gateTimeout)
  }

  const receiptTrace = result.receipts
    .map(
      ({ receipt }) =>
        `${receipt.frame.generation}@source-${receipt.frame.sourceId}/epoch-${receipt.surfaceEpoch}`,
    )
    .join(', ')
  console.log(`frame-surface: receipts [${receiptTrace}]`)
  console.log(
    `frame-surface: replacement renders ${result.replacementRenderSamples.length}, ` +
      `clear frames ${result.replacementClearFrames}, stale old-source receipts ` +
      `${result.staleOldSourceReceipts}`,
  )
  for (const acquisition of result.acquisitionEvidence) {
    console.log(
      `frame-surface: reacquire ${acquisition.cycle} published ` +
        `[${acquisition.publishedGenerations.join(', ')}] while released ` +
        `${acquisition.releasedSurfaceAbsent ? 'yes' : 'NO'}, receipt ` +
        `${acquisition.receiptGeneration}@epoch-${acquisition.surfaceEpoch}, renders ` +
        `${acquisition.renderSamples}, clear ${acquisition.clearFrames}, mismatched ` +
        `${acquisition.mismatchedFrames}, RGB error ${acquisition.receiptRgbError}, ` +
        `mesh/material/geometry ${acquisition.meshId}/${acquisition.materialId}/` +
        `${acquisition.geometryId}`,
    )
  }
  console.log(
    `frame-surface: live replacement identity ` +
      `${result.liveReplacementIdentityPreserved ? 'preserved' : 'changed'}, ` +
      `reacquisition objects ${result.reacquisitionObjectsFresh ? 'fresh' : 'reused'}, ` +
      `default unlit ${result.defaultUnlitVerified ? 'verified' : 'FAILED'}, ` +
      `worst RGB error ${result.worstRgbError}`,
  )
  console.log(
    `frame-surface: presentation fence frame receipts ` +
      `${result.presentationFence.frameReceipts.length}, presentation receipts ` +
      `${result.presentationFence.presentationReceipts.length}, disabled clear ` +
      `${result.presentationFence.disabledDefaultClear ? 'yes' : 'NO'}, offscreen drew ` +
      `${result.presentationFence.offscreenHadPixels ? 'yes' : 'NO'}, offscreen RGB error ` +
      `${result.presentationFence.offscreenRgbError}, visible RGB error ` +
      `${result.presentationFence.visibleRgbError}`,
  )
  console.log(
    `frame-surface: backing-store resize generations ` +
      `[${result.backingStoreResize.generations.join(', ')}], size ` +
      `${result.backingStoreResize.finalWidth}x${result.backingStoreResize.finalHeight}, ` +
      `same texture ${result.backingStoreResize.sameTexture ? 'yes' : 'NO'}, RGB errors ` +
      `[${result.backingStoreResize.rgbErrors.join(', ')}]`,
  )

  if (pageProblems.length) {
    console.error('frame-surface gate: page errors during the run:')
    for (const problem of pageProblems) console.error(`  ${problem}`)
    process.exitCode = 1
  } else if (!result.passed) {
    console.error('frame-surface gate FAILED')
    console.error(JSON.stringify(result, null, 2))
    process.exitCode = 1
  } else {
    console.log(
      'frame-surface gate PASSED: visible presentation, live replacement, and 3 handoff cycles kept current sRGB pixels.',
    )
  }
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
