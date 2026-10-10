// Real-Chrome receipt and RGB gate for the public frame-backed Surface.
import { existsSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
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

const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate))
if (!chromePath) {
  console.error('frame-surface gate: no Chrome executable found (set CHROME_PATH)')
  process.exit(1)
}

let server
let browser
let images
// The development error FrameSurface reports, once, for a tainted source.
const TAINT_REPORT = 'munari: FrameSurface source canvas holds cross-origin pixels'
const deadline = setTimeout(() => {
  console.error('frame-surface gate: hard 120s deadline hit')
  process.exit(1)
}, 120_000)

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

  // A 1×1 PNG from a second origin with no CORS headers taints any canvas
  // that draws it.
  const dot = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64',
  )
  images = createHttpServer((_, response) => {
    response.writeHead(200, { 'content-type': 'image/png' })
    response.end(dot)
  })
  await new Promise((resolve) => images.listen(0, '127.0.0.1', resolve))
  const imagePort = images.address().port

  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      ...WEBGPU_CHROME_ARGS,
      // Honor the GPU blocklist: Apple Software Renderer loses canvas-to-sRGB
      // uploads. Permit SwiftShader when Chrome rejects the native backend.
      '--enable-unsafe-swiftshader',
      // The idle-zero pair: a backgrounded renderer stops compositing,
      // and a receipt that never arrives must mean the library failed,
      // not that throttling starved the frameloop.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })

  const url = server.resolvedUrls.local[0]

  // One page per run. Problems are page errors and console errors; a gate
  // result with any problem does not count as a pass.
  async function runPage(query) {
    const page = await browser.newPage()
    await page.setViewport({ width: 512, height: 256, deviceScaleFactor: 1 })
    const problems = []
    let taintReports = 0
    page.on('pageerror', (error) => problems.push(String(error)))
    page.on('console', (message) => {
      if (message.type() !== 'error' || /Failed to load resource/.test(message.text())) return
      if (message.text().startsWith(TAINT_REPORT)) taintReports += 1
      else problems.push(message.text())
    })
    await page.goto(`${url}?${query}&imagePort=${imagePort}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__frameSurfaceGate?.ready === true, {
      timeout: 10_000,
    })
    let gateTimeout
    try {
      const result = await Promise.race([
        page.evaluate(() => window.__frameSurfaceGate.run()),
        new Promise((_, reject) => {
          gateTimeout = setTimeout(
            () => reject(new Error(`frame-surface gate: result timed out (${query})`)),
            15_000,
          )
        }),
      ])
      return { result, problems, taintReports }
    } catch (error) {
      console.error('frame-surface gate debug:', await page.evaluate(() => window.__frameSurfaceGate.debug()))
      throw error
    } finally {
      clearTimeout(gateTimeout)
      await page.close()
    }
  }

  function report(backend, result) {
    const receiptTrace = result.receipts
      .map(
        ({ receipt }) =>
          `${receipt.frame.generation}@source-${receipt.frame.sourceId}/epoch-${receipt.surfaceEpoch}`,
      )
      .join(', ')
    const log = (line) => console.log(`frame-surface [${backend}]: ${line}`)
    log(`backend started ${result.backend ?? 'unknown'}`)
    log(`receipts [${receiptTrace}]`)
    log(
      `replacement renders ${result.replacementRenderSamples.length}, ` +
        `clear frames ${result.replacementClearFrames}, stale old-source receipts ` +
        `${result.staleOldSourceReceipts}`,
    )
    for (const acquisition of result.acquisitionEvidence) {
      log(
        `reacquire ${acquisition.cycle} published ` +
          `[${acquisition.publishedGenerations.join(', ')}] while released ` +
          `${acquisition.releasedSurfaceAbsent ? 'yes' : 'NO'}, receipt ` +
          `${acquisition.receiptGeneration}@epoch-${acquisition.surfaceEpoch}, renders ` +
          `${acquisition.renderSamples}, clear ${acquisition.clearFrames}, mismatched ` +
          `${acquisition.mismatchedFrames}, RGB error ${acquisition.receiptRgbError}, ` +
          `mesh/material/geometry ${acquisition.meshId}/${acquisition.materialId}/` +
          `${acquisition.geometryId}`,
      )
    }
    log(
      `live replacement identity ` +
        `${result.liveReplacementIdentityPreserved ? 'preserved' : 'changed'}, ` +
        `worst RGB error ${result.worstRgbError}`,
    )
    log(
      `presentation fence frame receipts ` +
        `${result.presentationFence.frameReceipts.length}, presentation receipts ` +
        `${result.presentationFence.presentationReceipts.length}, disabled clear ` +
        `${result.presentationFence.disabledDefaultClear ? 'yes' : 'NO'}, offscreen drew ` +
        `${result.presentationFence.offscreenHadPixels ? 'yes' : 'NO'}, offscreen RGB error ` +
        `${result.presentationFence.offscreenRgbError}, visible RGB error ` +
        `${result.presentationFence.visibleRgbError}`,
    )
    log(
      `tainted source renders ${result.taintedSource.taintedRenders}, clear ` +
        `${result.taintedSource.taintedClear ? 'yes' : 'NO'}, frame/presentation receipts ` +
        `${result.taintedSource.taintedFrameReceipts}/${result.taintedSource.taintedPresentationReceipts}; ` +
        `recovered generations [${result.taintedSource.recoveredGenerations.join(', ')}], RGB error ` +
        `${result.taintedSource.recoveredRgbError}, presentation receipts ` +
        `${result.taintedSource.recoveredPresentationReceipts}`,
    )
    log(
      `backing-store resize generations ` +
        `[${result.backingStoreResize.generations.join(', ')}], size ` +
        `${result.backingStoreResize.finalWidth}x${result.backingStoreResize.finalHeight}, ` +
        `same texture ${result.backingStoreResize.sameTexture ? 'yes' : 'NO'}, RGB errors ` +
        `[${result.backingStoreResize.rgbErrors.join(', ')}]`,
    )
  }

  const failures = []
  for (const backend of ['webgpu', 'webgl2']) {
    const { result, problems, taintReports } = await runPage(`backend=${backend}`)
    report(backend, result)
    if (taintReports !== 1) {
      failures.push(`${backend}: expected one tainted-source report, saw ${taintReports}`)
      continue
    }
    if (problems.length) {
      failures.push(`${backend}: page errors during the run:\n  ${problems.join('\n  ')}`)
      continue
    }
    if (!result.passed) {
      failures.push(`${backend}: gate failed\n${JSON.stringify(result, null, 2)}`)
      continue
    }

    // Each control must fail. A control that passes means the oracle cannot
    // see the fault it exists to catch.
    const tone = (await runPage(`backend=${backend}&rendererToneMapping`)).result
    if (tone.passed || !Number.isFinite(tone.worstRgbError) || tone.worstRgbError <= 1) {
      failures.push(`${backend}: color oracle did not reject renderer tone mapping of captured colors`)
    } else {
      console.log(`frame-surface [${backend}]: tone-mapping fault rejected, RGB error ${tone.worstRgbError}`)
    }
    const stale = (await runPage(`backend=${backend}&staleSample`)).result
    if (stale.passed || stale.worstRgbError <= 1) {
      failures.push(`${backend}: pixel oracle did not reject samples of the previous frame`)
    } else {
      console.log(`frame-surface [${backend}]: stale-sample fault rejected, RGB error ${stale.worstRgbError}`)
    }
  }

  if (failures.length) {
    for (const failure of failures) console.error(`frame-surface gate FAILED: ${failure}`)
    process.exitCode = 1
  } else {
    console.log(
      'frame-surface gate PASSED on webgpu and webgl2: visible presentation, live replacement, and 3 handoff cycles kept current sRGB pixels.',
    )
  }
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
  images?.close()
}
