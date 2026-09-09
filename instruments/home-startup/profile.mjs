// Opening costs — production code, no artificial network delays or screencast.
// A saved source baseline gives an alternating comparison in fresh Chrome
// profiles. Keep runs short: host overload invalidates the timing evidence.
import assert from 'node:assert/strict'
import {mkdir, writeFile} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {cpus, loadavg, tmpdir} from 'node:os'
import {build, preview} from 'vite'
import puppeteer from 'puppeteer-core'
import {replaceSource} from '../home-light/replaceSource.mjs'
import {setChromeViewport} from '../chromeViewport.mjs'

const root = path.resolve(import.meta.dirname, '../../apps/lab')
const output = process.env.PROFILE_OUTPUT ?? path.join(tmpdir(), 'munari-opening-profile')
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
function profileMark(name,extra={}){(window.__homeProfile??=[]).push({name,time:performance.timeOrigin+performance.now(),...extra})}
const profileSeen=new Set();
function profileWork(name,run){const start=performance.now();try{return run()}finally{profileMark(name,{duration:performance.now()-start})}}
function profileCall(name,run){if(profileSeen.has(name))return run();profileSeen.add(name);return profileWork(name,run)}
`
function observer(useBaseline = false) {
  return {name: 'opening-cost-observer', enforce: 'pre',
    transformIndexHtml: {order: 'pre', handler(html) { return useBaseline && baseline ? readFileSync(path.join(baseline, 'index.html'), 'utf8') : html }},
    transform(code, id) {
    if (useBaseline && baseline && id.includes('/src/scenes/home/') && !id.includes('?')) {
      const file = path.join(baseline, 'home', path.basename(id))
      code = readFileSync(file, 'utf8')
    }
    if (id.endsWith('/HomeMasthead.tsx')) {
      for (const [label, expression] of [
        ['shadow-context', 'new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, depth: true })'],
        ['bulb-context', 'new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, depth: true })'],
        ['headline-setup', 'createHeadlineTreatments(title.current,pass.mesh.material,redraw)'],
        ['environment', 'pmrem.fromScene(new RoomEnvironment(), 0.04).texture'],
        ['shadow-first-draw', 'display.render(pass.scene, pass.camera, pass.paper)'],
        ['bulb-first-draw', 'state.bulb.renderer.render(state.bulb.scene, state.bulb.camera)'],
      ]) code = replaceSource(code, expression, `profileCall('${label}',()=>${expression})`)
      const inkCall = code.includes('buildInkMask(inner, lines, previous?.mask)') ? 'buildInkMask(inner, lines, previous?.mask)' : 'buildInkMask(inner, lines)'
      code = replaceSource(code, inkCall, `profileWork('headline-mask',()=>${inkCall})`)
      code = replaceSource(code, '      worker.onmessage = (event: MessageEvent<ReliefReply>) => {', "      worker.onmessage = (event: MessageEvent<ReliefReply>) => {\nprofileMark('worker-received',{worker:event.data.__profile});")
      code = replaceSource(code, '        worker.postMessage(request)', "        profileMark('worker-request',{size:[plan.width,plan.height],boxes:plan.boxes.length});worker.postMessage(request)")
      code = replaceSource(code, "        reportReady('enhanced')", "        profileMark('composition-ready');reportReady('enhanced')")
    } else if (id.endsWith('/homeHeadlineTreatments.ts')) {
      code = replaceSource(code, 'renderer.render(scene,camera)', "profileCall('headline-first-draw',()=>renderer.render(scene,camera))")
    } else if (id.endsWith('/homeReliefWorker.ts')) {
      code = replaceSource(code, '  const mask = paintRelief(plan, offscreenPainter)', '  const start=performance.now();const mask = paintRelief(plan, offscreenPainter)')
      return replaceSource(code, '  const reply: ReliefReply = { id, mask }', '  const reply: ReliefReply = { id, mask, __profile:{start:performance.timeOrigin+start,duration:performance.now()-start} }')
    } else if (id.endsWith('/homeOpening.ts')) {
      code = replaceSource(code, "    void document.fonts.ready.then(() => { if (alive) setPhase('graphics') })", "    profileMark('fonts-wait');void document.fonts.ready.then(() => { if(alive){profileMark('fonts-ready');setPhase('graphics')} })")
    } else if (id.endsWith('/homeLampBackdrop.ts')) {
      code = replaceSource(code, 'copyViewport(page,width,height)', "profileCall('backdrop-clone',()=>copyViewport(page,width,height))")
      code = replaceSource(code, '          waitingPaint=false', "          profileMark('backdrop-paint');waitingPaint=false")
    } else if (id.endsWith('/components/siteOpening.ts')) {
      code = replaceSource(code, 'export function announceHomeReady() {', "export function announceHomeReady() {\nprofileMark('home-announced');")
      code = replaceSource(code, "  root.dataset.opening = 'revealing'", "  profileMark('reveal');root.dataset.opening = 'revealing'")
      code = replaceSource(code, 'cover.remove();', "profileMark('fully-visible');cover.remove();")
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
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scene=home`, {waitUntil: 'load'})
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-opening'))
    const documents = await Promise.all(page.frames().map(frame => frame.evaluate(() => ({url: location.href, origin: performance.timeOrigin, viewport: {width: innerWidth, height: innerHeight, dpr: devicePixelRatio}, visibility: document.visibilityState, events: window.__homeProfile ?? [], enhanced: !!document.querySelector('[data-headline-ready]'), lit: document.querySelector('.home-page')?.dataset.lit, ready: document.documentElement.dataset.homeReady}))))
    await writeFile(path.join(output, `run-${run}.json`), JSON.stringify({documents, errors, consoleErrors}, null, 2))
    assert.deepEqual(errors, [])
    assert.ok(documents.some(document => document.enhanced), 'Profile must reach enhanced rendering')
    const result = {run, variant, hostLoad, documents}
    results.push(result)
    const origin = documents[0].origin
    console.log(JSON.stringify({run, variant, events: documents.flatMap(document => document.events.map(event => ({...event, time: event.time - origin, document: document.url.includes('framed') ? 'home' : 'shell'})))}))
    await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
    await browser.close(); browser = null
  }
} finally {
  await browser?.close()
  await Promise.all(servers.map(server => new Promise(resolve => server.httpServer.close(resolve))))
}
