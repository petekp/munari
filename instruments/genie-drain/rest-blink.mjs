// rest-blink — does the window appear at its rest position after it has
// left it?
//
// swap-seam asks the state machine, and the state machine answers
// cleanly: the page copy hides on the same commit the sheet turns
// visible, the drive never jumps, the bay and the desk never both hold
// the window. All true, and none of it settles the question, because
// the page copy and the sheet are committed by two different
// reconcilers. React DOM writes an attribute; react-three-fiber writes
// into a scene that is drawn on its own animation frame. Two commits
// that agree in state can still land in different browser frames, and
// the compositor draws whatever each of them said at the moment it
// looked.
//
// So this one does not read state at all. It reads the composited
// output, frame by frame, through the DevTools screencast — the same
// pixels a viewer gets — and asks one question of the window's rest
// rectangle:
//
//   does the window come BACK to it?
//
// Two references make that answerable. REST is the rectangle with the
// window standing in it; GONE is the same rectangle with the window
// docked and the desk showing through. Every captured frame is scored
// against both. A minimize should leave REST once and never return: the
// distance from REST rises, the distance from GONE falls, and neither
// reverses. A frame that reads close to REST after the sheet has
// visibly moved is the flicker, and a frame that reads close to GONE
// before the sheet has moved is its twin — a hole where the DOM has
// already hidden the window and the canvas has not yet drawn it.
//
// Screenshots cannot do this. A screenshot round trip samples at
// something like 15/s, and both faults are one frame long.
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

// scheda, because it is the one window that stands clear of the cascade:
// nothing overlaps its rectangle, so anything that appears there is the
// window itself and not a neighbour being redrawn.
const WIN = process.env.WIN || 'scheda'
const ROUNDS = Number(process.env.ROUNDS || 6)
// Half scale. The fault being looked for is a whole window's worth of
// image arriving where there should be none, which survives any
// reasonable downsampling — and at full size six rounds of capture is
// more JPEG than there is any reason to move through a CDP socket.
const CAP = { maxWidth: 550, maxHeight: 400, quality: 70 }
// Luma, 0..255, averaged over the rectangle. Two encodes of the same
// still frame differ by about a unit; a window arriving or leaving moves
// this by tens. NEAR is "the same picture, allowing for the codec".
const NEAR = 6
// How far the sheet has to have moved before a return to REST counts as
// a return rather than the takeoff frame still overlapping. At t=0 the
// sheet is drawn exactly over the window it came from — that is the
// whole trick — so the first frames legitimately read as REST.
const LEFT = 18
const DSF = Number(process.env.DSF || 1)
const PATH = process.env.PATH_ === 'drag' ? 'drag' : 'lamp'
const HEADED = process.env.HEADED === '1'
const FAST = process.env.FAST === '1'
// Squeeze the main thread, BY DEFAULT.
//
// This is the whole reason the instrument works. The page copy hides
// through React state and the sheet is drawn by a second reconciler on
// its own frame, and on an idle machine those two land together every
// time: 24 flights, 7,000 composited frames, not one seam. The gap is
// real all the same — it is just zero frames wide when nothing is
// competing for the thread. At 6x it opens to two frames and the window
// blinks out and back at its old position, which is the fault as
// reported.
//
// So the throttle is not a stress option to be turned on when someone
// suspects something. A contract that only fails when an env var is set
// is a contract nobody runs. The measurement below is taken on a busy
// machine because a viewer's machine is busy.
const SLOWCPU = Number(process.env.SLOWCPU ?? 6)

let server, browser
const deadline = setTimeout(() => {
  console.error('rest-blink: hard 180s deadline hit')
  process.exit(1)
}, 180_000)

const problems = []

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    // Headed is a different renderer, not the same one with a window
    // attached. Headless composites in software and in lockstep, so the
    // page's layers and the WebGL canvas's layer can never disagree by a
    // frame; on a real GPU they are separate surfaces with separate
    // schedules. A seam that only exists between two GPU layers is
    // invisible to every headless run, however many frames it records.
    headless: !HEADED,
    args: [
      '--enable-features=CanvasDrawElement',
      '--disable-renderer-backgrounding',
      '--autoplay-policy=no-user-gesture-required',
      // Off the vsync leash. A desk at 60Hz gives the two reconcilers
      // 16ms to land in the same frame, which is generous; a ProMotion
      // panel halves that, and unthrottled halves it again and again.
      // If the handoff only holds because frames are slow, this is where
      // it stops holding.
      ...(FAST ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []),
    ],
  })
  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  const page = await browser.newPage()
  // The scale is a knob because the fault being hunted is a timing one,
  // and the texture's size is the biggest lever on how long a capture
  // takes. A Retina desk uploads four times the pixels per frame; if the
  // seam only opens when the capture runs long, dSF 2 is where it opens.
  await page.setViewport({ width: 1100, height: 800, deviceScaleFactor: DSF })
  await page.goto(`http://localhost:${port}/?scene=genie`, { waitUntil: 'load' })
  await page.waitForFunction(
    () =>
      document.querySelector('.gen-slot[data-win="quadrato"]') && document.fonts.status === 'loaded',
    { timeout: 15_000 },
  )
  await sleep(700)

  // Freeze everything that moves on its own. The window's content
  // bounces on CSS keyframes and a text caret blinks in it, and both
  // would show up in the rectangle as motion that has nothing to do with
  // where the window is. The film keeps rolling in another window, which
  // is fine: it is nowhere near this rectangle.
  await page.addStyleTag({
    content:
      '*, *::before, *::after { animation-play-state: paused !important; }\n' +
      '* { caret-color: transparent !important; }',
  })
  await sleep(200)

  // Bring it to the front. Three of the four windows stand in a cascade
  // and the rectangle only means anything if nothing else is drawn in
  // it: a neighbour redrawing over the same pixels would be charged to
  // the window under test. Raising is free — a press on a titlebar
  // changes the stack and nothing else.
  //
  // The press has to land on a part of the titlebar that is actually
  // exposed, which for a window in the middle of the cascade is only its
  // right end. Aiming at the element's centre raises the window on TOP
  // of it instead, and then the lamp is still buried and the run times
  // out waiting for a flight nobody started. So the point is found by
  // asking the page, right edge inward, where this window is the thing
  // on top.
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
  if (!clear) throw new Error(`no exposed part of ${WIN}'s titlebar to press — it is fully covered`)
  await page.mouse.click(clear.x, clear.y)
  await sleep(250)

  const rect = await page.evaluate((w) => {
    const r = document.querySelector(`.gen-slot[data-win="${w}"] .gen-window`).getBoundingClientRect()
    // Inflated, so the window's own shadow and border are inside the
    // rectangle: the edge is the part of a window that most obviously
    // says it is there.
    return {
      x: Math.round(r.left) - 6,
      y: Math.round(r.top) - 6,
      w: Math.round(r.width) + 12,
      h: Math.round(r.height) + 12,
    }
  }, WIN)

  // The decoder lives in the page — a canvas is the only JPEG reader
  // available here, and the frames have to cross into it anyway.
  await page.evaluate(() => {
    window.__ref = {}
    window.__read = async (b64, rect) => {
      const img = new Image()
      img.src = `data:image/jpeg;base64,${b64}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)
      // The screencast scales the frame to fit its cap, so the rectangle
      // has to be scaled by the same factor — derived from the image
      // that arrived rather than assumed from the cap, since the encoder
      // rounds.
      const s = img.width / window.innerWidth
      const x = Math.round(rect.x * s)
      const y = Math.round(rect.y * s)
      const w = Math.round(rect.w * s)
      const h = Math.round(rect.h * s)
      const d = ctx.getImageData(x, y, w, h).data
      const luma = new Uint8Array(w * h)
      for (let i = 0, p = 0; i < d.length; i += 4, p++)
        luma[p] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8
      return luma
    }
    window.__diff = (a, b) => {
      if (a.length !== b.length) return -1
      let s = 0
      for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i])
      return s / a.length
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

  // A reference is a single captured frame, taken the same way the run's
  // frames are taken — through the screencast, at the same scale and the
  // same quality. Taking it with page.screenshot instead would compare a
  // PNG against a JPEG and charge the codec's difference to the window.
  const oneFrame = async () => {
    frames = []
    capturing = true
    await client.send('Page.startScreencast', { format: 'jpeg', everyNthFrame: 1, ...CAP })
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    for (let i = 0; i < 40 && frames.length === 0; i++) await sleep(25)
    capturing = false
    await client.send('Page.stopScreencast')
    if (!frames.length) throw new Error('the screencast produced no frames')
    return frames[frames.length - 1].data
  }

  const restShot = await oneFrame()
  await page.evaluate(async (s, r) => {
    window.__ref.rest = await window.__read(s, r)
  }, restShot, rect)

  await page.click(`.gen-slot[data-win="${WIN}"] .gen-lamp[data-role="minimize"]`)
  await waitFilled(true)
  await sleep(500)
  const goneShot = await oneFrame()
  await page.evaluate(async (s, r) => {
    window.__ref.gone = await window.__read(s, r)
  }, goneShot, rect)

  await page.click(`.gen-tile[data-win="${WIN}"]`)
  await waitFilled(false)
  await sleep(600)

  // Sanity: the two references have to be far apart, or every score
  // below is noise dressed as a measurement.
  const spread = await page.evaluate(() => window.__diff(window.__ref.rest, window.__ref.gone))
  console.log(`\n  rest rectangle ${rect.w}x${rect.h} at ${rect.x},${rect.y}`)
  console.log(`  window there vs window gone   ${spread.toFixed(1)} luma apart`)
  if (spread < 20)
    problems.push(
      `the two references are only ${spread.toFixed(1)} luma apart — the rectangle cannot tell a window ` +
        `standing in it from a bare desk, so nothing below means anything`,
    )

  // One cast for the whole run. Stopping and restarting it per round
  // cost most of the frames: the first round came back with 75 and every
  // round after it with 6, which is about 13/s — a rate at which a
  // one-frame fault is simply not in the recording. The cast stays up
  // and the flights are cut out of it afterwards by time.
  frames = []
  capturing = true
  await client.send('Page.startScreencast', { format: 'jpeg', everyNthFrame: 1, ...CAP })
  await sleep(200)

  // The two ways a hand starts a minimize, and they are not the same
  // mechanism. The lamp hands the whole descent to the drive, which
  // holds t at the wall until the texture has real pixels. A titlebar
  // pull hands t to the HAND, and a grabbed drive is not clamped by the
  // paint — so between the press and the first painted frame the sheet's
  // t is already following the cursor while the page copy is still the
  // thing being drawn, standing at the position the window has in
  // principle already left.
  const minimize = async () => {
    if (PATH !== 'drag') {
      await page.click(`.gen-slot[data-win="${WIN}"] .gen-lamp[data-role="minimize"]`)
      return
    }
    // Straight down, inside the pour cone: anything off the vertical
    // repositions the window instead of pouring it.
    const reach = await page.evaluate(
      (w, y) => document.querySelector(`.gen-tile[data-win="${w}"]`).getBoundingClientRect().top - y,
      WIN,
      clear.y,
    )
    await page.mouse.move(clear.x, clear.y)
    await page.mouse.down()
    for (let k = 1; k <= 10; k++) {
      await page.mouse.move(clear.x, clear.y + (reach * 0.6 * k) / 10)
      await sleep(16)
    }
    await sleep(260)
    await page.mouse.up()
  }

  const marks = []
  for (let i = 0; i < ROUNDS; i++) {
    let t0 = Date.now()
    await minimize()
    await waitFilled(true)
    await sleep(150)
    marks.push({ way: 'minimize', t0, t1: Date.now() })
    await sleep(250)
    // The restore is watched too. It ends with the window arriving in
    // this same rectangle, and an arrival has the same two ways to go
    // wrong as a departure: the sheet can stop being drawn a frame
    // before the page copy shows, or the page copy can show a frame
    // before the sheet stops.
    t0 = Date.now()
    await page.click(`.gen-tile[data-win="${WIN}"]`)
    await waitFilled(false)
    await sleep(200)
    marks.push({ way: 'restore', t0, t1: Date.now() })
    await sleep(250)
  }
  capturing = false
  await client.send('Page.stopScreencast')

  // Scored in batches, and the frames dropped as soon as they are
  // scored. The whole cast held as raw JPEG is tens of megabytes for no
  // reason; the numbers are what the run is about.
  const series = []
  for (let k = 0; k < frames.length; k += 20) {
    const batch = frames.slice(k, k + 20).map((f) => ({ data: f.data, t: f.t }))
    series.push(
      ...(await page.evaluate(
        async (list, r) => {
          const out = []
          for (const f of list) {
            const l = await window.__read(f.data, r)
            out.push({
              t: f.t,
              rest: window.__diff(l, window.__ref.rest),
              gone: window.__diff(l, window.__ref.gone),
            })
          }
          return out
        },
        batch,
        rect,
      )),
    )
  }
  const captured = frames.length
  frames = []

  // The screencast stamps frames in seconds since the epoch; the marks
  // are milliseconds. One flight is the frames between the press and the
  // landing.
  const rounds = marks.map((m) => ({
    ...m,
    cut: series.filter((s) => s.t * 1000 >= m.t0 && s.t * 1000 <= m.t1),
  }))

  // Both directions are the same shape read in opposite order. A
  // minimize starts with the window in the rectangle and ends with the
  // rectangle bare; a restore starts bare and ends with the window. So
  // each flight has a state it LEAVES and a state it SETTLES INTO, and
  // both faults are the same sentence: neither state may be visited
  // twice.
  //
  //   came back   the rectangle returned to what it left, after the
  //               sheet had visibly moved off it
  //   left again  the rectangle reached what it settles into and then
  //               stopped being it
  //
  // On a minimize the first is the window flashing at its old spot and
  // the second is the desk showing through before the sheet is drawn. On
  // a restore they trade places. Nothing about the mechanism is assumed;
  // the pixels either repeat a state or they do not.
  let cameBack = 0
  let leftAgain = 0
  let missed = 0
  for (const r of rounds) {
    const from = (s) => (r.way === 'minimize' ? s.rest : s.gone)
    const into = (s) => (r.way === 'minimize' ? s.gone : s.rest)
    const off = r.cut.findIndex((s) => from(s) > LEFT)
    if (off < 0) {
      missed++
      continue
    }
    const after = r.cut.slice(off)
    cameBack += after.filter((s) => from(s) <= NEAR).length
    const there = after.findIndex((s) => into(s) <= NEAR)
    if (there >= 0) leftAgain += after.slice(there).filter((s) => into(s) > NEAR + 8).length
  }

  const span = rounds.map((r) => r.cut.length).join(', ')
  console.log(
    `\n  ${WIN} · ${PATH} · dSF ${DSF} · cpu /${SLOWCPU || 1} · ${ROUNDS} minimizes and ` +
      `${ROUNDS} restores · ${captured} frames`,
  )
  console.log(`  frames inside each flight     ${span}`)
  console.log(`    returned to what it left    ${cameBack}`)
  console.log(`    left what it settled into   ${leftAgain}`)

  // A trace of one flight, so a reader can see the shape the numbers
  // came from rather than take the verdict on faith.
  console.log('\n  one minimize, frame by frame (luma from each reference)')
  for (const s of rounds[0].cut)
    console.log(`    rest ${s.rest.toFixed(1).padStart(6)}   gone ${s.gone.toFixed(1).padStart(6)}`)

  if (missed)
    problems.push(
      `${missed} of ${rounds.length} flights never showed the rectangle changing — the capture missed ` +
        `them, so a clean result would not mean much`,
    )
  if (cameBack)
    problems.push(
      `on ${cameBack} frames the rectangle went back to the state the flight had left — this is the ` +
        `flicker, and it is in the composited output`,
    )
  if (leftAgain)
    problems.push(
      `on ${leftAgain} frames the rectangle reached its settled state and then stopped being it — one ` +
        `renderer let go before the other took hold`,
    )

  console.log(`\nrest-blink: ${problems.length === 0 ? 'PASS — the window leaves once and stays gone' : 'FAIL'}`)
  for (const p of problems) console.log(`  ${p}`)
  process.exit(problems.length === 0 ? 0 : 1)
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
