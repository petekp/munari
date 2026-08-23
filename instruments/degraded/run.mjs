// The degraded gate — every lab gesture, in a browser with no origin trial.
//
// Why this exists. A Surface without the trial keeps its DOM and reports the
// reason, so nothing throws and nothing looks broken from the outside. What
// breaks is a GESTURE that arms a transition only a renderer can finish: the
// scene enters a state no further input can leave, silently. That shape
// shipped three times before anyone noticed — the knobs panel carry and
// resize had no consumer, genie's minimize waited on a flight that could not
// take off, flight's drag waited on the same thing (2026-08-23).
//
// None of the six capability-enabled gates can see it. They all launch with
// `--enable-features=CanvasDrawElement`, which is also every machine anyone
// develops on, so the degraded path is the one path nothing exercised.
//
// The verdict is only ever visible state — the board's order, the dock's
// contents, a panel's box — read the same way a person would judge it. Each
// scene also has to finish with an empty console: a scene that throws is a
// blank page, and that is how the Safari fault stayed invisible.

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
  const message = `degraded gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message)
  process.exit(strict ? 1 : 0)
}

if (!chromePath) skip('no Chrome executable found (set CHROME_PATH)')

let browser
let server
const deadline = setTimeout(() => {
  console.error('degraded gate: hard 240s deadline hit')
  process.exit(1)
}, 240_000)

const problems = []
const note = (message) => problems.push(message)

try {
  // No `--enable-features=CanvasDrawElement`. That omission is the gate.
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })
  // Silent because vite mirrors every page console.error into this
  // terminal, and the library's own "no trial here" report fires per
  // Surface per scene — the one message this gate expects to see.
  server = await createServer({ root: labRoot, logLevel: 'silent', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  let page
  let errors = []
  const go = async (scene, ready) => {
    await page?.close()
    errors = []
    page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 820, deviceScaleFactor: 1 })
    page.on('pageerror', (error) => errors.push(String(error)))
    page.on('console', (message) => {
      const text = message.text()
      if (message.type() !== 'error') return
      if (text.startsWith('Failed to load resource')) return
      // The library's own report that the trial is absent. Expected here,
      // and its presence is what proves the scene really is degraded.
      if (text.includes('[munari]')) return
      errors.push(text)
    })
    await page.goto(`http://localhost:${port}/?scene=${scene}&bare`, { waitUntil: 'load' })
    await page.waitForSelector(ready, { timeout: 20_000 })
    await sleep(500)
  }
  const settle = async (scene) => {
    if (errors.length) note(`${scene}: console/page errors — ${errors.join(' | ')}`)
  }
  const centre = (selector, nth = 0) =>
    page.evaluate(
      ({ selector, nth }) => {
        const el = document.querySelectorAll(selector)[nth]
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      },
      { selector, nth },
    )
  const dragSteps = async (from, to, steps, onStep) => {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    for (let i = 1; i <= steps; i++) {
      const x = from.x + ((to.x - from.x) * i) / steps
      const y = from.y + ((to.y - from.y) * i) / steps
      await page.mouse.move(x, y)
      await sleep(40)
      if (onStep) await onStep(i, Math.round(x), Math.round(y))
    }
    await page.mouse.up()
    await sleep(450)
  }

  // The premise. If this browser HAS the trial the gate proves nothing, and
  // saying so is better than passing green.
  {
    const probe = await browser.newPage()
    const capable = await probe.evaluate(
      () => 'drawElementImage' in document.createElement('canvas').getContext('2d'),
    )
    await probe.close()
    if (capable) skip(`Chrome at ${chromePath} has the trial without the flag — nothing to degrade`)
  }

  // ── flight: the board reorders under the hand, and the card stays in it ──
  //
  // Both halves matter and only one is obvious. The order changing proves
  // the reorder commits; the constant grab offset proves the card is still
  // the thing the hand is holding while it commits. A carry that reorders
  // but loses the card reads as the card snapping home mid-drag.
  await go('flight', '.l14-card')
  const order = () =>
    page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll('[data-col]')].map((col) => [
          col.dataset.col,
          [...col.querySelectorAll('.l14-card')].map((c) => c.dataset.card),
        ]),
      ),
    )
  const flightBefore = await order()
  const held = flightBefore.queue[0]
  const grab = await page.evaluate(() => {
    const el = document.querySelector('[data-col="queue"] .l14-card h3')
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })
  const cardBox = await page.evaluate(() => {
    const r = document.querySelector('[data-col="queue"] .l14-card').getBoundingClientRect()
    return { left: Math.round(r.left), top: Math.round(r.top) }
  })
  const grabOffset = { x: grab.x - cardBox.left, y: grab.y - cardBox.top }
  const target = await page.evaluate(() => {
    const r = document.querySelector('[data-col="today"] ul').getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.55) }
  })
  const drift = []
  const midOrders = []
  await dragSteps(grab, target, 10, async (i, x, y) => {
    const at = await page.evaluate(
      (id) => {
        const el = document.querySelector(`.l14-card[data-card="${id}"]`)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { left: Math.round(r.left), top: Math.round(r.top) }
      },
      held,
    )
    if (!at) {
      drift.push(Infinity)
      return
    }
    drift.push(Math.hypot(x - at.left - grabOffset.x, y - at.top - grabOffset.y))
    // Sampled BEFORE the release, and that is the assertion that has teeth.
    // Committing the whole reorder on pointerup produces the same final
    // board, so a gate that only reads the end cannot tell the two apart —
    // and the end is not what a person is looking at while they drag.
    if (i < 10) midOrders.push(JSON.stringify(await order()))
  })
  const flightAfter = await order()
  const start = JSON.stringify(flightBefore)
  if (start === JSON.stringify(flightAfter)) {
    note(`flight: a cross-column carry committed no reorder (${JSON.stringify(flightAfter)})`)
  }
  if (!flightAfter.today.includes(held)) {
    note(`flight: ${held} was carried into today and is not there (${JSON.stringify(flightAfter)})`)
  }
  if (!midOrders.some((sample) => sample !== start)) {
    note('flight: the board never reflowed under the hand — the reorder waited for the release')
  }
  // 4px is a generous ceiling for one frame of correction; the fault this
  // catches put the card a whole column away.
  const worstDrift = Math.max(...drift)
  if (!(worstDrift <= 4)) {
    note(`flight: the carried card left the hand — worst drift ${worstDrift.toFixed(1)}px`)
  }
  const cardsBefore = await page.$$eval('.l14-card', (els) => els.length)
  const deleteAt = await centre('.l14-card [aria-label^="Delete"], .l14-card [data-nodrag] button')
  if (deleteAt) {
    await page.mouse.click(deleteAt.x, deleteAt.y)
    await sleep(600)
    const cardsAfter = await page.$$eval('.l14-card', (els) => els.length)
    if (cardsAfter !== cardsBefore - 1) {
      note(`flight: delete left ${cardsAfter} cards, expected ${cardsBefore - 1}`)
    }
  } else {
    note('flight: no delete control found')
  }
  await settle('flight')

  // ── genie: a window goes away, comes back, and can be moved ─────────────
  await go('genie', '.gen-sheet')
  const docked = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[aria-label]')]
        .filter((el) => / — on the desk$/.test(el.getAttribute('aria-label')))
        .map((el) => el.getAttribute('aria-label')),
    )
  const minimizeAt = await centre('[aria-label^="minimize "]')
  if (!minimizeAt) note('genie: no minimize control found')
  else {
    const before = (await docked()).length
    await page.mouse.click(minimizeAt.x, minimizeAt.y)
    await sleep(900)
    const after = (await docked()).length
    if (after !== before - 1) {
      note(`genie: minimize left ${after} windows on the desk, expected ${before - 1}`)
    }
    const restoreAt = await centre('[aria-label^="restore "]')
    if (!restoreAt) note('genie: minimizing produced no restorable bay')
    else {
      await page.mouse.click(restoreAt.x, restoreAt.y)
      await sleep(900)
      if ((await docked()).length !== before) {
        note('genie: restore did not bring the window back to the desk')
      }
    }
  }
  // A sideways titlebar drag repositions rather than pours. Plain DOM either
  // way, but it shares the gesture machine with the pour, so a pour that
  // strands would strand this too.
  //
  // The window is identified by the titlebar that is about to be grabbed,
  // not by `.gen-sheet` — the first sheet in the DOM is not the one the
  // topmost titlebar belongs to, and measuring it read the tail of the
  // restore above as a successful drag. That version passed with the move
  // stubbed out entirely.
  const bar = await page.evaluate(() => {
    const el = document.querySelector('.gen-titlebar')
    if (!el) return null
    const sheet = el.closest('.gen-sheet')
    if (!sheet) return null
    sheet.dataset.degradedProbe = 'true'
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })
  if (!bar) note('genie: no titlebar found')
  else {
    const at = () =>
      page.evaluate(() =>
        Math.round(
          document.querySelector('[data-degraded-probe]').getBoundingClientRect().left,
        ),
      )
    const winBefore = await at()
    await dragSteps(bar, { x: bar.x + 140, y: bar.y - 10 }, 8)
    const winAfter = await at()
    if (Math.abs(winAfter - winBefore) < 20) {
      note(`genie: a titlebar drag moved the window ${winAfter - winBefore}px`)
    }
  }
  await settle('genie')

  // ── knobs: the panel can be carried and reflowed ────────────────────────
  await go('knobs', '.knb-handle')
  const panelBox = () =>
    page.evaluate(() => {
      const r = document.querySelector('.knb-panel, .knb-page-degraded > *').getBoundingClientRect()
      return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width) }
    })
  const handleAt = await centre('.knb-handle')
  if (!handleAt) note('knobs: no carry handle found')
  else {
    const before = await panelBox()
    await dragSteps(handleAt, { x: handleAt.x + 120, y: handleAt.y + 60 }, 8)
    const after = await panelBox()
    const moved = Math.hypot(after.left - before.left, after.top - before.top)
    if (moved < 20) note(`knobs: the carry handle moved the panel ${moved.toFixed(1)}px`)
  }
  const gripAt = await centre('.knb-resize')
  if (!gripAt) note('knobs: no resize grip found')
  else {
    const before = await panelBox()
    await dragSteps(gripAt, { x: gripAt.x + 120, y: gripAt.y }, 8)
    const after = await panelBox()
    if (Math.abs(after.width - before.width) < 20) {
      note(`knobs: the resize grip changed the panel width by ${after.width - before.width}px`)
    }
  }
  await settle('knobs')

  // ── selection: the prose is still prose ─────────────────────────────────
  //
  // The whole scene is about text you can select. Without a renderer that
  // is all it is, and it must still be that.
  await go('selection', '.sel-prose')
  const proseFrom = await page.evaluate(() => {
    const p = document.querySelector('.sel-prose p, .sel-prose')
    const r = p.getBoundingClientRect()
    return { x: Math.round(r.left + 8), y: Math.round(r.top + 12) }
  })
  await dragSteps(proseFrom, { x: proseFrom.x + 300, y: proseFrom.y + 40 }, 6)
  const selected = await page.evaluate(() => (window.getSelection()?.toString() ?? '').trim().length)
  if (selected < 5) note(`selection: a drag over the prose selected ${selected} characters`)
  await settle('selection')

  // ── logo: the scene does not offer the renderer it cannot run ──────────
  //
  // Read from `data-phase` and from which controls exist, never from where
  // the letters are. The scene animates continuously on its own — 7px of
  // peak-to-peak drift in one quiet second, 30px in another — so an
  // assertion that a control "moved the word" passes whether that control
  // is wired up or not. Two clauses here did exactly that, and stubbing the
  // wave button to `() => {}` left the gate green (2026-08-23).
  //
  // What replaced them: the WebGL segment must not be on the panel. Asking
  // for a renderer that cannot arrive mounted a Canvas whose frameloop
  // never advanced, so react-three-fiber's `onCreated` stayed pending until
  // the flip back unmounted the wrapper div, then fired against it and
  // threw. The `settle` below is what caught that, and it stays the second
  // half of this check.
  await go('logo', '.logo-word')
  const logoPhase = await page.evaluate(() => document.querySelector('.logo-word').dataset.phase)
  if (logoPhase !== 'page') note(`logo: the word is not on the page ('${logoPhase}')`)
  const offered = await page.$$eval('[data-renderer]', (els) =>
    els.map((el) => el.dataset.renderer),
  )
  if (offered.length) {
    note(`logo: the panel still offers a renderer choice degraded (${offered.join(', ')})`)
  }
  await settle('logo')

  if (problems.length) {
    console.error(`degraded gate FAILED (${problems.length}):`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log('degraded gate PASSED — five scenes, every gesture, no trial')
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
