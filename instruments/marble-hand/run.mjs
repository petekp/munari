// Marble-hand gate — the real sculpture keeps the browser's cursor point.
//
// The law: a trusted move puts the loaded index vertex on that screen point,
// and one press reaches one native DOM action while the stone stays above it.
// The 2026-08-30 faults were a wrist pivot, a reversed crop, and a hidden
// native cursor before the asset loaded. A settled centre-only check missed
// the depth parallax, so this gate also moves to off-centre points.
//
// Ownership: the lab owns its model and renderer. This runner owns an
// isolated Vite server and Chrome, then reads the existing scene and DOM.
// The visible page never enters a Surface. An inert mirror supplies full-page
// reflection pixels without a page presenter. A second route checks tuning.

import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
import { marbleHandTuning as authoredTuning } from '../../apps/lab/src/scenes/marble-hand/marbleHandTuning.ts'

// Node 24 strips this module's type-only declarations. Heights come from the
// authored settings, never from the object the gate is judging: sampling its
// current height as the expectation would let a stuck press pass as its own
// reference whenever the study's defaults change.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean).find(existsSync)
const strict = process.env.STRICT_CAPABILITY === '1'
const viewport = { width: 1280, height: 900, deviceScaleFactor: 1 }
const assetPath = '/models/marble-hand/classical-hand.stl'
const problems = []
const hdrRequests = []
const artifactDirectory = process.env.MARBLE_HAND_ARTIFACT_DIR
let browser
let server

function requireThat(condition, message) {
  if (!condition) throw new Error(message)
}

function skip(reason) {
  const message = `marble-hand gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message)
  process.exitCode = strict ? 1 : 0
}

async function capable() {
  const page = await browser.newPage()
  const result = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    return context !== null && 'drawElementImage' in context && 'requestPaint' in canvas
  })
  await page.close()
  return result
}

async function launch(headless, fullCapture = true) {
  return puppeteer.launch({
    executablePath: chromePath,
    headless,
    args: [
      ...(fullCapture ? ['--enable-features=CanvasDrawElement'] : []),
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })
}

function watchEnvironmentRequests(page) {
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (/\.(hdr|exr)$/i.test(pathname) || pathname.includes('/hdri/')) hdrRequests.push(request.url())
  })
}

const nextPaint = (page) => page.evaluate(() => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(resolve))
}))

function readHand(page) {
  return page.evaluate(() => {
    const state = window.__r3f
    const hand = state?.scene.getObjectByName('marble-hand-sculpture')
    const group = state?.scene.getObjectByName('marble-hand-pointer')
    const sheet = document.querySelector('.mh-app > .mh-sheet')
    if (!hand?.geometry || !group) return null
    const positions = hand.geometry.getAttribute('position')
    const wristX = hand.geometry.boundingBox.min.x
    const point = hand.position.clone()
    const wrist = hand.position.clone().set(0, 0, 0)
    let wristCount = 0
    let tip = null
    let minWorldZ = Infinity
    for (let index = 0; index < positions.count; index++) {
      point.fromBufferAttribute(positions, index)
      if (point.x === 0 && point.y === 0 && point.z === 0) tip = point.clone()
      if (Math.abs(point.x - wristX) < 0.0001) {
        wrist.add(point)
        wristCount++
      }
      minWorldZ = Math.min(minWorldZ, point.applyMatrix4(hand.matrixWorld).z)
    }
    if (!tip || wristCount === 0) throw new Error('loaded mesh has no real tip or wrist boundary')
    const rect = state.gl.domElement.getBoundingClientRect()
    const project = (vertex) => {
      vertex.applyMatrix4(hand.matrixWorld).project(state.camera)
      return {
        x: rect.left + (vertex.x + 1) * rect.width / 2,
        y: rect.top + (1 - vertex.y) * rect.height / 2,
      }
    }
    const indexTip = project(tip)
    const cutWrist = project(wrist.divideScalar(wristCount))
    return {
      tip: indexTip,
      wrist: { x: cutWrist.x - indexTip.x, y: cutWrist.y - indexTip.y },
      height: group.position.z,
      minWorldZ,
      cursor: getComputedStyle(sheet).cursor,
      pointerAttribute: sheet.hasAttribute('data-marble-hand-pointer'),
      canvasPointerEvents: getComputedStyle(state.gl.domElement).pointerEvents,
      shaderFailures: state.gl.info.programs
        .filter((program) => program.diagnostics?.runnable === false).length,
    }
  })
}

function checkHand(sample, point, label) {
  requireThat(sample, `${label}: no loaded marble-hand-sculpture`)
  const error = Math.hypot(sample.tip.x - point.x, sample.tip.y - point.y)
  requireThat(error <= 1, `${label}: projected tip missed the pointer by ${error.toFixed(3)}px`)
  requireThat(sample.wrist.x > 0 && sample.wrist.y > 0,
    `${label}: wrist did not trail down/right: ${JSON.stringify(sample.wrist)}`)
  requireThat(sample.minWorldZ > 0, `${label}: stone crossed the page at z=${sample.minWorldZ}`)
  requireThat(sample.cursor === 'none', `${label}: native page cursor became ${sample.cursor}`)
  requireThat(sample.pointerAttribute, `${label}: loaded native sheet did not own cursor suppression`)
  requireThat(sample.canvasPointerEvents === 'none',
    `${label}: decorative canvas intercepted the page with pointer-events:${sample.canvasPointerEvents}`)
  requireThat(sample.shaderFailures === 0, `${label}: a WebGL program failed to link`)
  return error
}

// The panel is page chrome above a decorative WebGL canvas. A control that
// changes its displayed number but not the named scene object is a broken
// control; a control that also presses the sheet is broken in a second way.
// These keys cross both boundaries, including degrees in the UI and radians
// in Three (the unit mismatch this 2026-08-30 panel can otherwise hide).
const panelSelector = '[data-marble-hand-controls]'
const panelKeys = ['baseRotation', 'sculptureRoll', 'sculpturePitch', 'scale', 'roughness',
  'keyIntensity', 'envMapIntensity', 'pageLightIntensity', 'roomBounce', 'reflectionFps']
const panelSections = ['Orientation', 'Size & height', 'Movement', 'Marble', 'Reflections', 'Lighting', 'Shadows']

function numberSelector(key) {
  return `${panelSelector} input[data-tuning-key="${key}"][type="number"]`
}

function readPanelNumbers(page) {
  return page.evaluate((rootSelector, keys) => {
    const root = document.querySelector(rootSelector)
    return Object.fromEntries(keys.map((key) => {
      const input = root?.querySelector(`input[data-tuning-key="${key}"][type="number"]`)
      if (!(input instanceof HTMLInputElement)) throw new Error(`missing numeric control ${key}`)
      return [key, Number(input.value)]
    }))
  }, panelSelector, panelKeys)
}

function readPanelScene(page) {
  return page.evaluate(() => {
    const scene = window.__r3f?.scene
    const hand = scene?.getObjectByName('marble-hand-sculpture')
    const group = scene?.getObjectByName('marble-hand-pointer')
    const key = scene?.getObjectByName('marble-hand-key-light')
    const pageLights = ['carta', 'nero', 'cobalto', 'rosso']
      .map((id) => scene?.getObjectByName(`marble-hand-page-light-${id}`))
    if (!hand?.material || !group || !key || pageLights.some((light) => !light)) return null
    return {
      baseRotation: group.rotation.z,
      sculptureRoll: hand.rotation.x,
      sculpturePitch: hand.rotation.y,
      scale: group.scale.x,
      scaleY: group.scale.y,
      scaleZ: group.scale.z,
      roughness: hand.material.roughness,
      envMapIntensity: hand.material.envMapIntensity,
      keyIntensity: key.intensity,
      pageLightTotal: pageLights.reduce((sum, light) => sum + light.intensity, 0),
      height: group.position.z,
    }
  })
}

function readContacts(page) {
  return page.$eval('.mh-app > .mh-sheet', (sheet) =>
    Number(sheet.querySelector('.mh-footer p:nth-child(2) strong').textContent))
}

function readSpecimen(page, name) {
  return page.evaluate((name) => {
    const sheet = document.querySelector('.mh-app > .mh-sheet')
    const button = [...sheet.querySelectorAll('.mh-specimen')]
      .find((item) => item.querySelector('strong')?.textContent === name)
    if (!(button instanceof HTMLButtonElement)) throw new Error(`missing native specimen ${name}`)
    const box = button.getBoundingClientRect()
    const x = box.left + box.width / 2
    const y = box.top + box.height / 2
    const hit = document.elementFromPoint(x, y)
    return {
      x,
      y,
      directHit: hit === button || button.contains(hit),
      contacts: Number(sheet.querySelector('.mh-footer p:nth-child(2) strong').textContent),
    }
  }, name)
}

async function requireNativePage(page, label) {
  await page.waitForSelector('[data-marble-page-capture] .mh-sheet[data-marble-reflection-copy]', { timeout: 30_000 })
  const sample = await page.evaluate(() => {
    const receiver = window.__r3f.scene.getObjectByName('marble-hand-shadow-receiver')
    const capture = document.querySelector('[data-marble-page-capture]')
    let pagePresenters = 0
    window.__r3f.scene.traverse((object) => {
      if (object.material?.map?.name === 'marble-hand-native-page') pagePresenters++
    })
    return {
      sheets: document.querySelectorAll('.mh-app > .mh-sheet').length,
      copies: document.querySelectorAll('.mh-sheet[data-marble-reflection-copy]').length,
      sources: document.querySelectorAll('[data-munari-source-host], [data-marble-page-capture]').length,
      inertCapture: capture?.inert === true && capture.getAttribute('aria-hidden') === 'true',
      pagePresenters,
      canvasPointerEvents: getComputedStyle(window.__r3f.gl.domElement).pointerEvents,
      shadowOnly: receiver?.material?.isShadowMaterial === true && !receiver.material.map,
    }
  })
  requireThat(sample.sheets === 1 && sample.copies === 1 && sample.sources === 1 && sample.inertCapture &&
    sample.pagePresenters === 0 && sample.canvasPointerEvents === 'none' && sample.shadowOnly,
    `${label}: page is not one native sheet under a clear overlay: ${JSON.stringify(sample)}`)
}

async function selectNativeText(page) {
  const points = await page.$eval('.mh-app > .mh-sheet .mh-deck', (paragraph) => {
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node && !node.textContent.trim()) node = walker.nextNode()
    if (!node) throw new Error('native deck has no text node')
    const start = node.textContent.search(/\S/)
    const end = Math.min(node.textContent.length, start + 24)
    const first = document.createRange()
    first.setStart(node, start)
    first.setEnd(node, start + 1)
    const last = document.createRange()
    last.setStart(node, end - 1)
    last.setEnd(node, end)
    const a = first.getBoundingClientRect()
    const b = last.getBoundingClientRect()
    return {
      from: { x: a.left + 0.5, y: a.top + a.height / 2 },
      to: { x: b.right - 0.5, y: b.top + b.height / 2 },
    }
  })
  await page.mouse.move(points.from.x, points.from.y)
  await page.mouse.down()
  await page.mouse.move(points.to.x, points.to.y, { steps: 12 })
  await page.mouse.up()
  const selected = await page.evaluate(() => {
    const selection = window.getSelection()
    const paragraph = document.querySelector('.mh-app > .mh-sheet .mh-deck')
    return {
      text: selection?.toString().trim() ?? '',
      native: Boolean(selection?.anchorNode && selection?.focusNode &&
        paragraph.contains(selection.anchorNode) && paragraph.contains(selection.focusNode)),
    }
  })
  requireThat(selected.native && selected.text.length >= 10,
    `native text selection failed: ${JSON.stringify(selected)}`)
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  return selected.text.length
}

async function clickText(page, selector, text, rootSelector = panelSelector) {
  const elements = await page.$$(rootSelector ? `${rootSelector} ${selector}` : selector)
  try {
    let target = null
    for (const element of elements) {
      const name = await element.evaluate((node) => {
        const copy = node.cloneNode(true)
        for (const decoration of copy.querySelectorAll('[aria-hidden="true"]')) decoration.remove()
        return copy.textContent.replace(/\s+/g, ' ').trim()
      })
      if (name === text) { target = element; break }
    }
    requireThat(target, `controls: missing ${selector} "${text}"`)
    // ElementHandle.click scrolls the panel's own viewport before issuing a
    // trusted mouse press. A screen coordinate alone misses folded sections
    // that sit below the scrollport after Orientation opens.
    await target.click()
  } finally {
    await Promise.all(elements.map((element) => element.dispose()))
  }
  await nextPaint(page)
}

async function openPanelSection(page, name) {
  const open = await page.$eval(panelSelector, (panel, name) => {
    const section = [...panel.querySelectorAll('details')]
      .find((details) => details.querySelector('summary')?.textContent.trim() === name)
    if (!section) throw new Error(`missing section ${name}`)
    return section.open
  }, name)
  if (!open) await clickText(page, 'summary', name)
}

function readPanelCheckbox(page, text) {
  return page.evaluate((rootSelector, text) => {
    const root = document.querySelector(rootSelector)
    const input = [...root.querySelectorAll('input[type="checkbox"]')].find((node) =>
      [...node.labels].some((label) => label.textContent.replace(/\s+/g, ' ').trim() === text))
    if (!(input instanceof HTMLInputElement)) throw new Error(`missing checkbox "${text}"`)
    const box = input.getBoundingClientRect()
    return { checked: input.checked, x: box.left + box.width / 2, y: box.top + box.height / 2 }
  }, panelSelector, text)
}

async function togglePanelCheckbox(page, text) {
  const inputs = await page.$$(`${panelSelector} input[type="checkbox"]`)
  try {
    let target = null
    for (const input of inputs) {
      if (await input.evaluate((node, text) => [...node.labels]
        .some((label) => label.textContent.replace(/\s+/g, ' ').trim() === text), text)) {
        target = input
        break
      }
    }
    requireThat(target, `controls: missing checkbox "${text}"`)
    await target.click()
  } finally {
    await Promise.all(inputs.map((input) => input.dispose()))
  }
  await nextPaint(page)
}

async function setPanelNumber(page, key, value, displayed = value) {
  const selector = numberSelector(key)
  const input = await page.waitForSelector(selector, { visible: true })
  await input.click()
  requireThat(await input.evaluate((node) => document.activeElement === node),
    `controls: ${key} number field did not receive focus`)
  // The trusted click above proves overlay ownership. Type-aware fill then
  // clears Chrome's native number editor; triple-click and OS select-all
  // shortcuts left part of "135.0" selected in headed/headless comparisons.
  await page.locator(selector).fill(String(value))
  await page.keyboard.press('Tab')
  try {
    await page.waitForFunction((selector, expected) => {
      const input = document.querySelector(selector)
      return input instanceof HTMLInputElement && Math.abs(Number(input.value) - expected) < 0.000001
    }, { timeout: 5_000 }, selector, displayed)
  } catch {
    const actual = await page.$eval(selector, (input) => input.value)
    throw new Error(`${key} number field stayed at ${actual}, expected ${displayed} after entering ${value}`)
  }
  await nextPaint(page)
}

async function waitForPanelScene(page, expected, label) {
  try {
    await page.waitForFunction((expected) => {
      const scene = window.__r3f?.scene
      const hand = scene?.getObjectByName('marble-hand-sculpture')
      const group = scene?.getObjectByName('marble-hand-pointer')
      const key = scene?.getObjectByName('marble-hand-key-light')
      const pageLights = ['carta', 'nero', 'cobalto', 'rosso']
        .map((id) => scene?.getObjectByName(`marble-hand-page-light-${id}`))
      if (!hand?.material || !group || !key || pageLights.some((light) => !light)) return false
      const actual = {
        baseRotation: group.rotation.z,
        sculptureRoll: hand.rotation.x,
        sculpturePitch: hand.rotation.y,
        scale: group.scale.x,
        scaleY: group.scale.y,
        scaleZ: group.scale.z,
        roughness: hand.material.roughness,
        envMapIntensity: hand.material.envMapIntensity,
        keyIntensity: key.intensity,
        pageLightTotal: pageLights.reduce((sum, light) => sum + light.intensity, 0),
        height: group.position.z,
      }
      return Object.entries(expected).every(([name, value]) => Math.abs(actual[name] - value) < 0.001)
    }, { timeout: 8_000 }, expected)
  } catch {
    throw new Error(`${label}: live scene ${JSON.stringify(await readPanelScene(page))} did not reach ${JSON.stringify(expected)}`)
  }
}

async function verifyPageReflections(page) {
  // Keep direct page lights out of the optical clause. The native swatch
  // never enters this framebuffer, so changed opaque hand pixels can then
  // come only from its page-derived environment, not from a repainted page.
  await setPanelNumber(page, 'envMapIntensity', 3)
  await setPanelNumber(page, 'roughness', 0.1)
  await setPanelNumber(page, 'pageLightIntensity', 0)
  await page.waitForFunction(() => {
    const scene = window.__r3f?.scene
    const hand = scene?.getObjectByName('marble-hand-sculpture')
    const lights = ['carta', 'nero', 'cobalto', 'rosso']
      .map((id) => scene?.getObjectByName(`marble-hand-page-light-${id}`))
    return hand?.material.envMapIntensity === 3 && hand.material.roughness === 0.1 &&
      lights.every((light) => light && light.intensity === 0)
  }, { timeout: 5_000 })

  const result = await page.evaluate(async () => {
    const state = window.__r3f
    const renderer = state.gl
    const scene = state.scene
    const swatch = document.querySelector('.mh-app > .mh-sheet [data-specimen="cobalto"] .mh-swatch')
    const light = scene.getObjectByName('marble-hand-page-light-cobalto')
    if (!(swatch instanceof HTMLElement) || !light) throw new Error('missing native Cobalto field or page light')
    const previousBackground = swatch.style.background
    const previousColor = light.color.clone()
    const replacement = '#18d97c'
    const expectedColor = light.color.clone().set(replacement)
    const stamp = () => {
      const environment = scene.environment
      if (environment?.name !== 'marble-hand-page-environment' || environment.userData.captureKind !== 'full-page') return null
      return {
        generation: environment.userData.generation ?? environment.userData.captureRevision,
        revision: environment.userData.sourceRevision,
        signature: environment.userData.captureRevision,
      }
    }
    const colorMatches = (expected) => Math.max(
      Math.abs(light.color.r - expected.r),
      Math.abs(light.color.g - expected.g),
      Math.abs(light.color.b - expected.b),
    ) < 0.01
    const until = (ready, label) => new Promise((resolve, reject) => {
      const deadline = performance.now() + 5_000
      const tick = () => {
        if (ready()) resolve()
        else if (performance.now() >= deadline) reject(new Error(`${label} did not settle`))
        else requestAnimationFrame(tick)
      }
      tick()
    })
    const capture = () => new Promise((resolve, reject) => {
      const original = renderer.render
      const timer = setTimeout(() => {
        renderer.render = original
        reject(new Error('no default-framebuffer draw for reflection sample'))
      }, 5_000)
      renderer.render = function (world, camera) {
        try {
          original.call(this, world, camera)
          if (this.getRenderTarget() !== null) return
          const context = this.getContext()
          const width = context.drawingBufferWidth
          const height = context.drawingBufferHeight
          const pixels = new Uint8Array(width * height * 4)
          // House rule: only a completed default-framebuffer render makes
          // readPixels a sample of the picture the browser can present.
          context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels)
          renderer.render = original
          clearTimeout(timer)
          resolve({ width, height, pixels })
        } catch (error) {
          renderer.render = original
          clearTimeout(timer)
          reject(error)
        }
      }
    })

    let stableFrames = 0
    let lastGeneration = -1
    await until(() => {
      const current = stamp()
      if (!current || !Number.isFinite(current.generation) || !Number.isFinite(current.signature)) return false
      stableFrames = current.generation === lastGeneration ? stableFrames + 1 : 0
      lastGeneration = current.generation
      return stableFrames >= 8
    }, 'parked environment')
    const beforeStamp = stamp()
    const before = await capture()
    let changedCapture = beforeStamp.signature
    try {
      swatch.style.background = replacement
      await until(() => {
        const current = stamp()
        return current && current.generation > beforeStamp.generation &&
          current.revision > beforeStamp.revision && current.signature !== beforeStamp.signature &&
          colorMatches(expectedColor)
      }, 'page-derived reflection update')
      const afterStamp = stamp()
      changedCapture = afterStamp.signature
      const after = await capture()
      if (before.width !== after.width || before.height !== after.height) throw new Error('reflection sample resized')
      let opaquePixels = 0
      let changedPixels = 0
      let maxDelta = 0
      let totalDelta = 0
      for (let offset = 0; offset < before.pixels.length; offset += 4) {
        // The opaque sculpture is the evidence. Transparent shadow and
        // untouched clear canvas are not counted as reflected hand pixels.
        if (before.pixels[offset + 3] < 250 || after.pixels[offset + 3] < 250) continue
        const delta = Math.max(
          Math.abs(before.pixels[offset] - after.pixels[offset]),
          Math.abs(before.pixels[offset + 1] - after.pixels[offset + 1]),
          Math.abs(before.pixels[offset + 2] - after.pixels[offset + 2]),
        )
        opaquePixels++
        totalDelta += delta
        maxDelta = Math.max(maxDelta, delta)
        if (delta >= 4) changedPixels++
      }
      return {
        before: beforeStamp,
        after: afterStamp,
        opaquePixels,
        changedPixels,
        maxDelta,
        meanDelta: opaquePixels > 0 ? totalDelta / opaquePixels : 0,
      }
    } finally {
      swatch.style.background = previousBackground
      await until(() => stamp()?.signature > changedCapture && colorMatches(previousColor),
        'restored native swatch')
    }
  })
  // Four channel counts reject ordinary one-count GPU rounding. Plain Chrome
  // measured 1,281 changed opaque pixels and a 42-count peak on 2026-08-30.
  // The 100-pixel/eight-count floor proves a material change without pinning
  // one highlight's exact location across GPU implementations.
  requireThat(result.opaquePixels > 100 && result.changedPixels >= 100 && result.maxDelta >= 8,
    `native page changed its environment but not the reflected hand: ${JSON.stringify(result)}`)
  return result
}

function readHandMaterial(page) {
  return page.evaluate(() => {
    const state = window.__r3f
    const hand = state.scene.getObjectByName('marble-hand-sculpture')
    const group = state.scene.getObjectByName('marble-hand-pointer')
    const material = hand?.material
    if (!material || !group) return null
    const program = state.gl.properties.get(material).currentProgram
    const shader = program?.fragmentShader
      ? state.gl.getContext().getShaderSource(program.fragmentShader) ?? ''
      : ''
    return {
      mesh: hand.uuid,
      geometry: hand.geometry.uuid,
      pose: [...group.position.toArray(), group.rotation.x, group.rotation.y, group.rotation.z,
        ...group.scale.toArray(), hand.rotation.x, hand.rotation.y, hand.rotation.z],
      name: material.name,
      physical: material.isMeshPhysicalMaterial === true,
      metalness: material.metalness,
      roughness: material.roughness,
      clearcoat: material.clearcoat,
      clearcoatRoughness: material.clearcoatRoughness,
      envMapIntensity: material.envMapIntensity,
      color: `#${material.color.getHexString()}`,
      ior: material.ior,
      specularIntensity: material.specularIntensity,
      compiled: shader.length > 0,
      carrara: shader.includes('uMarbleHandVeinStrength') || shader.includes('vMarbleHandPosition'),
    }
  })
}

async function selectHandMaterial(page, mode) {
  await page.click(`${panelSelector} [data-hand-material="${mode}"]`)
  await page.waitForFunction((rootSelector, mode) => {
    const button = document.querySelector(`${rootSelector} [data-hand-material="${mode}"]`)
    const material = window.__r3f?.scene.getObjectByName('marble-hand-sculpture')?.material
    const name = mode === 'chrome' ? 'marble-hand-mirrored-chrome' : 'marble-hand-carrara'
    return button?.getAttribute('aria-pressed') === 'true' && material?.name === name
  }, { timeout: 5_000 }, panelSelector, mode)
  await nextPaint(page)
}

function captureMaterialFrame(page) {
  return page.evaluateHandle(() => new Promise((resolve, reject) => {
    const renderer = window.__r3f.gl
    const original = renderer.render
    const timer = setTimeout(() => {
      renderer.render = original
      reject(new Error('no default-framebuffer draw for material sample'))
    }, 5_000)
    renderer.render = function (scene, camera) {
      try {
        original.call(this, scene, camera)
        if (this.getRenderTarget() !== null) return
        const context = this.getContext()
        const width = context.drawingBufferWidth
        const height = context.drawingBufferHeight
        const pixels = new Uint8Array(width * height * 4)
        // The native page is absent from this framebuffer. Read only here,
        // after its renderer draw, so the comparison measures the hand.
        context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels)
        renderer.render = original
        clearTimeout(timer)
        resolve({ width, height, pixels })
      } catch (error) {
        renderer.render = original
        clearTimeout(timer)
        reject(error)
      }
    }
  }))
}

function readHeadingCapture(page) {
  return page.evaluate(() => {
    const native = document.querySelector('.mh-app > .mh-sheet')
    const wrapper = document.querySelector('[data-marble-page-capture]')
    const copy = wrapper?.querySelector('.mh-sheet[data-marble-reflection-copy]')
    const heading = copy?.querySelector('h1')
    const canvas = wrapper?.closest('canvas')
    const context = canvas?.getContext('2d')
    const environment = window.__r3f.scene.environment
    if (!native || !wrapper || !heading || !context) throw new Error('no readable native heading capture')
    const rootBox = wrapper.getBoundingClientRect()
    const headingBox = heading.getBoundingClientRect()
    const sx = canvas.width / rootBox.width
    const sy = canvas.height / rootBox.height
    const x = Math.max(0, Math.floor((headingBox.left - rootBox.left) * sx))
    const y = Math.max(0, Math.floor((headingBox.top - rootBox.top) * sy))
    const width = Math.min(canvas.width - x, Math.ceil(headingBox.width * sx))
    const height = Math.min(canvas.height - y, Math.ceil(headingBox.height * sy))
    const pixels = context.getImageData(x, y, width, height).data
    let ink = 0
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] > 200 && Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) < 100) ink++
    }
    const nativeFont = getComputedStyle(native.querySelector('h1'))
    const copyFont = getComputedStyle(heading)
    return {
      ink,
      visibility: copyFont.visibility,
      matchingFont: nativeFont.fontFamily === copyFont.fontFamily && nativeFont.fontSize === copyFont.fontSize &&
        nativeFont.fontWeight === copyFont.fontWeight,
      captureKind: environment?.userData.captureKind,
      captureRevision: environment?.userData.captureRevision,
      sourceRevision: environment?.userData.sourceRevision,
      sourceWidth: environment?.userData.sourceWidth,
      sourceHeight: environment?.userData.sourceHeight,
      nativeWidth: native.offsetWidth,
      nativeHeight: native.offsetHeight,
    }
  })
}

function compareHandFrames(page, before, after) {
  return page.evaluate((before, after) => {
    if (before.width !== after.width || before.height !== after.height) throw new Error('hand sample resized')
    let opaquePixels = 0
    let changedPixels = 0
    let maxDelta = 0
    for (let offset = 0; offset < before.pixels.length; offset += 4) {
      if (before.pixels[offset + 3] < 250 || after.pixels[offset + 3] < 250) continue
      const delta = Math.max(
        Math.abs(before.pixels[offset] - after.pixels[offset]),
        Math.abs(before.pixels[offset + 1] - after.pixels[offset + 1]),
        Math.abs(before.pixels[offset + 2] - after.pixels[offset + 2]),
      )
      opaquePixels++
      maxDelta = Math.max(maxDelta, delta)
      if (delta >= 4) changedPixels++
    }
    return { opaquePixels, changedPixels, maxDelta }
  }, before, after)
}

async function verifyHeadingReflections(page) {
  await selectHandMaterial(page, 'chrome')
  await openPanelSection(page, 'Chrome')
  await setPanelNumber(page, 'chromeReflectionIntensity', 3)
  await page.waitForFunction(() => {
    const scene = window.__r3f.scene
    return scene.getObjectByName('marble-hand-sculpture').material.envMapIntensity === 3 &&
      ['carta', 'nero', 'cobalto', 'rosso'].every((id) => scene.getObjectByName(`marble-hand-page-light-${id}`).intensity === 0)
  }, { timeout: 5_000 })
  await togglePanelCheckbox(page, 'Park hand')
  const point = await page.$eval('.mh-app > .mh-sheet h1', (heading) => {
    const box = heading.getBoundingClientRect()
    return { x: box.right - 35, y: box.top + box.height * 0.55 }
  })
  await page.mouse.move(point.x, point.y)
  await page.waitForFunction(() => {
    const group = window.__r3f.scene.getObjectByName('marble-hand-pointer')
    return Math.abs(group.rotation.x) < 0.00001 && Math.abs(group.rotation.y) < 0.00001
  }, { timeout: 5_000 })
  await nextPaint(page)
  const source = await readHeadingCapture(page)
  requireThat(source.captureKind === 'full-page' && source.captureRevision > 0 && source.matchingFont &&
    source.sourceWidth === source.nativeWidth && source.sourceHeight === source.nativeHeight && source.ink > 1000,
  `full-page source did not contain actual heading ink/font: ${JSON.stringify(source)}`)
  const previous = await page.$eval('.mh-app > .mh-sheet h1', (heading) => heading.style.visibility)
  const before = await captureMaterialFrame(page)
  let after
  let changedRevision = source.captureRevision
  try {
    await page.$eval('.mh-app > .mh-sheet h1', (heading) => { heading.style.visibility = 'hidden' })
    await page.waitForFunction((revision, sourceRevision) => {
      const environment = window.__r3f.scene.environment
      const heading = document.querySelector('[data-marble-page-capture] h1')
      return environment?.userData.captureKind === 'full-page' && environment.userData.captureRevision > revision &&
        environment.userData.sourceRevision > sourceRevision && heading && getComputedStyle(heading).visibility === 'hidden'
    }, { timeout: 8_000 }, source.captureRevision, source.sourceRevision)
    const hidden = await readHeadingCapture(page)
    changedRevision = hidden.captureRevision
    requireThat(hidden.ink < source.ink * 0.1,
      `hiding only native H1 did not remove captured ink: ${source.ink} → ${hidden.ink}`)
    after = await captureMaterialFrame(page)
    const pixels = await compareHandFrames(page, before, after)
    requireThat(pixels.changedPixels >= 100 && pixels.maxDelta >= 8,
      `captured heading did not reach reflected hand pixels: ${JSON.stringify(pixels)}`)
    return { ...pixels, sourceInk: source.ink, hiddenInk: hidden.ink }
  } finally {
    await page.$eval('.mh-app > .mh-sheet h1', (heading, visibility) => { heading.style.visibility = visibility }, previous)
    await page.waitForFunction((revision) => window.__r3f.scene.environment?.userData.captureRevision > revision &&
      getComputedStyle(document.querySelector('[data-marble-page-capture] h1')).visibility !== 'hidden',
    { timeout: 8_000 }, changedRevision)
    if (!(await readPanelCheckbox(page, 'Park hand')).checked) await togglePanelCheckbox(page, 'Park hand')
    await before.dispose()
    await after?.dispose()
  }
}

function requireSameHand(actual, expected, label) {
  requireThat(actual.mesh === expected.mesh && actual.geometry === expected.geometry &&
    actual.pose.every((value, index) => Math.abs(value - expected.pose[index]) < 0.000001),
  `${label} replaced the hand mesh/geometry or changed its parked pose`)
}

function requireMirroredChrome(chrome) {
  requireThat(chrome?.physical && chrome.name === 'marble-hand-mirrored-chrome' &&
    chrome.metalness === 1 && chrome.clearcoat === 0 && chrome.roughness <= 0.02 &&
    Math.abs(chrome.roughness - authoredTuning.chromeRoughness) < 0.000001 &&
    Math.abs(chrome.envMapIntensity - authoredTuning.chromeReflectionIntensity) < 0.000001 &&
    chrome.color === authoredTuning.chromeTint.toLowerCase() && chrome.compiled && !chrome.carrara,
  `Chrome did not render bare polished metal: ${JSON.stringify(chrome)}`)
}

function requireRestoredMarble(restored, marble) {
  const fields = ['roughness', 'metalness', 'clearcoat', 'clearcoatRoughness', 'envMapIntensity',
    'color', 'ior', 'specularIntensity']
  requireThat(restored?.name === 'marble-hand-carrara' && restored.carrara &&
    fields.every((key) => restored[key] === marble[key]),
  `Marble settings changed across Chrome mode: ${JSON.stringify({ marble, restored })}`)
  requireSameHand(restored, marble, 'Marble restoration')
}

async function verifyChromeMode(page, savedSettings) {
  const marble = await readHandMaterial(page)
  requireThat(marble?.name === 'marble-hand-carrara' && marble.compiled && marble.carrara,
    `Chrome baseline was not compiled Carrara: ${JSON.stringify(marble)}`)
  requireThat(Math.abs(marble.roughness - authoredTuning.roughness) > 0.01,
    'Chrome restoration clause did not start from an edited marble roughness')
  const before = await captureMaterialFrame(page)
  let after
  try {
    await selectHandMaterial(page, 'chrome')
    await requireNativePage(page, 'Chrome material')
    const chrome = await readHandMaterial(page)
    requireMirroredChrome(chrome)
    requireSameHand(chrome, marble, 'Chrome')

    const sectionNames = await page.$$eval(`${panelSelector} details > summary`, (summaries) =>
      summaries.map((summary) => summary.textContent.trim()))
    requireThat(sectionNames.length === panelSections.length && sectionNames.includes('Chrome') &&
      !sectionNames.includes('Marble'), `Chrome section did not replace Marble: ${sectionNames.join(', ')}`)
    const chromeFields = await page.evaluate((rootSelector) => {
      const root = document.querySelector(rootSelector)
      const roughness = root.querySelector('input[data-tuning-key="chromeRoughness"][type="number"]')
      const reflection = root.querySelector('input[data-tuning-key="chromeReflectionIntensity"][type="number"]')
      const tint = [...root.querySelectorAll('input[type="color"]')].find((input) =>
        [...input.labels].some((label) => label.textContent.trim().startsWith('Chrome tint')))
      return { roughness: Number(roughness?.value), reflection: Number(reflection?.value), tint: tint?.value }
    }, panelSelector)
    requireThat(Math.abs(chromeFields.roughness - authoredTuning.chromeRoughness) < 0.000001 &&
      Math.abs(chromeFields.reflection - authoredTuning.chromeReflectionIntensity) < 0.000001 &&
      chromeFields.tint === authoredTuning.chromeTint.toLowerCase(),
    `Chrome controls did not show authored defaults: ${JSON.stringify(chromeFields)}`)

    after = await captureMaterialFrame(page)
    const pixels = await page.evaluate((before, after) => {
      if (before.width !== after.width || before.height !== after.height) throw new Error('material sample resized')
      let opaquePixels = 0
      let changedPixels = 0
      let maxDelta = 0
      for (let offset = 0; offset < before.pixels.length; offset += 4) {
        if (before.pixels[offset + 3] < 250 || after.pixels[offset + 3] < 250) continue
        const delta = Math.max(
          Math.abs(before.pixels[offset] - after.pixels[offset]),
          Math.abs(before.pixels[offset + 1] - after.pixels[offset + 1]),
          Math.abs(before.pixels[offset + 2] - after.pixels[offset + 2]),
        )
        opaquePixels++
        maxDelta = Math.max(maxDelta, delta)
        if (delta >= 4) changedPixels++
      }
      return { opaquePixels, changedPixels, maxDelta }
    }, before, after)
    requireThat(pixels.opaquePixels > 100 && pixels.changedPixels >= 100 && pixels.maxDelta >= 8,
      `Chrome material switch did not visibly change the hand: ${JSON.stringify(pixels)}`)

    await page.evaluate(() => navigator.clipboard.writeText('marble-hand-chrome-empty'))
    await clickText(page, 'button', 'Copy settings')
    await page.waitForFunction(async () => {
      const text = await navigator.clipboard.readText()
      return text !== 'marble-hand-chrome-empty' && JSON.parse(text).marbleHand?.materialMode === 'chrome'
    }, { timeout: 5_000 })
    const copied = await page.evaluate(async () => JSON.parse(await navigator.clipboard.readText()).marbleHand)
    requireThat(Object.entries(savedSettings).every(([key, value]) => key === 'materialMode' || copied[key] === value),
      'Chrome mode changed saved marble settings in copied JSON')

    await selectHandMaterial(page, 'marble')
    const restored = await readHandMaterial(page)
    requireRestoredMarble(restored, marble)
    await openPanelSection(page, 'Marble')
    await openPanelSection(page, 'Lighting')
    return pixels
  } finally {
    await before.dispose()
    await after?.dispose()
  }
}

async function measureReflectionRate(page, fps) {
  await setPanelNumber(page, 'reflectionFps', fps)
  const durationMs = 2200
  const measuring = page.evaluate((durationMs) => new Promise((resolve, reject) => {
    const state = window.__r3f
    const renderer = state.gl
    const group = state.scene.getObjectByName('marble-hand-pointer')
    const heading = document.querySelector('.mh-app > .mh-sheet h1')
    const previousColor = heading.style.color
    const original = renderer.render
    const started = performance.now()
    const firstGeneration = state.scene.environment.userData.generation
    const firstSource = state.scene.environment.userData.sourceRevision
    let previousGeneration = firstGeneration
    let previousPosition = group.position.clone()
    let frames = 0
    let movingBetweenReflections = 0
    const restore = () => {
      renderer.render = original
      heading.style.color = previousColor
      clearTimeout(timer)
    }
    const timer = setTimeout(() => {
      restore()
      reject(new Error('reflection-rate measurement stopped drawing'))
    }, durationMs + 5000)
    renderer.render = function (world, camera) {
      try {
        original.call(this, world, camera)
        if (this.getRenderTarget() !== null || world !== state.scene) return
        const data = state.scene.environment.userData
        frames++
        if (data.generation === previousGeneration && group.position.distanceTo(previousPosition) > 0.01) {
          movingBetweenReflections++
        }
        previousGeneration = data.generation
        previousPosition.copy(group.position)
        const elapsedMs = performance.now() - started
        if (elapsedMs >= durationMs) {
          restore()
          resolve({
            elapsedMs, frames, movingBetweenReflections,
            updates: data.generation - firstGeneration,
            sourceUpdates: data.sourceRevision - firstSource,
          })
          return
        }
        // A parked, unchanged scene would report zero at every setting.
        // Real heading paint changes keep the reflection source live; the
        // separate trusted pointer sweep also exercises its camera origin.
        heading.style.color = frames % 2 ? '#cf391c' : '#142fce'
      } catch (error) {
        restore()
        reject(error)
      }
    }
  }), durationMs)
  const moving = (async () => {
    const started = Date.now()
    let step = 0
    while (Date.now() - started < durationMs) {
      await page.mouse.move(240 + step % 12 * 24, 210 + step % 5 * 12)
      await nextPaint(page)
      step++
    }
  })()
  const [sample] = await Promise.all([measuring, moving])
  requireThat(sample.sourceUpdates > 0 && sample.updates > 0,
    `${fps}fps reflection measurement did not change actual page capture: ${JSON.stringify(sample)}`)
  return { fps, ...sample, measuredFps: sample.updates * 1000 / sample.elapsedMs }
}

async function verifyReflectionRate(page) {
  await openPanelSection(page, 'Reflections')
  const previous = await page.$eval(numberSelector('reflectionFps'), (input) => Number(input.value))
  const parked = (await readPanelCheckbox(page, 'Park hand')).checked
  if (parked) await togglePanelCheckbox(page, 'Park hand')
  try {
    const low = await measureReflectionRate(page, 2)
    const high = await measureReflectionRate(page, 60)
    // These are ceilings and relative checks, not a 60fps hardware budget.
    // Two extra boundary frames cover a rate change and a partial interval.
    requireThat(low.updates <= Math.ceil(low.elapsedMs * low.fps / 1000) + 2,
      `low reflection rate did not limit PMREM updates: ${JSON.stringify(low)}`)
    requireThat(high.measuredFps > low.measuredFps * 2,
      `reflection frame rate control did not change real updates: ${JSON.stringify({ low, high })}`)
    requireThat(low.movingBetweenReflections >= 4 && low.frames > low.updates * 2,
      `reflection cap also stopped hand motion: ${JSON.stringify(low)}`)
    return { low, high }
  } finally {
    await setPanelNumber(page, 'reflectionFps', previous)
    if (parked) await togglePanelCheckbox(page, 'Park hand')
  }
}

async function verifyPanel(port) {
  const page = await browser.newPage()
  await page.setViewport(viewport)
  await page.setCacheEnabled(false)
  watchEnvironmentRequests(page)
  page.on('pageerror', (error) => problems.push(`controls: ${String(error)}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    if (message.location().url?.endsWith('/favicon.ico')) return
    problems.push(`controls: ${message.text()}`)
  })

  let clause = 'panel arrival'
  try {
    const origin = `http://127.0.0.1:${port}`
    await browser.defaultBrowserContext().overridePermissions(origin,
      ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'])
    await page.goto(`${origin}/?scene=marble-hand`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector(panelSelector, { visible: true, timeout: 30_000 })
    await page.waitForSelector('.mh-app[data-live]', { timeout: 30_000 })
    await page.waitForFunction(() => Boolean(
      window.__r3f?.scene.getObjectByName('marble-hand-sculpture') &&
      window.__r3f?.scene.getObjectByName('marble-hand-key-light'),
    ), { timeout: 30_000 })
    await nextPaint(page)
    await requireNativePage(page, 'controls')
    requireThat(authoredTuning.materialMode === 'marble', 'the authored material default is not marble')
    requireThat(await page.$eval(`${panelSelector} [data-hand-material="marble"]`,
      (button) => button.getAttribute('aria-pressed') === 'true'), 'normal route did not start in Marble mode')

    clause = 'section defaults'
    const sections = await page.$eval(panelSelector, (panel) =>
      [...panel.querySelectorAll('details')].map((details) => ({
        name: details.querySelector('summary')?.textContent.replace(/\s+/g, ' ').trim(),
        open: details.open,
      })))
    for (const name of panelSections) {
      const section = sections.find((item) => item.name === name)
      requireThat(section, `controls: missing native details section ${name}`)
      requireThat(section.open === (name === 'Orientation'),
        `controls: ${name} started ${section.open ? 'open' : 'closed'}`)
    }
    requireThat((await readPanelCheckbox(page, 'Park hand')).checked,
      'controls: Park hand was not checked on the normal route')
    requireThat(!(await readPanelCheckbox(page, 'Hold press')).checked,
      'controls: Hold press was checked on arrival')

    clause = 'parked pointer'
    const defaults = await readPanelNumbers(page)
    requireThat(defaults.reflectionFps === 20 && defaults.reflectionFps === authoredTuning.reflectionFps,
      `controls: reflection frame rate did not start at 20fps: ${defaults.reflectionFps}`)
    await waitForPanelScene(page, { height: authoredTuning.heightPx }, 'authored hover height')
    const initialScene = await readPanelScene(page)
    requireThat(initialScene, 'controls: named live scene objects did not load')
    const contacts = await readContacts(page)
    const parked = await readHand(page)
    requireThat(parked?.cursor !== 'none', 'controls: parked hand hid the native page cursor')
    requireThat(!parked.pointerAttribute, 'controls: parked native sheet kept cursor suppression')

    const points = await page.$eval(panelSelector, (panel) => {
      const box = panel.getBoundingClientRect()
      return [
        { x: box.left + 28, y: box.top + 100 },
        { x: box.right - 28, y: box.top + 220 },
        { x: box.left + box.width / 2, y: Math.min(box.bottom - 28, innerHeight - 28) },
      ]
    })
    let parkedDrift = 0
    for (const point of points) {
      await page.mouse.move(point.x, point.y)
      await nextPaint(page)
      const sample = await readHand(page)
      requireThat(sample, 'controls: parked sculpture disappeared over the panel')
      parkedDrift = Math.max(parkedDrift,
        Math.hypot(sample.tip.x - parked.tip.x, sample.tip.y - parked.tip.y),
        Math.hypot(sample.wrist.x - parked.wrist.x, sample.wrist.y - parked.wrist.y))
      requireThat(sample.cursor !== 'none', 'controls: a panel hover hid the native page cursor')
    }
    // 0.05 CSS px is below a display pixel even at DPR 2. This is a pose
    // comparison, not a timer: a parked hand must not follow panel input.
    requireThat(parkedDrift <= 0.05, `controls: parked sculpture moved ${parkedDrift.toFixed(3)}px`)

    const panelWins = await page.$eval(numberSelector('baseRotation'), (input) => {
      const box = input.getBoundingClientRect()
      const canvas = window.__r3f.gl.domElement
      const held = canvas.style.pointerEvents
      canvas.style.pointerEvents = 'auto'
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      canvas.style.pointerEvents = held
      return {
        aboveCanvas: Boolean(top?.closest('[data-marble-hand-controls]')),
        cursor: top ? getComputedStyle(top).cursor : null,
      }
    })
    requireThat(panelWins.aboveCanvas && panelWins.cursor !== null && panelWins.cursor !== 'none',
      `controls: panel did not own its input above the canvas: ${JSON.stringify(panelWins)}`)

    const degrees = { baseRotation: 117, sculptureRoll: 138, sculpturePitch: 19 }
    clause = 'unedited angle focus'
    for (const key of Object.keys(degrees)) {
      await page.click(numberSelector(key))
      await page.keyboard.press('Tab')
      await nextPaint(page)
      const focused = await readPanelScene(page)
      requireThat(focused[key] === initialScene[key],
        `controls: focusing ${key} changed exact radians ${initialScene[key]} → ${focused[key]}`)
    }
    for (const [key, value] of Object.entries(degrees)) {
      clause = `${key} degree control`
      requireThat(Math.abs(defaults[key] - value) > 1, `controls: ${key} liveness value equals its default`)
      await setPanelNumber(page, key, value)
      await waitForPanelScene(page, { [key]: value * Math.PI / 180 }, `${key} degree conversion`)
    }
    clause = 'scale control'
    await clickText(page, 'summary', 'Size & height')
    await setPanelNumber(page, 'scale', 0.98)
    await waitForPanelScene(page, { scale: 0.98, scaleY: 0.98, scaleZ: 0.98 }, 'scale control')
    clause = 'roughness control'
    await clickText(page, 'summary', 'Marble')
    await setPanelNumber(page, 'roughness', 0.63)
    await waitForPanelScene(page, { roughness: 0.63 }, 'roughness control')
    clause = 'key light control'
    await clickText(page, 'summary', 'Lighting')
    await setPanelNumber(page, 'keyIntensity', 3.4)
    await waitForPanelScene(page, { keyIntensity: 3.4 }, 'key light control')
    clause = 'typed intensity step'
    await setPanelNumber(page, 'keyIntensity', 3.25, 3.3)
    await waitForPanelScene(page, { keyIntensity: 3.3 }, 'typed intensity step')

    clause = 'reflection frame rate bounds'
    await openPanelSection(page, 'Reflections')
    const rateControls = await page.$$eval(`${panelSelector} input[data-tuning-key="reflectionFps"]`, (inputs) =>
      inputs.map((input) => ({
        min: Number(input.min), max: Number(input.max), step: Number(input.step),
        labelled: input.getAttribute('aria-label')?.startsWith('Reflection frame rate') ||
          [...input.labels].some((label) => label.textContent.includes('Reflection frame rate')),
      })))
    requireThat(rateControls.length === 2 && rateControls.every((input) =>
      input.min === 1 && input.max === 120 && input.step === 1 && input.labelled),
    `controls: reflection bounds or labels are wrong: ${JSON.stringify(rateControls)}`)
    await setPanelNumber(page, 'reflectionFps', 0, 1)
    await setPanelNumber(page, 'reflectionFps', 121, 120)
    await setPanelNumber(page, 'reflectionFps', 12)

    // Clear first so an old clipboard value cannot make an unwired button
    // pass. The real write is then read back through the browser permission.
    clause = 'Copy settings'
    await page.evaluate(() => navigator.clipboard.writeText('marble-hand-gate-empty'))
    await clickText(page, 'button', 'Copy settings')
    await page.waitForFunction(async (keys) => {
      const text = await navigator.clipboard.readText()
      return text !== 'marble-hand-gate-empty' && keys.every((key) => text.includes(key))
    }, { timeout: 5_000 }, panelKeys)
    const copied = await page.evaluate(async () => JSON.parse(await navigator.clipboard.readText()).marbleHand)
    const copiedExpected = {
      baseRotation: degrees.baseRotation * Math.PI / 180,
      sculptureRoll: degrees.sculptureRoll * Math.PI / 180,
      sculpturePitch: degrees.sculpturePitch * Math.PI / 180,
      scale: 0.98,
      roughness: 0.63,
      keyIntensity: 3.3,
      envMapIntensity: authoredTuning.envMapIntensity,
      pageLightIntensity: authoredTuning.pageLightIntensity,
      roomBounce: authoredTuning.roomBounce,
      reflectionFps: 12,
    }
    requireThat(Object.entries(copiedExpected).every(([key, value]) => Math.abs(copied?.[key] - value) < 0.000001),
      `controls: copied JSON did not contain the edited runtime values: ${JSON.stringify(copied)}`)
    requireThat(copied.materialMode === 'marble', 'copied settings did not name the active Marble mode')

    clause = 'mirrored Chrome mode'
    const chrome = await verifyChromeMode(page, copied)

    clause = 'native page reflections'
    const reflection = await verifyPageReflections(page)

    clause = 'full-page H1 reflections'
    const heading = await verifyHeadingReflections(page)

    clause = 'reflection frame rate'
    const reflectionRate = await verifyReflectionRate(page)

    clause = 'Reset all'
    await selectHandMaterial(page, 'chrome')
    await clickText(page, 'button', 'Reset all')
    await page.waitForFunction((rootSelector) =>
      document.querySelector(`${rootSelector} [data-hand-material="marble"]`)?.getAttribute('aria-pressed') === 'true' &&
      window.__r3f.scene.getObjectByName('marble-hand-sculpture')?.material.name === 'marble-hand-carrara',
    { timeout: 5_000 }, panelSelector)
    await page.waitForFunction((rootSelector, expected) => Object.entries(expected).every(([key, value]) => {
      const input = document.querySelector(`${rootSelector} input[data-tuning-key="${key}"][type="number"]`)
      return input instanceof HTMLInputElement && Math.abs(Number(input.value) - value) < 0.000001
    }), { timeout: 5_000 }, panelSelector, defaults)
    await waitForPanelScene(page, { ...initialScene, height: authoredTuning.heightPx }, 'Reset all')

    clause = 'Hold press'
    const pressHeight = await page.$eval(numberSelector('pressHeightPx'), (input) => Number(input.value))
    requireThat(pressHeight === authoredTuning.pressHeightPx,
      `controls: reset press height ${pressHeight} differs from authored ${authoredTuning.pressHeightPx}`)
    await togglePanelCheckbox(page, 'Hold press')
    requireThat((await readPanelCheckbox(page, 'Hold press')).checked,
      'controls: Hold press did not remain checked')
    await page.waitForFunction((height) => Math.abs(
      window.__r3f.scene.getObjectByName('marble-hand-pointer').position.z - height,
    ) < 0.1, { timeout: 5_000 }, authoredTuning.pressHeightPx)
    const heldPress = await readPanelScene(page)
    await togglePanelCheckbox(page, 'Hold press')
    await waitForPanelScene(page, { height: authoredTuning.heightPx }, 'release held press')

    clause = 'close and reopen'
    await page.click(`${panelSelector} [aria-label="Close hand controls"]`)
    await page.waitForSelector(`aside${panelSelector}`, { hidden: true, timeout: 5_000 })
    await clickText(page, 'button', 'Tweak hand', '')
    await page.waitForSelector(`aside${panelSelector}`, { visible: true, timeout: 5_000 })
    requireThat((await readPanelCheckbox(page, 'Park hand')).checked,
      'controls: closing and reopening lost Park hand')
    const afterContacts = await readContacts(page)
    requireThat(afterContacts === contacts,
      `controls: panel input added specimen contacts ${contacts} → ${afterContacts}`)
    requireThat(problems.length === 0, `page errors: ${problems.join('\n')}`)
    if (artifactDirectory) {
      await mkdir(artifactDirectory, { recursive: true })
      await page.screenshot({ path: path.join(artifactDirectory, 'flagged-page.png') })
      const png = await page.$eval('[data-marble-page-capture]', (wrapper) =>
        wrapper.closest('canvas').toDataURL('image/png').split(',')[1])
      await writeFile(path.join(artifactDirectory, 'full-page-source.png'), Buffer.from(png, 'base64'))
      console.log(`marble-hand artifacts: ${artifactDirectory}`)
    }
    return { parkedDrift, contacts, heldHeight: heldPress.height, restoredHeight: authoredTuning.heightPx,
      reflection, chrome, heading, reflectionRate }
  } catch (error) {
    throw new Error(`controls ${clause}: ${error.message}`)
  } finally {
    await page.close()
  }
}

async function verifyReflectionUnavailable(port, headless) {
  const plain = await launch(headless, false)
  try {
    const page = await plain.newPage()
    await page.setViewport(viewport)
    watchEnvironmentRequests(page)
    const errors = []
    page.on('pageerror', (error) => errors.push(String(error)))
    await page.goto(`http://127.0.0.1:${port}/?scene=marble-hand&bare`, { waitUntil: 'domcontentloaded' })
    const available = await page.evaluate(() => 'drawElementImage' in document.createElement('canvas').getContext('2d'))
    if (available) {
      console.warn('marble-hand no-flag clause SKIPPED: this browser exposes HTML-in-canvas without the flag')
      return false
    }
    await page.waitForSelector('.mh-app > .mh-sheet .mh-capture-notice', { visible: true, timeout: 30_000 })
    await page.waitForFunction(() => Boolean(window.__r3f?.scene.environment), { timeout: 30_000 })
    const native = await page.evaluate(() => ({
      sheets: document.querySelectorAll('.mh-app > .mh-sheet').length,
      copies: document.querySelectorAll('[data-marble-reflection-copy]').length,
      clear: getComputedStyle(window.__r3f.gl.domElement).pointerEvents === 'none',
      kind: window.__r3f.scene.environment.userData.captureKind,
      notice: document.querySelector('.mh-app > .mh-sheet .mh-capture-notice').textContent,
    }))
    requireThat(native.sheets === 1 && native.copies === 0 && native.clear && native.kind !== 'full-page' &&
      native.notice.includes('Full-page reflections need Chrome'),
    `no-flag page falsely claimed full capture or lost native ownership: ${JSON.stringify(native)}`)
    const nero = await readSpecimen(page, 'Nero')
    requireThat(nero.directHit, 'no-flag page blocked its native Nero button')
    await page.mouse.click(nero.x, nero.y)
    requireThat(await readContacts(page) === nero.contacts + 1, 'no-flag native button did not activate')
    await selectNativeText(page)
    requireThat(errors.length === 0, `no-flag page errors: ${errors.join('\n')}`)
    return true
  } finally {
    await plain.close()
  }
}

async function run() {
  if (!chromePath) return skip('no Chrome executable found (set CHROME_PATH)')
  const headless = process.env.HEADED !== '1'
  browser = await launch(headless)
  let supported = await capable()
  if (!supported && headless && !process.env.CI) {
    await browser.close()
    browser = await launch(false)
    supported = await capable()
  }
  if (!supported) return skip(`Chrome at ${chromePath} has no complete HTML-in-canvas capture API`)

  server = await createServer({
    root: path.join(repoRoot, 'apps', 'lab'),
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  const port = server.httpServer.address().port
  const page = await browser.newPage()
  await page.setViewport(viewport)
  await page.setCacheEnabled(false)
  watchEnvironmentRequests(page)
  page.on('pageerror', (error) => problems.push(String(error)))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    if (message.location().url?.endsWith('/favicon.ico')) return
    problems.push(message.text())
  })

  // Hold a real cold request. The native page must remain usable while the
  // sculpture is absent, which is the state the early cursor CSS broke.
  const held = []
  let delayAsset = true
  await page.setRequestInterception(true)
  page.on('request', (request) => {
    if (delayAsset && new URL(request.url()).pathname === assetPath) held.push(request)
    else void request.continue().catch((error) => problems.push(String(error)))
  })
  const requested = page.waitForRequest((request) => new URL(request.url()).pathname === assetPath)
  await page.goto(`http://127.0.0.1:${port}/?scene=marble-hand&bare`, { waitUntil: 'domcontentloaded' })
  await requested
  await page.waitForSelector('.mh-app > .mh-sheet', { visible: true, timeout: 30_000 })
  await page.waitForFunction(() => Boolean(window.__r3f?.gl), { timeout: 30_000 })
  await nextPaint(page)
  await requireNativePage(page, 'cold load')
  const cold = await page.evaluate(() => {
    const sheet = document.querySelector('.mh-app > .mh-sheet')
    const underPointer = document.elementFromPoint(240, 220)
    return {
      hand: Boolean(window.__r3f.scene.getObjectByName('marble-hand-sculpture')),
      live: document.querySelector('.mh-app').hasAttribute('data-live'),
      pointerAttribute: sheet.hasAttribute('data-marble-hand-pointer'),
      pageCursor: getComputedStyle(sheet).cursor,
      hitCursor: underPointer ? getComputedStyle(underPointer).cursor : null,
    }
  })
  requireThat(!cold.hand && !cold.live && !cold.pointerAttribute && held.length > 0,
    'cold-load clause did not hold the sculpture request with a native cursor')
  requireThat(cold.pageCursor !== 'none' && cold.hitCursor !== null && cold.hitCursor !== 'none',
    `cold page hid the native cursor: ${JSON.stringify(cold)}`)
  const coldNero = await readSpecimen(page, 'Nero')
  requireThat(coldNero.directHit, 'cold page did not hit the native Nero button')
  await page.mouse.click(coldNero.x, coldNero.y)
  await page.waitForFunction(() => document.querySelector('.mh-app > .mh-sheet .mh-footer p:first-child strong')?.textContent === 'nero')
  const coldContacts = await readContacts(page)
  requireThat(coldContacts === coldNero.contacts + 1,
    `cold native click produced ${coldContacts} contacts from ${coldNero.contacts}`)
  delayAsset = false
  await Promise.all(held.map((request) => request.continue()))
  await page.waitForSelector('.mh-app[data-live]', { timeout: 30_000 })
  await page.waitForFunction(() => Boolean(window.__r3f?.scene.getObjectByName('marble-hand-sculpture')),
    { timeout: 30_000 })
  await nextPaint(page)
  await requireNativePage(page, 'loaded hand')
  const loaded = await readHand(page)
  requireThat(loaded?.cursor === 'none' && loaded.pointerAttribute,
    'loaded sculpture did not hand cursor suppression to the native page')

  let worstTipError = 0
  let lowestStone = Infinity
  for (const [x, y] of [[240, 220], [980, 280], [760, 610], [360, 690]]) {
    await page.mouse.move(x, y)
    await nextPaint(page)
    const sample = await readHand(page)
    worstTipError = Math.max(worstTipError, checkHand(sample, { x, y }, `move ${x},${y}`))
    lowestStone = Math.min(lowestStone, sample.minWorldZ)
  }

  const carta = await readSpecimen(page, 'Carta')
  requireThat(carta.directHit, 'loaded overlay blocked the native Carta button')
  await page.mouse.move(carta.x, carta.y)
  await page.waitForFunction((height) => Math.abs(
    window.__r3f.scene.getObjectByName('marble-hand-pointer').position.z - height,
  ) < 0.1, undefined, authoredTuning.heightPx)
  await page.mouse.down()
  await page.waitForFunction((height) => Math.abs(
    window.__r3f.scene.getObjectByName('marble-hand-pointer').position.z - height,
  ) < 0.1, undefined, authoredTuning.pressHeightPx)
  await nextPaint(page)
  const pressed = await readHand(page)
  checkHand(pressed, carta, 'press')
  lowestStone = Math.min(lowestStone, pressed.minWorldZ)
  await page.mouse.up()
  await page.waitForFunction(() =>
    document.querySelector('.mh-app > .mh-sheet .mh-footer p:first-child strong')?.textContent === 'carta')
  await page.waitForFunction((height) => Math.abs(
    window.__r3f.scene.getObjectByName('marble-hand-pointer').position.z - height,
  ) < 0.1, undefined, authoredTuning.heightPx)
  await nextPaint(page)
  const released = await readHand(page)
  checkHand(released, carta, 'click release')
  const after = await page.$eval('.mh-app > .mh-sheet', (sheet) => {
    const button = [...sheet.querySelectorAll('.mh-specimen')]
      .find((item) => item.querySelector('strong')?.textContent === 'Carta')
    return {
      contacts: Number(sheet.querySelector('.mh-footer p:nth-child(2) strong').textContent),
      cartaPressed: button?.getAttribute('aria-pressed'),
      cartaFocused: document.activeElement === button,
    }
  })
  requireThat(after.contacts === carta.contacts + 1 && after.cartaPressed === 'true' && after.cartaFocused,
    `one Carta click produced ${JSON.stringify(after)} from ${carta.contacts} contacts`)
  const selectedCharacters = await selectNativeText(page)
  requireThat(await readContacts(page) === after.contacts, 'native text selection activated a specimen')
  requireThat(problems.length === 0, `page errors: ${problems.join('\n')}`)
  await page.close()
  const panel = await verifyPanel(port)
  const unavailable = await verifyReflectionUnavailable(port, headless)
  requireThat(hdrRequests.length === 0, `page-derived room requested HDR assets: ${hdrRequests.join(', ')}`)
  console.log(`marble-hand gate PASSED: native full-page capture; cold cursor ${cold.pageCursor}; ` +
    `one native sheet; ${selectedCharacters} selected characters; no HDR requests; ` +
    `tip error ${worstTipError.toFixed(3)}px; height ${authoredTuning.heightPx} → ${pressed.height.toFixed(2)} → ${released.height.toFixed(2)}; ` +
    `lowest stone ${lowestStone.toFixed(2)}px; Carta contacts ${carta.contacts} → ${after.contacts}; ` +
    `panel degree/material/light/reset checks; parked drift ${panel.parkedDrift.toFixed(3)}px; ` +
    `held press ${panel.restoredHeight.toFixed(2)} → ${panel.heldHeight.toFixed(2)}; ` +
    `panel contacts ${panel.contacts} unchanged; reflection ${panel.reflection.changedPixels} hand pixels, ` +
    `peak ${panel.reflection.maxDelta}/255; Chrome ${panel.chrome.changedPixels} hand pixels, ` +
    `peak ${panel.chrome.maxDelta}/255; H1 ink ${panel.heading.sourceInk} → ${panel.heading.hiddenInk}, ` +
    `${panel.heading.changedPixels} reflected hand pixels; no-flag notice ${unavailable ? 'passed' : 'skipped'}; ` +
    `reflection rate ${panel.reflectionRate.low.measuredFps.toFixed(1)}fps at 2 → ` +
    `${panel.reflectionRate.high.measuredFps.toFixed(1)}fps at 60; ` +
    `${panel.reflectionRate.low.movingBetweenReflections} hand moves between low-rate reflections; ` +
    `marble settings preserved`)
}

let deadline
try {
  await Promise.race([
    run(),
    new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error('hard 120s deadline hit')), 120_000)
    }),
  ])
} catch (error) {
  console.error(`marble-hand gate FAILED: ${error.message}`)
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
  await Promise.allSettled([browser?.close(), server?.close()])
}
