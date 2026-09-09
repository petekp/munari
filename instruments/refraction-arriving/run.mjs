// refraction-arriving gate — is the page you are arriving at really live,
// really the only thing on the sheet at the end of the crossing, and really
// handed back to the browser once it lands?
//
// The refraction scene puts two documents in one material. At most one is
// presented at a time; while the drop is open neither is, and both are
// resident sources, sampled by handle through `useSurfaceTextureOf` and
// drawn nowhere in the scene graph. Three claims hold the scene up, and all
// three fail silently:
//
//   1. The arriving document keeps painting while it is only being
//      sampled. If its capture stalls, the sheet still draws — it just
//      shows a picture. Nothing errors, and a still page looks correct.
//   2. At the end of the crossing the sheet is the ARRIVING document and
//      nothing else. A transmission that never reaches 1 leaves the
//      leaving page faintly on top forever, which reads as a soft mix
//      rather than a bug.
//   3. At t = 1 the crossing has LANDED: no mesh, and the arriving document
//      is ordinary DOM the browser hit-tests, focuses and selects. A scene
//      that lifts and never lands looks identical in a screenshot.
//
// The teeth for (2): switch the figure inside the LEAVING document —
// square to grid, the largest change its height field can take. At the
// start of the crossing the sheet must change. At the end it must not,
// because by then nothing of the leaving page is being drawn.
//
// The teeth for (1): both documents print the same shared clock, so a
// full-resolution luminance sum over the sheet must move while the crossing
// is parked at its end and nothing is touched.
//
// The teeth for (3), from Pete's report on 2026-08-22: count the meshes,
// read the GL rect over the sheet, and ask the browser for a caret at thirty
// points across it. Both halves are needed. A canvas that still covers the
// sheet passes the caret test on its own, because the pointer relay lets a
// hit through to the DOM underneath — which is exactly the state the scene
// was in when the report came in.
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
const MID = { relief: 0.81762, transmission: 0.5, zoom: 1.0625 }
const MID_TOL = 1e-3
// Below this the figure switch did not reach the sheet at all; the
// measured value with a live leaving page is ≈6.8 (2026-08-22).
const CHANGED = 2.0
// Above this the leaving page is still contributing at the end of the
// crossing. Not zero: both documents print a clock, and the arriving
// one's digits move between the two grabs.
const SETTLED = 0.5

/** Luminance gap that counts a cell as showing different content. */
const CONTENT = 20

/** Luminance gap under which a cell counts as matching a document exactly. */
const NEAR = 4

/**
 * How many of the changing cells must be whole at the midpoint.
 *
 * A global crossfade scores 0 here by construction — every pixel is a blend
 * of both, and a crossfade behind the same glass still scores 0, because a
 * reflection does not make a cell match a document.
 *
 * The glass is why this number is not 100%. Everything optical — the bend,
 * the dispersion, the room reflection, the rim — lives on the drop's
 * meniscus, which is a thin band, so most of what the drop covers is the
 * arriving page shown straight. Measured 2026-08-22 at the committed
 * tuning: 59%, and 59% again with the mirror dragged to 0 and to its
 * maximum, because a knob that only paints the meniscus cannot move a
 * whole-cell score. This floor is set well under that so retuning the drop
 * has room, and no blend can reach it.
 *
 * The same front scored 37% before the rewrite that day, when the glass was
 * a relief of the leaving page's ink and the reflection sat on every glyph
 * edge on the sheet.
 */
const PURE_FLOOR = 0.25

/**
 * The last scrub position that is still a lift, one step short of the end.
 *
 * The input's own `step` is 0.001, so this is as close to the landing as the
 * gate can park without taking it. Everything that reads the sheet's PIXELS
 * at the end of the crossing reads here; t = 1 has no sheet to read.
 */
const END = 0.999

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

  // What the browser owns over the sheet, and what it will let a user do
  // there. Points are sampled across the holder rather than at its centre: a
  // single probe lands in a margin often enough to pass a broken landing.
  const handoff = () => {
    const { gl, scene, camera } = window.__r3f
    let meshes = 0
    scene.traverse((o) => {
      if (o.isMesh && o.material?.uniforms?.uTransmission) meshes++
    })
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
    let opaque = 0
    for (let i = 0; i < w * h; i++) if (px[i * 4 + 3] > 200) opaque++

    const docs = new Set()
    let points = 0
    let carets = 0
    for (let fy = 0.12; fy < 0.92; fy += 0.16) {
      for (let fx = 0.06; fx < 0.62; fx += 0.11) {
        points++
        const range = document.caretRangeFromPoint?.(
          Math.round(r.left + r.width * fx),
          Math.round(r.top + r.height * fy),
        )
        const node = range?.startContainer
        const el = node ? (node.nodeType === 1 ? node : node.parentElement) : null
        const doc = el?.closest('[data-doc]')
        if (!doc) continue
        carets++
        docs.add(doc.getAttribute('data-doc'))
      }
    }
    return { meshes, opaque, points, carets, docs: [...docs].sort() }
  }

  const clocks = () =>
    [...document.querySelectorAll('[data-munari-source-host]')].map((host) => ({
      surface: `${host.getAttribute('data-munari-surface')}/${host.getAttribute('data-munari-part')}`,
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
    named.includes('refraction/leaving') && named.includes('refraction/arriving'),
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
  // Parked one scrub step short of the end, not at it. At t = 1 the crossing
  // has LANDED: the mesh is gone and the arriving document is ordinary DOM,
  // so there is no texture left to sample and a GL read returns an empty
  // rect. 0.999 is the last position where the sheet is still drawn from a
  // texture, and the picture there is the landing's — measured 2026-08-22,
  // relief 8.3e-16, transmission 0.999997, zoom 1.0000007.
  await scrub(END)
  const settled = await page.evaluate(uniforms)
  check(
    settled.transmission > 1 - 1e-5 && settled.relief < 1e-9 && settled.zoom < 1 + 1e-5,
    `the crossing reaches its end ` +
      `(relief ${settled.relief.toExponential(1)}, ` +
      `transmission ${settled.transmission.toFixed(6)}, zoom ${settled.zoom.toFixed(6)})`,
  )
  const first = await page.evaluate(grab)
  await sleep(600)
  const second = await page.evaluate(grab)
  check(
    first.sum !== second.sum,
    `the arriving document keeps painting while it is only being sampled ` +
      `(luminance sum ${first.sum} → ${second.sum})`,
  )

  // ── the crossing lands back in the compositor's hold ──────────────────
  // The defect this pins, from Pete's report on 2026-08-22: the scene lifted
  // at any t above zero and never landed on the far side, so a GL layer sat
  // over the page forever and none of the arriving document's words could be
  // selected. They had never been anywhere but a texture.
  //
  // Both halves are checked because either alone passes while broken. A
  // canvas that still covers the sheet passes the caret test, since the
  // relay lets a hit through to the DOM underneath — that is exactly the
  // state this scene was in when the report came in.
  await scrub(1, 900)
  const landing = await page.evaluate(handoff)
  check(
    landing.meshes === 0 && landing.opaque === 0,
    `the sheet goes back to the compositor at t=1 ` +
      `(${landing.meshes} meshes, ${landing.opaque} opaque GL px over the holder)`,
  )
  check(
    landing.carets === landing.points && landing.docs.join() === 'II',
    `and the arriving document is selectable DOM ` +
      `(${landing.carets}/${landing.points} points take a caret, in [${landing.docs}])`,
  )

  // ── nothing of the leaving document survives the landing ─────────────
  await scrub(0.02, 400)
  const beforeSwitch = await page.evaluate(grab)
  await page.evaluate(() => {
    const host = document.querySelector(
      '[data-munari-source-host][data-munari-surface="refraction"][data-munari-part="leaving"]',
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

  await scrub(END)
  const landedGrid = await page.evaluate(grab)
  await page.evaluate(() => {
    const host = document.querySelector(
      '[data-munari-source-host][data-munari-surface="refraction"][data-munari-part="leaving"]',
    )
    host.querySelectorAll('.refraction-formbtn')[0].click()
  })
  await sleep(600)
  const landedSquare = await page.evaluate(grab)
  const endDelta = diff(landedGrid, landedSquare)
  check(
    endDelta < SETTLED,
    `and does not change the sheet at the end of the crossing ` +
      `(${endDelta.toFixed(2)} < ${SETTLED})`,
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
