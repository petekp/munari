// Detail focus regressions: native editor Tab order and the actual Workspace.
// Chrome is serial; HEADED=1 preserves a visible window at native display density.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
import { setChromeViewport } from '../chromeViewport.mjs'

const sourceRoot = path.resolve(process.env.DETAIL_SOURCE_ROOT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'))
const output = process.env.DETAIL_OUTPUT ?? path.join(tmpdir(), 'munari-detail-focus')
const selected = new Set((process.env.DETAIL_CASES ?? '35,40,52,55').split(','))
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(candidate => candidate && existsSync(candidate))
assert.ok(chrome, 'Chrome is required; set CHROME_PATH')
await mkdir(output, { recursive: true })
const server = await createServer({
  root: path.join(sourceRoot, 'apps/lab'),
  configFile: path.join(sourceRoot, 'apps/lab/vite.config.ts'),
  cacheDir: path.join(output, '.vite'),
  plugins: [{ name: 'detail-native-editor-fixture', configureServer(vite) {
    vite.middlewares.use('/__detail-editors', (_request, response) => {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><html><body><button id="before">Before</button><section id="fixture"></section><button id="after">After</button></body></html>')
    })
  } }],
  server: { host: '127.0.0.1', port: 0, fs: { allow: [sourceRoot] } },
  logLevel: 'warn',
})
let browser
const rows = []
const deadline = setTimeout(() => { console.error('detail-focus exceeded 240 seconds'); process.exit(1) }, 240_000)
const twoFrames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const camera = page => page.evaluate(() => window.__r3f.get().camera.matrixWorld.toArray())
const cameraSettled = page => page.waitForFunction(() => {
  const state = window.__r3f.get()
  const signature = state.camera.matrixWorld.elements.map(value => value.toFixed(6)).join(',')
  const last = window.__detailCameraStable
  if (!last || last.signature !== signature) window.__detailCameraStable = { signature, since: performance.now() }
  return performance.now() - window.__detailCameraStable.since > 350 && state.controls?.enabled && !window.__workspaceRig().tweening
}, { timeout: 12_000, polling: 'raf' })

async function workspace(page, base) {
  await page.goto(`${base}/?scene=workspace&framed`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__r3f?.get().controls && window.__workspace && window.__focusScene && document.querySelector('[data-munari-surface="workspace-notes"] [contenteditable]'), { timeout: 30_000 })
  await page.evaluate(() => document.fonts.ready)
  await cameraSettled(page)
}

async function nativeEditors(page, base) {
  await page.goto(`${base}/__detail-editors`, { waitUntil: 'domcontentloaded' })
  const cases = [
    { name: 'native editor', html: '<div id="editor" contenteditable="true">notes</div>', sequence: ['editor'] },
    { name: 'empty editable attribute', html: '<div id="editor" contenteditable>notes</div>', sequence: ['editor'] },
    { name: 'explicit negative tabindex', html: '<div id="editor" contenteditable="true" tabindex="-1">notes</div>', sequence: [] },
    { name: 'nested editor', html: '<div id="outer" contenteditable="true"><div id="inner" contenteditable="true">nested</div></div>', sequence: ['outer'] },
    { name: 'nested editor opted in', html: '<div id="outer" contenteditable="true"><div id="inner" contenteditable="true" tabindex="0">nested</div></div>', sequence: ['outer', 'inner'] },
    { name: 'noneditable island', html: '<div id="outer" contenteditable="true"><div contenteditable="false"><div id="inner" contenteditable="plaintext-only">notes</div></div></div>', sequence: ['outer', 'inner'] },
  ]
  const results = []
  for (const test of cases) {
    await page.$eval('#fixture', (element, html) => { element.innerHTML = html }, test.html)
    const computed = await page.evaluate(async modulePath => {
      const { tabbables } = await import(modulePath)
      return tabbables(document.getElementById('fixture')).map(element => element.id)
    }, `/@fs${sourceRoot}/packages/react/src/lib/tabbables.ts`)
    await page.focus('#before')
    const native = []
    for (let index = 0; index <= test.sequence.length; index++) {
      await page.keyboard.press('Tab')
      native.push(await page.evaluate(() => document.activeElement.id))
    }
    assert.deepEqual(computed, test.sequence, `${test.name}: computed sequence`)
    assert.deepEqual(native, [...test.sequence, 'after'], `${test.name}: native sequence`)
    results.push({ name: test.name, computed, native })
  }
  return results
}

async function notesFocus(page, base) {
  await workspace(page, base)
  await page.evaluate(() => {
    window.__detailEditor = document.querySelector('[data-munari-surface="workspace-notes"] [contenteditable]')
    window.__detailUnit = window.__detailEditor.closest('[tabindex="-1"]')
    window.__detailUnit.focus()
  })
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.activeElement === window.__detailEditor, { timeout: 3000 })
  await page.keyboard.type(' retained note')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.activeElement === window.__detailUnit, { timeout: 3000 })
  await page.keyboard.press('Enter')
  const recall = await page.evaluate(() => ({ same: document.activeElement === window.__detailEditor, tabIndex: window.__detailEditor.tabIndex, text: window.__detailEditor.textContent }))
  assert.ok(recall.same, 'Enter must recall the native editor')
  await page.evaluate(() => { window.__detailEditor.tabIndex = -1; window.__detailUnit.focus() })
  await page.keyboard.press('Enter')
  assert.ok(await page.evaluate(() => document.activeElement === window.__detailUnit), 'Explicit negative tabindex must stay excluded from recall')
  return recall
}

async function firstOrbit(page, base) {
  await workspace(page, base)
  await page.mouse.move(60, 760)
  const armed = await page.evaluate(() => {
    window.__workspace.setMotion('animated')
    window.__workspace.approach('notes')
    return window.__workspaceRig()
  })
  assert.ok(armed.tweening && !armed.enabled, 'The first press must interrupt an active tween')
  await page.mouse.down()
  const grabbed = await camera(page)
  await page.mouse.move(190, 700, { steps: 10 })
  await page.mouse.up()
  await cameraSettled(page)
  const moved = await camera(page)
  assert.notDeepEqual(moved, grabbed, 'The first drag must move the camera')
  assert.equal(await page.evaluate(() => window.__r3f.get().controls.enabled), true)
  const wheel = await page.evaluate(() => {
    window.__workspace.home()
    return { ...window.__workspaceRig(), distance: window.__r3f.get().controls.getDistance() }
  })
  assert.ok(wheel.tweening && !wheel.enabled)
  await page.mouse.wheel({ deltaY: 100 })
  await twoFrames(page)
  const wheelDistance = await page.evaluate(() => window.__r3f.get().controls.getDistance())
  assert.notEqual(wheelDistance, wheel.distance, 'The first wheel event must reach OrbitControls')
  return { armed, grabbed, moved, wheel, wheelDistance }
}

async function panelPose(page, base) {
  await workspace(page, base)
  await page.evaluate(() => { window.__workspace.setMotion('instant'); window.__workspace.approach('notes') })
  await cameraSettled(page)
  const start = await page.evaluate(() => {
    const state = window.__r3f.get()
    const panel = state.scene.getObjectByName('workspace-notes').parent
    window.__detailPanel = panel
    const handle = panel.children.find(child => child.geometry?.type === 'BoxGeometry')
    const point = handle.getWorldPosition(state.camera.position.clone()).project(state.camera)
    const rect = state.gl.domElement.getBoundingClientRect()
    return { position: panel.position.toArray(), x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 }
  })
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  assert.equal(await page.evaluate(() => window.__r3f.get().controls.enabled), false, 'Panel drag must own the controls')
  await page.mouse.move(start.x + 100, start.y + 35, { steps: 12 })
  await page.mouse.up()
  const dragged = await page.evaluate(() => ({ position: window.__detailPanel.position.toArray(), quaternion: window.__detailPanel.quaternion.toArray() }))
  assert.notDeepEqual(dragged.position, start.position, 'The real panel handle must move its group')
  await page.mouse.move(50, 850)
  await page.focus('[data-munari-surface="workspace-notes"] [contenteditable]')
  await twoFrames(page)
  const focused = await page.evaluate(() => ({ position: window.__detailPanel.position.toArray(), quaternion: window.__detailPanel.quaternion.toArray(), controls: window.__r3f.get().controls.enabled }))
  assert.deepEqual(focused.position, dragged.position, 'Focus must preserve the dragged position')
  assert.deepEqual(focused.quaternion, dragged.quaternion, 'Hover/focus commits must preserve the dragged rotation')
  assert.equal(focused.controls, true)
  return { start, dragged, focused }
}

async function orbitProxies(page, base) {
  await workspace(page, base)
  await page.waitForSelector('[role="slider"][aria-label="Cutoff"]')
  await page.focus('[role="slider"][aria-label="Cutoff"]')
  await cameraSettled(page)
  const before = await page.evaluate(() => ({ camera: window.__r3f.get().camera.matrixWorld.toArray(), proxies: window.__focusScene.proxies() }))
  await page.mouse.move(850, 740)
  await page.mouse.down()
  await page.mouse.move(1000, 610, { steps: 15 })
  await page.mouse.up()
  await cameraSettled(page)
  const after = await page.evaluate(() => {
    const state = window.__r3f.get()
    const panel = state.scene.getObjectByName('workspace-synth').parent
    const dial = panel.children.find(child => child.isGroup && child.children.some(nested => nested.isGroup))
    const anchor = dial.getWorldPosition(state.camera.position.clone()).project(state.camera)
    return { camera: state.camera.matrixWorld.toArray(), anchor: anchor.toArray(), proxies: window.__focusScene.proxies() }
  })
  assert.notDeepEqual(after.camera, before.camera, 'The probe must orbit the camera')
  assert.ok(after.anchor[2] > -1 && after.anchor[2] < 1 && Math.abs(after.anchor[0]) < 1 && Math.abs(after.anchor[1]) < 1, 'The Dial projection must remain visible; behind-camera last-rect retention is intentional')
  const synced = await page.evaluate(() => { window.__focusScene.syncProxies(); return window.__focusScene.proxies() })
  const automatic = after.proxies.find(proxy => proxy.label === 'Cutoff')
  const explicit = synced.find(proxy => proxy.label === 'Cutoff')
  assert.ok(automatic.focused && explicit.focused, 'Focus must stay on the Dial through the orbit')
  const correction = Math.max(...['x', 'y', 'width', 'height'].map(key => Math.abs(automatic.rect[key] - explicit.rect[key])))
  assert.ok(correction <= 1, `Settled proxy required ${correction} CSS px of manual correction`)
  return { before, after, synced, correction }
}

try {
  await server.listen()
  const base = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await puppeteer.launch({ executablePath: chrome, headless: process.env.HEADED !== '1', defaultViewport: null, args: ['--enable-features=CanvasDrawElement', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', ...(process.env.CI ? ['--no-sandbox'] : [])] })
  for (const [number, check] of [
    ['35', async (page, origin) => ({ native: await nativeEditors(page, origin), workspace: await notesFocus(page, origin) })],
    ['40', firstOrbit], ['52', panelPose], ['55', orbitProxies],
  ]) {
    if (!selected.has(number)) continue
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(String(error)))
    try {
      const dpr = await setChromeViewport(page, { width: 1200, height: 900 })
      assert.ok(await page.evaluate(() => 'drawElementImage' in CanvasRenderingContext2D.prototype), 'CanvasDrawElement capability is required')
      const evidence = await check(page, base)
      assert.deepEqual(errors, [])
      await page.screenshot({ path: path.join(output, `${number}.png`) })
      rows.push({ number, sourceRoot, browser: await browser.version(), dpr, evidence, errors })
    } catch (error) {
      rows.push({ number, sourceRoot, error: String(error), errors })
      await page.screenshot({ path: path.join(output, `${number}-error.png`) }).catch(() => {})
      process.exitCode = 1
    } finally {
      await page.close()
      await writeFile(path.join(output, 'results.json'), `${JSON.stringify(rows, null, 2)}\n`)
      console.log(JSON.stringify(rows.at(-1)))
    }
  }
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server.close()
}
