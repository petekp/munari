// Under realistic mouse motion: which key lights up, where is the cursor,
// and which key SHOULD light up (bend recomputed with the tip on the hand)?
import { existsSync } from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
const ROOT = '/Users/petepetrash/Code/munari'
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args: ['--enable-features=CanvasDrawElement', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] })
const server = await createServer({ root: path.join(ROOT, 'apps', 'lab'), logLevel: 'warn', server: { port: 0 } })
await server.listen()
const port = server.config.server.port ?? server.httpServer.address().port
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)))
await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 })
await page.goto(`http://localhost:${port}/?scene=crystal&bare`, { waitUntil: 'load' })
await page.waitForSelector('canvas[data-engine]', { timeout: 20000 })
await sleep(1500)

await page.evaluate(async () => {
  const L = await import('/src/scenes/crystal/crystalLaw.ts')
  const T = (await import('/src/scenes/crystal/crystalTuning.ts')).crystalTuning
  window.__L = L; window.__T = T
  let mat = null; window.__r3f.scene.traverse((o) => { if (o.material?.uniforms?.uTip) mat = o.material })
  window.__eye = () => [mat.uniforms.uEye.value.x, mat.uniforms.uEye.value.y, mat.uniforms.uEye.value.z]
  window.__rot = () => [...mat.uniforms.uRot.value.elements]
  const host = document.querySelector('[data-munari-source-host][data-munari-instance="source"]')
  window.__host = host
  window.__events = []
  host.addEventListener('pointermove', (e) => {
    if (e.isTrusted) return
    window.__events.push({ x: e.clientX, y: e.clientY, key: e.target?.dataset?.key ?? null })
  }, true)
  window.__drain = () => { const e = window.__events; window.__events = []; return e }
  window.__boxes = () => {
    const h = host.getBoundingClientRect()
    return [...host.querySelectorAll('.crystal-key')].map((el) => {
      const k = el.getBoundingClientRect()
      return { key: el.dataset.key, l: k.left - h.left, t: k.top - h.top, r: k.right - h.left, b: k.bottom - h.top,
               x: k.left - h.left + k.width / 2, y: k.top - h.top + k.height / 2 }
    })
  }
  window.__twin = () => [...host.querySelectorAll('.crystal-key[data-hover]')].map((e) => e.dataset.key)
  // What the bend SHOULD be: tip anchored on the point the ray came from.
  window.__should = (x, y) => {
    const eye = window.__eye()
    const [tx, ty] = L.tipPlanePoint(x, y, eye, T.liftPx)
    const f = { tipX: tx, tipY: ty, tipZ: T.liftPx, rot: window.__rot() }
    const b = L.bendAt(x, y, f, T, eye)
    return [x + b[0], y + b[1]]
  }
})

const boxes = await page.evaluate(() => window.__boxes())
const KEYW = 52
const at = (x, y) => (boxes.find((k) => x >= k.l && x <= k.r && y >= k.t && y <= k.b) || { key: '-' }).key
const centre = (k) => boxes.find((b) => b.key === k)

// A hand sweeping across the pad at ~900 px/s, sampled like a 120Hz mouse.
const PATH = []
for (let t = 0; t <= 1; t += 1 / 90) {
  PATH.push([360 + t * 560, 470 + Math.sin(t * Math.PI * 2) * 26])
}
await page.mouse.move(PATH[0][0], PATH[0][1])
await sleep(800)
await page.evaluate(() => window.__drain())

const rows = []
for (const [x, y] of PATH) {
  await page.mouse.move(x, y)
  await sleep(8)
  const ev = await page.evaluate(() => window.__drain())
  if (!ev.length) continue
  const last = ev[ev.length - 1]
  const should = await page.evaluate(([px, py]) => window.__should(px, py), [x, y])
  rows.push({ x, y, rx: last.x, ry: last.y, sx: should[0], sy: should[1], key: last.key })
}

console.log(`${rows.length} relayed moves along a 560px sweep at ~900px/s\n`)
let farFromCursor = 0, farFromShould = 0
const dc = [], ds = []
for (const r of rows) {
  const distCursor = Math.hypot(r.rx - r.x, r.ry - r.y)
  const distShould = Math.hypot(r.rx - r.sx, r.ry - r.sy)
  dc.push(distCursor); ds.push(distShould)
  if (distCursor > 2 * KEYW) farFromCursor++
  if (distShould > KEYW) farFromShould++
}
const q = (a, p) => { const s = [...a].sort((m, n) => m - n); return Math.round(s[Math.floor(s.length * p)]) }
console.log(`hovered point vs the CURSOR:   median ${q(dc,.5)}px  p90 ${q(dc,.9)}px  max ${Math.round(Math.max(...dc))}px`)
console.log(`hovered point vs WHERE IT SHOULD BE: median ${q(ds,.5)}px  p90 ${q(ds,.9)}px  max ${Math.round(Math.max(...ds))}px`)
console.log(`  ${farFromShould}/${rows.length} moves put the highlight more than one key (52px) from the right key`)
console.log(`\nsample (cursor key -> key lit, and how far that is in key widths):`)
for (const r of rows.filter((_, i) => i % 4 === 0)) {
  const ck = at(r.x, r.y), lk = at(r.rx, r.ry), sk = at(r.sx, r.sy)
  const keysAway = centre(ck) && centre(lk)
    ? (Math.hypot(centre(lk).x - centre(ck).x, centre(lk).y - centre(ck).y) / KEYW).toFixed(1)
    : '-'
  console.log(`  cursor=(${Math.round(r.x)},${Math.round(r.y)}) on ${String(ck).padEnd(3)} -> lit ${String(lk).padEnd(3)} (${keysAway} keys away)   should have lit ${sk}`)
}
await browser.close(); await server.close()
