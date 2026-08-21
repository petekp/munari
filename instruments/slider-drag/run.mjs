// slider-drag gate — a drag under traveling glass, pressed with a real
// mouse. The slider scene magnifies its track with the fisheye law;
// hovering, the lens follows the cursor, and a held thumb takes the
// anchor — the lens rides the THUMB while trusted moves drive the value
// 1:1 (plus the grab's own offset, so a press never teleports the
// value). Two things to prove: the grab must land on the thumb's
// DISPLACED pixels (≈58px off flat at the trial's geometry — four thumb
// widths), and through the whole drag the lens's focus must sit on the
// thumb while the released value matches the flat prediction exactly.
// A vertex-shader warp fails the grab clause; a lens that stays where
// the cursor left it fails the focus-riding checks.
//
// Drives the real lab route (?scene=slider) through the scene's own
// __slider probe (devGlobals.ts): the probe computes expected points
// from the law and the live panel rect, this file supplies trusted
// presses, moves, and releases, and judges the value and the focus.
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
  const msg = `slider-drag gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : msg)
  process.exit(strict ? 1 : 0)
}

if (!chromePath) skip('no Chrome executable found (set CHROME_PATH)')

// Must match the scene's constants; the probe's own numbers come from the
// live law, these only aim the trials.
const TRACK_X0 = 30
const MS_PER_PX = 10
const THUMB_W = 14
const AMP = 2
// The lens sits 90px right of the thumb for the held trials: inside the
// 120px radius, so the thumb rides the compressed flank and displaces
// by ≈58px — the teeth.
const FOCUS_OFFSET = 90
// A released value may differ from the prediction by sub-pixel event
// rounding, never by a tick (50ms) — 4ms is generous for rounding and
// nothing else.
const VALUE_TOL = 4
// The lens's focus must sit ON the thumb while dragging; the two are
// written from the same handler, so anything past float noise is a
// second author moving the focus.
const FOCUS_TOL = 0.5

let browser
let server
const deadline = setTimeout(() => {
  console.error('slider-drag gate: hard 150s deadline hit')
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

  await page.goto(`http://localhost:${port}/?scene=slider&bare`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__slider?.ready === true, { timeout: 20_000 })
  await page.waitForFunction(
    () => window.__slider.state().presentedView === 'webgl',
    { timeout: 20_000 },
  )

  const probe = {
    lock: (focus, amp) => page.evaluate((f, a) => window.__slider.lock(f, a), focus, amp),
    unlock: () => page.evaluate(() => window.__slider.unlock()),
    state: () => page.evaluate(() => window.__slider.state()),
    thumbPoint: () => page.evaluate(() => window.__slider.thumbPoint()),
  }

  const failures = []
  const results = []
  const record = (label, expected, heard) => results.push({ label, expected, heard })

  // Content x of the current thumb, from the live value.
  const thumbContentX = async () => TRACK_X0 + (await probe.state()).value / MS_PER_PX

  // The focus-riding check: while (and after) a drag, the lens's center
  // is the thumb's own content position.
  const assertRiding = async (label) => {
    const s = await probe.state()
    const err = Math.abs(s.focus - (TRACK_X0 + s.value / MS_PER_PX))
    if (err > FOCUS_TOL) {
      failures.push(`${label}: the lens sits ${err.toFixed(1)}px off the thumb it should ride`)
    }
    return s
  }

  // One drag, from an already-pressed thumb at `from` to `to`. The first
  // move re-lands on the press point so the scene captures the grab
  // offset THERE — after that, released value = valueAtPress + Δpx·10ms
  // exactly, which is the prediction each trial asserts.
  const dragAndRelease = async (from, to, y) => {
    const before = (await probe.state()).value
    await page.mouse.move(from, y)
    await page.mouse.move(to, y, { steps: 8 })
    await sleep(150)
    const held = await probe.state()
    await page.mouse.up()
    await sleep(150)
    const expected = before + (to - from) * MS_PER_PX
    return { expected, held, state: await probe.state() }
  }

  // ── flat baseline: a grab and drag with the lens off ─────────────────
  {
    await probe.lock((await thumbContentX()) + FOCUS_OFFSET, 1)
    await sleep(250)
    const t = await probe.thumbPoint()
    await page.mouse.move(t.x, t.y, { steps: 4 })
    await page.mouse.down()
    await sleep(150)
    const grabbed = (await probe.state()).grabbed
    record('flat grab', true, grabbed)
    if (!grabbed) {
      console.error('\nAPPARATUS FAILURE: a flat-lens press on the thumb did not grab it.')
      process.exit(1)
    }
    const { expected, state } = await dragAndRelease(t.x, t.x + 80, t.y)
    record('flat drag +80px', Math.round(expected), Math.round(state.value))
    if (Math.abs(state.value - expected) > VALUE_TOL) {
      failures.push(
        `flat drag: released at ${state.value.toFixed(1)}ms, predicted ${expected.toFixed(1)}ms`,
      )
    }
    if (state.grabbed) failures.push('flat drag: still grabbed after a trusted pointerup')
    await assertRiding('flat drag')
    await probe.unlock()
  }

  // ── the grab clause: press the thumb's DISPLACED pixels ──────────────
  {
    await probe.lock((await thumbContentX()) + FOCUS_OFFSET, AMP)
    await sleep(250)
    const t = await probe.thumbPoint()
    const shift = Math.abs(t.x - t.flatX)
    if (shift <= THUMB_W) {
      failures.push(
        `thumb displaced only ${shift.toFixed(1)}px (≤ its own ${THUMB_W}px); the grab clause has no teeth`,
      )
    } else {
      await page.mouse.move(t.x, t.y, { steps: 4 })
      await page.mouse.down()
      await sleep(150)
      const grabbed = (await probe.state()).grabbed
      record(`warped grab (shift ${shift.toFixed(1)}px)`, true, grabbed)
      if (!grabbed) {
        failures.push('grab clause: the press at the displaced thumb did not grab')
        await page.mouse.up()
      } else {
        // ── the traveling glass: the anchor changes hands on grab ──────
        // The first move hands the focus from the gate's lock to the
        // thumb, the grab offset keeps the value continuous through the
        // handoff, and the held lens never collapses.
        const { expected, held, state } = await dragAndRelease(t.x, t.x + 120, t.y)
        record('warped drag +120px', Math.round(expected), Math.round(state.value))
        if (Math.abs(state.value - expected) > VALUE_TOL) {
          failures.push(
            `warped drag: released at ${state.value.toFixed(1)}ms, predicted ${expected.toFixed(1)}ms — the grab offset did not hold`,
          )
        }
        if (held.amp < 1.9) {
          failures.push(`warped drag: the held lens collapsed to amp ${held.amp.toFixed(2)}`)
        }
        const rode = await assertRiding('warped drag')
        record(
          'lens rides the thumb',
          'focus = thumb',
          `${(rode.focus - TRACK_X0).toFixed(1)}px vs value ${(rode.value / MS_PER_PX).toFixed(1)}px`,
        )
      }
      await probe.unlock()
    }
  }

  // ── the counter-clause: press where the FLAT map says the thumb is ───
  // Under the lens those pixels are rail, ≈58px short of the thumb.
  // Grabbing here is the flat-pose fault.
  {
    await probe.lock((await thumbContentX()) + FOCUS_OFFSET, AMP)
    await sleep(250)
    const t = await probe.thumbPoint()
    const before = (await probe.state()).value
    await page.mouse.move(t.flatX, t.flatY, { steps: 4 })
    await page.mouse.down()
    await sleep(150)
    const grabbed = (await probe.state()).grabbed
    await page.mouse.move(t.flatX + 40, t.flatY, { steps: 4 })
    await sleep(150)
    await page.mouse.up()
    await sleep(150)
    const after = (await probe.state()).value
    record('press at flat thumb x under warp', 'no grab', grabbed ? 'GRABBED' : 'no grab')
    if (grabbed) {
      failures.push('counter-clause: the thumb grabbed at its FLAT position under the warp')
    } else if (Math.abs(after - before) > 0.001) {
      failures.push(
        `counter-clause: no grab, yet the value moved ${before.toFixed(1)} → ${after.toFixed(1)}ms`,
      )
    }
    await probe.unlock()
  }

  // ── the real-user path: hover in, grab at the fixed point, scrub ─────
  // With the lens riding the cursor, the thumb under the cursor is at
  // the lens's own fixed point, so the hand finds it exactly where a
  // flat track keeps it — then the anchor changes hands and the glass
  // travels with the scrub.
  {
    const t = await probe.thumbPoint()
    await page.mouse.move(t.flatX, t.flatY, { steps: 32 })
    await sleep(400)
    const live = await probe.state()
    if (live.amp < 1.9) {
      failures.push(`live lens never engaged: amp ${live.amp.toFixed(2)} after 400ms on the track`)
    }
    await page.mouse.down()
    await sleep(150)
    const grabbed = (await probe.state()).grabbed
    record('live grab at the fixed point', true, grabbed)
    if (!grabbed) {
      failures.push('live grab: the press under the cursor-riding lens did not take the thumb')
      await page.mouse.up()
    } else {
      const { expected, held, state } = await dragAndRelease(t.flatX, t.flatX - 64, t.flatY)
      record('live drag −64px', Math.round(expected), Math.round(state.value))
      if (Math.abs(state.value - expected) > VALUE_TOL) {
        failures.push(
          `live drag: released at ${state.value.toFixed(1)}ms, predicted ${expected.toFixed(1)}ms`,
        )
      }
      if (held.amp < 1.9) {
        failures.push(`live drag: the glass collapsed to amp ${held.amp.toFixed(2)} mid-scrub`)
      }
      await assertRiding('live drag')
    }
  }

  // ── report ────────────────────────────────────────────────────────────
  console.log('\nslider-drag gate — what each trial heard:')
  for (const r of results) {
    console.log(`  ${r.label.padEnd(38)} expected ${r.expected} → heard ${r.heard}`)
  }

  if (pageProblems.length) {
    console.error('\npage errors during the run:')
    for (const p of pageProblems) console.error(`  ${p}`)
    process.exit(1)
  }
  if (failures.length) {
    console.error('\nslider-drag gate FAILED:')
    for (const f of failures) console.error(`  ${f}`)
    process.exit(1)
  }
  console.log('\nslider-drag gate PASSED')
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
