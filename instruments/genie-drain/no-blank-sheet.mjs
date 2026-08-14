// no-blank-sheet — may a sheet be drawn before it has pixels?
//
// The Driver states the law itself (Genie.tsx, the wall above the clock
// branch): until the texture has real pixels the page copy is still the
// visible truth, and "a grab is allowed to track anyway: the sheet is
// invisible, and the first painted frame then appears already in the
// hand." That second clause was an assumption, not a mechanism. Nothing
// held the sheet back — a grab mounted the Surface and the mesh drew on
// the very next frame, with whatever the freshly allocated texture held,
// which is nothing. For the ~80ms until the first upload landed, an
// opaque blank rectangle sat on top of a window that was still perfectly
// alive underneath it.
//
// It survived a long time because the window's contents were STATIC. A
// blank flash between two identical still frames is nearly invisible;
// the eye has no motion signal to lose. The moment the window carried
// something moving, the same defect became a teleport: the shapes vanish,
// the flash destroys smooth pursuit, and they reappear displaced, while
// the type around them looks untouched. The bug reads as "the shapes
// change position" and lives nowhere near the shapes.
//
// So this measures the one thing a screenshot pair cannot: INK, in every
// composited frame across both handoffs. The measure is a DENSITY —
// dark pixels per pixel of sheet — because a sheet mid-pour is honestly
// smaller, and only a scale-free ratio can tell "narrowing" from "empty".
// A blank sheet is the one shape that is large and lightless at once.
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

// Luma cuts. The bench reads ~216 and the window's own stock ~239, so
// "brighter than 228 inside the band" is the sheet's footprint and
// nothing else. Type sits far below 120. The painted drop shadow lands
// between the two (~157 over bench) and so counts as neither — it rides
// along in both the reference and the flight, and cancels out of the
// ratio. Whether it rides along AT ALL is a different question, asked by
// shadow-travels.mjs.
const LIGHT = 228
const DARK = 120
// Only frames showing a substantial sheet are judged: below this the
// sheet is genuinely a sliver at the dock mouth and carries no legible
// type, which is the pour working, not a defect.
const MIN_FOOTPRINT = 0.15
// The floor separates BLANK from STRETCHED, and those two are much
// further apart than they sound. A mid-pour sheet is a funnel: all of the
// window's type packs into a band across its top while the flank below
// spreads out empty, so most of its footprint is honestly lightless. That
// bottoms out at 21% of resting density on a restore (57% on a minimize,
// which never pours as deep) — while a sheet drawn before its first
// upload measures exactly 0%, because it has no pixels at all rather than
// few. 12% sits with clear air on both sides of that gap.
const FLOOR = 0.12

let server, browser
const deadline = setTimeout(() => {
  console.error('no-blank-sheet: hard 180s deadline hit')
  process.exit(1)
}, 180_000)

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
      document.querySelector('.gen-sheet[data-win="scheda"] .gen-window') &&
      document.fonts.status === 'loaded',
    { timeout: 15_000 },
  )
  await sleep(2000)

  // The corridor: everything the scheda window or its sheet can ever
  // occupy on the way to its bay, and nothing else — measured, not
  // guessed, because the desk now holds four windows and a band written
  // as four numbers would quietly start including one of them after any
  // layout change.
  //
  // That the corridor CAN be clear is a fact about the desk's
  // arrangement, not a law, so it is checked rather than trusted: a
  // second window inside the band would lend this measurement its own
  // ink and footprint, and the density would stop meaning what the whole
  // instrument reads it as meaning. The failure would look like a pass.
  const BAND = await page.evaluate(() => {
    const box = (sel) => {
      const b = document.querySelector(sel).getBoundingClientRect()
      return { x0: b.left, x1: b.right, y0: b.top, y1: b.bottom }
    }
    const sheet = box('.gen-sheet[data-win="scheda"]')
    const bay = box('.gen-tile[data-win="scheda"]')
    const band = {
      x0: Math.floor(Math.min(sheet.x0, bay.x0)),
      x1: Math.ceil(Math.max(sheet.x1, bay.x1)),
      y0: Math.floor(sheet.y0),
      y1: Math.ceil(bay.y1),
    }
    const intruders = []
    for (const el of document.querySelectorAll('.gen-sheet:not([data-win="scheda"])')) {
      const b = el.getBoundingClientRect()
      if (b.left < band.x1 && b.right > band.x0 && b.top < band.y1 && b.bottom > band.y0)
        intruders.push(el.dataset.win)
    }
    return { ...band, intruders }
  })
  console.log(
    `  corridor  x ${BAND.x0}..${BAND.x1}  y ${BAND.y0}..${BAND.y1}` +
      `${BAND.intruders.length ? `  INTRUDERS: ${BAND.intruders.join(', ')}` : ''}`,
  )
  if (BAND.intruders.length)
    problems.push(
      `${BAND.intruders.join(' and ')} sit inside the scheda window's corridor — ` +
        `their ink and their sheet would be counted as the flying sheet's own`,
    )

  const client = await page.createCDPSession()
  let frames = []
  client.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
    frames.push({ data, ts: metadata.timestamp })
    try {
      await client.send('Page.screencastFrameAck', { sessionId })
    } catch {
      /* the cast is already stopped */
    }
  })

  const centreOf = (sel) =>
    page.evaluate((s) => {
      const b = document.querySelector(s).getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    }, sel)

  const measure = async () =>
    page.evaluate(
      async (list, band, light, dark) => {
        const out = []
        for (const b64 of list) {
          const img = new Image()
          img.src = 'data:image/jpeg;base64,' + b64
          await img.decode()
          const c = new OffscreenCanvas(img.width, img.height)
          const ctx = c.getContext('2d')
          ctx.drawImage(img, 0, 0)
          const { data: d, width } = ctx.getImageData(0, 0, img.width, img.height)
          let ink = 0
          let sheet = 0
          for (let y = band.y0; y < band.y1; y++) {
            for (let x = band.x0; x < band.x1; x++) {
              const i = (y * width + x) * 4
              // Rec. 601 luma, stable enough under the cast's jpeg
              // quantisation at these thresholds.
              const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
              if (l < dark) ink++
              else if (l > light) sheet++
            }
          }
          // Type sits ON the sheet, so it belongs to the footprint it
          // darkens — otherwise a denser sheet would appear smaller.
          out.push({ ink, sheet: sheet + ink })
        }
        return out
      },
      list,
      BAND,
      LIGHT,
      DARK,
    )

  // Bound to the closure above; assigned per leg so `measure` stays a
  // plain reader of whatever the cast just collected.
  let list = []

  // `ref` is what a WHOLE window is worth. The minimize leg can read that
  // off its own pre-gesture frames; the restore leg cannot, because at
  // rest its window is a filled tile 500px away. So the reference travels
  // from the first leg to the second rather than being re-derived from a
  // desk that has nothing on it.
  const leg = async (name, gesture, ref) => {
    frames = []
    await client.send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 })
    // Frames before the gesture establish what a whole sheet is worth.
    await sleep(250)
    const t0 = frames.length ? frames[frames.length - 1].ts : 0
    await gesture()
    await sleep(150)
    await client.send('Page.stopScreencast')

    list = frames.map((f) => f.data)
    const read = await measure()
    const rest = []
    const watched = []
    for (let i = 0; i < frames.length; i++) {
      const ms = (frames[i].ts - t0) * 1000
      if (ms < 0) rest.push(read[i])
      else watched.push({ ms: Math.round(ms), ...read[i] })
    }
    // Median, not mean: one frame caught mid-swap must not drag the
    // reference toward the very emptiness being tested for.
    const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
    const fullSheet = ref ? ref.sheet : med(rest.map((r) => r.sheet))
    const fullInk = ref ? ref.ink : med(rest.map((r) => r.ink))
    const restDensity = fullSheet ? fullInk / fullSheet : 0

    const judged = watched.filter((w) => w.sheet > fullSheet * MIN_FOOTPRINT)
    const worst = judged.reduce(
      (a, b) => (b.ink / b.sheet < a.ink / a.sheet ? b : a),
      { ms: -1, ink: 1, sheet: 1 },
    )
    const worstDensity = worst.ink / worst.sheet

    console.log(`\n  ${name}`)
    console.log(`    reference sheet              ${fullSheet}px carrying ${fullInk}px of ink`)
    console.log(`    frames judged                ${judged.length} of ${watched.length}`)
    console.log(
      `    emptiest sheet on screen     ${((worstDensity / restDensity) * 100).toFixed(0)}% of resting ink density, at +${worst.ms}ms`,
    )

    // The frame this leg was judged on, written out on request. A ratio
    // is only worth as much as knowing what it looked at.
    if (process.env.DUMP && worst.ms >= 0) {
      const { writeFileSync, mkdirSync } = await import('node:fs')
      const dir = path.join('/Users/petepetrash/Code/munari', 'instruments/genie-drain/out')
      mkdirSync(dir, { recursive: true })
      const at = frames.find((f) => Math.round((f.ts - t0) * 1000) === worst.ms)
      if (at)
        writeFileSync(
          path.join(dir, `worst-${name.replace(/\s+/g, '-')}.jpg`),
          Buffer.from(at.data, 'base64'),
        )
    }

    if (!fullSheet) problems.push(`${name}: found no sheet at all — the band is looking at the wrong place`)
    else if (!judged.length) problems.push(`${name}: no frame showed a substantial sheet — nothing was judged`)
    else if (worstDensity < restDensity * FLOOR)
      problems.push(
        `${name}: a full-size sheet carried only ${((worstDensity / restDensity) * 100).toFixed(0)}% ` +
          `of its resting ink at +${worst.ms}ms — it took the pixels into its hold before its texture had any`,
      )
    return { sheet: fullSheet, ink: fullInk }
  }

  const bar = await centreOf('.gen-sheet[data-win="scheda"] .gen-titlebar')
  const whole = await leg('minimize by hand', async () => {
    await page.mouse.move(bar.x + 100, bar.y)
    await page.mouse.down()
    // Human-paced: many small steps, so the claim lands mid-gesture
    // rather than as one jump the scene could special-case.
    for (let i = 1; i <= 26; i++) {
      await page.mouse.move(bar.x + 100, bar.y + i * 4)
      await sleep(16)
    }
    await page.mouse.up()
  })

  // Park it, so the restore leg starts from a real dock.
  await page.mouse.click(bar.x - 40, bar.y)
  const lamp = await centreOf('.gen-sheet[data-win="scheda"] .gen-lamp[data-role="minimize"]')
  await page.mouse.click(lamp.x, lamp.y)
  await page.waitForFunction(
    () => document.querySelector('.gen-tile[data-win="scheda"]')?.dataset.filled === 'true',
    { timeout: 8000 },
  )
  await sleep(500)

  const tile = await centreOf('.gen-tile[data-win="scheda"]')
  await leg(
    'restore by hand',
    async () => {
      await page.mouse.move(tile.x, tile.y)
      await page.mouse.down()
      for (let i = 1; i <= 26; i++) {
        await page.mouse.move(tile.x, tile.y - i * 7)
        await sleep(16)
      }
      await page.mouse.up()
    },
    whole,
  )

  console.log(
    `\nno-blank-sheet: ${problems.length === 0 ? 'PASS — neither swap draws a sheet before it has pixels' : 'FAIL'}`,
  )
  for (const p of problems) console.log(`  ${p}`)
  process.exit(problems.length === 0 ? 0 : 1)
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
