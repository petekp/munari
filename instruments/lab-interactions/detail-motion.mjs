// Detail motion regressions on the real lab routes. Pausing R3F's frame
// clock makes Unroll's preparation cancellation reproducible without replacing
// capture or presentation code. Genie focus and Lamp release use native input.
// Exact spring/normal laws are covered by the adjacent numerical scene tests.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
import { setChromeViewport } from '../chromeViewport.mjs'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const labRoot = path.join(repoRoot, 'apps/lab')
const output = process.env.DETAIL_MOTION_OUTPUT ?? path.join(tmpdir(), 'munari-detail-motion')
const selected = new Set((process.env.DETAIL_MOTION_CASES ?? 'unroll,genie,copy,lamp').split(','))
const headed = process.env.HEADED === '1'
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(value => value && existsSync(value))
assert.ok(chrome, 'Chrome is required (set CHROME_PATH)')
await mkdir(output, { recursive: true })

let browser
let server
const results = []
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const shot = (page, name) => page.screenshot({ path: path.join(output, `${name}.png`) })

async function checkUnroll(page) {
  await page.waitForFunction(() => window.__r3f?.scene, { timeout: 20_000 })
  const trigger = '.cand-card--menu .cand-btn'
  const source = '[data-munari-source-host][data-munari-surface="unroll-menu"]'
  // With the render clock held, no first color draw can mark this resident
  // presented. Both clicks still go through the actual native button.
  await page.evaluate(() => window.__r3f.setFrameloop('never'))
  await page.click(trigger)
  await page.waitForSelector(source)
  assert.equal(await page.$eval(trigger, element => element.getAttribute('aria-expanded')), 'true')
  await page.click(trigger)
  await page.waitForFunction(selector => !document.querySelector(selector), { timeout: 5_000 }, source)
  await page.evaluate(() => window.__r3f.setFrameloop('always'))
  await frames(page)
  const removed = await page.evaluate(selector => {
    let menuMeshes = 0
    window.__r3f.scene.traverse(object => { if (object.material?.uniforms?.uOpacity) menuMeshes++ })
    return { sourceRemoved: !document.querySelector(selector), menuMeshes }
  }, source)
  assert.deepEqual(removed, { sourceRemoved: true, menuMeshes: 0 })

  // A complete open/close must still animate and release the same subtree.
  await page.click(trigger)
  await page.waitForFunction(() => {
    let flat = false
    window.__r3f.scene.traverse(object => {
      if (!object.material?.uniforms?.uOpacity || !object.geometry) return
      const positions = object.geometry.getAttribute('position')
      let maximumZ = 0
      for (let i = 0; i < positions.count; i++) maximumZ = Math.max(maximumZ, Math.abs(positions.getZ(i)))
      flat = object.material.uniforms.uOpacity.value === 1 && maximumZ < 0.01
    })
    return flat
  }, { timeout: 12_000 })
  await shot(page, '39-unroll-open')
  await page.click(trigger)
  await page.waitForFunction(selector => !document.querySelector(selector), { timeout: 5_000 }, source)
  return { issues: [39], delayedOpenCancelled: removed, completeCycleClosed: true }
}

async function checkGenie(page) {
  const slot = '.gen-slot[data-win="quadrato"]'
  const lamp = `${slot} .gen-lamp[data-role="minimize"]`
  const tile = '.gen-tile[data-win="quadrato"]'
  await page.waitForSelector(lamp)
  const filled = value => page.waitForFunction(({ selector, value }) =>
    document.querySelector(selector)?.dataset.filled === value, { timeout: 15_000 }, { selector: tile, value })
  const restored = () => page.waitForFunction(({ slot, tile }) =>
    !document.querySelector(slot)?.hasAttribute('data-away') && document.querySelector(tile)?.dataset.filled === 'false',
  { timeout: 15_000 }, { slot, tile })

  // Shift is the scene's existing slow-motion gesture, used only for a
  // reviewable flight still. The spring's exact rate law is checked below.
  await page.keyboard.down('Shift')
  await page.click(lamp)
  await page.keyboard.up('Shift')
  await page.waitForFunction(selector => document.querySelector(selector)?.dataset.away === 'true', {}, slot)
  await page.waitForFunction(selector => {
    const progress = Number(document.querySelector(selector)?.style.getPropertyValue('--pour'))
    return progress > 0.15 && progress < 0.7
  }, { timeout: 10_000 }, tile)
  await shot(page, '36-genie-flight')
  await filled('true')
  await page.click(tile)
  await restored()
  await frames(page)
  const mouseFocus = await page.evaluate(({ slot, lamp }) => ({
    wrapper: document.activeElement === document.querySelector(slot),
    minimize: document.activeElement === document.querySelector(lamp),
  }), { slot, lamp })
  assert.deepEqual(mouseFocus, { wrapper: true, minimize: false })
  await page.keyboard.press('Space')
  const minimizedBySpace = await page.waitForFunction(selector => document.querySelector(selector)?.dataset.filled === 'true',
    { timeout: 1_500 }, tile).then(() => true, error => {
    if (error.name !== 'TimeoutError') throw error
    return false
  })
  assert.equal(minimizedBySpace, false, 'Space re-minimized a mouse-restored window')

  await page.click(lamp)
  await filled('true')
  let reached = false
  for (let step = 0; step < 80; step++) {
    await page.keyboard.press('Tab')
    reached = await page.evaluate(selector => document.activeElement === document.querySelector(selector), tile)
    if (reached) break
  }
  assert.ok(reached, 'The keyboard never reached the filled dock tile')
  assert.ok(await page.$eval(tile, element => element.matches(':focus-visible')))
  await page.keyboard.press('Enter')
  await restored()
  await page.waitForFunction(selector => document.activeElement === document.querySelector(selector), {}, lamp)
  const keyboardFocus = await page.$eval(lamp, element => element.matches(':focus-visible'))
  assert.ok(keyboardFocus, 'Keyboard restore lost visible focus')
  await shot(page, '45-genie-keyboard-restored')
  const spring = await page.evaluate(async () => {
    const { DRIVE_DEFAULTS: params, driveSpringPresentationStep } = await import('/src/scenes/genie/genieDrive.ts')
    const run = hz => {
      let state = { t: 0.1, v: 1.2, visibleT: 0.1 }
      for (let i = 0; i < hz / 10; i++) state = driveSpringPresentationStep(state, state.visibleT, 1, 1 / hz, params)
      return state
    }
    return { at60: run(60), at240: run(240) }
  })
  assert.ok(Math.abs(spring.at60.t - spring.at240.t) < 1e-10)
  assert.ok(Math.abs(spring.at60.visibleT - spring.at240.visibleT) < 1e-10)
  assert.equal(spring.at60.visibleT, spring.at60.t)
  assert.ok(Math.abs(spring.at60.v - spring.at240.v) < 1e-10)
  return { issues: [36, 45], mouseFocus, minimizedBySpace, keyboardFocus, spring,
    unmeasured: ['The flight still uses the clock path; paused-grab spring trajectories are pinned numerically.'] }
}

async function checkCopy(page) {
  await page.waitForFunction(() => {
    let ready = false
    window.__r3f?.scene.traverse(object => { if (object.material?.uniforms?.uLag) ready = true })
    return ready
  }, { timeout: 20_000 })
  await page.click('.cand-code-bar .cand-btn')
  await page.waitForFunction(() => {
    let sample = null
    window.__r3f.scene.traverse(object => {
      const uniforms = object.material?.uniforms
      if (!uniforms?.uLag || !object.visible || uniforms.uT.value < 0.4 || uniforms.uT.value > 0.7) return
      sample = { phase: uniforms.uT.value, arc: uniforms.uArc.value, lag: uniforms.uLag.value,
        twist: uniforms.uTwist.value, sway: uniforms.uSway.value.toArray() }
    })
    if (!sample) return false
    window.__detailCopy = sample
    window.__r3f.setFrameloop('never')
    return true
  }, { timeout: 5_000 })
  await shot(page, '53-copy-flight')
  const sample = await page.evaluate(() => window.__detailCopy)
  await page.evaluate(() => window.__r3f.setFrameloop('always'))
  await page.waitForFunction(() => !document.querySelector('.cand-code-holder')?.hasAttribute('data-gone'))
  return { issues: [53], sample, unmeasured: ['Pixel lighting is captured for review; normals versus complete displaced tangents are pinned in candidateShaders.test.ts.'] }
}

async function checkLamp(page) {
  await page.waitForSelector('.lamp-fixture')
  await page.waitForFunction(() => document.querySelector('.lamp-fixture')?.style.transform)
  const handle = await page.$('.lamp-fixture')
  const bounds = await handle.boundingBox()
  assert.ok(bounds, 'The lamp handle has no visible bounds')
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(520, 460, { steps: 8 })
  await frames(page)
  await page.evaluate(() => {
    const element = document.querySelector('.lamp-fixture')
    const point = () => { const matrix = new DOMMatrix(element.style.transform); return { x: matrix.m41, y: matrix.m42 } }
    const record = { before: null, releasedAt: null, first: null }
    window.__detailLamp = record
    element.addEventListener('pointerup', () => { record.before = point(); record.releasedAt = performance.now() }, { capture: true, once: true })
    const observer = new MutationObserver(() => {
      if (record.releasedAt === null || record.first) return
      record.first = { ...point(), elapsed: performance.now() - record.releasedAt }
      observer.disconnect()
    })
    observer.observe(element, { attributes: true, attributeFilter: ['style'] })
  })
  await page.mouse.up()
  await page.waitForFunction(() => window.__detailLamp?.first, { timeout: 2_000 })
  const release = await page.evaluate(() => window.__detailLamp)
  const distance = Math.hypot(release.first.x - release.before.x, release.first.y - release.before.y)
  assert.ok(release.first.elapsed < 500, 'The first post-release frame was not observed promptly')
  assert.ok(distance < 1 + release.first.elapsed * 0.02, `Lamp jumped ${distance.toFixed(2)}px on release`)
  await shot(page, '57-lamp-released')
  return { issues: [57], release, distance }
}

const checks = [
  { name: 'unroll', route: '?scene=candidates&candidate=unroll', check: checkUnroll },
  { name: 'genie', route: '?scene=genie', check: checkGenie },
  { name: 'copy', route: '?scene=candidates&candidate=copy', check: checkCopy },
  { name: 'lamp', route: '?scene=lamp', check: checkLamp },
]
assert.ok([...selected].every(name => checks.some(check => check.name === name)), 'Unknown DETAIL_MOTION_CASES entry')
const deadline = setTimeout(() => { console.error('Detail motion check exceeded 180 seconds'); process.exit(1) }, 180_000)

try {
  server = await createServer({ root: labRoot, configFile: path.join(labRoot, 'vite.config.ts'),
    cacheDir: path.join(output, '.vite'), server: { host: '127.0.0.1', port: 0, fs: { allow: [repoRoot] } }, logLevel: 'warn' })
  await server.listen()
  const url = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await puppeteer.launch({ executablePath: chrome, headless: !headed, defaultViewport: null,
    args: ['--enable-features=CanvasDrawElement', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : [])] })
  for (const { name, route, check } of checks.filter(check => selected.has(check.name))) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(String(error)))
    page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text()) })
    try {
      const nativeDpr = await page.evaluate(() => devicePixelRatio)
      await setChromeViewport(page, { width: 1200, height: 900, deviceScaleFactor: headed ? nativeDpr : undefined })
      await page.setCacheEnabled(false)
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
      await page.goto(url + '/' + route + '&framed', { waitUntil: 'domcontentloaded' })
      const capable = await page.evaluate(() => 'drawElementImage' in CanvasRenderingContext2D.prototype)
      if (!capable && name !== 'lamp') {
        results.push({ name, skipped: 'HTML-in-canvas unavailable' })
        if (process.env.STRICT_CAPABILITY === '1') process.exitCode = 1
        continue
      }
      await page.evaluate(() => document.fonts.ready)
      const result = await check(page)
      assert.deepEqual(errors, [], 'The page reported an error')
      results.push({ name, passed: true, browser: await browser.version(), dpr: await page.evaluate(() => devicePixelRatio), ...result, errors })
    } catch (error) {
      results.push({ name, passed: false, error: String(error), errors })
      process.exitCode = 1
      await shot(page, `${name}-failure`).catch(() => {})
    } finally {
      await page.close()
      await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
      console.log(JSON.stringify(results.at(-1)))
    }
  }
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
