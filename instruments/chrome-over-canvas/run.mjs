// chrome-over-canvas gate — page UI painted above a `pointerMode="surfaces"`
// canvas must still receive clicks where it overlaps Surface matter.
//
// CanvasPointerGate decides who owns a press by raycasting the pointer's
// screen coordinates against the scene's matter. A raycast answers in scene
// coordinates and knows nothing about what the browser paints on top at the
// same point, so a press on a toolbar, a menu, or a tuning panel over the
// mesh was claimed by the gate, stopped in the document capture phase, and
// its follow-up click swallowed by the 8px suppressor. Hover kept working
// throughout, because hover never consults the raycast, which is what made
// it look like a React state fault rather than a pointer one (2026-08-23).
//
// The scene is refraction: mid-crossing it holds one mesh spanning the
// stage, and the lab's tuning panel overlaps that mesh's right edge.
//
// The `crossing` header is the control. It sits above the mesh, so it must
// open in every build — if it ever fails, the probe is broken and the
// `aperture`/`room` answers below it mean nothing.

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
  const message = `chrome-over-canvas gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message)
  process.exit(strict ? 1 : 0)
}

if (!chromePath) skip('no Chrome executable found (set CHROME_PATH)')

// 1280x900 puts the stage row (caption 300 + gap 88 + stage 560) centred so
// the holder's right edge lands at x=1114 and the panel spans 964..1264.
// The overlap is 964..1114 — 150px wide, and the panel's own centre sits on
// its far edge, which is why the aim below is the header's left end.
const VIEWPORT = { width: 1280, height: 900 }
const AIM_INSET = 20

let browser
let server
const deadline = setTimeout(() => {
  console.error('chrome-over-canvas gate: hard 120s deadline hit')
  process.exit(1)
}, 120_000)

try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--enable-features=CanvasDrawElement',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })

  const cap = await browser.newPage()
  const capable = await cap.evaluate(
    () => 'drawElementImage' in document.createElement('canvas').getContext('2d'),
  )
  await cap.close()
  if (!capable) skip(`Chrome at ${chromePath} has no drawElementImage`)

  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  const page = await browser.newPage()
  await page.setViewport(VIEWPORT)
  await page.goto(`http://localhost:${port}/?scene=refraction`, { waitUntil: 'load' })
  await sleep(2500)

  // Park the crossing mid-flight. React owns the input, so the value goes in
  // through the prototype setter or the controlled input snaps back.
  await page.evaluate(() => {
    const el = document.querySelector('.refraction-scrub')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, '0.5')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(600)

  await page.evaluate(() => {
    const toggle = [...document.querySelectorAll('button')]
      .find((b) => b.textContent.trim().endsWith('tweaks'))
    if (toggle) toggle.click()
  })
  await sleep(400)

  const meshes = await page.evaluate(() => {
    const found = []
    window.__r3f?.scene?.traverse((o) => { if (o.isMesh) found.push(o.type) })
    return found
  })
  if (meshes.length === 0)
    throw new Error('no mesh in the scene mid-crossing — nothing for a press to be stolen by')

  const header = (label) =>
    page.evaluate((l) => {
      const b = [...document.querySelectorAll('button[aria-expanded]')]
        .find((x) => x.textContent.toLowerCase().includes(l))
      if (!b) return null
      const r = b.getBoundingClientRect()
      return {
        left: r.left, top: r.top, height: r.height,
        expanded: b.getAttribute('aria-expanded'),
      }
    }, label)

  const results = []
  for (const label of ['crossing', 'aperture', 'room']) {
    const before = await header(label)
    if (!before) throw new Error(`no "${label}" header in the tuning panel`)
    const x = Math.round(before.left + AIM_INSET)
    const y = Math.round(before.top + before.height / 2)
    await page.mouse.click(x, y)
    await sleep(400)
    const after = await header(label)
    results.push({ label, at: [x, y], before: before.expanded, after: after.expanded })
  }

  console.log('chrome-over-canvas:')
  for (const r of results)
    console.log(`  ${r.label.padEnd(9)} at ${String(r.at)}  ${r.before} -> ${r.after}`)

  const control = results.find((r) => r.label === 'crossing')
  if (control.after !== 'true')
    throw new Error('control failed: the "crossing" header sits above the mesh and must always open — the probe is broken, not the gate')

  const stolen = results.filter((r) => r.label !== 'crossing' && r.after !== 'true')
  if (stolen.length > 0)
    throw new Error(
      `${stolen.length} header(s) over the mesh never opened: ${stolen.map((s) => s.label).join(', ')}. ` +
      'CanvasPointerGate claimed a press that belonged to page chrome painted above the canvas.',
    )

  console.log('chrome-over-canvas gate PASSED')
} catch (error) {
  console.error(`chrome-over-canvas gate FAILED: ${error.message}`)
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
