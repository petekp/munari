// mouth-anchor — does the drawn mouth still equal the poured mouth?
//
// Four things have to agree, and only one of them is visible in a
// screenshot. The law pours into a mouth of 2 × slotHalf, taken from
// this box at press time and scaled each frame by the bay's swell; the
// bay draws that mouth as a seam across its top edge; dockY is the bay's
// top edge, which must not move while the bay grows (hence the
// top-centre transform-origin); and the sheet that comes out has to be
// the width of the thing it comes out of. So: the seam spans the icon's
// FULL width in both states, the top edge is pinned, and the sheet
// matches the bay in pixels.
//
// That last leg exists because the first three all passed while the
// restore was pouring out of a mouth a third too wide. The swell is a
// TRANSFORM, so it is inside getBoundingClientRect and outside
// offsetWidth — and a restore takes off from a bay that is already
// holding a window and therefore already swollen. Measured through the
// rect, that swell was read into slotHalf and then applied again every
// frame. The minimize direction was unaffected and looked perfect,
// because a bay at rest has no transform for a rect to pick up: one
// expression, right in one direction and 1.33x wrong in the other.
//
// Cheap to check, impossible to eyeball: a 10px error in a 52px seam
// hides comfortably inside a screenshot of a tile this size.
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
const MOUTH = 52 // .gen-tile's box: the resting mouth IS the icon's width

let server, browser
const deadline = setTimeout(() => {
  console.error('mouth-anchor: hard 120s deadline hit')
  process.exit(1)
}, 120_000)

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
    () => document.querySelector('.gen-sheet[data-win="scheda"] .gen-window') && document.fonts.status === 'loaded',
    { timeout: 15_000 },
  )
  await sleep(400)

  // The seam is a pseudo-element: no getBoundingClientRect, so read its
  // used width and its own counter-transform and compose them the way
  // the compositor does.
  const read = () =>
    page.evaluate(() => {
      const tile = document.querySelector('.gen-tile[data-win="scheda"]')
      const box = tile.getBoundingClientRect()
      const cs = getComputedStyle(tile, '::before')
      const parent = new DOMMatrix(getComputedStyle(tile).transform)
      const own = new DOMMatrix(cs.transform)
      return {
        top: Math.round(box.top * 100) / 100,
        width: Math.round(box.width * 100) / 100,
        // The border box before any transform — the mouth the law means,
        // and the only width a press may take slotHalf from.
        offset: tile.offsetWidth,
        cx: Math.round(box.left + box.width / 2),
        parentSx: Math.round(parent.m11 * 1000) / 1000,
        // Rendered seam = its laid-out width, scaled by its own counter
        // transform, then by the bay it lives inside.
        seam: Math.round(parseFloat(cs.width) * own.m11 * parent.m11 * 100) / 100,
        // How much of the bay's mark is showing. This used to read
        // `fill`, because the mark used to be transparent until the
        // window landed and signal after — a light. It is a gauge now:
        // signal at every level, with a clip driven by --pour that
        // uncovers it from the bottom as the window pours in, so `fill`
        // is the one thing about it that no longer moves.
        //
        // The resolved CLIP is read, not the --pour it came from. A
        // custom property nothing consumes still counts up perfectly,
        // and this leg's job is that the bay LOOKS different holding a
        // window than empty. How faithfully the level tracks the drive
        // in between is four-windows' leg 6, which watches it rise under
        // a hand rather than at the two ends.
        paneClip: getComputedStyle(document.querySelector('.gen-tile[data-win="scheda"] .gen-pane'))
          .clipPath,
      }
    })

  const at = { x: 0, y: 0 }
  const lamp = await page.evaluate(() => {
    const b = document.querySelector('.gen-sheet[data-win="scheda"] .gen-lamp[data-role="minimize"]').getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
  })

  const rest = await read()
  await page.mouse.click(lamp.x, lamp.y)
  await page.waitForFunction(
    () => document.querySelector('.gen-tile[data-win="scheda"]').dataset.filled === 'true',
    { timeout: 8000 },
  )
  await sleep(700) // let the ring die so the reading is the resting swell
  const docked = await read()
  void at

  const rows = [
    ['bay top / mouth y', rest.top, docked.top],
    ['bay width (rect)', rest.width, docked.width],
    ['bay width (untransformed)', rest.offset, docked.offset],
    ['bay scale', rest.parentSx, docked.parentSx],
    ['drawn seam width', rest.seam, docked.seam],
  ]
  console.log('\n                             rest      docked')
  for (const [name, a, b] of rows)
    console.log(`  ${name.padEnd(25)} ${String(a).padStart(8)}  ${String(b).padStart(8)}`)
  console.log(`\n  the bay's mark: rest ${rest.paneClip} → docked ${docked.paneClip}`)

  // ── the sheet against the bay ─────────────────────────────────────────
  //
  // A restore is where this is measurable: t starts at 1, so the sheet
  // spends the opening of the flight standing IN the mouth, and one row
  // just above the bay's top edge crosses both the sheet and nothing
  // else. (A minimize only reaches the mouth in the frame it lands, and
  // then unmounts.) 6px up is far enough to clear the seam and the bay's
  // own border, near enough that the funnel's flare is still small.
  const UP = 6
  await page.evaluate(() =>
    document
      .querySelector('.gen-tile[data-win="scheda"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })),
  )
  await sleep(1400)
  const live = await read()
  const shot = await page.screenshot({ encoding: 'base64' })
  const span = await page.evaluate(
    async (b64, y, cx) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + b64
      await img.decode()
      const c = new OffscreenCanvas(img.width, img.height)
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const { data: d, width } = ctx.getImageData(0, 0, img.width, img.height)
      const lum = (x) => {
        const i = (y * width + x) * 4
        return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      }
      // The sheet is window stock inside a hard border, so anything that
      // is not the ground is the sheet — a test on distance from one
      // known ground, not a threshold between two guessed ones.
      //
      // And the ground is READ, not named. It was the dock's tray
      // (--bench-lo, ~194) until the tray was removed and the bays came
      // to sit on the bench (~216); a hard-coded 194 then matched
      // nothing on the row and found no edges at all. The far left of
      // this row is bare page at every viewport this runs at, so the
      // frame can say what its own ground is.
      //
      // Read across the WHOLE row and per phase in the desk's tile, not
      // as one average of twenty pixels at the left margin. The desk
      // carries a pattern, so the bench is P different lumas depending
      // on where in the tile a column falls; twenty pixels is two and a
      // half tiles, which averages to whichever partial tile the margin
      // happened to start on, and the walk below then compares every
      // pixel against a ground that is up to a dozen luma off. The
      // sheet is one contiguous run on this row and bench is everything
      // else, so a median per phase across the row is the desk — and on
      // a desk with no pattern P is 1 and this is the old average, taken
      // over more of the row.
      const P =
        parseFloat(getComputedStyle(document.querySelector('.gen-page')).getPropertyValue('--tile'))
        || 1
      const cls = Array.from({ length: P }, () => [])
      for (let x = 2; x < width - 2; x++) cls[x % P].push(lum(x))
      const tile = cls.map((a) => {
        a.sort((p, q) => p - q)
        return a[a.length >> 1]
      })
      const groundAt = (x) => tile[((x % P) + P) % P]
      // 8, not 12. The walk continues while a pixel is unlike the desk
      // and stops at the first one that is the desk, so the threshold
      // has to sit under the SMALLEST gap between window stock and any
      // of the desk's tones. That used to be one gap — stock to bench,
      // 23 luma — and 12 was its midpoint. The pattern's lit lip is now
      // the nearest tone to stock, and at 12 the threshold was sitting
      // exactly on the gap it had to fit inside: a pixel of paper over a
      // lip column tested equal and stopped the walk on the spot. 8
      // clears the lip with room and still rejects bench by a factor of
      // three. The clearance itself is pinned in deskPattern.test.ts.
      const EDGE = 8
      let l = cx
      let r = cx
      while (l > 0 && Math.abs(lum(l - 1) - groundAt(l - 1)) > EDGE) l--
      while (r < width - 1 && Math.abs(lum(r + 1) - groundAt(r + 1)) > EDGE) r++
      const flat = [...tile].sort((a, b) => a - b)
      return { ground: Math.round(flat[flat.length >> 1]), w: r - l + 1 }
    },
    shot,
    Math.round(docked.top) - UP,
    docked.cx,
  )
  const ratio = span.w / live.width
  console.log(`\n  ${UP}px above the mouth, mid-restore`)
  console.log(`    the ground reads            ${span.ground}`)
  console.log(`    the sheet is                ${span.w}px`)
  console.log(`    the bay it is leaving is    ${live.width}px`)
  console.log(`    ratio                       ${ratio.toFixed(3)}`)

  const problems = []
  // The funnel flares a little above the mouth (throat), so this is not
  // 1.000 — but it is nowhere near the swell, and the whole point is to
  // sit between the two.
  if (ratio > 1.15)
    problems.push(
      `the sheet is ${ratio.toFixed(2)}x the width of the bay it is pouring out of — the press ` +
        `measured slotHalf through the bay's swell transform and the law is now applying it twice`,
    )
  if (rest.parentSx !== 1)
    problems.push(
      `a resting bay carries a ${rest.parentSx}x transform, so even a minimize now measures its ` +
        `mouth through one — offsetWidth is the only safe read`,
    )
  if (docked.width === docked.offset)
    problems.push(
      'a docked bay reads the same width through its transform as without it, so this leg is no ' +
        'longer distinguishing the two and would pass on the defect it exists for',
    )
  if (Math.abs(rest.top - docked.top) > 0.5)
    problems.push(`the mouth moved ${(docked.top - rest.top).toFixed(1)}px while the bay swelled`)
  if (Math.abs(rest.seam - rest.width) > 0.5)
    problems.push(`seam at rest is ${rest.seam}px on a ${rest.width}px icon — the pour would land narrow`)
  if (Math.abs(docked.seam - docked.width) > 0.5)
    problems.push(`seam docked is ${docked.seam}px on a ${docked.width}px icon — the mouth lost the swell`)
  if (Math.abs(rest.width - MOUTH) > 0.5)
    problems.push(`the resting icon is ${rest.width}px, but the law was pinned to ${MOUTH}px`)
  if (docked.parentSx < 1.2) problems.push(`the bay barely swelled (${docked.parentSx}x)`)
  if (docked.paneClip === rest.paneClip)
    problems.push(
      `the bay's mark reads the same empty as full (${rest.paneClip}) — nothing is consuming the ` +
        `pour, so a docked bay is indistinguishable from one holding nothing`,
    )
  // An empty bay has to be EMPTY, not merely different. A clip that
  // stops short leaves a permanent stub of signal in every bay on the
  // desk, which reads as four half-full windows before anything has
  // been put away.
  if (!/\b100%/.test(rest.paneClip))
    problems.push(
      `an empty bay's mark is clipped ${rest.paneClip} — it should be shut all the way, or the ` +
        `dock shows a level for windows that are still on the desk`,
    )

  console.log(
    `\nmouth-anchor: ${problems.length === 0 ? 'PASS — the mouth is the icon, at both sizes' : 'FAIL'}`,
  )
  for (const p of problems) console.log(`  ${p}`)
  process.exit(problems.length === 0 ? 0 : 1)
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
