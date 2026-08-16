// shadow-travels — does the window's shadow go with it?
//
// The scene draws its drop shadow as a filled rectangle INSIDE the
// capture root, offset down-right with no blur, rather than as a
// `box-shadow` on the window. That is not a style preference. A
// box-shadow is painted outside the border box, which is outside
// everything drawElementImage captures — so a window wearing one would
// look identical at rest and then take off out of its own shadow,
// leaving a grey rectangle lying on the desk with nothing above it.
//
// The two spellings are one CSS line apart and identical in every
// screenshot of a window standing still, which is precisely why this
// exists: the difference is only ever visible in the air.
//
// WHERE it looks is the whole design. A first attempt counted every
// pixel at the shadow's luma inside the flight corridor, and the number
// turned out to be mostly TYPE: the DOM copy's glyphs get subpixel
// antialiasing and the texture's get grayscale, so thousands of edge
// pixels cross that band on the way through the swap and swamp the few
// thousand the shadow contributes. The measurement moved instead of the
// threshold. This reads one strip — the column immediately right of the
// window's border, exactly as wide as the drop, which the shadow
// occupies and nothing else can — against a bench control the same size
// a little further out.
//
// And it reads them EARLY, while t is still ~0, where the sheet stands
// exactly where the window stood: the strip is then the same pixels in
// both custodies and the comparison is direct.
//
// ── and then it stops being the same texture ────────────────────────────
//
// "A shadow that is in the texture at t = 0 is in it for the rest of the
// flight, because it is the same texture" is what this file used to say,
// and it is no longer true. The shade is now faded per-fragment by how
// hard the funnel is squeezing the row it sits on (genieShaders.ts), so
// the second leg below is the other half of the claim: the shadow is
// whole where the sheet is still broad, and gone where the sheet has
// been squeezed past the width at which a drop offset can be a shadow
// at all. Both halves must hold IN THE SAME FRAME — that is what makes
// it a fade on compression rather than a fade on the clock, and a fade
// on the clock is the plausible wrong implementation this leg exists to
// reject.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const labRoot = path.join(repoRoot, 'apps', 'lab')
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
  .filter(Boolean)
  .find((p) => existsSync(p))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The window that has taken off is judged over this stretch, in ms after
// the last resting frame. It opens after the swap is known to have
// happened (asserted below, not assumed) and closes while the 6x flight
// has still barely moved — at +650ms of it, easeInCubic has spent under
// 2% of the journey.
const FROM = 200
const TO = 650
// The first transfer frames are a separate concern from whether the shadow
// travels. The old presenter and the renderer can briefly occupy the same
// pixels while the handoff happens; an opaque window hides that overlap, but two
// translucent shadows compound into a dark flash. Read that boundary too.
const BOUNDARY_TO = FROM
// The strip must stay nearer the shadow than the bench for every frame
// in that stretch. Halfway is the only non-arbitrary line between two
// measured grounds, and a strip that lost its shadow does not land near
// it — it lands on the bench exactly.
const MIDPOINT = 0.5
// Quality-90 screencast blocks move this flat strip by one or two luma. Six
// leaves that noise room while catching even a quarter of the measured
// 30-luma shadow compounding with itself (the bug measured a 24-luma pulse).
const TRANSFER_LUMA_TOLERANCE = 6

let server, browser
const deadline = setTimeout(() => {
  console.error('shadow-travels: hard 150s deadline hit')
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
      document.querySelector('.gen-sheet[data-win="scheda"] .gen-window') &&
      document.fonts.status === 'loaded',
    { timeout: 15_000 },
  )
  await sleep(1500)

  // The strip, and its control, both derived from the live boxes: the
  // drop is however much wider the capture root is than the window it
  // holds, so the geometry is never restated as a number here.
  const GEO = await page.evaluate(() => {
    const sheet = document.querySelector('.gen-sheet[data-win="scheda"]').getBoundingClientRect()
    const win = document
      .querySelector('.gen-sheet[data-win="scheda"] .gen-window')
      .getBoundingClientRect()
    const drop = Math.round(sheet.right - win.right)
    const strip = {
      x0: Math.round(win.right),
      x1: Math.round(win.right) + drop,
      // Skip the top `drop` rows: that corner is the one part of the
      // column the offset leaves empty.
      y0: Math.round(win.top) + drop,
      y1: Math.round(win.bottom),
    }
    // Far enough out to clear the shadow and any antialiasing on its
    // edge, and the same size so the two medians are comparable.
    const control = { ...strip, x0: strip.x1 + 8, x1: strip.x1 + 8 + drop }
    const clear = []
    for (const el of document.querySelectorAll('.gen-sheet:not([data-win="scheda"])')) {
      const b = el.getBoundingClientRect()
      for (const [name, r] of [['strip', strip], ['control', control]])
        if (b.left < r.x1 && b.right > r.x0 && b.top < r.y1 && b.bottom > r.y0)
          clear.push(`${el.dataset.win} overlaps the ${name}`)
    }
    if (control.x1 > innerWidth) clear.push('the control strip is off the right of the viewport')
    return { drop, strip, control, clear }
  })
  console.log(
    `  drop ${GEO.drop}px   strip x ${GEO.strip.x0}..${GEO.strip.x1}   control x ${GEO.control.x0}..${GEO.control.x1}   y ${GEO.strip.y0}..${GEO.strip.y1}`,
  )
  for (const c of GEO.clear) problems.push(c)

  const client = await page.createCDPSession()
  const frames = []
  client.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
    frames.push({ data, ts: metadata.timestamp })
    try {
      await client.send('Page.screencastFrameAck', { sessionId })
    } catch {
      /* the cast is already stopped */
    }
  })

  await client.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 })
  await sleep(300)
  const t0 = frames.length ? frames[frames.length - 1].ts : 0

  // Shift-click: the 6x slow flight, so the stretch judged below is a
  // long way from the landing and the sheet in it is still square.
  const lamp = await page.evaluate(() => {
    const b = document
      .querySelector('.gen-sheet[data-win="scheda"] .gen-lamp[data-role="minimize"]')
      .getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
  })
  await page.keyboard.down('Shift')
  await page.mouse.click(lamp.x, lamp.y)
  await page.keyboard.up('Shift')

  // The guard that keeps this from passing on a scene that never took
  // off: if the page copy is still on the desk, the strip below is the
  // DOM's shadow and proves nothing about the texture.
  await sleep(FROM)
  const swapped = await page.evaluate(
    () => document.querySelector('.gen-slot[data-win="scheda"]').dataset.away === 'true',
  )
  await sleep(TO - FROM + 200)
  await client.send('Page.stopScreencast')
  if (!swapped)
    problems.push(
      `the page copy was still visible ${FROM}ms in — the strip was reading the DOM's own shadow`,
    )

  const readStrips = (captured) =>
    page.evaluate(
      async (list, strip, control) => {
        const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0
        return Promise.all(
          list.map(async (b64) => {
            const img = new Image()
            img.src = 'data:image/jpeg;base64,' + b64
            await img.decode()
            const c = new OffscreenCanvas(img.width, img.height)
            const ctx = c.getContext('2d')
            ctx.drawImage(img, 0, 0)
            const { data: d, width } = ctx.getImageData(0, 0, img.width, img.height)
            const lumas = (r) => {
              const xs = []
              for (let y = r.y0; y < r.y1; y++)
                for (let x = r.x0; x < r.x1; x++) {
                  const i = (y * width + x) * 4
                  xs.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
                }
              return xs
            }
            // Median, not mean: the cast's jpeg blocks put a few outliers on
            // either edge of a 7px column, and one of them must not decide
            // whether a shadow is there.
            return { strip: median(lumas(strip)), control: median(lumas(control)) }
          }),
        )
      },
      captured.map((f) => f.data),
      GEO.strip,
      GEO.control,
    )

  const read = await readStrips(frames)

  const rest = []
  const boundary = []
  const watched = []
  for (let i = 0; i < frames.length; i++) {
    const ms = (frames[i].ts - t0) * 1000
    if (ms < 0) rest.push(read[i])
    else if (ms < BOUNDARY_TO) boundary.push({ ms: Math.round(ms), ...read[i] })
    else if (ms >= FROM && ms <= TO) watched.push({ ms: Math.round(ms), ...read[i] })
  }
  const med = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0
  const restStrip = med(rest.map((r) => r.strip))
  const restControl = med(rest.map((r) => r.control))
  const line = restStrip + (restControl - restStrip) * MIDPOINT
  const darkestBoundary = boundary.reduce(
    (a, b) => (b.strip < a.strip ? b : a),
    { ms: -1, strip: Number.POSITIVE_INFINITY },
  )
  const palestBoundary = boundary.reduce(
    (a, b) => (b.strip > a.strip ? b : a),
    { ms: -1, strip: Number.NEGATIVE_INFINITY },
  )
  const worst = watched.reduce((a, b) => (b.strip > a.strip ? b : a), { ms: -1, strip: -1 })

  console.log(`  at rest: shadow ${restStrip.toFixed(0)} luma, bench ${restControl.toFixed(0)} luma`)
  console.log(
    `  transfer shadow range        ${darkestBoundary.strip.toFixed(0)}..${palestBoundary.strip.toFixed(0)} luma`,
  )
  console.log(`  frames judged                ${watched.length}`)
  console.log(
    `  palest the strip ever got    ${worst.strip.toFixed(0)} luma at +${worst.ms}ms (line at ${line.toFixed(0)})`,
  )

  if (process.env.DUMP) {
    const { writeFileSync, mkdirSync } = await import('node:fs')
    const dir = path.join(repoRoot, 'instruments/genie-drain/out')
    mkdirSync(dir, { recursive: true })
    const at = frames.find((f) => Math.round((f.ts - t0) * 1000) === worst.ms)
    if (at) writeFileSync(path.join(dir, 'worst-shadow.jpg'), Buffer.from(at.data, 'base64'))
  }

  // The shade is 0.15 over the bench, which is ~29 luma of separation.
  // The midpoint test below only needs the two grounds far enough apart
  // that the cast's jpeg noise cannot carry the strip across half the
  // gap, and half of 29 is ~15 luma — an order above the couple of luma
  // a quality-90 block moves. Pinned at 18 rather than at 29 so that
  // tuning the shade's weight is a design decision and not a test
  // failure; pinned at all because at some weight the shadow stops being
  // visible to a person, and this instrument should say so before Pete
  // has to.
  if (restControl - restStrip < 18)
    problems.push(
      `the resting window's shadow is only ${(restControl - restStrip).toFixed(0)} luma darker than the bench — ` +
        `too faint for this to distinguish a shadow from its absence, and too faint to see`,
    )
  else if (!boundary.length)
    problems.push('no frames fell in the handoff boundary — shadow opacity was not measured')
  else if (restStrip - darkestBoundary.strip > TRANSFER_LUMA_TOLERANCE)
    problems.push(
      `the handoff boundary darkened the shadow from ${restStrip.toFixed(0)} to ` +
        `${darkestBoundary.strip.toFixed(0)} luma — both translucent presenters were composited together`,
    )
  else if (palestBoundary.strip - restStrip > TRANSFER_LUMA_TOLERANCE)
    problems.push(
      `the handoff boundary lightened the shadow from ${restStrip.toFixed(0)} to ` +
        `${palestBoundary.strip.toFixed(0)} luma — neither presenter owned the translucent shadow`,
    )
  else if (!watched.length) problems.push('no frames fell in the judged stretch — nothing was measured')
  else if (worst.strip > line)
    problems.push(
      `the strip beside the airborne sheet read ${worst.strip.toFixed(0)} luma at +${worst.ms}ms, ` +
        `against ${restStrip.toFixed(0)} for the shadow and ${restControl.toFixed(0)} for bare bench — ` +
        `the shadow stayed on the desk, which is what a box-shadow does: it is painted outside the box that gets captured`,
    )

  // ── leg 2: the fade is on compression, not on the clock ───────────────
  //
  // Held open by a hand, so the funnel stands still and one screenshot
  // holds the whole gradient at once. For each row of the sheet we find
  // both edges (scanning in from clear bench on each side) and measure
  // the ink just inside them; the right edge carries the shade and the
  // left carries only the border, so the difference is the shade with
  // its confounds already subtracted.
  //
  // One frame, two answers — the crest still wearing its shadow while
  // the flank below has lost it — which no fade driven by t can produce,
  // because at any single instant such a fade has applied the same
  // factor everywhere.
  await page.waitForFunction(
    () => document.querySelector('.gen-tile[data-win="scheda"]')?.dataset.filled === 'true',
    { timeout: 8000 },
  )
  // Clear the desk first. A row of pixels is scanned in from the right
  // edge of the viewport, and with four windows standing the rightmost
  // thing on a row is very often a DIFFERENT window — the first version
  // of this leg read widths of 465px and 61px on adjacent rows of what
  // is supposed to be a smooth funnel, because it was sampling three
  // sheets and a dock and averaging them. With the others put away, the
  // only thing that is not bench is the sheet under measurement.
  for (const win of ['quadrato', 'cerchio', 'triangolo']) {
    await page.evaluate((w) => {
      document
        .querySelector(`.gen-sheet[data-win="${w}"] .gen-lamp[data-role="minimize"]`)
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }, win)
    await sleep(120)
  }
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.gen-tile')].every((t) => t.dataset.filled === 'true'),
    { timeout: 9000 },
  )
  await sleep(600)
  // Read the reverse handoff too. The renderer approaches the same wall strip
  // from the dock; the native presenter is revealed only when it has arrived.
  // A window around that reveal therefore sees the normal shadow once, or the
  // compounded shadow if both presenters survive into one composition.
  frames.length = 0
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 })
  await page.evaluate(() =>
    document
      .querySelector('.gen-tile[data-win="scheda"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true })),
  )
  await page.waitForFunction(
    () => document.querySelector('.gen-slot[data-win="scheda"]')?.dataset.away !== 'true',
    { timeout: 5000 },
  )
  const revealAt = frames.length
  await sleep(180)
  await client.send('Page.stopScreencast')
  const reverseWindow = frames.slice(Math.max(0, revealAt - 4), revealAt + 7)
  const reverseRead = await readStrips(reverseWindow)
  const darkestReverse = reverseRead.reduce(
    (darkest, sample) => Math.min(darkest, sample.strip),
    Number.POSITIVE_INFINITY,
  )
  const palestReverse = reverseRead.reduce(
    (palest, sample) => Math.max(palest, sample.strip),
    Number.NEGATIVE_INFINITY,
  )
  console.log(
    `  reverse shadow range         ${darkestReverse.toFixed(0)}..${palestReverse.toFixed(0)} luma across ${reverseRead.length} frames`,
  )
  if (!reverseRead.length)
    problems.push('no compositor frames covered the reverse handoff boundary')
  else if (restStrip - darkestReverse > TRANSFER_LUMA_TOLERANCE)
    problems.push(
      `the reverse handoff boundary darkened the shadow from ${restStrip.toFixed(0)} to ` +
        `${darkestReverse.toFixed(0)} luma — both translucent presenters were composited together`,
    )
  else if (palestReverse - restStrip > TRANSFER_LUMA_TOLERANCE)
    problems.push(
      `the reverse handoff boundary lightened the shadow from ${restStrip.toFixed(0)} to ` +
        `${palestReverse.toFixed(0)} luma — neither presenter owned the translucent shadow`,
    )
  await sleep(500)

  const bar = await page.evaluate(() => {
    const b = document
      .querySelector('.gen-sheet[data-win="scheda"] .gen-titlebar')
      .getBoundingClientRect()
    const dock = document.querySelector('.gen-tile[data-win="scheda"]').getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, top: b.top, dock: dock.top }
  })
  // Far enough down that the funnel has a real neck to read, and no
  // further. A shallow pull leaves the whole sheet within a few percent
  // of full width, so "broad" and "necked" name the same rows; a deep
  // one drains it almost into the mouth, leaving a hundred pixels of
  // sheet and no gradient at all. Just under half is where the funnel
  // spans the most screen.
  const pull = (bar.dock - bar.y) * 0.42
  await page.mouse.move(bar.x, bar.y)
  await page.mouse.down()
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(bar.x, bar.y + (pull * i) / 20)
    await sleep(16)
  }
  await sleep(700) // the drive settles; the funnel stops moving

  const held = await page.screenshot({ encoding: 'base64' })
  if (process.env.DUMP) {
    const { writeFileSync, mkdirSync } = await import('node:fs')
    const dir = path.join(repoRoot, 'instruments/genie-drain/out')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'held-funnel.png'), Buffer.from(held, 'base64'))
  }
  const profile = await page.evaluate(
    async (b64, y0, yEnd, drop) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + b64
      await img.decode()
      const c = new OffscreenCanvas(img.width, img.height)
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const { data: d, width, height } = ctx.getImageData(0, 0, img.width, img.height)
      const lum = (x, y) => {
        const i = (y * width + x) * 4
        return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      }
      // Left of this is the lab's own scene menu — a column of bright
      // panels in dark rules that answers every test the sheet answers,
      // and which this leg spent a run measuring instead. The sheet
      // never goes near it: it starts right of centre and drains toward
      // a dock that is right of centre too.
      const X_MIN = 200

      // The tile's period, asked of the desk rather than written down
      // here — the pattern is the scene's to change, and an instrument
      // holding its own copy of a scene constant is a second source of
      // truth that goes stale silently. A desk with no pattern answers
      // nothing and P falls to 1, which is one residue class: the scalar
      // ground this leg used before there was a surface, exactly.
      const P =
        parseFloat(getComputedStyle(document.querySelector('.gen-page')).getPropertyValue('--tile'))
        || 1

      // The ground is read, not named — the same discipline mouth-anchor
      // learned when the dock's tray went away and a hard-coded luma
      // matched nothing. Read as the MEDIAN of the scan region rather
      // than off a patch, because every patch is a bet on where the
      // furniture is: the first spelling sampled x 2..22 and, at these
      // y's, that is the scene menu's own border. The bench is the
      // majority of this region by a wide margin at every point in the
      // drain — the funnel is at most half of it at the top row and a
      // sliver by the mouth — so the middle value IS the desk, with
      // nothing to place by hand.
      //
      // And it is a SURFACE, not a number. The desk carries a tiled
      // pattern, so "the bench" is P×P different lumas depending on
      // where in the tile a pixel falls — a 23-luma bevel against an
      // edge test that fires at 6, which means a scalar ground finds the
      // desk's own rules and calls them the sheet. It did: every row
      // came back the full width of the scan region.
      //
      // So the median is taken per RESIDUE CLASS. Each pixel is compared
      // against what the bench does at its own phase in the tile, which
      // is a strictly better question than the old one and reduces to it
      // exactly — on a flat desk all P² classes hold the same value and
      // every number this leg pins is unmoved. The classes are read off
      // the frame rather than computed from the tokens for the reason
      // the scalar was: what the compositor actually put on screen is
      // the only ground that can be wrong in the same direction as the
      // pixels being measured.
      //
      // The median survives the sheet lying across the region because it
      // survives anything that is a minority of its own class, and the
      // funnel covers the classes evenly — it is a shape on the desk,
      // not a comb aligned to the tile.
      const cls = Array.from({ length: P * P }, () => [])
      for (let y = y0; y < Math.min(yEnd, height - 2); y += 2)
        for (let x = X_MIN; x < width - 2; x++) cls[(y % P) * P + (x % P)].push(lum(x, y))
      const tile = cls.map((a) => {
        a.sort((p, q) => p - q)
        return a[a.length >> 1]
      })
      const groundAt = (x, y) => tile[(((y % P) + P) % P) * P + (((x % P) + P) % P)]
      // One number for the log and for leg 2's report: the desk's middle
      // tone, which on a patterned bench is the field between the rules.
      const flat = [...tile].sort((a, b) => a - b)
      const ground = flat[flat.length >> 1]

      // Ink, not width. A dark RUN at the neck is mostly the resampled
      // edge itself — bilinear filtering ramps from bench to window
      // stock over two or three pixels whatever is or is not painted
      // there — so counting pixels under a threshold measures
      // antialiasing and calls it a shadow. Summing how far each pixel
      // falls below the bench measures the ink that is actually present.
      //
      // And it is taken on BOTH edges, because the shade is on the right
      // and the bottom only. The left edge carries the window's border
      // and the same resampling and nothing else, so right minus left is
      // the shade with every confound already subtracted — no threshold
      // has to be right for that difference to mean what it says.
      // Over a FIXED span inward from the edge, with no early exit. The
      // first spelling walked until it met a pixel brighter than the
      // bench, on the reasoning that brighter means "inside the sheet,
      // past the shade" — and the outermost pixel of a minified edge is
      // a blend of bench and window stock, which is brighter than the
      // bench. So the walk stopped before it had counted anything and
      // reported zero ink at every necked row, in both the working case
      // and the broken one. The span is the drop plus a little: wide
      // enough to hold the shade and the border behind it at full size,
      // and at every smaller size, since the whole L only shrinks.
      //
      // Each pixel is weighed against its OWN class, and that is not
      // merely tolerance of the pattern — it very nearly cancels it. The
      // shade is translucent, so it scales whatever is beneath it: over
      // a cut it lands ~28 below the cut, over the field ~29 below the
      // field, over a lit lip ~31 below the lip. Subtracting the local
      // ground turns a ±12 swing in the background into a ±2 swing in
      // the answer, which is why the ink table pinned in Genie.tsx still
      // reads the same on a desk that now has a surface.
      const span = drop + 3
      const inkFrom = (x, y, step) => {
        let ink = 0
        for (let n = 0; n < span; n++, x += step) {
          if (x < 2 || x > width - 2) break
          ink += Math.max(0, groundAt(x, y) - lum(x, y))
        }
        return ink
      }

      const rows = []
      // Every row, not every third. The flank is the steep part of an
      // S — on a deeper pose the funnel can cross the whole band between
      // two sampled rows, and a leg that measures nothing reports
      // nothing. One screenshot either way; the loop is the cheap part.
      for (let y = y0 + 6; y < Math.min(yEnd, height - 2); y += 1) {
        // Both edges are found by walking IN from clear bench — the
        // right one leftward, the left one rightward. The first spelling
        // found the left edge by starting at the right edge and walking
        // through the sheet until the luma came back to bench, which
        // ends at the first interior pixel that happens to sit near it:
        // on the row through the text field it reported an 81px row of a
        // funnel that is 455px wide there, and the ink either side of
        // that phantom edge was the field's own border. Outside the
        // sheet there is nothing but desk, so approaching from outside
        // cannot be fooled by what the window contains.
        let r = width - 2
        while (r > X_MIN && Math.abs(lum(r, y) - groundAt(r, y)) < 6) r--
        if (r <= X_MIN) continue
        let l = X_MIN
        while (l < r && Math.abs(lum(l, y) - groundAt(l, y)) < 6) l++
        const w = r - l
        if (w < 2 * span) continue // too narrow to read two edges without overlap
        // Is this the SHEET, or something else that is not bench? The
        // page carries headings and labels, and the dock's filled bays
        // are darker than the bench too — the first version of this leg
        // measured all of them, reported a widest row of 241px on a
        // 465px window, and read identical ink off both edges because
        // it was scanning glyphs. The sheet is window stock, which is
        // the one thing on this desk BRIGHTER than the bench, so an
        // interior that is not bright is not the sheet.
        let bright = 0
        for (let n = 1; n <= 5; n++) {
          const x = Math.round(l + (w * n) / 6)
          if (lum(x, y) > groundAt(x, y) + 8) bright++
        }
        if (bright < 4) continue
        rows.push({ y, w, right: inkFrom(r, y, -1), left: inkFrom(l + 1, y, +1) })
      }
      const widest = rows.reduce((a, b) => (b.w > a.w ? b : a), { w: 0 })
      return { ground: Math.round(ground), rows, widest, drop }
    },
    held,
    Math.round(bar.top),
    // Stop above the dock. The bays are the one other thing on a cleared
    // desk that a row can run into, and a filled one is dark by design.
    Math.round(bar.dock) - 6,
    GEO.drop,
  )
  await page.mouse.up()

  // Rows are classified by how wide they are relative to the widest row
  // on screen, which is the sheet's own top — so this needs no knowledge
  // of where the hand left the funnel.
  //
  // WHERE the two bands sit is the whole leg, and the first choice was
  // wrong. "Broad" against "the neck" reads the same profile whether the
  // fade runs or not, because by the neck the GPU has already averaged
  // the band away against the margin beside it — both cases measure
  // zero and the contract passes on the defect it exists to catch. The
  // bands below are placed off the measured dissolution instead: the
  // crest is where the shade is whole and must stay whole, and the flank
  // is the one stretch that still carries real ink for a fade to remove.
  const scale = (r) => r.w / profile.widest.w
  const crest = profile.rows.filter((r) => scale(r) > 0.92)
  const flank = profile.rows.filter((r) => scale(r) >= 0.55 && scale(r) <= 0.75)
  // Per unit of the row's own scale. An unfaded shade minifies WITH the
  // sheet, so its ink falls in exact proportion to the row's width —
  // which means the raw number drops at the neck whether the fade is
  // working or not, and only the normalised one can tell the two apart.
  // Divided through, an unfaded shade reads the same at the neck as at
  // the top, and a faded one reads zero.
  //
  // Sum over sum, not the mean of the per-row ratios: dividing a row by
  // its own scale multiplies it by eleven down at the mouth, so a mean
  // of ratios lets one stray pixel on the narrowest row outvote every
  // other row in the band. Pooling the ink and pooling the scale gives
  // the same quantity with each row weighted by how much of it there is
  // to measure.
  const shade = (rs) =>
    rs.length
      ? rs.reduce((a, r) => a + (r.right - r.left), 0) /
        rs.reduce((a, r) => a + r.w / profile.widest.w, 0)
      : null
  const crestShade = shade(crest)
  const flankShade = shade(flank)

  console.log('\n  the funnel held open by a hand, one frame')
  console.log(`    rows read                    ${profile.rows.length} (widest ${profile.widest.w}px)`)
  // A few rows down the funnel, so a failure above can be read rather
  // than re-derived: the profile IS the evidence, and a mean hides where
  // in the sheet it went wrong.
  const every = process.env.ROWS ? 1 : Math.max(1, Math.floor(profile.rows.length / 8))
  console.log('      y     width   right ink   left ink   shade')
  for (let i = 0; i < profile.rows.length; i += every) {
    const r = profile.rows[i]
    console.log(
      `      ${String(r.y).padStart(4)}  ${String(r.w).padStart(5)}px  ${r.right.toFixed(0).padStart(9)}  ${r.left.toFixed(0).padStart(9)}  ${(r.right - r.left).toFixed(0).padStart(6)}`,
    )
  }
  console.log(
    `    crest rows (>92% of widest)  ${crest.length}, shade ink ${crestShade === null ? '—' : crestShade.toFixed(0)}`,
  )
  console.log(
    `    flank rows (55–75%)          ${flank.length}, shade ink ${flankShade === null ? '—' : flankShade.toFixed(0)}`,
  )

  if (!crest.length || !flank.length)
    problems.push(
      `the held funnel gave ${crest.length} crest and ${flank.length} flank rows — the drag did not produce a gradient to measure`,
    )
  else {
    if (crestShade < 60)
      problems.push(
        `the crest of the funnel carries ${crestShade.toFixed(0)} of shade ink against a ${profile.drop}px drop — ` +
          `the shade is fading where the sheet is still full width, which is what a fade driven by t does: at any ` +
          `one instant such a fade has applied the same factor to every row, so it cannot take the flank without the crest`,
      )
    else if (flankShade > crestShade * 0.2)
      problems.push(
        `the flank carries ${flankShade.toFixed(0)} of shade ink to the crest's ${crestShade.toFixed(0)} — ` +
          `scaled for the squeeze that is still the same shadow, so it is being minified rather than faded, and a ` +
          `${profile.drop}px drop at that compression is not a shadow but a haze down one edge of the funnel`,
      )
  }

  console.log(
    `\nshadow-travels: ${problems.length === 0 ? 'PASS — the handoff keeps one shadow, which travels with the sheet and leaves when squeezed' : 'FAIL'}`,
  )
  for (const p of problems) console.log(`  ${p}`)
  process.exit(problems.length === 0 ? 0 : 1)
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
