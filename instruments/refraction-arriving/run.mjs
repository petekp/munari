// refraction-arriving gate — is the page you are arriving at really live,
// and really the only thing on the sheet at the end of the crossing?
//
// The refraction scene puts two documents in one material. Only one of
// them is presented; the other is a resident source, sampled by handle
// through `useSurfaceTextureOf` and drawn nowhere in the scene graph.
// Two claims hold the scene up, and both fail silently:
//
//   1. The arriving document keeps painting while it is only being
//      sampled. If its capture stalls, the sheet still draws — it just
//      shows a picture. Nothing errors, and a still page looks correct.
//   2. At the end of the crossing the sheet is the ARRIVING document and
//      nothing else. A transmission that never reaches 1 leaves the
//      leaving page faintly on top forever, which reads as a soft mix
//      rather than a bug.
//
// The teeth for (2): switch the figure inside the LEAVING document —
// square to grid, the largest change its height field can take. At the
// start of the crossing the sheet must change. At the end it must not,
// because by then nothing of the leaving page is being drawn.
//
// The teeth for (1): both documents print the same shared clock, so a
// full-resolution luminance sum over the sheet must move while the
// scrub is parked at 1 and nothing is touched.
//
// This also stands in for a compile check on the scene's program: a
// shader that fails to link draws nothing, and the opaque-coverage
// assertion below would read 0 instead of the full rect.

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
  const msg = `refraction-arriving gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : msg)
  process.exit(strict ? 1 : 0)
}

if (!CHROME) skip('no Chrome executable found (set CHROME_PATH)')

// Must match apps/lab/src/scenes/refraction/refractionTuning.ts.
const STAGE_W = 560
const STAGE_H = 420
// The law at t = 0.5, computed by hand from REFRACTION_SHAPE. Pinned as
// numbers so a tuning change has to come back here and say what it did.
const MID = { relief: 0.81762, transmission: 0.5, zoom: 1.12 }
const MID_TOL = 1e-3
// Below this the figure switch did not reach the sheet at all; the
// measured value with a live leaving page is ≈6.8 (2026-08-22).
const CHANGED = 2.0
// Above this the leaving page is still contributing at the end of the
// crossing. Not zero: both documents print a clock, and the arriving
// one's digits move between the two grabs.
const SETTLED = 0.5

/**
 * Share of the sheet's pixels that must change when the light crosses it.
 *
 * The raking highlight lives on glyph edges, which are a few per cent of a
 * page, so mean luminance cannot see it at all — measured 2026-08-22,
 * sweeping the pointer the full width of the panel moved the mean by 0.002
 * of a luminance unit and moved 4.18% of pixels by more than eight. A
 * frozen light is otherwise invisible: the sheet still glints, it just
 * stops answering the hand.
 */
const LIT_FLOOR = 0.02

/** Luminance step that counts one pixel as having changed under the light. */
const LIT_STEP = 8

/** Luminance gap that counts a cell as showing different content. */
const CONTENT = 20

/** Luminance gap under which a cell counts as matching a document exactly. */
const NEAR = 4

/**
 * How many of the changing cells must be whole at the midpoint.
 *
 * A global crossfade scores 0 here by construction — every pixel is a blend
 * of both. Measured 2026-08-22 the front scores 63–66% across runs, so 25% is a floor with
 * real room in it that still cannot be reached by any blend.
 */
const PURE_FLOOR = 0.25

let browser, server
const deadline = setTimeout(() => {
  console.error('refraction-arriving: hard 120s deadline hit')
  process.exit(1)
}, 120_000)

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
  await page.goto(`http://localhost:${port}/?scene=refraction&bare`, { waitUntil: 'load' })
  await page.waitForSelector('canvas[data-engine]', { timeout: 20_000 })
  await sleep(1500)

  const setScrub = (v) => {
    const input = document.querySelector('.refraction-scrub')
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(input, String(v))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const scrub = async (v, settle = 500) => {
    await page.evaluate(setScrub, v)
    await sleep(settle)
  }

  // Render once and read the sheet's own rect back in the SAME task: the
  // canvas has no preserved drawing buffer, so a read from a later task
  // returns a cleared frame.
  const grab = () => {
    const { gl, scene, camera } = window.__r3f
    gl.render(scene, camera)
    const canvas = gl.domElement
    const dpr = canvas.width / canvas.clientWidth
    const r = document.querySelector('.refraction-holder').getBoundingClientRect()
    const x = Math.round(r.left * dpr)
    const w = Math.round(r.width * dpr)
    const h = Math.round(r.height * dpr)
    const y = Math.round((canvas.clientHeight - r.bottom) * dpr)
    const px = new Uint8Array(w * h * 4)
    gl.getContext().readPixels(x, y, w, h, 0x1908, 0x1401, px)
    const N = 12
    const cell = new Array(N * N).fill(0)
    const count = new Array(N * N).fill(0)
    // A second, finer grid. The 12x12 signature above has pinned deltas on
    // it and must not move; the crossfade clause needs cells small enough
    // that a paragraph and its margin land in different ones.
    const F = 40
    const G = 30
    const fine = new Array(F * G).fill(0)
    const fineCount = new Array(F * G).fill(0)
    let opaque = 0
    let sum = 0
    for (let i = 0; i < w * h; i++) {
      if (px[i * 4 + 3] > 200) opaque++
      const lum = px[i * 4] * 0.2126 + px[i * 4 + 1] * 0.7152 + px[i * 4 + 2] * 0.0722
      sum += lum
      const k = Math.floor((Math.floor(i / w) / h) * N) * N + Math.floor(((i % w) / w) * N)
      cell[k] += lum
      count[k]++
      const fk =
        Math.floor((Math.floor(i / w) / h) * G) * F + Math.floor(((i % w) / w) * F)
      fine[fk] += lum
      fineCount[fk]++
    }
    return {
      w,
      h,
      opaque,
      sum,
      sig: cell.map((v, i) => v / (count[i] || 1)),
      fine: fine.map((v, i) => v / (fineCount[i] || 1)),
    }
  }

  /** Per-pixel luminance over the sheet. The light is too local for a mean. */
  const grabLuma = () => {
    const { gl, scene, camera } = window.__r3f
    gl.render(scene, camera)
    const canvas = gl.domElement
    const dpr = canvas.width / canvas.clientWidth
    const r = document.querySelector('.refraction-holder').getBoundingClientRect()
    const x = Math.round(r.left * dpr)
    const w = Math.round(r.width * dpr)
    const h = Math.round(r.height * dpr)
    const y = Math.round((canvas.clientHeight - r.bottom) * dpr)
    const px = new Uint8Array(w * h * 4)
    gl.getContext().readPixels(x, y, w, h, 0x1908, 0x1401, px)
    const out = new Array(w * h)
    for (let i = 0; i < w * h; i++) {
      out[i] = px[i * 4] * 0.2126 + px[i * 4 + 1] * 0.7152 + px[i * 4 + 2] * 0.0722
    }
    return out
  }

  const uniforms = () => {
    let found = null
    window.__r3f?.scene?.traverse((o) => {
      const u = o.isMesh ? o.material?.uniforms : null
      if (u?.uTransmission) {
        found = {
          relief: u.uRelief.value,
          transmission: u.uTransmission.value,
          zoom: u.uZoom.value,
          hasIncoming: u.uHasIncoming.value,
          incomingWidth: u.tIncoming.value?.image?.width ?? null,
          distinct: u.tIncoming.value !== u.tMap.value,
        }
      }
    })
    return found
  }

  const clocks = () =>
    [...document.querySelectorAll('[data-munari-source-host]')].map((host) => ({
      surface: host.getAttribute('data-munari-surface'),
      tick: host.querySelector('.refraction-tick')?.textContent ?? null,
    }))

  const diff = (a, b) =>
    a.sig.reduce((s, v, i) => s + Math.abs(v - b.sig[i]), 0) / a.sig.length

  /**
   * Share of the cells that actually differ between the two documents which,
   * mid-crossing, still match one of them exactly.
   *
   * This is what separates a front from a crossfade, and nothing simpler
   * does. Contrast cannot: the revealed part of the sheet is genuinely
   * softer than either endpoint, because it is being refracted, so a
   * stddev reads a working bend and a broken blend the same way.
   */
  const pureShare = (leaving, arriving, mid) => {
    const changing = leaving.fine
      .map((_, i) => i)
      .filter((i) => Math.abs(leaving.fine[i] - arriving.fine[i]) > CONTENT)
    if (!changing.length) return { share: 0, cells: 0 }
    const pure = changing.filter(
      (i) => Math.abs(mid.fine[i] - leaving.fine[i]) < NEAR
        || Math.abs(mid.fine[i] - arriving.fine[i]) < NEAR,
    ).length
    return { share: pure / changing.length, cells: changing.length }
  }

  // ── both documents exist as sources, neither is presented twice ──────
  const sources = await page.evaluate(clocks)
  const named = sources.map((s) => s.surface).sort()
  check(
    named.includes('refraction-square') && named.includes('refraction-circle'),
    `both documents are parked sources (${named.join(', ')})`,
  )
  check(
    sources.every((s) => s.tick && s.tick === sources[0].tick),
    `both clocks agree at rest (${sources.map((s) => s.tick).join(' / ')})`,
  )

  // ── the sheet draws, and it binds the resident Surface's own texture ──
  await scrub(0.5)
  const mid = await page.evaluate(uniforms)
  check(mid !== null, 'the sheet mounts a material while the scrub is lifted')
  check(
    mid?.hasIncoming === 1 && mid?.distinct === true && mid?.incomingWidth === STAGE_W,
    `the arriving texture is bound and is not the leaving one ` +
      `(has=${mid?.hasIncoming} distinct=${mid?.distinct} width=${mid?.incomingWidth})`,
  )
  check(
    Math.abs(mid.relief - MID.relief) < MID_TOL &&
      Math.abs(mid.transmission - MID.transmission) < MID_TOL &&
      Math.abs(mid.zoom - MID.zoom) < MID_TOL,
    `the law reaches the material at t=0.5 ` +
      `(relief ${mid.relief.toFixed(5)}, transmission ${mid.transmission.toFixed(5)}, ` +
      `zoom ${mid.zoom.toFixed(5)})`,
  )

  const midPixels = await page.evaluate(grab)
  check(
    midPixels.opaque === midPixels.w * midPixels.h,
    `the program linked and covered its rect (${midPixels.opaque}/${midPixels.w * midPixels.h})`,
  )
  // The sheet is read back at the holder's live box, so a stylesheet that
  // resized the stage would move the rect under every clause above and the
  // signatures would still compare cleanly against each other.
  check(
    midPixels.w === STAGE_W && midPixels.h === STAGE_H,
    `the sheet is the stage box (${midPixels.w}×${midPixels.h})`,
  )

  // ── the arriving document is a live layout, not a picture ────────────
  await scrub(1)
  const settled = await page.evaluate(uniforms)
  check(
    settled.transmission === 1 && settled.relief === 0 && settled.zoom === 1,
    `the crossing lands exactly ` +
      `(relief ${settled.relief}, transmission ${settled.transmission}, zoom ${settled.zoom})`,
  )
  const first = await page.evaluate(grab)
  await sleep(600)
  const second = await page.evaluate(grab)
  check(
    first.sum !== second.sum,
    `the arriving document keeps painting while parked at t=1 ` +
      `(luminance sum ${first.sum} → ${second.sum})`,
  )

  // ── nothing of the leaving document survives the landing ─────────────
  await scrub(0.02, 400)
  const beforeSwitch = await page.evaluate(grab)
  await page.evaluate(() => {
    const host = document.querySelector(
      '[data-munari-source-host][data-munari-surface="refraction-square"]',
    )
    host.querySelectorAll('.refraction-formbtn')[2].click()
  })
  await sleep(600)
  const afterSwitch = await page.evaluate(grab)
  // ── the midpoint is a front, not a crossfade ─────────────────────────
  // A global `mix(outgoing, incoming, t)` puts every pixel at half strength
  // halfway through: measured 2026-08-22, every changing cell was a blend of
  // both documents and none matched either, which is why the middle read as
  // ghosted. The aperture threshold leaves most of them whole. This clause
  // is what stops a future tuning pass from quietly reintroducing the
  // crossfade — nothing else here would notice.
  const pure = pureShare(beforeSwitch, first, midPixels)
  check(
    pure.share > PURE_FLOOR,
    `the midpoint is a front, not a blend ` +
      `(${(pure.share * 100).toFixed(0)}% of ${pure.cells} changing cells match one ` +
      `document exactly, floor ${PURE_FLOOR * 100}%)`,
  )

  const startDelta = diff(beforeSwitch, afterSwitch)
  check(
    startDelta > CHANGED,
    `switching the leaving figure changes the sheet at the start (${startDelta.toFixed(2)} > ${CHANGED})`,
  )

  await scrub(1)
  const landedGrid = await page.evaluate(grab)
  await page.evaluate(() => {
    const host = document.querySelector(
      '[data-munari-source-host][data-munari-surface="refraction-square"]',
    )
    host.querySelectorAll('.refraction-formbtn')[0].click()
  })
  await sleep(600)
  const landedSquare = await page.evaluate(grab)
  const endDelta = diff(landedGrid, landedSquare)
  check(
    endDelta < SETTLED,
    `and does not change it at the end (${endDelta.toFixed(2)} < ${SETTLED})`,
  )

  // ── the light answers the hand ───────────────────────────────────────
  await scrub(0.33, 400)
  const panel = await page.evaluate(() => {
    const r = document.querySelector('.refraction-holder').getBoundingClientRect()
    return { l: r.left, t: r.top, w: r.width, h: r.height }
  })
  await page.mouse.move(panel.l + panel.w * 0.18, panel.t + panel.h * 0.5)
  await sleep(250)
  const litLeft = await page.evaluate(grabLuma)
  await page.mouse.move(panel.l + panel.w * 0.82, panel.t + panel.h * 0.5)
  await sleep(250)
  const litRight = await page.evaluate(grabLuma)
  const moved =
    litLeft.filter((v, i) => Math.abs(v - litRight[i]) > LIT_STEP).length / litLeft.length
  check(
    moved > LIT_FLOOR,
    `the raking light follows the pointer ` +
      `(${(moved * 100).toFixed(2)}% of pixels moved by >${LIT_STEP}, floor ${LIT_FLOOR * 100}%)`,
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
  console.error(`\nrefraction-arriving gate FAILED (${problems.length})`)
  process.exit(1)
}
console.log('\nrefraction-arriving gate passed')
