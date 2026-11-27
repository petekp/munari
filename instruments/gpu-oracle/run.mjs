// 1-frame Chrome WebGPU pipeline & pixel oracle for compiled `*.material.gen.ts` manifests.
// Runs each manifest on a real GPUDevice in headless Chrome, asserting 0 Dawn validation
// errors, non-collapsed center pixels, clean outer corner alpha, and LTC key response.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

const here = import.meta.dirname
const repoRoot = path.resolve(here, '..', '..')
const labRoot = path.join(repoRoot, 'apps', 'lab')

const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
]
  .filter(Boolean)
  .find(existsSync)

assert.ok(chromePath, 'Chrome executable is required (set CHROME_PATH)')

function resolveTargetManifests(argv) {
  if (argv.length > 0) return argv.map((p) => path.resolve(process.cwd(), p))
  const catalogPath = path.join(repoRoot, 'registry', 'materials', 'catalog.json')
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
  return catalog.materials.map((m) => path.join(repoRoot, 'registry', 'materials', `${m.file}.material.gen.ts`))
}

const ORACLE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent;}canvas{width:256px;height:256px;display:block;}</style></head>
<body>
<canvas id="oracle-canvas" width="256" height="256"></canvas>
<script type="module">
import { createGpuRenderer, createPlaneGeometry, resolveFrameContext } from '/@fs/${repoRoot}/packages/react/src/gpu/webgpu.ts'
import { createManifestMaterial, unlitSurfaceManifest } from '/@fs/${repoRoot}/packages/react/src/gpu/manifest.ts'
import { mat4FromPositionEulerScale, mat4Multiply, mat4PerspectiveZeroToOne } from '/@fs/${repoRoot}/packages/react/src/gpu/math.ts'

const canvas = document.getElementById('oracle-canvas')
const renderer = await createGpuRenderer(canvas)
renderer.resize(256, 256)
const fov = 42
const camZ = 128 / Math.tan((fov * Math.PI) / 360)
const proj = mat4PerspectiveZeroToOne(fov, 1, 1, camZ * 3)
const view = mat4FromPositionEulerScale(0, 0, -camZ, 0, 0, 0, 1, 1, 1)
const viewProj = mat4Multiply(proj, view)
const modelWorld = mat4FromPositionEulerScale(0, 0, 0, 0, 0, 0, 1, 1, 1)
const mvp = mat4Multiply(viewProj, modelWorld)
const backWorld = mat4FromPositionEulerScale(0, 0, -12, 0, 0, 0, 1, 1, 1)
const backMvp = mat4Multiply(viewProj, backWorld)

function makeDomTex(fillBg) {
  const c = document.createElement('canvas')
  c.width = 220
  c.height = 220
  const ctx2d = c.getContext('2d')
  if (fillBg) {
    ctx2d.fillStyle = fillBg
    ctx2d.fillRect(0, 0, 220, 220)
  }
  ctx2d.fillStyle = '#f8fafc'
  ctx2d.fillRect(45, 78, 130, 64)
  const tex = renderer.device.createTexture({
    size: [220, 220],
    format: 'rgba8unorm-srgb',
    viewFormats: ['rgba8unorm'],
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  })
  renderer.device.queue.copyExternalImageToTexture({ source: c }, { texture: tex, premultipliedAlpha: true }, [220, 220])
  return {
    srgbView: tex.createView({ format: 'rgba8unorm-srgb' }),
    rawView: tex.createView({ format: 'rgba8unorm' }),
  }
}

const sampler = renderer.device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
const opaqueTex = makeDomTex('#e85d04')
const windowTex = makeDomTex(null)
const backdropBgTex = makeDomTex('#00b4d8')

window.__munariOracle = {
  async runManifest(fsUrl, keyOpt = { x: 128, y: 128, z: 320, brightness: 1, size: [240, 160] }) {
    const mod = await import(fsUrl)
    const manifestKey = Object.keys(mod).find((k) => k.endsWith('Manifest'))
    if (!manifestKey) throw new Error('No *Manifest export in ' + fsUrl)
    const manifest = mod[manifestKey]
    const geo = createPlaneGeometry(renderer.device, 220, 220, 4, 4)
    for (const attr of manifest.attributes) {
      if (attr.location < 2) continue
      const comps = Math.max(1, attr.stride / 4)
      geo.setExtraAttribute(attr.location - 2, new Float32Array(geo.vertexCount * comps))
    }
    const mat = createManifestMaterial(renderer, manifest)
    const backGeo = manifest.needsBackdrop ? createPlaneGeometry(renderer.device, 220, 220, 1, 1) : null
    const backMat = manifest.needsBackdrop ? createManifestMaterial(renderer, unlitSurfaceManifest) : null
    try {
      await Promise.all([mat.ready, backMat?.ready ?? Promise.resolve()])
      const errStart = renderer.validationErrors.length
      const items = []
      if (backGeo && backMat) {
        items.push({
          geometry: backGeo,
          material: backMat,
          view: backdropBgTex.srgbView,
          sampler,
          modelWorld: backWorld,
          mvp: backMvp,
          size: [220, 220],
          radii: [0, 0, 0, 0],
          colorWrite: true,
        })
      }
      const fgTex = manifest.needsBackdrop ? windowTex : opaqueTex
      items.push({
        geometry: geo,
        material: mat,
        view: manifest.sampleViewFormat === 'rgba8unorm' ? fgTex.rawView : fgTex.srgbView,
        sampler,
        modelWorld,
        mvp,
        size: [220, 220],
        radii: [16, 16, 16, 16],
        colorWrite: true,
      })
      const ctx = resolveFrameContext(
        { left: 0, top: 0, width: 256, height: 256, cameraZ: camZ, dpr: 1 },
        { key: keyOpt },
        0,
        0,
      )
      renderer.render(items, ctx)
      await renderer.device.queue.onSubmittedWorkDone()
      return {
        name: manifest.name,
        needsBackdrop: Boolean(manifest.needsBackdrop),
        validationErrors: renderer.validationErrors.slice(errStart),
      }
    } finally {
      mat.dispose()
      geo.dispose()
      backMat?.dispose()
      backGeo?.dispose()
    }
  },
}
window.__oracleReady = true
</script>
</body>
</html>`

async function readScreenshotImage(page) {
  const b64 = await page.screenshot({ encoding: 'base64', omitBackground: true })
  return page.evaluate(async (base64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${base64}`
    await new Promise((r, j) => {
      img.onload = r
      img.onerror = j
    })
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, 256, 256).data
    const px = (x, y) => {
      const i = (y * 256 + x) * 4
      return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] }
    }
    return {
      center: px(128, 128),
      body: px(50, 50),
      radiusCorner: px(19, 19),
      outside: px(2, 2),
      patch: [...data.slice(0)],
    }
  }, b64)
}

function meanCenterDiff(a, b) {
  let sum = 0
  let count = 0
  for (let y = 68; y < 188; y++) {
    for (let x = 68; x < 188; x++) {
      const i = (y * 256 + x) * 4
      sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
      count += 3
    }
  }
  return sum / count
}

function meanCenterLuma(data) {
  let sum = 0
  let count = 0
  for (let y = 68; y < 188; y++) {
    for (let x = 68; x < 188; x++) {
      const i = (y * 256 + x) * 4
      sum += data[i] + data[i + 1] + data[i + 2]
      count += 3
    }
  }
  return sum / count
}

const targets = resolveTargetManifests(process.argv.slice(2))
assert.ok(targets.length > 0, 'No manifest files resolved for oracle')

const server = await createServer({
  configFile: path.join(labRoot, 'vite.config.ts'),
  root: labRoot,
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { strict: false } },
  plugins: [
    {
      name: 'munari-gpu-oracle-html',
      configureServer(srv) {
        srv.middlewares.use('/__oracle.html', async (req, res, next) => {
          try {
            const html = await srv.transformIndexHtml(req.originalUrl || '/__oracle.html', ORACLE_HTML)
            res.statusCode = 200
            res.setHeader('Content-Type', 'text/html')
            res.end(html)
          } catch (err) {
            next(err)
          }
        })
      },
    },
  ],
})
await server.listen()
const address = server.httpServer.address()
const baseUrl = `http://127.0.0.1:${address && 'port' in address ? address.port : 0}`

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: [
    ...WEBGPU_CHROME_ARGS,
    '--enable-features=CanvasDrawElement',
    '--ignore-gpu-blocklist',
    ...(process.env.CI ? ['--no-sandbox'] : []),
  ],
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 256, height: 256, deviceScaleFactor: 1 })
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.url().endsWith('/favicon.ico')) void req.respond({ status: 204, body: '' })
    else void req.continue()
  })
  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(`pageerror: ${String(err)}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(`console.error: ${msg.text()}`)
  })

  await page.goto(`${baseUrl}/__oracle.html`, { waitUntil: 'load' })
  await page.waitForFunction(() => Boolean(window.__oracleReady), { timeout: 20_000 })

  const results = []
  for (const absPath of targets) {
    const fsUrl = `/@fs/${absPath}`
    const run1 = await page.evaluate((u) => window.__munariOracle.runManifest(u), fsUrl)
    assert.deepEqual(run1.validationErrors, [], `${run1.name}: WebGPU validation errors: ${run1.validationErrors.join('; ')}`)
    const snap1 = await readScreenshotImage(page)
    assert.ok(snap1.center.a > 100, `${run1.name}: transparent center ${JSON.stringify(snap1.center)}`)
    assert.ok(snap1.body.r + snap1.body.g + snap1.body.b > 15, `${run1.name}: collapsed black body ${JSON.stringify(snap1.body)}`)
    if (run1.needsBackdrop) {
      assert.ok(
        snap1.body.b > snap1.body.r && snap1.body.a > 100,
        `${run1.name}: expected cyan backdrop refraction at (50,50), got ${JSON.stringify(snap1.body)}`,
      )
    }
    assert.equal(snap1.radiusCorner.a, 0, `${run1.name}: surfaceRadiusMask leaked at (19,19): ${JSON.stringify(snap1.radiusCorner)}`)
    assert.equal(snap1.outside.a, 0, `${run1.name}: non-zero outside alpha ${JSON.stringify(snap1.outside)}`)

    let keyShiftDiff = null
    let behindLumaDelta = null
    if (run1.name === 'lacquer-ltc') {
      const run2 = await page.evaluate(
        (u) => window.__munariOracle.runManifest(u, { x: 388, y: 308, z: 320, brightness: 1, size: [240, 160] }),
        fsUrl,
      )
      assert.deepEqual(run2.validationErrors, [], 'lacquer-ltc frame 2 validation errors')
      const snap2 = await readScreenshotImage(page)
      keyShiftDiff = meanCenterDiff(snap1.patch, snap2.patch)
      assert.ok(keyShiftDiff > 2, `lacquer-ltc did not respond to position-only key shift (meanAbsDiff=${keyShiftDiff})`)

      const run3 = await page.evaluate(
        (u) => window.__munariOracle.runManifest(u, { x: 128, y: 128, z: -200, brightness: 1, size: [240, 160] }),
        fsUrl,
      )
      assert.deepEqual(run3.validationErrors, [], 'lacquer-ltc frame 3 validation errors')
      const snap3 = await readScreenshotImage(page)
      behindLumaDelta = meanCenterLuma(snap1.patch) - meanCenterLuma(snap3.patch)
      assert.ok(behindLumaDelta > 2, `lacquer-ltc did not attenuate when key moved behind plane (delta=${behindLumaDelta})`)
    }
    results.push({
      name: run1.name,
      center: snap1.center,
      body: snap1.body,
      radiusCornerAlpha: snap1.radiusCorner.a,
      keyShiftDiff,
      behindLumaDelta,
    })
  }

  assert.deepEqual(pageErrors, [], `Oracle errors: ${pageErrors.join('; ')}`)
  console.log(JSON.stringify({ gate: 'gpu-oracle', results }, null, 2))
} finally {
  await browser.close()
  await server.close()
}
