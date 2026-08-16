// crossing-flash — is the wordmark on screen in EVERY composited frame
// while the word crosses between the page and the canvas?
//
// The library now guarantees this in law (packages/core crossing: at
// every phase, someone presents) and in React (useLift publishes both
// handoffs as single commits). But the law is a reducer and
// the binding is two reconcilers — React DOM hiding the page letters,
// react-three-fiber drawing their twins — and two commits that agree in
// state can still land in different browser frames. So this instrument
// does not read state at all. It reads the composited output through
// the DevTools screencast, frame by frame, and asks four questions of
// the word's rectangle:
//
//   is the ink still there?
//   did the ink stand still while the pixels changed hands?
//   did only ONE copy of the word show at a time?
//   did a carried motion cross without leaving its path?
//
// The run is two phases of the same cast. First, with the carried float
// eased flat, ROUNDS static round trips: registration compares the
// swap-eve screen against the first canvas frames, because a twin
// standing a pixel up-and-right of its letter reads as a step even when
// no frame ever drops the word — the eye caught it before any
// instrument did (2026-08-13). Then, with the float at its ceiling, carry rounds
// and both mid-air reversals: the word crosses WHILE MOVING
// (useCarriedMotion, decisions.md #30), and the fourth question fits
// the ink centroid's path before each swap and requires the frames
// just after to continue it — a parked or desynced motion leaves the
// path by several px; an honest carry leaves it by codec noise.
//
// The third question is the presentation law (crossingPresentation).
// While lifting, the canvas draws warm but must not be composited:
// shown early with its motion broken, its twins stand offset under the
// breathing page and the pair reads as a ghost around every letter
// (2026-08-14). A canvas whose twins track the page perfectly is below
// this clause's noise floor — and below the eye's, which is the
// criterion the budget encodes.
//
// The logo page is the measuring rig the protocol earned: six candy
// letters (luma ≥ ~144) on a litho-ink plate (luma ≈ 22), so "the word
// is present" is countable — pixels above an ink threshold. The two
// faults are the two tails of one number. Letters in NOBODY's hands
// (the flicker this protocol exists to prevent) collapse the count
// toward zero. Letters arriving as opaque white cards (a capture that
// lost its alpha) multiply it. Every frame of every crossing — forward,
// back, and reversed mid-air — must hold between those tails.
//
// The reading is two channels wide. The passive screencast catches the
// one-frame faults — a screenshot loop at ~15/s cannot, so the cast
// carries every clause it can. But the cast has a blind spot the
// platform imposes: for ~250ms after a return handoff it emits nothing
// while the screen runs on (platform.md item 13). The frames that
// judge a backward carry are therefore TAKEN, not awaited — bursts of
// forced composites, each the compositor's own render of the committed
// state, clocked by this instrument instead of by damage. Headed runs
// skew the cast's timestamps through the same window; the gate's
// contract is the headless run.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const ROOT = '/Users/petepetrash/Code/munari'
const labRoot = path.join(ROOT, 'apps', 'lab')
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
]
  .filter(Boolean)
  .find((p) => existsSync(p))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// drawElementImage is an origin-trial API. Where the environment cannot
// supply it the gate warns and exits 0 — a loud annotation, not a red
// build, for an environmental gap (idle-zero's convention);
// STRICT_CAPABILITY=1 turns the gap into a failure.
function skip(reason) {
  const msg = `crossing-flash gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : msg)
  if (process.env.STRICT_CAPABILITY === '1') {
    console.error('STRICT_CAPABILITY=1 — treating the gap as a failure.')
    process.exit(1)
  }
  process.exit(0)
}
if (!CHROME) skip('no Chrome executable found (set CHROME_PATH)')

const ROUNDS = Number(process.env.ROUNDS || 4)
// Half scale — a vanished word survives any reasonable downsampling.
const CAP = { maxWidth: 640, maxHeight: 400, quality: 70 }
// Luma above which a pixel is letter ink rather than plate. The plate
// is #17170f (≈22); the dimmest palette entry, coral, cores at ≈144.
// 90 sits in the empty middle with codec blur on either side.
const INK = 90
// The tails. Depth bob and wobble swell the letters' footprint by tens
// of percent at full progress; a flash removes ALL of it and a white
// card multiplies it several-fold. Halving and 2.5x are far outside
// honest variation and far inside either fault.
const VANISH = 0.5
const BLOOM = 2.5
const HEADED = process.env.HEADED === '1'
// Squeeze the main thread, BY DEFAULT. The forward swap is two
// reconcilers agreeing; on an idle machine they land together every
// time and the gate proves nothing. A contract that only fails when an
// env var is set is a contract nobody runs (rest-blink, 2026-08-09).
const SLOWCPU = Number(process.env.SLOWCPU ?? 6)

let server, browser
const deadline = setTimeout(() => {
  console.error('crossing-flash: hard 240s deadline hit')
  process.exit(1)
}, 240_000)

const problems = []

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    // Headed is a different renderer, not the same one with a window
    // attached (rest-blink). A seam between two GPU layers is invisible
    // to headless; the default stays headless so the gate can run
    // anywhere, and HEADED=1 is the honest local run.
    headless: !HEADED,
    args: [
      '--enable-features=CanvasDrawElement',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })
  {
    const probe = await browser.newPage()
    const capable = await probe.evaluate(() => {
      const ctx = document.createElement('canvas').getContext('2d')
      return ctx !== null && 'drawElementImage' in ctx
    })
    await probe.close()
    if (!capable) {
      await browser.close()
      skip(`Chrome at ${CHROME} has no drawElementImage even with the feature flag`)
    }
  }
  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })
  // probe=still boots with the conductor paused: this instrument
  // measures the crossing, and a beat mid-capture would fold the
  // choreography's own coverage changes into the verdict.
  await page.goto(`http://localhost:${port}/?scene=logo&probe=still`, { waitUntil: 'load' })
  await page.waitForFunction(
    () => document.querySelector('.logo-word') && document.fonts.status === 'loaded',
    { timeout: 15_000 },
  )
  // The six guest faces arrive via a stylesheet injected on mount;
  // fonts.status can read 'loaded' before they are requested. A late
  // swap only changes which glyphs carry the ink, but let it pass.
  await sleep(900)

  // The float knob, driven through the panel's own slider — the same
  // input a hand would use, so the carrier's amplitude eases exactly as
  // it does for a person.
  const setFloat = (v) =>
    page.evaluate((v_) => {
      const label = [...document.querySelectorAll('.logo-panel-slider')].find((l) =>
        l.textContent.includes('float'),
      )
      const input = label.querySelector('input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
        input,
        String(v_),
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, v)

  // Open at the float's ceiling. The carried word must MOVE for the
  // cast to see anything at all — the screencast emits a frame only
  // when the composite changes, and a carried float at zero is a page
  // that never changes. The ceiling also makes the ghost fringe and the
  // carry deviation percentage-points instead of codec noise. The
  // registration rounds ease it flat below; nothing about the crossing
  // gets easier either way — the dwell absorbs the same eases.
  await setFloat(0.15)
  await sleep(500)

  // The word's rectangle, inflated for overflow: swashes, tilt, the
  // idle float, and the depth bob's perspective swell all draw outside
  // the layout box. The plate is dark well beyond this margin.
  const rect = await page.evaluate(() => {
    const r = document.querySelector('.logo-word').getBoundingClientRect()
    const em = parseFloat(getComputedStyle(document.querySelector('.logo-word')).fontSize)
    const mx = Math.round(em * 0.5)
    const my = Math.round(em * 0.8)
    return {
      x: Math.round(r.left) - mx,
      y: Math.round(r.top) - my,
      w: Math.round(r.width) + mx * 2,
      h: Math.round(r.height) + my * 2,
    }
  })

  // The decoder lives in the page — a canvas is the only JPEG reader
  // available here (rest-blink's pattern). It returns the fraction of
  // the rectangle that is letter ink, and where that ink's centroid
  // sits in CSS px — averaging thousands of pixels recovers sub-pixel
  // registration even from a half-scale JPEG.
  await page.evaluate((INK_) => {
    window.__cover = async (b64, rect) => {
      const img = new Image()
      img.src = `data:image/jpeg;base64,${b64}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)
      // Scale derived from the frame that arrived, not assumed from the
      // cap — the encoder rounds.
      const s = img.width / window.innerWidth
      const x = Math.round(rect.x * s)
      const y = Math.round(rect.y * s)
      const w = Math.round(rect.w * s)
      const h = Math.round(rect.h * s)
      const d = ctx.getImageData(x, y, w, h).data
      let ink = 0
      let sx = 0
      let sy = 0
      for (let i = 0, px = 0; i < d.length; i += 4, px++) {
        if (((d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8) > INK_) {
          ink++
          sx += px % w
          sy += (px / w) | 0
        }
      }
      return {
        cover: ink / (w * h),
        cx: ink ? (x + sx / ink + 0.5) / s : null,
        cy: ink ? (y + sy / ink + 0.5) / s : null,
      }
    }
  }, INK)

  // The flip recorder: phase changes stamped from inside the page with
  // Date.now() — the same clock family as the screencast's frame
  // timestamps — so frames can be split into "before the swap" and
  // "after the swap" without polling from outside.
  await page.evaluate(() => {
    const word = document.querySelector('.logo-word')
    let prev = word.dataset.phase
    window.__flips = []
    new MutationObserver(() => {
      const next = word.dataset.phase
      if (next !== prev) window.__flips.push({ from: prev, to: next, t: Date.now() })
      prev = next
    }).observe(word, { attributes: true, attributeFilter: ['data-phase'] })
  })

  const client = await page.createCDPSession()
  if (SLOWCPU > 1) await client.send('Emulation.setCPUThrottlingRate', { rate: SLOWCPU })
  let frames = []
  client.on('Page.screencastFrame', async (f) => {
    frames.push({ data: f.data, t: f.metadata.timestamp })
    try {
      await client.send('Page.screencastFrameAck', { sessionId: f.sessionId })
    } catch {
      /* the cast was stopped between the frame and its ack */
    }
  })

  const phase = () => page.evaluate(() => document.querySelector('.logo-word').dataset.phase)
  const waitPhase = (p) =>
    page.waitForFunction(
      (want) => document.querySelector('.logo-word').dataset.phase === want,
      { timeout: 12_000 },
      p,
    )
  const toggle = () => page.click('.logo-panel-matter input')

  // The return window's own channel. After a return handoff the
  // screencast goes dark for ~250ms while the screen runs on
  // (platform.md item 13), so the frames that judge a backward carry
  // cannot be awaited — they are taken: eight forced composites, each
  // timestamped at the midpoint of its round trip, ~40ms apart. Each
  // shot is the compositor's render of the committed state at the
  // moment of the call, which is exactly the question — where the ink
  // stands on the frames the page has just taken back.
  const shots = []
  const burst = async (where) => {
    for (let k = 0; k < 8; k++) {
      const a = Date.now()
      const { data } = await client.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 70,
      })
      shots.push({ t: (a + Date.now()) / 2, where, data })
    }
  }

  // One cast for the whole run — stopping and restarting per round
  // costs most of the frames (rest-blink measured 13/s on restart).
  // The baseline is the cast's opening second, and it is a MOVING
  // baseline: the word breathing at the float's ceiling under the same
  // codec, scale, and throttle as every frame it is compared against.
  // The ink count barely varies with the breath — letters carry their
  // ink with them — so the band covers the eased-flat rounds too.
  await client.send('Page.startScreencast', { format: 'jpeg', everyNthFrame: 1, ...CAP })
  const marks = []
  let t0 = Date.now()
  // A burst rides the middle of the baseline: both channels watching
  // the same breathing word under the page's hold, which is what lets
  // the carry clause co-register them (see the calibration there).
  await sleep(350)
  await burst('calibration')
  await sleep(350)
  marks.push({ what: 'baseline', t0, t1: Date.now() })

  // Phase one: registration wants a static swap-eve — a held screen to
  // compare the first canvas frames against — so ease the carried float
  // flat and let the amplitude die (tau 150ms; 700ms leaves under 1% of
  // the ceiling, a residual well inside the seam budget).
  await setFloat(0)
  await sleep(700)

  // Full round trips: page → gl → page. The settle dwell, the
  // ramp up, a beat of full-depth bob, the ramp down, the landing swap.
  for (let i = 0; i < ROUNDS; i++) {
    t0 = Date.now()
    await toggle()
    await waitPhase('gl')
    await sleep(700)
    marks.push({ what: `lift ${i + 1}`, t0, t1: Date.now() })
    t0 = Date.now()
    await toggle()
    await waitPhase('page')
    await sleep(400)
    marks.push({ what: `land ${i + 1}`, t0, t1: Date.now() })
  }

  // Phase two: the float back at its ceiling, and left there. Every
  // crossing from here on happens MID-BREATH — this is the carried
  // motion claim, and the reversals ride along because changing your
  // mind mid-air is part of it.
  const tCarry = Date.now()
  await setFloat(0.15)
  await sleep(700)

  for (let i = 0; i < 2; i++) {
    t0 = Date.now()
    await toggle()
    await waitPhase('gl')
    await sleep(700)
    marks.push({ what: `carry ${i + 1} lift`, t0, t1: Date.now() })
    t0 = Date.now()
    await toggle()
    await waitPhase('page')
    await burst(`carry ${i + 1} land`)
    await sleep(400)
    marks.push({ what: `carry ${i + 1} land`, t0, t1: Date.now() })
  }

  // Reversal one: abandon a lift mid-dwell. The page never released, so
  // the word must simply keep breathing.
  t0 = Date.now()
  await toggle()
  await sleep(150)
  if ((await phase()) === 'lifting') await toggle()
  else {
    // The throttled machine got through the dwell first — ride it home.
    await waitPhase('gl')
    await toggle()
  }
  await waitPhase('page')
  await burst('abort lift')
  await sleep(300)
  marks.push({ what: 'abort lift', t0, t1: Date.now() })

  // Reversal two: change of heart mid-landing. The canvas never
  // released; the progress must climb back from where it was.
  t0 = Date.now()
  await toggle()
  await waitPhase('gl')
  await sleep(250)
  await toggle() // landing…
  await sleep(200) // …part-way down…
  await toggle() // …and back up.
  await waitPhase('gl')
  await sleep(500)
  await toggle()
  await waitPhase('page')
  await burst('reverse landing')
  await sleep(400)
  marks.push({ what: 'reverse landing', t0, t1: Date.now() })

  await client.send('Page.stopScreencast')

  // Scored in batches, frames dropped as they are scored — the numbers
  // are what the run is about.
  const series = []
  for (let k = 0; k < frames.length; k += 20) {
    const batch = frames.slice(k, k + 20).map((f) => ({ data: f.data, t: f.t }))
    series.push(
      ...(await page.evaluate(
        async (list, r) => {
          const out = []
          for (const f of list) out.push({ t: f.t, ...(await window.__cover(f.data, r)) })
          return out
        },
        batch,
        rect,
      )),
    )
  }

  // The shots go through the same decoder — full-size JPEGs, so the
  // derived scale is 1 and the centroid noise is below the cast's.
  const shotSeries = []
  for (const sh of shots) {
    const sc = await page.evaluate((b64, r) => window.__cover(b64, r), sh.data, rect)
    shotSeries.push({ t: sh.t, where: sh.where, ...sc })
  }

  const base = series.filter(
    (s) => s.t * 1000 >= marks[0].t0 && s.t * 1000 <= marks[0].t1,
  )
  const baseMin = Math.min(...base.map((s) => s.cover))
  const baseMax = Math.max(...base.map((s) => s.cover))

  console.log(
    `\n  word rectangle ${rect.w}x${rect.h} at ${rect.x},${rect.y} · cpu /${SLOWCPU || 1} · ` +
      `${ROUNDS} static + 2 carried round trips + 2 reversals · ` +
      `${series.length} cast frames + ${shotSeries.length} forced composites`,
  )
  console.log(
    `  ink at rest                   ${(baseMin * 100).toFixed(1)}–${(baseMax * 100).toFixed(1)}% of the rectangle`,
  )

  // Sanity first: a rectangle that barely contains ink cannot lose it
  // measurably, and every verdict below would be noise.
  if (!base.length || baseMin < 0.02)
    problems.push(
      `the baseline holds ${(baseMin * 100).toFixed(2)}% ink — the rectangle cannot tell the word ` +
        `from the plate, so nothing below means anything`,
    )

  // The guarantee, applied to every frame after the cast opened: the
  // word never thins past VANISH of its resting ink and never blooms
  // past BLOOM of it. Frames between marks count too — there is no
  // instant at which vanishing would be acceptable.
  const floor = baseMin * VANISH
  const ceil = baseMax * BLOOM
  let worst = null
  for (const s of series) {
    if (s.cover >= floor && s.cover <= ceil) continue
    const at = marks.find((m) => s.t * 1000 >= m.t0 && s.t * 1000 <= m.t1)
    const where = at ? at.what : 'between crossings'
    const kind = s.cover < floor ? 'vanished' : 'bloomed'
    problems.push(
      `frame at ${(s.t % 1000).toFixed(3)}s (${where}): ink ${kind} to ${(s.cover * 100).toFixed(2)}% ` +
        `against a resting ${(baseMin * 100).toFixed(1)}–${(baseMax * 100).toFixed(1)}%`,
    )
    if (!worst || Math.abs(s.cover - baseMin) > Math.abs(worst.cover - baseMin)) worst = s
  }
  // The shots obey the same band — a forced composite that catches the
  // word half-vanished inside the cast's blind window is exactly the
  // fault the tails describe, seen through the only channel open there.
  for (const s of shotSeries) {
    if (s.cover >= floor && s.cover <= ceil) continue
    const kind = s.cover < floor ? 'vanished' : 'bloomed'
    problems.push(
      `a return-window shot (${s.where}): ink ${kind} to ${(s.cover * 100).toFixed(2)}% ` +
        `against a resting ${(baseMin * 100).toFixed(1)}–${(baseMax * 100).toFixed(1)}%`,
    )
  }

  // The shape the numbers came from: per-crossing extremes, so a reader
  // sees the swell and the settle rather than taking the verdict on faith.
  console.log('')
  for (const m of marks.slice(1)) {
    const cut = series.filter((s) => s.t * 1000 >= m.t0 && s.t * 1000 <= m.t1)
    if (!cut.length) {
      problems.push(`no frames landed inside "${m.what}" — the capture missed it`)
      continue
    }
    const lo = Math.min(...cut.map((s) => s.cover))
    const hi = Math.max(...cut.map((s) => s.cover))
    console.log(
      `  ${m.what.padEnd(18)} ${String(cut.length).padStart(3)} frames · ink ` +
        `${(lo * 100).toFixed(1)}–${(hi * 100).toFixed(1)}%`,
    )
  }

  const median = (a) => {
    const srt = [...a].sort((m, n) => m - n)
    const mid = srt.length >> 1
    return srt.length % 2 ? srt[mid] : (srt[mid - 1] + srt[mid]) / 2
  }
  const flips = await page.evaluate(() => window.__flips)

  // Registration, at every STATIC forward swap (phase one): the
  // swap-eve screen against the first canvas frames. The screencast
  // emits a frame only when the composite CHANGES — an eased-flat
  // lifting page emits nothing (or sub-pixel trickle) — so "before" is
  // not a window of frames but the LAST frame at least 50ms clear of
  // the flip: the screen held that exact image up to the swap. One
  // frame is enough — the centroid averages thousands of ink pixels, so
  // codec noise on it is far below the budget. "After" stays a median
  // inside progress ≤ ~0.26, where bob and wobble pivot about centers
  // they cannot yet have moved. 1.0 CSS px is the perceptual floor: the
  // defect this clause pins measured 1–2 px by eye (2026-08-13).
  // Backward static swaps are left to the coverage band — their
  // "before" side is a landing mid-descent, which has no settled frame
  // to compare.
  const SEAM = 1.0
  const swaps = flips.filter(
    (f) => f.from === 'lifting' && f.to === 'gl' && f.t < tCarry,
  )
  if (!swaps.length)
    problems.push('no static forward swaps were observed — the flip recorder saw nothing')
  console.log('')
  for (const [i, f] of swaps.entries()) {
    const before = series
      .filter((s) => s.t * 1000 <= f.t - 50 && s.cx !== null)
      .at(-1)
    const after = series.filter(
      (s) => s.t * 1000 >= f.t + 50 && s.t * 1000 <= f.t + 200 && s.cx !== null,
    )
    if (!before || after.length < 2) {
      problems.push(
        `swap ${i + 1}: too few frames to judge registration ` +
          `(${before ? 1 : 0} before, ${after.length} after)`,
      )
      continue
    }
    const dx = median(after.map((s) => s.cx)) - before.cx
    const dy = median(after.map((s) => s.cy)) - before.cy
    const shift = Math.hypot(dx, dy)
    console.log(
      `  swap ${String(i + 1).padEnd(13)} ink centroid moved ${shift.toFixed(2)} css px ` +
        `(${dx >= 0 ? '+' : ''}${dx.toFixed(2)} x, ${dy >= 0 ? '+' : ''}${dy.toFixed(2)} y)`,
    )
    if (shift > SEAM)
      problems.push(
        `swap ${i + 1}: the word stepped ${shift.toFixed(2)} css px at the swap frame ` +
          `(budget ${SEAM.toFixed(1)}) — registration is off`,
      )
  }

  // Carry, at every swap after tCarry, BOTH directions: the word
  // crosses while moving, and the ink's path must not notice the
  // handoff. Each side of the flip gets its own fit — a parabola over
  // the 300ms before (the six-letter breath is a sum of slow cosines; a
  // quadratic tracks it to a fraction of a px over a window this
  // short), a line over the ~250ms after — and BOTH are evaluated AT
  // the flip: the gap between them is the discontinuity. Meeting at the
  // flip keeps every extrapolation inside ~150ms of its own window,
  // which matters because the admission rule below can shorten the
  // before-window and the depth ramp's dying curvature is real; an
  // earlier form that extrapolated the before-fit across the entire
  // after-window amplified that curvature into phantom px (a 3.3px
  // reading against shots steady to 0.1px, 2026-08-14). The
  // after-frames come from two channels by direction. A forward swap
  // reads the passive cast. A backward swap CANNOT — the cast is dark
  // for ~250ms after a return handoff while the screen runs on
  // (platform.md item 13) — so it reads the burst of forced composites
  // taken inside that window. A carry that breaks — twins parked flat,
  // or a clock apart — parts the two paths by the instantaneous float,
  // several px at the ceiling, undiminished at the flip itself. 1.5 CSS
  // px: fit residual + codec + the landing ramp's last breath, far
  // below the broken-carry signal.
  //
  // One admission rule guards the fit: a frame is only a POSITION
  // sample while the ink mask is the word's own ink. The matter shaders
  // add light — sheen, reflection, halo — that crosses the luma
  // threshold and swells coverage ~+3pp at full progress, dragging the
  // mask centroid px while no letter moves; on the progress ramps that
  // drag decays in an arc that whips the parabola into a runaway
  // (measured ~21px extrapolated, against shots steady to 0.1px,
  // 2026-08-14). Coverage is the tell: substance-lit frames sit above
  // the resting band, settled frames inside it, so the fit reads only
  // frames within COVER_LIT of the baseline ceiling. The clause loses
  // nothing it was built for — a parked or clock-split twin displaces
  // the centroid at REST coverage and is admitted straight to judgment.
  const CARRY = 1.5
  const COVER_LIT = 0.0015
  const settled = (s) => s.cover <= baseMax + COVER_LIT
  const quad = (pts) => {
    // Least-squares parabola v(t), t centered on the window mean so the
    // normal equations stay tame. Cramer on the 3x3.
    const n = pts.length
    const mt = pts.reduce((a, p) => a + p.t, 0) / n
    let s1 = 0, s2 = 0, s3 = 0, s4 = 0, r0 = 0, r1 = 0, r2 = 0
    for (const p of pts) {
      const x = p.t - mt
      s1 += x; s2 += x * x; s3 += x ** 3; s4 += x ** 4
      r0 += p.v; r1 += p.v * x; r2 += p.v * x * x
    }
    const det =
      n * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2)
    if (!det) return null
    const a =
      (r0 * (s2 * s4 - s3 * s3) - s1 * (r1 * s4 - s3 * r2) + s2 * (r1 * s3 - s2 * r2)) / det
    const b =
      (n * (r1 * s4 - r2 * s3) - r0 * (s1 * s4 - s3 * s2) + s2 * (s1 * r2 - r1 * s2)) / det
    const c =
      (n * (s2 * r2 - s3 * r1) - s1 * (s1 * r2 - r1 * s2) + r0 * (s1 * s3 - s2 * s2)) / det
    return (t) => a + b * (t - mt) + c * (t - mt) * (t - mt)
  }
  // Least-squares line, for the after-window: eight-ish samples over
  // 250ms carry too little arc for a stable curvature estimate, and a
  // line evaluated ~150ms from its own center stays within codec noise
  // of the breath.
  const lin = (pts) => {
    const n = pts.length
    const mt = pts.reduce((a, p) => a + p.t, 0) / n
    let s2 = 0
    let r0 = 0
    let r1 = 0
    for (const p of pts) {
      const x = p.t - mt
      s2 += x * x
      r0 += p.v
      r1 += p.v * x
    }
    if (!s2) return null
    return (t) => r0 / n + (r1 / s2) * (t - mt)
  }
  // The two channels do not read the same centroid from the same
  // screen. The cast is decoded at half scale, the shots at full, and
  // the ink threshold lands differently on the letters' edges at the
  // two resolutions — a constant offset of a couple px, not noise
  // (measured ~(-0.7, -2.8) the day this was built). So the run
  // co-registers them on the baseline burst — both channels watched the
  // same breathing word under the page's hold — and corrects every
  // return-window shot by the measured offset. A real broken carry
  // still shows: it varies with the instantaneous float; the offset
  // does not.
  const calShots = shotSeries.filter((s) => s.where === 'calibration' && s.cx !== null)
  let cal = null
  if (calShots.length >= 4) {
    const lo = Math.min(...calShots.map((s) => s.t)) - 150
    const hi = Math.max(...calShots.map((s) => s.t)) + 150
    const calCast = series.filter((s) => s.cx !== null && s.t * 1000 >= lo && s.t * 1000 <= hi)
    if (calCast.length >= 8) {
      const fx = quad(calCast.map((s) => ({ t: s.t * 1000, v: s.cx })))
      const fy = quad(calCast.map((s) => ({ t: s.t * 1000, v: s.cy })))
      if (fx && fy)
        cal = {
          dx: median(calShots.map((s) => s.cx - fx(s.t))),
          dy: median(calShots.map((s) => s.cy - fy(s.t))),
        }
    }
  }
  if (cal)
    console.log(
      `  channel offset       shot − cast (${cal.dx >= 0 ? '+' : ''}${cal.dx.toFixed(2)} x, ` +
        `${cal.dy >= 0 ? '+' : ''}${cal.dy.toFixed(2)} y) css px, corrected in return windows`,
    )
  else {
    problems.push('channel calibration failed — cast and shots could not be co-registered')
    cal = { dx: 0, dy: 0 }
  }
  const carrySwaps = flips.filter(
    (f) =>
      f.t >= tCarry &&
      ((f.from === 'lifting' && f.to === 'gl') ||
        (f.from === 'landing' && f.to === 'page')),
  )
  if (!carrySwaps.length)
    problems.push('no carried swaps were observed — the flip recorder saw nothing in phase two')
  console.log('')
  for (const [i, f] of carrySwaps.entries()) {
    const forward = f.to === 'gl'
    const dir = forward ? 'page→gl' : 'gl→page'
    const before = series
      .filter(
        (s) => s.cx !== null && settled(s) && s.t * 1000 >= f.t - 300 && s.t * 1000 <= f.t - 30,
      )
      .map((s) => ({ t: s.t * 1000, cx: s.cx, cy: s.cy, cover: s.cover }))
    const after = forward
      ? series
          .filter(
            (s) =>
              s.cx !== null && settled(s) && s.t * 1000 >= f.t + 30 && s.t * 1000 <= f.t + 180,
          )
          .map((s) => ({ t: s.t * 1000, cx: s.cx, cy: s.cy, cover: s.cover }))
      : shotSeries
          .filter((s) => s.cx !== null && settled(s) && s.t >= f.t + 20 && s.t <= f.t + 260)
          .map((s) => ({ t: s.t, cx: s.cx - cal.dx, cy: s.cy - cal.dy, cover: s.cover }))
    if (before.length < 4 || after.length < 2) {
      problems.push(
        `carry swap ${i + 1} (${dir}): too few frames to judge continuity ` +
          `(${before.length} before, ${after.length} after)`,
      )
      continue
    }
    const px = quad(before.map((s) => ({ t: s.t, v: s.cx })))
    const py = quad(before.map((s) => ({ t: s.t, v: s.cy })))
    const ax = lin(after.map((s) => ({ t: s.t, v: s.cx })))
    const ay = lin(after.map((s) => ({ t: s.t, v: s.cy })))
    if (!px || !py || !ax || !ay) {
      problems.push(`carry swap ${i + 1} (${dir}): degenerate fit window`)
      continue
    }
    const err = Math.hypot(px(f.t) - ax(f.t), py(f.t) - ay(f.t))
    console.log(
      `  carry swap ${i + 1} (${dir})  paths met at the swap within ${err.toFixed(2)} css px ` +
        `(${before.length} cast + ${after.length} ${forward ? 'cast' : 'shot'} frames)`,
    )
    if (process.env.CARRY_DEBUG) {
      for (const s of before)
        console.log(
          `      pre  ${(s.t - f.t).toFixed(0).padStart(5)}ms cast (${s.cx.toFixed(2)}, ${s.cy.toFixed(2)}) cover ${(s.cover * 100).toFixed(2)}%`,
        )
      for (const s of after)
        console.log(
          `      post ${(s.t - f.t).toFixed(0).padStart(5)}ms ${forward ? 'cast' : 'shot'} ` +
            `(${s.cx.toFixed(2)}, ${s.cy.toFixed(2)}) cover ${(s.cover * 100).toFixed(2)}%`,
        )
      console.log(
        `      at flip: before fit (${px(f.t).toFixed(2)}, ${py(f.t).toFixed(2)}) · ` +
          `after fit (${ax(f.t).toFixed(2)}, ${ay(f.t).toFixed(2)})`,
      )
    }
    if (err > CARRY)
      problems.push(
        `carry swap ${i + 1} (${dir}): the moving word left its path by ${err.toFixed(2)} css px ` +
          `at the swap (budget ${CARRY.toFixed(1)}) — the motion did not carry`,
      )
  }

  // Double vision, at every phase-two lifting span: the page alone is
  // on screen, breathing at the ceiling, so the ink must stay inside
  // the resting band plus codec slack. A composited canvas whose twins
  // are NOT tracking adds their flat fringe around every breathing
  // letter — percentage points the coverage tails (x0.5, x2.5) are far
  // too coarse to notice. Phase-one lifting spans are skipped: an
  // eased-flat page holds its screen and emits nothing to measure.
  const GHOST = 0.02
  const spans = []
  {
    let open = null
    for (const f of flips) {
      if (f.to === 'lifting') open = f.t
      else if (open !== null) {
        spans.push({ t0: open, t1: f.t })
        open = null
      }
    }
  }
  const carrySpans = spans.filter((sp) => sp.t0 >= tCarry)
  if (!carrySpans.length)
    problems.push('no phase-two lifting spans were observed — the flip recorder saw nothing')
  let ghostMax = 0
  let ghostFrames = 0
  for (const span of carrySpans) {
    for (const s of series) {
      const t = s.t * 1000
      if (t < span.t0 + 50 || t > span.t1 - 50) continue
      ghostFrames++
      ghostMax = Math.max(ghostMax, s.cover - baseMax)
    }
  }
  if (ghostFrames) {
    console.log(
      `  lifting spans        ${ghostFrames} frames · ink at most ` +
        `+${(ghostMax * 100).toFixed(2)}pp over rest (ghost budget +${(GHOST * 100).toFixed(1)}pp)`,
    )
    if (ghostMax > GHOST)
      problems.push(
        `a lifting frame swelled ${(ghostMax * 100).toFixed(2)}pp of ink over rest — ` +
          `the canvas is composited before the swap (double vision)`,
      )
  } else if (carrySpans.length) {
    problems.push('no frames landed inside any phase-two lifting span — the capture missed the warm-up')
  }

  if (worst) {
    const frame = frames.find((f) => f.t === worst.t)
    if (frame) {
      const out = path.join(ROOT, 'instruments', 'crossing-flash', 'out')
      mkdirSync(out, { recursive: true })
      writeFileSync(path.join(out, 'worst.jpg'), Buffer.from(frame.data, 'base64'))
      console.log(`\n  worst frame written to instruments/crossing-flash/out/worst.jpg`)
    }
  }
  frames = []

  console.log(
    `\ncrossing-flash: ${problems.length === 0 ? 'PASS — the word held its ink, its registration, and its breath through every frame' : 'FAIL'}`,
  )
  for (const p of problems) console.log(`  ${p}`)
  process.exit(problems.length === 0 ? 0 : 1)
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
