// Native fallback gestures in Flight, Genie, Knobs, Selection and Logo.
//
// Why this exists. A Surface without the trial keeps its DOM and reports the
// reason, so nothing throws and nothing looks broken from the outside. What
// breaks is a GESTURE that arms a transition only a renderer can finish: the
// scene enters a state no further input can leave, silently. That shape
// shipped three times before anyone noticed — the knobs panel carry and
// resize had no consumer, genie's minimize waited on a flight that could not
// take off, flight's drag waited on the same thing (2026-08-23).
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
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

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
      ...WEBGPU_CHROME_ARGS,
      '--enable-unsafe-swiftshader',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })
  server = await createServer({ root: labRoot, logLevel: 'silent', server: { port: 0 } })
  await server.listen()
  const port = server.httpServer.address().port

  let page
  let errors = []
  const go = async (scene, ready) => {
    await page?.close()
    errors = []
    page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 820, deviceScaleFactor: 1 })
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
    page.on('pageerror', (error) => errors.push(String(error)))
    page.on('response', response => { if (response.status() >= 400 && new URL(response.url()).pathname !== '/favicon.ico') errors.push(`HTTP ${response.status()} ${response.url()}`) })
    page.on('requestfailed', request => { if (new URL(request.url()).pathname !== '/favicon.ico') errors.push(`${request.failure()?.errorText} ${request.url()}`) })
    page.on('console', (message) => {
      const text = message.text()
      if (message.type() !== 'error') return
      if (text.startsWith('Failed to load resource')) return
      errors.push(text)
    })
    await page.goto(`http://localhost:${port}/?scene=${scene}&bare`, { waitUntil: 'load' })
    await page.waitForSelector(ready, { timeout: 20_000 })
    await sleep(500)
    const capability = await page.evaluate(() => 'drawElementImage' in CanvasRenderingContext2D.prototype)
    if (capability) note(`${scene}: the served page enabled capture, so this is not a native fallback run`)
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
  const unchangedFlight = await order()
  for (const button of ['right', 'middle']) {
    const deletion = await centre('.l14-card .l14-del')
    await page.mouse.click(deletion.x, deletion.y, { button })
    const title = await centre('[data-col="queue"] .l14-card h3')
    await page.mouse.move(title.x, title.y)
    await page.mouse.down({ button })
    await page.mouse.move(title.x + 650, title.y + 100, { steps: 5 })
    await page.mouse.up({ button })
    if (JSON.stringify(await order()) !== JSON.stringify(unchangedFlight)) note(`flight: ${button} press deleted or moved a card`)
  }
  const moveCardId = unchangedFlight.queue[0]
  const moveSelector = `.l14-card[data-card="${moveCardId}"]`
  const originalNote = await page.$(`${moveSelector} .l14-note`)
  await originalNote.focus()
  await page.keyboard.type('Retain this note')
  await page.focus(`${moveSelector} .l14-move summary`)
  await page.keyboard.press('Space')
  await page.keyboard.press('Tab')
  await page.keyboard.type('t')
  await page.keyboard.press('Tab')
  await page.keyboard.type('5')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.waitForFunction(id => document.querySelector('[data-col="today"] .l14-slot:last-child .l14-card')?.dataset.card === id, {}, moveCardId)
  await page.waitForFunction(id => {
    const control = document.querySelector(`.l14-card[data-card="${id}"] .l14-move summary`)
    if (!control) return false
    const box = control.getBoundingClientRect()
    return control === document.activeElement && box.top >= 0 && box.bottom <= innerHeight && !control.closest('.l14-slot').getAnimations().some(animation => animation.playState === 'running')
  }, {}, moveCardId)
  if (!await page.$eval(`${moveSelector} .l14-move summary`, element => element === document.activeElement)) note('flight: keyboard move did not retain focus on the moved card')
  if (!await originalNote.evaluate(element => element.isConnected && element.value === 'Retain this note')) note('flight: keyboard move replaced or reset the note field')
  const announcement = await page.$eval('.l14 [role="status"]', element => element.textContent)
  if (!announcement.includes('Today') || !announcement.includes('5')) note(`flight: move result was not announced: ${announcement}`)
  await page.keyboard.press('Space')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Escape')
  if (!await page.$eval(`${moveSelector} .l14-move`, element => !element.open && document.activeElement === element.querySelector('summary'))) note('flight: Escape did not close Move and restore focus')
  await page.keyboard.press('Space')
  await page.click('[data-col="queue"] h2')
  if (await page.$eval(`${moveSelector} .l14-move`, element => element.open)) note('flight: outside press did not close Move')
  // The keyboard move's sibling slots can still animate after its destination is visible.
  await page.waitForFunction(() => ![...document.querySelectorAll('.l14-slot')].some(element => element.getAnimations().some(animation => animation.playState === 'running')))
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
  await page.evaluate(() => {
    window.__degradedFlightPointerdown = null
    window.addEventListener('pointerdown', event => {
      const card = event.target instanceof Element ? event.target.closest('.l14-card') : null
      window.__degradedFlightPointerdown = {
        card: card?.dataset.card ?? null,
        x: event.clientX,
        y: event.clientY,
        box: card?.getBoundingClientRect().toJSON(),
        fonts: document.fonts.status,
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        scroll: document.querySelector('.l14').scrollTop,
        timelineTime: document.timeline.currentTime,
      }
    }, { capture: true, once: true })
  })
  const drift = []
  const carrySamples = []
  const midOrders = []
  await dragSteps(grab, target, 10, async (i, x, y) => {
    const at = await page.evaluate(
      (id) => {
        const el = document.querySelector(`.l14-card[data-card="${id}"]`)
        if (!el) return null
        const r = el.getBoundingClientRect()
        const slot = el.closest('.l14-slot')
        return {
          left: Math.round(r.left), top: Math.round(r.top), height: r.height,
          headingHeight: el.querySelector('h3').getBoundingClientRect().height,
          fonts: document.fonts.status,
          scroll: document.querySelector('.l14').scrollTop,
          cardTransform: getComputedStyle(el).transform,
          slotTransform: getComputedStyle(slot).transform,
          timelineTime: document.timeline.currentTime,
          observedAt: performance.now(),
        }
      },
      held,
    )
    if (!at) {
      drift.push(Infinity)
      return
    }
    const error = Math.hypot(x - at.left - grabOffset.x, y - at.top - grabOffset.y)
    drift.push(error)
    carrySamples.push({ step: i, pointer: { x, y }, drift: error, ...at })
    // Sampled BEFORE the release, and that is the assertion that has teeth.
    // Committing the whole reorder on pointerup produces the same final
    // board, so a gate that only reads the end cannot tell the two apart —
    // and the end is not what a person is looking at while they drag.
    if (i < 10) midOrders.push(JSON.stringify(await order()))
  })
  const flightAfter = await order()
  const pointerdown = await page.evaluate(() => window.__degradedFlightPointerdown)
  if (pointerdown?.card !== held) note(`flight: carry pressed ${pointerdown?.card ?? 'no card'}, expected ${held}: ${JSON.stringify(pointerdown)}`)
  const cardIds = board => Object.values(board).flat().sort()
  if (JSON.stringify(cardIds(flightAfter)) !== JSON.stringify(cardIds(flightBefore))) {
    note('flight: carrying a card lost or duplicated a board item')
  }
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
    note(`flight: the carried card left the hand — worst drift ${worstDrift.toFixed(1)}px; grab offset ${JSON.stringify(grabOffset)}; press ${JSON.stringify(pointerdown)}; samples ${JSON.stringify(carrySamples)}`)
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
  for (const requestedCard of ['c1', 'c2']) {
    await page.reload({ waitUntil: 'load' })
    await page.waitForFunction(() => document.querySelectorAll('.l14-slot').length === 9)
    await page.evaluate(() => document.fonts.ready)
    for (let tab = 0; tab < 12; tab++) {
      await page.keyboard.press('Tab')
      if (await page.$eval(`.l14-card[data-card="${requestedCard}"] .l14-move summary`, element => element === document.activeElement)) break
    }
    if (!await page.$eval(`.l14-card[data-card="${requestedCard}"] .l14-move summary`, element => element === document.activeElement)) throw new Error(`flight: Tab did not reach ${requestedCard} Move`)
    const grab = await page.$eval('.l14-card[data-card="c1"] h3', element => {
      const box = element.getBoundingClientRect()
      return { x: box.left + 20, y: box.top + 20 }
    })
    await page.mouse.move(grab.x, grab.y)
    await page.mouse.down()
    await page.mouse.move(grab.x + 20, grab.y + 20, { steps: 3 })
    await page.keyboard.press('Space')
    await page.keyboard.press('Tab')
    await page.keyboard.type('t')
    await page.keyboard.press('Tab')
    await page.keyboard.type('5')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await page.waitForFunction(id => document.querySelector('[data-col="today"] .l14-slot:last-child .l14-card')?.dataset.card === id, {}, requestedCard)
    const resting = await page.$eval('.l14-card[data-card="c1"]', element => {
      const card = element.getBoundingClientRect()
      const slot = element.closest('.l14-slot').getBoundingClientRect()
      return Math.hypot(card.left - slot.left, card.top - slot.top) < 1
    })
    if (!resting) note(`flight: Move for ${requestedCard} left the native carry under the pointer`)
    const committed = await page.$$eval('[data-col]', columns => columns.map(column => [...column.querySelectorAll('[data-card]')].map(card => card.dataset.card)))
    await page.mouse.move(grab.x + 50, grab.y + 20, { steps: 3 })
    await page.mouse.up()
    const afterPointer = await page.$$eval('[data-col]', columns => columns.map(column => [...column.querySelectorAll('[data-card]')].map(card => card.dataset.card)))
    if (JSON.stringify(committed) !== JSON.stringify(afterPointer)) note(`flight: pointer movement overrode Move for ${requestedCard}`)
  }
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.l14[data-reduced-motion="true"] .l14-card')
  const reducedDelete = await centre('.l14-card .l14-del')
  await page.mouse.click(reducedDelete.x, reducedDelete.y)
  await page.waitForFunction(() => document.querySelectorAll('.l14-slot').length === 8)
  const reducedLayout = await page.evaluate(() => new Promise(resolve => {
    let frames = 0
    let moving = false
    const sample = () => {
      moving ||= [...document.querySelectorAll('.l14-slot')].some(element => element.getAnimations().some(animation => animation.playState === 'running'))
      if (++frames === 8) resolve(moving)
      else requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }))
  if (reducedLayout) note('flight: reduced-motion deletion animated layout')
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
    const win = await page.$eval('[aria-label^="minimize "]', element => element.closest('[data-win]').dataset.win)
    const visible = () => page.$eval(`.gen-slot[data-win="${win}"] .gen-sheet`, element => element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }))
    if (!await visible()) note(`genie: ${win} was not visible before minimize`)
    const before = (await docked()).length
    await page.mouse.click(minimizeAt.x, minimizeAt.y)
    await sleep(900)
    const after = (await docked()).length
    if (after !== before - 1) {
      note(`genie: minimize left ${after} windows on the desk, expected ${before - 1}`)
    }
    if (await visible()) note(`genie: ${win} still paints its native sheet after minimize`)
    const restoreAt = await centre('[aria-label^="restore "]')
    if (!restoreAt) note('genie: minimizing produced no restorable bay')
    else {
      await page.mouse.click(restoreAt.x, restoreAt.y)
      await sleep(900)
      if ((await docked()).length !== before) {
        note('genie: restore did not bring the window back to the desk')
      }
      if (!await visible()) note(`genie: ${win} stayed hidden after restore`)
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
  // What replaced them: the 3D segment must not be on the panel. Asking
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
  console.log('degraded gate PASSED — native fallback gestures in five scenes')
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
