// Knobs resize alignment — live DOM layout and physical hardware agree.
//
// The panel crosses from a 721px one-column arrangement to a 463px
// two-column arrangement at 480px. On 2026-08-18 its slab resized in the
// pointer event but Surface anchors stayed on the previous geometry until a
// later frame. This probes every drag step, including that breakpoint.

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
const MAX_MARKER_ERROR = 24 // px; physical marker depth accounts for the resting offset

function skip(reason) {
  const message = `knobs-resize gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message)
  process.exit(strict ? 1 : 0)
}

if (!chromePath) skip('no Chrome executable found (set CHROME_PATH)')

let browser
let server
const deadline = setTimeout(() => {
  console.error('knobs-resize gate: hard 120s deadline hit')
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
  const capability = await browser.newPage()
  const capable = await capability.evaluate(
    () => 'drawElementImage' in document.createElement('canvas').getContext('2d'),
  )
  await capability.close()
  if (!capable) skip(`Chrome at ${chromePath} has no drawElementImage`)

  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 820, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))

  await page.goto(`http://localhost:${port}/?scene=knobs&probe=knobs-resize&bare`, {
    waitUntil: 'load',
  })
  await page.waitForFunction(
    () => Boolean(window.__knobsResizeProbe && window.__r3f?.scene),
    { timeout: 20_000 },
  )

  const resizePoint = await page.evaluate(() => {
    const host = document.querySelector('[data-munari-surface="knobs-panel"]')
    const target = host?.querySelector('[data-munari-anchor="panel:resize"]')
    const mesh = window.__r3f.scene.getObjectByName('knobs-panel-surface')
    if (!host || !target || !mesh) return null
    mesh.geometry.computeBoundingBox()
    const box = mesh.geometry.boundingBox
    if (!box) return null
    const hostRect = host.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const u = (targetRect.left + targetRect.width / 2 - hostRect.left) / hostRect.width
    const v = (targetRect.top + targetRect.height / 2 - hostRect.top) / hostRect.height
    const point = mesh.position.clone().set(
      box.min.x + (box.max.x - box.min.x) * u,
      box.max.y - (box.max.y - box.min.y) * v,
      0,
    )
    mesh.localToWorld(point).project(window.__r3f.camera)
    const canvas = window.__r3f.gl.domElement.getBoundingClientRect()
    return {
      x: canvas.left + ((point.x + 1) / 2) * canvas.width,
      y: canvas.top + ((1 - point.y) / 2) * canvas.height,
    }
  })
  if (!resizePoint) throw new Error('knobs-resize: missing resize handle')

  const sample = () =>
    page.evaluate(() => {
      const host = document.querySelector('[data-munari-surface="knobs-panel"]')
      const marker = host?.querySelector('[data-knobs-resize-marker="source"]')
      const mesh = window.__r3f.scene.getObjectByName('knobs-panel-surface')
      const glMarker = window.__knobsResizeProbe.snapshot().projectedHue
      const readout = window.__r3f.scene.getObjectByName('knobs-readout-hue')
      const readoutSource = host?.querySelector('[data-munari-anchor="readout:hue"]')
      if (!host || !marker || !mesh || !glMarker || !readout || !readoutSource) return null
      mesh.geometry.computeBoundingBox()
      const box = mesh.geometry.boundingBox
      if (!box) return null
      const hostRect = host.getBoundingClientRect()
      const markerRect = marker.getBoundingClientRect()
      const u = (markerRect.left + markerRect.width / 2 - hostRect.left) / hostRect.width
      const v = (markerRect.top + markerRect.height / 2 - hostRect.top) / hostRect.height
      const point = mesh.position.clone().set(
        box.min.x + (box.max.x - box.min.x) * u,
        box.max.y - (box.max.y - box.min.y) * v,
        0,
      )
      mesh.localToWorld(point).project(window.__r3f.camera)
      const canvas = window.__r3f.gl.domElement.getBoundingClientRect()
      const expected = {
        x: canvas.left + ((point.x + 1) / 2) * canvas.width,
        y: canvas.top + ((1 - point.y) / 2) * canvas.height,
      }
      const readoutRect = readoutSource.getBoundingClientRect()
      const readoutU = (readoutRect.left + readoutRect.width / 2 - hostRect.left) / hostRect.width
      const readoutV = (readoutRect.top + readoutRect.height / 2 - hostRect.top) / hostRect.height
      const readoutPoint = mesh.position.clone().set(
        box.min.x + (box.max.x - box.min.x) * readoutU,
        box.max.y - (box.max.y - box.min.y) * readoutV,
        0,
      )
      mesh.localToWorld(readoutPoint).project(window.__r3f.camera)
      const actualReadout = readout.getWorldPosition(readout.position.clone()).project(window.__r3f.camera)
      return {
        width: hostRect.width,
        height: hostRect.height,
        geometry: { width: mesh.geometry.parameters.width, height: mesh.geometry.parameters.height },
        markerError: Math.hypot(expected.x - glMarker.x, expected.y - glMarker.y),
        readoutError: Math.hypot(
          canvas.left + ((readoutPoint.x + 1) / 2) * canvas.width -
            (canvas.left + ((actualReadout.x + 1) / 2) * canvas.width),
          canvas.top + ((1 - readoutPoint.y) / 2) * canvas.height -
            (canvas.top + ((1 - actualReadout.y) / 2) * canvas.height),
        ),
      }
    })

  const samples = []
  await page.mouse.move(resizePoint.x, resizePoint.y)
  await page.mouse.down()
  for (const dx of [-70, -50, -30, -10, 10, 30, 50, 70, 90, 110, 130, 150, 170, 190]) {
    await page.mouse.move(resizePoint.x + dx, resizePoint.y)
    // The first frame coalesces the pointer stream and commits one complete
    // layout. The second is the R3F frame that can present that commit.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    const next = await sample()
    if (next) samples.push(next)
  }
  await page.mouse.up()
  await page.waitForFunction(
    () => Boolean(window.__r3f.scene.getObjectByName('knobs-readout-hue')),
    { timeout: 5_000 },
  )

  const problems = []
  if (!samples.some((entry) => entry.height < 500)) {
    problems.push(
      `the probe never crossed into the two-column layout (${samples.map((entry) => `${entry.width}×${entry.height}`).join(', ') || 'no samples'})`,
    )
  }
  for (const [index, entry] of samples.entries()) {
    if (
      Math.abs(entry.width - entry.geometry.width) > 0.5 ||
      Math.abs(entry.height - entry.geometry.height) > 0.5
    ) {
      problems.push(
        `step ${index}: mesh ${entry.geometry.width}×${entry.geometry.height} differs from DOM ${entry.width}×${entry.height}`,
      )
    }
    if (entry.markerError > MAX_MARKER_ERROR) {
      problems.push(`step ${index}: hardware marker drifted ${entry.markerError.toFixed(1)}px`)
    }
    if (entry.readoutError > MAX_MARKER_ERROR) {
      problems.push(`step ${index}: readout drifted ${entry.readoutError.toFixed(1)}px`)
    }
  }
  if (errors.length) problems.push(...errors.map((error) => `page error: ${error}`))

  if (problems.length) {
    console.error(`knobs-resize gate FAILED (${problems.length})`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
  } else {
    const maxError = Math.max(...samples.map((entry) => Math.max(entry.markerError, entry.readoutError)))
    console.log(
      `knobs-resize gate PASSED: ${samples.length} steps, max marker drift ${maxError.toFixed(1)}px`,
    )
  }
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
