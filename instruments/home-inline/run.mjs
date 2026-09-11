// Inline Home — the real site owns one bounded demo, including its overlays.
// Navigation and container movement must preserve input, paint and cleanup.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { setChromeViewport } from '../chromeViewport.mjs'
import { observeLightingDraw } from '../home-light/gpu.mjs'
import { installPaperReader, controlPoint } from '../postcard-paper/metrics.mjs'

const output = process.env.INLINE_OUTPUT ?? path.join(tmpdir(), 'munari-home-inline')
await mkdir(output, { recursive: true })
const root = path.resolve(import.meta.dirname, '../../apps/lab')
const observer = {
  name: 'inline-home-observer', enforce: 'pre',
  transform(code, id) {
    code = observeLightingDraw(code, id)
    if (!id.endsWith('/src/App.tsx')) return code
    // Two actual Home instances share one document only in the served test copy.
    const marker = 'export default function App() {'
    assert.ok(code.includes(marker))
    return code.replace(marker, 'function LabApp() {') + `
export default function App() {
  if (!new URLSearchParams(location.search).has('hostPair')) return <LabApp />
  return <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',height:'100%',gap:24,padding:32}}>
    <HomeApp onReady={revealSite} /><HomeApp onReady={revealSite} />
  </div>
}
`
  },
}
const server = await createServer({ root, plugins: [observer], cacheDir: path.join(output, '.vite'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'warn' })
await server.listen()
const url = `http://127.0.0.1:${server.httpServer.address().port}`
const results = []
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const ready = page => page.waitForFunction(() => {
  const homes = [...document.querySelectorAll('.home-page')]
  return homes.length > 0 && homes.every(home => home.dataset.homeReady === 'true') && !document.documentElement.hasAttribute('data-opening')
})
const rect = (page, selector) => page.$eval(selector, element => element.getBoundingClientRect().toJSON())


let browser
try {
  for (const enhanced of [true, false]) {
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: process.env.HEADED !== '1', defaultViewport: null,
      args: [enhanced ? '--enable-features=CanvasDrawElement' : '--disable-features=CanvasDrawElement', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
    })
    const page = await browser.newPage(), errors = []
    page.on('pageerror', error => errors.push(String(error)))
    await setChromeViewport(page, { width: 1440, height: 1000 })
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
    await page.goto(url, { waitUntil: 'load' }); await ready(page)
    assert.equal(await page.$('iframe.site-frame'), null)
    assert.equal(await page.evaluate(() => 'drawElementImage' in CanvasRenderingContext2D.prototype), enhanced)
    const before = await rect(page, '[data-demo-host]')
    assert.equal(before.x, 256)
    await page.focus('.home-light'); await page.keyboard.press('ArrowRight'); await frames(page)
    const lightBefore = await rect(page, '.home-light')
    await page.evaluate(() => {
      document.querySelector('.site-sidebar').style.flexBasis = '360px'
      document.querySelector('.site-content').style.paddingTop = '72px'
    })
    await page.waitForFunction(() => {
      const host = document.querySelector('[data-demo-host]'), box = host.getBoundingClientRect()
      return box.x === 360 && box.y === 72 && Number.parseFloat(host.style.getPropertyValue('--demo-width')) === host.clientWidth
    })
    await frames(page)
    const moved = await rect(page, '[data-demo-host]'), lightMoved = await rect(page, '.home-light')
    assert.ok(Math.abs((lightMoved.x - moved.x) - (lightBefore.x - before.x)) < 1, JSON.stringify({before,moved,lightBefore,lightMoved}))
    assert.ok(Math.abs((lightMoved.y - moved.y) - (lightBefore.y - before.y)) < 1, JSON.stringify({before,moved,lightBefore,lightMoved}))
    const layout = await page.evaluate(() => {
      const host = document.querySelector('[data-demo-host]'), page = host.querySelector('.home-page')
      const shadow = page.querySelector('.home-light-host'), bulb = host.querySelector('.home-light-scene')
      return { overflow: page.scrollWidth > page.clientWidth, host: host.getBoundingClientRect().toJSON(), shadow: shadow.getBoundingClientRect().toJSON(), bulb: bulb.getBoundingClientRect().toJSON() }
    })
    assert.equal(layout.overflow, false)
    assert.equal(layout.shadow.x, moved.x)
    assert.equal(layout.bulb.x, moved.x)
    assert.equal(layout.bulb.y, moved.y)
    const selectionStyle = await page.evaluate(() => document.body.style.userSelect)
    await page.mouse.move(lightMoved.x + lightMoved.width / 2, lightMoved.y + lightMoved.height / 2)
    await page.mouse.down(); await page.mouse.move(moved.x - 80, moved.y - 80, { steps: 6 }); await page.mouse.up()
    await frames(page)
    const edgeLight = await rect(page, '.home-light')
    assert.ok(Math.abs(edgeLight.x - moved.x) < 1 && Math.abs(edgeLight.y - moved.y) < 1, JSON.stringify(edgeLight))
    assert.equal(await page.evaluate(() => document.body.style.userSelect), selectionStyle)

    // Shell theme changes cannot replace Home's explicit palette and typography.
    const colours = await page.evaluate(() => {
      const shell = document.querySelector('.site-content'), home = document.querySelector('.home-demo')
      const read = () => { const css = getComputedStyle(home); return [css.color, css.fontFamily, css.getPropertyValue('--paper')] }
      const before = read()
      shell.style.color = 'red'; shell.style.fontFamily = 'monospace'; shell.style.setProperty('--paper', 'red')
      return { before, after: read() }
    })
    assert.deepEqual(colours.after, colours.before)
    const input = await page.$('.home-hero-holder [data-api-live] input, .home-hero-holder > .home-postcard input')
    assert.ok(input)
    await input.click(); await page.keyboard.type('Home slice')
    await page.click('.home-postcard-msg button')
    if (enhanced) {
      await installPaperReader(page)
      await page.click('.home-hero-row button')
      await page.waitForFunction(() => document.querySelector('.home-postcard-status').dataset.gl === 'true')
      await frames(page)
      assert.ok(await page.evaluate(element => document.querySelector('.home-hero-holder [data-api-live] input') === element, input))
      const point = await controlPoint(page, 'input')
      await page.mouse.click(point.x, point.y); await page.keyboard.press('End'); await page.keyboard.type(' in 3D')
      assert.equal(await input.evaluate(element => element.value), 'Home slice in 3D')
      await page.$eval('.home-page', element => { element.scrollTop = 180 })
      await frames(page)
      const geometry = await page.evaluate(() => ({ anchor: window.__readPaper().paper.anchor, holder: document.querySelector('.home-hero-holder').getBoundingClientRect().toJSON() }))
      assert.ok(Math.abs(geometry.anchor.x - geometry.holder.x) < 1 && Math.abs(geometry.anchor.y - geometry.holder.y) < 1)
      await page.$eval('.home-page', element => { element.scrollTop = 0 }); await frames(page)
      await page.click('.home-hero-row button')
      await page.waitForFunction(() => document.querySelector('.home-postcard-status').dataset.gl === 'false')
      assert.equal(await input.evaluate(element => element.value), 'Home slice in 3D')
      assert.ok(await page.evaluate(element => element.isConnected && document.querySelector('.home-hero-holder [data-api-live] input') === element, input))
    } else assert.equal(await input.evaluate(element => element.value), 'Home slice')
    await page.screenshot({ path: path.join(output, enhanced ? 'inline.png' : 'native.png') })
    const lamp = await rect(page, '.home-light')
    await page.mouse.move(lamp.x + lamp.width / 2, lamp.y + lamp.height / 2); await page.mouse.down()
    await page.evaluate(() => [...document.querySelectorAll('.site-nav-list button')].find(button => button.querySelector('b')?.textContent === 'Flight').click())
    const iframe = await page.waitForSelector('iframe.site-frame')
    const flight = await iframe.contentFrame(); await flight.waitForSelector('.l14')
    assert.equal(await page.$('.home-demo'), null)
    await page.mouse.up()
    assert.equal(await page.evaluate(() => document.body.style.userSelect), selectionStyle)
    assert.equal(await page.$$eval('.home-light-canvas,.home-headline-canvas,.home-canvas,[data-lamp-capture]', nodes => nodes.length), 0)
    await page.goBack(); await ready(page)
    assert.equal(await page.$('iframe.site-frame'), null)
    assert.equal(await page.$eval('.home-postcard input', element => element.value), '')
    await page.click('.home-masthead-links a[href="#examples"]')
    await page.waitForFunction(() => location.hash === '#examples' && document.querySelector('.home-page').scrollTop > 100)
    await page.goBack()
    await page.waitForFunction(() => location.hash === '' && document.querySelector('.home-page').scrollTop === 0)
    assert.deepEqual(errors, [])
    results.push({ enhanced, before, moved, layout, colours, retainedInput: true, navigation: true })
    await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
    console.log(JSON.stringify(results.at(-1)))
    await page.close(); await browser.close(); browser = null
  }

  // Instance identity and styles are local even when two real Homes coexist.
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: process.env.HEADED !== '1', defaultViewport: null, args: ['--enable-features=CanvasDrawElement'] })
  const page = await browser.newPage(), errors = [], diagnostics = []
  page.on('pageerror', error => errors.push(String(error)))
  page.on('console', message => { if (message.type() === 'error') diagnostics.push({text:message.text(),url:message.location().url}) })
  await setChromeViewport(page, { width: 1440, height: 1000 })
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.goto(url + '/?scene=home&hostPair', { waitUntil: 'load' }); await ready(page)
  assert.equal(await page.$$eval('[data-demo-host]', elements => elements.length), 2)
  await page.$eval('[data-demo-host]', element => element.style.setProperty('--paper', 'rgb(220, 230, 240)'))
  await page.waitForFunction(() => [...document.querySelectorAll('[data-lamp-capture]')].some(element => getComputedStyle(element).getPropertyValue('--paper') === 'rgb(220, 230, 240)'))
  const first = await page.$('[data-demo-host]')
  const name = await first.$('.home-postcard input'); await name.type('First')
  await first.$eval('.home-hero-row button', element => element.click())
  await page.waitForFunction(() => document.querySelector('.home-postcard-status').dataset.gl === 'true')
  const pair = await page.$$eval('[data-demo-host]', elements => elements.map(element => ({ name: element.querySelector('.home-postcard input').value, inScene: element.querySelector('.home-postcard-status').dataset.gl, paper: getComputedStyle(element.querySelector('.home-postcard')).getPropertyValue('--paper') })))
  assert.deepEqual(pair.map(entry => entry.name), ['First', ''])
  assert.deepEqual(pair.map(entry => entry.inScene), ['true', 'false'])
  assert.notEqual(pair[0].paper, pair[1].paper)
  assert.ok(!diagnostics.some(message => message.text.includes('two <SurfaceCanvas')))
  assert.deepEqual(errors, [])
  results.push({ pair, diagnostics }); console.log(JSON.stringify(results.at(-1)))
  await page.screenshot({ path: path.join(output, 'two-instances.png') })
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
} finally { await browser?.close(); await server.close() }
