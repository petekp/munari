// Light page readiness costs — the framed production page, no artificial network
// delays or screencast. A saved source baseline gives an alternating comparison
// in fresh Chrome profiles. Keep runs short: host overload invalidates timings.
import assert from 'node:assert/strict'
import {mkdir, writeFile} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {cpus, loadavg, tmpdir} from 'node:os'
import {build, preview} from 'vite'
import puppeteer from 'puppeteer-core'
import {replaceSource} from '../light/replaceSource.mjs'
import {setChromeViewport} from '../chromeViewport.mjs'

const root = path.resolve(import.meta.dirname, '../../apps/lab')
const output = process.env.PROFILE_OUTPUT ?? path.join(tmpdir(), 'munari-light-profile')
const baseline = process.env.PROFILE_BASELINE
const pairs = Number(process.env.PROFILE_PAIRS ?? 1)
assert.ok(Number.isInteger(pairs) && pairs >= 1 && pairs <= 3, 'PROFILE_PAIRS must be 1, 2, or 3')
const variants = baseline ? ['baseline', 'optimized'] : ['optimized']
function requireHeadroom() {
  const load = loadavg()[0]
  // An operating guard, not an application budget. Stop at a one-minute
  // load of three quarters of the logical CPU count before adding more work.
  assert.ok(load < cpus().length * .75, `Host load ${load.toFixed(1)} is too high for a trustworthy profile; stop and retry after it settles`)
  return load
}
requireHeadroom()
await mkdir(output, {recursive: true})
const helper = `
function profileMark(name,extra={}){(window.__lightProfile??=[]).push({name,time:performance.timeOrigin+performance.now(),...extra})}
const profileSeen=new Set();
function profileWork(name,run){const start=performance.now();try{return run()}finally{profileMark(name,{duration:performance.now()-start})}}
function profileCall(name,run){if(profileSeen.has(name))return run();profileSeen.add(name);return profileWork(name,run)}
`
function observer(useBaseline = false) {
  return {name: 'readiness-cost-observer', enforce: 'pre',
    transformIndexHtml: {order: 'pre', handler(html) { return useBaseline && baseline ? readFileSync(path.join(baseline, 'index.html'), 'utf8') : html }},
    transform(code, id) {
    if (useBaseline && baseline && id.includes('/src/scenes/light/') && !id.includes('?')) {
      const file = path.join(baseline, 'light', path.basename(id))
      code = readFileSync(file, 'utf8')
    }
    if (id.endsWith('/LightLamp.tsx')) {
      for (const [label, expression] of [
        ['shadow-context', 'new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, depth: true })'],
        ['bulb-context', 'new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, depth: true })'],
        ['headline-setup', code.includes('createHeadlineTreatments(title.current,pass.mesh.material,redraw,page)')
          ? 'createHeadlineTreatments(title.current,pass.mesh.material,redraw,page)'
          : 'createHeadlineTreatments(title.current,pass.mesh.material,redraw)'],
        ['environment', 'pmrem.fromScene(new RoomEnvironment(), 0.04).texture'],
        ['shadow-first-draw', 'display.render(pass.scene, pass.camera, pass.paper)'],
        ['bulb-first-draw', 'state.bulb.renderer.render(state.bulb.scene, state.bulb.camera)'],
      ]) code = replaceSource(code, expression, `profileCall('${label}',()=>${expression})`)
      const inkCall = code.includes('buildInkMask(inner, lines, previous?.mask)') ? 'buildInkMask(inner, lines, previous?.mask)' : 'buildInkMask(inner, lines)'
      code = replaceSource(code, inkCall, `profileWork('headline-mask',()=>${inkCall})`)
      code = replaceSource(code, '      worker.onmessage = (event: MessageEvent<ReliefReply>) => {', "      worker.onmessage = (event: MessageEvent<ReliefReply>) => {\nprofileMark('worker-received',{worker:event.data.__profile});")
      code = replaceSource(code, '        worker.postMessage(request)', "        profileMark('worker-request',{size:[plan.width,plan.height],boxes:plan.boxes.length});worker.postMessage(request)")
      code = replaceSource(code, "        reportReady('enhanced')", "        profileMark('composition-ready');reportReady('enhanced')")
    } else if (id.endsWith('/lightHeadlineTreatments.ts')) {
      code = replaceSource(code, 'renderer.render(scene,camera)', "profileCall('headline-first-draw',()=>renderer.render(scene,camera))")
    } else if (id.endsWith('/lightReliefWorker.ts')) {
      code = replaceSource(code, '  const mask = paintRelief(plan, offscreenPainter)', '  const start=performance.now();const mask = paintRelief(plan, offscreenPainter)')
      return replaceSource(code, '  const reply: ReliefReply = { id, mask }', '  const reply: ReliefReply = { id, mask, __profile:{start:performance.timeOrigin+start,duration:performance.now()-start} }')
    } else if (id.endsWith('/lightOpening.ts')) {
      code = replaceSource(code, "    void document.fonts.ready.then(() => { if (alive) setPhase('graphics') })", "    profileMark('fonts-wait');void document.fonts.ready.then(() => { if(alive){profileMark('fonts-ready');setPhase('graphics')} })")
    } else if (id.endsWith('/lightLampBackdrop.ts')) {
      code = replaceSource(code, 'copyViewport(page,width,height)', "profileCall('backdrop-clone',()=>copyViewport(page,width,height))")
      code = replaceSource(code, '          waitingPaint=false', "          profileMark('backdrop-paint');waitingPaint=false")
    } else if (id.endsWith('/components/siteOpening.ts')) {
      code = replaceSource(code, 'export function announcePageReady() {', "export function announcePageReady() {\nprofileMark('page-ready');")
    } else if (id.endsWith('/src/main.tsx')) {
      code = replaceSource(code, "createRoot(document.getElementById('root')!).render(", "profileMark('entry-evaluated');createRoot(document.getElementById('root')!).render(")
    } else return useBaseline ? code : undefined
    return helper + code
  }}
}

const servers = []
const results = []
let browser
try {
  for (const variant of variants) {
    requireHeadroom()
    const useBaseline = variant === 'baseline'
    const outDir = path.join(output, variant)
    await build({root, plugins: [observer(useBaseline)], worker: {plugins: () => [observer(useBaseline)]}, logLevel: 'warn', build: {outDir, emptyOutDir: true}})
    const server = await preview({root, logLevel: 'warn', build: {outDir}, preview: {host: '127.0.0.1', port: 0}})
    servers.push(server)
  }
  for (let run = 0; run < pairs * variants.length; run++) {
    const hostLoad = requireHeadroom()
    const index = run % variants.length, variant = variants[index], server = servers[index]
    // Puppeteer already closes its own process group on interruption. Its
    // launch signal also bounds a stalled run, including protocol calls/close.
    browser = await puppeteer.launch({executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, defaultViewport: null, signal: AbortSignal.timeout(15_000), args: ['--enable-features=CanvasDrawElement']})
    const page = await browser.newPage(), errors = [], consoleErrors = []
    page.setDefaultTimeout(10_000)
    page.on('pageerror', error => errors.push(String(error)))
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    await setChromeViewport(page, {width: 1280, height: 700})
    await page.setCacheEnabled(false)
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scene=light&framed`, {waitUntil: 'load'})
    await page.waitForFunction(() => document.documentElement.dataset.pageReady === 'true')
    const observed = await page.evaluate(() => ({url: location.href, origin: performance.timeOrigin, viewport: {width: innerWidth, height: innerHeight, dpr: devicePixelRatio}, visibility: document.visibilityState, events: window.__lightProfile ?? [], enhanced: !!document.querySelector('[data-headline-ready]'), lit: document.querySelector('.light-page')?.dataset.lit}))
    await writeFile(path.join(output, `run-${run}.json`), JSON.stringify({document: observed, errors, consoleErrors}, null, 2))
    assert.deepEqual(errors, [])
    assert.ok(observed.enhanced, 'Profile must reach enhanced rendering')
    for(const name of ['entry-evaluated','fonts-ready','composition-ready','page-ready'])assert.ok(observed.events.some(event=>event.name===name&&Number.isFinite(event.time)),`Profile observation did not reach ${name}`)
    for(const event of observed.events.filter(event=>event.name==='worker-received'))assert.ok(Number.isFinite(event.worker?.start)&&Number.isFinite(event.worker?.duration)&&event.worker.duration>=0,'A worker response must carry the worker timing observation')
    const result = {run, variant, hostLoad, document: observed}
    results.push(result)
    console.log(JSON.stringify({run, variant, events: observed.events.map(event => ({...event, time: event.time - observed.origin}))}))
    await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
    await browser.close(); browser = null
  }
} finally {
  await browser?.close()
  await Promise.all(servers.map(server => new Promise(resolve => server.httpServer.close(resolve))))
}
