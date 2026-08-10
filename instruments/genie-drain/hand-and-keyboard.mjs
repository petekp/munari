// hand-and-keyboard — the parts of a window that are not pixels.
//
// Everything else in this directory measures the sheet: where its mouth
// lands, what its shadow weighs, whether it blanks at the swap. None of
// that catches the failures below, because none of them are visible in a
// frame. They are visible in the second after it.
//
//   1. THE KEYBOARD FOLLOWS THE WINDOW. `visibility: hidden` blurs
//      whatever it covers, so the moment a minimize hides the page copy
//      the focus is on <body> — and the next Tab starts over at the top
//      of the dock, on somebody else's bay. A keyboard user who
//      minimizes the window they are working in loses the window and
//      their place in one press. The bay has to inherit the focus and
//      hand it back on the way out. Measured before the fix: focus went
//      to BODY at takeoff and one Tab reached `quadrato`.
//
//   2. ESCAPE ABANDONS THE GESTURE. The oldest promise a drag makes
//      anywhere, and the reason it is safe to start one to find out what
//      it does. This desk has two — a move and a scrub — and the abort
//      is different for each: the move snaps back to the offset React
//      still believes in, the scrub hands the sheet to the spring aimed
//      at the wall it came from.
//
//   3. THE TITLEBAR ANSWERS A DOUBLE-CLICK. Where windowshade lived in
//      Mac OS 9, and where macOS still offers the minimize. On a desk
//      whose whole subject is the minimize, it is the first thing a hand
//      tries after the lamp.
//
//   5. EXPANDING A WINDOW TAKES THE KEYBOARD AT ONCE. Not on landing —
//      from the first frame of the flight. A restore is the one gesture
//      that starts on a control which is about to stop existing: the bay
//      empties under the press, so a focus left there is parked on a
//      widget whose label has changed out from under it. And "at once"
//      is the hard half, because for the whole excursion the window's
//      own DOM is hidden and a hidden box cannot hold focus — the
//      wrapper had to stop being the hidden thing for this to be
//      possible at all. Measured the same way a user would notice it:
//      part-way through a slow restore, before anything has landed.
//
//   4. THE LIVE LAMP SAYS WHAT IT DOES. It is the only red widget in the
//      titlebar, and red in a titlebar means close everywhere a person
//      has used a computer. The glyph is the disambiguation, and it is
//      one CSS specificity accident away from never rendering — the
//      dimming rules for a sleeping window already had to be spelled out
//      twice to survive that.
import { existsSync } from 'node:fs'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const labRoot = path.join('/Users/petepetrash/Code/munari', 'apps', 'lab')
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
  .filter(Boolean)
  .find((p) => existsSync(p))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// A window put back where it started has to land ON where it started.
// This is not a tolerance on the abort — that arithmetic is exact — but
// on reading two rects a frame apart.
const HOME_PX = 0.5

let server, browser
const deadline = setTimeout(() => {
  console.error('hand-and-keyboard: hard 150s deadline hit')
  process.exit(1)
}, 150_000)

const problems = []

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--enable-features=CanvasDrawElement', '--disable-renderer-backgrounding'],
  })
  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  const page = await browser.newPage()
  await page.setViewport({ width: 1100, height: 800, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:${port}/?scene=genie`, { waitUntil: 'load' })
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.gen-sheet').length === 4 && document.fonts.status === 'loaded',
    { timeout: 15_000 },
  )
  await sleep(1200)

  // Named the way a person would describe where they are, not the way the
  // DOM would: "the bay for scheda", not "button.gen-tile".
  const where = () =>
    page.evaluate(() => {
      const a = document.activeElement
      if (!a || a === document.body) return 'nowhere (focus lost to the page)'
      const win = a.closest('[data-win]')?.dataset.win
      if (a.classList.contains('gen-tile')) return `the bay for ${win}`
      if (a.classList.contains('gen-lamp')) return `${win}'s minimize lamp`
      if (a.classList.contains('gen-slot')) return `the window ${win}`
      return `${a.tagName.toLowerCase()} in ${win ?? 'the page'}`
    })
  const at = (win) =>
    page.evaluate((w) => {
      const b = document.querySelector(`.gen-slot[data-win="${w}"]`).getBoundingClientRect()
      return { x: b.left, y: b.top }
    }, win)
  const airborne = () =>
    page.evaluate(() => document.querySelectorAll('.gen-sheet').length - 4)
  const filled = (win) =>
    page.evaluate(
      (w) => document.querySelector(`.gen-tile[data-win="${w}"]`).dataset.filled === 'true',
      win,
    )
  const gripAt = () =>
    page.evaluate(() => {
      // Well right of the lamps, so the press is on bare titlebar.
      const bar = document
        .querySelector('.gen-sheet[data-win="scheda"] .gen-titlebar')
        .getBoundingClientRect()
      return { x: bar.right - 40, y: bar.top + bar.height / 2 }
    })

  // ── 1. the keyboard follows the window ────────────────────────────────
  console.log('\n  the keyboard')
  await page.click('.gen-sheet[data-win="scheda"] .gen-field')
  await page.keyboard.type('mid-flight')
  // Tabbed to, not .focus()'d. The scene reads :focus-visible to tell a
  // keyboard's doing from a mouse's, and a programmatic focus resolves
  // that pseudo-class off whatever the last input happened to be — so a
  // shortcut here would make the leg depend on a browser heuristic
  // instead of on the gesture it is supposed to be measuring. The two
  // decorative lamps are tabIndex -1, so one Shift+Tab is the whole trip
  // from the field to the only control in the titlebar.
  await page.keyboard.down('Shift')
  await page.keyboard.press('Tab')
  await page.keyboard.up('Shift')
  const reached = await where()
  if (reached !== "scheda's minimize lamp")
    problems.push(`Shift+Tab out of the field reached "${reached}" — the tab order has changed`)
  await page.keyboard.press('Enter')
  await page.waitForFunction(
    () => document.querySelector('.gen-tile[data-win="scheda"]').dataset.filled === 'true',
    { timeout: 8000 },
  )
  await sleep(400)
  const parked = await where()
  console.log(`    minimized from the lamp      focus is ${parked}`)
  if (parked !== 'the bay for scheda')
    problems.push(
      `minimizing from the keyboard left the focus at "${parked}" — a keyboard user loses the ` +
        `window and their place in the same press`,
    )

  // And back out, from the same key.
  await page.keyboard.press('Enter')
  await page.waitForFunction(
    () => document.querySelector('.gen-tile[data-win="scheda"]').dataset.filled === 'false',
    { timeout: 8000 },
  )
  await sleep(600)
  const back = await where()
  const kept = await page.evaluate(
    () => document.querySelector('.gen-sheet[data-win="scheda"] .gen-field').value,
  )
  console.log(`    restored from the bay        focus is ${back}`)
  console.log(`    the text it was holding      ${JSON.stringify(kept)}`)
  if (back !== "scheda's minimize lamp")
    problems.push(`restoring left the focus at "${back}" rather than back inside the window`)
  if (kept !== 'mid-flight')
    problems.push(`the window came back holding ${JSON.stringify(kept)} — its state did not survive`)

  // A mouse minimize of a DIFFERENT window must not move the keyboard at
  // all, or the caret gets yanked out of whatever you were typing in.
  await page.click('.gen-sheet[data-win="scheda"] .gen-field')
  // The studies overlap, so which of the three has an uncovered lamp
  // depends on the stack — ask, rather than name one and hope.
  const lamp = await page.evaluate(
    () =>
      [...document.querySelectorAll('.gen-sheet')]
        .filter((s) => s.dataset.win !== 'scheda')
        .map((s) => {
          const b = s.querySelector('.gen-lamp[data-role="minimize"]').getBoundingClientRect()
          const p = { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }
          const hit = document.elementFromPoint(p.x, p.y)
          return { win: s.dataset.win, ...p, mine: hit?.closest('.gen-sheet')?.dataset.win }
        })
        .find((c) => c.mine === c.win) ?? null,
  )
  if (!lamp) {
    problems.push('no study has an uncovered minimize lamp — the focus-stealing check never ran')
  } else {
    await page.mouse.click(lamp.x, lamp.y)
    await sleep(400)
    const still = await where()
    console.log(`    ${`${lamp.win} docked by mouse`.padEnd(29)}focus is ${still}`)
    if (still !== 'input in scheda')
      problems.push(
        `docking ${lamp.win} with the mouse moved the keyboard to "${still}" — a minimize is ` +
          `stealing focus out of the window you were actually typing in`,
      )
    await page.evaluate(
      (w) => document.querySelector(`.gen-tile[data-win="${w}"]`).click(),
      lamp.win,
    )
    await page.waitForFunction(
      (w) => document.querySelector(`.gen-tile[data-win="${w}"]`).dataset.filled === 'false',
      { timeout: 8000 },
      lamp.win,
    )
    await sleep(500)
  }

  // ── 2. escape abandons the gesture ────────────────────────────────────
  console.log('\n  escape')
  const home = await at('scheda')
  let g = await gripAt()
  await page.mouse.move(g.x, g.y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(g.x + i * 18, g.y - i * 8)
    await sleep(16)
  }
  const carried = await at('scheda')
  await page.keyboard.press('Escape')
  await sleep(120)
  const dropped = await at('scheda')
  // Releasing after the abort must not resurrect the offset.
  await page.mouse.up()
  await sleep(200)
  const settled = await at('scheda')
  const moved = Math.hypot(carried.x - home.x, carried.y - home.y)
  const off = Math.hypot(settled.x - home.x, settled.y - home.y)
  console.log(`    a move carried it            ${moved.toFixed(0)}px`)
  console.log(`    escape put it back within    ${off.toFixed(1)}px`)
  if (moved < 20) problems.push('the drag never moved the window — the abort was not tested')
  if (Math.hypot(dropped.x - home.x, dropped.y - home.y) > HOME_PX)
    problems.push('escape did not return the window to where the drag started')
  if (off > HOME_PX)
    problems.push(
      `releasing after an escape committed the abandoned offset (${off.toFixed(1)}px from home)`,
    )

  // The other gesture: a pour, abandoned mid-scrub.
  g = await gripAt()
  await page.mouse.move(g.x, g.y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(g.x, g.y + i * 14)
    await sleep(16)
  }
  const scrubbing = await airborne()
  await page.keyboard.press('Escape')
  await page.mouse.up()
  try {
    await page.waitForFunction(() => document.querySelectorAll('.gen-sheet').length === 4, {
      timeout: 6000,
    })
  } catch {
    /* reported below */
  }
  await sleep(400)
  const docked = await filled('scheda')
  const landedHome = Math.hypot((await at('scheda')).x - home.x, (await at('scheda')).y - home.y)
  console.log(`    a scrub put it in the air    ${scrubbing ? 'yes' : 'no'}`)
  console.log(`    escape sent it back to the   ${docked ? 'dock' : 'desk'}`)
  if (!scrubbing) problems.push('the straight-down drag never started a pour — the abort was not tested')
  if (docked)
    problems.push('escape mid-scrub docked the window — an abandoned gesture completed itself')
  if (landedHome > HOME_PX)
    problems.push(`the abandoned scrub left the window ${landedHome.toFixed(1)}px from home`)

  // ── 3. the titlebar answers a double-click ────────────────────────────
  console.log('\n  the titlebar')
  g = await gripAt()
  // `count`, not `clickCount`: the old name is accepted silently and
  // sends ONE click, so the leg passes for the wrong reason in reverse —
  // it fails on a scene that works, which cost a diagnosis to find out.
  await page.mouse.click(g.x, g.y, { count: 2 })
  let byDouble = true
  try {
    await page.waitForFunction(
      () => document.querySelector('.gen-tile[data-win="scheda"]').dataset.filled === 'true',
      { timeout: 6000 },
    )
  } catch {
    byDouble = false
  }
  console.log(`    double-clicked               ${byDouble ? 'minimized' : 'nothing happened'}`)
  if (!byDouble)
    problems.push('a double-click on the titlebar did nothing — windowshade’s seat is empty')
  await page.evaluate(() => document.querySelector('.gen-tile[data-win="scheda"]').click())
  await page.waitForFunction(
    () => document.querySelector('.gen-tile[data-win="scheda"]').dataset.filled === 'false',
    { timeout: 8000 },
  )
  await sleep(500)

  // ── 4. the live lamp says what it does ────────────────────────────────
  console.log('\n  the lamp')
  const glyph = await page.evaluate(() => {
    const el = document.querySelector('.gen-sheet[data-win="scheda"] .gen-lamp[data-role="minimize"]')
    const read = () => {
      const cs = getComputedStyle(el, '::before')
      return { opacity: +cs.opacity, w: parseFloat(cs.width), h: parseFloat(cs.height) }
    }
    const rest = read()
    // The synthetic twin, which is what the sheet wears in the air —
    // :hover can never match inside a texture.
    el.setAttribute('data-hover', '')
    const hovered = read()
    el.removeAttribute('data-hover')
    return { rest, hovered }
  })
  console.log(`    at rest                      opacity ${glyph.rest.opacity}`)
  console.log(
    `    reached for                  opacity ${glyph.hovered.opacity}, ${glyph.hovered.w}×${glyph.hovered.h}px`,
  )
  if (glyph.rest.opacity !== 0) problems.push('the minimize glyph is showing before it is reached for')
  if (glyph.hovered.opacity !== 1)
    problems.push(
      'the minimize glyph never appears on the hover twin — the only red widget in the titlebar ' +
        'goes on reading as a close button',
    )
  if (!(glyph.hovered.w >= 5 && glyph.hovered.w <= 9 && glyph.hovered.h <= 2))
    problems.push(
      `the glyph is ${glyph.hovered.w}×${glyph.hovered.h}px — it has stopped being a hairline bar`,
    )

  // ── 5. expanding a window takes the keyboard at once ──────────────────
  console.log('\n  expanding')
  await page.evaluate(() =>
    document
      .querySelector('.gen-sheet[data-win="scheda"] .gen-lamp[data-role="minimize"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true })),
  )
  await page.waitForFunction(
    () => document.querySelector('.gen-tile[data-win="scheda"]').dataset.filled === 'true',
    { timeout: 8000 },
  )
  await sleep(400)
  // Focus somewhere else first, so "it moved to the window" cannot be
  // satisfied by it never having left. The bay of a DIFFERENT window is
  // the honest starting point — it is where a hand would be.
  await page.evaluate(() => document.querySelector('.gen-tile[data-win="quadrato"]').focus())
  // Shift: the 6x restore, so the sample below lands in the middle of a
  // flight rather than in a race with its landing.
  await page.evaluate(() =>
    document
      .querySelector('.gen-tile[data-win="scheda"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })),
  )
  const early = []
  for (const at of [90, 260, 520]) {
    await sleep(at - (early.at(-1)?.at ?? 0))
    early.push({
      at,
      ...(await page.evaluate(() => ({
        flying: document.querySelector('.gen-tile[data-win="scheda"]').dataset.filled === 'true',
        front: document.querySelector('.gen-sheet[data-win="scheda"]')?.dataset.front === 'true',
      }))),
      focus: await where(),
    })
  }
  for (const s of early)
    console.log(
      `    +${String(s.at).padStart(3)}ms into the restore     focus is ${s.focus}${s.front ? ', reading as the front window' : ''}`,
    )
  // Every sample has to be mid-flight for any of this to mean anything:
  // a bay that has already emptied is a landing, not a transition.
  if (!early.every((s) => s.flying))
    problems.push(
      'the restore had already landed by the first sample — the flight is too quick to measure and the leg proved nothing',
    )
  else {
    const lost = early.filter((s) => s.focus !== 'the window scheda')
    if (lost.length)
      problems.push(
        `${lost.map((s) => `+${s.at}ms: ${s.focus}`).join(', ')} — the window being expanded does not hold ` +
          `the keyboard while it flies, so the focus is sitting on a bay that is emptying out from under it`,
      )
    const dim = early.filter((s) => !s.front)
    if (dim.length)
      problems.push(
        `at ${dim.map((s) => `+${s.at}ms`).join(', ')} the restoring window was still wearing the background ` +
          `treatment — and since that is read inside the capture root, it pops to active IN THE TEXTURE on landing`,
      )
  }

  console.log(
    `\nhand-and-keyboard: ${problems.length === 0 ? 'PASS — the window answers a hand and a keyboard' : 'FAIL'}`,
  )
  for (const p of problems) console.log(`  ${p}`)
  process.exit(problems.length === 0 ? 0 : 1)
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
