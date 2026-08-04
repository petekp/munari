// The mesh-vs-DOM sharpness instrument.
//
// The recipe this file replaces was prose, and the prose was re-derived
// by hand three times in one session before it was right. The trap it
// keeps falling into is that "does this look sharp" has no answer: a
// mesh rendering of an element is only ever sharp or soft RELATIVE to
// the element, at the same size, in the same place, on the same
// display. So this drives the lab to a state where the mesh is standing
// exactly where the DOM was, photographs both, and reports a ratio.
//
// The subject is the passage scene's SMALL endpoint held at t = 0. That
// is not an arbitrary pick — it is the one frame in the whole
// transition where the mesh and the page show the same type at the same
// size one after the other, which is why a defect there is visible and
// the same defect anywhere else is not.
//
// Capability policy and launch flags are idle-zero's, for its reasons:
// drawElementImage is an origin-trial API so its absence is
// environmental, and a throttled renderer must never be allowed to
// manufacture a result.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
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

/**
 * Parity floor. The two live readings this was built from are 0.841
 * (the reported defect) and 1.001 (the fix), so a floor between them is
 * the only kind that means anything — see the contract in
 * gradientEnergy.test.ts.
 */
const FLOOR = Number(process.env.SHARPNESS_FLOOR ?? 0.93)

/**
 * The band, in card-local CSS px from its top-left. Typography only: the
 * card's header carries a live frame counter that the DOM is running and
 * the mesh at t = 0 has not drawn yet, and including it contaminated the
 * ratio by more than the defect being hunted.
 */
const BAND = { x: 0, y: 178, width: 308, height: 146 }

const VIEWPORT = { width: 1280, height: 720, deviceScaleFactor: 2 }

function skip(reason) {
  const msg = `sharpness instrument SKIPPED: ${reason}`
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
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  ...(process.env.CI ? ['--no-sandbox'] : []),
]

const launch = (headless) =>
  puppeteer.launch({ executablePath: chromePath, headless, args: LAUNCH_ARGS })

async function probeCapability(browser) {
  const page = await browser.newPage()
  const capable = await page.evaluate(
    () => typeof document.createElement('canvas').getContext('2d').drawElementImage === 'function',
  )
  await page.close()
  return capable
}

let server
let browser
const deadline = setTimeout(() => {
  console.error('sharpness instrument: hard 120s deadline hit')
  process.exit(1)
}, 120_000)

try {
  browser = await launch(true)
  let capable = await probeCapability(browser)
  if (!capable && !process.env.CI) {
    await browser.close()
    browser = await launch(false)
    capable = await probeCapability(browser)
    if (capable) console.log('sharpness: capability present headed only — measuring headed')
  }
  if (!capable) {
    await browser.close()
    skip(`Chrome at ${chromePath} has no drawElementImage even with the feature flag`)
  }

  // The arithmetic is a module with its own contract; the runner is
  // transport. Loading it through vite is what lets the two stay one
  // TypeScript source rather than a copy in each.
  server = await createServer({
    configFile: path.join(repoRoot, 'apps', 'lab', 'vite.config.ts'),
    root: path.join(repoRoot, 'apps', 'lab'),
    logLevel: 'warn',
    server: { port: 0 },
  })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port
  const { sharpnessRatio } = await server.ssrLoadModule(
    path.join(here, 'gradientEnergy.ts'),
  )

  const page = await browser.newPage()
  await page.setViewport(VIEWPORT)
  const pageProblems = []
  page.on('pageerror', (err) => pageProblems.push(String(err)))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
      pageProblems.push(m.text())
  })

  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' })

  // The lab switches scenes by chip, not by URL.
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'passage'),
    { timeout: 20_000 },
  )
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'passage')?.click()
  })
  await page.waitForFunction(() => !!window.__passage, { timeout: 20_000 })

  // The tile's rect BEFORE the open hides it. Both photographs are
  // clipped to this, which is the entire reason the ratio means
  // anything: same pixels, same size, same place.
  const rect = await page.evaluate(async () => {
    const p = window.__passage
    p.debug.hold = null
    if (p.route() || p.pass()) {
      p.back()
      await new Promise((r) => setTimeout(r, 1800))
    }
    const el = document.querySelector('.psg-card')
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
  })

  /** The DOM reference first, while nothing is flying. */
  const domShot = await page.screenshot({ clip: rect, encoding: 'base64' })

  // Now the mesh, standing in the same rect. `hold` pins the flight at
  // t = 0 so the small endpoint is what is drawn, and the open is what
  // hides the page copy — so the two photographs differ in exactly one
  // thing, which is who drew the card.
  await page.evaluate(async (id) => {
    const p = window.__passage
    p.debug.hold = 0
    p.open(id)
    await new Promise((r) => setTimeout(r, 1800))
  }, await page.evaluate(() => window.__passage.items()[0]))

  const hidden = await page.evaluate(() => {
    const el = document.querySelector('.psg-slot .psg-card')
    return !el || getComputedStyle(el).visibility === 'hidden' || Number(getComputedStyle(el).opacity) === 0
  })
  const meshShot = await page.screenshot({ clip: rect, encoding: 'base64' })

  // The pixel math runs in the page: it has a canvas 2D decoder and Node
  // does not, and shipping an image library to compare two rectangles
  // would be the wrong trade.
  const [mesh, dom] = await page.evaluate(async (shots) => {
    const decode = async (b64) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, c.width, c.height)
      return { data: [...d.data], width: d.width, height: d.height }
    }
    return [await decode(shots[0]), await decode(shots[1])]
  }, [meshShot, domShot])

  const scale = VIEWPORT.deviceScaleFactor
  const band = {
    x: BAND.x * scale,
    y: BAND.y * scale,
    width: BAND.width * scale,
    height: BAND.height * scale,
  }
  const reading = sharpnessRatio(mesh, dom, band)

  if (process.env.SHARPNESS_KEEP) {
    const out = path.join(repoRoot, '.sharpness')
    mkdirSync(out, { recursive: true })
    writeFileSync(path.join(out, 'mesh.png'), Buffer.from(meshShot, 'base64'))
    writeFileSync(path.join(out, 'dom.png'), Buffer.from(domShot, 'base64'))
    console.log(`sharpness: photographs written to ${out}`)
  }

  console.log(
    `sharpness: card ${rect.width}×${rect.height} at (${rect.x}, ${rect.y}), ` +
      `band ${BAND.width}×${BAND.height}+${BAND.x}+${BAND.y} CSS px @ ${scale}×`,
  )
  console.log(
    `  DOM  ${reading.dom.toFixed(2)}\n` +
      `  mesh ${reading.mesh.toFixed(2)}\n` +
      `  ratio ${reading.ratio.toFixed(4)}  (floor ${FLOOR})`,
  )

  if (pageProblems.length) {
    console.error('page errors during the run:')
    for (const p of pageProblems) console.error(`  ${p}`)
    process.exit(1)
  }
  // Both halves are load-bearing. A ratio taken while the page copy is
  // still visible is a photograph of the DOM twice, and it passes
  // perfectly — which is exactly the vacuous result idle-zero's
  // provocation exists to rule out.
  if (!hidden) {
    console.error('LIVENESS FAILURE — the page copy was still visible under the mesh.')
    console.error('The ratio above is the DOM compared against itself; it means nothing.')
    process.exit(1)
  }
  if (!Number.isFinite(reading.ratio)) {
    console.error('BROKEN MEASUREMENT — the reference band had no edges in it.')
    console.error('Wrong rect, or a photograph taken before the page painted.')
    process.exit(1)
  }
  if (reading.ratio < FLOOR) {
    console.error(`SHARPNESS REGRESSION — the mesh is ${((1 - reading.ratio) * 100).toFixed(1)}% softer than the page.`)
    console.error('Three independent budgets, in the order they are cheapest to check:')
    console.error('  supply — texels per device px at this endpoint (texelDemand at its z)')
    console.error('  phase  — is the card corner on an integer device pixel (pixelGridSnap)')
    console.error('  transfer — colorspace_fragment, premultiply, and the sampler')
    process.exit(1)
  }
  console.log('sharpness instrument PASSED: the mesh reads as sharp as the page it replaced.')
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
