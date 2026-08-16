// veil-resize probe — turns "the veil de-syncs on horizontal resize"
// into numbers. Transport mirrors instruments/idle-zero/run.mjs.
//
// The failure being hunted: during a horizontal drag the band blends a
// COPY of the article from one layout generation over a LIVE page from a
// newer one, and the fade zone shows both — text doubled at a horizontal
// offset (observed 2026-08-08, and captured by this probe's first
// version). Gross pixel change cannot detect it: legitimate blur softens
// text MORE than faint ghosts add, so "diff vs bare page" scores the bug
// BELOW an honest veil. The lawful-state metric instead:
//
//   At every width w, a frame of the fade zone is lawful iff it is close
//   to ONE of the two references at w: the bare page (band absent — the
//   gate's honest posture while a fresh capture is in flight) or the
//   settled band (correct blur). A ghost frame is far from BOTH.
//
//   wrongness(frame, w) = min(MAD(frame, bare[w]), MAD(frame, band[w]))
//
// Drag pass: step the viewport width and screenshot IMMEDIATELY after
// each step — the screenshot rides 1-2 frames behind the layout change,
// inside the capture pipeline's lag window. Verdict:
//
//   max wrongness over drag steps ≤ max(4×noise, 1.0)   no ghost frames
//
// Two regions, one per question. Ghosting lives in the FADE rows (the
// band's top ~35px, partial alpha — a stale copy doubles the text
// there), so wrongness is measured there. But those same rows are
// where the blur is honestly near-invisible (sub-pixel radius, low
// alpha): band-vs-bare runs ~0.6 MAD, useless for certifying the blur
// came back. The restored check reads DEEPER rows (60–120 into the
// band, radius several px, alpha ~1), where presence is unmistakable:
//
//   settled MAD vs bandB[W1]     ≤ max(4×noiseB, 1.0)   blur came BACK
//   settled MAD vs bareB[W1]     ≥ 2.0                  ...really back
//
// noise = MAD between two settled band shots at the same region.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const labRoot = path.join(repoRoot, 'apps', 'lab')
const OUT = process.env.PROBE_OUT ?? path.join(here, 'out')

const W0 = 1000
const H = 800
const BAND_H = 180
const STEPS = [1050, 1100, 1150, 1200, 1250, 1300, 1350, 1400]
const W1 = STEPS[STEPS.length - 1]
// The fade zone's mid-alpha rows: the copy carries real weight there
// (alpha ~0.2–0.8) and a stale generation is visible against the live
// page under it.
const REGION_Y = H - BAND_H + 10
const REGION_H = 35
const REGION_W = 600
// The deep rows for the restored check: radius is several px and the
// band has fully replaced the page, so blur presence is a big signal.
const REGION_B_Y = H - BAND_H + 60
const REGION_B_H = 60
const SCROLL = 150
// How long after the drag ends the blur may take to return. Generous for
// the repro; the fix pins its own perceptual budget in veilLaw.
const RESTORE_MS = 500

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean)

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chromePath) {
  console.error('veil-resize probe: no Chrome executable found (set CHROME_PATH)')
  process.exit(1)
}

const LAUNCH_ARGS = [
  '--enable-features=CanvasDrawElement',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function probeCapability(browser) {
  const page = await browser.newPage()
  const capable = await page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d')
    return ctx !== null && 'drawElementImage' in ctx
  })
  await page.close()
  return capable
}

async function launch(headless) {
  return puppeteer.launch({ executablePath: chromePath, headless, args: LAUNCH_ARGS })
}

let server
let browser
const deadline = setTimeout(() => {
  console.error('veil-resize probe: hard 180s deadline hit')
  process.exit(1)
}, 180_000)

try {
  browser = await launch(true)
  let capable = await probeCapability(browser)
  if (!capable) {
    await browser.close()
    browser = await launch(false)
    capable = await probeCapability(browser)
    if (capable) console.log('veil-resize: capability present headed only — measuring headed')
  }
  if (!capable) {
    console.error(`veil-resize probe: Chrome at ${chromePath} has no drawElementImage`)
    process.exit(1)
  }

  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  const page = await browser.newPage()
  const pageProblems = []
  page.on('pageerror', (err) => pageProblems.push(String(err)))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
      pageProblems.push(m.text())
  })

  await page.setViewport({ width: W0, height: H, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:${port}/?scene=veil`, { waitUntil: 'load' })
  await page.waitForFunction(
    () => {
      const s = window.__munari?.stats().find((x) => x.label === 'veil-sheet')
      return s && s.paints > 0 && document.fonts.status === 'loaded'
    },
    { timeout: 15_000 },
  )
  await page.evaluate((y) => {
    document.querySelector('.veil-page').scrollTop = y
  }, SCROLL)
  await sleep(800)

  const clocks = () =>
    page.evaluate(() => {
      const parked = [...document.querySelectorAll('canvas')].find(
        (c) => c.style.zIndex === '-1',
      )
      const sheet = document.querySelector('.veil-sheet')
      return {
        parkedCssW: parked ? parseFloat(parked.style.width) : null,
        parkedStoreW: parked?.width ?? null,
        liveSheetW: sheet?.offsetWidth ?? null,
        viewW: window.innerWidth,
      }
    })
  const setSlab = (visible) =>
    page.evaluate((v) => {
      document.querySelector('.veil-slab').style.visibility = v ? '' : 'hidden'
    }, visible)
  const shot = (w, name, y = REGION_Y, h = REGION_H) =>
    page
      .screenshot({
        clip: { x: (w - REGION_W) / 2, y, width: REGION_W, height: h },
        encoding: 'base64',
        // Without this, a clipped screenshot applies a device-metrics
        // override that transiently REFLOWS the page (the sheet collapses
        // to ~1px wide; observed via the gate's frame log, 2026-08-08).
        // The live page's resize observer reports the garbage box, the
        // capture repaints at it, and the generation gate — correctly —
        // closes and restarts its return ramp. Every shot would knock the
        // system into the exact transient this probe exists to observe:
        // the camera flash must not shove the specimen.
        captureBeyondViewport: false,
      })
      .then((b64) => {
        writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(b64, 'base64'))
        return b64
      })

  mkdirSync(OUT, { recursive: true })

  // Reference pass: at each width, the two lawful appearances of the
  // fade zone — settled band and bare page.
  const bandRef = {}
  const bareRef = {}
  for (const w of STEPS) {
    await page.setViewport({ width: w, height: H, deviceScaleFactor: 1 })
    await sleep(700)
    bandRef[w] = await shot(w, `ref-band-${w}`)
    await setSlab(false)
    await sleep(120)
    bareRef[w] = await shot(w, `ref-bare-${w}`)
    await setSlab(true)
    await sleep(120)
  }
  // Second settled shot at W1 for the noise floor.
  const bandRefB = await shot(W1, `ref-band-${W1}-b`)
  // Deep-row references at W1 for the restored check, plus its own
  // noise pair (the viewport is already parked at W1, band settled).
  const deepBand = await shot(W1, 'ref-deep-band', REGION_B_Y, REGION_B_H)
  const deepBand2 = await shot(W1, 'ref-deep-band-b', REGION_B_Y, REGION_B_H)
  await setSlab(false)
  await sleep(120)
  const deepBare = await shot(W1, 'ref-deep-bare', REGION_B_Y, REGION_B_H)
  await setSlab(true)
  await sleep(120)

  // Back to W0 and settle, then the drag: step and shoot immediately.
  await page.setViewport({ width: W0, height: H, deviceScaleFactor: 1 })
  await sleep(1200)
  const dragShots = {}
  let midClocks = null
  for (const w of STEPS) {
    await page.setViewport({ width: w, height: H, deviceScaleFactor: 1 })
    dragShots[w] = await shot(w, `drag-${w}`)
    if (w === STEPS[3]) midClocks = await clocks()
  }
  await sleep(RESTORE_MS)
  const settledShot = await shot(W1, 'settled')
  const settledDeep = await shot(W1, 'settled-deep', REGION_B_Y, REGION_B_H)
  const settledClocks = await clocks()

  // Pixel math in a throwaway page — no image deps in node.
  const diffPage = await browser.newPage()
  const mad = (a, b) =>
    diffPage.evaluate(
      async (b64a, b64b) => {
        const load = (b64) =>
          new Promise((res, rej) => {
            const i = new Image()
            i.onload = () => res(i)
            i.onerror = rej
            i.src = 'data:image/png;base64,' + b64
          })
        const [ia, ib] = await Promise.all([load(b64a), load(b64b)])
        const w = Math.min(ia.width, ib.width)
        const h = Math.min(ia.height, ib.height)
        const px = (img) => {
          const c = document.createElement('canvas')
          c.width = w
          c.height = h
          const x = c.getContext('2d')
          x.drawImage(img, 0, 0)
          return x.getImageData(0, 0, w, h).data
        }
        const da = px(ia)
        const db = px(ib)
        let s = 0
        for (let i = 0; i < da.length; i += 4)
          s += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])
        return s / (da.length / 4) / 3
      },
      a,
      b,
    )

  const noise = await mad(bandRef[W1], bandRefB)
  const thresh = Math.max(4 * noise, 1.0)

  const steps = []
  for (const w of STEPS) {
    const toBare = await mad(dragShots[w], bareRef[w])
    const toBand = await mad(dragShots[w], bandRef[w])
    steps.push({ w, toBare: +toBare.toFixed(3), toBand: +toBand.toFixed(3), wrong: +Math.min(toBare, toBand).toFixed(3) })
  }
  const worst = steps.reduce((a, b) => (b.wrong > a.wrong ? b : a))
  const settledToBand = await mad(settledShot, bandRef[W1])
  const settledToBare = await mad(settledShot, bareRef[W1])
  const noiseB = await mad(deepBand, deepBand2)
  const threshB = Math.max(4 * noiseB, 1.0)
  const settledToBandB = await mad(settledDeep, deepBand)
  const settledToBareB = await mad(settledDeep, deepBare)

  const result = {
    noise: +noise.toFixed(3),
    thresh: +thresh.toFixed(3),
    steps,
    worst: { w: worst.w, wrong: worst.wrong },
    settledToBand: +settledToBand.toFixed(3),
    settledToBare: +settledToBare.toFixed(3),
    deep: {
      noise: +noiseB.toFixed(3),
      thresh: +threshB.toFixed(3),
      settledToBand: +settledToBandB.toFixed(3),
      settledToBare: +settledToBareB.toFixed(3),
    },
    midClocks,
    settledClocks,
  }
  console.log(JSON.stringify(result, null, 2))
  if (pageProblems.length) {
    console.error('page errors during the run:')
    for (const p of pageProblems) console.error(`  ${p}`)
    process.exit(1)
  }

  const ghostFree = worst.wrong <= thresh
  const restored = settledToBandB <= threshB && settledToBareB >= 2.0
  console.log(
    `veil-resize: worst wrongness ${worst.wrong} @${worst.w}px (thresh ${thresh.toFixed(3)}) ` +
      `${ghostFree ? 'GHOST-FREE' : 'GHOSTING'}; deep settled toBand=${settledToBandB.toFixed(3)} ` +
      `toBare=${settledToBareB.toFixed(3)} ${restored ? 'RESTORED' : 'NOT RESTORED'}`,
  )
  process.exit(ghostFree && restored ? 0 : 1)
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
