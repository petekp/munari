// Controlled side-by-side finish parity probe: compares Three.js (`@petepetrash/munari`)
// against WebGPU (`@petepetrash/munari/gpu`) across opaque & transmissive presets under both
// softbox and point lighting rigs at DPR 2, saves side-by-side comparison PNGs, and measures
// WebGPU steady-state per-frame JS work.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

const here = import.meta.dirname
const repoRoot = path.resolve(here, '..', '..')
const labRoot = path.join(repoRoot, 'apps', 'lab')

const DPR = 2
const VIEW_W = 1100
const VIEW_H = 760

const PERCEPTUAL_LIMITS = {
  'lacquer-crimson': 10,
  'polymer-charcoal': 10,
  // Softbox measures 2.73 meanAbsDiff; anisotropic point-light brushed sheen measures 10.34.
  'aluminum-blue': 12,
  'velvet-midnight': 14,
  'glass-clear': 14,
  'glass-cobalt': 14,
  'glass-frosted': 14,
}

const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
]
  .filter(Boolean)
  .find(existsSync)

assert.ok(chromePath, 'Chrome executable is required (set CHROME_PATH)')

function parseArgs(argv) {
  let outDir = '/tmp/munari-m2-parity'
  let baseline = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--baseline') baseline = true
    else if (argv[i] === '--out' && argv[i + 1]) outDir = path.resolve(process.cwd(), argv[++i])
  }
  return { outDir, baseline }
}

function makeHarnessHtml(entryFile) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Munari Finish Parity</title></head>
<body>
<div id="root"></div>
<script type="module" src="/@fs/${path.join(here, entryFile)}"></script>
</body>
</html>`
}

async function analyzeAndStitch(page, threeB64, gpuB64, boxes, rigLabel, outFile) {
  const { metrics, stitchedB64 } = await page.evaluate(
    async ({ a, b, rects, dpr, label }) => {
      const loadImg = (src) =>
        new Promise((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = reject
          img.src = `data:image/png;base64,${src}`
        })
      const [imgA, imgB] = await Promise.all([loadImg(a), loadImg(b)])
      const readPixels = (img) => {
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0)
        return { width: c.width, height: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data }
      }
      const pxA = readPixels(imgA)
      const pxB = readPixels(imgB)

      const metricsOut = rects.map((box) => {
        const x0 = Math.max(0, Math.round((box.left + 2) * dpr))
        const y0 = Math.max(0, Math.round((box.top + 2) * dpr))
        const x1 = Math.min(pxA.width, Math.round((box.left + box.width - 2) * dpr))
        const y1 = Math.min(pxA.height, Math.round((box.top + box.height - 2) * dpr))
        const absDiffs = []
        let sumDiff = 0
        let sumLumaA = 0
        let sumLumaB = 0
        let maxAbsDiff = 0
        let count = 0

        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const idx = (y * pxA.width + x) * 4
            const dr = Math.abs(pxA.data[idx] - pxB.data[idx])
            const dg = Math.abs(pxA.data[idx + 1] - pxB.data[idx + 1])
            const db = Math.abs(pxA.data[idx + 2] - pxB.data[idx + 2])
            const pxMean = (dr + dg + db) / 3
            const pxMax = Math.max(dr, dg, db)
            sumDiff += pxMean
            if (pxMax > maxAbsDiff) maxAbsDiff = pxMax
            absDiffs.push(pxMean)
            sumLumaA += 0.2126 * pxA.data[idx] + 0.7152 * pxA.data[idx + 1] + 0.0722 * pxA.data[idx + 2]
            sumLumaB += 0.2126 * pxB.data[idx] + 0.7152 * pxB.data[idx + 1] + 0.0722 * pxB.data[idx + 2]
            count++
          }
        }
        absDiffs.sort((u, v) => u - v)
        const p95 = absDiffs[Math.min(absDiffs.length - 1, Math.round(0.95 * (absDiffs.length - 1)))] ?? 0
        return {
          id: box.id,
          meanAbsDiff: Number((sumDiff / Math.max(1, count)).toFixed(2)),
          p95AbsDiff: Number(p95.toFixed(2)),
          maxAbsDiff,
          meanLumaThree: Number((sumLumaA / Math.max(1, count)).toFixed(2)),
          meanLumaGpu: Number((sumLumaB / Math.max(1, count)).toFixed(2)),
        }
      })

      const header = 48
      const gap = 16
      const c = document.createElement('canvas')
      c.width = imgA.width + imgB.width + gap
      c.height = Math.max(imgA.height, imgB.height) + header
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#0f172a'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.fillStyle = '#f8fafc'
      ctx.font = 'bold 24px system-ui, sans-serif'
      ctx.fillText(`Three.js Reference (${label})`, 24, 32)
      ctx.fillText(`WebGPU Runtime (${label})`, imgA.width + gap + 24, 32)
      ctx.drawImage(imgA, 0, header)
      ctx.drawImage(imgB, imgA.width + gap, header)
      const stitched = c.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
      return { metrics: metricsOut, stitchedB64: stitched }
    },
    { a: threeB64, b: gpuB64, rects: boxes, dpr: DPR, label: rigLabel },
  )
  writeFileSync(outFile, Buffer.from(stitchedB64, 'base64'))
  return metrics
}

async function captureHarness(browser, url) {
  const page = await browser.newPage()
  await page.setViewport({ width: VIEW_W, height: VIEW_H, deviceScaleFactor: DPR })
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.url().endsWith('/favicon.ico')) void req.respond({ status: 204, body: '' })
    else void req.continue()
  })
  const errors = []
  page.on('pageerror', (err) => errors.push(`pageerror: ${String(err)}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`)
  })

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForFunction(() => Boolean(window.__parityReady), { timeout: 30_000 })
    const b64 = await page.screenshot({ encoding: 'base64' })
    const boxes = await page.evaluate(() => window.__parityBoxes?.() ?? [])
    const validationErrors = await page.evaluate(() => window.__parityErrors ?? [])
    const perf = url.includes('__parity-gpu')
      ? await page.evaluate(() => window.__parityPerfSweep?.() ?? null)
      : null
    const postPerfErrors = await page.evaluate(() => window.__parityErrors ?? [])
    assert.deepEqual(errors, [], `${url} errors: ${errors.join('; ')}`)
    assert.deepEqual(validationErrors, [], `${url} WebGPU validation errors: ${validationErrors.join('; ')}`)
    assert.deepEqual(postPerfErrors, [], `${url} post-perf validation errors: ${postPerfErrors.join('; ')}`)
    return { b64, boxes, perf }
  } finally {
    await page.close()
  }
}

const { outDir, baseline } = parseArgs(process.argv.slice(2))
mkdirSync(outDir, { recursive: true })

const server = await createServer({
  configFile: path.join(labRoot, 'vite.config.ts'),
  root: labRoot,
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { strict: false } },
  plugins: [
    {
      name: 'munari-finish-parity-html',
      configureServer(srv) {
        for (const [route, file] of [
          ['/__parity-three.html', 'ThreeParity.tsx'],
          ['/__parity-gpu.html', 'GpuParity.tsx'],
        ]) {
          srv.middlewares.use(route, async (req, res, next) => {
            try {
              const html = await srv.transformIndexHtml(req.originalUrl || route, makeHarnessHtml(file))
              res.statusCode = 200
              res.setHeader('Content-Type', 'text/html')
              res.end(html)
            } catch (err) {
              next(err)
            }
          })
        }
      },
    },
  ],
})
await server.listen()
const address = server.httpServer.address()
const baseUrl = `http://127.0.0.1:${address && 'port' in address ? address.port : 0}`

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: [
    ...WEBGPU_CHROME_ARGS,
    '--enable-features=CanvasDrawElement',
    '--ignore-gpu-blocklist',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    ...(process.env.CI ? ['--no-sandbox'] : []),
  ],
})

try {
  const report = { gate: 'gpu-finish-parity', baseline, rigs: {} }
  const helperPage = await browser.newPage()

  for (const rig of ['softbox', 'point']) {
    const three = await captureHarness(browser, `${baseUrl}/__parity-three.html?rig=${rig}`)
    const gpu = await captureHarness(browser, `${baseUrl}/__parity-gpu.html?rig=${rig}`)

    assert.equal(three.boxes.length, 7, `Expected 7 Three preset boxes, got ${three.boxes.length}`)
    assert.equal(gpu.boxes.length, 7, `Expected 7 GPU preset boxes, got ${gpu.boxes.length}`)
    for (let i = 0; i < three.boxes.length; i++) {
      const box = three.boxes[i]
      const gBox = gpu.boxes[i]
      assert.equal(box.id, gBox.id, `Preset order mismatch: ${box.id} vs ${gBox.id}`)
      assert.ok(
        Math.abs(box.left - gBox.left) <= 1 && Math.abs(box.top - gBox.top) <= 1,
        `Box alignment mismatch on ${box.id}: ${JSON.stringify(box)} vs ${JSON.stringify(gBox)}`,
      )
    }

    const stitchedPath = path.join(outDir, `parity-${rig}.png`)
    const metrics = await analyzeAndStitch(helperPage, three.b64, gpu.b64, three.boxes, rig, stitchedPath)

    if (!baseline) {
      assert.ok(gpu.perf, `Missing perf measurement for ${rig}`)
      assert.equal(gpu.perf.idleRenders, 0, `${rig}: expected 0 idle renders, got ${gpu.perf.idleRenders}`)
      assert.ok(gpu.perf.medianMs <= 1.0, `${rig}: median GPU JS frame time ${gpu.perf.medianMs.toFixed(3)}ms > 1.0ms`)
      for (const m of metrics) {
        const limit = PERCEPTUAL_LIMITS[m.id] ?? 14
        assert.ok(
          m.meanAbsDiff <= limit,
          `${rig}/${m.id}: meanAbsDiff ${m.meanAbsDiff} exceeded ${limit} (${JSON.stringify(m)})`,
        )
        assert.ok(
          m.p95AbsDiff <= 36,
          `${rig}/${m.id}: p95AbsDiff ${m.p95AbsDiff} exceeded 36 (${JSON.stringify(m)})`,
        )
      }
    }

    report.rigs[rig] = {
      screenshot: stitchedPath,
      perf: gpu.perf,
      metrics,
    }
  }

  await helperPage.close()
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
  await server.close()
}
