// Opening frames — show the prepared composition once, then keep its shadows stable.
// An early-reveal control exposes native HTML while the shadow worker is delayed;
// both the readiness check and the button-shadow pixels must catch that failure.
import assert from 'node:assert/strict'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {setTimeout as delay} from 'node:timers/promises'
import {build, preview} from 'vite'
import puppeteer from 'puppeteer-core'
import {setChromeViewport} from '../chromeViewport.mjs'

const root = path.resolve(import.meta.dirname, '../../apps/lab')
const output = process.env.STARTUP_OUTPUT ?? path.join(tmpdir(), 'munari-home-startup')
const cases = [
  {name: 'desktop'},
  {name: 'mobile-slow-fonts', width: 390, height: 844, fontDelay: 700},
  {name: 'native-capture-fallback', capture: false},
  {name: 'no-webgl-font-failure', capture: false, webgl: false, brokenFonts: true},
  {name: 'stalled-shadow-worker', stalledWorker: true},
  {name: 'early-reveal-control', early: true},
  {name: 'animated-entrance', reduced: false},
]
const selected = process.env.STARTUP_CASES?.split(',').map(name=>name.trim())
if(selected)assert.ok(selected.length>0&&selected.every(name=>cases.some(scenario=>scenario.name===name)),'STARTUP_CASES must name existing cases')

await mkdir(output, {recursive: true})
await build({root, logLevel: 'warn'})
const server = await preview({root, logLevel: 'warn', preview: {host: '127.0.0.1', port: 0}})
const url = `http://127.0.0.1:${server.httpServer.address().port}`
const appSource=await readFile(path.join(root,'src/App.tsx'),'utf8')
const otherDemoChunks=[...new Set([...appSource.matchAll(/import\(['"]\.\/scenes\/([^'"]+)['"]\)/g)].map(match=>path.basename(match[1])))]
assert.ok(otherDemoChunks.length>0,'The probe must discover the other scene entries before checking their requests')
const results = []
let browser

function assertOpening(result, {early, reduced, capture, webgl, stalledWorker, fontDelay, brokenFonts}) {
  const {content, states, pixels, maximumShadowChange, scripts, errors, controls} = result
  const exposed = states.filter(state => state.home && state.exposed)
  const complete = states.findLast(state => state.home)
  assert.ok(exposed.length && pixels.length > 1, 'The opening and its visible aftermath must be observed')
  assert.ok(pixels.every(frame => Number.isFinite(frame.error)), 'Every sampled shadow region must contain valid pixels')
  assert.equal(exposed.some(state => !state.ready), early, 'Only the control may expose an unfinished page')
  if (reduced) assert.equal(maximumShadowChange > .01, early, 'Only the control may change its resting button shadow after reveal')
  if (!early) for (const state of exposed) for (const name of ['heading', 'card']) for (const key of ['x', 'y', 'width', 'height']) {
    assert.ok(Math.abs(state[name][key] - complete[name][key]) <= 1, `${name}.${key} moved after reveal`)
  }
  assert.equal(content.capture, capture)
  assert.equal(content.lit, webgl && !stalledWorker)
  assert.equal(content.overflow, false)
  assert.ok(!scripts.some(script => otherDemoChunks.some(name=>script.startsWith(`/assets/${name}-`))), 'Home must not fetch other demos')
  assert.ok(controls.entryDelayed>0,'The delayed entry control must intercept the actual entry script')
  if(early)assert.ok(controls.workerDelayed>0&&controls.forcedReveal,'The early-reveal control must remove a cover while delaying the actual worker')
  if(stalledWorker)assert.ok(controls.workerStalled>0,'The stalled-worker control must intercept the actual worker')
  if(fontDelay)assert.ok(controls.fontsDelayed>0,'The font-delay control must intercept a requested font')
  if(brokenFonts)assert.ok(controls.fontsFailed>0,'The font-failure control must abort a requested font')
  if (!webgl || stalledWorker) assert.notEqual(content.colour, 'rgba(0, 0, 0, 0)')
  assert.deepEqual(errors, [])
}

async function measure({name, width = 1440, height = 1000, capture = true, webgl = true, early = false, fontDelay = 0, brokenFonts = false, stalledWorker = false, reduced = true}) {
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
    if (requested.pathname.includes('/homeReliefWorker-')) {
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
    // Static fallback pages otherwise produce only one screencast frame.
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
      const doc = document
      const heading = doc?.querySelector('#root h1')
      if (early && heading && !forced) {
        forced = true
        window.__forcedStartupReveal=Boolean(document.getElementById('site-opening'))
        document.getElementById('site-opening')?.remove()
        delete document.documentElement.dataset.opening
        document.getElementById('root')?.removeAttribute('inert')
      }
      const cover = document.getElementById('site-opening')
      const opacity = cover ? Number(getComputedStyle(cover).opacity) : 0
      const rect = selector => doc?.querySelector('#root ' + selector)?.getBoundingClientRect().toJSON()
      const state = {
        home: !!heading, exposed: !cover || opacity < 1, covered: !!cover,
        opening: document.documentElement.dataset.opening,
        ready: doc?.querySelector('.home-page')?.dataset.homeReady === 'true',
        lit: doc?.querySelector('.home-page')?.dataset.lit === 'true',
        headline: !!doc?.querySelector('[data-headline-ready]'),
        fonts: doc?.fonts.status, heading: rect('h1'), card: rect('.home-hero-holder'),
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
  await page.goto(url + '/?scene=home', {waitUntil: 'load'})
  await page.waitForSelector('.home-page')
  assert.equal(await page.$('iframe.site-frame'), null, 'Home must render in the site document')
  const frame = page
  await frame.waitForFunction(() => document.querySelector('.home-page')?.dataset.homeReady === 'true')
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-opening'))
  // Observe after completion: a late worker result must not change visible shadows.
  await delay(1200)
  await client.send('Page.stopScreencast')
  await page.screenshot({path: path.join(directory, 'ready.png')})
  const [timing, content] = await Promise.all([
    page.evaluate(() => {
      window.__stopStartup = true
      const frame = { x: 0, y: 0 }
      return {origin: performance.timeOrigin, paint: performance.getEntriesByName('first-paint')[0].startTime, states: window.__startup, forcedReveal:window.__forcedStartupReveal===true, frame, width: innerWidth}
    }),
    frame.evaluate(() => ({
      capture: 'drawElementImage' in CanvasRenderingContext2D.prototype,
      colour: getComputedStyle(document.querySelector('#root .home-headline-shaders')).color,
      overflow: document.querySelector('.home-page').scrollWidth > document.querySelector('.home-page').clientWidth,
      button: document.querySelector('.home-hero-row button').getBoundingClientRect().toJSON(),
      lit: document.querySelector('.home-page').dataset.lit === 'true',
    })),
  ])
  const scripts = [...new Set(requests.filter(request => request.startsWith('/assets/') && request.endsWith('.js')))]
  const scriptBytes = (await Promise.all(scripts.map(script => readFile(path.join(root, 'dist', script))))).reduce((sum, file) => sum + file.length, 0)
  const visible = frames.filter(frame => frame.time >= timing.origin + timing.paint)
  assert.ok(visible.length>1&&visible.every(frame=>Number.isFinite(frame.time)),'The recorder must deliver timestamped compositor frames')
  await Promise.all(visible.map((frame, index) => writeFile(path.join(directory, `frame-${String(index).padStart(3, '0')}.jpg`), Buffer.from(frame.data, 'base64'))))
  const exposed = timing.states.filter(state => state.home && state.exposed)
  const pixels = await page.evaluate(async ({frames, timing, button, mobile}) => {
    const decode = async (data, type) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], {type}))
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d')
      ctx.drawImage(bitmap, 0, 0); bitmap.close()
      return ctx.getImageData(0, 0, canvas.width, canvas.height)
    }
    const last = frames.at(-1)
    const final = await decode(last.data, 'image/jpeg')
    const {x: frameX, y: frameY} = timing.frame
    const read = (image, x, y, width) => {
      const scale = image.width / width
      const i = (Math.floor(y * scale) * image.width + Math.floor(x * scale)) * 4
      return image.data.slice(i, i + 3)
    }
    const metrics = []
    for (const frame of frames) {
      const image = await decode(frame.data, 'image/jpeg')
      const state = timing.states.findLast(state => state.time <= frame.time - timing.origin)
      if (!state?.home || state.covered) continue
      // DOM removal can precede the screencast's last image of the cover. The
      // postcard's pale interior distinguishes an actual page frame from it.
      const card = state.card
      const paper = read(image, frameX + card.right - 24, frameY + card.bottom - 24, frame.width)
      if (paper[2] < 140) continue
      let difference = 0, count = 0
      // A headed phone viewport can extend below Chrome's physical window.
      // Its postcard shadow is visible there; desktop pins the action shadow.
      const box = mobile ? card : button, margin = mobile ? 10 : 80
      const top = mobile ? 3 : 8, bottom = mobile ? 17 : 88
      for (let y = frameY + box.bottom + top; y < Math.min(frameY + box.bottom + bottom, image.height * frame.width / image.width); y += 2) {
        for (let x = Math.max(frameX, frameX + box.left - margin); x < Math.min(timing.width, frameX + box.right + margin); x += 2) {
          const a = read(image, x, y, frame.width), b = read(final, x, y, last.width)
          for (let channel = 0; channel < 3; channel++) { difference += Math.abs(a[channel] - b[channel]); count++ }
        }
      }
      metrics.push({time: frame.time - timing.origin, error: difference / count / 255})
    }
    return metrics
  }, {frames: visible, timing, button: content.button, mobile: width < 800})
  const maximumShadowChange = Math.max(...pixels.map(frame => frame.error))
  const result = {name, content, scripts, scriptBytes, states: timing.states, pixels, maximumShadowChange, controls:{...controls,forcedReveal:timing.forcedReveal}, imageViewport: visible.at(-1)?.width, errors}
  await writeFile(path.join(directory, 'results.json'), JSON.stringify(result, null, 2))
  assertOpening(result, {early, reduced, capture, webgl, stalledWorker, fontDelay, brokenFonts})
  console.log(JSON.stringify({name, firstVisibleMs: exposed[0].time, maximumShadowChange, frames: pixels.length, scriptBytes}))
  results.push(result)
  await client.detach(); await browser.close(); browser = null
}

try {
  for (const scenario of cases) if (!selected || selected.includes(scenario.name)) await measure(scenario)
  assert.ok(results.length>0,'At least one startup case must produce evidence')
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
} finally {
  await browser?.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
