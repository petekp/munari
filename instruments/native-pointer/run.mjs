// native-pointer gate — compare explicit relay and automatic native input
// on the same retained content (decisions.md #39).
//
// The contract, per clause: the relay stays the working baseline (a gl-phase
// click with the default route reaches the source, synthetic); asking for
// 'auto' on a flat presented pose dresses the parked canvas (matrix3d from
// origin 0 0, visibility hidden, z lifted, drawn root visible); a trusted
// click at the projected content lands on the real element with
// isTrusted=true — the one thing the relay can never produce; real :hover
// engages and the twin attribute follows it; a click focuses the real input
// and typed keys land in it; a tilted pose moves the projected box and
// still takes the trusted click; and asking for 'relay' parks — styles
// restored, the synthetic relay hearing again. A visible mesh in front of the
// button blocks the click on the relay in both pointer modes and parks the
// rig on the native route, for a mouse click and for a touch tap that arrives
// with no hover move. A touch beside the box right after a touch on it
// reaches the button once, through the relay, and the rig rides again
// (decisions.md #78).
//
// OS cursor appearance is not measured here. Use HEADED=1 to inspect it.
// Click receipts establish which control received input.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

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
  const msg = `native-pointer gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : msg)
  process.exit(strict ? 1 : 0)
}

if (!chromePath) skip('no Chrome executable found (set CHROME_PATH)')

let browser
let server
const deadline = setTimeout(() => {
  console.error('native-pointer gate: hard 90s deadline hit')
  browser?.process()?.kill('SIGKILL')
  process.exit(1)
}, 90_000)

try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: process.env.HEADED === '1' ? false : true,
    args: [
      ...WEBGPU_CHROME_ARGS,
      '--enable-features=CanvasDrawElement',
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
  if (!capable) {
    await browser.close()
    browser = null
    skip(`Chrome at ${chromePath} has no drawElementImage`)
  }

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

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__nativePointer?.ready === true, { timeout: 15_000 })
  if (!(await page.evaluate(() => window.__nativePointer.capable)))
    throw new Error('page reports drawElementImage absent after probe said present')

  const evalProbe = (fn, ...args) => page.evaluate(fn, ...args)
  const rectOf = (id) => evalProbe((i) => window.__nativePointer.rectOf(i), id)
  const clickCount = () => evalProbe(() => window.__nativePointer.clicks.length)
  const lastClick = () =>
    evalProbe(() => window.__nativePointer.clicks[window.__nativePointer.clicks.length - 1] ?? null)
  const waitForView = (view) =>
    page.waitForFunction(
      (v) => window.__nativePointer.state.presentation === v && !window.__nativePointer.state.isTransitioning,
      { timeout: 15_000 },
      view,
    )

  const clickAt = async (label, point, expectedId = 'btn') => {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
      throw new Error(`${label}: target has no finite screen point`)
    const before = await clickCount()
    await page.mouse.click(point.x, point.y)
    await sleep(120)
    const count = await clickCount() - before
    const rec = count > 0 ? await lastClick() : null
    if (count !== 1 || rec?.id !== expectedId)
      throw new Error(`${label}: expected one click on ${expectedId}, received ${count} with last target ${rec?.id}`)
    return {
      label,
      heardBy: rec ? rec.presentationAtClick : 'nobody',
      id: rec?.id ?? null,
      trusted: rec?.trusted ?? null,
    }
  }

  const blockedAt = async (label, point) => {
    const before = await clickCount()
    await page.mouse.click(point.x, point.y)
    await sleep(120)
    const count = await clickCount() - before
    if (count !== 0) failures.push(`${label}: a click through the covering mesh reached the content ${count} time(s)`)
    return { label, reached: count }
  }
  const cover = async (point) => {
    if (!(await evalProbe((p) => window.__nativePointer.coverAt(p), point))) throw new Error('the covering mesh could not be placed')
    await sleep(100)
  }
  const blocked = []

  const results = []
  const failures = []
  const expect = (cond, message) => {
    if (!cond) failures.push(message)
  }

  // ── rest baseline: the page copy hears a direct native click ──────────
  results.push(await clickAt('rest (page phase)', await rectOf('btn')))

  // ── gl + default route: the relay hears, synthetically ────────────────
  await evalProbe(() => window.__nativePointer.setRenderIn('scene'))
  await waitForView('scene')
  results.push(await clickAt('gl, relay route', await rectOf('btn')))

  // ── a mesh in front blocks the relay, in both pointer modes (decisions.md #78) ──
  for (const mode of ['surfaces', 'scene']) {
    await evalProbe((m) => window.__nativePointer.setPointerMode(m), mode)
    await sleep(150)
    const at = await rectOf('btn')
    await cover(at)
    blocked.push(await blockedAt(`relay, ${mode} mode, covered`, at))
    await cover(null)
    results.push(await clickAt(`relay, ${mode} mode, uncovered`, at))
  }
  await evalProbe(() => window.__nativePointer.setPointerMode('surfaces'))
  await sleep(150)

  // ── ask for the native route: the rig dresses the parked canvas ───────
  await evalProbe(() => window.__nativePointer.setRoute('auto'))
  await page.waitForFunction(() => window.__nativePointer.riding(), { timeout: 10_000 })
  const rig = await evalProbe(() => window.__nativePointer.rig())
  expect(rig.transform.startsWith('matrix3d'), `ride: canvas transform is ${rig.transform || '(empty)'}`)
  // The style attribute reads back normalized: '0 0' becomes '0px 0px'.
  expect(/^0(px)? 0(px)?$/.test(rig.transformOrigin), `ride: transform-origin is ${rig.transformOrigin}`)
  expect(rig.visibility === 'hidden', `ride: canvas visibility is ${rig.visibility}`)
  expect(Number(rig.zIndex) > 0, `ride: canvas z-index is ${rig.zIndex}`)
  expect(rig.rootVisibility === 'visible', `ride: drawn root visibility is ${rig.rootVisibility}`)

  // ── the prize: a trusted click on the real element ────────────────────
  const flatBtn = await rectOf('btn')
  results.push(await clickAt('native, flat', flatBtn))

  // ── real hover, and the twin that follows it ──────────────────────────
  await page.mouse.move(flatBtn.x, flatBtn.y, { steps: 3 })
  await sleep(150)
  const hoverOn = await evalProbe(() => window.__nativePointer.hoverOf('btn'))
  await page.mouse.move(5, await page.evaluate(() => window.innerHeight - 5))
  await sleep(150)
  const hoverOff = await evalProbe(() => window.__nativePointer.hoverOf('btn'))

  // ── real focus, real keystrokes ───────────────────────────────────────
  results.push(await clickAt('native, input', await rectOf('field'), 'field'))
  await page.keyboard.type('native')
  const typed = await evalProbe(() => ({
    value: window.__nativePointer.valueOf('field'),
    active: window.__nativePointer.activeId(),
  }))

  // ── a mesh in front parks the rig, and the click does not reach the content ──
  const coverPoint = await rectOf('btn')
  await page.mouse.move(coverPoint.x, coverPoint.y, { steps: 3 })
  await cover(coverPoint)
  await page.waitForFunction(() => !window.__nativePointer.riding(), { timeout: 5_000 })
    .catch(() => failures.push('native, covered: the rig kept riding under a covering mesh'))
  blocked.push(await blockedAt('native, covered', coverPoint))
  // A touch press arrives with no hover move first, so the window listener
  // must stop it before the lifted content hears it.
  await page.mouse.move(5, await page.evaluate(() => window.innerHeight - 5))
  await cover(null)
  await page.waitForFunction(() => window.__nativePointer.riding(), { timeout: 5_000 })
  await evalProbe((p) => window.__nativePointer.coverAt(p), coverPoint)
  await sleep(100)
  const ridingBeforeTouch = await evalProbe(() => window.__nativePointer.riding())
  const touchBefore = await clickCount()
  await page.touchscreen.tap(coverPoint.x, coverPoint.y)
  await sleep(200)
  const touchReached = await clickCount() - touchBefore
  if (touchReached !== 0) failures.push(`native, covered touch: the tap reached the content ${touchReached} time(s)`)
  blocked.push({ label: 'native, covered touch', reached: touchReached, ridingBeforeTouch })
  // The next touch lands beside the box, still on the button, while the rig
  // is parked. The browser aims it at the renderer canvas, so the relay must
  // deliver it, and the rig rides again once the tap has ended. The mouse's
  // last place is uncovered and would lift the rig on the next frame, so a
  // touch off the Surface first clears it: a touch leaves no place once it
  // lifts. The covered touch after it is then the last one the binding saw.
  await page.touchscreen.tap(5, await page.evaluate(() => window.innerHeight - 5))
  await sleep(150)
  await page.touchscreen.tap(coverPoint.x, coverPoint.y)
  await sleep(200)
  const ridingBeforeBeside = await evalProbe(() => window.__nativePointer.riding())
  if (ridingBeforeBeside) failures.push('APPARATUS: the rig rode again after the covered touch, so the touch beside the box did not test a parked rig')
  const besidePoint = { x: coverPoint.x + 100, y: coverPoint.y }
  const besideBefore = await clickCount()
  const pressesBefore = await evalProbe(() => window.__nativePointer.presses.length)
  await page.touchscreen.tap(besidePoint.x, besidePoint.y)
  await sleep(200)
  const besideReached = await clickCount() - besideBefore
  const besideClick = besideReached > 0 ? await lastClick() : null
  const besidePresses = await evalProbe(() => window.__nativePointer.presses.length) - pressesBefore
  if (besideReached !== 1 || besideClick?.id !== 'btn')
    failures.push(`native, touch beside the box after a covered touch: ${besideReached} click(s), last on ${besideClick?.id}; expected one on btn`)
  if (besidePresses !== 1)
    failures.push(`native, touch beside the box after a covered touch: the button heard ${besidePresses} press(es), expected 1`)
  const ridingAfterTap = await page.waitForFunction(() => window.__nativePointer.riding(), { timeout: 5_000 }).then(() => true, () => false)
  if (!ridingAfterTap) failures.push('native, touch beside the box: the rig did not ride again after the tap')
  blocked.push({ label: 'native, touch beside the box', reached: besideReached, presses: besidePresses, trusted: besideClick?.trusted ?? null, ridingBeforeBeside, ridingAfterTap })
  await cover(null)
  await page.mouse.move(coverPoint.x, coverPoint.y, { steps: 3 })
  await page.waitForFunction(() => window.__nativePointer.riding(), { timeout: 5_000 })
  results.push(await clickAt('native, uncovered', await rectOf('btn')))

  // ── a tilted pose still rides, and still takes the trusted click ──────
  const flatTransform = rig.transform
  await evalProbe(() => window.__nativePointer.setTilt(true))
  await page.waitForFunction(
    (t) => {
      const r = window.__nativePointer.rig()
      return window.__nativePointer.riding() && r !== null && r.transform !== t
    },
    { timeout: 10_000 },
    flatTransform,
  )
  const tiltBtn = await rectOf('btn')
  const moved = Math.hypot(tiltBtn.x - flatBtn.x, tiltBtn.y - flatBtn.y)
  expect(moved > 5, `tilt: projected button moved ${moved.toFixed(1)}px — pose did not change`)
  results.push(await clickAt('native, tilted', tiltBtn))

  // ── park: styles restored, the relay hearing again ────────────────────
  await evalProbe(() => window.__nativePointer.setTilt(false))
  await sleep(150)
  await evalProbe(() => window.__nativePointer.setRoute('relay'))
  await page.waitForFunction(() => !window.__nativePointer.riding(), { timeout: 10_000 })
  const parked = await evalProbe(() => window.__nativePointer.rig())
  expect(!parked.transform.startsWith('matrix3d'), `park: canvas still wears ${parked.transform}`)
  expect(parked.zIndex === '-1', `park: canvas z-index is ${parked.zIndex}, not the parked -1`)
  results.push(await clickAt('gl, relay after park', await rectOf('btn')))

  // Shared controlled state must survive both renderer changes. A texture
  // that accepts typing but returns to an empty page input fails this check.
  await evalProbe(() => window.__nativePointer.setRenderIn('page'))
  await waitForView('page')
  const returnedValue = await evalProbe(() => window.__nativePointer.valueOf('field'))
  expect(returnedValue === 'native', `return: page input lost the canvas value (${JSON.stringify(returnedValue)})`)
  results.push(await clickAt('page, returned input', await rectOf('field'), 'field'))
  await page.keyboard.type(' page')
  await evalProbe(() => window.__nativePointer.setRenderIn('scene'))
  await waitForView('scene')
  const reenteredValue = await evalProbe(() => window.__nativePointer.valueOf('field'))
  expect(reenteredValue === 'native page', `reentry: source input lost the page edit (${JSON.stringify(reenteredValue)})`)

  // ── report ────────────────────────────────────────────────────────────
  console.log('\nnative-pointer gate — who heard the click, and how:')
  for (const r of results)
    console.log(`  ${r.label.padEnd(22)} → ${r.heardBy} ${r.id ?? ''} (trusted=${r.trusted})`)
  for (const { label, reached, ...seen } of blocked) {
    const notes = Object.entries(seen).map(([key, value]) => `${key}=${value}`).join(', ')
    console.log(`  ${label.padEnd(30)} → reached the content ${reached} time(s)${notes ? ` (${notes})` : ''}`)
  }
  console.log(`\nhover on:  ${JSON.stringify(hoverOn)}`)
  console.log(`hover off: ${JSON.stringify(hoverOff)}`)
  console.log(`typed:     ${JSON.stringify(typed)}`)
  console.log(`round trip: ${JSON.stringify({ returnedValue, reenteredValue })}`)
  console.log(
    `\nThe OS cursor is unmeasured (decisions.md #39). ` +
      `Run HEADED=1 and hover the target to inspect it.`,
  )

  if (pageProblems.length) {
    console.error('\npage errors during the run:')
    for (const p of pageProblems) console.error(`  ${p}`)
    throw new Error('native-pointer gate failed; see the recorded errors above')
  }

  const by = (label) => results.find((r) => r.label === label)
  const rest = by('rest (page phase)')
  const relay = by('gl, relay route')
  if (rest?.heardBy !== 'page' || rest?.trusted !== true) {
    console.error('\nAPPARATUS FAILURE: a click at rest did not reach the page copy trusted.')
    throw new Error('native-pointer gate failed; see the recorded errors above')
  }
  if (relay?.heardBy !== 'scene' || relay?.trusted !== false) {
    console.error('\nAPPARATUS FAILURE: the gl-phase relay baseline did not hear synthetically.')
    throw new Error('native-pointer gate failed; see the recorded errors above')
  }

  const native = [by('native, flat'), by('native, uncovered'), by('native, tilted')]
  for (const r of native) {
    expect(r?.heardBy === 'scene', `${r?.label}: heard by ${r?.heardBy}, not the source copy`)
    expect(r?.trusted === true, `${r?.label}: trusted=${r?.trusted} — the browser did not deliver it`)
  }
  expect(hoverOn?.realHover === true, 'hover: the real :hover never engaged')
  expect(hoverOn?.dataHover === true, 'hover: the twin attribute was not stamped')
  expect(hoverOff?.realHover === false, 'hover: :hover survived the pointer leaving')
  expect(hoverOff?.dataHover === false, 'hover: the twin attribute survived the pointer leaving')
  expect(by('native, input')?.trusted === true, 'input: the focusing click was not trusted')
  expect(typed.value === 'native', `typing: input value is ${JSON.stringify(typed.value)}`)
  expect(typed.active === 'field', `typing: focus sits on ${typed.active}`)
  const after = by('gl, relay after park')
  expect(
    after?.heardBy === 'scene' && after?.trusted === false,
    `after park: heard by ${after?.heardBy} (trusted=${after?.trusted}) — the relay did not resume`,
  )

  if (failures.length) {
    console.error('\nnative-pointer gate FAILED:')
    for (const f of failures) console.error(`  ${f}`)
    throw new Error('native-pointer gate failed; see the recorded errors above')
  }
  console.log('\nnative-pointer gate PASSED')
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
