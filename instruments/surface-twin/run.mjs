// DOM-side Twin acceptance on the real Gold and Veil routes.
//
// Gold pins match-DOM at two viewport sizes and one accessible instance.
// Veil pins source/page duplication, resize recovery, and shader health.

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
  const message = `surface-twin gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message)
  process.exit(strict ? 1 : 0)
}

if (!chromePath) skip('no Chrome executable found (set CHROME_PATH)')

let browser
let server
const deadline = setTimeout(() => {
  console.error('surface-twin gate: hard 120s deadline hit')
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
    () => 'drawElementImage' in document.createElement('canvas').getContext('2d'),
  )
  await probe.close()
  if (!capable) skip(`Chrome at ${chromePath} has no drawElementImage`)

  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
      errors.push(message.text())
    }
  })

  // The Twin on the Gold route is `bronze-twin`: it declares no `view`, so
  // its page copy keeps the hold forever and its mesh is an additional
  // presentation of it. The exclusive Surfaces beside it are the
  // surface-canvas gate's subject, not this one's.
  const goldMatch = () => page.evaluate(() => {
    const button = [...document.querySelectorAll('[data-bronze-card]')].find(
      (element) => !element.closest('[data-munari-source-host]'),
    )
    const state = window.__r3f
    if (!(button instanceof HTMLElement) || !state?.scene || !state.camera) return null
    const sourceCanvas = document.querySelector(
      '[data-munari-source-host][data-munari-surface="bronze-twin"]',
    )?.parentElement
    let mesh = null
    state.scene.traverse((object) => {
      if (!object.isMesh) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      if (materials.some((material) => material?.map?.image === sourceCanvas)) mesh = object
    })
    const canvas = state.gl?.domElement
    if (!mesh || !(canvas instanceof HTMLCanvasElement)) return null
    mesh.geometry.computeBoundingBox()
    const box = mesh.geometry.boundingBox
    if (!box) return null
    mesh.updateWorldMatrix(true, false)
    state.camera.updateMatrixWorld()
    const canvasRect = canvas.getBoundingClientRect()
    const points = []
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        const point = { x, y, z: 0 }
        const vector = mesh.position.clone().set(point.x, point.y, point.z)
        vector.applyMatrix4(mesh.matrixWorld).project(state.camera)
        points.push({
          x: canvasRect.left + ((vector.x + 1) * canvasRect.width) / 2,
          y: canvasRect.top + ((1 - vector.y) * canvasRect.height) / 2,
        })
      }
    }
    const holder = button.getBoundingClientRect()
    const gl = {
      left: Math.min(...points.map((point) => point.x)),
      right: Math.max(...points.map((point) => point.x)),
      top: Math.min(...points.map((point) => point.y)),
      bottom: Math.max(...points.map((point) => point.y)),
    }
    return {
      delta: Math.max(
        Math.abs(gl.left - holder.left),
        Math.abs(gl.right - holder.right),
        Math.abs(gl.top - holder.top),
        Math.abs(gl.bottom - holder.bottom),
      ),
      // The parked copy is reached through its container, which is what
      // carries `aria-hidden` — the card itself says nothing about which
      // instance it is.
      pageButtons: [...document.querySelectorAll('[data-bronze-card]')].filter(
        (element) => !element.closest('[data-munari-source-host]'),
      ).length,
      hiddenSources: document.querySelectorAll(
        '[data-munari-source-host][data-munari-surface="bronze-twin"][aria-hidden="true"]',
      ).length,
    }
  })

  await page.setViewport({ width: 1200, height: 820, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:${port}/?scene=gold&bare`, { waitUntil: 'load' })
  await page.waitForFunction(() => {
    const source = document.querySelector('[data-munari-source-host][data-munari-surface="bronze-twin"]')
    return source?.getAttribute('aria-hidden') === 'true' && window.__r3f?.scene
  }, { timeout: 20_000 })
  await page.waitForFunction(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
    return true
  })
  let match = await goldMatch()
  if (!match || match.delta > 1.5) errors.push(`Gold initial match-DOM delta ${match?.delta ?? 'missing'}px`)
  if (match?.pageButtons !== 1 || match.hiddenSources !== 1) {
    errors.push(`Gold accessible instances: page ${match?.pageButtons}, hidden source ${match?.hiddenSources}`)
  }
  await page.$eval('[data-gold-button]:not([aria-hidden="true"])', (button) => button.click())
  await page.waitForFunction(
    () =>
      document.querySelector('[data-gold-button]:not([aria-hidden="true"])')?.textContent ===
      'Gold accepted',
  )
  await page.setViewport({ width: 913, height: 677, deviceScaleFactor: 3 })
  await sleep(250)
  match = await goldMatch()
  if (!match || match.delta > 1.5) errors.push(`Gold resized match-DOM delta ${match?.delta ?? 'missing'}px`)

  await page.goto(`http://localhost:${port}/?scene=veil&bare`, { waitUntil: 'load' })
  await page.waitForSelector('.veil-page', { timeout: 20_000 })
  await sleep(2_000)
  const before = await page.evaluate(() => ({
    sources: document.querySelectorAll('[data-munari-source-host]').length,
    hiddenSources: document.querySelectorAll('[data-munari-source-host][aria-hidden="true"]').length,
    pageSheets: [...document.querySelectorAll('.veil-sheet')].filter(
      (element) => !element.closest('[data-munari-source-host]'),
    ).length,
    log: window.__veilGateLog?.length ?? 0,
    accepted: window.__veilGateLog?.some((entry) => entry.matched && entry.gate > 0.95) ?? false,
    last: window.__veilGateLog?.at(-1) ?? null,
  }))
  if (before.sources !== 1 || before.hiddenSources !== 1 || before.pageSheets !== 1) {
    errors.push(
      `Veil instances: sources ${before.sources}, hidden ${before.hiddenSources}, page ${before.pageSheets}`,
    )
  }
  if (!before.accepted) errors.push(`Veil initial gate did not open: ${JSON.stringify(before.last)}`)
  if (before.log === 0) errors.push(`Veil mounted no frames: ${JSON.stringify(before)}`)
  await page.setViewport({ width: 1047, height: 733, deviceScaleFactor: 1 })
  await page.evaluate(() => {
    const page = document.querySelector('.veil-page')
    if (page) page.scrollTop = 480.5
  })
  await sleep(1_000)
  const after = await page.evaluate((from) => ({
    accepted: window.__veilGateLog?.slice(from).some((entry) => entry.matched && entry.gate > 0.95) ?? false,
    last: window.__veilGateLog?.at(-1) ?? null,
  }), before.log)
  if (!after.accepted) errors.push(`Veil resized gate did not reopen: ${JSON.stringify(after.last)}`)

  for (const route of [
    { scene: 'workspace', sources: 33, ledgers: 33 },
    // Six labels use owned source hosts; six plates are adopted elements.
    { scene: 'explode', sources: 6, ledgers: 12 },
    { scene: 'glass', sources: 3, ledgers: 3 },
    { scene: 'optics', sources: 6, ledgers: 6 },
  ]) {
    await page.goto(`http://localhost:${port}/?scene=${route.scene}`, { waitUntil: 'load' })
    await page.waitForSelector('[data-munari-source-host]', { timeout: 20_000 })
    await sleep(1_000)
    const sources = await page.$$eval(
      '[data-munari-source-host]',
      (elements) => elements.length,
    )
    if (sources < route.sources) {
      errors.push(`${route.scene}: mounted ${sources} sources, expected at least ${route.sources}`)
    }
    const ledgers = await page.evaluate(() => window.__munari?.stats?.().length ?? -1)
    if (ledgers < route.ledgers) {
      errors.push(`${route.scene}: mounted ${ledgers} paint ledgers, expected at least ${route.ledgers}`)
    }
    if (route.scene === 'workspace') {
      const providers = await page.$$eval(
        '[data-surface-provider="lab"]',
        (elements) => elements.length,
      )
      if (providers !== 33) errors.push(`workspace: provider reached ${providers} of 33 sources`)
    }
  }

  if (errors.length) {
    console.error(`surface-twin gate FAILED (${errors.length})`)
    for (const error of errors) console.error(`  - ${error}`)
    process.exitCode = 1
  } else {
    console.log(
      'surface-twin gate PASSED: Gold and Veil are healthy; Workspace, Explode, Glass, and Optics mount',
    )
  }
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
