// crystal-pointer gate — does the key you SEE under the glass tip answer the
// click?
//
// The crystal scene floats a cut solid of glass over the page and traces a
// ray through it — in a crown facet, bouncing between the inside faces, out
// through the pavilion and across the air gap — so at the pointer's own
// hotspot the page arrives 48.1 CSS px away from
// where the hand is. The DOM under the sheet never moved, so a click
// delivered at the hand's own coordinates lands on whatever the glass slid
// out of the way. The scene closes that gap by handing Munari's pointer
// relay the same trace the fragment shader drew with — `traceCrystal` in
// crystalLaw.ts, mirrored into crystalShaders.ts.
//
// Two copies of one function is the exact shape of bug this repo is worst
// at noticing. The PICTURE comes from the shader, so it stays perfect while
// they drift; only the click goes somewhere nobody looked. No screenshot
// shows it and no diff reads wrong. `crystalLaw.test.ts` pins the two by
// transcription, which catches an edit to one and not the other. It cannot
// catch a disagreement about what the numbers MEAN, and this can, because
// the two only ever actually meet in a browser.
//
// The measurement leans on the hover twin rather than on template matching.
// Munari mirrors pointer state onto `data-hover`, and a hovered key deepens
// its row's tint, so the scene draws a patch exactly where the key the relay
// chose ends up on screen — seen through the same glass as everything else.
// Grab one frame with the correction on and one with it off, WITHOUT moving
// the mouse, and the difference contains two blobs and nothing else: the key
// the eye picked, and the key the hand was over. Where those blobs sit is
// the whole answer, and it is read off the canvas.
//
// Four clauses:
//
//   1. Uncorrected, the click is the hand. With the switch off, a click at a
//      key's own layout box types that key however the glass is drawn,
//      because nothing is displacing the event. This also fixes the frame:
//      the boxes are read out of the parked source tree, and if that
//      arithmetic were wrong every measurement below would be wrong with it.
//   2. Corrected, the click is the eye — and it is a DIFFERENT key. The bend
//      at the hotspot is 48.1px against a 52px key pitch, so the correction
//      has to move the target most of a key, or the scene claims nothing.
//   3. The switch moved a highlight and did not repaint the world: both a
//      patch that came on and a patch that went off, each well above a floor.
//   4. The eye's key is the one drawn under the tip. This is the clause that
//      matters most, and the only one a drifted mirror cannot satisfy: the
//      relay would still pick some key and clauses 1-2 would still pass.
//
// "Came on" means DARKER. The pad is lit paper and the highlighted key fills
// near-black, so which sign counts as ON is a fact about the palette, not
// about the optics. `SIGN` in `__diff` is the only place it lives.
//
// Clause 4 COUNTS pixels rather than averaging their brightness, and the
// difference matters. Measured 2026-08-26 in the 6px disc at the tip: 23
// pixels came on against 0 that went off. An average over the same disc is a
// tug of war — the disc is a fixed 6px circle and the hotspot sits inside
// the silhouette, so part of it reads undisplaced page that moves the other
// way as the old key's highlight leaves. A count is immune to that; an
// average's floor would need retuning every time the edge profile moved.
//
// This clause failed once, at a flat-topped version of the solid, and the
// reason is worth keeping. A slab with parallel faces deviates NOTHING at
// normal incidence, so a flat top is a window over its interior and a lens
// only at its rim: 12px in along the arrow's axis there were zero displaced
// pixels at all, and the median displacement over the crystal's interior
// pixels was 2.7px against 21.2 at the hotspot. The fix was the shape and
// not the gate — crown facets sprung from the girdle cover 78% of the
// outline's area, and the same median is now 130px. The stone was later cut
// a pavilion as well, so the exit face is not flat either.
//
// There is no fifth clause asking where the HAND's key ended up. It sounds
// like a second independent reading and is not one: the two keys differ and
// the glass is one function of position, so "B is under the tip" already
// says G is not.
//
// Clause 1 also stands guard over the relay's click. Munari's canvas gate
// swallows the browser's own click after a press it already delivered, by
// coordinate — and an uncorrected press puts the relay's retelling within a
// pixel of the hand, so before the `isRelayed` guard in CanvasPointerGate.tsx
// the retelling was what got eaten. Every other pointer event survived, so
// the only visible symptom was this: hover correct, press correct, nothing
// typed.
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
  const msg = `crystal-pointer gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : msg)
  process.exit(strict ? 1 : 0)
}

if (!CHROME) skip('no Chrome executable found (set CHROME_PATH)')

/**
 * The key the hotspot is aimed at.
 *
 * Third row of four. The bend at the hotspot is (+21.7, +53.5) px, so the
 * corrected target is the key one row DOWN — which needs a row below it,
 * and needs the readout's own live clock far enough above that the tick
 * changing between two frames cannot land in the window clause 3 reads.
 */
const AIM = 'G'

/** How far around the hotspot clause 4 counts, CSS px. */
const TIP_R = 6

/**
 * How many pixels must come on inside that disc, and by what margin.
 *
 * The count scales with the crystal, because the disc does not: it is a
 * fixed 6px circle, and what fills it is the highlighted key magnified by
 * whatever the glass is doing at the tip. Measured over three runs each:
 * 50 px at `scalePx: 9.75`, 23 px at 4.75 — close to linear in the scale,
 * not in its square. So the floor cannot be a fraction of the disc's area,
 * and it has to be re-derived when the solid changes size.
 *
 * 12 is half the current reading, and every run of it has been 23 against 0
 * off. The margin is what carries the real weight: a drifted mirror would
 * put the eye's key somewhere else entirely and leave nothing in the disc
 * but the old key's highlight going off, which is a NEGATIVE margin rather
 * than a small one.
 */
const TIP_ON_FLOOR = 12
const TIP_MARGIN = 3

/** How far either side of the tip clause 3 looks, CSS px. */
const WINDOW = 110

/** Luminance step that counts a pixel as having changed hover state. */
const HOVER_STEP = 8

/**
 * How many pixels each blob must cover.
 *
 * A key is 48x48 = 2304 px. Drawn through the meniscus it stretches and
 * shrinks, and part of it can leave the window, so this is a floor on
 * "there is a key here" rather than a measurement of one.
 */
const BLOB_FLOOR = 300

/**
 * The sweep clause 5 walks, and how far apart its samples are.
 *
 * 8px between samples at 8ms is about 1000px/s, which is an ordinary flick
 * across a keyboard and enough to put the drawn pose a frame behind the
 * hand. 360px keeps both ends on the pad.
 */
const SWEEP_PX = 360
const SWEEP_STEPS = 45
const SWEEP_SETTLE = 8

/**
 * The furthest the RELAYED point may sit from the hand while sweeping, px.
 *
 * Measured 2026-08-26 walking this sweep at the committed cut: 67px median
 * and 99 worst, so the ceiling is that with room. A pose read against the
 * hand's position instead of the tip's put the same walk at 141px median
 * and 180 worst.
 *
 * Read off the relayed event rather than off which key is lit: when the
 * correction is wrong it mostly returns [0, 0] instead, and the key under
 * an UNcorrected pointer is 12px from the hand — a better-looking number
 * than the honest one. Same reason hop-to-hop between lit keys is no good:
 * the highlight drops out too often to measure a hop across.
 */
const SWEEP_OFFSET = 130

let browser, server
const deadline = setTimeout(() => {
  console.error('crystal-pointer: hard 150s deadline hit')
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
  await page.goto(`http://localhost:${port}/?scene=crystal&bare`, { waitUntil: 'load' })
  await page.waitForSelector('canvas[data-engine]', { timeout: 20_000 })
  // The sheet is the whole viewport and the pad is inside it, so the first
  // capture has to land before any layout box read below means anything.
  await sleep(1500)

  // ── the page's own frame ─────────────────────────────────────────────
  //
  // Key boxes come out of the PARKED source tree, which is laid out
  // wherever Munari put the capture container. Subtracting the container's
  // own rect turns them back into sheet coordinates, and the sheet is the
  // viewport — so these are screen px, which clause 1 then proves.
  await page.evaluate(() => {
    const host = document.querySelector('[data-munari-source-host][data-munari-instance="source"]')
    window.__box = (label) => {
      const el = host.querySelector(`.crystal-key[data-key="${label}"]`)
      if (!el) return null
      const k = el.getBoundingClientRect()
      const h = host.getBoundingClientRect()
      return { x: k.left - h.left + k.width / 2, y: k.top - h.top + k.height / 2 }
    }
    window.__typed = () => document.querySelector('.crystal-typed').textContent
    window.__correct = (on) => {
      const cb = document.querySelector('[data-crystal-correct]')
      // `.click()` and not a mouse gesture: the hand must not move between
      // the two frames clause 3 compares, or the crystal moves with it.
      if (cb.checked !== on) cb.click()
      return cb.checked
    }
    window.__frames = {}
    window.__grab = (tag) => {
      const { gl, scene, camera } = window.__r3f
      gl.render(scene, camera)
      const c = gl.domElement
      const w = c.width
      const h = c.height
      const px = new Uint8Array(w * h * 4)
      // Read in the same task as the render: the canvas keeps no drawing
      // buffer, and a read from a later task returns a cleared frame.
      gl.getContext().readPixels(0, 0, w, h, 0x1908, 0x1401, px)
      const lum = new Float32Array(w * h)
      for (let i = 0; i < w * h; i++) {
        lum[i] = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]
      }
      window.__frames[tag] = { lum, w, h, ch: c.clientHeight, dpr: w / c.clientWidth }
    }
    // GL row 0 is the BOTTOM of the canvas; every read below is in CSS px
    // from the top, so the flip happens once, here.
    window.__diff = (hx, hy, win, step, tipR) => {
      const A = window.__frames.on
      const B = window.__frames.off
      const at = (f, x, y) => {
        const gx = Math.min(f.w - 1, Math.max(0, Math.round(x * f.dpr)))
        const gy = Math.min(f.h - 1, Math.max(0, Math.round((f.ch - y) * f.dpr)))
        return f.lum[gy * f.w + gx]
      }
      // The highlighted key is DARKER than its neighbours: the pad is lit
      // paper and the aimed-at key fills near-black. So a pixel that darkens
      // between the two frames is one the correction moved the highlight ON
      // TO, and a pixel that lightens is one it moved it off. `SIGN` is the
      // only place that fact lives, so a repalette is one number here.
      const SIGN = -1
      let on = 0
      let off = 0
      let tipOn = 0
      let tipOff = 0
      for (let y = hy - win; y <= hy + win; y++) {
        for (let x = hx - win; x <= hx + win; x++) {
          const d = (at(A, x, y) - at(B, x, y)) * SIGN
          const isOn = d > step
          const isOff = d < -step
          if (isOn) on++
          else if (isOff) off++
          if ((x - hx) ** 2 + (y - hy) ** 2 <= tipR * tipR) {
            if (isOn) tipOn++
            else if (isOff) tipOff++
          }
        }
      }
      return { on, off, tipOn, tipOff }
    }
  })

  const box = async (label) => {
    const b = await page.evaluate((l) => window.__box(l), label)
    if (!b) throw new Error(`no key "${label}" on the pad`)
    return b
  }
  const typedLast = async () => {
    const s = await page.evaluate(() => window.__typed())
    return s.slice(-1)
  }
  const setCorrect = async (on) => page.evaluate((v) => window.__correct(v), on)

  const aim = await box(AIM)

  // ── 1 and 2. the hand, then the eye ──────────────────────────────────
  //
  // The crystal is pinned to the hand, so there is no such thing as moving
  // to a key with the glass parked elsewhere: the arrival IS the park. The
  // first move is given its own settle, because the spring is still
  // unwinding from wherever the pointer entered the page and the lean it
  // carries changes the bend.
  await page.mouse.move(aim.x, aim.y)
  await sleep(700)

  await setCorrect(false)
  await page.mouse.move(aim.x, aim.y)
  await sleep(120)
  await page.mouse.click(aim.x, aim.y)
  await sleep(250)
  const hand = await typedLast()
  check(hand === AIM, `uncorrected, the click is the hand: aimed at ${AIM}, typed "${hand}"`)

  await setCorrect(true)
  await page.mouse.move(aim.x, aim.y)
  await sleep(120)
  await page.mouse.click(aim.x, aim.y)
  await sleep(250)
  const eye = await typedLast()
  check(
    eye !== '' && eye !== AIM,
    `corrected, the click is the eye and lands a whole key away: ` +
      `aimed at ${AIM}, typed "${eye}"`,
  )

  // ── 3. the eye's key is the one drawn under the tip ──────────────────
  //
  // Two frames with the hand held still, so the crystal's pose is identical
  // in both and everything optical cancels in the difference. What is left
  // is the hover twin moving from one key to another, drawn through the
  // same glass — and the tip has to be inside the one that came on.
  await setCorrect(true)
  await page.mouse.move(aim.x, aim.y)
  await sleep(400)
  await page.evaluate(() => window.__grab('on'))

  await setCorrect(false)
  // A move to the same place: it re-raycasts, which is what re-relays the
  // hover. Toggling the switch on its own moves no pointer and the parked
  // key keeps whatever state it last heard.
  await page.mouse.move(aim.x, aim.y)
  await sleep(400)
  await page.evaluate(() => window.__grab('off'))

  const d = await page.evaluate(
    ([x, y, win, step, tipR]) => window.__diff(Math.round(x), Math.round(y), win, step, tipR),
    [aim.x, aim.y, WINDOW, HOVER_STEP, TIP_R],
  )
  check(
    d.on >= BLOB_FLOOR && d.off >= BLOB_FLOOR,
    `the switch moves the highlight and nothing else ` +
      `(${d.on}px came on, ${d.off}px went off)`,
  )
  check(
    d.tipOn >= TIP_ON_FLOOR && d.tipOn >= d.tipOff * TIP_MARGIN,
    `the corrected key is drawn UNDER the tip ` +
      `(in a ${TIP_R}px disc at the hotspot: ${d.tipOn}px came on, ${d.tipOff}px went off)`,
  )

  // 5 — the hand MOVING.
  //
  // Every clause above holds the hand still, so the pose the raycast reads
  // is the pose that drew the picture and the two can never disagree. In
  // motion the drawn pose is a frame behind, and the bend field answers a
  // query put to it off the tip so badly that the highlight used to land
  // three keys from the cursor and jump 170px between one sample and the
  // next. Walking it and watching the size of each hop is the only clause
  // here that can see that.
  await setCorrect(true)
  const sweep = []
  for (let i = 0; i <= SWEEP_STEPS; i++) {
    sweep.push([aim.x - SWEEP_PX / 2 + (i * SWEEP_PX) / SWEEP_STEPS, aim.y])
  }
  await page.mouse.move(sweep[0][0], sweep[0][1])
  await sleep(400)

  // The relay's own output, caught where it lands: a synthetic move into the
  // parked subtree, which is the corrected point and nothing else.
  await page.evaluate(() => {
    const host = document.querySelector(
      '[data-munari-source-host][data-munari-instance="source"]',
    )
    window.__relayed = []
    host.addEventListener(
      'pointermove',
      (e) => {
        if (!e.isTrusted) window.__relayed.push([e.clientX, e.clientY])
      },
      true,
    )
    window.__drainRelayed = () => {
      const r = window.__relayed
      window.__relayed = []
      return r
    }
  })

  const offsets = []
  let litSamples = 0
  for (const [x, y] of sweep) {
    await page.mouse.move(x, y)
    await sleep(SWEEP_SETTLE)
    const [rel, lit] = await page.evaluate(() => {
      const r = window.__drainRelayed()
      const el = document.querySelector('[data-munari-instance="source"] [data-key][data-hover]')
      return [r.length ? r[r.length - 1] : null, Boolean(el)]
    })
    if (lit) litSamples++
    if (rel) offsets.push(Math.hypot(rel[0] - x, rel[1] - y))
  }
  const sorted = [...offsets].sort((a, b) => a - b)
  const worstOffset = Math.round(sorted[sorted.length - 1] ?? 0)
  const medOffset = Math.round(sorted[sorted.length >> 1] ?? 0)
  check(
    litSamples >= sweep.length / 2,
    `moving, the hand keeps a key lit (${litSamples}/${sweep.length} samples)`,
  )
  check(
    offsets.length > 0 && worstOffset <= SWEEP_OFFSET,
    `moving, the relayed point stays under the tip ` +
      `(median ${medOffset}px from the hand, worst ${worstOffset}px, ceiling ${SWEEP_OFFSET}px)`,
  )

  check(errors.length === 0, `no page errors (${errors.length})`)
} catch (e) {
  problems.push(String(e?.stack ?? e))
  console.error(e)
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}

if (problems.length) {
  console.error(`\ncrystal-pointer: ${problems.length} problem(s)`)
  process.exit(1)
}
console.log('\ncrystal-pointer: ok')
