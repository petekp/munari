// content-keeps-running — does the window come back, or does a new one
// come back wearing its clothes?
//
// A minimize is supposed to be a change of custody, not a teardown. The
// page copy is hidden for the duration and shown again on landing, and
// that is the whole of it: the same elements, still mounted, still
// running. Nothing in a screenshot can tell that apart from a window
// that was unmounted and rebuilt, because a rebuilt window looks
// identical the instant it finishes rebuilding.
//
// What gives it away is anything the DOM was in the MIDDLE of. So this
// asks three questions of a round trip, each about a thing that cannot
// survive a remount:
//
//   1. IDENTITY. A property stamped on the elements before the flight is
//      still on them after. Fresh nodes carry no stamp — this is the
//      question stated in its most direct form, with no proxy.
//
//   2. THE FILM KEPT ROLLING. The video's currentTime advanced by about
//      the wall time the round trip took. A remounted <video> restarts,
//      and a paused one does not move at all; both read as a clip that
//      jumps when the window comes back, which is what a viewer notices.
//
//   3. THE TYPING SURVIVED. Text put in the field is still there. React
//      holds that in state above the window, so it would survive a
//      remount — which is the point of measuring it separately: if 1 and
//      2 fail while 3 passes, the loss is in the DOM and not the model.
//
// The keyboard drives the flights. The film window sits in the middle of
// the cascade with its lamp covered, and a click aimed at a covered lamp
// lands on the window in front of it — the buttons answer Enter, and
// Enter has no geometry to get wrong.
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

// The window holding the film, and the one holding the text field.
const FILM = 'triangolo'
const NOTE = 'scheda'
const ROUNDS = 3
// The clip's own length, from tools/make-film.sh. currentTime wraps at
// the end of it, so elapsed time has to be compared modulo the period.
const PERIOD = 12
// How far the film's clock may drift from the wall clock over a round
// trip before "it kept playing" stops being true. A decoder that is
// merely busy stays within a few frames; one that was restarted or
// paused is out by the whole trip.
const DRIFT_S = 0.35

let server, browser
const deadline = setTimeout(() => {
  console.error('content-keeps-running: hard 150s deadline hit')
  process.exit(1)
}, 150_000)

const problems = []

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--enable-features=CanvasDrawElement',
      '--disable-renderer-backgrounding',
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  const page = await browser.newPage()
  await page.setViewport({ width: 1100, height: 800, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:${port}/?scene=genie`, { waitUntil: 'load' })
  await page.waitForFunction(
    () =>
      document.querySelector('.gen-slot[data-win="quadrato"]') && document.fonts.status === 'loaded',
    { timeout: 15_000 },
  )
  // The film has to be running before anything is asked of it. A clip
  // that never started would hold currentTime at 0 through every round
  // and answer leg 2 with a number that proves nothing.
  await page.waitForFunction(
    () => {
      const v = document.querySelector('.gen-slot[data-win="triangolo"] video')
      return v && v.readyState >= 2 && !v.paused && v.currentTime > 0
    },
    { timeout: 15_000 },
  )
  await sleep(400)

  const pressKey = async (sel, where) => {
    const ok = await page.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return false
      el.focus()
      return document.activeElement === el
    }, sel)
    if (!ok) throw new Error(`${where}: ${sel} would not take focus`)
    await page.keyboard.press('Enter')
  }

  const waitFilled = async (w, want) =>
    page.waitForFunction(
      (win, v) => document.querySelector(`.gen-tile[data-win="${win}"]`).dataset.filled === v,
      { timeout: 9000 },
      w,
      String(want),
    )

  const TYPED = 'still here'
  await page.evaluate((w) => document.querySelector(`.gen-slot[data-win="${w}"] .gen-field`)?.focus(), NOTE)
  await page.keyboard.type(TYPED)

  // The stamp. Put on the nodes themselves, not on anything React
  // renders, so React has no way to reproduce it.
  await page.evaluate(
    (film, note) => {
      const mark = (el, n) => {
        if (el) el.__stamp = n
      }
      mark(document.querySelector(`.gen-slot[data-win="${film}"] video`), 'film')
      mark(document.querySelector(`.gen-slot[data-win="${film}"] .gen-window`), 'filmWindow')
      mark(document.querySelector(`.gen-slot[data-win="${note}"] .gen-field`), 'note')
    },
    FILM,
    NOTE,
  )

  const readFilm = () =>
    page.evaluate((w) => {
      const v = document.querySelector(`.gen-slot[data-win="${w}"] video`)
      return v ? { t: v.currentTime, paused: v.paused, stamp: v.__stamp ?? null } : null
    }, FILM)

  let lost = 0
  const drifts = []
  for (let i = 0; i < ROUNDS; i++) {
    const before = await readFilm()
    const wall0 = Date.now()

    for (const w of [FILM, NOTE])
      await pressKey(`.gen-slot[data-win="${w}"] .gen-lamp[data-role="minimize"]`, `round ${i} down`)
    for (const w of [FILM, NOTE]) await waitFilled(w, true)
    // Held down a while, so the film has real time to fall behind if it
    // is going to. A round trip that takes 200ms cannot tell a playing
    // decoder from a stopped one.
    await sleep(900)
    for (const w of [FILM, NOTE]) await pressKey(`.gen-tile[data-win="${w}"]`, `round ${i} up`)
    for (const w of [FILM, NOTE]) await waitFilled(w, false)
    await sleep(250)

    const after = await readFilm()
    const wall = (Date.now() - wall0) / 1000
    if (!after || after.stamp !== 'film') lost++
    if (before && after) {
      // Modulo the clip's period, because the film loops mid-trip.
      const moved = (((after.t - before.t) % PERIOD) + PERIOD) % PERIOD
      drifts.push(Math.abs(moved - (wall % PERIOD)))
    }
  }

  const kept = await page.evaluate(
    (film, note) => {
      const q = (s) => document.querySelector(s)
      const noteEl = q(`.gen-slot[data-win="${note}"] .gen-field`)
      return {
        film: q(`.gen-slot[data-win="${film}"] video`)?.__stamp ?? null,
        window: q(`.gen-slot[data-win="${film}"] .gen-window`)?.__stamp ?? null,
        note: noteEl?.__stamp ?? null,
        typed: noteEl?.value ?? null,
        paused: q(`.gen-slot[data-win="${film}"] video`)?.paused ?? null,
      }
    },
    FILM,
    NOTE,
  )

  const worst = drifts.length ? Math.max(...drifts) : -1

  console.log(`\n  ${ROUNDS} round trips, film and note window together`)
  console.log(`    the <video> node                 ${kept.film === 'film' ? 'the same one' : 'REPLACED'}`)
  console.log(`    the window element               ${kept.window === 'filmWindow' ? 'the same one' : 'REPLACED'}`)
  console.log(`    the text field                   ${kept.note === 'note' ? 'the same one' : 'REPLACED'}`)
  console.log(`    the film                         ${kept.paused ? 'PAUSED' : 'still playing'}`)
  console.log(`    worst drift from the wall clock  ${worst < 0 ? 'n/a' : `${worst.toFixed(3)}s`}`)
  console.log(`    what was typed                   ${JSON.stringify(kept.typed)}`)

  if (kept.film !== 'film' || kept.window !== 'filmWindow' || kept.note !== 'note')
    problems.push(
      `the round trip replaced DOM nodes (video ${kept.film ? 'kept' : 'lost'}, window ` +
        `${kept.window ? 'kept' : 'lost'}, field ${kept.note ? 'kept' : 'lost'}) — the window is being ` +
        `torn down and rebuilt rather than hidden and shown`,
    )
  if (lost)
    problems.push(`${lost} of ${ROUNDS} round trips came back with a different <video> element`)
  if (kept.paused) problems.push('the film is paused after the round trip — it did not keep playing')
  if (worst > DRIFT_S)
    problems.push(
      `the film's clock drifted ${worst.toFixed(2)}s from the wall clock over a round trip, past the ` +
        `${DRIFT_S}s a busy decoder explains — it stopped while the window was away`,
    )
  if (kept.typed !== TYPED)
    problems.push(`the field came back holding ${JSON.stringify(kept.typed)}, not ${JSON.stringify(TYPED)}`)

  console.log(
    `\ncontent-keeps-running: ${problems.length === 0 ? 'PASS — the same window comes back, still running' : 'FAIL'}`,
  )
  for (const p of problems) console.log(`  ${p}`)
  process.exit(problems.length === 0 ? 0 : 1)
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
