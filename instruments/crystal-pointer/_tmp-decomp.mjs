// During fast motion, reproduce the relayed point from the drawn pose, then
// peel the error apart: stale tip vs. the rock/spin the drawn pose carries.
import { existsSync } from 'node:fs'
import path from 'node:path'
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
  window.__L = L; window.__T = T
  let mat = null; window.__r3f.scene.traverse((o) => { if (o.material?.uniforms?.uTip) mat = o.material })
  window.__mat = () => mat
  const host = document.querySelector('[data-munari-source-host][data-munari-instance="source"]')
  window.__rec = []
  // Snapshot the drawn pose AT THE MOMENT the relay fires.
  host.addEventListener('pointermove', (e) => {
    if (e.isTrusted) return
    const u = mat.uniforms
    window.__rec.push({
      rx: e.clientX, ry: e.clientY,
      tipX: u.uTip.value.x, tipY: u.uTip.value.y, tipZ: u.uTip.value.z,
      rot: [...u.uRot.value.elements],
      eye: [u.uEye.value.x, u.uEye.value.y, u.uEye.value.z],
    })
  }, true)
  window.__drain = () => { const r = window.__rec; window.__rec = []; return r }
  window.__analyse = (hand, rec) => {
    const [x, y] = hand
    const eye = rec.eye
    const drawn = { tipX: rec.tipX, tipY: rec.tipY, tipZ: rec.tipZ, rot: rec.rot }
    const [tx, ty] = L.tipPlanePoint(x, y, eye, T.liftPx)
    const fresh = { tipX: tx, tipY: ty, tipZ: T.liftPx, rot: rec.rot }
    const level = { tipX: tx, tipY: ty, tipZ: T.liftPx, rot: [1,0,0,0,1,0,0,0,1] }
    const b = (f) => L.bendAt(x, y, f, T, eye)
    // how far the drawn tip is from where the hand is now, in screen px
    const s = eye[2] / (eye[2] - T.liftPx)
    const drawnHandX = eye[0] + (rec.tipX - eye[0]) * s
    const drawnHandY = eye[1] + (rec.tipY - eye[1]) * s
    const tiltDeg = Math.acos(Math.min(1, Math.max(-1, rec.rot[8]))) * 180 / Math.PI
    return {
      lagPx: Math.round(Math.hypot(drawnHandX - x, drawnHandY - y) * 10) / 10,
      tiltDeg: Math.round(tiltDeg * 10) / 10,
      asDrawn: b(drawn).map((v) => Math.round(v)),
      freshTip: b(fresh).map((v) => Math.round(v)),
      levelToo: b(level).map((v) => Math.round(v)),
    }
  }
})

const PATH = []
for (let t = 0; t <= 1; t += 1 / 60) PATH.push([380 + t * 520, 480 + Math.sin(t * Math.PI * 2) * 20])
await page.mouse.move(PATH[0][0], PATH[0][1]); await sleep(800)
await page.evaluate(() => window.__drain())

console.log('lag = how far the hand moved since the pose being used was drawn')
console.log('asDrawn = the bend the code actually applied (should equal the relayed offset)')
console.log('freshTip = same rotation, tip re-anchored on the hand')
console.log('levelToo = tip re-anchored and the rock/spin removed\n')
const errs = { drawnVsFresh: [], freshVsLevel: [] }
let reproduced = 0, n = 0
for (const [x, y] of PATH) {
  await page.mouse.move(x, y)
  await sleep(8)
  const rec = await page.evaluate(() => window.__drain())
  if (!rec.length) continue
  const r = rec[rec.length - 1]
  const a = await page.evaluate(([h, rr]) => window.__analyse(h, rr), [[x, y], r])
  const relOff = [Math.round(r.rx - x), Math.round(r.ry - y)]
  const ok = Math.hypot(relOff[0] - a.asDrawn[0], relOff[1] - a.asDrawn[1]) < 3
  n++; if (ok) reproduced++
  errs.drawnVsFresh.push(Math.hypot(a.asDrawn[0] - a.freshTip[0], a.asDrawn[1] - a.freshTip[1]))
  errs.freshVsLevel.push(Math.hypot(a.freshTip[0] - a.levelToo[0], a.freshTip[1] - a.levelToo[1]))
  if (n % 5 === 0) {
    console.log(`hand=(${Math.round(x)},${Math.round(y)}) lag=${String(a.lagPx).padStart(5)}px tilt=${String(a.tiltDeg).padStart(4)}deg` +
      ` relayed=${JSON.stringify(relOff).padEnd(12)} asDrawn=${JSON.stringify(a.asDrawn).padEnd(12)}${ok ? ' ' : ' MISMATCH'}` +
      ` freshTip=${JSON.stringify(a.freshTip).padEnd(12)} levelToo=${JSON.stringify(a.levelToo)}`)
  }
}
const q = (a, p) => { const s = [...a].sort((m, nn) => m - nn); return Math.round(s[Math.floor(s.length * p)]) }
console.log(`\nrelayed offset reproduced from the drawn pose: ${reproduced}/${n}`)
console.log(`error from the stale tip alone:  median ${q(errs.drawnVsFresh,.5)}px  p90 ${q(errs.drawnVsFresh,.9)}px`)
console.log(`error from the rock/spin alone:  median ${q(errs.freshVsLevel,.5)}px  p90 ${q(errs.freshVsLevel,.9)}px`)
await browser.close(); await server.close()
