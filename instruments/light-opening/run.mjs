// Lit page readiness — once a framed Light or Postcard page marks itself ready,
// its layout and resting shadows must not change. An early-ready control marks
// the document ready at first content; both checks must catch that failure.
// On Postcard the control also delays the actual shadow worker. Light has no
// worker, so its control delays the fonts its lighting waits for.
import assert from 'node:assert/strict'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {setTimeout as delay} from 'node:timers/promises'
import {build, preview} from 'vite'
import puppeteer from 'puppeteer-core'
import {setChromeViewport} from '../chromeViewport.mjs'

const root = path.resolve(import.meta.dirname, '../../apps/lab')
const output = process.env.STARTUP_OUTPUT ?? path.join(tmpdir(), 'munari-light-opening')
// Decision #57: the native fallback deadline in lightOpening.ts, plus two
// animation frames and the sampler's own frame.
const NATIVE_DEADLINE_MS = 4000, NATIVE_SLACK_MS = 250
const scenes = {
  light: {entry: 'Light', boxes: ['heading']},
  postcard: {entry: 'Postcard', boxes: ['card']},
}
const cases = [
  {name: 'light-desktop', scene: 'light'},
  {name: 'light-mobile-slow-fonts', scene: 'light', width: 390, height: 844, fontDelay: 700},
  {name: 'light-native-capture-fallback', scene: 'light', capture: false},
  {name: 'light-no-webgl-font-failure', scene: 'light', capture: false, webgl: false, brokenFonts: true},
  {name: 'light-early-ready-control', scene: 'light', early: true, fontDelay: 1000},
  {name: 'light-animated-entrance', scene: 'light', reduced: false},
  {name: 'postcard-desktop', scene: 'postcard'},
  {name: 'postcard-mobile', scene: 'postcard', width: 390, height: 844},
  {name: 'postcard-stalled-shadow-worker', scene: 'postcard', stalledWorker: true},
  {name: 'postcard-early-ready-control', scene: 'postcard', early: true},
]
const selected = process.env.STARTUP_CASES?.split(',').map(name=>name.trim())
if(selected)assert.ok(selected.length>0&&selected.every(name=>cases.some(scenario=>scenario.name===name)),'STARTUP_CASES must name existing cases')

await mkdir(output, {recursive: true})
await build({root, logLevel: 'warn'})
const server = await preview({root, logLevel: 'warn', preview: {host: '127.0.0.1', port: 0}})
const url = `http://127.0.0.1:${server.httpServer.address().port}`
const appSource=await readFile(path.join(root,'src/App.tsx'),'utf8')
const sceneChunks=[...new Set([...appSource.matchAll(/import\(['"]\.\/scenes\/([^'"]+)['"]\)/g)].map(match=>path.basename(match[1])))]
assert.ok(Object.values(scenes).every(scene=>sceneChunks.includes(scene.entry)),'The probe must discover the scene entries before checking their requests')
const results = []
let browser

function assertControls(controls, states, announced, {scene, early, stalledWorker, fontDelay, brokenFonts}) {
  assert.ok(controls.entryDelayed>0,'The delayed entry control must intercept the actual entry script')
  if(early)assert.ok(controls.forcedReady,'The early-ready control must mark the document ready before the page does')
  if(early&&scene==='postcard')assert.ok(controls.workerDelayed>0,'The postcard control must delay the actual shadow worker')
  if(stalledWorker){
    assert.ok(controls.workerStalled>0,'The stalled-worker control must intercept the actual worker')
    // The deadline starts once the mounted page has its fonts.
    const start = Math.max(states.find(state => state.fonts === 'loaded')?.time ?? Infinity, states.find(state => state.content)?.time ?? Infinity)
    assert.ok(announced[0].time - start <= NATIVE_DEADLINE_MS + NATIVE_SLACK_MS, 'A stalled worker must fall back to native content within the deadline')
  }
  if(fontDelay)assert.ok(controls.fontsDelayed>0,'The font-delay control must intercept a requested font')
  if(brokenFonts)assert.ok(controls.fontsFailed>0,'The font-failure control must abort a requested font')
}

function assertOpening(result, {scene, early, reduced, capture, webgl, stalledWorker, fontDelay, brokenFonts}) {
  const {content, states, pixels, maximumShadowChange, scripts, errors, controls} = result
  const announced = states.filter(state => state.content && state.announced)
  const complete = states.findLast(state => state.content)
  assert.ok(announced.length && pixels.length > 1, 'The ready mark and its visible aftermath must be observed')
  assert.ok(pixels.every(frame => Number.isFinite(frame.error)), 'Every sampled shadow region must contain valid pixels')
  assert.equal(announced.some(state => !state.ready), early, 'Only the control may mark an unfinished page ready')
  if (reduced) assert.equal(maximumShadowChange > .01, early, 'Only the control may change its resting shadows after the ready mark')
  if (!early) for (const state of announced) for (const name of scenes[scene].boxes) for (const key of ['x', 'y', 'width', 'height']) {
    assert.ok(Math.abs(state[name][key] - complete[name][key]) <= 1, `${name}.${key} moved after the ready mark`)
  }
  assert.equal(content.capture, capture)
  assert.equal(content.lit, webgl && !stalledWorker)
  assert.equal(content.overflow, false)
  const others = sceneChunks.filter(name => name !== scenes[scene].entry)
  assert.ok(!scripts.some(script => others.some(name=>script.startsWith(`/assets/${name}-`))), `${scene} must not fetch other demos`)
  assertControls(controls, states, announced, {scene, early, stalledWorker, fontDelay, brokenFonts})
  if (!webgl || stalledWorker) {
    if (scene === 'light') assert.notEqual(content.colour, 'rgba(0, 0, 0, 0)', 'Native headline ink must be visible')
    else assert.notEqual(content.buttonShadow, 'none', 'The native depth shadow must replace the lighting')
  }
  assert.deepEqual(errors, [])
}

async function measure({name, scene, width = 1440, height = 1000, capture = true, webgl = true, early = false, fontDelay = 0, brokenFonts = false, stalledWorker = false, reduced = true}) {
  const directory = path.join(output, name)
  await mkdir(directory, {recursive: true})
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: process.env.HEADED !== '1', defaultViewport: null,
    signal: AbortSignal.timeout(30_000),
    args: [capture ? '--enable-features=CanvasDrawElement' : '--disable-features=CanvasDrawElement',
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', ...(!webgl ? ['--disable-webgl'] : [])],
  })
  const page = await browser.newPage(), errors = [], requests = [], frames = []
  const controls={entryDelayed:0,workerDelayed:0,workerStalled:0,fontsDelayed:0,fontsFailed:0}
  await setChromeViewport(page, {width, height})
  await page.emulateMediaFeatures([{name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference'}])
  await page.setCacheEnabled(false)
  await page.setRequestInterception(true)
  page.on('pageerror', error => errors.push(String(error)))
  page.on('request', async request => {
    const requested = new URL(request.url())
    requests.push(requested.pathname)
    if (requested.pathname.includes('/lightReliefWorker-')) {
      if (stalledWorker) { controls.workerStalled++;await request.respond({status: 200, contentType: 'application/javascript', body: "addEventListener('message',()=>{})"}); return }
      if (early) { controls.workerDelayed++;await delay(1000) }
    }
    if (requested.pathname.endsWith('.woff2') && requested.origin === url) {
      if (brokenFonts) { controls.fontsFailed++;await request.abort(); return }
      if (fontDelay) { controls.fontsDelayed++;await delay(fontDelay) }
    }
    if (/\/assets\/index-[^/]+\.js$/.test(requested.pathname)) { controls.entryDelayed++;await delay(180) }
    await request.continue()
  })
  await page.evaluateOnNewDocument(early => {
    window.__startup = []
    let previous = '', forced = false, pixel = null, tick = 0
    // A static fallback page otherwise produces only one screencast frame.
    // This one-pixel clock is outside the scene and all sampled regions.
    function paintClock() {
      if (!pixel && document.body) {
        pixel = document.createElement('i')
        pixel.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;z-index:2147483647;pointer-events:none'
        pixel.setAttribute('aria-hidden', 'true')
        document.body.append(pixel)
      }
      if (pixel) pixel.style.backgroundColor = tick++ % 2 ? '#f00' : '#00f'
    }
    function sample() {
      paintClock()
      const page = document.querySelector('.light-page')
      const content = document.querySelector('#root h1, #root .postcard-hero-holder')
      if (early && content && !forced) {
        forced = true
        window.__forcedReady = page?.dataset.pageReady !== 'true'
        document.documentElement.dataset.pageReady = 'true'
      }
      const rect = selector => document.querySelector('#root ' + selector)?.getBoundingClientRect().toJSON()
      const state = {
        content: !!content,
        announced: document.documentElement.dataset.pageReady === 'true',
        ready: page?.dataset.pageReady === 'true',
        lit: page?.dataset.lit === 'true',
        headline: !!document.querySelector('[data-headline-ready]'),
        fonts: document.fonts.status, heading: rect('h1'), card: rect('.postcard-hero-holder'),
      }
      const value = JSON.stringify(state)
      if (value !== previous) { window.__startup.push({time: performance.now(), ...state}); previous = value }
      if (!window.__stopStartup) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }, early)
  const client = await page.createCDPSession()
  client.on('Page.screencastFrame', event => {
    frames.push({time: event.metadata.timestamp * 1000, data: event.data, width: event.metadata.deviceWidth, height: event.metadata.deviceHeight})
    void client.send('Page.screencastFrameAck', {sessionId: event.sessionId}).catch(() => {})
  })
  await client.send('Page.startScreencast', {format: 'jpeg', quality: 95, maxWidth: width, maxHeight: height, everyNthFrame: 1})
  await page.goto(`${url}/?scene=${scene}&framed`, {waitUntil: 'load'})
  await page.waitForFunction(() => document.querySelector('.light-page')?.dataset.pageReady === 'true')
  // Observe after completion: a late worker result must not change visible shadows.
  await delay(1200)
  await client.send('Page.stopScreencast')
  await page.screenshot({path: path.join(directory, 'ready.png')})
  const [timing, content] = await Promise.all([
    page.evaluate(() => {
      window.__stopStartup = true
      return {origin: performance.timeOrigin, paint: performance.getEntriesByName('first-paint')[0].startTime, states: window.__startup, forcedReady: window.__forcedReady === true, width: innerWidth}
    }),
    page.evaluate(() => {
      const button = document.querySelector('.postcard-hero-row button')
      return {
        capture: 'drawElementImage' in CanvasRenderingContext2D.prototype,
        colour: getComputedStyle(document.querySelector('#root .light-headline-shaders') ?? document.body).color,
        overflow: document.querySelector('.light-page').scrollWidth > document.querySelector('.light-page').clientWidth,
        button: button?.getBoundingClientRect().toJSON(),
        buttonShadow: button ? getComputedStyle(button).boxShadow : null,
        lit: document.querySelector('.light-page').dataset.lit === 'true',
      }
    }),
  ])
  const scripts = [...new Set(requests.filter(request => request.startsWith('/assets/') && request.endsWith('.js')))]
  const scriptBytes = (await Promise.all(scripts.map(script => readFile(path.join(root, 'dist', script))))).reduce((sum, file) => sum + file.length, 0)
  const visible = frames.filter(frame => frame.time >= timing.origin + timing.paint)
  assert.ok(visible.length>1&&visible.every(frame=>Number.isFinite(frame.time)),'The recorder must deliver timestamped compositor frames')
  await Promise.all(visible.map((frame, index) => writeFile(path.join(directory, `frame-${String(index).padStart(3, '0')}.jpg`), Buffer.from(frame.data, 'base64'))))
  const announced = timing.states.filter(state => state.content && state.announced)
  const pixels = await page.evaluate(async ({frames, timing, region}) => {
    const decode = async (data, type) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], {type}))
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d')
      ctx.drawImage(bitmap, 0, 0); bitmap.close()
      return ctx.getImageData(0, 0, canvas.width, canvas.height)
    }
    const last = frames.at(-1)
    const final = await decode(last.data, 'image/jpeg')
    const read = (image, x, y, width) => {
      const scale = image.width / width
      const i = (Math.floor(y * scale) * image.width + Math.floor(x * scale)) * 4
      return image.data.slice(i, i + 3)
    }
    const metrics = []
    for (const frame of frames) {
      const state = timing.states.findLast(state => state.time <= frame.time - timing.origin)
      if (!state?.content || !state.announced) continue
      const image = await decode(frame.data, 'image/jpeg')
      let difference = 0, count = 0
      // A headed phone viewport can extend below Chrome's physical window.
      for (let y = Math.max(0, region.top); y < Math.min(region.bottom, image.height * frame.width / image.width); y += 2) {
        for (let x = Math.max(0, region.left); x < Math.min(timing.width, region.right); x += 2) {
          const a = read(image, x, y, frame.width), b = read(final, x, y, last.width)
          for (let channel = 0; channel < 3; channel++) { difference += Math.abs(a[channel] - b[channel]); count++ }
        }
      }
      metrics.push({time: frame.time - timing.origin, error: difference / count / 255})
    }
    return metrics
  }, {frames: visible, timing, region: shadowRegion(scene, timing.states.findLast(state => state.content), content, width < 800)})
  const maximumShadowChange = Math.max(...pixels.map(frame => frame.error))
  const result = {name, scene, content, scripts, scriptBytes, states: timing.states, pixels, maximumShadowChange, controls:{...controls,forcedReady:timing.forcedReady}, imageViewport: visible.at(-1)?.width, errors}
  await writeFile(path.join(directory, 'results.json'), JSON.stringify(result, null, 2))
  assertOpening(result, {scene, early, reduced, capture, webgl, stalledWorker, fontDelay, brokenFonts})
  console.log(JSON.stringify({name, readyMs: announced[0].time, maximumShadowChange, frames: pixels.length, scriptBytes}))
  results.push(result)
  await client.detach(); await browser.close(); browser = null
}

// Light: the headline and the shadows it casts around itself. Postcard: the
// action button's cast shadow on desktop, the card's own shadow on a phone.
function shadowRegion(scene, state, content, mobile) {
  if (scene === 'light') {
    const box = state.heading
    return {left: box.left - 24, right: box.right + 24, top: box.top - 24, bottom: box.bottom + 48}
  }
  const box = mobile ? state.card : content.button, margin = mobile ? 10 : 80
  return {left: box.left - margin, right: box.right + margin, top: box.bottom + (mobile ? 3 : 8), bottom: box.bottom + (mobile ? 17 : 88)}
}

try {
  for (const scenario of cases) if (!selected || selected.includes(scenario.name)) await measure(scenario)
  assert.ok(results.length>0,'At least one case must produce evidence')
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
} finally {
  await browser?.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
