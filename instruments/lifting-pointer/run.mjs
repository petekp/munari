// lifting-pointer gate — which DOM instance hears a real click in each
// crossing phase. The contract is decisions.md #33 (input follows the eye):
// during 'lifting' the page copy is presented, so it must hear every trusted
// click and wear real :hover, and the parked copy must wear no relayed
// twins. This began as the probe that found the fault (2026-08-19: 3/3
// lifting clicks misrouted to the parked copy) and was promoted when
// crossingPointer shipped.
//
// Baselines double as liveness checks: a click at rest must reach the page
// copy, and a click in the 'gl' phase must reach the parked copy through
// the relay. If either fails, the lifting answer would be vacuous.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

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
  const msg = `lifting-pointer gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : msg)
  process.exit(strict ? 1 : 0)
}

if (!chromePath) skip('no Chrome executable found (set CHROME_PATH)')

let browser
let server
const deadline = setTimeout(() => {
  console.error('lifting-pointer gate: hard 90s deadline hit')
  process.exit(1)
}, 90_000)

try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--enable-features=CanvasDrawElement',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
      // The idle-zero pair: a throttled renderer would stretch the lifting
      // window and misdate every click relative to the phase timeline.
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

  server = await createServer({
    configFile: false,
    root: here,
    logLevel: 'warn',
    resolve: {
      alias: {
        '@munari/core': path.join(repoRoot, 'packages', 'core', 'src', 'index.ts'),
        '@petepetrash/munari/advanced': path.join(repoRoot, 'packages', 'react', 'src', 'advanced.ts'),
        '@petepetrash/munari': path.join(repoRoot, 'packages', 'react', 'src', 'index.ts'),
      },
    },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [repoRoot, here] } },
  })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  const page = await browser.newPage()
  const pageProblems = []
  page.on('pageerror', (err) => pageProblems.push(String(err)))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
      pageProblems.push(m.text())
  })

  // An initially selected Surface must tolerate the separate R3F root's
  // first commit; it cannot require the user to mount the canvas earlier.
  await page.goto(`http://127.0.0.1:${port}/?initial=scene`, { waitUntil: 'load' })
  await page.waitForFunction(
    () => window.__probe?.state.presented === 'scene' && !window.__probe.state.isChanging,
    { timeout: 15_000 },
  )
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__probe?.ready === true, { timeout: 15_000 })
  if (!(await page.evaluate(() => window.__probe.capable)))
    throw new Error('page reports drawElementImage absent after probe said present')

  const center = await page.evaluate(() => window.__probe.buttonCenter())
  if (!center) throw new Error('no page button to aim at')

  const clickCount = () => page.evaluate(() => window.__probe.clicks.length)
  const lastClick = () => page.evaluate(() => window.__probe.clicks[window.__probe.clicks.length - 1] ?? null)
  const stateNow = () => page.evaluate(() => window.__probe.state)
  const waitForView = (view) =>
    page.waitForFunction(
      (v) => window.__probe.state.presented === v && !window.__probe.state.isChanging,
      { timeout: 15_000 },
      view,
    )

  const clickAndRecord = async (label) => {
    const before = await clickCount()
    await page.mouse.click(center.x, center.y)
    await sleep(120)
    const after = await clickCount()
    const rec = after > before ? await lastClick() : null
    return { label, heardBy: rec ? rec.instance : 'nobody', record: rec }
  }

  const results = []

  // ── baseline: at rest, the page copy must hear a real click ──────────
  results.push(await clickAndRecord('rest (page phase)'))
  if (await page.evaluate(() => window.__probe.scene.active !== 0)) {
    throw new Error('the custom scene is mounted before a canvas request')
  }

  // ── lifting: one fresh crossing per offset ────────────────────────────
  // 550, not 600: the settle is 700ms and the click itself costs a mouse
  // move plus dispatch, so the last trial needs real margin or a slow CI
  // runner lands it in the gl phase and fails the gate on timing alone.
  for (const offsetMs of [100, 350, 550]) {
    await page.evaluate(() => window.__probe.mark('request-webgl'))
    await page.evaluate(() => window.__probe.setRenderIn('scene'))
    await sleep(offsetMs)
    const st = await stateNow()
    const r = await clickAndRecord(`lifting +${offsetMs}ms`)
    r.phaseAtClick = st
    results.push(r)
    await waitForView('scene')
    if (offsetMs === 100) {
      // ── gl-phase baseline, once: the parked copy must hear the relay ──
      results.push(await clickAndRecord('gl phase'))
    }
    await page.evaluate(() => window.__probe.setRenderIn('page'))
    await waitForView('page')
    await page.waitForFunction(() => window.__probe.scene.active === 0, { timeout: 5_000 })
  }

  // ── hover during lifting: does the visible copy show feedback? ───────
  await page.mouse.move(center.x - 200, center.y - 120)
  await sleep(100)
  await page.evaluate(() => window.__probe.setRenderIn('scene'))
  await sleep(250)
  await page.mouse.move(center.x, center.y, { steps: 4 })
  await sleep(150)
  const hoverLifting = await page.evaluate(() => ({
    ...window.__probe.hoverState(),
    state: window.__probe.state,
    canvasSolid: window.__probe.canvasSolid(),
  }))
  await waitForView('scene')
  await sleep(100)
  const hoverGl = await page.evaluate(() => window.__probe.hoverState())

  // Explicit presentation choices must not strand the managed scene or
  // leave an invisible page copy interactive after its presentation stops.
  const policies = []
  for (const requested of ['page', 'scene']) {
    await page.evaluate((value) => window.__probe.setRenderIn(value), requested)
    await waitForView(requested)
    if (requested === 'page') {
      await page.waitForFunction(() => window.__probe.scene.active === 0, { timeout: 5_000 })
    } else {
      // A static mounted presenter is not a reason to promote a demand
      // canvas forever. Observe a quiet interval after its motion settles.
      await page.waitForFunction(
        () => performance.now() - window.__probe.scene.lastFrameAt >= 150,
        { timeout: 5_000 },
      )
    }
    policies.push(await page.evaluate((value) => ({
      requested: value,
      presented: window.__probe.state.presented,
      pageVisible: window.__probe.pageVisible(),
      sceneActive: window.__probe.scene.active,
    }), requested))
  }
  await page.evaluate(() => window.__probe.setRenderIn('page'))
  await waitForView('page')
  await page.waitForFunction(() => window.__probe.scene.active === 0, { timeout: 5_000 })
  const framesAtRelease = await page.evaluate(() => window.__probe.scene.frames)
  await sleep(150)
  const framesAfterRelease = await page.evaluate(() => window.__probe.scene.frames)

  // ── report ────────────────────────────────────────────────────────────
  console.log('\nlifting-pointer gate — who heard the click:')
  for (const r of results) {
    const extra = r.record
      ? ` (presented=${r.record.state.presented}, isChanging=${r.record.state.isChanging},` +
        ` canvasSolid=${r.record.canvasSolid}, pageVisible=${r.record.pageVisible})`
      : ''
    console.log(`  ${r.label.padEnd(20)} → ${r.heardBy}${extra}`)
  }
  console.log('\nhover during lifting:', JSON.stringify(hoverLifting))
  console.log('hover during gl:     ', JSON.stringify(hoverGl))
  console.log('presentation choices:', JSON.stringify(policies))
  console.log('scene frames after release:', framesAfterRelease - framesAtRelease)

  if (pageProblems.length) {
    console.error('\npage errors during the run:')
    for (const p of pageProblems) console.error(`  ${p}`)
    process.exit(1)
  }

  const rest = results.find((r) => r.label.startsWith('rest'))
  const gl = results.find((r) => r.label === 'gl phase')
  if (rest?.heardBy !== 'page') {
    console.error('\nAPPARATUS FAILURE: a click at rest did not reach the page copy.')
    process.exit(1)
  }
  if (gl?.heardBy !== 'scene') {
    console.error('\nAPPARATUS FAILURE: a click in the gl phase did not reach the parked copy.')
    process.exit(1)
  }

  // ── the contract: input follows the eye (decisions.md #33) ────────────
  const failures = []
  for (const policy of policies) {
    const needsPage = policy.requested === 'page'
    const needsScene = policy.requested === 'scene'
    if (policy.pageVisible !== needsPage) failures.push(`${policy.requested}: wrong page visibility`)
    if (policy.sceneActive !== Number(needsScene)) failures.push(`${policy.requested}: wrong scene lifetime`)
  }
  if (framesAfterRelease !== framesAtRelease) failures.push('custom scene kept receiving frames after release')
  for (const r of results.filter((x) => x.label.startsWith('lifting'))) {
    if (r.heardBy !== 'page') {
      failures.push(`${r.label}: heard by ${r.heardBy}, the presented page copy must hear it`)
    }
  }
  if (hoverLifting.state.presented === 'page' && hoverLifting.state.isChanging) {
    if (hoverLifting.realHover !== true) {
      failures.push('lifting hover: the visible page copy shows no real :hover')
    }

  } else {
    failures.push('lifting hover sample missed the lifting window — timing apparatus problem')
  }
  if (hoverGl.dataHover !== true) {
    failures.push('gl hover: the relay did not stamp data-hover on the source copy')
  }
  if (failures.length) {
    console.error('\nlifting-pointer gate FAILED:')
    for (const f of failures) console.error(`  ${f}`)
    process.exit(1)
  }
  console.log('\nlifting-pointer gate PASSED')
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
