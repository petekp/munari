// swap-pop — how much does the window change on the frame it stops
// being DOM and starts being a texture?
//
// The handoff is meant to be invisible. Everything else in this
// directory checks that the two copies are in the same PLACE at the same
// time; none of them checks that they LOOK the same, and place is the
// easier half. The sheet is drawn at t = 0 exactly over the window it
// came from, so on the takeover frame nothing moves at all — which means
// any difference a viewer sees there is pure appearance, arriving with
// no motion to hide it.
//
// It gets worse from there, and the reason is the easing. The minimize
// runs on easeInCubic, so the first third of its duration produces
// almost no travel: the swap lands, and then the window sits at its old
// position for something like 300ms before it visibly moves. Whatever
// changes on the swap frame is therefore held up for inspection rather
// than being carried off. "The window flickers at its original position"
// is what that looks like from a chair.
//
// The measurement is taken with the flight already begun and the pour
// still at ~0.002 — the sheet is up, the drive has not moved it. Two
// screenshots of one rectangle, and the useful number is not the average
// but the SPLIT between signed and absolute:
//
//   signed ≈ absolute   the canvas copy is uniformly paler or darker
//                       than the DOM's, which is a blend to fix
//   signed ≈ 0          the change is edges going both ways — two
//                       rasterizers disagreeing about text and hairlines,
//                       which no blend reconciles
//
// The ceilings below are a baseline measured on 2026-08-09, not a
// target. They exist so that a change which makes the swap MORE visible
// has to be argued for rather than merely committed.
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

// quadrato: frontmost of the cascade, so its rectangle is unobstructed,
// and its body is a drawn figure and a line of text — the two things a
// second rasterizer is most likely to render differently.
const WIN = 'quadrato'
// Long enough for the texture to have painted and the swap to have
// happened, short enough that easeInCubic has moved nothing.
const AFTER_MS = 70
// Measured 2026-08-09, viewport 1100x800, dSF 1: mean 3.43 absolute /
// 2.28 signed, 7.8% of pixels past 8 luma, 4.5% past 30.
const CEIL = { mean: 4.5, over8: 11, over30: 6.5 }

let server, browser
const deadline = setTimeout(() => {
  console.error('swap-pop: hard 120s deadline hit')
  process.exit(1)
}, 120_000)

const problems = []

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--enable-features=CanvasDrawElement', '--autoplay-policy=no-user-gesture-required'],
  })
  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  const page = await browser.newPage()
  await page.setViewport({ width: 1100, height: 800, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:${port}/?scene=genie`, { waitUntil: 'load' })
  await page.waitForFunction(
    () =>
      document.querySelector('.gen-slot[data-win="quadrato"]') && document.fonts.status === 'loaded',
    { timeout: 15_000 },
  )
  await sleep(800)
  // Only the caret. The bouncing shapes are deliberately NOT frozen: a
  // global animation pause desynchronizes the two copies' keyframes and
  // charges that to the swap, which is how this measurement first read
  // a peak of 170 on a window whose content had not moved.
  await page.addStyleTag({ content: '* { caret-color: transparent !important; }' })
  await sleep(150)

  const rect = await page.evaluate((w) => {
    const r = document.querySelector(`.gen-slot[data-win="${w}"] .gen-window`).getBoundingClientRect()
    return {
      x: Math.round(r.left) - 10,
      y: Math.round(r.top) - 10,
      width: Math.round(r.width) + 20,
      height: Math.round(r.height) + 20,
    }
  }, WIN)

  const before = await page.screenshot({ encoding: 'base64', clip: rect })
  await page.click(`.gen-slot[data-win="${WIN}"] .gen-lamp[data-role="minimize"]`)
  await sleep(AFTER_MS)
  const after = await page.screenshot({ encoding: 'base64', clip: rect })
  const pour = Number(
    await page.evaluate(
      (w) => document.querySelector(`.gen-tile[data-win="${w}"]`).style.getPropertyValue('--pour'),
      WIN,
    ) || 0,
  )

  const out = await page.evaluate(
    async (a, b) => {
      const load = async (s) => {
        const img = new Image()
        img.src = `data:image/png;base64,${s}`
        await img.decode()
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0)
        return ctx.getImageData(0, 0, img.width, img.height)
      }
      const A = await load(a)
      const B = await load(b)
      const { width: W, height: H } = A
      const L = (d, i) => (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8
      let sum = 0
      let signed = 0
      let peak = 0
      let peakAt = null
      let over8 = 0
      let over30 = 0
      // Sixteen tiles, so "where" comes back as a picture rather than a
      // coordinate — one hot tile is a component, an even spread is the
      // whole surface.
      const grid = Array.from({ length: 16 }, () => 0)
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4
          const raw = L(B.data, i) - L(A.data, i)
          const d = raw < 0 ? -raw : raw
          sum += d
          signed += raw
          if (d > 8) over8++
          if (d > 30) over30++
          if (d > peak) {
            peak = d
            peakAt = { x, y }
          }
          grid[Math.floor((y / H) * 4) * 4 + Math.floor((x / W) * 4)] += d
        }
      const n = W * H
      return {
        size: `${W}x${H}`,
        mean: sum / n,
        signed: signed / n,
        peak,
        peakAt,
        over8: (over8 / n) * 100,
        over30: (over30 / n) * 100,
        grid: grid.map((v) => v / (n / 16)),
      }
    },
    before,
    after,
  )

  console.log(`\n  ${WIN}, the frame the sheet takes over — pour ${pour.toFixed(3)}, rect ${out.size}`)
  console.log(`    mean change, absolute   ${out.mean.toFixed(2)} luma`)
  console.log(`    mean change, signed     ${out.signed >= 0 ? '+' : ''}${out.signed.toFixed(2)} luma`)
  console.log(`    peak                    ${out.peak} at ${out.peakAt.x},${out.peakAt.y}`)
  console.log(`    pixels past 8 luma      ${out.over8.toFixed(1)}%`)
  console.log(`    pixels past 30 luma     ${out.over30.toFixed(1)}%`)
  console.log('\n  where the change is (mean luma per sixteenth)')
  for (let r = 0; r < 4; r++)
    console.log('   ' + out.grid.slice(r * 4, r * 4 + 4).map((v) => v.toFixed(1).padStart(7)).join(''))

  if (pour > 0.02)
    problems.push(
      `the pour was already ${pour.toFixed(3)} when the second frame was taken — the sheet had MOVED, so ` +
        `this measured travel and not the swap`,
    )
  if (out.mean > CEIL.mean)
    problems.push(
      `the window changed by ${out.mean.toFixed(2)} luma on the swap frame, past the ${CEIL.mean} baseline`,
    )
  if (out.over8 > CEIL.over8)
    problems.push(
      `${out.over8.toFixed(1)}% of the window's pixels changed by more than 8 luma while it stood still, ` +
        `past the ${CEIL.over8}% baseline`,
    )
  if (out.over30 > CEIL.over30)
    problems.push(
      `${out.over30.toFixed(1)}% of pixels changed by more than 30 luma, past the ${CEIL.over30}% baseline`,
    )

  console.log(`\nswap-pop: ${problems.length === 0 ? 'PASS — the swap is no more visible than it was' : 'FAIL'}`)
  for (const p of problems) console.log(`  ${p}`)
  process.exit(problems.length === 0 ? 0 : 1)
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
