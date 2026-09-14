// Actual Glass SDF pixels under fixed scene inputs.
// Repeated/reset frames exclude unrelated motion; opaque tint makes depth
// ordering independent of the backdrop, with a wrong-sort counterexample.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const repo = path.resolve(process.env.MUNARI_SOURCE_ROOT ?? path.join(import.meta.dirname, '../..'))
const output = process.env.GLASS_EFFECTS_OUTPUT ?? await mkdtemp(path.join(tmpdir(), 'munari-glass-effects-'))
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(value => value && existsSync(value))
assert.ok(chrome, 'Chrome is required')
await mkdir(output, { recursive: true })
const owner = path.join(repo, 'apps/lab/src/scenes/glass/glassSdf.tsx')
let transformed = false
const once = (source, marker, replacement) => {
  assert.equal(source.split(marker).length - 1, 1, `Glass observer marker must occur once: ${marker}`)
  return source.replace(marker, replacement)
}
const panelView = 'panels.map(({label, group, half, params, blobs, rects, ripples, glows}) => ({label, group, half, params, blobs, rects, ripples, glows}))'
const observer = {
  name: 'glass-effects-observer',
  enforce: 'pre',
  transform(source, id) {
    if (id.split('?')[0] !== owner) return null
    transformed = true
    source = once(source, '    const now = clock.elapsedTime', `    globalThis.__glassEffects?.beforeFrame({gl, scene, camera, THREE, panels: ${panelView}})
    const now = globalThis.__glassEffects?.active ? globalThis.__glassEffects.time : clock.elapsedTime`)
    source = once(source, '    panels.sort((a, b) => a.depth - b.depth)', `    panels.sort((a, b) => globalThis.__glassEffects?.wrongSort
      ? b.group.current!.getWorldPosition(new THREE.Vector3()).distanceToSquared(camera.position) - a.group.current!.getWorldPosition(new THREE.Vector3()).distanceToSquared(camera.position)
      : a.depth - b.depth)`)
    source = once(source, '    gl.render(blitScene, quadCam)\n    // This is the sole color-writing', `    gl.render(blitScene, quadCam)
    globalThis.__glassEffects?.afterFrame({gl, scene, camera, THREE, panels: ${panelView}})
    // This is the sole color-writing`)
    return source
  },
}

const install = () => {
  const probe = window.__glassEffects = {
    active: false, time: 10, wrongSort: false, version: 0, frames: 0, captureAt: 0,
    configuration: null, result: null, backdrop: null,
  }
  probe.configure = configuration => {
    probe.active = true
    probe.configuration = configuration
    probe.wrongSort = configuration.wrongSort ?? false
    probe.version++
    probe.captureAt = probe.frames + 3
    probe.result = null
    return probe.version
  }
  probe.beforeFrame = ({gl, scene, camera, THREE, panels}) => {
    if (!probe.active) return
    if (panels.length !== 2) throw new Error(`Expected two real SDF panels, got ${panels.length}`)
    const config = probe.configuration
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.fov = 22
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)
    gl.toneMapping = THREE.NoToneMapping
    gl.outputColorSpace = THREE.SRGBColorSpace
    if (!probe.backdrop) {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 512
      const context = canvas.getContext('2d')
      for (let y = 0; y < 512; y += 4) for (let x = 0; x < 512; x += 4) {
        context.fillStyle = ((x + y) / 4) % 2 ? '#dedede' : '#242424'
        context.fillRect(x, y, 4, 4)
      }
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.magFilter = texture.minFilter = THREE.NearestFilter
      texture.generateMipmaps = false
      const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({map: texture, toneMapped: false}))
      backdrop.name = 'glass-effects-static-backdrop'
      backdrop.position.z = -0.5
      scene.add(backdrop)
      probe.backdrop = backdrop
    }
    window.__glass.setBlobs(0)
    for (const panel of panels) {
      const card = panel.label === 'glass-card'
      if (!card && panel.label !== 'glass-pill') throw new Error(`Unexpected SDF panel ${panel.label}`)
      panel.blobs.length = panel.rects.length = panel.ripples.length = panel.glows.length = 0
      Object.assign(panel.params, {
        radius: 0.06, bezel: 0.03, thickness: 0.16, spread: 1.09, ior: 2.2,
        chroma: 0, roughness: 0, tintAmount: config.kind === 'order' ? 1 : 0,
        tint: card ? '#ff0000' : '#00ff00', edgeLight: 0, edgeReflect: 0,
        edgeWarp: 0, edgeWarpSpeed: 0, specular: 0, inkOpacity: 0,
        glowAmp: 0, rippleAmp: config.kind === 'ripple' && card ? config.amplitude : 0,
        rippleK: 3, rippleNu: 0.0018, rippleSource: 0.04, rippleDecay: 3.4,
        rippleLife: 1.4, rippleWaveSpeed: 2.9, rippleInk: 0,
      })
      panel.half.set(2, 1.5)
      const world = card ? new THREE.Vector3(0, 0, 0)
        : new THREE.Vector3(config.kind === 'order' ? 1.6 : 20, 0, 0.1)
      const group = panel.group.current
      group.parent?.updateWorldMatrix(true, false)
      group.position.copy(group.parent ? group.parent.worldToLocal(world.clone()) : world)
      group.quaternion.identity()
      group.scale.set(1, 1, 1)
      if (config.kind === 'ripple' && card) panel.ripples.push({x: 0, y: 0, t0: probe.time - 0.35, amp: 1})
    }
    scene.updateMatrixWorld(true)
  }
  probe.afterFrame = ({gl, camera, THREE, panels}) => {
    if (!probe.active) return
    probe.frames++
    if (probe.frames < probe.captureAt || probe.result) return
    const canvas = gl.domElement
    const context = gl.getContext()
    const pixel = world => {
      const p = new THREE.Vector3(...world).project(camera)
      return {x: Math.floor((p.x + 1) * canvas.width / 2), y: Math.floor((p.y + 1) * canvas.height / 2)}
    }
    const left = pixel([-1.4, -1.1, 0])
    const right = pixel([1.4, 1.1, 0])
    const bounds = {x: left.x, y: left.y, width: right.x - left.x, height: right.y - left.y}
    if (bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0 || bounds.x + bounds.width > canvas.width || bounds.y + bounds.height > canvas.height)
      throw new Error(`Invalid framebuffer observation bounds ${JSON.stringify(bounds)}`)
    const data = new Uint8Array(bounds.width * bounds.height * 4)
    context.readPixels(bounds.x, bounds.y, bounds.width, bounds.height, context.RGBA, context.UNSIGNED_BYTE, data)
    const point = pixel([1, 0, 0.1])
    const center = new Uint8Array(4)
    context.readPixels(point.x, point.y, 1, 1, context.RGBA, context.UNSIGNED_BYTE, center)
    const glError = context.getError()
    if (glError !== context.NO_ERROR) throw new Error(`Framebuffer observation GL error ${glError}`)
    probe.result = {
      version: probe.version, frames: probe.frames, configuration: probe.configuration,
      bounds, center: [...center], point, pixels: [...data],
      panels: panels.map(panel => {
        const world = panel.group.current.getWorldPosition(new THREE.Vector3())
        return {label: panel.label, world: world.toArray(), depth: world.clone().applyMatrix4(camera.matrixWorldInverse).z, radial: world.distanceTo(camera.position)}
      }),
    }
  }
}

// Require contrast across an area; one changed texel is not a visible field.
const PIXEL_DELTA = 12
const MIN_CHANGED_SHARE = 0.01

function difference(a, b) {
  assert.deepEqual(a.bounds, b.bounds, 'The sampled framebuffer region must stay fixed')
  let maximum = 0, changed = 0, total = 0
  for (let i = 0; i < a.pixels.length; i += 4) {
    let pixel = 0
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs(a.pixels[i + channel] - b.pixels[i + channel])
      pixel = Math.max(pixel, delta)
      total += delta
    }
    maximum = Math.max(maximum, pixel)
    if (pixel > PIXEL_DELTA) changed++
  }
  return {maximum, changedPixels: changed, changedShare: changed / (a.pixels.length / 4), meanChannelDelta: total / (a.pixels.length / 4 * 3), pixels: a.pixels.length / 4}
}

let browser, server, summary
const errors = []
const observations = {}
const deadline = setTimeout(() => {
  browser?.process()?.kill('SIGKILL')
  console.error('glass-effects exceeded its 120-second deadline')
  process.exit(1)
}, 120_000)
try {
  server = await createServer({root: path.join(repo, 'apps/lab'), cacheDir: path.join(output, '.vite'), plugins: [observer], logLevel: 'warn', server: {host: '127.0.0.1', port: 0}})
  await server.listen()
  browser = await puppeteer.launch({executablePath: chrome, headless: process.env.HEADED !== '1', args: ['--enable-features=CanvasDrawElement', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', ...(process.env.CI ? ['--no-sandbox'] : [])]})
  const page = await browser.newPage()
  page.on('pageerror', error => errors.push(String(error)))
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text()) })
  const capable = await page.evaluate(() => {
    const context = document.createElement('canvas').getContext('2d')
    return context !== null && 'drawElementImage' in context
  })
  assert.ok(capable, 'glass-effects requires HTML-in-canvas support')
  await page.setViewport({width: 900, height: 700, deviceScaleFactor: 1})
  await page.evaluateOnNewDocument(install)
  const url = `http://127.0.0.1:${server.httpServer.address().port}/?scene=glass&framed&glass=sdf`
  await page.goto(url, {waitUntil: 'load'})
  await page.waitForFunction(() => window.__glass?.mode() === 'sdf' && window.__glass.labels().length === 2 && window.__glassInk?.has('glass-card') && window.__glassInk?.has('glass-pill'), {timeout: 20_000})
  assert.ok(transformed, 'The guarded real-compositor observer was not installed')
  const capture = async (label, configuration) => {
    const version = await page.evaluate(configuration => window.__glassEffects.configure(configuration), configuration)
    await page.waitForFunction(version => window.__glassEffects.result?.version === version, {timeout: 10_000}, version)
    const result = await page.evaluate(() => window.__glassEffects.result)
    const { pixels: _pixels, ...observation } = result
    observations[label] = observation
    await page.screenshot({path: path.join(output, label + '.png')})
    return result
  }
  const zeroA = await capture('ripple-zero-a', {kind: 'ripple', amplitude: 0})
  const zeroB = await capture('ripple-zero-b', {kind: 'ripple', amplitude: 0})
  const ripple = await capture('ripple-on', {kind: 'ripple', amplitude: 0.5})
  const zeroC = await capture('ripple-zero-c', {kind: 'ripple', amplitude: 0})
  const depth = await capture('view-depth-order', {kind: 'order', wrongSort: false})
  const radial = await capture('wrong-radial-order', {kind: 'order', wrongSort: true})
  summary = {
    output, thresholds: { channelDelta: PIXEL_DELTA, changedShare: MIN_CHANGED_SHARE }, region: zeroA.bounds,
    url, browser: await browser.version(), staticControl: difference(zeroA, zeroB),
    rippleDifference: difference(zeroB, ripple), resetControl: difference(zeroB, zeroC),
    correctOrder: {center: depth.center, point: depth.point, panels: depth.panels},
    wrongOrder: {center: radial.center, point: radial.point, panels: radial.panels}, errors,
  }
  assert.deepEqual(errors, [])
  assert.equal(summary.staticControl.maximum, 0, 'Repeated zero-amplitude frames must be identical')
  assert.equal(summary.resetControl.maximum, 0, 'Removing the ripple must return to the same pixels')
  assert.ok(summary.rippleDifference.changedShare >= MIN_CHANGED_SHARE,
    `The ripple must change at least ${MIN_CHANGED_SHARE * 100}% of its field by more than ${PIXEL_DELTA}/255 in a channel: ${JSON.stringify(summary.rippleDifference)}`)
  const back = depth.panels.find(panel => panel.label === 'glass-card')
  const front = depth.panels.find(panel => panel.label === 'glass-pill')
  assert.ok(front.depth > back.depth && front.radial > back.radial, 'The fixture must disagree by view depth and radial distance')
  assert.deepEqual(depth.center, [0, 255, 0, 255], 'The nearer green panel must own the overlap pixel')
  assert.deepEqual(radial.center, [255, 0, 0, 255], 'The wrong radial sort must expose the red panel at the same pixel')
  summary.passed = true
  await writeFile(path.join(output, 'results.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
} catch (error) {
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ ...summary, passed: false, error: String(error?.stack ?? error), errors, observations }, null, 2))
  if (errors.length) console.error(errors.join('\n'))
  console.error(error)
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
