// fisheye-pointer gate — deformed-pose hit testing, pressed with a real
// mouse on BOTH axes. The fisheye scene warps its queue mesh on the CPU
// (fisheyeLaw): y rows displace by up to 60px — nearly three 22px rows —
// and off-center x targets displace by 100px and more, so the warped
// prediction and the flat prediction name different targets and a click
// can only satisfy one of them. A vertex-shader warp (geometry flat,
// pixels bent) fails every warped clause here and passes the
// counter-clauses.
//
// Beyond routing, two liveness clauses: the done button (an off-center
// child control) must fire through the bulge without triggering its row,
// and the filter input must take focus through a warped click and then
// real keystrokes — the relay forwards no keys; focus is the whole test.
//
// Drives the real lab route (?scene=fisheye) through the scene's own
// __fisheye probe (devGlobals.ts): the probe computes expected screen
// points from the law and the live panel rect, this file supplies
// trusted clicks and judges which handler ran.
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
  const msg = `fisheye-pointer gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : msg)
  process.exit(strict ? 1 : 0)
}

if (!chromePath) skip('no Chrome executable found (set CHROME_PATH)')

// Must match the scene's constants; the probe's own numbers come from the
// live law, these only aim the trials.
const ROW_H = 22
const HEADER_H = 36
const ROWS = 28
const AMP = 2
// Lens held at row 14's center: rows 9 and 19 sit beyond the 120px rim
// and carry the full 60px shift.
const FOCUS = HEADER_H + 14.5 * ROW_H

let browser
let server
const deadline = setTimeout(() => {
  console.error('fisheye-pointer gate: hard 150s deadline hit')
  process.exit(1)
}, 150_000)

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
  await page.setViewport({ width: 1200, height: 860, deviceScaleFactor: 1 })
  const pageProblems = []
  page.on('pageerror', (err) => pageProblems.push(String(err)))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
      pageProblems.push(m.text())
  })

  await page.goto(`http://localhost:${port}/?scene=fisheye&bare`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__fisheye?.ready === true, { timeout: 20_000 })
  await page.waitForFunction(
    () => window.__fisheye.state().presented === 'canvas',
    { timeout: 20_000 },
  )

  const probe = {
    lock: (focus, amp) => page.evaluate((f, a) => window.__fisheye.lock(f, a), focus, amp),
    unlock: () => page.evaluate(() => window.__fisheye.unlock()),
    state: () => page.evaluate(() => window.__fisheye.state()),
    rowScreenCenter: (i) => page.evaluate((row) => window.__fisheye.rowScreenCenter(row), i),
    actPoint: (i) => page.evaluate((row) => window.__fisheye.actPoint(row), i),
    filterPoint: () => page.evaluate(() => window.__fisheye.filterPoint()),
    filter: () => page.evaluate(() => window.__fisheye.filter()),
    sourceRowAtScreenY: (y) =>
      page.evaluate((sy) => window.__fisheye.sourceRowAtScreenY(sy), y),
    hoverRow: () => page.evaluate(() => window.__fisheye.hoverRow()),
    clickCount: () => page.evaluate(() => window.__fisheye.clicks.length),
    lastClick: () =>
      page.evaluate(
        () => window.__fisheye.clicks[window.__fisheye.clicks.length - 1] ?? null,
      ),
    actCount: () => page.evaluate(() => window.__fisheye.acts.length),
    lastAct: () =>
      page.evaluate(() => window.__fisheye.acts[window.__fisheye.acts.length - 1] ?? null),
  }

  // A press can land in either ledger; report both so a clause can insist
  // on the button AND on the row staying quiet.
  const pressAndHear = async (x, y) => {
    const beforeClicks = await probe.clickCount()
    const beforeActs = await probe.actCount()
    await page.mouse.click(x, y)
    await sleep(150)
    const click = (await probe.clickCount()) > beforeClicks ? await probe.lastClick() : null
    const act = (await probe.actCount()) > beforeActs ? await probe.lastAct() : null
    return { click, act }
  }

  const failures = []
  const results = []

  // ── flat baseline: amp 1, a relayed click reaches its own row ─────────
  await probe.lock(FOCUS, 1)
  await sleep(250)
  const flat10 = await probe.rowScreenCenter(10)
  if (!flat10) throw new Error('probe returned no row center')
  const restHeard = await pressAndHear(flat10.x, flat10.y)
  results.push({ label: 'flat row 10', expected: 10, heard: restHeard.click?.row ?? 'nobody' })
  if (restHeard.click?.row !== 10) {
    console.error('\nAPPARATUS FAILURE: a flat-lens click did not reach its own row.')
    console.error(`  heard: ${JSON.stringify(restHeard)}`)
    process.exit(1)
  }
  if (restHeard.click.instance !== 'source') {
    console.error(
      `\nAPPARATUS FAILURE: the flat click reached instance '${restHeard.click.instance}', not the relayed source copy.`,
    )
    process.exit(1)
  }

  // ── the lens, held still: clicks at DISPLACED row centers ────────────
  await probe.lock(FOCUS, AMP)
  await sleep(250)

  for (const row of [9, 12, 19]) {
    const c = await probe.rowScreenCenter(row)
    if (!c) throw new Error(`no center for row ${row}`)
    // Teeth: the rim rows must be displaced by more than one row height,
    // or a flat-pose raycast would pass this trial by luck.
    const shift = Math.abs(c.y - c.flatY)
    if (row !== 12 && shift <= ROW_H) {
      failures.push(
        `row ${row} displaced only ${shift.toFixed(1)}px (≤ ${ROW_H}); the trial has no teeth`,
      )
      continue
    }
    const heard = await pressAndHear(c.x, c.y)
    results.push({
      label: `warped row ${row} (shift ${shift.toFixed(1)}px)`,
      expected: row,
      heard: heard.click?.row ?? 'nobody',
    })
    if (heard.click?.row !== row) {
      failures.push(
        `warped row ${row}: clicked its displaced center, heard ${heard.click?.row ?? 'nobody'}`,
      )
    }
  }

  // ── the y counter-clause: a click where the FLAT map says row 12 is ──
  // Under the lens those pixels belong to another row; hearing row 12
  // here is exactly the flat-pose fault this scene exists to press on.
  const c12 = await probe.rowScreenCenter(12)
  const lawRow = await probe.sourceRowAtScreenY(c12.flatY)
  if (lawRow === 12 || lawRow === null) {
    failures.push(`y counter-clause is vacuous: the law puts row ${lawRow} at row 12's flat center`)
  } else {
    const heard = await pressAndHear(c12.flatX, c12.flatY)
    results.push({
      label: 'flat center of row 12 under warp',
      expected: lawRow,
      heard: heard.click?.row ?? 'nobody',
    })
    if (heard.click?.row === 12) {
      failures.push('y counter-clause: the click routed by the FLAT pose, not the presented one')
    } else if (heard.click?.row !== lawRow) {
      failures.push(
        `y counter-clause: heard ${heard.click?.row ?? 'nobody'}, the law says row ${lawRow} is presented there`,
      )
    }
  }

  // ── the x clause: the done button through the bulge ──────────────────
  // The button sits far off the centerline, so the uniform lens moves it
  // sideways by (scale−1)·offset — around 100px at row 12. The press must
  // fire the button's own ledger and leave the row's silent
  // (stopPropagation in the scene): hitting the row instead means x was
  // routed flat while y was routed warped.
  const a12 = await probe.actPoint(12)
  if (!a12) throw new Error('probe returned no act point')
  const xShift = Math.abs(a12.x - a12.flatX)
  if (xShift <= 24) {
    failures.push(`act button shifted only ${xShift.toFixed(1)}px in x; the x clause has no teeth`)
  } else {
    const heard = await pressAndHear(a12.x, a12.y)
    results.push({
      label: `warped act 12 (x shift ${xShift.toFixed(1)}px)`,
      expected: 'act 12',
      heard: heard.act ? `act ${heard.act.row}` : heard.click ? `row ${heard.click.row}` : 'nobody',
    })
    if (heard.act?.row !== 12) {
      failures.push(
        `x clause: pressed the displaced done button of row 12, heard ${
          heard.act ? `act ${heard.act.row}` : heard.click ? `row click ${heard.click.row}` : 'nobody'
        }`,
      )
    } else if (heard.click) {
      failures.push('x clause: the done press also fired its row — stopPropagation lost in relay')
    }

    // The x counter-clause: the button's FLAT x at the warped y is deep
    // inside the row's title now; firing the button there is the flat-x
    // fault.
    const counter = await pressAndHear(a12.flatX, a12.y)
    results.push({
      label: 'flat x of act 12 under warp',
      expected: 'row 12 (not the act)',
      heard: counter.act ? `act ${counter.act.row}` : counter.click ? `row ${counter.click.row}` : 'nobody',
    })
    if (counter.act) {
      failures.push('x counter-clause: the done button fired at its FLAT x under the warp')
    } else if (counter.click?.row !== 12) {
      failures.push(
        `x counter-clause: expected the row itself, heard ${counter.click?.row ?? 'nobody'}`,
      )
    }
  }

  // ── hover at a displaced center wears the twin on the right row ──────
  const c9 = await probe.rowScreenCenter(9)
  await page.mouse.move(c9.x, c9.y, { steps: 3 })
  await sleep(200)
  const hoverWarped = await probe.hoverRow()
  results.push({ label: 'warped hover row 9', expected: 9, heard: hoverWarped ?? 'nobody' })
  if (hoverWarped !== 9) {
    failures.push(`warped hover: data-hover on row ${hoverWarped}, expected 9`)
  }

  // ── typing through the lens: focus lands via a warped click ──────────
  // Lock the lens on the header so the input is magnified and displaced,
  // click it THERE, then type. No key is ever forwarded — if the warped
  // click failed to focus the parked input, nothing types and the filter
  // count never moves.
  await probe.lock(HEADER_H / 2, AMP)
  await sleep(250)
  const fp = await probe.filterPoint()
  if (!fp) throw new Error('probe returned no filter point')
  const fShift = Math.abs(fp.x - fp.flatX)
  if (fShift <= 24) {
    failures.push(`filter input shifted only ${fShift.toFixed(1)}px in x; the typing clause has no teeth`)
  } else {
    await page.mouse.click(fp.x, fp.y)
    await sleep(200)
    await page.keyboard.type('relay', { delay: 40 })
    await sleep(300)
    const filtered = await probe.filter()
    results.push({
      label: `typed into warped input (x shift ${fShift.toFixed(1)}px)`,
      expected: "'relay'",
      heard: `'${filtered.value}' (${filtered.matches}/${ROWS})`,
    })
    if (filtered.value !== 'relay') {
      failures.push(
        `typing clause: filter holds '${filtered.value}' after typing 'relay' into the warped input`,
      )
    } else if (filtered.matches <= 0 || filtered.matches >= ROWS) {
      failures.push(`typing clause: 'relay' matched ${filtered.matches} rows; the filter did not narrow`)
    }
  }

  // ── live follow: unlocked, the focus rides the cursor ────────────────
  // The lens is anchored at its focus, so the row under the cursor is the
  // flat row — the fixed point — even while the amplitude animates.
  await probe.unlock()
  const c20 = await probe.rowScreenCenter(20)
  // COARSE steps on purpose — this is the re-route trial. Each event
  // raycasts the pose of the frame it arrived in, so a stream jumping
  // ~50px per event ends with its last routing more than a row stale at
  // 22px rows (measured 2026-08-20, before the presenter re-route: this
  // stream heard row 18). The presenter now replays the pointer's last
  // position whenever the geometry's position attribute bumps, so once the
  // hand stops and the lens settles, the hover must have caught up to the
  // fixed-point row — no dense hand-like stream to hide behind.
  await page.mouse.move(c20.flatX, c20.flatY, { steps: 5 })
  await sleep(400)
  const live = await probe.state()
  if (live.amp < 1.9) {
    failures.push(`live lens never engaged: amp ${live.amp.toFixed(2)} after 400ms inside`)
  }
  const hoverLive = await probe.hoverRow()
  results.push({ label: 'live hover row 20', expected: 20, heard: hoverLive ?? 'nobody' })
  if (hoverLive !== 20) {
    failures.push(`live hover: data-hover on row ${hoverLive}, expected the fixed-point row 20`)
  }
  const liveHeard = await pressAndHear(c20.flatX, c20.flatY)
  results.push({ label: 'live click row 20', expected: 20, heard: liveHeard.click?.row ?? 'nobody' })
  if (liveHeard.click?.row !== 20) {
    failures.push(`live click: heard ${liveHeard.click?.row ?? 'nobody'}, expected row 20`)
  }

  // ── report ────────────────────────────────────────────────────────────
  console.log('\nfisheye-pointer gate — what heard each press:')
  for (const r of results) {
    console.log(`  ${r.label.padEnd(42)} expected ${r.expected} → heard ${r.heard}`)
  }

  if (pageProblems.length) {
    console.error('\npage errors during the run:')
    for (const p of pageProblems) console.error(`  ${p}`)
    process.exit(1)
  }
  if (failures.length) {
    console.error('\nfisheye-pointer gate FAILED:')
    for (const f of failures) console.error(`  ${f}`)
    process.exit(1)
  }
  console.log('\nfisheye-pointer gate PASSED')
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
