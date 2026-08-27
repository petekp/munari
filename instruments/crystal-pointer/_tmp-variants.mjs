// Same three candidates, but the pose is read INSIDE the relay listener -- the only
// moment that matches when the raycast actually runs.
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
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)))
await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 })
await page.goto(`http://localhost:${port}/?scene=crystal&bare`, { waitUntil: 'load' })
await page.waitForSelector('canvas[data-engine]', { timeout: 20000 })
await sleep(1500)

await page.evaluate(async () => {
  const L = await import('/src/scenes/crystal/crystalLaw.ts')
  const T = (await import('/src/scenes/crystal/crystalTuning.ts')).crystalTuning
  let mat = null; window.__r3f.scene.traverse((o) => { if (o.material?.uniforms?.uTip) mat = o.material })
  const surface = document.querySelector('canvas[data-engine]')
  window.__rec = []
  let hand = null
  // real pointermove on the canvas = the hand, captured before the relay runs
  surface.addEventListener('pointermove', (e) => { if (e.isTrusted) hand = [e.clientX, e.clientY] }, true)
  const host = document.querySelector('[data-munari-source-host][data-munari-instance="source"]')
  host.addEventListener('pointermove', (e) => {
    if (e.isTrusted || !hand) return
    const u = mat.uniforms
    const [x, y] = hand
    const eye = [u.uEye.value.x, u.uEye.value.y, u.uEye.value.z]
    const rot = [...u.uRot.value.elements]
    const drawn = { tipX: u.uTip.value.x, tipY: u.uTip.value.y, tipZ: u.uTip.value.z, rot }
    const s = eye[2] / (eye[2] - drawn.tipZ)
    const qx = eye[0] + (drawn.tipX - eye[0]) * s
    const qy = eye[1] + (drawn.tipY - eye[1]) * s
    const now = L.tipPlanePoint(x, y, eye, T.liftPx)
    const fresh = { tipX: now[0], tipY: now[1], tipZ: T.liftPx, rot }
    const bA = L.bendAt(x, y, fresh, T, eye)
    const bB = L.bendAt(qx, qy, drawn, T, eye)
    window.__rec.push({ x, y, relayed: [e.clientX, e.clientY],
      curLost: e.clientX === x && e.clientY === y,
      A: [x + bA[0], y + bA[1]], aLost: !bA[0] && !bA[1],
      B: [qx + bB[0], qy + bB[1]], bLost: !bB[0] && !bB[1],
      lag: Math.hypot(qx - x, qy - y) })
  }, true)
  window.__drain = () => { const r = window.__rec; window.__rec = []; return r }
})

const PATH = []
for (let t = 0; t <= 1; t += 1 / 90) PATH.push([380 + t * 520, 480 + Math.sin(t * Math.PI * 2) * 20])
await page.mouse.move(PATH[0][0], PATH[0][1]); await sleep(800)
await page.evaluate(() => window.__drain())
for (const [x, y] of PATH) { await page.mouse.move(x, y); await sleep(8) }
const rows = await page.evaluate(() => window.__drain())

const q = (a, p) => { const s = [...a].sort((m, n) => m - n); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10 }
console.log(`${rows.length} relayed moves | hand-vs-drawn-tip lag: median ${q(rows.map(r=>r.lag),.5)}px  max ${q(rows.map(r=>r.lag),1)}px\n`)
for (const [k, lostKey, label] of [['relayed','curLost','ships today'], ['A','aLost','A: re-anchor tip'], ['B','bLost','B: query at drawn tip']]) {
  const jumps = [], dist = []
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1][k], c = rows[i][k]
    const moved = Math.hypot(rows[i].x - rows[i-1].x, rows[i].y - rows[i-1].y)
    jumps.push(Math.abs(Math.hypot(c[0] - p[0], c[1] - p[1]) - moved))
    dist.push(Math.hypot(c[0] - rows[i].x, c[1] - rows[i].y))
  }
  const lost = rows.filter((r) => r[lostKey]).length
  const overKey = dist.filter((d) => d > 52).length
  console.log(`${label.padEnd(24)} jump beyond the hand's own step: median ${String(q(jumps,.5)).padStart(6)}px p90 ${String(q(jumps,.9)).padStart(6)}px max ${String(q(jumps,1)).padStart(6)}px`)
  console.log(`${''.padEnd(24)} offset from hand: median ${String(q(dist,.5)).padStart(6)}px max ${String(q(dist,1)).padStart(6)}px | >1 key away ${overKey}/${dist.length} | correction lost ${lost}/${rows.length}\n`)
}
await browser.close(); await server.close()
