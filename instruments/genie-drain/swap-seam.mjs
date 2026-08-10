// swap-seam — is the window ever in two places at once, or back in one
// it already left?
//
// A flight is a handoff. The window exists on the desk as markup and in
// the air as a texture, and exactly one of them is supposed to be
// showing at any instant. The changeover is a single commit — the page
// copy goes `data-away` in the same render that the sheet turns visible
// — which is easy to state and easy to believe, and neither of those is
// evidence. What a viewer actually reports is "the window flickers back
// at its old spot sometimes", and `sometimes` is the word that means a
// race: a seam that opens on some frames and not others cannot be found
// by reading the commit, only by watching every frame of many flights.
//
// So this instrument does not screenshot. Screenshots sample at whatever
// rate the protocol manages, and a one-frame seam is exactly what that
// rate misses. It installs a recorder in the page instead, reads the
// three facts that decide what is on screen once per animation frame,
// and then asks of the whole trace:
//
//   1. NEVER TWICE. No frame may have the page copy showing while the
//      sheet is in the air with the pour under way. That is the double
//      image — the window at its desk position and the same window
//      halfway down the drain, both drawn.
//
//   2. NEVER BACK. Within one flight, once the page copy has gone away
//      it may not return. A window that blinks back to its rest position
//      mid-descent has un-handed the pixels it already gave up.
//
// The two are different failures. The first is a handoff where both
// parties hold the object; the second is one where it is passed back.
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

// How many round trips. A race that shows up one flight in four needs
// more than one flight to be caught, and needs to be caught reliably
// enough that a fix can be believed. Eight of each is ~25s of wall clock
// and puts the odds of missing a 1-in-4 seam under a tenth of a percent.
const ROUNDS = 8
// Below this the pour has not visibly started and the page copy is still
// the honest thing to be showing — the drive holds t at the wall until
// the texture has real pixels, on purpose. Above it, the sheet is drawn
// somewhere other than where the window sits, and two of them is two.
const PROGRESS_MOVED = 0.02

let server, browser
const deadline = setTimeout(() => {
  console.error('swap-seam: hard 180s deadline hit')
  process.exit(1)
}, 180_000)

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
    () => document.querySelector('.gen-slot[data-win="quadrato"]') && document.fonts.status === 'loaded',
    { timeout: 15_000 },
  )
  await sleep(700)

  // The recorder. Three facts per frame, per window:
  //
  //   away    the page copy is hidden (the attribute the stylesheet acts
  //           on, not a computed style — the hide lives on the slot's
  //           CHILDREN, so asking the slot for its own visibility answers
  //           a question nobody asked)
  //   filled  the bay is holding this window
  //   progress the drive's t, which it writes to the bay every frame
  //
  // Not "is a capture root mounted": that was the first spelling and it
  // was useless, because a Surface stays mounted at rest — that is the
  // whole point of the idle-zero gate — so it read true on all 1817
  // frames and made every round trip look like one long flight. The
  // states are read off the two attributes that actually decide what a
  // viewer sees.
  //
  // Recorded raw and judged afterwards in node. A recorder that decides
  // what counts as a fault is a recorder you have to re-run every time
  // the question changes.
  await page.evaluate(() => {
    window.__seam = []
    const wins = ['quadrato', 'cerchio', 'triangolo', 'scheda']
    const tick = () => {
      const row = { t: performance.now(), w: {} }
      const filmDirection = document.querySelector('.gen-page')?.dataset.genieFilmDirection
      for (const w of wins) {
        const slot = document.querySelector(`.gen-slot[data-win="${w}"]`)
        const tile = document.querySelector(`.gen-tile[data-win="${w}"]`)
        if (!slot) continue
        row.w[w] = {
          away: slot.dataset.away === 'true',
          filled: tile?.dataset.filled === 'true',
          progress: parseFloat(tile?.style.getPropertyValue('--gen-progress') || '0') || 0,
          direction: w === 'triangolo' ? filmDirection ?? null : null,
        }
      }
      window.__seam.push(row)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  const WINS = ['quadrato', 'cerchio', 'triangolo', 'scheda']
  // A wait that says what it saw. A bare timeout here reports only that
  // nine seconds passed, which is the least informative fact available:
  // the interesting question is always which of the three states the
  // window actually settled into.
  const waitFilled = async (w, want, where) => {
    try {
      await page.waitForFunction(
        (win, v) => document.querySelector(`.gen-tile[data-win="${win}"]`).dataset.filled === v,
        { timeout: 9000 },
        w,
        String(want),
      )
    } catch {
      const state = await page.evaluate((win) => {
        const slot = document.querySelector(`.gen-slot[data-win="${win}"]`)
        const tile = document.querySelector(`.gen-tile[data-win="${win}"]`)
        return {
          filled: tile.dataset.filled,
          away: slot.dataset.away ?? 'undefined',
          pour: tile.style.getPropertyValue('--pour'),
          slot: getComputedStyle(slot).transform,
        }
      }, w)
      throw new Error(
        `${where}: waited for ${w} filled=${want} and it never came. ` +
          `filled=${state.filled} away=${state.away} pour=${state.pour || '(unset)'}`,
      )
    }
  }

  // A click that checks it hit what it aimed at. Puppeteer's own click
  // takes the element's centre and dispatches there; it does not
  // hit-test. On a desk of overlapping windows a click that lands on
  // something else is silent — the instrument then reports "the app
  // ignored the gesture" when what happened is "the gesture never
  // arrived", and those two want opposite fixes.
  //
  // The cursor moves BEFORE the test, with a frame to settle. It has to:
  // the overlay canvas is solid only where there is matter, and it
  // decides that on pointermove. Hit-testing without moving first reads
  // the solidity left over from wherever the pointer was last, so an
  // airborne sheet three windows away can make a lamp look covered.
  const clickSure = async (sel, where) => {
    const box = await page.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }, sel)
    if (!box) throw new Error(`${where}: no such element ${sel}`)
    await page.mouse.move(box.x, box.y)
    await sleep(40)
    const hit = await page.evaluate(
      (s, x, y) => {
        const el = document.querySelector(s)
        const at = document.elementFromPoint(x, y)
        if (at === el || el.contains(at)) return { ok: true }
        // Named by attribute, not by `className`: on an SVG element that
        // property is an SVGAnimatedString and stringifies to noise.
        const d = (n) =>
          n
            ? `${n.tagName.toLowerCase()}${(n.getAttribute('class') || '').split(/\s+/).filter(Boolean).map((c) => `.${c}`).join('')}`
            : 'nothing'
        const chain = []
        for (let n = at; n && n !== document.documentElement; n = n.parentElement) chain.push(d(n))
        return { ok: false, why: `${chain.slice(0, 5).join(' in ')} is on top of it` }
      },
      sel,
      box.x,
      box.y,
    )
    if (!hit.ok) throw new Error(`${where}: cannot press ${sel} — ${hit.why}`)
    await page.mouse.click(box.x, box.y)
  }

  // The keyboard path. Both the lamps and the bays are real buttons, so
  // Enter on a focused one runs the same handler a click runs — with no
  // geometry involved, which is the point. Four windows cannot be sent
  // away by four clicks in a row: the first sheet takes off drawn over
  // the second window's lamp, the canvas is solid where that sheet is,
  // and the press correctly lands on the airborne sheet instead. The
  // desk is behaving; the mouse simply cannot express "all four at once"
  // from this cascade. The keyboard can.
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

  // Three ways to put a window away, because "sometimes" is a word about
  // paths and not about luck. A lamp click is the tidy one and the one a
  // developer tests; the other two are what a hand actually does.
  //
  //   A. the lamp. One press, the drive owns the whole descent.
  //   B. the titlebar, dragged past the commit point and released. The
  //      HAND owns t for the first part of the flight and the drive
  //      takes over mid-air, which is the one handoff in this scene that
  //      happens while the sheet is already up.
  //   C. all four at once. Four flights share one canvas and one frame
  //      loop, and each one's takeoff re-renders the tree the other
  //      three are mid-flight in.
  for (let i = 0; i < ROUNDS; i++) {
    await clickSure(`.gen-slot[data-win="scheda"] .gen-lamp[data-role="minimize"]`, `lamp ${i} down`)
    await waitFilled('scheda', true, `lamp ${i} down`)
    await sleep(140)
    await clickSure(`.gen-tile[data-win="scheda"]`, `lamp ${i} up`)
    await waitFilled('scheda', false, `lamp ${i} up`)
    await sleep(140)
  }

  for (let i = 0; i < ROUNDS; i++) {
    const bar = await page.evaluate(() => {
      const b = document.querySelector('.gen-slot[data-win="scheda"] .gen-titlebar').getBoundingClientRect()
      const dock = document.querySelector('.gen-tile[data-win="scheda"]').getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, reach: dock.top - (b.top + b.height / 2) }
    })
    await page.mouse.move(bar.x, bar.y)
    await page.mouse.down()
    for (let k = 1; k <= 10; k++) {
      await page.mouse.move(bar.x, bar.y + (bar.reach * 0.6 * k) / 10)
      await sleep(16)
    }
    // Let the drive catch up to the hand before releasing. Without this
    // the pointerup can be dispatched before the last pointermove has
    // been through a frame, so the release reads a t short of the commit
    // point and the window flies home instead of docking — which is a
    // real behaviour, correctly implemented, and not what this round is
    // trying to exercise.
    await sleep(260)
    await page.mouse.up()
    await waitFilled('scheda', true, `drag ${i} down (reach ${bar.reach.toFixed(0)}px)`)
    await sleep(140)
    await page.click(`.gen-tile[data-win="scheda"]`)
    await waitFilled('scheda', false, `drag ${i} up`)
    await sleep(140)
  }

  for (let i = 0; i < 3; i++) {
    for (const w of WINS)
      await pressKey(`.gen-slot[data-win="${w}"] .gen-lamp[data-role="minimize"]`, `all-four ${i} down`)
    for (const w of WINS) await waitFilled(w, true, `all-four ${i} down`)
    await sleep(140)
    for (const w of WINS) await pressKey(`.gen-tile[data-win="${w}"]`, `all-four ${i} up`)
    for (const w of WINS) await waitFilled(w, false, `all-four ${i} up`)
    await sleep(140)
  }

  const trace = await page.evaluate(() => window.__seam)
  // Per window, in frame order — the transition counts below are only
  // meaningful inside one window's own timeline.
  const byWin = Object.fromEntries(
    WINS.map((w) => [
      w,
      trace.filter((r) => r.w[w]).map((r) => ({ ...r.w[w], win: w, t: r.t })),
    ]),
  )
  const rows = WINS.flatMap((w) => byWin[w])

  // Leg 1 — never twice. The drive has moved, so the sheet is drawn
  // somewhere other than the window's own box, and the window's own box
  // is still showing.
  const twice = rows.filter((r) => r.progress > PROGRESS_MOVED && !r.away)

  // Leg 2 — never back, except for the film's deliberate reverse overlap.
  // That transfer reveals the shared native canvas at the rest wall while
  // WebGL still covers it, then releases WebGL on the next frame. It is valid
  // only for the film, only while restoring, and only at the terminal wall.
  const reverseOverlap = rows.filter(
    (r) =>
      r.win === 'triangolo' &&
      r.direction === 'restoring' &&
      r.progress <= PROGRESS_MOVED &&
      r.filled &&
      !r.away,
  )
  const back = rows.filter(
    (r) =>
      r.filled &&
      !r.away &&
      !(
        r.win === 'triangolo' &&
        r.direction === 'restoring' &&
        r.progress <= PROGRESS_MOVED
      ),
  )

  // Leg 3 — never snaps. The two legs above ask WHERE the window is
  // showing, and both were quiet; neither of them can see the third way
  // a viewer gets a flash of the window at its old spot, which is the
  // sheet itself jumping back to the wall it left. The drive holds t at
  // the wall until the texture has real pixels and then runs it to the
  // far wall; if anything mid-flight puts it back — a re-mount, a
  // painted flag going false, a drive rebuilt from resting values — the
  // sheet is drawn at the window's rest pose for as long as that lasts,
  // which is the reported symptom exactly.
  //
  // Judged on the frame-to-frame step, not on monotonicity: the drive is
  // a spring and a spring may overshoot and come back, so a little
  // reversal is physics. A snap is not little. The minimize covers the
  // whole range in ~450ms, which at 60fps is ~0.033 per frame and peaks
  // near 0.08; SNAP sits well above the fastest honest frame and well
  // below a return to the wall.
  const SNAP = 0.2
  // Only frames that arrived on time. A dropped frame lets the drive
  // integrate several frames' worth of motion into one step, and that
  // large step is the renderer catching up, not the sheet jumping.
  const ON_TIME_MS = 40
  const snaps = []
  for (const w of WINS) {
    const t = byWin[w]
    for (let i = 1; i < t.length; i++) {
      const dt = t[i].t - t[i - 1].t
      const step = t[i].progress - t[i - 1].progress
      if (dt > ON_TIME_MS || Math.abs(step) < SNAP) continue
      // A step across a custody change is the Bays taking the bay back
      // from the Driver on the landing frame, which is the handoff doing
      // its job rather than a jump.
      if (t[i].filled !== t[i - 1].filled) continue
      snaps.push({ win: w, from: t[i - 1].progress, to: t[i].progress, dt })
    }
  }

  // How many landings the recorder actually saw, so a clean trace can be
  // told apart from an empty one.
  let downs = 0
  let ups = 0
  for (const w of WINS) {
    const t = byWin[w]
    for (let i = 1; i < t.length; i++) {
      if (t[i].filled && !t[i - 1].filled) downs++
      if (!t[i].filled && t[i - 1].filled) ups++
    }
  }
  // Two lamp rounds, two drag rounds, three all-four rounds: scheda flies
  // 2*ROUNDS + 3 times and the other three fly 3 each.
  const EXPECTED = 2 * ROUNDS + 3 + 3 * 3

  console.log(`\n  ${trace.length} frames recorded across ${WINS.length} windows`)
  console.log(`    minimizes landed             ${downs} of ${EXPECTED}`)
  console.log(`    restores landed              ${ups} of ${EXPECTED}`)
  console.log(`    both copies showing          ${twice.length}`)
  if (twice.length) {
    console.log(`      during minimize            ${twice.filter((r) => !r.filled).length}`)
    console.log(`      during restore             ${twice.filter((r) => r.filled).length}`)
  }
  console.log(`    docked, yet showing on desk  ${back.length}`)
  console.log(`    intentional reverse overlap ${reverseOverlap.length}`)
  console.log(`    sheet snapped mid-flight     ${snaps.length}`)

  if (downs < EXPECTED || ups < EXPECTED)
    problems.push(
      `the recorder saw ${downs} minimizes and ${ups} restores where ${EXPECTED} were driven — it missed ` +
        `landings, so a clean trace here would not mean much`,
    )
  if (twice.length)
    problems.push(
      `${twice.length} frames drew a window twice — ${twice[0].win}'s page copy was still showing with the ` +
        `progress ${(twice[0].progress * 100).toFixed(0)}% of the way down`,
    )
  if (back.length)
    problems.push(
      `on ${back.length} frames a bay was holding its window and the desk was showing it anyway ` +
        `(${[...new Set(back.map((r) => r.win))].join(', ')}) — the window blinks back to the position it left`,
    )

  if (snaps.length)
    problems.push(
      `${snaps.length} frames jumped the sheet by more than ${SNAP} of its travel in one on-time frame — ` +
        `${snaps[0].win} went ${snaps[0].from.toFixed(2)} → ${snaps[0].to.toFixed(2)} in ` +
        `${snaps[0].dt.toFixed(1)}ms, which draws the window back at the pose it left`,
    )

  console.log(
    `\nswap-seam: ${problems.length === 0 ? 'PASS — one window, one place, every frame' : 'FAIL'}`,
  )
  for (const p of problems) console.log(`  ${p}`)
  process.exit(problems.length === 0 ? 0 : 1)
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
