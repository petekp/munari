// Softbox load timing — import, decode and GPU upload of each table source,
// in a production build, one sample per fresh browser context.
//
// Builds instruments/softbox-size/timing with Vite, serves it from a local
// HTTP server, and loads it RUNS times per source, interleaved (three,
// half64, half32, three, …) so drift lands on every source alike. Each
// sample opens a new incognito context, so no module or HTTP cache carries
// over. Localhost serving means download time is not in these numbers; the
// sizes are in size.mjs.
//
// Run on m2: RUNS=20 node instruments/softbox-size/timing.mjs

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import puppeteer from 'puppeteer-core'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

const here = fileURLToPath(new URL('./timing/', import.meta.url))
const out = join(here, 'dist')
await build({ root: here, configFile: false, logLevel: 'warn', mode: 'production', build: { outDir: out, emptyOutDir: true, minify: true, modulePreload: false } })

const types = { '.html': 'text/html', '.js': 'text/javascript' }
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://x').pathname
  try {
    const body = await readFile(join(out, path === '/' ? 'index.html' : path))
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'text/html', 'cache-control': 'no-store' })
    response.end(body)
  } catch {
    response.writeHead(404)
    response.end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/`

const RUNS = Number(process.env.RUNS ?? 20)
const METHODS = ['three', 'half64', 'half32']
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: [...WEBGPU_CHROME_ARGS],
})
const samples = []
try {
  for (let run = 0; run < RUNS; run++) {
    for (const method of METHODS) {
      const context = await browser.createBrowserContext()
      const page = await context.newPage()
      await page.goto(`${url}?method=${method}`, { waitUntil: 'load' })
      const sample = await page.evaluate(() => window.softboxTiming)
      if (sample.error) throw new Error(`${method}: ${sample.error}`)
      samples.push({ run, ...sample })
      await context.close()
    }
  }
} finally {
  await browser.close()
  server.close()
}

const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * q
  const low = Math.floor(position)
  return sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low)
}
const summary = METHODS.map((method) => {
  const rows = samples.filter((sample) => sample.method === method)
  const stat = (key) => ({ p10: quantile(rows.map((r) => r[key]), 0.1), median: quantile(rows.map((r) => r[key]), 0.5), p90: quantile(rows.map((r) => r[key]), 0.9) })
  return { method, n: rows.length, float32Filterable: rows[0].float, importMs: stat('importMs'), decodeMs: stat('decodeMs'), uploadMs: stat('uploadMs'), totalMs: stat('totalMs') }
})
console.log(JSON.stringify({ chrome: await browser.version().catch(() => null), summary, samples }, null, 2))
