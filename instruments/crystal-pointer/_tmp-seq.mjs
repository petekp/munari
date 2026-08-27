// The user's symptom, directly: sweep the hand across a row and write down
// which key lights up at each step. A clean run walks along one row in order.
import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args: ['--enable-features=CanvasDrawElement', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] })
const server = await createServer({ root: '/Users/petepetrash/Code/munari/apps/lab', logLevel: 'warn', server: { port: 0 } })
await server.listen()
const port = server.config.server.port ?? server.httpServer.address().port
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 })
await page.goto(`http://localhost:${port}/?scene=crystal&bare`, { waitUntil: 'load' })
await page.waitForSelector('canvas[data-engine]', { timeout: 20000 })
await sleep(1500)
await page.evaluate(() => {
  window.__lit = () => {
    const el = document.querySelector('[data-munari-instance="source"] [data-key][data-hover]')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { k: el.getAttribute('data-key'), cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
  }
})
const PATH = []
for (let t = 0; t <= 1; t += 1 / 90) PATH.push([380 + t * 520, 480 + Math.sin(t * Math.PI * 2) * 20])
await page.mouse.move(PATH[0][0], PATH[0][1]); await sleep(700)
const seq = []
for (const [x, y] of PATH) { await page.mouse.move(x, y); await sleep(8)
  seq.push({ x, ...(await page.evaluate(() => window.__lit())) }) }

const run = []
for (const s of seq) if (!run.length || run[run.length - 1].k !== s.k) run.push(s)
console.log('keys lit, in order:')
console.log('  ' + run.map((r) => r.k ?? '(none)').join(' '))
let back = 0, jump = 0, none = 0
for (let i = 1; i < run.length; i++) {
  const a = run[i - 1], b = run[i]
  if (!b.k) { none++; continue }
  if (!a.k) continue
  const d = Math.hypot(b.cx - a.cx, b.cy - a.cy)
  if (d > 78) jump++            // more than 1.5 key pitches in one hop
  if (b.cx < a.cx - 10) back++  // moved left while the hand moved right
}
console.log(`\n${run.length} distinct keys over a left-to-right sweep`)
console.log(`  hops of more than 1.5 keys: ${jump}`)
console.log(`  hops backwards (hand went right): ${back}`)
console.log(`  drops to no key at all: ${none}`)
await browser.close(); await server.close()
