// gallery-pointer gate — mid-crossing, does the pointer go to the item you
// can actually see?
//
// The gallery draws two live documents in one sheet and decides per fragment
// which of them a pixel shows. Hover, and the pointer has to make the same
// decision at one point, on the CPU, before anything can be told about it.
// The scene does that by mounting a presenter for EACH item and letting the
// aperture partition the plane between them: each mesh declines the ray
// wherever the other item is on screen, and Munari's relay carries the event
// into whichever subtree its own mesh accepted.
//
// That partition is a second copy of the shader's aperture, written in
// JavaScript, reading the same render targets back off the GPU. Two copies
// of one law is the exact shape of bug this repo is worst at noticing: the
// PICTURE stays right, because the shader is untouched, and only the pointer
// goes to the wrong document. Nobody reviewing a diff sees it and no
// screenshot shows it. So it is measured here, against the pixels.
//
// Three clauses, and the middle one is the teeth:
//
//   1. The ends are unanimous. One scrub step into the crossing the drop has
//      opened nowhere, so every point on the sheet must relay to the item
//      being left; one step short of the landing it has opened everywhere,
//      so every point must relay to the item being arrived at. A router
//      stuck on either answer passes one of these and fails the other.
//   2. In the middle, the item that HEARS a point is the item the pixels at
//      that point are showing. Measured by comparing the sheet against two
//      reference frames — the same sheet parked at each end — so the CPU
//      mirror is checked against what the GPU drew rather than against
//      itself.
//   3. The middle is genuinely split. Both items must hear something,
//      which is what stops clause 2 from being satisfied by a router that
//      always answers the same way and happens to agree.
//
// The counter-clause, run on 2026-08-24: replace the field the router reads
// with a plain horizontal ramp. That router still has correct ENDS — the
// sweep carries the threshold past both of them — and it still splits the
// sheet, so clauses 1 and 3 pass unchanged. Clause 2 fell from 94% to 20%.
// This is the whole reason the middle is measured against pixels.
//
// Clause 2 skips two kinds of point on purpose, and both exclusions are
// stated rather than tuned: cells where the two documents look alike (no
// answer to disagree about), and cells on the front itself (where the
// meniscus bends and the seam blends, so the pixels are legitimately
// neither document). The front is found from the routing map, not from the
// field — a point whose four neighbours do not all route the same way is on
// it — so nothing about the exclusion is borrowed from the thing under test.
import { existsSync } from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const labRoot = path.join(ROOT, 'apps', 'lab')
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
].filter(Boolean).find(existsSync)

const strict = process.env.STRICT_CAPABILITY === '1'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function skip(reason) {
  const msg = `gallery-pointer gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : msg)
  process.exit(strict ? 1 : 0)
}

if (!CHROME) skip('no Chrome executable found (set CHROME_PATH)')

// The gallery opens on its first two items, in that order, and a scrub away
// from 0 crosses from the first to the second. Pinned rather than read out
// of the page so a reordered ITEMS list has to come back here.
const LEAVING = 'flight'
const ARRIVING = 'genie'

/** The scrub positions the three clauses are read at. */
const START = 0.02
const MID = 0.5
const END = 0.999

/** Mouse grid over the sheet, in holder fractions. */
const COLS = 13
const ROWS = 9

/** Luminance gap that counts a cell as showing different content. */
const CONTENT = 20

/**
 * Share of the judgeable points that must route to the item their pixels
 * show.
 *
 * Not 100%. The routing law deliberately ignores the drop's BEND: the
 * arriving item is sampled through up to `refractPx` of local displacement
 * — 26 CSS px at this scene's tuning — and the router applies only the
 * approach zoom the whole sheet shares. The neighbour exclusion removes the
 * front itself but not the wider skirt the bend reaches across, so a point
 * inside it can be judged against the wrong reference pixel.
 *
 * Measured 2026-08-24 at the committed tuning: 32 of 34 judgeable points,
 * 94%. The floor sits under that with room for retuning the drop, and well
 * above the 20% a router that ignores the field scores.
 */
const AGREE_FLOOR = 0.9

let browser, server
const deadline = setTimeout(() => {
  console.error('gallery-pointer: hard 150s deadline hit')
  process.exit(1)
}, 150_000)

const problems = []
const check = (ok, message) => {
  if (!ok) problems.push(message)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`)
}

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--enable-features=CanvasDrawElement',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })

  const probe = await browser.newPage()
  const capable = await probe.evaluate(
    () => 'drawElementImage' in document.createElement('canvas').getContext('2d'),
  )
  await probe.close()
  if (!capable) skip(`Chrome at ${CHROME} has no drawElementImage`)

  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  const errors = []
  const page = await browser.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) {
      errors.push(m.text())
    }
  })
  await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:${port}/?scene=gallery&bare`, { waitUntil: 'load' })
  await page.waitForSelector('canvas[data-engine]', { timeout: 20_000 })
  // The cards carry photographs. A crossing read before they decode shows a
  // blank card, and every clause below would agree about nothing.
  await sleep(2500)

  const scrub = async (v, settle = 500) => {
    await page.evaluate((value) => {
      const input = document.querySelector('.gallery-scrub')
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(input, String(value))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, v)
    await sleep(settle)
  }

  // ── which item is which ──────────────────────────────────────────────
  const parked = await page.evaluate(() =>
    [...document.querySelectorAll('[data-munari-source-host]')].map((host) => ({
      surface: host.getAttribute('data-munari-surface'),
      item: host.querySelector('.gallery-card')?.getAttribute('data-item') ?? null,
    })).sort((a, b) => a.surface.localeCompare(b.surface)),
  )
  check(
    parked.length === 2 && parked[0].item === LEAVING && parked[1].item === ARRIVING,
    `the two handles hold the expected pair ` +
      `(${parked.map((p) => `${p.surface}=${p.item}`).join(', ')})`,
  )

  // ── the reference frames and the sheet, as luminance grids ───────────
  // Read back in the same task as the render: the canvas keeps no drawing
  // buffer, and a read from a later task returns a cleared frame.
  const G = 128
  const H = 84
  const grab = (gw, gh) => {
    const { gl, scene, camera } = window.__r3f
    gl.render(scene, camera)
    const canvas = gl.domElement
    const dpr = canvas.width / canvas.clientWidth
    const r = document.querySelector('.gallery-holder').getBoundingClientRect()
    const x = Math.round(r.left * dpr)
    const w = Math.round(r.width * dpr)
    const h = Math.round(r.height * dpr)
    const y = Math.round((canvas.clientHeight - r.bottom) * dpr)
    const px = new Uint8Array(w * h * 4)
    gl.getContext().readPixels(x, y, w, h, 0x1908, 0x1401, px)
    const sum = new Float64Array(gw * gh)
    const count = new Uint32Array(gw * gh)
    for (let i = 0; i < w * h; i++) {
      const row = Math.floor(i / w)
      // readPixels hands back rows bottom-up; the grid is indexed the way a
      // screen fraction is, from the top.
      const gy = Math.min(gh - 1, Math.floor(((h - 1 - row) / h) * gh))
      const gx = Math.min(gw - 1, Math.floor(((i % w) / w) * gw))
      const k = gy * gw + gx
      sum[k] += px[i * 4] * 0.2126 + px[i * 4 + 1] * 0.7152 + px[i * 4 + 2] * 0.0722
      count[k]++
    }
    return [...sum].map((v, i) => v / (count[i] || 1))
  }

  const zoomNow = () => {
    let z = null
    window.__r3f?.scene?.traverse((o) => {
      const u = o.isMesh ? o.material?.uniforms : null
      if (u?.uTransmission) z = u.uZoom.value
    })
    return z
  }

  // The grid the mouse walks, in holder fractions. Points that land on an
  // overlay — the caption, the HUD — are dropped: the pointer never reaches
  // the canvas there, so the sheet was never asked.
  const holder = await page.evaluate(() => {
    const r = document.querySelector('.gallery-holder').getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  })
  const points = []
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const fx = (col + 0.5) / COLS
      const fy = (row + 0.5) / ROWS
      points.push({
        row,
        col,
        fx,
        fy,
        x: Math.round(holder.left + holder.width * fx),
        y: Math.round(holder.top + holder.height * fy),
      })
    }
  }
  /** Walk the grid and record which item hears each point. */
  const walk = async () => {
    const heard = new Map()
    for (const p of reachable) {
      await page.mouse.move(p.x, p.y, { steps: 2 })
      heard.set(
        `${p.row},${p.col}`,
        await page.evaluate(() =>
          document.querySelector('.gallery-card[data-hover]')?.getAttribute('data-item') ?? null,
        ),
      )
    }
    // Off the sheet, so the next walk starts with no chain left standing.
    await page.mouse.move(2, 2, { steps: 2 })
    return heard
  }

  const tally = (heard) => {
    const counts = new Map()
    for (const v of heard.values()) counts.set(v, (counts.get(v) ?? 0) + 1)
    return [...counts.entries()].map(([k, n]) => `${k}:${n}`).join(' ')
  }

  // ── clause 1: the ends are unanimous ─────────────────────────────────
  await scrub(START)

  // The scene's own controls sit ABOVE the canvas and swallow the pointer,
  // so grid points under them never reach the sheet and are dropped.
  //
  // By rect and not by `elementFromPoint`, which cannot answer this. The
  // canvas runs `pointerMode="surfaces"`: it is `pointer-events: none` and
  // only goes solid once a raycast has found registered matter under the
  // pointer, so a hit test taken before the mouse has moved there reports
  // whatever is behind the canvas and never the canvas itself.
  const blockers = await page.evaluate(() =>
    ['.gallery-caption', '.gallery-hud'].map((sel) => {
      const r = document.querySelector(sel)?.getBoundingClientRect()
      return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null
    }).filter(Boolean),
  )
  const reachable = points.filter(
    (p) => !blockers.some((b) => p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom),
  )
  check(
    reachable.length > points.length * 0.6,
    `the overlays leave most of the sheet reachable ` +
      `(${reachable.length}/${points.length} grid points clear of them)`,
  )

  const leavingRef = await page.evaluate(grab, G, H)
  const atStart = await walk()
  check(
    [...atStart.values()].every((item) => item === LEAVING),
    `one step into the crossing every point relays to the item being left ` +
      `(${tally(atStart)})`,
  )

  await scrub(END)
  const arrivingRef = await page.evaluate(grab, G, H)
  const atEnd = await walk()
  check(
    [...atEnd.values()].every((item) => item === ARRIVING),
    `one step short of the landing every point relays to the item arriving ` +
      `(${tally(atEnd)})`,
  )

  // ── clauses 2 and 3: the middle ──────────────────────────────────────
  await scrub(MID)
  const sheet = await page.evaluate(grab, G, H)
  const zoom = await page.evaluate(zoomNow)
  const atMid = await walk()
  const midItems = new Set([...atMid.values()].filter(Boolean))
  check(
    midItems.has(LEAVING) && midItems.has(ARRIVING),
    `mid-crossing both items hear part of the sheet (${tally(atMid)})`,
  )

  const at = (grid, fx, fy) => {
    const gx = Math.min(G - 1, Math.max(0, Math.floor(fx * G)))
    const gy = Math.min(H - 1, Math.max(0, Math.floor(fy * H)))
    return grid[gy * G + gx]
  }
  // `approachUv` — the whole-sheet part of the mapping the arriving item is
  // sampled through. It is symmetric about the centre in both axes, so it
  // applies unchanged to a top-down screen fraction.
  const approach = (f) => (f - 0.5) / Math.max(zoom, 1e-4) + 0.5

  let judged = 0
  let agreed = 0
  let alike = 0
  let onFront = 0
  for (const p of reachable) {
    const key = `${p.row},${p.col}`
    const heard = atMid.get(key)
    if (!heard) continue
    const neighbours = [
      `${p.row - 1},${p.col}`,
      `${p.row + 1},${p.col}`,
      `${p.row},${p.col - 1}`,
      `${p.row},${p.col + 1}`,
    ].map((k) => atMid.get(k)).filter((v) => v != null)
    if (neighbours.some((v) => v !== heard)) {
      onFront++
      continue
    }
    const leavingLum = at(leavingRef, p.fx, p.fy)
    const arrivingLum = at(arrivingRef, approach(p.fx), approach(p.fy))
    if (Math.abs(leavingLum - arrivingLum) < CONTENT) {
      alike++
      continue
    }
    judged++
    const shown = at(sheet, p.fx, p.fy)
    const nearer =
      Math.abs(shown - leavingLum) <= Math.abs(shown - arrivingLum) ? LEAVING : ARRIVING
    if (nearer === heard) agreed++
  }
  const share = judged ? agreed / judged : 0
  check(
    judged >= 20,
    `enough of the sheet is judgeable mid-crossing ` +
      `(${judged} points; ${onFront} on the front, ${alike} where the items look alike)`,
  )
  check(
    share >= AGREE_FLOOR,
    `and the item that hears a point is the item its pixels show ` +
      `(${agreed}/${judged} = ${(share * 100).toFixed(0)}%, floor ${AGREE_FLOOR * 100}%)`,
  )

  check(errors.length === 0, `no page errors (${errors.length})`)
  if (errors.length) console.error(errors.join('\n'))
} catch (error) {
  problems.push(String(error?.stack ?? error))
  console.error(error)
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}

if (problems.length) {
  console.error(`\ngallery-pointer gate FAILED (${problems.length})`)
  process.exit(1)
}
console.log('\ngallery-pointer gate passed')
