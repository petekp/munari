// review-notes occlusion probe — does the teapot's spout keep a click off the
// note wrapped behind it (decisions.md #78)?
//
// The review notes scene wraps two live notes around a teapot on a turntable.
// With the wheel at −132° the spout stands in front of Mara's note; at −116°
// and −124° nothing does. The probe finds a point on Mara's textarea that the
// scene geometry says is covered at −132° and clear at the other two angles,
// clicks it with a real mouse at each angle, and reads whether the textarea
// took focus. Covered must mean not focused, and clear must mean focused.
//
// The fault check gives the covering mesh a no-op `raycast` at −132°. The same
// click must then focus the note, which shows the block came from that mesh and
// that the opt-out works. Then the probe turns the wheel again, which fails if
// a stale pointer replay left R3F hovering the note (25 Nov 2026).
//
// It also measures what the test costs: each visible mesh's plain raycast, the
// note's hit region with occlusion, a CPU profile across 400 pointer moves, and
// paired 1.5 s frame-interval blocks with the teapot body's raycast on and off.
// Headless Chrome paces frames at 60 Hz, so the frame blocks cannot show a
// 120 Hz budget.
//
// Runs both capture engines, html-in-canvas and snapDOM, unless ENGINE names
// one. The snapDOM run launches Chrome without the CanvasDrawElement flag, so
// it is also the no-flag path. CHROME_PATH picks the browser.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { fixtureServer, evidenceDirectory } from '../apiBrowser.mjs'
import { setChromeViewport } from '../chromeViewport.mjs'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

const chromePath = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].filter(Boolean).find(existsSync)
if (!chromePath) throw new Error('no Chrome executable found (set CHROME_PATH)')
const engines = process.env.ENGINE ? [process.env.ENGINE] : ['html-in-canvas', 'snapdom']
const output = await evidenceDirectory('review-notes-occlusion')
const server = await fixtureServer('apps/lab', 'API_LAB_URL', output)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ANGLES = [-132, -116, -124]
const SAMPLE_MOVES = 400

const hook = () => {
  const roots = new Set()
  Object.defineProperty(Object.prototype, '__r3f', {
    configurable: true,
    set(value) {
      Object.defineProperty(this, '__r3f', { value, writable: true, configurable: true, enumerable: false })
      if (value && value.root) roots.add(value.root)
    },
  })
  const meshProto = () => {
    for (const root of roots) {
      let found = null
      root.getState().scene.traverse(o => { if (!found && o.isMesh) found = o })
      if (found) { let p = Object.getPrototypeOf(found); while (p && p.constructor.name !== 'Mesh') p = Object.getPrototypeOf(p); return p }
    }
    return null
  }
  const state = () => { for (const root of roots) { const s = root.getState(); if (s.scene.getObjectsByProperty('isMesh', true).length > 4) return s } return null }
  const visibleChain = o => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true }
  const notes = () => { const s = state(); return s ? s.scene.getObjectsByProperty('isMesh', true).filter(m => m.geometry?.parameters?.width === 232 && m.geometry?.parameters?.height === 136) : [] }
  const ndcOf = (s, x, y) => { const r = s.gl.domElement.getBoundingClientRect(); const v = s.pointer.clone(); v.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1); return v }
  const hitsAt = (x, y) => {
    const s = state(), proto = meshProto()
    s.raycaster.setFromCamera(ndcOf(s, x, y), s.camera)
    s.raycaster.layers.mask = 0xffffffff
    const hits = []
    s.scene.traverse(o => {
      if (!o.isMesh || !visibleChain(o)) return
      const materials = Array.isArray(o.material) ? o.material : [o.material]
      if (!materials.some(m => m && m.visible)) return
      const own = o.raycast !== proto.raycast
      const local = []
      proto.raycast.call(o, s.raycaster, local)
      for (const h of local) hits.push({ object: o, distance: h.distance, uv: h.uv, own })
    })
    return hits.sort((a, b) => a.distance - b.distance)
  }
  const project = (mesh, u, v) => {
    const s = state(), uv = mesh.geometry.attributes.uv, pos = mesh.geometry.attributes.position
    let best = 0, bestD = Infinity
    for (let i = 0; i < uv.count; i++) { const d = (uv.getX(i) - u) ** 2 + (uv.getY(i) - v) ** 2; if (d < bestD) { bestD = d; best = i } }
    const point = mesh.localToWorld(s.camera.position.clone().set(pos.getX(best), pos.getY(best), pos.getZ(best))).project(s.camera)
    const r = s.gl.domElement.getBoundingClientRect()
    return { x: r.left + (point.x + 1) * r.width / 2, y: r.top + (1 - point.y) * r.height / 2 }
  }
  window.__occ = {
    ready: () => notes().length === 2 && state() !== null && meshProto() !== null,
    notes: () => notes().length,
    coverOptOut(x, y, on) {
      const hits = hitsAt(x, y), mara = window.__occMara, onMara = hits.find(h => h.object === mara)
      const blocker = onMara && hits.find(h => h.distance < onMara.distance && !h.own)
      if (!blocker) return false
      if (on) blocker.object.raycast = () => {}
      else delete blocker.object.raycast
      window.__occOptedOut = blocker.object
      return true
    },
    restoreOptOut() { if (window.__occOptedOut) delete window.__occOptedOut.raycast },
    bodyOptOut(on) {
      const s = state(), proto = meshProto()
      let body = null, most = 0
      s.scene.traverse(o => { if (o.isMesh && o.geometry?.type === 'LatheGeometry' && o.geometry.index && o.geometry.index.count > most) { most = o.geometry.index.count; body = o } })
      if (on) body.raycast = () => {}
      else delete body.raycast
      return body.raycast === proto.raycast ? 'default' : 'no-op'
    },
    frames(ms) {
      return new Promise(resolve => {
        const times = []
        const t0 = performance.now()
        const step = t => { times.push(t); if (t - t0 < ms) requestAnimationFrame(step); else resolve(times) }
        requestAnimationFrame(step)
      }).then(times => { const d = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b); return { frames: d.length, meanMs: d.reduce((a, b) => a + b, 0) / d.length, p95Ms: d[Math.floor(d.length * 0.95)] } })
    },
    bench(x, y, n) {
      const s = state(), proto = meshProto(), mara = window.__occMara
      const rays = []
      for (let i = 0; i < n; i++) { s.raycaster.setFromCamera(ndcOf(s, x + (i % 7) * 0.3, y + (i % 5) * 0.3), s.camera); rays.push(s.raycaster.ray.clone()) }
      const time = (fn) => { const t = performance.now(); for (const r of rays) { s.raycaster.ray.copy(r); fn() } return (performance.now() - t) / n * 1000 }
      const perMesh = []
      s.scene.traverse(o => {
        if (!o.isMesh || !visibleChain(o) || o.raycast !== proto.raycast) return
        const index = o.geometry.index, triangles = (index ? index.count : o.geometry.attributes.position.count) / 3
        perMesh.push({ type: o.geometry.type, triangles, us: Math.round(time(() => proto.raycast.call(o, s.raycaster, [])) * 10) / 10 })
      })
      const plain = time(() => proto.raycast.call(mara, s.raycaster, []))
      const region = []
      const withRegion = (() => { const t = performance.now(); for (const r of rays) { s.raycaster.ray.copy(r); mara.raycast(s.raycaster, region); region.length = 0; } return (performance.now() - t) / n * 1000 })()
      return { plainUs: Math.round(plain * 10) / 10, hitRegionUs: Math.round(withRegion * 10) / 10, perMesh: perMesh.sort((a, b) => b.us - a.us).slice(0, 8) }
    },
    top: (x, y) => hitsAt(x, y).slice(0, 3).map(h => ({ note: notes().indexOf(h.object), own: h.own, d: Math.round(h.distance), type: h.object.geometry?.type, uv: h.uv ? [h.uv.x.toFixed(2), h.uv.y.toFixed(2)] : null })),
    mark(index) { window.__occMara = notes()[index] },
    centerOf: index => project(notes()[index], 0.5, 0.55),
    project: (u, v) => project(window.__occMara, u, v),
    coverAt(x, y) {
      const hits = hitsAt(x, y), mara = window.__occMara
      const onMara = hits.find(h => h.object === mara)
      if (!onMara) return { onMara: false }
      const nearer = hits.filter(h => h.distance < onMara.distance * (1 - 1e-4) && !h.own)
      return { onMara: true, covered: nearer.length > 0, uv: [onMara.uv.x, onMara.uv.y], by: nearer[0]?.object.name || nearer[0]?.object.geometry?.type || null }
    },
    textareaUv() {
      const area = [...document.querySelectorAll('textarea')].find(t => t.labels?.[0]?.textContent?.includes('Mara'))
      const note = area?.closest('article')
      if (!area || !note) return null
      const a = area.getBoundingClientRect(), n = note.getBoundingClientRect()
      return { u0: (a.left - n.left) / n.width, u1: (a.right - n.left) / n.width, v0: 1 - (a.bottom - n.top) / n.height, v1: 1 - (a.top - n.top) / n.height }
    },
    maraFocused: () => { const a = document.activeElement; return a instanceof HTMLTextAreaElement && Boolean(a.labels?.[0]?.textContent?.includes('Mara')) },
    blur: () => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() },
    wheel: () => Number(/Wheel (\d+)/.exec(document.querySelector('.rn-readout')?.textContent ?? '')?.[1]),
    onBody: () => /On the body (\d+)/.exec(document.querySelector('.rn-readout')?.textContent ?? '')?.[1],
    engine: () => window.__munari?.engine(),
  }
}

async function run(engine) {
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, defaultViewport: null, protocolTimeout: 60_000,
    args: [...WEBGPU_CHROME_ARGS, ...(engine === 'snapdom' ? [] : ['--enable-features=CanvasDrawElement']), '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] })
  const out = { browser: await browser.version(), engineInUse: null, angles: [], cost: null, errors: [] }
  try {
    const page = await browser.newPage()
    page.on('pageerror', e => out.errors.push(String(e)))
    page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource:')) out.errors.push(m.text()) })
    await setChromeViewport(page, { width: 1280, height: 900 })
    await page.evaluateOnNewDocument(hook)
    await page.goto(server.url + '/?scene=review-notes&framed' + (engine === 'snapdom' ? '&capture=snapdom' : ''), { waitUntil: 'load' })
    await page.waitForFunction(() => window.__occ.ready() && window.__occ.onBody() === '2', { timeout: 30_000 })
    await sleep(3000)
    out.engineInUse = await page.evaluate(() => window.__occ.engine())
    const stage = await page.$eval('.rn-stage', e => { const r = e.getBoundingClientRect(); return { x: r.left + 30, y: r.bottom - 30 } })
    const turnTo = async (target) => {
      const seen = []
      await page.evaluate(() => window.__occ.blur())
      for (let i = 0; i < 8; i++) {
        const now = await page.evaluate(() => window.__occ.wheel())
        seen.push(now)
        const want = ((-target % 360) + 360) % 360
        let delta = want - now
        if (delta > 180) delta -= 360
        if (delta < -180) delta += 360
        if (delta === 0) return now
        const dx = -(delta * Math.PI / 180) / 0.0065
        await page.mouse.move(stage.x, stage.y)
        await page.mouse.down()
        await page.mouse.move(stage.x + dx, stage.y, { steps: Math.max(2, Math.ceil(Math.abs(dx) / 10)) })
        await sleep(200)
        await page.mouse.up()
        await page.mouse.move(stage.x, stage.y)
        await sleep(400)
      }
      throw new Error('the wheel did not reach ' + target + ': ' + JSON.stringify(seen) + ' active=' + (await page.evaluate(() => document.activeElement?.tagName)) + ' at stage point=' + (await page.evaluate(p => { const e = document.elementFromPoint(p.x, p.y); return e?.tagName + '.' + e?.className }, stage)))
    }
    // Which note mesh is Mara's: an uncovered click on it focuses her textarea.
    await turnTo(-116)
    let mara = -1
    for (const index of [0, 1]) {
      await page.evaluate(() => window.__occ.blur())
      const c = await page.evaluate(i => window.__occ.centerOf(i), index)
      await page.mouse.click(c.x, c.y)
      await sleep(250)
      if (await page.evaluate(() => window.__occ.maraFocused())) { mara = index; break }
    }
    assert.ok(mara >= 0, "no note mesh took a click that focused Mara's note at -116°")
    await page.evaluate(i => window.__occ.mark(i), mara)
    const area = await page.evaluate(() => window.__occ.textareaUv())
    assert.ok(area, "Mara's textarea has no layout")
    // Choose the textarea point the spout covers at -132° and nothing covers at -116° and -124°.
    const candidates = []
    for (let i = 1; i < 12; i++) for (let j = 1; j < 6; j++) candidates.push([area.u0 + (area.u1 - area.u0) * i / 12, area.v0 + (area.v1 - area.v0) * j / 6])
    const coverage = {}
    for (const angle of ANGLES) {
      await turnTo(angle)
      coverage[angle] = await page.evaluate(list => list.map(([u, v]) => { const p = window.__occ.project(u, v); return window.__occ.coverAt(p.x, p.y) }), candidates)
    }
    const pick = candidates.findIndex((_, k) => coverage[-132][k].onMara && coverage[-132][k].covered && [-116, -124].every(a => coverage[a][k].onMara && !coverage[a][k].covered))
    assert.ok(pick >= 0, 'no textarea point is covered at -132° and uncovered at -116° and -124°')
    const [u, v] = candidates[pick]
    for (const angle of ANGLES) {
      await turnTo(angle)
      await page.evaluate(() => window.__occ.blur())
      const p = await page.evaluate(([u, v]) => window.__occ.project(u, v), [u, v])
      const geometry = await page.evaluate(p => window.__occ.coverAt(p.x, p.y), p)
      await page.mouse.click(p.x, p.y)
      await sleep(250)
      const focused = await page.evaluate(() => window.__occ.maraFocused())
      out.angles.push({ angle, wheelReadout: await page.evaluate(() => window.__occ.wheel()), point: [Math.round(p.x), Math.round(p.y)], covered: geometry.covered, coveredBy: geometry.by, focused })
    }
    {
      await turnTo(-132)
      await page.evaluate(() => window.__occ.blur())
      const p = await page.evaluate(([u, v]) => window.__occ.project(u, v), [u, v])
      const optedOut = await page.evaluate(p => window.__occ.coverOptOut(p.x, p.y, true), p)
      await page.mouse.click(p.x, p.y)
      await sleep(250)
      out.fault = { optedOut, focused: await page.evaluate(() => window.__occ.maraFocused()) }
      await page.evaluate(() => window.__occ.restoreOptOut())
    }
    const pickPoint = out.angles[0].point
    await turnTo(-132)
    out.bench = await page.evaluate(([x, y]) => window.__occ.bench(x, y, 200), pickPoint)
    // Felt cost: frame intervals while the pointer rests on Mara's uncovered note, paired blocks with
    // the teapot body's raycast on and off.
    await turnTo(-116)
    const rest = out.angles.find(a => a.angle === -116).point
    await page.mouse.move(rest[0], rest[1])
    await sleep(300)
    out.fps = []
    for (let block = 0; block < 8; block++) {
      const optOut = block % 2 === 1
      const mode = await page.evaluate(on => window.__occ.bodyOptOut(on), optOut)
      await sleep(200)
      out.fps.push({ body: mode, ...(await page.evaluate(() => window.__occ.frames(1500))) })
    }
    await page.evaluate(() => window.__occ.bodyOptOut(false))
    // Cost: sample the CPU profile across pointer moves over the notes and the teapot at -132°.
    await turnTo(-132)
    const client = await page.createCDPSession()
    await client.send('Profiler.enable')
    await client.send('Profiler.setSamplingInterval', { interval: 50 })
    const a = await page.evaluate(() => window.__occ.project(0.05, 0.5)), b = await page.evaluate(() => window.__occ.project(0.95, 0.5))
    await client.send('Profiler.start')
    const t0 = Date.now()
    for (let k = 0; k < SAMPLE_MOVES; k++) {
      const f = (k % 100) / 99
      await page.mouse.move(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f)
    }
    const { profile } = await client.send('Profiler.stop')
    const wall = Date.now() - t0
    const byId = new Map(profile.nodes.map(n => [n.id, n]))
    const parent = new Map()
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
    const named = (n, fn, file) => n.callFrame.functionName === fn && n.callFrame.url.includes(file)
    const inclusive = { sceneMeshCovers: 0, hitRegion: 0, hitsTarget: 0 }
    for (let s = 0; s < profile.samples.length; s++) {
      const dt = profile.timeDeltas[s + 1] ?? 0
      const seen = new Set()
      for (let id = profile.samples[s]; id !== undefined; id = parent.get(id)) {
        const n = byId.get(id)
        if (named(n, 'sceneMeshCovers', 'surfaceOcclusion')) seen.add('sceneMeshCovers')
        if (n.callFrame.url.includes('surfaceHitRegion')) seen.add('hitRegion')
        if (named(n, 'hitsTarget', 'CanvasPointerGate')) seen.add('hitsTarget')
      }
      for (const k of seen) inclusive[k] += dt
    }
    out.cost = { moves: SAMPLE_MOVES, wallMs: wall, perMoveUs: Object.fromEntries(Object.entries(inclusive).map(([k, us]) => [k, Math.round(us / SAMPLE_MOVES * 10) / 10])), samplingIntervalUs: 50 }
  } finally {
    await browser.close()
  }
  return out
}

const results = []
let failed = false
try {
  for (const engine of engines) {
    try {
      const r = await run(engine)
      const ok = r.errors.length === 0 && r.angles.length === 3 && r.angles.every(a => a.focused === !a.covered) && r.angles.find(a => a.angle === -132)?.covered === true && r.fault?.optedOut === true && r.fault?.focused === true && r.engineInUse === engine
      if (!ok) failed = true
      results.push({ chrome: chromePath, engine, passed: ok, ...r })
    } catch (e) { failed = true; results.push({ chrome: chromePath, engine, passed: false, error: e.stack }) }
    console.log(JSON.stringify(results.at(-1)))
  }
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
  await server.close()
}
process.exit(failed ? 1 : 0)
