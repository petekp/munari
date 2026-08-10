// film-stays-lit — does the film go dark on the frame the sheet takes
// over?
//
// film-window.mjs already asks the two hard questions about video: that
// decoded frames reach the texture at all, and that both copies show the
// same instant of the clip. Both pass. Both are asked of a flight that
// is already under way, and neither can see the first moment of one.
//
// That moment is the one video has a problem the markup windows do not.
// Every other window's airborne copy is a fresh mount of markup, and
// markup renders the instant it is attached. A <video> does not: a new
// element starts at readyState 0 with no frame to show, and a box with
// no frame in it is a hole. The file is cached and the wait is short,
// which is exactly why it reads as a FLICKER rather than as a window
// that is simply blank for a while.
//
// So this reads the composited output — the pixels a viewer gets — and
// asks one question of the film's own rectangle:
//
//   is it ever darker than the clip itself ever gets?
//
// Darkness is the right measure and a reference-diff is not. The film is
// moving, so no two frames of it match; what it never does is go to
// nothing. The resting clip is sampled first for its own darkest moment,
// and the floor is set under that. A frame below the floor is not a dark
// shot — it is an empty box.
//
// Which of darkness's two numbers, though, matters as much as the idea.
// This first asked the question of MEAN luma and got sixty false
// positives per run: the clip's own brightness swings about 25 luma over
// its twelve seconds, so any baseline shorter than the whole clip
// reports the next shot as a hole. The fault does not dim the picture.
// It removes the picture, and what says so is the SHARE of the rectangle
// that is near black — 1-2% while the film runs, 100% when the box is
// empty. That is a two-order-of-magnitude gap and no baseline drift can
// close it. The mean is still printed, because a reader wants to see
// what the clip was doing; nothing is decided on it.
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

// The one window whose content is decoded video.
const WIN = 'triangolo'
// The clip's own length, from tools/make-film.sh — how long the baseline
// has to watch to have seen every shot in it.
const FILM_PERIOD = 12
const ROUNDS = Number(process.env.ROUNDS || 5)
const CAP = { maxWidth: 550, maxHeight: 400, quality: 70 }
const DSF = Number(process.env.DSF || 1)
// How long after the press the sheet is still standing where the window
// was. The minimize runs easeInCubic, so the first quarter of its
// duration produces almost no travel — the film's rectangle is still
// full of film, and anything dark in it is the hole and not the desk.
const HOLD_MS = Number(process.env.HOLD_MS || 320)
// Squeezed by default, for the reason rest-blink.mjs sets out at length:
// a handoff that only holds on an idle machine is a handoff that has not
// been measured.
const SLOWCPU = Number(process.env.SLOWCPU ?? 4)

let server, browser
const deadline = setTimeout(() => {
  console.error('film-stays-lit: hard 180s deadline hit')
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
  await page.setViewport({ width: 1100, height: 800, deviceScaleFactor: DSF })
  await page.goto(`http://localhost:${port}/?scene=genie`, { waitUntil: 'load' })
  await page.waitForFunction(
    () =>
      document.querySelector('.gen-slot[data-win="quadrato"]') && document.fonts.status === 'loaded',
    { timeout: 15_000 },
  )
  // Nothing below means anything until the clip is actually running.
  await page.waitForFunction(
    (w) => {
      const v = document.querySelector(`.gen-slot[data-win="${w}"] video`)
      return v && v.readyState >= 2 && !v.paused && v.currentTime > 0
    },
    { timeout: 15_000 },
    WIN,
  )
  await sleep(700)

  // Raise it clear of the cascade, pressing a part of the titlebar that
  // is actually exposed — the film window stands in the middle of the
  // pile, and a press at the element's centre lands on whatever is on
  // top of it.
  const clear = await page.evaluate((w) => {
    const bar = document.querySelector(`.gen-slot[data-win="${w}"] .gen-titlebar`)
    const slot = bar.closest('.gen-slot')
    const r = bar.getBoundingClientRect()
    const y = Math.round(r.top + r.height / 2)
    for (let x = Math.round(r.right) - 4; x > r.left; x -= 4) {
      const at = document.elementFromPoint(x, y)
      if (at && slot.contains(at) && !at.closest('.gen-lamp')) return { x, y }
    }
    return null
  }, WIN)
  if (!clear) throw new Error(`no exposed part of ${WIN}'s titlebar to press`)
  await page.mouse.click(clear.x, clear.y)
  await sleep(300)

  // The film's own rectangle, inset so the window's border, its rounded
  // corners and its shadow stay out of the measurement. What is left is
  // picture and nothing else.
  const rect = await page.evaluate((w) => {
    const r = document.querySelector(`.gen-slot[data-win="${w}"] video`).getBoundingClientRect()
    const inx = Math.round(r.width * 0.08)
    const iny = Math.round(r.height * 0.08)
    return {
      x: Math.round(r.left) + inx,
      y: Math.round(r.top) + iny,
      w: Math.round(r.width) - inx * 2,
      h: Math.round(r.height) - iny * 2,
    }
  }, WIN)

  await page.evaluate(() => {
    window.__read = async (b64, rect) => {
      const img = new Image()
      img.src = `data:image/jpeg;base64,${b64}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)
      const s = img.width / window.innerWidth
      const x = Math.round(rect.x * s)
      const y = Math.round(rect.y * s)
      const w = Math.round(rect.w * s)
      const h = Math.round(rect.h * s)
      const d = ctx.getImageData(x, y, w, h).data
      let sum = 0
      let dark = 0
      for (let i = 0; i < d.length; i += 4) {
        const l = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8
        sum += l
        if (l < 24) dark++
      }
      const n = d.length / 4
      return { mean: sum / n, dark: (dark / n) * 100 }
    }
  })

  const client = await page.createCDPSession()
  if (SLOWCPU > 1) await client.send('Emulation.setCPUThrottlingRate', { rate: SLOWCPU })
  let frames = []
  let capturing = false
  client.on('Page.screencastFrame', async (f) => {
    if (capturing) frames.push({ data: f.data, t: f.metadata.timestamp })
    try {
      await client.send('Page.screencastFrameAck', { sessionId: f.sessionId })
    } catch {
      /* the cast was stopped between the frame and its ack */
    }
  })

  const waitFilled = async (want) =>
    page.waitForFunction(
      (w, v) => document.querySelector(`.gen-tile[data-win="${w}"]`).dataset.filled === v,
      { timeout: 9000 },
      WIN,
      String(want),
    )

  const score = async (list) =>
    page.evaluate(
      async (batch, r) => {
        const out = []
        for (const f of batch) out.push({ t: f.t, ...(await window.__read(f.data, r)) })
        return out
      },
      list,
      rect,
    )

  frames = []
  capturing = true
  await client.send('Page.startScreencast', { format: 'jpeg', everyNthFrame: 1, ...CAP })

  // The clip's own darkest moment — sampled across a WHOLE period, not a
  // convenient couple of seconds, because the baseline is what every
  // threshold below hangs off and a clip is entitled to a dark shot. Every
  // fifth frame, which at this capture rate is still ~12 samples a second.
  await sleep(FILM_PERIOD * 1000 + 600)
  const restCut = await score(frames.filter((_, i) => i % 5 === 0))
  frames = []

  const marks = []
  for (let i = 0; i < ROUNDS; i++) {
    const t0 = Date.now()
    await page.click(`.gen-slot[data-win="${WIN}"] .gen-lamp[data-role="minimize"]`)
    marks.push({ t0, t1: t0 + HOLD_MS })
    await waitFilled(true)
    await sleep(350)
    await page.click(`.gen-tile[data-win="${WIN}"]`)
    await waitFilled(false)
    await sleep(600)
  }
  capturing = false
  await client.send('Page.stopScreencast')

  const series = []
  for (let k = 0; k < frames.length; k += 20) series.push(...(await score(frames.slice(k, k + 20))))
  const captured = frames.length
  frames = []

  const restMean = restCut.map((s) => s.mean)
  const darkCeil = Math.max(...restCut.map((s) => s.dark))

  // How much more of the rectangle has to be near black than the clip
  // ever manages before it stops being a dark shot and starts being an
  // absence. Wide, deliberately: the measured gap is 1-2% against 100%,
  // so anything in the middle is a finding either way.
  const DARK_MARGIN = 25
  const rounds = marks.map((m) => ({
    ...m,
    cut: series.filter((s) => s.t * 1000 >= m.t0 && s.t * 1000 <= m.t1),
  }))

  let holes = 0
  let missed = 0
  let worst = null
  for (const r of rounds) {
    if (!r.cut.length) {
      missed++
      continue
    }
    for (const s of r.cut)
      if (s.dark > darkCeil + DARK_MARGIN) {
        holes++
        if (!worst || s.dark > worst.dark) worst = s
      }
  }

  console.log(`\n  film rectangle ${rect.w}x${rect.h} at ${rect.x},${rect.y}`)
  console.log(
    `  the clip at rest, ${restCut.length} frames over a full period   mean luma ` +
      `${Math.min(...restMean).toFixed(1)}–${Math.max(...restMean).toFixed(1)}, ` +
      `never more than ${darkCeil.toFixed(1)}% of it near black`,
  )
  console.log(
    `\n  ${WIN} · dSF ${DSF} · cpu /${SLOWCPU || 1} · ${ROUNDS} minimizes · ` +
      `${captured} frames · first ${HOLD_MS}ms of each`,
  )
  console.log(`  frames inside each hold       ${rounds.map((r) => r.cut.length).join(', ')}`)
  console.log(`    frames with no picture      ${holes}`)
  if (worst)
    console.log(`    worst                       ${worst.dark.toFixed(1)}% near black, mean ${worst.mean.toFixed(1)}`)

  console.log('\n  one minimize, frame by frame (mean luma · % near black)')
  for (const s of rounds[0].cut)
    console.log(`    ${s.mean.toFixed(1).padStart(6)}   ${s.dark.toFixed(1).padStart(6)}%`)

  if (missed)
    problems.push(
      `${missed} of ${rounds.length} minimizes produced no frames in the hold — the capture missed them`,
    )
  if (holes)
    problems.push(
      `on ${holes} frames the film's rectangle was more nearly black than the clip ever gets ` +
        `(${darkCeil.toFixed(1)}% at its darkest, ${worst.dark.toFixed(1)}% here) — the airborne copy is ` +
        `showing an empty box where the picture should be`,
    )

  console.log(`\nfilm-stays-lit: ${problems.length === 0 ? 'PASS — the picture never goes out' : 'FAIL'}`)
  for (const p of problems) console.log(`  ${p}`)
  process.exit(problems.length === 0 ? 0 : 1)
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
