// Real-Chrome receipt and RGB gate for the public frame-backed Surface.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean)

const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate))
if (!chromePath) {
  console.error('frame-surface gate: no Chrome executable found (set CHROME_PATH)')
  process.exit(1)
}

let server
let browser
const deadline = setTimeout(() => {
  console.error('frame-surface gate: hard 45s deadline hit')
  process.exit(1)
}, 45_000)

try {
  server = await createServer({
    configFile: false,
    root: here,
    logLevel: 'warn',
    resolve: {
      alias: {
        '@munari/core': path.join(repoRoot, 'packages', 'core', 'src', 'index.ts'),
        '@petepetrash/munari/advanced': path.join(
          repoRoot, 'packages', 'react', 'src', 'advanced.ts',
        ),
        '@petepetrash/munari': path.join(repoRoot, 'packages', 'react', 'src', 'index.ts'),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 0,
      fs: { allow: [repoRoot, here] },
    },
  })
  await server.listen()

  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      // Headless has no GPU here; SwiftShader supplies a real WebGL
      // context so the render path under test exists at all.
      '--enable-webgl',
      '--enable-unsafe-swiftshader',
      // The idle-zero pair: a backgrounded renderer stops compositing,
      // and a receipt that never arrives must mean the library failed,
      // not that throttling starved the frameloop.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })

  const page = await browser.newPage()
  console.log('graphics diagnostic: Chrome', await browser.version())
  const diagnosticClient = await browser.target().createCDPSession()
  console.log('graphics diagnostic: system', JSON.stringify(await diagnosticClient.send('SystemInfo.getInfo')))
  await diagnosticClient.detach()
  console.log('graphics diagnostic: independent pixels', JSON.stringify(await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 8
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })
    if (!gl) return { context: false }
    const extension = gl.getExtension('WEBGL_debug_renderer_info')
    const read = () => {
      const bytes = new Uint8Array(4)
      gl.readPixels(4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes)
      return { rgba: Array.from(bytes), error: gl.getError() }
    }
    gl.clearColor(1, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const cleared = read()
    const compile = (type, source) => {
      const shader = gl.createShader(type)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      return shader
    }
    const vertex = compile(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}')
    const fragment = compile(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;uniform sampler2D image;uniform bool textured;out vec4 color;void main(){color=textured?texture(image,vec2(0.5)):vec4(0,1,0,1);}')
    const program = gl.createProgram()
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    gl.useProgram(program)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    const triangle = read()
    const source = document.createElement('canvas')
    source.width = source.height = 2
    const context = source.getContext('2d')
    context.fillStyle = '#0000ff'
    context.fillRect(0, 0, 2, 2)
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.uniform1i(gl.getUniformLocation(program, 'textured'), 1)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    const canvasTexture = read()
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 255, 255, 255]))
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    const byteTexture = read()
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    const srgbCanvasTexture = read()
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 255, 255, 255]))
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    const srgbByteTexture = read()
    const result = { renderer: extension && gl.getParameter(extension.UNMASKED_RENDERER_WEBGL), cleared, triangle, canvasTexture, byteTexture, srgbCanvasTexture, srgbByteTexture, shaderErrors: [gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment), gl.getProgramInfoLog(program)] }
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return result
  })))
  await page.setViewport({ width: 512, height: 256, deviceScaleFactor: 1 })
  const pageProblems = []
  page.on('pageerror', (error) => pageProblems.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'warn') console.log('graphics diagnostic: warning', message.text())
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) {
      pageProblems.push(message.text())
    }
  })

  const url = server.resolvedUrls.local[0]
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__frameSurfaceGate?.ready === true, {
    timeout: 10_000,
  })

  let gateTimeout
  let result
  try {
    result = await Promise.race([
      page.evaluate(() => window.__frameSurfaceGate.run()),
      new Promise((_, reject) => {
        gateTimeout = setTimeout(
          () => reject(new Error('frame-surface gate: result timed out')),
          15_000,
        )
      }),
    ])
  } catch (error) {
    console.error('frame-surface gate debug:', await page.evaluate(() => window.__frameSurfaceGate.debug()))
    throw error
  } finally {
    clearTimeout(gateTimeout)
  }

  console.log('graphics diagnostic: Three pixels', JSON.stringify(await page.evaluate(async (moduleUrl) => {
    const THREE = await import(moduleUrl)
    const renderer = new THREE.WebGLRenderer({ alpha: false, antialias: false, preserveDrawingBuffer: true })
    renderer.setSize(64, 16)
    renderer.setClearColor(0xff0000)
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
    camera.position.z = 1
    const geometry = new THREE.PlaneGeometry(2, 2)
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 16
    const context = canvas.getContext('2d', { alpha: false })
    context.fillStyle = '#149632'
    context.fillRect(0, 0, 64, 16)
    const mesh = new THREE.Mesh(geometry)
    scene.add(mesh)
    const results = []
    for (const mode of ['solid', 'default', 'srgb', 'srgb-mipmaps', 'srgb-anisotropy']) {
      const texture = mode === 'solid' ? null : new THREE.CanvasTexture(canvas)
      if (texture) {
        texture.colorSpace = mode.startsWith('srgb') ? THREE.SRGBColorSpace : THREE.NoColorSpace
        texture.generateMipmaps = mode.includes('mipmaps') || mode.includes('anisotropy')
        texture.minFilter = texture.generateMipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
        texture.anisotropy = mode.includes('anisotropy') ? 8 : 1
        texture.needsUpdate = true
      }
      const material = new THREE.MeshBasicMaterial({ map: texture, color: mode === 'solid' ? 0x149632 : 0xffffff, toneMapped: false })
      mesh.material = material
      renderer.render(scene, camera)
      const bytes = new Uint8Array(4)
      const gl = renderer.getContext()
      gl.readPixels(32, 8, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes)
      results.push({ mode, rgba: Array.from(bytes), error: gl.getError() })
      material.dispose()
      texture?.dispose()
    }
    geometry.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
    return results
  }, `/@fs/${repoRoot}/node_modules/three/build/three.module.js`)))
  const receiptTrace = result.receipts
    .map(
      ({ receipt }) =>
        `${receipt.frame.generation}@source-${receipt.frame.sourceId}/epoch-${receipt.surfaceEpoch}`,
    )
    .join(', ')
  console.log(`frame-surface: receipts [${receiptTrace}]`)
  console.log(
    `frame-surface: replacement renders ${result.replacementRenderSamples.length}, ` +
      `clear frames ${result.replacementClearFrames}, stale old-source receipts ` +
      `${result.staleOldSourceReceipts}`,
  )
  for (const acquisition of result.acquisitionEvidence) {
    console.log(
      `frame-surface: reacquire ${acquisition.cycle} published ` +
        `[${acquisition.publishedGenerations.join(', ')}] while released ` +
        `${acquisition.releasedSurfaceAbsent ? 'yes' : 'NO'}, receipt ` +
        `${acquisition.receiptGeneration}@epoch-${acquisition.surfaceEpoch}, renders ` +
        `${acquisition.renderSamples}, clear ${acquisition.clearFrames}, mismatched ` +
        `${acquisition.mismatchedFrames}, RGB error ${acquisition.receiptRgbError}, ` +
        `mesh/material/geometry ${acquisition.meshId}/${acquisition.materialId}/` +
        `${acquisition.geometryId}`,
    )
  }
  console.log(
    `frame-surface: live replacement identity ` +
      `${result.liveReplacementIdentityPreserved ? 'preserved' : 'changed'}, ` +
      `worst RGB error ${result.worstRgbError}`,
  )
  console.log(
    `frame-surface: presentation fence frame receipts ` +
      `${result.presentationFence.frameReceipts.length}, presentation receipts ` +
      `${result.presentationFence.presentationReceipts.length}, disabled clear ` +
      `${result.presentationFence.disabledDefaultClear ? 'yes' : 'NO'}, offscreen drew ` +
      `${result.presentationFence.offscreenHadPixels ? 'yes' : 'NO'}, offscreen RGB error ` +
      `${result.presentationFence.offscreenRgbError}, visible RGB error ` +
      `${result.presentationFence.visibleRgbError}`,
  )
  console.log(
    `frame-surface: backing-store resize generations ` +
      `[${result.backingStoreResize.generations.join(', ')}], size ` +
      `${result.backingStoreResize.finalWidth}x${result.backingStoreResize.finalHeight}, ` +
      `same texture ${result.backingStoreResize.sameTexture ? 'yes' : 'NO'}, RGB errors ` +
      `[${result.backingStoreResize.rgbErrors.join(', ')}]`,
  )

  if (result.passed && pageProblems.length === 0) {
    await page.close()
    const control = await browser.newPage()
    await control.setViewport({ width: 512, height: 256, deviceScaleFactor: 1 })
    control.on('pageerror', error => pageProblems.push(String(error)))
    control.on('console', message => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:'))
        pageProblems.push(message.text())
    })
    await control.goto(`${url}?toneMapped`, { waitUntil: 'load' })
    await control.waitForFunction(() => window.__frameSurfaceGate?.ready === true)
    const wrongTone = await control.evaluate(() => window.__frameSurfaceGate.run())
    if (wrongTone.passed || !Number.isFinite(wrongTone.worstRgbError) || wrongTone.worstRgbError <= 1) {
      throw new Error('frame-surface: color oracle did not reject tone mapping of captured colors')
    }
    console.log(`frame-surface: tone-mapping fault rejected, RGB error ${wrongTone.worstRgbError}`)
    await control.close()
  }

  if (pageProblems.length) {
    console.error('frame-surface gate: page errors during the run:')
    for (const problem of pageProblems) console.error(`  ${problem}`)
    process.exitCode = 1
  } else if (!result.passed) {
    console.error('frame-surface gate FAILED')
    console.error(JSON.stringify(result, null, 2))
    process.exitCode = 1
  } else {
    console.log(
      'frame-surface gate PASSED: visible presentation, live replacement, and 3 handoff cycles kept current sRGB pixels.',
    )
  }
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
