// Local lab launcher — Vite plus a Chrome instance that can draw HTML.
//
// Localhost cannot use the public demo's origin token, so this process owns
// an isolated Chrome with CanvasDrawElement enabled. Vite owns the server and
// Puppeteer owns the browser.

import { existsSync } from 'node:fs'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
const labRoot = path.join(repoRoot, 'apps', 'lab')
const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
]
  .filter(Boolean)
  .find((candidate) => existsSync(candidate))

if (!chromePath) {
  throw new Error('lab: Chrome was not found; set CHROME_PATH to its executable')
}

let browser
let server

try {
  server = await createServer({ root: labRoot })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (!url) throw new Error('lab: Vite did not report a local URL')

  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    defaultViewport: null,
    args: [
      '--enable-features=CanvasDrawElement',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  })

  const [page = await browser.newPage()] = await browser.pages()
  const capable = await page.evaluate(
    () => 'drawElementImage' in document.createElement('canvas').getContext('2d'),
  )
  if (!capable) throw new Error(`lab: Chrome at ${chromePath} has no drawElementImage`)

  await page.goto(url)
  console.log(`lab: ${url}`)

  process.once('SIGINT', () => void browser.close())
  process.once('SIGTERM', () => void browser.close())
  await new Promise((resolve) => browser.once('disconnected', resolve))
} finally {
  if (browser?.connected) await browser.close()
  if (server) await server.close()
}
