// capture-engines gate runner — the same laws judged once per installed
// engine. See main.ts for what is measured; this file is transport: find
// Chrome, drive the page once per engine, judge the numbers.
//
// Capability policy differs per engine, and that difference is the point.
// HTML-in-canvas rests on an origin trial, so its absence is environmental
// (the gate warns and exits 0; STRICT_CAPABILITY=1 makes it a failure).
// snapDOM needs nothing but a document, so a snapDOM failure is always a
// real failure — which is what makes this gate runnable on a machine that
// cannot run `idle-zero` at all.
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean)

const strict = process.env.STRICT_CAPABILITY === '1'

function skip(reason) {
  const msg = `capture-engines gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : msg)
  if (strict) {
    console.error('STRICT_CAPABILITY=1 — treating the gap as a failure.')
    process.exit(1)
  }
  process.exit(0)
}

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chromePath) skip('no Chrome executable found (set CHROME_PATH)')

const LAUNCH_ARGS = [
  '--enable-features=CanvasDrawElement',
  // A backgrounded renderer stops compositing, and a gate that reads "no
  // paints" must never let throttling manufacture that result.
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  ...(process.env.CI ? ['--no-sandbox'] : []),
]

// Per-channel slack against the CSS colors. snapDOM rasterizes through an
// SVG image, so a flat fill sampled well inside its half is exact on both
// engines; the slack is for a resampling filter, not for a wrong color.
const FIDELITY_TOLERANCE = 4

// Cross-engine parity is judged on 4x-downsampled images, and the block is
// the whole point. SVG-foreignObject rasterization and direct compositing
// disagree on glyph and hairline EDGES by a subpixel — full-contrast on one
// pixel, gone by the next — while a structural fault is wrong across whole
// blocks. Averaging 4x4 first collapses the former and leaves the latter.
//
// The two stages get different laws because their floors differ, measured
// 2026-09-11 on the fixture in main.ts:
//
//   rest    — whole-number density, so the two engines land on the same
//             grid and there is no floor at all. 0 blocks differ; with the
//             field pseudo-element shim removed, 7 (worst 156).
//   carried — 2.4x across and 0.957x down, neither a whole number, so every
//             glyph edge falls between samples and a residue is expected.
//             Block mean 2.00 (worst 48); with the rasterizer answering at
//             its own size and the source stretching it, 37.59 (worst 255).
//             The budget sits between, nearer the floor.
const PARITY_BLOCK = 4
const PARITY_SLACK = 24
const CARRIED_MEAN_BUDGET = 6

let server
let browser
const deadline = setTimeout(() => {
  console.error('capture-engines gate: hard 180s deadline hit')
  process.exit(1)
}, 180_000)

const failures = []
const expect = (cond, message) => {
  if (!cond) failures.push(message)
}

async function measure(port, engine, reference) {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument((block, slack) => {
    window.PARITY_BLOCK = block
    window.PARITY_SLACK = slack
  }, PARITY_BLOCK, PARITY_SLACK)
  const pageProblems = []
  page.on('pageerror', (err) => pageProblems.push(String(err)))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
      pageProblems.push(m.text())
  })

  await page.goto(`http://localhost:${port}/?engine=${engine}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__captureEngines?.ready === true, { timeout: 20_000 })
  const available = await page.evaluate(() => window.__captureEngines.available)
  if (!available) {
    await page.close()
    return { available: false, pageProblems }
  }
  const report = await page.evaluate(() => window.__captureEngines.run())
  const fields = await page.evaluate(async () => {
    const f = await window.__captureEngines.fields()
    window.__lastFieldUrl = f.url
    window.__lastCarriedUrl = f.carried
    return f
  })
  // Compare against whatever a previous engine drew, in the page, where a
  // canvas can decode a PNG without a Node image dependency.
  let parity = null
  if (reference) {
    parity = await page.evaluate(async (ref) => {
      const compare = async (refUrl, mineUrl) => {
      const mine = document.createElement('canvas')
      const theirs = document.createElement('canvas')
      const load = (url) => new Promise((res, rej) => {
        const img = new Image()
        img.onload = () => res(img)
        img.onerror = () => rej(new Error('reference PNG did not decode'))
        img.src = url
      })
      const [a, b] = await Promise.all([load(refUrl), load(mineUrl)])
      if (a.width !== b.width || a.height !== b.height)
        return { sizeMismatch: [a.width, a.height, b.width, b.height] }
      for (const [c, img] of [[mine, b], [theirs, a]]) {
        c.width = img.width; c.height = img.height
        c.getContext('2d').drawImage(img, 0, 0)
      }
      const A = theirs.getContext('2d').getImageData(0, 0, a.width, a.height).data
      const B = mine.getContext('2d').getImageData(0, 0, a.width, a.height).data
      const K = window.PARITY_BLOCK
      const bw = Math.ceil(a.width / K), bh = Math.ceil(a.height / K)
      let worst = 0, over = 0, sum = 0
      for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
          const mean = [0, 0, 0, 0, 0, 0, 0, 0]
          let n = 0
          for (let y = by * K; y < Math.min((by + 1) * K, a.height); y++) {
            for (let x = bx * K; x < Math.min((bx + 1) * K, a.width); x++) {
              const i = (y * a.width + x) * 4
              for (let c = 0; c < 4; c++) { mean[c] += A[i + c]; mean[c + 4] += B[i + c] }
              n++
            }
          }
          let d = 0
          for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(mean[c] - mean[c + 4]) / n)
          sum += d
          if (d > worst) worst = d
          if (d > window.PARITY_SLACK) over++
        }
      }
      return { worst: Math.round(worst), over, pixels: bw * bh, mae: sum / (bw * bh) }
      }
      return {
        rest: await compare(ref.url, window.__lastFieldUrl),
        carried: await compare(ref.carried, window.__lastCarriedUrl),
      }
    }, reference)
  }
  await page.close()
  return { available: true, report, fields, parity, pageProblems }
}

function judge(name, r) {
  const at = (law) => `${name}: ${law}`
  expect(r.engine === name, at(`the page installed "${r.engine}", not this engine`))
  expect(
    r.fidelityError <= FIDELITY_TOLERANCE,
    at(`capture is not the DOM's colors — worst channel off by ${r.fidelityError} ` +
      `(left ${r.leftPixel}, right ${r.rightPixel})`),
  )
  expect(
    r.idleDelta === 0,
    at(`a still subtree painted ${r.idleDelta} times in ${r.idleWindowMs}ms — ` +
      `something added a repaint loop`),
  )
  expect(
    r.burstPaints >= 1 && r.burstPaints <= 2,
    at(`${r.burstMutations} mutations in one task produced ${r.burstPaints} paints ` +
      `(want 1, or 2 for the running-plus-owed pair)`),
  )
  expect(r.hiddenAtBirth, at('the host painted its own pixels before anyone asked'))
  expect(r.paintedWhenAsked, at('setHostPainted(true) did not show the host'))
  expect(r.hiddenWhenUnasked, at('setHostPainted(false) did not hide the host'))
  expect(r.parking.position === 'fixed', at(`parked host is ${r.parking.position}, not fixed`))
  expect(
    r.parking.left === '0px' && r.parking.top === '0px',
    at(`parked host sits at ${r.parking.left},${r.parking.top}, not the viewport origin`),
  )
  expect(
    r.parking.pointerEvents === 'none',
    at(`parked host takes pointer events (${r.parking.pointerEvents})`),
  )
  expect(
    r.parking.box[0] === 240 && r.parking.box[1] === 140,
    at(`parked host box is ${r.parking.box}, not the asked-for 240x140`),
  )
  expect(
    r.resizedReceipt?.[0] === r.resizedBox[0] && r.resizedReceipt?.[1] === r.resizedBox[1],
    at(`receipt after resize names ${r.resizedReceipt}, not the box ${r.resizedBox}`),
  )
  expect(
    r.settledStore[0] === r.resizedBox[0] && r.settledStore[1] === r.resizedBox[1],
    at(`resettle left the store at ${r.settledStore}, not exactly ${r.resizedBox}`),
  )
  expect(r.errors === 0, at(`${r.errors} capture failures (${r.lastError ?? 'no message'})`))
}

try {
  browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: LAUNCH_ARGS })

  server = await createServer({
    configFile: false,
    root: here,
    logLevel: 'warn',
    resolve: {
      alias: { '@munari/core': path.join(repoRoot, 'packages', 'core', 'src', 'index.ts') },
    },
    server: { port: 0, fs: { allow: [repoRoot] } },
  })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  const results = []
  let reference = null
  for (const engine of ['html-in-canvas', 'snapdom']) {
    const { available, report, fields, parity, pageProblems } = await measure(port, engine, reference)
    if (pageProblems.length) {
      console.error(`page errors under ${engine}:`)
      for (const p of pageProblems) console.error(`  ${p}`)
      failures.push(`${engine}: the page reported errors`)
    }
    if (!available) {
      // Only the trial engine is allowed to be missing.
      if (engine !== 'html-in-canvas') failures.push(`${engine}: reported itself unavailable`)
      else {
        const msg = `capture-engines: html-in-canvas unavailable at ${chromePath} — measuring snapDOM only`
        console.warn(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : msg)
        if (strict) failures.push('STRICT_CAPABILITY=1 and html-in-canvas is absent')
      }
      continue
    }
    judge(engine, report)
    for (const [stage, result] of Object.entries(parity ?? {})) {
      if (result.sizeMismatch) {
        failures.push(`${engine}: ${stage} fixture rastered ${result.sizeMismatch.slice(2)}, ` +
          `not the reference engine's ${result.sizeMismatch.slice(0, 2)}`)
        continue
      }
      console.log(
        `  ${engine.padEnd(15)} vs ${reference.engine}, ${stage.padEnd(7)}: ` +
          `${PARITY_BLOCK}x blocks — mean ${result.mae.toFixed(2)}, worst ${result.worst}, ` +
          `${result.over}/${result.pixels} over ${PARITY_SLACK}`,
      )
      if (stage === 'carried')
        expect(
          result.mae <= CARRIED_MEAN_BUDGET,
          `${engine}: the carried fixture does not match ${reference.engine} — block mean ` +
            `${result.mae.toFixed(2)} over a budget of ${CARRIED_MEAN_BUDGET} (worst ` +
            `${result.worst}). A rasterizer that answers at its own size and lets the source ` +
            `stretch it is the usual cause.`,
        )
      else
        expect(
          result.over === 0,
          `${engine}: the rest fixture does not match ${reference.engine} — ${result.over} of ` +
            `${result.pixels} ${PARITY_BLOCK}x${PARITY_BLOCK} blocks differ by more than ` +
            `${PARITY_SLACK} (worst ${result.worst}). A form field's ::after or ::placeholder ` +
            `is the usual cause.`,
        )
    }
    // A parity failure is a picture, not a number. Write both so the next
    // reader can see which element moved rather than re-deriving it.
    const failedStage = (stage, r) =>
      r.sizeMismatch || (stage === 'carried' ? r.mae > CARRIED_MEAN_BUDGET : r.over > 0)
    if (parity && Object.entries(parity).some(([stage, r]) => failedStage(stage, r))) {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'capture-engines-'))
      for (const [stage, refUrl, mineUrl] of [
        ['rest', reference.url, fields.url],
        ['carried', reference.carried, fields.carried],
      ]) {
        writeFileSync(path.join(dir, `${stage}-${reference.engine}.png`), Buffer.from(refUrl.split(',')[1], 'base64'))
        writeFileSync(path.join(dir, `${stage}-${engine}.png`), Buffer.from(mineUrl.split(',')[1], 'base64'))
      }
      console.error(`  fixtures written to ${dir}`)
    }
    reference ??= { engine, url: fields.url, carried: fields.carried }
    results.push(report)
  }

  console.log('\ncapture-engines — the same laws, once per engine:')
  for (const r of results) {
    console.log(
      `  ${r.engine.padEnd(15)} native=${r.native}  fidelity ${r.fidelityError}/255  ` +
        `idle +${r.idleDelta}/${r.idleWindowMs}ms  burst ${r.burstMutations}→${r.burstPaints} paints  ` +
        `store ${r.movingStore.join('x')} → ${r.settledStore.join('x')}`,
    )
  }

  if (failures.length) {
    console.error('\ncapture-engines gate FAILED:')
    for (const f of failures) console.error(`  ${f}`)
    process.exit(1)
  }
  console.log(`capture-engines gate PASSED: ${results.length} engine(s) held every law.`)
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
