// The named Workspace panel must display its new capture on a demand renderer.
// Other Workspace feeds can also wake that renderer; this is not an isolated wake-source test.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const labRoot = path.join(repoRoot, 'apps', 'lab')
const chromePath = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].filter(Boolean).find(existsSync)
const strict = process.env.STRICT_CAPABILITY === '1'
const staleUpload = process.env.DOM_DEMAND_STALE_UPLOAD === '1'
const output = process.env.DOM_DEMAND_OUTPUT ?? path.join(tmpdir(), 'munari-dom-surface-demand', staleUpload ? 'stale-upload' : 'normal')
const MAGENTA = [255, 0, 170, 255]
// A solid interior has no edge coverage; allow only 8-bit color-conversion rounding.
const matches = (actual, expected) => actual?.length === 4 && actual.every((channel, i) => Math.abs(channel - expected[i]) <= 3)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let patchedRuntime = false
const holdTargetUploads = {
  name: 'dom-demand-stale-upload', enforce: 'pre',
  transform(source, id) {
    if (!staleUpload || !id.split('?')[0].endsWith('/primitives/surface/surfaceSourceRuntime.ts')) return null
    let changed = source
    for (const name of ['syncStorage', 'upload']) {
      const needle = `  const ${name} = () => {`
      assert.equal(changed.split(needle).length - 1, 1, `Stale-upload control lost its ${name} insertion point`)
      changed = changed.replace(needle, `${needle}\n    const held = globalThis.__domDemandStaleUpload;\n    if (held?.active && held.label === label) { held.blocked++; return; }`)
    }
    patchedRuntime = true
    return changed
  },
}

function skip(reason) {
  console.warn(`dom-surface-demand gate SKIPPED: ${reason}`)
  process.exit(strict || staleUpload ? 1 : 0)
}
if (!chromePath) skip('no Chrome executable found (set CHROME_PATH)')
let browser, server
const deadline = setTimeout(() => { console.error('dom-surface-demand gate: hard 120s deadline hit'); process.exit(1) }, 120_000)

try {
  await mkdir(output, { recursive: true })
  browser = await puppeteer.launch({
    executablePath: chromePath, headless: true, protocolTimeout: 30_000,
    args: [
      '--enable-unsafe-swiftshader','--enable-features=CanvasDrawElement', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', ...(process.env.CI ? ['--no-sandbox'] : [])],
  })
  const probe = await browser.newPage()
  const capable = await probe.evaluate(() => 'drawElementImage' in document.createElement('canvas').getContext('2d'))
  await probe.close()
  if (!capable) skip(`Chrome at ${chromePath} has no drawElementImage`)

  server = await createServer({ root: labRoot, cacheDir: path.join(output, '.vite'), plugins: [holdTargetUploads], logLevel: 'warn', server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  const port = server.httpServer.address().port
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 820, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.goto(`http://127.0.0.1:${port}/?scene=workspace&probe=dom-surface-demand&framed`, { waitUntil: 'load' })
  await page.waitForFunction(() => {
    const id = window.__workspace?.panelIds[16], state = window.__r3f?.get()
    return id && state?.controls && state.scene.getObjectByName(`workspace-${id}`)?.material?.map && window.__domSurfaceDemand?.readPaints() > 0
  }, { timeout: 20_000 })
  await page.evaluate(() => document.fonts.ready)
  const approached = await page.evaluate(() => { window.__workspace.setMotion('instant'); return window.__workspace.approach(window.__workspace.panelIds[16]) })
  assert.ok(approached, 'The actual target panel must be available for framing')
  await sleep(600)

  const ledger = () => page.evaluate(() => ({
    paints: window.__domSurfaceDemand.readPaints(), sourceHash: window.__domSurfaceDemand.readSource(), sourceWidth: window.__domSurfaceDemand.readSourceWidth(),
  }))
  const sourcePatch = expected => page.evaluate(expected => {
    const state = window.__r3f.get(), label = `workspace-${window.__workspace.panelIds[16]}`
    const source = document.querySelector(`[data-munari-source-host][data-munari-surface="${CSS.escape(label)}"]`)
    const canvas = source?.parentElement, mesh = state.scene.getObjectByName(label), texture = mesh?.material?.map
    if (!(canvas instanceof HTMLCanvasElement) || texture?.image !== canvas) throw new Error('The named mesh must sample the named source canvas')
    if (!expected) {
      const swatch = new OffscreenCanvas(1, 1), context = swatch.getContext('2d')
      context.fillStyle = getComputedStyle(source.querySelector('.p6')).backgroundColor
      context.fillRect(0, 0, 1, 1)
      expected = Array.from(context.getImageData(0, 0, 1, 1).data)
    }
    if (expected[3] !== 255) throw new Error('The target background must be opaque for a source-to-screen color comparison')
    const width = canvas.width, height = canvas.height
    const findPatch = () => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data
      const stride = width + 1, sums = new Uint32Array((width + 1) * (height + 1))
      for (let y = 0; y < height; y++) {
        let row = 0
        for (let x = 0; x < width; x++) {
          const offset = (y * width + x) * 4
          if (expected.every((value, channel) => Math.abs(pixels[offset + channel] - value) <= 1)) row++
          sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row
        }
      }
      const side = 13
      let patch = null, distance = Infinity
      for (let y = 0; y <= height - side; y++) for (let x = 0; x <= width - side; x++) {
        const count = sums[(y + side) * stride + x + side] - sums[y * stride + x + side] - sums[(y + side) * stride + x] + sums[y * stride + x]
        if (count !== side * side) continue
        const score = (x + side / 2 - width / 2) ** 2 + (y + side / 2 - height / 2) ** 2
        if (score < distance) { distance = score; patch = { x, y, side } }
      }
      return patch
    }
    const patch = findPatch()
    if (!patch) return null
    const projectPatch = () => {
      const sourceX = patch.x + patch.side / 2, sourceY = patch.y + patch.side / 2
      const uv = mesh.position.clone().set(sourceX / width, texture.flipY ? 1 - sourceY / height : sourceY / height, 1).applyMatrix3(texture.matrix.clone().invert())
      const positions = mesh.geometry.getAttribute('position'), coordinates = mesh.geometry.getAttribute('uv'), index = mesh.geometry.index
      let point = null
      // Geometry UVs name source pixels; barycentric interpolation recovers their real local position.
      for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
        const ids = [0, 1, 2].map(offset => index ? index.getX(i + offset) : i + offset)
        const [a, b, c] = ids.map(id => [coordinates.getX(id), coordinates.getY(id)])
        const determinant = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if (Math.abs(determinant) < 1e-12) continue
        const wa = ((b[1] - c[1]) * (uv.x - c[0]) + (c[0] - b[0]) * (uv.y - c[1])) / determinant
        const wb = ((c[1] - a[1]) * (uv.x - c[0]) + (a[0] - c[0]) * (uv.y - c[1])) / determinant
        const weights = [wa, wb, 1 - wa - wb]
        if (weights.some(value => value < -1e-8)) continue
        point = mesh.position.clone().set(0, 0, 0)
        ids.forEach((id, n) => { point.x += positions.getX(id) * weights[n]; point.y += positions.getY(id) * weights[n]; point.z += positions.getZ(id) * weights[n] })
        break
      }
      if (!point) throw new Error('The solid source patch does not map into the target geometry UVs')
      point.applyMatrix4(mesh.matrixWorld)
      const viewDepth = -point.clone().applyMatrix4(state.camera.matrixWorldInverse).z
      if (state.scene.fog && viewDepth >= state.scene.fog.near) throw new Error('Target framing must keep the sampled patch before the fog range')
      point.project(state.camera)
      const rect = state.gl.domElement.getBoundingClientRect()
      const screen = { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 }
      if ([point.x, point.y, point.z].some(value => value < -1 || value > 1) || screen.x < 0 || screen.x >= innerWidth || screen.y < 0 || screen.y >= innerHeight) throw new Error('The target patch must be visible in the actual renderer viewport')
      return { uv: [uv.x, uv.y], screen, viewDepth }
    }
    return { label, expected, patch, sourceSize: [width, height], ...projectPatch() }
  }, expected)
  const pixel = (png, screen) => page.evaluate(async ({ png, screen }) => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(atob(png), value => value.charCodeAt(0))], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d')
    context.drawImage(image, 0, 0); image.close()
    return Array.from(context.getImageData(Math.floor(screen.x * canvas.width / innerWidth), Math.floor(screen.y * canvas.height / innerHeight), 1, 1).data)
  }, { png, screen })
  const read = async (name, expected) => {
    const started = Date.now()
    let last = null
    while (Date.now() - started < 10_000) {
      const sample = await sourcePatch(expected)
      if (sample) {
        const screenshot = await page.screenshot({ type: 'png', encoding: 'base64' })
        const displayed = await pixel(screenshot, sample.screen)
        last = { ...sample, ...(await ledger()), displayed, screenshot }
        // A control with blocked uploads must be measured as stale, not retried until it becomes fresh.
        if (matches(displayed, sample.expected) || (staleUpload && name !== 'baseline')) break
      }
      await sleep(75)
    }
    assert.ok(last, `${name}: no solid 13×13 source patch reached the expected color`)
    await writeFile(path.join(output, `${name}.png`), Buffer.from(last.screenshot, 'base64'))
    return last
  }

  const baseline = await read('baseline', null)
  assert.ok(matches(baseline.displayed, baseline.expected), 'The baseline source patch must already be displayed before the upload control can arm')
  assert.ok(!matches(baseline.displayed, MAGENTA), 'Mutation needs a different baseline color')
  if (staleUpload) {
    assert.ok(patchedRuntime, 'The stale-upload transform must have reached the served runtime')
    await page.evaluate(label => { window.__domDemandStaleUpload = { label, active: true, blocked: 0 } }, baseline.label)
  }
  await page.evaluate(() => window.__domSurfaceDemand.mutate())
  await page.waitForFunction(paints => window.__domSurfaceDemand.readPaints() > paints, { timeout: 10_000 }, baseline.paints)
  const mutated = await read('mutated', MAGENTA)
  const oldAtMutationPoint = await pixel(baseline.screenshot, mutated.screen)

  await page.evaluate(() => window.__domSurfaceDemand.resize(360))
  await page.waitForFunction(paints => window.__domSurfaceDemand.readSourceWidth() === 360 && window.__domSurfaceDemand.readPaints() > paints, { timeout: 10_000 }, mutated.paints)
  const resized = await read('resized', MAGENTA)
  // Resettle can finish late under contention. Require two unchanged target-paint windows.
  let idleBefore = await ledger(), idleAfter = idleBefore, stableWindows = 0
  for (let attempt = 0; attempt < 8 && stableWindows < 2; attempt++) {
    await sleep(600); idleAfter = await ledger()
    stableWindows = idleAfter.paints === idleBefore.paints ? stableWindows + 1 : 0
    idleBefore = idleAfter
  }

  const problems = []
  if (!matches(mutated.displayed, MAGENTA)) problems.push(`mutation: target pixel ${mutated.displayed} is not magenta`)
  if (!matches(resized.displayed, MAGENTA)) problems.push(`resize: target pixel ${resized.displayed} is not magenta`)
  if (mutated.sourceHash === baseline.sourceHash) problems.push('mutation: source pixels did not change')
  if (mutated.paints <= baseline.paints) problems.push('mutation: paint ledger did not advance')
  if (resized.sourceWidth !== 360) problems.push(`resize: source width is ${resized.sourceWidth}, expected 360`)
  if (resized.paints <= mutated.paints) problems.push('resize: paint ledger did not advance')
  if (stableWindows < 2) problems.push('idle: target paint ledger never became quiescent')
  problems.push(...errors.map(error => `page error: ${error}`))
  const control = staleUpload ? {
    ...(await page.evaluate(() => window.__domDemandStaleUpload)),
    sourceChanged: mutated.sourceHash !== baseline.sourceHash && mutated.paints > baseline.paints,
    displayedBaseline: matches(mutated.displayed, oldAtMutationPoint),
    rejectedMagenta: !matches(mutated.displayed, MAGENTA),
  } : null
  if (control && !(control.blocked > 0 && control.sourceChanged && control.displayedBaseline && control.rejectedMagenta)) problems.push('negative control did not establish a repainted source with stale displayed pixels')
  const compact = ({ screenshot: _screenshot, ...sample }) => sample
  const result = { baseline: compact(baseline), mutated: compact(mutated), resized: compact(resized), idleAfter, stableWindows, control, problems, limit: 'Target display correctness on a shared demand renderer; other feeds can supply wakeups.' }
  await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
  if (problems.length) { console.error(`dom-surface-demand gate FAILED (${problems.length})`); process.exitCode = 1 }
  else console.log('dom-surface-demand gate PASSED')
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
