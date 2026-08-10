// four-windows — is this a desk, or one window with a movie?
//
// The scene shipped with a single flight slot: four windows, but only
// one of them permitted to be in motion at a time. That reads as a
// demo. A desk is a place where things are independent of each other,
// and five claims are what make these four objects windows rather than
// four states of one:
//
//   1. FOUR AT ONCE. Every window can be in the air simultaneously,
//      each with its own drive, its own geometry, its own paint gate,
//      and each landing in its own bay. The failure this catches is not
//      a crash — a scene with one flight slot simply IGNORES the second
//      press, which looks like a missed click and gets blamed on the
//      browser.
//
//   2. A DRAG MOVES THE WINDOW. The titlebar has two jobs and the drag's
//      direction picks between them: a pull toward the dock pours, and
//      anything else repositions. Both directions are measured, because
//      the interesting failure is one-sided — a cone that is too wide
//      swallows every reposition, a cone that is too narrow loses the
//      gesture the window's own copy tells you to try.
//
//   3. PRESSING A WINDOW RAISES IT. The oldest convention on any desk,
//      and the one that decides which window a shadow falls on.
//
//   4. PUTTING ONE AWAY IS NOT A PROMOTION. The stack is a history of
//      what you reached for, so a minimize has to leave it alone while a
//      restore claims the front. The scene had one expression serving
//      both, and the cost landed on the window you were NOT touching:
//      docking a study stole the front rung from the working window,
//      which dimmed for the length of the flight and lit again on
//      arrival. Both halves are asserted, because "nothing moved" is
//      also what you get from deleting the raise altogether.
//
//   5. AN AIRBORNE SHEET IS STILL A WINDOW, which means it paints where
//      its window painted. The desk's own stacking order is what makes
//      this possible to get wrong, and it is not a bug anything in the
//      scene can see: the overlay canvas is positioned with `z-index:
//      auto`, and CSS paints that layer strictly BELOW every positive
//      z-index (2.1 Appendix E, steps 6 and 7). So the day the windows
//      were given a stacking order, every sheet began flying home behind
//      the windows it took off from — with no scene state wrong
//      anywhere, which is exactly why leg 4 passed all the way through
//      it. Nothing that reads z-index can catch this. It takes pixels.
//
// The flights are started by dispatching a click on the lamp rather than
// by aiming a real pointer at it, and that is deliberate: the three
// studies overlap by design, so an airborne sheet sits over its
// neighbour's lamp, and a real press there would (correctly) catch the
// sheet in front instead. Hit-testing is the subject of mouth-anchor and
// live-content. What is under test here is whether four flights can
// coexist, so the presses are delivered where overlap cannot confuse
// them. Legs 2 and 3 use a real pointer, because there the geometry IS
// the claim.
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

// Where the drag is aimed, in px. UP_RIGHT is well outside the pour cone
// (|dx| ≤ dy × 0.5) and DOWN is straight along it. Both clear CLAIM_PX
// by a wide margin, so neither leg is measuring the claim threshold.
const UP_RIGHT = { dx: 140, dy: -60 }
const DOWN = { dx: 0, dy: 44 }
// A committed move must land within this of where the hand let go. It is
// not a tolerance on the drag — that arithmetic is exact — but on the
// clamp, which may legitimately stop a window short of the desk's edge.
const LANDED_PX = 1.5

let server, browser
const deadline = setTimeout(() => {
  console.error('four-windows: hard 150s deadline hit')
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

  // ── 0. the stack the desk opens on ────────────────────────────────────
  //
  // The three studies cascade down and to the right, and their shadows
  // fall the same way — so the up-left study has to be ON TOP or every
  // one of them covers the shadow of the study above it and the cascade
  // reads as three flat cutouts. This is the one part of the stack that
  // is a composition rather than a history, so it is asserted before any
  // press has had a chance to reorder it.
  const opening = await page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('.gen-slot')].map((s) => [s.dataset.win, +s.style.zIndex]),
    ),
  )
  console.log(
    `\n  the desk opens   ${Object.entries(opening)
      .sort((a, b) => a[1] - b[1])
      .map(([w]) => w)
      .join(' → ')}   (back to front)`,
  )
  if (!(opening.quadrato > opening.cerchio && opening.cerchio > opening.triangolo))
    problems.push(
      'the studies open stacked down-right-on-top, so each one covers the shadow of the one ' +
        'above it and none of the three cast a visible shadow at all',
    )

  // ── 1. four at once ───────────────────────────────────────────────────
  //
  // A parked subtree lives in <body>, so an airborne copy is a FIFTH
  // .gen-sheet in the same document as the four page copies. Counting
  // them is therefore a direct count of how many windows are in the air,
  // with no scene state to trust.
  console.log('\n  four at once')
  const peak = await page.evaluate(async () => {
    for (const lamp of document.querySelectorAll('.gen-lamp[data-role="minimize"]'))
      // Shift for the 6x flight: every one of them is still airborne long
      // after the last is launched, which is the whole point.
      lamp.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))

    let sheets = 0
    let hidden = 0
    const t0 = performance.now()
    while (performance.now() - t0 < 1500) {
      sheets = Math.max(sheets, document.querySelectorAll('.gen-sheet').length)
      hidden = Math.max(
        hidden,
        [...document.querySelectorAll('.gen-slot')].filter((s) => s.dataset.away === 'true')
          .length,
      )
      await new Promise((r) => requestAnimationFrame(r))
    }
    return { sheets, hidden }
  })
  console.log(`    windows in the air at once   ${peak.sheets - 4} of 4`)
  console.log(`    page copies handed over      ${peak.hidden} of 4`)

  // Landing is a separate assertion from taking off: a scene could
  // permit four flights and still lose three of them on arrival, since
  // every landing writes the same `docked` list.
  let landed = 0
  try {
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.gen-tile[data-role="window"]')].every(
          (t) => t.dataset.filled === 'true',
        ),
      { timeout: 12_000 },
    )
    landed = 4
  } catch {
    landed = await page.evaluate(
      () =>
        [...document.querySelectorAll('.gen-tile[data-role="window"]')].filter(
          (t) => t.dataset.filled === 'true',
        ).length,
    )
  }
  console.log(`    bays holding a window        ${landed} of 4`)

  if (peak.sheets - 4 < 4)
    problems.push(
      `only ${peak.sheets - 4} window(s) were ever in the air at once — a second press is being ` +
        `swallowed, which on a desk reads as a missed click rather than as a refusal`,
    )
  if (peak.hidden < 4)
    problems.push(
      `only ${peak.hidden} page copies handed over — a window that stays on the desk while its ` +
        `sheet flies is being drawn twice`,
    )
  if (landed < 4) problems.push(`${4 - landed} window(s) never reached a bay`)

  // Put them all back, and check the reverse direction carries four too.
  await page.evaluate(() => {
    for (const tile of document.querySelectorAll('.gen-tile[data-role="window"]'))
      tile.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  try {
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.gen-tile[data-role="window"]')].every(
          (t) => t.dataset.filled === 'false',
        ),
      { timeout: 12_000 },
    )
    console.log('    all four poured back out     yes')
  } catch {
    problems.push('four simultaneous restores did not all reach the desk')
  }
  await sleep(600)

  // ── 2. a drag moves the window ────────────────────────────────────────
  console.log('\n  the titlebar')
  const grip = () =>
    page.evaluate(() => {
      const slot = document.querySelector('.gen-slot[data-win="scheda"]').getBoundingClientRect()
      const bar = document
        .querySelector('.gen-sheet[data-win="scheda"] .gen-titlebar')
        .getBoundingClientRect()
      // Well right of the lamps, so the press is on bare titlebar.
      return { x: bar.right - 40, y: bar.top + bar.height / 2, left: slot.left, top: slot.top }
    })

  const drag = async ({ dx, dy }, release = true) => {
    const g = await grip()
    await page.mouse.move(g.x, g.y)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(g.x + (dx * i) / 10, g.y + (dy * i) / 10)
      await sleep(16)
    }
    if (release) await page.mouse.up()
    return g
  }

  const before = await drag(UP_RIGHT)
  await sleep(250)
  const after = await grip()
  const moved = { dx: after.left - before.left, dy: after.top - before.top }
  const off = Math.hypot(moved.dx - UP_RIGHT.dx, moved.dy - UP_RIGHT.dy)
  const poured = await page.evaluate(
    () => document.querySelector('.gen-tile[data-win="scheda"]').dataset.filled === 'true',
  )
  console.log(
    `    dragged up-right by 140,-60  window moved ${moved.dx.toFixed(0)},${moved.dy.toFixed(0)}`,
  )
  if (off > LANDED_PX)
    problems.push(
      `an up-and-right drag moved the window ${moved.dx.toFixed(0)},${moved.dy.toFixed(0)} ` +
        `instead of ${UP_RIGHT.dx},${UP_RIGHT.dy} — ${off.toFixed(1)}px off`,
    )
  if (poured) problems.push('an up-and-right drag poured the window into its bay')

  // And the other side of the same decision: straight down still hands
  // the window to the genie, which is what the window's own copy invites.
  await drag(DOWN, false)
  const airborne = await page.evaluate(() => document.querySelectorAll('.gen-sheet').length - 4)
  console.log(`    dragged straight down 44     ${airborne ? 'poured' : 'did not pour'}`)
  if (!airborne)
    problems.push(
      'a straight-down drag did not start a pour — the scrub the window’s own copy ' +
        'tells you to try is unreachable',
    )
  // Release back at the top so it springs home rather than docking.
  const g = await grip()
  await page.mouse.move(g.x, g.y - 20)
  await page.mouse.up()
  await page.waitForFunction(
    () => document.querySelectorAll('.gen-sheet').length === 4,
    { timeout: 8000 },
  )
  await sleep(400)

  // ── 3. pressing a window raises it ────────────────────────────────────
  console.log('\n  the stack')
  const stack = () =>
    page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll('.gen-slot')].map((s) => [s.dataset.win, +s.style.zIndex]),
      ),
    )
  const z0 = await stack()
  const back = Object.entries(z0).sort((a, b) => a[1] - b[1])[0][0]
  // Aim at a part of the backmost window's titlebar that is genuinely
  // exposed, and prove it is: a press that lands on the window covering
  // it would raise the wrong one and the leg would pass for the wrong
  // reason.
  const aim = await page.evaluate((win) => {
    const bar = document
      .querySelector(`.gen-sheet[data-win="${win}"] .gen-titlebar`)
      .getBoundingClientRect()
    const p = { x: bar.right - 12, y: bar.top + bar.height / 2 }
    const el = document.elementFromPoint(p.x, p.y)
    return { ...p, on: el?.closest('[data-win]')?.dataset.win ?? null }
  }, back)
  console.log(`    backmost window              ${back} (z ${z0[back]})`)
  if (aim.on !== back) {
    problems.push(
      `the press aimed at ${back}'s titlebar landed on ${aim.on} — the stack was not tested`,
    )
  } else {
    await page.mouse.click(aim.x, aim.y)
    await sleep(200)
    const z1 = await stack()
    const top = Object.entries(z1).sort((a, b) => b[1] - a[1])[0][0]
    console.log(`    after pressing it            frontmost is ${top} (z ${z1[back]})`)
    if (top !== back)
      problems.push(`pressing ${back} left ${top} in front — click-to-front is not wired`)
    // Focus follows the stack, and it has to be readable from the sheet
    // itself: the airborne copy renders from the same attribute, so a
    // focus ring only the page copy knew about would flash at the swap.
    const front = await page.evaluate(
      () => document.querySelector('.gen-sheet[data-front]')?.dataset.win ?? null,
    )
    console.log(`    marked active                ${front}`)
    if (front !== back)
      problems.push(`${back} is frontmost but ${front} is the one drawn awake`)
  }

  // ── 4. putting one away is not a promotion ────────────────────────────
  //
  // Delivered by a real pointer, unlike leg 1: the raise this leg is
  // watching for hangs off the window's pointerdown, and a dispatched
  // click would sail straight past it and let the leg pass on the
  // defect. So the lamp has to be one that is genuinely exposed, and on
  // a window that is not already frontmost — a promotion is only
  // detectable in something that had somewhere to be promoted from.
  console.log('\n  putting one away')
  const sig = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.gen-slot')]
        .map((s) => `${s.dataset.win}:${s.style.zIndex}`)
        .sort()
        .join(' '),
    )
  const lit = () =>
    page.evaluate(() => document.querySelector('.gen-sheet[data-front]')?.dataset.win ?? null)

  const z2 = await stack()
  const frontmost = Object.entries(z2).sort((a, b) => b[1] - a[1])[0][0]
  const lamps = await page.evaluate(
    (skip) =>
      [...document.querySelectorAll('.gen-sheet')]
        .map((sheet) => {
          const win = sheet.dataset.win
          const b = sheet
            .querySelector('.gen-lamp[data-role="minimize"]')
            .getBoundingClientRect()
          const p = { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }
          const el = document.elementFromPoint(p.x, p.y)
          const on = el?.closest('.gen-lamp') ? el.closest('.gen-sheet')?.dataset.win : null
          return { win, ...p, exposed: on === win }
        })
        .filter((c) => c.exposed && c.win !== skip),
    frontmost,
  )

  if (lamps.length === 0) {
    problems.push('no background window has an uncovered minimize lamp — leg 4 never ran')
  } else {
    const target = lamps[0]
    const before4 = await sig()
    const wasLit = await lit()
    console.log(`    minimizing ${target.win.padEnd(17)} (${wasLit} is the working window)`)

    // Start sampling before the press: a raise that is undone on landing
    // still dims the working window for the length of the flight, and a
    // before/after pair would not see it.
    const sampler = page.evaluate(async (ms) => {
      const shot = () => ({
        z: [...document.querySelectorAll('.gen-slot')]
          .map((s) => `${s.dataset.win}:${s.style.zIndex}`)
          .sort()
          .join(' '),
        lit: document.querySelector('.gen-sheet[data-front]')?.dataset.win ?? null,
      })
      const zs = new Set()
      const lits = new Set()
      const t0 = performance.now()
      while (performance.now() - t0 < ms) {
        const s = shot()
        zs.add(s.z)
        lits.add(s.lit)
        await new Promise((r) => requestAnimationFrame(r))
      }
      return { zs: [...zs], lits: [...lits] }
    }, 1400)
    await page.mouse.click(target.x, target.y)
    const during = await sampler
    await page.waitForFunction(
      (w) => document.querySelector(`.gen-tile[data-win="${w}"]`).dataset.filled === 'true',
      { timeout: 8000 },
      target.win,
    )
    await sleep(500)
    const after4 = await sig()

    console.log(`    distinct stacks in flight    ${during.zs.length}`)
    console.log(`    working window through it    ${during.lits.join(' → ')}`)
    if (during.zs.length !== 1 || during.zs[0] !== before4)
      problems.push(
        `minimizing ${target.win} reordered the desk mid-flight — a window being put away is ` +
          `taking the front rung on its way out`,
      )
    if (after4 !== before4)
      problems.push(`${target.win} did not keep its z-index across the minimize`)
    if (during.lits.length !== 1 || during.lits[0] !== wasLit)
      problems.push(
        `${wasLit} stopped being the working window while ${target.win} was in flight — it dims ` +
          `for half a second every time another window is docked`,
      )

    // The other half: a restore DOES claim the front. Without this the
    // leg above would pass on a scene that never raises anything.
    await page.evaluate(
      (w) => document.querySelector(`.gen-tile[data-win="${w}"]`).click(),
      target.win,
    )
    await page.waitForFunction(
      (w) => document.querySelector(`.gen-tile[data-win="${w}"]`).dataset.filled === 'false',
      { timeout: 8000 },
      target.win,
    )
    await sleep(500)
    const z3 = await stack()
    const nowTop = Object.entries(z3).sort((a, b) => b[1] - a[1])[0][0]
    console.log(`    restored, frontmost is       ${nowTop}`)
    if (nowTop !== target.win)
      problems.push(
        `${target.win} came back out behind ${nowTop} — a window you asked for should arrive in front`,
      )
  }

  // ── 5. an airborne sheet is still a window ────────────────────────────
  //
  // Three frames of the SAME patch of desk — the rectangle where quadrato
  // covers triangolo — and the question is only which of the outer two
  // the middle one resembles:
  //
  //   at rest    quadrato is there, in front, covering triangolo
  //   in flight  the page copy has handed over; the sheet is there instead
  //   docked     quadrato is gone and triangolo is showing
  //
  // A sheet painting over the desk still looks like the window, so the
  // middle frame sits near the first. A sheet painting UNDER the desk is
  // invisible in this rectangle, so the middle frame sits near the last.
  // Reading it as a comparison rather than a threshold is what makes it
  // independent of where in the flight it is sampled: the warp moves the
  // sheet's edges either way, and only the classification is stable.
  console.log('\n  the sheet in the stack')
  const press = (win, fromRight) =>
    page.evaluate(
      (w, dx) => {
        const bar = document.querySelector(`.gen-sheet[data-win="${w}"] .gen-titlebar`)
        const b = bar.getBoundingClientRect()
        bar.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            clientX: b.right - dx,
            clientY: b.top + b.height / 2,
          }),
        )
      },
      win,
      fromRight,
    )

  // Deterministic setup: without this the overlap might already be
  // showing triangolo, and a sheet flying behind it would look exactly
  // like a sheet flying in front of it.
  await press('quadrato', 12)
  await sleep(200)
  const z4 = await stack()
  const patch = await page.evaluate(() => {
    const r = (w) => document.querySelector(`.gen-slot[data-win="${w}"]`).getBoundingClientRect()
    const a = r('quadrato')
    const b = r('triangolo')
    // Inset by 4px so a hairline border landing on the boundary cannot
    // account for the difference on its own.
    return {
      x: Math.round(Math.max(a.left, b.left)) + 4,
      y: Math.round(Math.max(a.top, b.top)) + 4,
      w: Math.round(Math.min(a.right, b.right) - Math.max(a.left, b.left)) - 8,
      h: Math.round(Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) - 8,
    }
  })
  console.log(`    quadrato over triangolo      ${patch.w}×${patch.h}px`)

  if (!(z4.quadrato > z4.triangolo) || patch.w < 60 || patch.h < 60) {
    problems.push(
      'quadrato is not covering enough of triangolo to tell the two apart — leg 5 never ran',
    )
  } else {
    const frame = () => page.screenshot({ encoding: 'base64' })
    const atRest = await frame()
    await page.evaluate(() =>
      document
        .querySelector('.gen-sheet[data-win="quadrato"] .gen-lamp[data-role="minimize"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })),
    )
    // Long enough for the handover, early enough that the warp has not
    // yet emptied the rectangle on its own. Asserted, not assumed.
    await sleep(280)
    const handedOver = await page.evaluate(
      () => document.querySelector('.gen-slot[data-win="quadrato"]').dataset.away === 'true',
    )
    const inFlight = await frame()
    await page.waitForFunction(
      () => document.querySelector('.gen-tile[data-win="quadrato"]').dataset.filled === 'true',
      { timeout: 20_000 },
    )
    await sleep(700)
    const docked5 = await frame()

    const cmp = await page.evaluate(
      async (frames, r) => {
        const load = async (s) => {
          const img = new Image()
          img.src = 'data:image/png;base64,' + s
          await img.decode()
          const c = new OffscreenCanvas(img.width, img.height)
          c.getContext('2d').drawImage(img, 0, 0)
          return c.getContext('2d').getImageData(0, 0, img.width, img.height)
        }
        const [A, B, C] = await Promise.all(frames.map(load))
        const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        const count = (X, Y) => {
          let n = 0
          for (let y = r.y; y < r.y + r.h; y++)
            for (let x = r.x; x < r.x + r.w; x++) {
              const i = (y * X.width + x) * 4
              if (Math.abs(lum(X.data, i) - lum(Y.data, i)) > 12) n++
            }
          return n
        }
        return { toRest: count(B, A), toGone: count(B, C), total: r.w * r.h }
      },
      [atRest, inFlight, docked5],
      patch,
    )
    const pc = (n) => `${((100 * n) / cmp.total).toFixed(1)}%`
    console.log(`    page copy handed over        ${handedOver ? 'yes' : 'no'}`)
    console.log(`    in flight vs. window there   ${pc(cmp.toRest)} different`)
    console.log(`    in flight vs. window gone    ${pc(cmp.toGone)} different`)

    if (!handedOver)
      problems.push('the page copy had not handed over at the sample — leg 5 measured the DOM copy')
    if (cmp.toRest >= cmp.toGone)
      problems.push(
        'the airborne sheet is painting BEHIND the desk — it flies home underneath the windows ' +
          'it took off from, which reads as the window dropping to the bottom of the stack. The ' +
          'overlay canvas needs a z-index above the windows: positioned boxes with `z-index: ' +
          'auto` paint below every positive z-index, so giving the windows a stacking order ' +
          'silently put the whole overlay under them',
      )
    await page.evaluate(() => document.querySelector('.gen-tile[data-win="quadrato"]').click())
    await page.waitForFunction(
      () => document.querySelector('.gen-tile[data-win="quadrato"]').dataset.filled === 'false',
      { timeout: 8000 },
    )
  }

  // ── 6. the bay is a gauge, not a light ────────────────────────────────
  //
  // The mark inside a bay fills from the TOP DOWN by how much of its
  // window the bay is holding — so a hand scrubbing the drag moves the
  // level under its own finger, and a pour caught halfway leaves the dock
  // reading halfway. That is only possible because the level IS the
  // drive's t; a fill hung off the `data-filled` flip has nothing to say
  // until the landing, and reads as a light switching on at the end of
  // an animation it was supposed to be describing.
  //
  // Downward, because the sheet arrives from above and lands on the bay's
  // top edge; a level that rose to meet it would run against the only
  // motion on screen. Direction is asserted and not merely described,
  // because a count of signal rows cannot tell the two apart — the first
  // spelling of this leg counted rows in a column and would have passed,
  // unchanged, on a fill running either way.
  //
  // Measured off the screen, not off the stylesheet: the question is how
  // many rows of the mark are actually painted in the signal colour and
  // WHERE they sit, and a computed clip-path would answer a different
  // one.
  console.log('\n  the bay as a gauge')
  const level = async (win) => {
    const box = await page.evaluate((w) => {
      const r = document.querySelector(`.gen-tile[data-win="${w}"] .gen-pane`).getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y0: Math.floor(r.top), y1: Math.ceil(r.bottom) }
    }, win)
    return await page.evaluate(
      async (b64, b) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await img.decode()
        const c = new OffscreenCanvas(img.width, img.height)
        c.getContext('2d').drawImage(img, 0, 0)
        const { data: d, width } = c.getContext('2d').getImageData(0, 0, img.width, img.height)
        // --signal is #e8402a. Nothing else in a bay is red, so a coarse
        // test is the robust one — an exact match would be a bet on
        // antialiasing.
        let red = 0
        let first = -1
        let last = -1
        for (let y = b.y0; y < b.y1; y++) {
          const i = (y * width + b.x) * 4
          if (d[i] > 150 && d[i + 1] < 130 && d[i + 2] < 110) {
            red++
            if (first < 0) first = y
            last = y
          }
        }
        // `gap` is the unpainted run ABOVE the signal. A fill anchored to
        // the mark's top edge leaves none; one anchored to the bottom
        // leaves all of it there. That single number is the direction.
        return { red, gap: first < 0 ? -1 : first - b.y0, tail: last < 0 ? -1 : b.y1 - 1 - last }
      },
      await page.screenshot({ encoding: 'base64' }),
      box,
    )
  }

  const empty = await level('scheda')
  const bar = await page.evaluate(() => {
    const b = document.querySelector('.gen-sheet[data-win="scheda"] .gen-titlebar').getBoundingClientRect()
    const dock = document.querySelector('.gen-tile[data-win="scheda"]').getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, dock: dock.top }
  })
  const reach = bar.dock - bar.y
  await page.mouse.move(bar.x, bar.y)
  await page.mouse.down()
  const held = []
  for (const part of [0.3, 0.6]) {
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(bar.x, bar.y + (reach * part * i) / 10)
      await sleep(16)
    }
    await sleep(260)
    held.push({ part, ...(await level('scheda')) })
  }
  await page.mouse.up()
  await page.waitForFunction(
    () => document.querySelector('.gen-tile[data-win="scheda"]').dataset.filled === 'true',
    { timeout: 9000 },
  )
  await sleep(600)
  const full = await level('scheda')
  const gaugeFull = full.red

  console.log(`    bay empty                    ${empty.red} rows of signal`)
  for (const h of held)
    console.log(
      `    held ${(h.part * 100).toFixed(0)}% of the way down       ${h.red} rows, ${h.gap} blank above them`,
    )
  console.log(`    landed                       ${gaugeFull} rows, ${full.gap} blank above them`)

  if (empty.red !== 0)
    problems.push(
      `an empty bay is already showing ${empty.red} rows of signal — the mark reads as occupied when it is not`,
    )
  if (gaugeFull < 4)
    problems.push(`a bay holding a window shows only ${gaugeFull} rows of signal — the gauge never fills`)
  else {
    const [a, b] = held
    if (a.red <= 0 || a.red >= gaugeFull)
      problems.push(
        `held ${(a.part * 100).toFixed(0)}% down the bay read ${a.red} of ${gaugeFull} rows — the level is not ` +
          `following the pour, which is what a fill hung off the docked/undocked flip does: nothing until the landing`,
      )
    if (b.red <= a.red)
      problems.push(
        `pulling from ${(a.part * 100).toFixed(0)}% to ${(b.part * 100).toFixed(0)}% moved the level from ${a.red} ` +
          `to ${b.red} rows — the gauge does not deepen with the hand`,
      )
    // Two rows of slack, not zero: y0 is floored to a whole pixel and the
    // mark's own top row is antialiased, so a fill flush with the top
    // edge can still leave one row that fails a colour test.
    for (const h of held)
      if (h.gap > 2)
        problems.push(
          `held ${(h.part * 100).toFixed(0)}% down, the signal starts ${h.gap} rows below the mark's top edge — ` +
            `the fill is anchored to the bottom and rising to meet the sheet, which arrives from above`,
        )
  }
  await page.evaluate(() => document.querySelector('.gen-tile[data-win="scheda"]').click())
  await page.waitForFunction(
    () => document.querySelector('.gen-tile[data-win="scheda"]').dataset.filled === 'false',
    { timeout: 8000 },
  )

  console.log(
    `\nfour-windows: ${problems.length === 0 ? 'PASS — four independent windows on one desk' : 'FAIL'}`,
  )
  for (const p of problems) console.log(`  ${p}`)
  process.exit(problems.length === 0 ? 0 : 1)
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
