// texture-uploads probe runner — counts the WebGL uploads each changed image
// costs and checks that the drawn pixels are the current ones.
//
// An upload is counted where WebGL receives it, so the number is what the GPU
// was sent and not what the runtime armed. The same hook drops uploads on
// request, which is the deliberate fault the pixel check has to catch.
//
// What it judges, per engine and per resolution (1 and 0.5 are pinned and
// mipmapped, `auto` is neither):
//   - after every change the Surface shows the new color,
//   - a dropped upload is caught: the pixel check must report the old color,
//   - on snapDOM a change that keeps its size costs one upload per paint.
// The HTML-in-canvas counts and the resize counts are printed, not judged.
//
// Limits: one 240x120 Surface on one renderer, flat colors, a demand
// frameloop. It does not measure upload time, memory, or a lit material's
// encoded view, and a flat color cannot show a partly drawn image.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const output = process.env.TEXTURE_UPLOADS_OUTPUT ?? path.join(tmpdir(), 'munari-texture-uploads')
const strict = process.env.STRICT_CAPABILITY === '1'
const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean).find((candidate) => existsSync(candidate))
if (!chromePath) {
  console.error('texture-uploads probe: no Chrome executable found (set CHROME_PATH)')
  process.exit(1)
}

const STEPS = 6
// Longer than a live source's 250 ms capture period plus the frame that
// uploads it, so a late second upload is counted with the change it follows.
const SETTLE_MS = 600
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// The fixture is pure red or pure blue. The margins allow color conversion in
// the screenshot and never admit the other color.
const shows = (color, blue) => (blue ? color[2] > 200 && color[0] < 60 : color[0] > 200 && color[2] < 60)

// Runs in the page before its own scripts, the way shader-compile hooks
// `compileShader`. Counts every upload whose source is a canvas.
function countCanvasUploads() {
  const count = { uploads: 0, drop: false }
  window.__uploadCount = count
  for (const name of ['texImage2D', 'texSubImage2D']) {
    const real = WebGL2RenderingContext.prototype[name]
    WebGL2RenderingContext.prototype[name] = function (...args) {
      if (args.some((arg) => arg instanceof HTMLCanvasElement)) {
        count.uploads += 1
        if (count.drop) return
      }
      real.apply(this, args)
    }
  }
}

let server
let browser
const deadline = setTimeout(() => {
  console.error('texture-uploads probe: hard 300s deadline hit')
  process.exit(1)
}, 300_000)

try {
  await mkdir(output, { recursive: true })
  server = await createServer({
    configFile: false,
    root: here,
    cacheDir: path.join(output, '.vite'),
    esbuild: { jsx: 'automatic' },
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: 0, fs: { allow: [repoRoot] } },
  })
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`

  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--enable-features=CanvasDrawElement',
      '--enable-unsafe-swiftshader',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })

  // Decodes each screenshot, so the page under test is not touched to read it.
  const reader = await browser.newPage()
  const capable = await reader.evaluate(() => 'drawElementImage' in document.createElement('canvas').getContext('2d'))
  if (!capable) {
    const message = `texture-uploads probe: Chrome at ${chromePath} has no drawElementImage, so HTML-in-canvas is unmeasured`
    console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message)
    if (strict) throw new Error('STRICT_CAPABILITY=1: the HTML-in-canvas engine could not be measured')
  }

  // The mean color of a 10x10 CSS pixel block at the middle of the mesh.
  const centerColor = async (page) => {
    const png = await page.screenshot({ encoding: 'base64', clip: { x: 295, y: 195, width: 10, height: 10 } })
    return reader.evaluate(async (data) => {
      const image = new Image()
      image.src = `data:image/png;base64,${data}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      const sum = [0, 0, 0]
      for (let i = 0; i < pixels.length; i += 4) {
        sum[0] += pixels[i]
        sum[1] += pixels[i + 1]
        sum[2] += pixels[i + 2]
      }
      return sum.map((channel) => Math.round(channel / (pixels.length / 4)))
    }, png)
  }

  const rows = []
  const problems = []
  for (const engine of capable ? ['snapdom', 'html-in-canvas'] : ['snapdom']) {
    for (const resolution of ['1', '0.5', 'auto']) {
      for (const scenario of ['change', 'resize', 'dropped-upload']) {
        const name = `${engine} · resolution ${resolution} · ${scenario}`
        const page = await browser.newPage()
        const errors = []
        page.on('pageerror', (error) => errors.push(String(error)))
        try {
          await page.evaluateOnNewDocument(countCanvasUploads)
          await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 2 })
          await page.goto(`${origin}/?engine=${engine}&resolution=${resolution}`, { waitUntil: 'load' })
          await page.waitForFunction(() => window.__uploadCount.uploads >= 1, { timeout: 20_000 })
          await sleep(900)
          const born = await centerColor(page)
          if (!shows(born, false)) problems.push(`${name}: the first image drew ${born}, not red`)

          const steps = []
          let state = { blue: false, big: false }
          for (let index = 0; index < STEPS; index++) {
            state = { blue: !state.blue, big: scenario === 'resize' ? !state.big : false }
            const dropped = scenario === 'dropped-upload' && index === STEPS - 1
            const before = await page.evaluate((next, drop) => {
              window.__uploadCount.uploads = 0
              window.__uploadCount.drop = drop
              const paints = window.__uploadFixture.paints()
              window.__uploadFixture.set(next)
              return paints
            }, state, dropped)
            await page.waitForFunction(
              (paints) => window.__uploadFixture.paints() > paints && window.__uploadCount.uploads >= 1,
              { timeout: 20_000 },
              before,
            )
            await sleep(SETTLE_MS)
            const seen = await page.evaluate(() => ({ paints: window.__uploadFixture.paints(), uploads: window.__uploadCount.uploads }))
            const color = await centerColor(page)
            steps.push({ ...state, dropped, paints: seen.paints - before, uploads: seen.uploads, color })
          }

          for (const [index, step] of steps.entries()) {
            const current = shows(step.color, step.blue)
            if (step.dropped) {
              if (current) problems.push(`${name}: step ${index} dropped its uploads and the pixel check still passed`)
              continue
            }
            if (!current) problems.push(`${name}: step ${index} drew ${step.color}, not ${step.blue ? 'blue' : 'red'}`)
            if (engine === 'snapdom' && scenario === 'change' && step.uploads !== step.paints) {
              problems.push(`${name}: step ${index} made ${step.uploads} uploads for ${step.paints} paint(s)`)
            }
          }
          for (const error of errors) problems.push(`${name}: ${error}`)
          rows.push({ engine, resolution, scenario, errors, steps })
          console.log(`  ${name.padEnd(52)} uploads ${steps.map((step) => step.uploads).join(' ')}  paints ${steps.map((step) => step.paints).join(' ')}`)
        } finally {
          await page.close()
        }
      }
    }
  }

  await writeFile(path.join(output, 'results.json'), JSON.stringify({ browser: await browser.version(), rows, problems }, null, 2))
  assert.equal(rows.length, (capable ? 2 : 1) * 9, 'Every engine, resolution, and scenario must be measured')
  if (problems.length) {
    for (const problem of problems) console.error(`  ${problem}`)
    throw new Error(`${problems.length} problem(s)`)
  }
  console.log(`texture-uploads probe PASSED: ${rows.length} runs drew current pixels, and each dropped upload was caught`)
} catch (error) {
  console.error(`texture-uploads probe FAILED: ${error.message}`)
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
