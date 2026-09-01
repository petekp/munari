// Thumbnail capture — regenerates the nav's scene screencaps.
//
// The nav (src/components/SceneNav.tsx) shows a 16:9 card per advertised
// scene, served from public/thumbs/<scene>.jpg. Those images are captures
// of the real scenes, so they go stale when a scene's look changes; this
// script re-takes them. Localhost has no origin-trial token, so the Chrome
// it launches carries the CanvasDrawElement flag — same policy as
// tools/runLab.mjs.
//
// Usage: `npm run thumbs` in apps/lab (CHROME_PATH overrides discovery).

import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const labRoot = path.resolve(import.meta.dirname, '..')
const outDir = path.join(labRoot, 'public', 'thumbs')

// `selection` is missing on purpose: its bead only exists while a drag is
// held, and a scene loaded and left alone shows a bare paragraph. Its
// thumb is a hand-picked frame — re-take it by hand, not by adding it here.
const SCENES = ['flight', 'genie', 'knobs', 'logo', 'marble-hand', 'plume']
// The nav renders cards ~144px wide; 1280×720 keeps the capture sharp on
// dense displays and crops nothing (the scenes are viewport-sized pages).
const WIDTH = 1280
const HEIGHT = 720

const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
].filter(Boolean).find(existsSync)

if (!chromePath) {
  console.error('no Chrome executable found (set CHROME_PATH)')
  process.exit(1)
}

let browser
let server
try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--enable-features=CanvasDrawElement',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  })
  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port
  mkdirSync(outDir, { recursive: true })

  for (const scene of SCENES) {
    const page = await browser.newPage()
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 })
    await page.goto(`http://localhost:${port}/?scene=${scene}&bare`, { waitUntil: 'load' })
    if (scene === 'logo') await page.waitForSelector('.logo-word', { timeout: 20_000 })
    else await page.waitForSelector('canvas[data-engine]', { timeout: 20_000 })
    // Let the scene finish arriving: fonts, environment maps, and the first
    // settled frames — a capture at `load` shows an empty bench.
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    const file = path.join(outDir, `${scene}.jpg`)
    await page.screenshot({ path: file, type: 'jpeg', quality: 85 })
    console.log(`captured ${path.relative(labRoot, file)}`)
    await page.close()
  }
} finally {
  await browser?.close()
  await server?.close()
}
