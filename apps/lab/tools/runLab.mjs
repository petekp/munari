// Local lab launcher — Vite plus a Chrome instance that can draw HTML.
//
// Localhost cannot use the public demo's origin token, so this process owns
// an isolated Chrome with CanvasDrawElement enabled. The 2026-08-16 launch
// audit also found that flag-backed gates could stay green after the public
// token expired; check mode reads the token's signed payload and fails before
// its renewal window. Vite owns the server, Puppeteer owns the browser, and
// apps/lab/index.html owns the token and its expiry.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
const labRoot = path.join(repoRoot, 'apps', 'lab')
const checkOnly = process.argv.includes('--check-origin-trial')
const renewalWindowDays = 30
const dayMs = 24 * 60 * 60 * 1000

function originTrial() {
  const html = readFileSync(path.join(labRoot, 'index.html'), 'utf8')
  const token = html.match(/http-equiv="origin-trial"\s+content="([^"]+)"/)?.[1]
  if (!token) throw new Error('apps/lab/index.html has no origin-trial token')

  const bytes = Buffer.from(token, 'base64')
  const payloadStart = bytes.lastIndexOf('{'.charCodeAt(0))
  if (payloadStart < 0) throw new Error('the origin-trial token has no readable payload')

  const payload = JSON.parse(bytes.subarray(payloadStart).toString('utf8'))
  if (payload.feature !== 'HTMLInCanvas' || !Number.isFinite(payload.expiry)) {
    throw new Error('the origin-trial token is not a valid HTMLInCanvas claim')
  }
  return payload
}

function checkOriginTrial() {
  const payload = originTrial()
  const expiresAt = payload.expiry * 1000
  const daysLeft = Math.ceil((expiresAt - Date.now()) / dayMs)
  const expiry = new Date(expiresAt).toISOString().slice(0, 10)
  const message = `origin trial: ${payload.origin} expires ${expiry} (${daysLeft} days left)`

  if (daysLeft <= renewalWindowDays) {
    if (checkOnly) {
      throw new Error(`${message}; renew it before the ${renewalWindowDays}-day window`)
    }
    console.warn(message)
  } else {
    console.log(message)
  }
}

checkOriginTrial()
if (checkOnly) process.exit(0)

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
