// film-window — do decoded video frames actually reach the flying sheet?
//
// Every other window on this desk is markup, and markup is what the
// capture was always going to catch: drawElementImage replays paint
// records, and markup IS paint records. A video frame is not. Frames
// never enter the display list at all — they are handed to the
// compositor on their own layer and composited after paint — so a
// window of video is the one case where the texture could plausibly
// come back holding a poster, a first frame, or the frame that happened
// to be on screen when the flight began, and still look like a video to
// anyone glancing at the desk.
//
// This is the same shape of failure live-content.mjs exists for, one
// layer further down. There the risk was a transform animation that
// moves in the DOM and repaints nothing. Here the paint counter can be
// advancing perfectly — the sheet redrawing sixty times a second — and
// every one of those redraws can be replaying the same stale frame.
// A paint count cannot tell the difference. Pixels can.
//
//   1. THE FRAME ADVANCES IN THE TEXTURE. Hold the drain open with a
//      hand so the warp stops moving, then difference the WebGL canvas
//      against itself across ~0.7s. With the geometry frozen, anything
//      that changes inside the sheet's own outline is the decoder's
//      doing. A frozen frame reads as zero.
//
//      That last sentence is also the mask. This leg used to find the
//      sheet by COLOUR: the clip was a sky, the desk is warm all the way
//      through — bench, window stock, ink — and `blue > red` was an
//      exact mask for the one cool thing on the page. It worked, and it
//      was measuring the wrong property. When the clip stopped being a
//      sky (it is studio footage now, warm as the desk it flies over)
//      the mask found nothing and the leg reported that the sheet had
//      never reached the frame. What it actually needs is the pixels the
//      DECODER owns, and with the geometry standing still those are
//      exactly the pixels that moved — so movement is the mask. That
//      costs the leg nothing, because a stale texture moves no pixels
//      and fails on the COUNT rather than on the mean, and it buys
//      independence from the footage, the palette, and from where the
//      warp happened to put the sheet.
//
//   2. THE TWO COPIES SHOW THE SAME INSTANT. The window exists twice
//      in flight, and each <video> is a separate decoder with its own
//      idea of where it is in the clip. A fresh mount starts at zero,
//      so the airborne copy would cut the film back to the top in the
//      one frame the swap most needs to be invisible. Both copies seek
//      to `now mod duration`, which is the same trick the shapes use
//      with a negative animation-delay; this measures that they land
//      on it.
//
// Neither leg is visible in a screenshot: a still of a stale frame is a
// perfectly good still of a film.
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

// How far one pixel must travel across 0.7s to count as having moved at
// all. Screenshot-to-screenshot noise on a static page is 0 or 1 luma;
// this sits clear of that without asking the picture to change much,
// because the leg is a floor on how MANY pixels moved, not on how far.
const MOVED_LUMA = 6
// And how many of them there must be. A stale texture is not "a small
// number" of moved pixels — it is none, exactly — so this is pitched to
// separate a working build from noise rather than to grade the footage.
// A working build reads ~42,500 (measured 2026-08-09, viewport 1100x800,
// dSF 1), in a bounding box 434px wide filled 29% — a funnel-shaped
// region, which is what the sheet is. This floor is an eighth of that:
// far enough below to survive the sheet landing somewhere slightly
// different, far enough above zero to mean something.
const MOVED_MIN = 5000
// Both copies derive their phase from the same clock, so any real
// disagreement is a mount-time bug and not drift. One frame of the clip
// (1/25s — the clip is 25fps, the source's true cadence) is the honest
// ceiling: below that the two decoders cannot be showing different
// pictures. Measured at 0.001-0.002s once both seeks wait for
// HAVE_FUTURE_DATA — and at 0.069s before that, which is where this
// number came from: seeking on loadedmetadata charges each copy its own
// fetch latency, and the airborne copy's is warm while the page copy's
// is cold. 0.069s is nearly two frames, which is a tick you can see at
// the swap.
const PHASE_S = 1 / 25

let server, browser
const deadline = setTimeout(() => {
  console.error('film-window: hard 150s deadline hit')
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
      // Headless has no user gesture to offer, and the clip is muted.
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
      document.querySelector('.gen-sheet[data-win="triangolo"] .gen-film') &&
      document.fonts.status === 'loaded',
    { timeout: 15_000 },
  )
  // Wait for the decoder, not for a duration: a probe that starts before
  // the first frame exists measures the placeholder and calls it frozen.
  await page.waitForFunction(
    () => {
      const v = document.querySelector('.gen-sheet[data-win="triangolo"] .gen-film')
      return v && v.readyState >= 2 && v.currentTime > 0
    },
    { timeout: 15_000 },
  )
  await sleep(600)

  // ── hold the drain open ───────────────────────────────────────────────
  //
  // A hand owns t while the pointer is down, so the funnel can simply be
  // parked half-drained. This is what makes leg 1 a clean read: with the
  // geometry standing still, the only thing left that can move a pixel
  // inside the sheet is the content on it.
  const bar = await page.evaluate(() => {
    const b = document
      .querySelector('.gen-sheet[data-win="triangolo"] .gen-titlebar')
      .getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
  })
  await page.mouse.move(bar.x + 90, bar.y)
  await page.mouse.down()
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(bar.x + 90, bar.y + i * 7)
    await sleep(16)
  }
  await sleep(450) // let the drive settle so the warp is genuinely still

  // Now stop everything else on the desk that moves. Movement is the
  // mask, and the desk is not otherwise still: the shapes in the other
  // windows are CSS animations running on their own clock, and the
  // field carries a blinking caret. Measured before this was added, they
  // put the mask's bounding box at 748px wide — more than twice the
  // window it was supposed to be measuring — and that is not merely
  // untidy. A leg whose count includes pixels the DECODER does not own
  // is a leg that passes while the texture is frozen, which is the exact
  // failure it exists to catch.
  //
  // Freezing them is safe and narrow: the warp is already held by the
  // hand, a video is not a CSS animation, and the sheet in the air is
  // the film window, which has no shapes on it. So this stops the
  // confounds and nothing the leg is looking at.
  await page.addStyleTag({
    content:
      '*, *::before, *::after { animation-play-state: paused !important; }\n' +
      '* { caret-color: transparent !important; }',
  })
  await sleep(150)

  // The sheet is found by MOVEMENT. The drain is held, so the warp is
  // standing still and the desk behind it is markup that is not
  // animating; the page copy of this window is hidden. Every other pixel
  // on screen is therefore the same in both grabs, and a pixel that is
  // not the same in both grabs is a pixel the decoder repainted. That is
  // the whole mask — no hue, no geometry, no knowledge of the clip.
  const grab = async () => {
    const b64 = await page.screenshot({ encoding: 'base64' })
    return page.evaluate(async (s) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + s
      await img.decode()
      const c = new OffscreenCanvas(img.width, img.height)
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height)
      return { data: [...data], width, height }
    }, b64)
  }

  const A = await grab()
  await sleep(700)
  const B = await grab()

  let moved = 0
  let sum = 0
  let peak = 0
  const box = [1e9, 1e9, -1, -1]
  for (let i = 0; i < A.data.length; i += 4) {
    const la = 0.299 * A.data[i] + 0.587 * A.data[i + 1] + 0.114 * A.data[i + 2]
    const lb = 0.299 * B.data[i] + 0.587 * B.data[i + 1] + 0.114 * B.data[i + 2]
    const d = Math.abs(la - lb)
    if (d <= MOVED_LUMA) continue
    moved++
    sum += d
    if (d > peak) peak = d
    const p = (i / 4) | 0
    const x = p % A.width
    const y = (p / A.width) | 0
    if (x < box[0]) box[0] = x
    if (y < box[1]) box[1] = y
    if (x > box[2]) box[2] = x
    if (y > box[3]) box[3] = y
  }
  const mean = moved ? sum / moved : 0
  // Density is the evidence that the moved pixels are a SHEET and not a
  // scatter: film repaints in a solid region, so a healthy read fills a
  // good fraction of its own bounding box. A handful of stray pixels
  // spread across the desk would clear MOVED_MIN while filling almost
  // none of it, and that is worth seeing in the output even though
  // nothing asserts on it — the count is the contract, this is the
  // sanity check a human reads.
  const area = moved ? (box[2] - box[0] + 1) * (box[3] - box[1] + 1) : 0
  const density = area ? moved / area : 0

  const copies = await page.evaluate(() =>
    [...document.querySelectorAll('.gen-sheet[data-win="triangolo"] .gen-film')].map((v) => ({
      t: v.currentTime,
      paused: v.paused,
      ready: v.readyState,
    })),
  )

  console.log('\n  the drain held open, the warp standing still')
  console.log(`    pixels that moved in 0.7s   ${moved}`)
  if (moved) {
    console.log(`    found within                x ${box[0]}..${box[2]}, y ${box[1]}..${box[3]}`)
    console.log(`    filling that box            ${(density * 100).toFixed(0)}%`)
  }
  console.log(`    mean move, of those         ${mean.toFixed(2)} luma`)
  console.log(`    largest single pixel        ${peak.toFixed(0)} luma`)
  console.log('\n  the two decoders')
  copies.forEach((c, i) =>
    console.log(
      `    ${(i === 0 ? 'page copy' : 'airborne copy').padEnd(26)} t=${c.t.toFixed(3)}s  ${c.paused ? 'PAUSED' : 'playing'}  readyState ${c.ready}`,
    ),
  )

  // The two ways this leg can read zero are a stale texture and a sheet
  // that never took off, and they are not the same bug. The copy count
  // separates them: two copies of the window means the capture root
  // mounted and the flight is real, so nothing moving is the decoder's
  // fault and not the drive's.
  if (moved < MOVED_MIN)
    problems.push(
      copies.length < 2
        ? `only ${moved} pixels moved over 0.7s of held flight, and only ${copies.length} copy of the film ` +
          `window existed — the sheet never took off, so this leg measured the desk`
        : `only ${moved} pixels moved over 0.7s of held flight — the texture is replaying a stale frame, ` +
          `so the window is a photograph of a video`,
    )
  if (copies.length < 2)
    problems.push(`only ${copies.length} copy of the film window existed mid-flight — nothing to compare`)
  else {
    const drift = Math.abs(copies[0].t - copies[1].t)
    console.log(`    disagreement                ${drift.toFixed(3)}s`)
    if (drift > PHASE_S)
      problems.push(
        `the copies are ${drift.toFixed(2)}s apart in the clip — the swap frame will cut the film`,
      )
    if (copies.some((c) => c.paused))
      problems.push('a copy of the film was paused in flight — one of the two decoders is not running')
  }

  await page.mouse.up()

  console.log(
    `\nfilm-window: ${problems.length === 0 ? 'PASS — the sheet carries live decode, and both decoders are on the same frame' : 'FAIL'}`,
  )
  for (const p of problems) console.log(`  ${p}`)
  process.exit(problems.length === 0 ? 0 : 1)
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
