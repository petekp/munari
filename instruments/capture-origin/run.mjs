// Capture origin probe — whether cross-origin content can taint a Surface's
// capture canvas, and what each engine draws in its place.
//
// The law: neither capture engine taints its canvas. HTML-in-canvas leaves
// cross-origin content without CORS out of the draw, and snapDOM draws a
// placeholder or nothing. Same-origin content and a CORS image draw; a CORS
// CSS background draws only on snapDOM. So Surface
// needs no taint check, unlike FrameSurface, whose source canvas a caller
// draws (decisions.md #70). The cost is visible instead: the 3D copy shows
// a hole or a gray box where the page shows the image (platform.md #34).
// Measured 2026-10-09 on Chrome 155-157 and snapDOM 3.0.0-beta.1.
//
// Ownership: main.ts captures through the published engines; this file
// serves the page and a second origin, then judges the readback.

import { existsSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import zlib from 'node:zlib'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const here = import.meta.dirname
const repoRoot = path.resolve(here, '..', '..')
const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
].filter(Boolean).find(existsSync)
const strict = process.env.STRICT_CAPABILITY === '1'

function skip(reason) {
  const message = `capture-origin probe SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message)
  process.exit(strict ? 1 : 0)
}

if (!chromePath) skip('no Chrome executable found (set CHROME_PATH)')

// An 8x8 opaque red PNG, so a drawn image is unmistakable at the center pixel.
function redPng() {
  const size = 8
  const rows = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) rows.set([255, 0, 0, 255], y * (size * 4 + 1) + 1 + x * 4)
  }
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (bytes) => {
    let c = 0xffffffff
    for (const byte of bytes) c = table[(c ^ byte) & 255] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const check = Buffer.alloc(4)
    check.writeUInt32BE(crc(body))
    return Buffer.concat([length, body, check])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
const red = redPng()

// The second origin: `localhost` against the page's `127.0.0.1`. Only
// `?cors` answers with an Access-Control-Allow-Origin header.
const assets = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://asset')
  if (url.pathname === '/frame.html') {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<body style="margin:0;background:rgb(0,255,0)"></body>')
    return
  }
  const headers = { 'content-type': 'image/png', 'cache-control': 'no-store' }
  if (url.searchParams.has('cors')) headers['access-control-allow-origin'] = '*'
  response.writeHead(200, headers)
  response.end(red)
})
await new Promise((resolve) => assets.listen(0, '127.0.0.1', resolve))
const assetOrigin = `http://localhost:${assets.address().port}`

// What each engine draws. snapDOM fetches a CSS background with CORS, so a
// CORS header brings it in; HTML-in-canvas loads it as the page does, without
// CORS, and leaves it out whatever the server sends.
const DRAWN = {
  'html-in-canvas': new Set(['same-origin image', 'cross-origin image with CORS']),
  snapdom: new Set(['same-origin image', 'cross-origin image with CORS', 'cross-origin CSS background with CORS']),
}
const isRed = (pixel) => pixel[0] > 200 && pixel[1] < 50 && pixel[2] < 50 && pixel[3] > 200

let server
let browser
try {
  server = await createServer({
    root: here,
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: 0, fs: { allow: [repoRoot] } },
    plugins: [{
      name: 'capture-origin-image',
      configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (!request.url?.startsWith('/red.png')) return next()
          response.setHeader('content-type', 'image/png')
          response.end(red)
        })
      },
    }],
  })
  await server.listen()
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--enable-features=CanvasDrawElement',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/?asset=${encodeURIComponent(assetOrigin)}`,
  )
  await page.waitForFunction(() => window.__captureOrigin || false, { timeout: 60_000 })
  const { results, error } = await page.evaluate(() => window.__captureOrigin)
  if (error) errors.push(error)
  if (errors.length) throw new Error(`page errors:\n  ${errors.join('\n  ')}`)
  if (!results.some((result) => result.engine === 'html-in-canvas')) {
    skip(`Chrome at ${chromePath} has no drawElementImage`)
  }

  const problems = []
  for (const result of results) {
    const drawn = result.pixel !== null && isRed(result.pixel)
    console.log(
      `${result.engine.padEnd(14)} ${result.name.padEnd(42)} readable ${result.readable ? 'yes' : 'NO '}  ` +
        `pixel ${result.pixel ? result.pixel.join(',') : '-'}`,
    )
    if (!result.readable) problems.push(`${result.engine}, ${result.name}: the capture canvas is tainted`)
    else if (DRAWN[result.engine].has(result.name) && !drawn) problems.push(`${result.engine}, ${result.name}: the image was not drawn`)
    else if (!DRAWN[result.engine].has(result.name) && drawn) problems.push(`${result.engine}, ${result.name}: cross-origin pixels were drawn`)
  }
  console.log(`${await browser.version()}, cross-origin server ${assetOrigin}`)
  if (problems.length) {
    console.error(`capture-origin probe FAILED (${problems.length})`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
  } else {
    console.log(`capture-origin probe PASSED: ${results.length} captures, none tainted`)
  }
} finally {
  await browser?.close()
  await server?.close()
  assets.close()
}
