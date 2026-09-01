// Marble-hand gate — the real sculpture keeps the browser's cursor point.
//
// The law: a trusted move puts the loaded index vertex on that screen point,
// and one press reaches one native DOM action while the stone stays above it.
// The 2026-08-30 faults were a wrist pivot, a reversed crop, and a hidden
// native cursor before the asset loaded. A settled centre-only check missed
// the depth parallax, so this gate also moves to off-centre points.
//
// The 2026-08-31 change moved the poster's colour into a second WebGL canvas
// inside the page. cloneNode gives a blank canvas, so the reflection draws
// the same GLSL for itself; this gate's colour section now measures that the
// two renderers share one published second rather than two CSS clocks.
//
// The same day added the idle tap. Its section is the only one that reads the
// overlay's pixels twice with nothing touched in between: three curled fingers
// bend in a vertex shader, so a broken patch leaves the pose, the height and
// every projected vertex correct while the drawn stone does not move at all.
// It also pins the fingertip across the drum, because a hinge whose capsule
// caught the index would move the hotspot without moving the group.
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
import { MARBLE_HAND_GROUPS, marbleHandTuning as authoredTuning } from '../../apps/lab/src/scenes/marble-hand/marbleHandTuning.ts'
import { MARBLE_BACKGROUND_REDUCED_TIME } from '../../apps/lab/src/scenes/marble-hand/marbleHandBackgroundClock.ts'

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
const nativeThemeClicks = new WeakMap()
const artifactDirectory = process.env.MARBLE_HAND_ARTIFACT_DIR
const themes = [
  { id: 'waves', name: 'Waves' },
  { id: 'checker', name: 'Checker' },
  { id: 'prism', name: 'Prism' },
]
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

function readColorMotion(page) {
  return page.evaluate(() => {
    // Small readers, not one guarded expression: this runs on a cold page
    // with no hand, no capture copy and no field canvas as well as a live one.
    const values = (source, keys) => {
      const out = {}
      for (const key of keys) out[key] = source ? source[key] : null
      return out
    }
    const marks = (selector) => {
      const root = document.querySelector(selector)
      const background = root ? root.querySelector('.mh-background') : null
      return {
        state: root ? root.getAttribute('data-motion') : null,
        visualization: background ? background.getAttribute('data-visualization') : null,
      }
    }
    const store = window.__r3f
    const environment = store ? store.scene.environment : null
    const native = marks('.mh-app > .mh-sheet')
    const copy = marks('[data-marble-page-capture] .mh-sheet')
    return {
      state: native.state,
      visualization: native.visualization,
      copyState: copy.state,
      copyVisualization: copy.visualization,
      // The reflected copy takes the clock through a subscription, so this
      // is the second it will draw, not a second reading of wall time.
      reflectedTime: store ? store.scene.userData.marbleBackgroundTime : null,
      ...values(window.__marbleBackground, ['theme', 'frames', 'draws', 'time', 'running', 'contextLost']),
      ...values(environment ? environment.userData : null,
        ['backgroundTheme', 'backgroundTime', 'generation', 'sourceRevision', 'captureRevision']),
    }
  })
}

// The field canvas is a second WebGL context inside the page. A cloned
// canvas is blank, which is why the reflection draws the shader itself; if
// this one is missing or lost, the page falls back to a CSS gradient.
function readFieldCanvas(page) {
  return page.evaluate(() => {
    const background = document.querySelector('.mh-app > .mh-sheet .mh-atmosphere .mh-background')
    const canvas = background ? background.querySelector('canvas.mh-field') : null
    if (!canvas) return { background: Boolean(background), canvas: false }
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl')
    return {
      background: true,
      canvas: true,
      fallback: background.hasAttribute('data-fallback'),
      width: canvas.width,
      cssWidth: Math.round(canvas.getBoundingClientRect().width),
      context: Boolean(context),
      lost: context ? context.isContextLost() : null,
      copies: document.querySelectorAll('[data-marble-page-capture] canvas.mh-field').length,
    }
  })
}

async function setPageMotion(page, running) {
  const desired = running ? 'running' : 'paused'
  const before = await readColorMotion(page)
  const panelWasOpen = Boolean(await page.$(`aside${panelSelector}`))
  if (before.state !== desired) {
    await setPanelOpen(page, true)
    await page.click(`${panelSelector} [data-marble-motion-toggle]`)
  }
  await page.waitForFunction((desired) => {
    const native = document.querySelector('.mh-app > .mh-sheet')
    const copy = document.querySelector('[data-marble-page-capture] .mh-sheet')
    const field = window.__marbleBackground
    return native?.getAttribute('data-motion') === desired &&
      (!copy || copy.getAttribute('data-motion') === desired) &&
      (!field || field.running === (desired === 'running'))
  }, { timeout: 5_000 }, desired).catch(async () => {
    throw new Error(`color motion did not become ${desired}: ${JSON.stringify(await readColorMotion(page))}`)
  })
  await nextPaint(page)
  if (!panelWasOpen) await setPanelOpen(page, false)
}

// A held clock still bakes once: the reflection has to reach the second the
// page stopped on. Everything a pause claims is measured after that bake.
async function settleReflection(page) {
  await page.waitForFunction(() => {
    const environment = window.__r3f?.scene.environment
    const generation = environment?.userData.generation
    if (!Number.isFinite(generation)) return false
    const record = window.__marbleGateSettle || { generation: -1, quiet: 0 }
    record.quiet = generation === record.generation ? record.quiet + 1 : 0
    record.generation = generation
    window.__marbleGateSettle = record
    return record.quiet >= 8
  }, { timeout: 10_000, polling: 'raf' })
  await page.evaluate(() => { window.__marbleGateSettle = undefined })
}

async function sampleColorMotion(page, durationMs = 400) {
  return page.evaluate((durationMs) => new Promise((resolve) => {
    const values = (source, keys) => {
      const out = {}
      for (const key of keys) out[key] = source ? source[key] : null
      return out
    }
    // sampleHash draws one frame off the loop and reads it back, so it
    // counts as a draw and never as a frame: a held page must look held.
    const sample = () => {
      const field = window.__marbleBackground
      const environment = window.__r3f ? window.__r3f.scene.environment : null
      return {
        hash: field ? field.sampleHash() : null,
        ...values(field, ['theme', 'frames', 'draws', 'time', 'running', 'contextLost']),
        ...values(environment ? environment.userData : null,
          ['backgroundTheme', 'backgroundTime', 'generation', 'sourceRevision', 'captureRevision']),
      }
    }
    const first = sample()
    const started = performance.now()
    let maxClockError = 0
    let unreflected = 0
    const tick = () => {
      const field = window.__marbleBackground
      const reflected = window.__r3f?.scene.userData.marbleBackgroundTime
      if (field && Number.isFinite(reflected)) {
        maxClockError = Math.max(maxClockError, Math.abs(reflected - field.time) * 1000)
      } else unreflected++
      const elapsed = performance.now() - started
      if (elapsed < durationMs) { requestAnimationFrame(tick); return }
      const last = sample()
      resolve({
        first, last, maxClockError, unreflected, elapsed,
        fps: Math.round((last.frames - first.frames) / (elapsed / 1000)),
      })
    }
    requestAnimationFrame(tick)
  }), durationMs)
}

function requireMoving(sample, label) {
  // Twenty frames in 400 ms is a third of a 60 Hz page; anything slower is
  // the gate watching a stopped loop, not the loop running slowly.
  requireThat(sample.first.theme && sample.first.theme === sample.last.theme &&
    sample.first.running && sample.last.running && sample.last.contextLost === false &&
    sample.last.frames > sample.first.frames + 20 && sample.first.hash !== sample.last.hash,
  `${label}: the page field stopped drawing, or drew the same picture twice: ${JSON.stringify(sample)}`)
  // The reflected copy is a second renderer. It must draw the page canvas's
  // published second, and a still page must not reclone itself per frame.
  // One reclone can still follow a real event — the panel click that resumed
  // the page raises a window pointerup — so the bound is two, not zero. The
  // CSS poster this replaced recloned on every animation frame.
  const reclones = sample.last.sourceRevision - sample.first.sourceRevision
  requireThat(sample.unreflected === 0 && sample.maxClockError <= 1 &&
    sample.last.time > sample.first.time + 0.1 &&
    sample.last.backgroundTheme === sample.last.theme &&
    sample.last.generation > sample.first.generation && reclones <= 2,
  `${label}: the reflected field lost the page's clock or the page recloned: ${JSON.stringify(sample)}`)
}

function waitForField(page, theme) {
  return page.waitForFunction((theme) => {
    const field = window.__marbleBackground
    const background = document.querySelector('.mh-app > .mh-sheet .mh-background')
    const environment = window.__r3f?.scene.environment
    return Boolean(field) && field.theme === theme && field.running && !field.contextLost &&
      field.frames > 0 && background?.getAttribute('data-visualization') === theme &&
      environment?.userData.captureKind === 'full-page' &&
      environment.userData.backgroundTheme === theme
  }, { timeout: 10_000 }, theme)
}

async function verifyPausedField(page, id) {
  await setPageMotion(page, true)
  await selectTheme(page, id)
  await waitForField(page, id)
  await setPageMotion(page, false)
  requireThat((await readColorMotion(page)).state === 'paused',
    `${id}: theme selection discarded Pause color`)
  await settleReflection(page)
  const paused = await sampleColorMotion(page)
  requireThat(paused.first.running === false && paused.first.frames === paused.last.frames &&
    paused.first.time === paused.last.time && paused.first.hash === paused.last.hash &&
    paused.last.backgroundTime === paused.last.time && paused.last.backgroundTheme === id &&
    paused.first.generation === paused.last.generation && paused.maxClockError === 0,
  `${id}: Pause color did not hold the page and its reflection: ${JSON.stringify(paused)}`)
  // Wall time keeps running while the page does not. A clock that resumed
  // from performance.now() would owe this whole second back in one frame.
  const held = paused.last.time
  await new Promise((resolve) => setTimeout(resolve, 1_000))
  requireThat((await readColorMotion(page)).time === held,
    `${id}: a paused field clock advanced with wall time`)
  const startedAt = Date.now()
  await setPageMotion(page, true)
  const resumedAt = await readColorMotion(page)
  const wall = (Date.now() - startedAt) / 1000
  requireThat(resumedAt.time > held && resumedAt.time - held <= wall + 0.05,
    `${id}: resume did not continue from the held second: ${JSON.stringify({ held, resumedAt, wall })}`)
  const resumed = await sampleColorMotion(page)
  requireMoving(resumed, `${id} resumed`)
  await setPageMotion(page, false)
  return { paused, resumed, held }
}

async function verifyReducedField(page, id) {
  await selectTheme(page, id)
  await page.waitForFunction((still) => window.__marbleBackground?.running === false &&
    window.__marbleBackground.time === still, { timeout: 5_000 }, MARBLE_BACKGROUND_REDUCED_TIME)
    .catch(async () => {
      throw new Error(`${id}: reduced motion kept the field moving: ${JSON.stringify(await readColorMotion(page))}`)
    })
  await settleReflection(page)
  const reduced = await sampleColorMotion(page)
  requireThat(reduced.first.frames === reduced.last.frames && reduced.first.running === false &&
    reduced.first.time === MARBLE_BACKGROUND_REDUCED_TIME &&
    reduced.last.time === MARBLE_BACKGROUND_REDUCED_TIME &&
    reduced.first.hash === reduced.last.hash &&
    reduced.last.backgroundTime === MARBLE_BACKGROUND_REDUCED_TIME &&
    reduced.first.generation === reduced.last.generation,
  `${id}: reduced motion still moved the field or its reflection: ${JSON.stringify(reduced)}`)
  return reduced
}

async function verifyThemeKeyboard(page) {
  await page.focus('.mh-app > .mh-sheet [data-theme-option="waves"]')
  for (const [index, theme] of themes.entries()) {
    if (index > 0) await page.keyboard.press('Tab')
    const clicks = await readThemeClickCount(page)
    await page.keyboard.press(index % 2 ? 'Space' : 'Enter')
    await requireTheme(page, theme.id)
    requireThat(await readThemeClickCount(page) === clicks + 1 &&
      await page.$eval(`.mh-app > .mh-sheet [data-theme-option="${theme.id}"]`,
        (button) => document.activeElement === button),
    `${theme.id}: keyboard activation did not keep native button focus or produce one click`)
  }
}

async function verifyColorMotion(page) {
  await page.evaluate(() => document.fonts.ready)
  const canvas = await readFieldCanvas(page)
  // One live field canvas in the page, one blank clone in the capture. The
  // clone is the whole reason the reflection has to draw the shader itself.
  requireThat(canvas.canvas && canvas.context && canvas.lost === false && !canvas.fallback &&
    canvas.width >= canvas.cssWidth && canvas.cssWidth > 1000 && canvas.copies === 1,
  `the page field canvas is missing, blank, or fell back to CSS: ${JSON.stringify(canvas)}`)

  const results = []
  for (const theme of themes) {
    await selectTheme(page, theme.id)
    await setPageMotion(page, true)
    await waitForField(page, theme.id)
    const moving = await sampleColorMotion(page)
    requireMoving(moving, theme.id)
    // Re-select the current theme through a real button. Its native state
    // update must not restart the field's clock or reclone the page.
    const before = await readColorMotion(page)
    await selectTheme(page, theme.id)
    const afterInput = await sampleColorMotion(page)
    requireMoving(afterInput, `${theme.id} after native input`)
    requireThat(afterInput.first.time >= before.time,
      `${theme.id}: native input restarted the field clock: ${JSON.stringify({ before, afterInput })}`)
    results.push({ id: theme.id, moving, afterInput })
  }

  for (const result of results) {
    Object.assign(result, await verifyPausedField(page, result.id))
    if (!artifactDirectory) continue
    await mkdir(artifactDirectory, { recursive: true })
    await page.mouse.move(viewport.width * 0.53, viewport.height * 0.42)
    await nextPaint(page)
    await page.screenshot({ path: path.join(artifactDirectory, `theme-${result.id}-desktop.png`) })
  }

  await setPageMotion(page, true)
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await setPanelOpen(page, true)
  await page.waitForFunction((panelSelector) => {
    const button = document.querySelector(`${panelSelector} [data-marble-motion-toggle]`)
    return button?.disabled && button.textContent.includes('Motion off')
  }, { timeout: 5_000 }, panelSelector)
  await setPanelOpen(page, false)
  for (const result of results) result.reduced = await verifyReducedField(page, result.id)
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
  await setPanelOpen(page, true)
  await page.waitForFunction((panelSelector) =>
    document.querySelector(`${panelSelector} [data-marble-motion-toggle]`)?.disabled === false,
  { timeout: 5_000 }, panelSelector)
  await setPanelOpen(page, false)
  await waitForField(page, results[results.length - 1].id)
  await setPageMotion(page, false)
  await verifyThemeKeyboard(page)
  await selectTheme(page, 'waves')
  return results
}

async function verifyMobileLayout(page) {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
  await nextPaint(page)
  const layouts = []
  for (const theme of themes) {
    await selectTheme(page, theme.id)
    const layout = await page.evaluate(() => {
      const sheet = document.querySelector('.mh-app > .mh-sheet')
      const heading = sheet.querySelector('h1').getBoundingClientRect()
      const controls = [...sheet.querySelectorAll('.mh-theme-button')]
        .map((element) => {
          const box = element.getBoundingClientRect()
          return { text: element.textContent.trim(), left: box.left, right: box.right, width: box.width, height: box.height }
        })
      return {
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        sheet: sheet.scrollWidth,
        heading: { left: heading.left, right: heading.right },
        controls,
      }
    })
    requireThat(layout.document <= layout.viewport && layout.sheet <= layout.viewport &&
      layout.heading.left >= 0 && layout.heading.right <= layout.viewport &&
      layout.controls.every((control) => control.left >= 0 && control.right <= layout.viewport &&
        control.width >= 24 && control.height >= 24),
    `390px poster layout overflowed or hid its native controls: ${JSON.stringify(layout)}`)
    if (artifactDirectory) {
      await mkdir(artifactDirectory, { recursive: true })
      await page.screenshot({ path: path.join(artifactDirectory, `theme-${theme.id}-mobile.png`), fullPage: true })
    }
    layouts.push({ id: theme.id, ...layout })
  }
  await page.setViewport(viewport)
  await nextPaint(page)
  await selectTheme(page, 'waves')
  return layouts
}

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
  'keyIntensity', 'envMapIntensity', 'pageLightIntensity', 'roomBounce', 'reflectionFps',
  'strokeWidthPx', 'strokeOpacity', 'poseDamping', 'velocityTilt', 'maxTilt', 'maxSpin',
  'pressPitch', 'ambientIntensity', 'lightX', 'lightY', 'lightZ', 'exposure', 'shadowIntensity', 'shadowRadius']
const chromePanelKeys = panelKeys.map((key) =>
  key === 'roughness' ? 'chromeRoughness' : key === 'envMapIntensity' ? 'chromeReflectionIntensity' : key)
const panelSections = ['Orientation', 'Size & height', 'Movement', 'Idle tap', 'Pinch', 'Marble', 'Stroke', 'Reflections', 'Lighting', 'Shadows']

function numberSelector(key) {
  return `${panelSelector} input[data-tuning-key="${key}"][type="number"]`
}

function readPanelNumbers(page, keys = panelKeys) {
  return page.evaluate((rootSelector, keys) => {
    const root = document.querySelector(rootSelector)
    return Object.fromEntries(keys.map((key) => {
      const input = root?.querySelector(`input[data-tuning-key="${key}"][type="number"]`)
      if (!(input instanceof HTMLInputElement)) throw new Error(`missing numeric control ${key}`)
      return [key, Number(input.value)]
    }))
  }, panelSelector, keys)
}

function requireAuthoredPanelNumbers(values, label) {
  for (const [key, value] of Object.entries(values)) {
    const control = MARBLE_HAND_GROUPS.flatMap((group) => group.controls).find((item) => item.key === key)
    requireThat(control, `${label}: missing authored control ${key}`)
    const decimals = control.step.toString().split('.')[1]?.length ?? 0
    const expected = Number((authoredTuning[key] * (control.degrees ? 180 / Math.PI : 1)).toFixed(decimals))
    requireThat(value === expected, `${label}: ${key} showed ${value}, expected authored ${expected}`)
  }
}

function readPanelScene(page) {
  return page.evaluate(() => {
    const scene = window.__r3f?.scene
    const hand = scene?.getObjectByName('marble-hand-sculpture')
    const group = scene?.getObjectByName('marble-hand-pointer')
    const key = scene?.getObjectByName('marble-hand-key-light')
    const ambient = scene?.children.find((object) => object.type === 'AmbientLight')
    const pageLights = ['waves', 'checker', 'prism']
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
      ambientIntensity: ambient?.intensity,
      lightX: key.position.x,
      lightY: key.position.y,
      lightZ: key.position.z,
      exposure: window.__r3f.gl.toneMappingExposure,
      shadowIntensity: key.shadow.intensity,
      shadowRadius: key.shadow.radius,
      pageLightTotal: pageLights.reduce((sum, light) => sum + light.intensity, 0),
      height: group.position.z,
    }
  })
}

async function observeThemeClicks(page) {
  const counter = await page.evaluateHandle(() => {
    const clicks = { count: 0 }
    document.querySelector('.mh-app > .mh-sheet').addEventListener('click', (event) => {
      if (event.isTrusted && event.target instanceof Element && event.target.closest('.mh-theme-button')) clicks.count++
    })
    return clicks
  })
  nativeThemeClicks.set(page, counter)
}

function readThemeClickCount(page) {
  const counter = nativeThemeClicks.get(page)
  if (!counter) throw new Error('native theme clicks are not observed by this instrument')
  return page.evaluate((clicks) => clicks.count, counter)
}

function readTheme(page, id) {
  return page.evaluate((id) => {
    const sheet = document.querySelector('.mh-app > .mh-sheet')
    const button = sheet.querySelector(`.mh-theme-button[data-theme-option="${id}"]`)
    if (!(button instanceof HTMLButtonElement)) throw new Error(`missing native theme ${id}`)
    const box = button.getBoundingClientRect()
    const x = box.left + box.width / 2
    const y = box.top + box.height / 2
    const hit = document.elementFromPoint(x, y)
    return {
      x,
      y,
      directHit: hit === button || button.contains(hit),
    }
  }, id)
}

async function requireTheme(page, id) {
  await page.waitForFunction((id) => {
    const sheet = document.querySelector('.mh-app > .mh-sheet')
    const copy = document.querySelector('[data-marble-page-capture] .mh-sheet')
    const buttons = sheet?.querySelectorAll('.mh-themes[aria-label="Background themes"] .mh-theme-button')
    const active = sheet?.querySelectorAll('.mh-theme-button[aria-pressed="true"]')
    return sheet?.getAttribute('data-theme') === id &&
      buttons?.length === 3 && [...buttons].every((button) =>
        ['true', 'false'].includes(button.getAttribute('aria-pressed'))) &&
      sheet.querySelector('.mh-background')?.getAttribute('data-visualization') === id &&
      active?.length === 1 && active[0].getAttribute('data-theme-option') === id &&
      (!copy || copy.getAttribute('data-theme') === id &&
        copy.querySelector('.mh-background')?.getAttribute('data-visualization') === id)
  }, { timeout: 5_000 }, id).catch(() => { throw new Error(`${id}: native theme selection did not reach both copies`) })
  await nextPaint(page)
}

async function selectTheme(page, id) {
  let reopenPanel = false
  let target = await readTheme(page, id)
  if (!target.directHit && await page.$(`aside${panelSelector}`)) {
    await page.click(`${panelSelector} [aria-label="Close hand controls"]`)
    await page.waitForSelector(`aside${panelSelector}`, { hidden: true, timeout: 5_000 })
    reopenPanel = true
    target = await readTheme(page, id)
  }
  requireThat(target.directHit, `${id}: native theme button is blocked`)
  const clicks = await readThemeClickCount(page)
  const revision = await page.evaluate(() => window.__r3f?.scene.environment?.userData.sourceRevision)
  await page.mouse.click(target.x, target.y)
  await requireTheme(page, id)
  requireThat(await readThemeClickCount(page) === clicks + 1 &&
    await page.$eval(`.mh-app > .mh-sheet [data-theme-option="${id}"]`,
      (button) => document.activeElement === button),
  `${id}: one native click did not keep button focus or produced duplicate events`)
  if (Number.isFinite(revision)) {
    await page.waitForFunction((revision) => {
      const environment = window.__r3f?.scene.environment
      return environment.userData.captureKind !== 'full-page' || environment.userData.sourceRevision > revision
    }, { timeout: 5_000 }, revision)
  }
  if (reopenPanel) {
    await clickText(page, 'button', 'Tweak hand', '')
    await page.waitForSelector(`aside${panelSelector}`, { visible: true, timeout: 5_000 })
  }
}

async function requireNativePage(page, label) {
  await page.waitForSelector('[data-marble-page-capture] .mh-sheet[data-marble-reflection-copy]', { timeout: 30_000 })
  const sample = await page.evaluate(() => {
    const receiver = window.__r3f.scene.getObjectByName('marble-hand-shadow-receiver')
    const capture = document.querySelector('[data-marble-page-capture]')
    const removed = '.mh-masthead, .mh-kicker, .mh-deck, .mh-status, .mh-footer, .mh-capture-notice, [data-marble-motion-toggle], [data-marble-reflection-notice]'
    let pagePresenters = 0
    window.__r3f.scene.traverse((object) => {
      if (object.material?.map?.name === 'marble-hand-native-page') pagePresenters++
    })
    return {
      sheets: document.querySelectorAll('.mh-app > .mh-sheet').length,
      copies: document.querySelectorAll('.mh-sheet[data-marble-reflection-copy]').length,
      sources: document.querySelectorAll('[data-munari-source-host], [data-marble-page-capture]').length,
      inertCapture: capture?.inert === true && capture.getAttribute('aria-hidden') === 'true',
      removedNative: document.querySelector('.mh-app > .mh-sheet').querySelectorAll(removed).length,
      removedCapture: capture?.querySelectorAll(removed).length,
      pagePresenters,
      canvasPointerEvents: getComputedStyle(window.__r3f.gl.domElement).pointerEvents,
      shadowOnly: receiver?.material?.isShadowMaterial === true && !receiver.material.map,
    }
  })
  requireThat(sample.sheets === 1 && sample.copies === 1 && sample.sources === 1 && sample.inertCapture &&
    sample.pagePresenters === 0 && sample.canvasPointerEvents === 'none' && sample.shadowOnly &&
    sample.removedNative === 0 && sample.removedCapture === 0,
    `${label}: page is not one native sheet under a clear overlay: ${JSON.stringify(sample)}`)
}

async function selectNativeText(page) {
  const points = await page.$eval('.mh-app > .mh-sheet h1', (heading) => {
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT)
    const nodes = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent.trim()) nodes.push(node)
    }
    if (nodes.length < 2) throw new Error('native heading no longer spans both sides of its line break')
    const startNode = nodes[0]
    const endNode = nodes.at(-1)
    const start = startNode.textContent.search(/\S/)
    const end = endNode.textContent.trimEnd().length
    const first = document.createRange()
    first.setStart(startNode, start)
    first.setEnd(startNode, start + 1)
    const last = document.createRange()
    last.setStart(endNode, end - 1)
    last.setEnd(endNode, end)
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
  // The press landed on the heading's text, so the thumb and index must be
  // closing while the drag is still down. The spring needs a few frames.
  await page.waitForFunction(() => {
    const bend = window.__r3f.scene.getObjectByName('marble-hand-sculpture')
      .userData.marbleHandTap.uTapBend.value
    return bend[3] > 0.1 && bend[4] > 0.08
  }, { timeout: 3_000 }).catch(() => { throw new Error('selection drag did not close the pinch') })
  await page.mouse.up()
  const selected = await page.evaluate(() => {
    const selection = window.getSelection()
    const heading = document.querySelector('.mh-app > .mh-sheet h1')
    return {
      text: selection?.toString().trim() ?? '',
      native: Boolean(selection?.anchorNode && selection?.focusNode &&
        heading.contains(selection.anchorNode) && heading.contains(selection.focusNode) &&
        selection.anchorNode !== selection.focusNode),
    }
  })
  requireThat(selected.native && selected.text.length >= 10,
    `native text selection failed: ${JSON.stringify(selected)}`)
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  // Released: both pinch joints return to exactly rest (the spring floors
  // at zero), so the later stillness clause reads an unbent hand.
  await page.waitForFunction(() => window.__r3f.scene
    .getObjectByName('marble-hand-sculpture').userData.marbleHandTap.uTapBend.value
    .every((bend) => bend === 0), { timeout: 3_000 })
    .catch(() => { throw new Error('the pinch never reopened after the selection released') })
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

async function setPanelOpen(page, open) {
  const current = Boolean(await page.$(`aside${panelSelector}`))
  if (current === open) return
  if (open) await clickText(page, 'button', 'Tweak hand', '')
  else await page.click(`${panelSelector} [aria-label="Close hand controls"]`)
  await page.waitForSelector(`aside${panelSelector}`, { visible: open, hidden: !open, timeout: 5_000 })
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

async function setPanelCheckbox(page, text, checked) {
  if ((await readPanelCheckbox(page, text)).checked !== checked) await togglePanelCheckbox(page, text)
}

async function setPanelColor(page, label, value) {
  // Native color dialogs are OS UI. Dispatch the color input's own edit
  // event instead; this still exercises the mounted panel's React handler.
  await page.$eval(panelSelector, (root, label, value) => {
    const input = [...root.querySelectorAll('input[type="color"]')].find((node) =>
      [...node.labels].some((item) => item.textContent.trim().startsWith(label)))
    if (!(input instanceof HTMLInputElement)) throw new Error(`missing color control ${label}`)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, label, value)
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
      const ambient = scene?.children.find((object) => object.type === 'AmbientLight')
      const pageLights = ['waves', 'checker', 'prism']
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
        ambientIntensity: ambient?.intensity,
        lightX: key.position.x,
        lightY: key.position.y,
        lightZ: key.position.z,
        exposure: window.__r3f.gl.toneMappingExposure,
        shadowIntensity: key.shadow.intensity,
        shadowRadius: key.shadow.radius,
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
  await requireTheme(page, 'waves')
  await setPageMotion(page, false)
  // Keep direct page lights out of the optical clause. The native heading
  // never enters this framebuffer, so changed opaque hand pixels can then
  // come only from its page-derived environment, not from a repainted page.
  await setPanelNumber(page, 'envMapIntensity', 3)
  await setPanelNumber(page, 'roughness', 0.1)
  await setPanelNumber(page, 'pageLightIntensity', 0)
  await page.waitForFunction(() => {
    const scene = window.__r3f?.scene
    const hand = scene?.getObjectByName('marble-hand-sculpture')
    const lights = ['waves', 'checker', 'prism']
      .map((id) => scene?.getObjectByName(`marble-hand-page-light-${id}`))
    return hand?.material.envMapIntensity === 3 && hand.material.roughness === 0.1 &&
      lights.every((light) => light && light.intensity === 0)
  }, { timeout: 5_000 })

  const result = await page.evaluate(async () => {
    const state = window.__r3f
    const renderer = state.gl
    const scene = state.scene
    // The field moved into a canvas the copy cannot carry, so the native
    // edit this clause needs is ordinary DOM: the heading's own ink.
    const heading = document.querySelector('.mh-app > .mh-sheet .mh-intro h1')
    if (!(heading instanceof HTMLElement)) throw new Error('missing native heading')
    const previousInk = heading.style.color
    const previousColor = getComputedStyle(heading).color
    const replacement = '#18d97c'
    const stamp = () => {
      const environment = scene.environment
      if (environment?.name !== 'marble-hand-page-environment' || environment.userData.captureKind !== 'full-page') return null
      return {
        generation: environment.userData.generation ?? environment.userData.captureRevision,
        revision: environment.userData.sourceRevision,
        signature: environment.userData.captureRevision,
      }
    }
    const colorMatches = (expected) => {
      const copy = document.querySelector('[data-marble-page-capture] .mh-intro h1')
      return copy && getComputedStyle(copy).color === expected
    }
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
      heading.style.color = replacement
      const expectedColor = getComputedStyle(heading).color
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
      heading.style.color = previousInk
      await until(() => stamp()?.signature > changedCapture && colorMatches(previousColor),
        'restored native heading')
    }
  })
  // Four channel counts reject ordinary one-count GPU rounding. Plain Chrome
  // measured 1,281 changed opaque pixels and a 42-count peak on 2026-08-30.
  // The heading is 288px type across half the page, so it is the largest
  // opaque thing the capture still carries now that the field is a canvas.
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
      environmentIntensity: state.scene.environmentIntensity,
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

async function verifyThemeReflections(page) {
  await setPageMotion(page, false)
  await selectHandMaterial(page, 'chrome')
  await openPanelSection(page, 'Chrome')
  await setPanelNumber(page, 'chromeRoughness', 0.12)
  await openPanelSection(page, 'Lighting')
  await setPanelNumber(page, 'pageLightIntensity', 0)
  await openPanelSection(page, 'Stroke')
  await setPanelCheckbox(page, 'Show stroke', false)
  const samples = []
  const comparisons = []
  try {
    for (const theme of themes) {
      await selectTheme(page, theme.id)
      // Reaching the last button briefly closes the panel and un-parks the
      // hand. Its press/tilt damping must finish before optical comparison.
      await page.waitForFunction((height, rotation) => {
        const group = window.__r3f.scene.getObjectByName('marble-hand-pointer')
        return Math.abs(group.position.z - height) < 0.0001 &&
          Math.abs(group.rotation.x) < 0.000001 && Math.abs(group.rotation.y) < 0.000001 &&
          Math.abs(group.rotation.z - rotation) < 0.000001
      }, { timeout: 5_000 }, authoredTuning.heightPx, authoredTuning.baseRotation)
      await page.evaluate(() => new Promise((resolve, reject) => {
        let previous = -1
        let stable = 0
        const deadline = performance.now() + 5_000
        const tick = () => {
          const data = window.__r3f.scene.environment?.userData
          const generation = data?.generation
          stable = data?.captureKind === 'full-page' && generation === previous ? stable + 1 : 0
          previous = generation
          if (stable >= 8) resolve()
          else if (performance.now() >= deadline) reject(new Error('theme reflection did not settle'))
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }))
      const source = await page.evaluateHandle(() => {
        const canvas = document.querySelector('[data-marble-page-capture]').closest('canvas')
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
        return { width: canvas.width, height: canvas.height, pixels }
      })
      const hand = await captureMaterialFrame(page)
      const material = await readHandMaterial(page)
      requireThat((await readPanelScene(page)).pageLightTotal === 0 && material.roughness === 0.12 &&
        material.name === 'marble-hand-mirrored-chrome' && !(await readPanelCheckbox(page, 'Show stroke')).checked,
      `${theme.id}: theme selection changed the isolated optical setup`)
      const prior = [...samples]
      samples.push({ id: theme.id, source, hand, material })
      for (const previous of prior) {
        requireThat(previous.material.mesh === material.mesh && previous.material.geometry === material.geometry &&
          previous.material.pose.every((value, index) => Math.abs(value - material.pose[index]) < 0.001),
        `${previous.id} → ${theme.id} moved the optical reference hand`)
        const sourcePixels = await compareHandFrames(page, previous.source, source)
        const handPixels = await compareHandFrames(page, previous.hand, hand)
        // Theme changes must reach a large part of the actual page raster,
        // then the opaque hand with page lights and its stroke disabled.
        // Different labels alone cannot satisfy this 8%-of-page floor.
        requireThat(sourcePixels.changedPixels >= sourcePixels.opaquePixels * 0.08 && sourcePixels.maxDelta >= 32,
          `${previous.id} and ${theme.id} are not distinct page visuals: ${JSON.stringify(sourcePixels)}`)
        requireThat(handPixels.changedPixels >= 100 && handPixels.maxDelta >= 8,
          `${previous.id} → ${theme.id} did not change reflected hand pixels: ${JSON.stringify(handPixels)}`)
        comparisons.push({ from: previous.id, to: theme.id, source: sourcePixels, hand: handPixels })
      }
    }
    return comparisons
  } finally {
    for (const sample of samples) {
      await sample.source.dispose()
      await sample.hand.dispose()
    }
    await selectTheme(page, 'waves')
    await clickText(page, 'button', 'Reset all')
  }
}

/**
 * One overlay frame, read straight out of the default framebuffer, plus the
 * live bend angles and the projected index tip from that same draw. The
 * changed count compares against the previous call, so two calls with an
 * interval between them measure exactly what moved in that interval.
 */
function tapFrame(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const renderer = window.__r3f.gl
    const original = renderer.render
    const timer = setTimeout(() => {
      renderer.render = original
      reject(new Error('no default-framebuffer draw for tap sample'))
    }, 5_000)
    renderer.render = function (scene, camera) {
      try {
        original.call(this, scene, camera)
        if (this.getRenderTarget() !== null) return
        renderer.render = original
        clearTimeout(timer)
        const context = this.getContext()
        const width = context.drawingBufferWidth
        const height = context.drawingBufferHeight
        const pixels = new Uint8Array(width * height * 4)
        context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels)
        const previous = window.__marbleTapFrame
        let hash = 2166136261
        let changed = null
        if (previous?.length === pixels.length) changed = 0
        for (let offset = 0; offset < pixels.length; offset += 4) {
          hash = Math.imul(hash ^ pixels[offset], 16777619)
          hash = Math.imul(hash ^ pixels[offset + 3], 16777619)
          if (changed === null) continue
          const delta = Math.max(
            Math.abs(previous[offset] - pixels[offset]),
            Math.abs(previous[offset + 1] - pixels[offset + 1]),
            Math.abs(previous[offset + 2] - pixels[offset + 2]),
            Math.abs(previous[offset + 3] - pixels[offset + 3]),
          )
          if (delta >= 8) changed++
        }
        window.__marbleTapFrame = pixels
        const hand = window.__r3f.scene.getObjectByName('marble-hand-sculpture')
        const tip = hand.position.clone().set(0, 0, 0)
          .applyMatrix4(hand.matrixWorld).project(window.__r3f.camera)
        const rect = renderer.domElement.getBoundingClientRect()
        resolve({
          hash: hash >>> 0,
          changed,
          bend: [...hand.userData.marbleHandTap.uTapBend.value],
          tip: {
            x: rect.left + (tip.x + 1) * rect.width / 2,
            y: rect.top + (1 - tip.y) * rect.height / 2,
          },
        })
      } catch (error) {
        renderer.render = original
        clearTimeout(timer)
        reject(error)
      }
    }
  }))
}

function readTapBend(page) {
  return page.evaluate(() => [...window.__r3f.scene
    .getObjectByName('marble-hand-sculpture').userData.marbleHandTap.uTapBend.value])
}

function waitForTapRest(page, timeout) {
  return page.waitForFunction(() => window.__r3f.scene
    .getObjectByName('marble-hand-sculpture').userData.marbleHandTap.uTapBend.value
    .every((bend) => bend < 0.01), { timeout })
}

// Re-sending the pointer to the same screen point is still a pointer move:
// it resets the idle clock without giving the rocking a new target, so the
// pose can damp to a standstill while the drum stays away.
async function holdPointerStill(page, at, ms) {
  const until = Date.now() + ms
  do {
    await page.mouse.move(at.x, at.y)
    await nextPaint(page)
  } while (Date.now() < until)
}

async function verifyIdleTap(page) {
  // Plain paper, clear of every theme button and of the panel's edge.
  const at = { x: Math.round(viewport.width * 0.6), y: Math.round(viewport.height * 0.3) }
  await setPageMotion(page, false)
  // The joint springs decay to an exact clamped zero, but not in one frame.
  await page.waitForFunction(() => window.__r3f.scene
    .getObjectByName('marble-hand-sculpture').userData.marbleHandTap.uTapBend.value
    .every((bend) => bend === 0), { timeout: 3_000 })
  await page.mouse.move(at.x, at.y)
  await nextPaint(page)
  const moving = await readTapBend(page)
  requireThat(moving.length === 5 && moving.every((bend) => bend === 0),
    `tap: the hand was still bent right after a pointer move: ${JSON.stringify(moving)}`)

  const askedAt = Date.now()
  await page.waitForFunction(() => window.__r3f.scene
    .getObjectByName('marble-hand-sculpture').userData.marbleHandTap.uTapBend.value
    .some((bend) => bend > 0.05), { timeout: authoredTuning.tapIdleDelayMs + 5_000 })
  const startedAfter = Date.now() - askedAt
  requireThat(startedAfter >= authoredTuning.tapIdleDelayMs * 0.75,
    `tap: drumming began after only ${startedAfter}ms of rest`)

  // Three moments a third of a period apart. A hand that never leaves its
  // rest pose returns one hash for all three.
  const samples = []
  await tapFrame(page)
  for (let index = 0; index < 3; index++) {
    await new Promise((resolve) => setTimeout(resolve, authoredTuning.tapPeriodMs / 3))
    samples.push(await tapFrame(page))
  }
  const hashes = new Set(samples.map((sample) => sample.hash))
  requireThat(hashes.size >= 2,
    `tap: the overlay drew identical pixels through a whole cycle: ${JSON.stringify(samples.map((s) => s.bend))}`)
  // A third of a period apart the cycle moves about 1300 of the overlay's
  // 1.15M pixels (measured 2026-08-31). The floor is a quarter of that, so a
  // finger that only quivers still fails.
  const drumChanged = Math.max(...samples.map((sample) => sample.changed))
  requireThat(drumChanged >= 300,
    `tap: only ${drumChanged} overlay pixels moved across a cycle`)
  let tipDrift = 0
  for (const first of samples) {
    for (const second of samples) {
      tipDrift = Math.max(tipDrift, Math.hypot(first.tip.x - second.tip.x, first.tip.y - second.tip.y))
    }
  }
  requireThat(tipDrift <= 0.5, `tap: the index fingertip moved ${tipDrift.toFixed(3)}px while drumming`)

  await page.mouse.move(at.x + 40, at.y)
  const movedAt = Date.now()
  await waitForTapRest(page, 2_000)
  const stoppedAfter = Date.now() - movedAt
  // The 120ms fade drains the drum's amplitude, and the joint springs then
  // ride a sub-degree tail down to their clamped zero. The tail is beneath
  // a pixel almost immediately; this bound is on mathematical rest.
  requireThat(stoppedAfter <= 500, `tap: the fingers took ${stoppedAfter}ms to flatten after a 40px move`)
  const held = { x: at.x + 40, y: at.y }
  await holdPointerStill(page, held, 1_400)
  await tapFrame(page)
  await holdPointerStill(page, held, 260)
  const rest = await tapFrame(page)
  // Measures 0. The small allowance is for the rocking's own damping tail,
  // which can still flip an antialiased edge pixel long after it is invisible.
  requireThat(rest.bend.every((bend) => bend === 0) && rest.changed <= 20,
    `tap: the overlay kept moving with the pointer awake: ${JSON.stringify(rest)}`)

  // Opening the panel parks the hand, so un-park it again before the wait:
  // a parked hand reports flat fingers whatever the toggle says.
  await setPanelOpen(page, true)
  await openPanelSection(page, 'Idle tap')
  await setPanelCheckbox(page, 'Idle tapping', false)
  await setPanelCheckbox(page, 'Park hand', false)
  const clear = { x: Math.round(viewport.width * 0.3), y: Math.round(viewport.height * 0.3) }
  await page.mouse.move(clear.x, clear.y)
  await new Promise((resolve) => setTimeout(resolve, authoredTuning.tapIdleDelayMs + 400))
  const switched = await readTapBend(page)
  requireThat(switched.every((bend) => bend === 0),
    `tap: the panel switch did not stop the drum: ${JSON.stringify(switched)}`)
  await setPanelCheckbox(page, 'Idle tapping', true)
  await setPanelOpen(page, false)

  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  try {
    await page.mouse.move(at.x, at.y)
    await new Promise((resolve) => setTimeout(resolve, authoredTuning.tapIdleDelayMs + 400))
    const reduced = await readTapBend(page)
    requireThat(reduced.every((bend) => bend === 0),
      `tap: reduced motion still drummed: ${JSON.stringify(reduced)}`)
  } finally {
    await page.emulateMediaFeatures([])
  }
  await setPageMotion(page, true)
  return { startedAfter, stoppedAfter, drumChanged, tipDrift, restChanged: rest.changed, hashes: hashes.size }
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

function measureStrokeFrame(page, body, frame, dpr, widthPx, color = 'magenta') {
  return page.evaluate((body, frame, dpr, widthPx, color) => {
    if (body.width !== frame.width || body.height !== frame.height) throw new Error('stroke sample resized')
    const radius = Math.ceil((widthPx + 2) * dpr)
    const neighbors = []
    for (let y = -radius; y <= radius; y++) {
      for (let x = -radius; x <= radius; x++) neighbors.push({ x, y, squared: x * x + y * y })
    }
    neighbors.sort((a, b) => a.squared - b.squared)
    const distanceToBody = (x, y) => {
      for (const neighbor of neighbors) {
        const nx = x + neighbor.x
        const ny = y + neighbor.y
        if (nx < 0 || nx >= frame.width || ny < 0 || ny >= frame.height) continue
        if (body.pixels[(ny * frame.width + nx) * 4 + 3] >= 128) return Math.sqrt(neighbor.squared) / dpr
      }
      return null
    }
    const matchesColor = color === 'magenta'
      ? (r, g, b) => r > 15 && b > 15 && g < Math.min(r, b) * 0.2
      : (r, g, b) => g > 15 && r < g * 0.2 && b < g * 0.2
    const distances = []
    let bodyPixels = 0
    let strokePixels = 0
    let colorPixels = 0
    let peakAlpha = 0
    let unmatchedPixels = 0
    for (let offset = 0; offset < frame.pixels.length; offset += 4) {
      const r = frame.pixels[offset]
      const g = frame.pixels[offset + 1]
      const b = frame.pixels[offset + 2]
      const a = frame.pixels[offset + 3]
      const matches = matchesColor(r, g, b)
      if (matches && a >= 128) colorPixels++
      if (body.pixels[offset + 3] >= 128) { bodyPixels++; continue }
      if (!matches || a < 8) continue
      if (body.pixels[offset + 3] < 8) peakAlpha = Math.max(peakAlpha, a)
      if (a < 128) continue
      strokePixels++
      const pixel = offset / 4
      const x = pixel % frame.width
      const y = Math.floor(pixel / frame.width)
      const distance = distanceToBody(x, y)
      if (distance === null) unmatchedPixels++
      else distances.push(distance)
    }
    distances.sort((a, b) => a - b)
    return { bodyPixels: bodyPixels / dpr ** 2, strokePixels: strokePixels / dpr ** 2, colorPixels,
      peakAlpha, unmatchedPixels, widthPx: distances[Math.floor(distances.length * 0.95)] ?? 0 }
  }, body, frame, dpr, widthPx, color)
}

async function verifyStroke(page) {
  await clickText(page, 'button', 'Reset all')
  await openPanelSection(page, 'Stroke')
  requireThat((await readPanelCheckbox(page, 'Show stroke')).checked === authoredTuning.strokeEnabled,
    'stroke did not start at its authored visibility')
  const controls = await page.$$eval(`${panelSelector} input[data-tuning-key="strokeWidthPx"]`, (inputs) =>
    inputs.map((input) => ({ min: Number(input.min), max: Number(input.max), step: Number(input.step) })))
  requireThat(controls.length === 2 && controls.every((input) =>
    input.min === 0 && input.max === 12 && input.step === 0.25),
  `stroke controls lost their CSS-pixel range: ${JSON.stringify(controls)}`)
  await setPanelColor(page, 'Stroke color', '#ff00ff')
  await setPanelNumber(page, 'strokeOpacity', 1)
  await setPanelNumber(page, 'strokeWidthPx', 6)
  await openPanelSection(page, 'Shadows')
  await setPanelCheckbox(page, 'Cast shadows', false)
  await openPanelSection(page, 'Size & height')
  await setPanelCheckbox(page, 'Keep above page', false)
  const samples = []
  let body
  let frame
  try {
    // A 6px silhouette is broad enough to separate projection scaling from
    // one raster edge. The object grows by about 25% between these depths;
    // a world-space shell would grow with it. DPR must not double CSS width.
    for (const dpr of [1, 2]) {
      await page.setViewport({ ...viewport, width: viewport.width + dpr - 1, deviceScaleFactor: dpr })
      await page.waitForFunction((dpr) => window.__r3f.gl.getPixelRatio() === dpr,
        { timeout: 5_000 }, dpr)
      for (const height of [4, 240]) {
        await setPanelNumber(page, 'heightPx', height)
        await waitForPanelScene(page, { height }, 'stroke distance')
        await openPanelSection(page, 'Stroke')
        await setPanelCheckbox(page, 'Show stroke', false)
        body = await captureMaterialFrame(page)
        const disabled = await measureStrokeFrame(page, body, body, dpr, 6)
        requireThat(disabled.colorPixels === 0 && disabled.peakAlpha === 0,
          `disabled stroke still drew colored pixels: ${JSON.stringify(disabled)}`)
        await setPanelCheckbox(page, 'Show stroke', true)
        frame = await captureMaterialFrame(page)
        const sample = { dpr, height, ...await measureStrokeFrame(page, body, frame, dpr, 6) }
        requireThat(sample.strokePixels > 500 && sample.unmatchedPixels === 0 &&
          Math.abs(sample.widthPx - 6) <= 0.75,
        `stroke did not draw a 6 CSS-pixel silhouette: ${JSON.stringify(sample)}`)
        samples.push(sample)
        await frame.dispose()
        frame = null
        await body.dispose()
        body = null
      }
    }
    const widths = samples.map((sample) => sample.widthPx)
    requireThat(Math.max(...widths) - Math.min(...widths) <= 0.75,
      `stroke thickness changed with distance or DPR: ${JSON.stringify(samples)}`)
    for (const dpr of [1, 2]) {
      const far = samples.find((sample) => sample.dpr === dpr && sample.height === 4)
      const near = samples.find((sample) => sample.dpr === dpr && sample.height === 240)
      requireThat(near.bodyPixels > far.bodyPixels * 1.35,
        `distance proof did not enlarge the actual hand: ${JSON.stringify({ far, near })}`)
    }

    await setPanelCheckbox(page, 'Show stroke', false)
    body = await captureMaterialFrame(page)
    await setPanelCheckbox(page, 'Show stroke', true)
    await setPanelNumber(page, 'strokeWidthPx', 3)
    frame = await captureMaterialFrame(page)
    const narrow = await measureStrokeFrame(page, body, frame, 2, 3)
    requireThat(narrow.strokePixels > 200 && Math.abs(narrow.widthPx - 3) <= 0.75,
      `stroke width control did not narrow the actual edge: ${JSON.stringify(narrow)}`)
    await frame.dispose()
    frame = null
    await setPanelColor(page, 'Stroke color', '#00ff00')
    await setPanelNumber(page, 'strokeOpacity', 0.25)
    await selectHandMaterial(page, 'marble')
    frame = await captureMaterialFrame(page)
    const translucent = await measureStrokeFrame(page, body, frame, 2, 3, 'green')
    requireThat(translucent.peakAlpha >= 55 && translucent.peakAlpha <= 70,
      `stroke color/opacity did not survive Marble mode: ${JSON.stringify(translucent)}`)
    await page.evaluate(() => navigator.clipboard.writeText('marble-hand-stroke-empty'))
    await clickText(page, 'button', 'Copy settings')
    const copied = await page.evaluate(async () => {
      const payload = JSON.parse(await navigator.clipboard.readText())
      if (!payload?.marbleHand) {
        throw new Error('Copy settings did not write a marbleHand settings object')
      }
      return payload.marbleHand
    })
    requireThat(copied.strokeEnabled && copied.strokeColor === '#00ff00' &&
      copied.strokeWidthPx === 3 && copied.strokeOpacity === 0.25,
    `copy lost edited stroke settings: ${JSON.stringify(copied)}`)
    return { samples, narrow, translucent }
  } finally {
    await body?.dispose()
    await frame?.dispose()
    await page.setViewport(viewport)
    await nextPaint(page)
  }
}

async function verifyMirrorIntensity(page) {
  const previousFps = await page.$eval(numberSelector('reflectionFps'), (input) => Number(input.value))
  await openPanelSection(page, 'Reflections')
  await setPanelNumber(page, 'reflectionFps', 1)
  await openPanelSection(page, 'Chrome')
  const selector = numberSelector('chromeReflectionIntensity')
  const previous = await page.$eval(selector, (input) => Number(input.value))
  const stamp = () => page.evaluate(() => ({
    texture: window.__r3f.scene.environment.uuid,
    generation: window.__r3f.scene.environment.userData.generation,
    intensity: window.__r3f.scene.environmentIntensity,
  }))
  const adjust = async (value) => {
    // Settle React's input draft before filling. Refocusing and filling in
    // one step can overwrite the new number with the previous draft.
    await page.focus(selector)
    await nextPaint(page)
    await page.locator(selector).fill(String(value))
    await page.keyboard.press('Tab')
    try {
      await page.waitForFunction((value) =>
        window.__r3f.scene.getObjectByName('marble-hand-sculpture').material.envMapIntensity === value,
      { timeout: 5_000 }, value)
    } catch {
      const actual = await page.$eval(selector, (input) => input.value)
      throw new Error(`Mirror reflection did not accept ${value}: field ${actual}, material ${JSON.stringify(await readHandMaterial(page))}`)
    }
    await nextPaint(page)
  }
  let before
  let after
  try {
    const previousMap = await stamp()
    await setPanelNumber(page, 'chromeReflectionIntensity', 0)
    // The trusted click queues a capture at window pointerup. Start just
    // after that bake, with a full second before another is permitted.
    await page.waitForFunction((generation) => {
      const environment = window.__r3f.scene.environment
      return environment?.userData.captureKind === 'full-page' && environment.userData.generation > generation
    }, { timeout: 5_000 }, previousMap.generation)
    const dark = await stamp()
    before = await captureMaterialFrame(page)
    await adjust(3)
    after = await captureMaterialFrame(page)
    const bright = await stamp()
    const pixels = await compareHandFrames(page, before, after)
    // On 2026-08-30 the material property moved while Three inherited the
    // scene environment at intensity 1: zero and three produced 0 changed
    // pixels. This clause measures the opaque hand, not the displayed value.
    requireThat(pixels.changedPixels >= 100 && pixels.maxDelta >= 8,
      `Mirror reflection changed its number but not the hand: ${JSON.stringify({ ...pixels, dark, bright })}`)
    requireThat(dark.intensity === 0 && bright.intensity === 3,
      `Mirror reflection did not reach the inherited environment: ${JSON.stringify({ dark, bright })}`)
    requireThat(dark.texture === bright.texture && dark.generation === bright.generation,
      `Mirror reflection needed another map bake: ${JSON.stringify({ dark, bright })}`)
    return { ...pixels, generation: dark.generation }
  } finally {
    await setPanelNumber(page, 'chromeReflectionIntensity', previous)
    await openPanelSection(page, 'Reflections')
    await setPanelNumber(page, 'reflectionFps', previousFps)
    await before?.dispose()
    await after?.dispose()
  }
}

async function verifyHeadingReflections(page) {
  await requireTheme(page, 'waves')
  await setPageMotion(page, false)
  await selectHandMaterial(page, 'chrome')
  await openPanelSection(page, 'Chrome')
  // Keep the H1 visibility floor on the polished finish measured on
  // 2026-08-30, independent of the user's softer startup preset.
  await setPanelNumber(page, 'chromeRoughness', 0.008)
  await setPanelNumber(page, 'chromeReflectionIntensity', 3)
  await page.waitForFunction(() => {
    const scene = window.__r3f.scene
    return scene.getObjectByName('marble-hand-sculpture').material.envMapIntensity === 3 &&
      scene.getObjectByName('marble-hand-sculpture').material.roughness === 0.008 &&
      ['waves', 'checker', 'prism'].every((id) => scene.getObjectByName(`marble-hand-page-light-${id}`).intensity === 0)
  }, { timeout: 5_000 })
  await togglePanelCheckbox(page, 'Park hand')
  const point = await page.$eval('.mh-app > .mh-sheet h1', (heading) => {
    const box = heading.getBoundingClientRect()
    const panel = document.querySelector('aside[data-marble-hand-controls]').getBoundingClientRect()
    return { x: Math.min(box.left + box.width * 0.55, panel.left - 160), y: box.top + box.height * 0.55 }
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
    chrome.metalness === 1 && chrome.clearcoat === 0 &&
    Math.abs(chrome.roughness - authoredTuning.chromeRoughness) < 0.000001 &&
    Math.abs(chrome.envMapIntensity - authoredTuning.chromeReflectionIntensity) < 0.000001 &&
    Math.abs(chrome.environmentIntensity - authoredTuning.chromeReflectionIntensity) < 0.000001 &&
    chrome.color === authoredTuning.chromeTint.toLowerCase() && chrome.compiled && !chrome.carrara,
  `Chrome did not render the authored metal preset: ${JSON.stringify(chrome)}`)
}

function requireRestoredMarble(restored, marble) {
  const fields = ['roughness', 'metalness', 'clearcoat', 'clearcoatRoughness', 'envMapIntensity', 'environmentIntensity',
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

    const intensity = await verifyMirrorIntensity(page)
    const restoredChrome = await readHandMaterial(page)
    requireThat(restoredChrome.environmentIntensity === authoredTuning.chromeReflectionIntensity,
      `Chrome reflection did not restore its intensity: ${JSON.stringify(restoredChrome)}`)
    await selectHandMaterial(page, 'marble')
    const restored = await readHandMaterial(page)
    requireRestoredMarble(restored, marble)
    requireThat(restored.environmentIntensity === savedSettings.envMapIntensity,
      `Marble did not restore its environment intensity: ${JSON.stringify(restored)}`)
    await openPanelSection(page, 'Marble')
    await openPanelSection(page, 'Lighting')
    return { ...pixels, intensity }
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
    await page.goto(`${origin}/?scene=marble-hand&framed`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector(panelSelector, { visible: true, timeout: 30_000 })
    await page.waitForSelector('.mh-app[data-live]', { timeout: 30_000 })
    await page.waitForFunction(() => Boolean(
      window.__r3f?.scene.getObjectByName('marble-hand-sculpture') &&
      window.__r3f?.scene.getObjectByName('marble-hand-key-light'),
    ), { timeout: 30_000 })
    await nextPaint(page)
    await requireNativePage(page, 'controls')
    await observeThemeClicks(page)
    // A moving background can change the hand by itself and satisfy an
    // H1, swatch, or intensity floor. Optical clauses need one fixed page.
    await setPageMotion(page, false)
    await page.waitForFunction((rotation) =>
      window.__r3f.scene.getObjectByName('marble-hand-pointer').rotation.z === rotation,
    { timeout: 5_000 }, authoredTuning.baseRotation)
    requireThat(authoredTuning.materialMode === 'chrome', 'the authored material default is not chrome')
    requireThat(await page.$eval(`${panelSelector} [data-hand-material="chrome"]`,
      (button) => button.getAttribute('aria-pressed') === 'true'), 'normal route did not start in Chrome mode')
    requireMirroredChrome(await readHandMaterial(page))

    clause = 'section defaults'
    const sections = await page.$eval(panelSelector, (panel) =>
      [...panel.querySelectorAll('details')].map((details) => ({
        name: details.querySelector('summary')?.textContent.replace(/\s+/g, ' ').trim(),
        open: details.open,
      })))
    for (const name of panelSections.map((name) => name === 'Marble' ? 'Chrome' : name)) {
      const section = sections.find((item) => item.name === name)
      requireThat(section, `controls: missing native details section ${name}`)
      requireThat(section.open === (name === 'Orientation'),
        `controls: ${name} started ${section.open ? 'open' : 'closed'}`)
    }
    requireThat((await readPanelCheckbox(page, 'Park hand')).checked,
      'controls: Park hand was not checked on the normal route')
    requireThat(!(await readPanelCheckbox(page, 'Hold press')).checked,
      'controls: Hold press was checked on arrival')

    const chromeDefaults = await readPanelNumbers(page, chromePanelKeys)
    requireAuthoredPanelNumbers(chromeDefaults, 'controls startup')
    await waitForPanelScene(page, {
      height: authoredTuning.heightPx,
      baseRotation: authoredTuning.baseRotation,
      sculptureRoll: authoredTuning.sculptureRoll,
      sculpturePitch: authoredTuning.sculpturePitch,
      keyIntensity: authoredTuning.keyIntensity,
      ambientIntensity: authoredTuning.ambientIntensity,
      lightX: authoredTuning.lightX,
      lightY: authoredTuning.lightY,
      lightZ: authoredTuning.lightZ,
      exposure: authoredTuning.exposure,
      shadowIntensity: authoredTuning.shadowIntensity,
      shadowRadius: authoredTuning.shadowRadius,
    }, 'authored Chrome pose and lighting')
    const initialChromeScene = await readPanelScene(page)
    await selectHandMaterial(page, 'marble')

    clause = 'parked pointer'
    const defaults = await readPanelNumbers(page)
    requireAuthoredPanelNumbers(defaults, 'controls Marble startup')
    await waitForPanelScene(page, { height: authoredTuning.heightPx }, 'authored hover height')
    const initialScene = await readPanelScene(page)
    requireThat(initialScene, 'controls: named live scene objects did not load')
    const themeClicks = await readThemeClickCount(page)
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
      strokeWidthPx: authoredTuning.strokeWidthPx,
      strokeOpacity: authoredTuning.strokeOpacity,
      poseDamping: authoredTuning.poseDamping,
      velocityTilt: authoredTuning.velocityTilt,
      maxTilt: authoredTuning.maxTilt,
      maxSpin: authoredTuning.maxSpin,
      pressPitch: authoredTuning.pressPitch,
      ambientIntensity: authoredTuning.ambientIntensity,
      lightX: authoredTuning.lightX,
      lightY: authoredTuning.lightY,
      lightZ: authoredTuning.lightZ,
      exposure: authoredTuning.exposure,
      shadowIntensity: authoredTuning.shadowIntensity,
      shadowRadius: authoredTuning.shadowRadius,
    }
    requireThat(Object.entries(copiedExpected).every(([key, value]) => Math.abs(copied?.[key] - value) < 0.000001),
      `controls: copied JSON did not contain the edited runtime values: ${JSON.stringify(copied)}`)
    requireThat(copied.materialMode === 'marble', 'copied settings did not name the active Marble mode')
    requireThat(copied.strokeEnabled === authoredTuning.strokeEnabled && copied.strokeColor === authoredTuning.strokeColor,
      'copied settings lost the authored stroke visibility or color')

    clause = 'mirrored Chrome mode'
    // Keep the independent stroke out of every optical comparison. A broad
    // colored edge must not satisfy a reflection or H1 changed-pixel floor.
    await openPanelSection(page, 'Stroke')
    await setPanelCheckbox(page, 'Show stroke', false)
    const chrome = await verifyChromeMode(page, { ...copied, strokeEnabled: false })

    clause = 'native page reflections'
    const reflection = await verifyPageReflections(page)

    clause = 'full-page H1 reflections'
    const heading = await verifyHeadingReflections(page)

    clause = 'reflection frame rate'
    const reflectionRate = await verifyReflectionRate(page)

    clause = 'constant-width stroke'
    const stroke = await verifyStroke(page)

    clause = 'Reset all'
    await selectHandMaterial(page, 'marble')
    await clickText(page, 'button', 'Reset all')
    await page.waitForFunction((rootSelector) =>
      document.querySelector(`${rootSelector} [data-hand-material="chrome"]`)?.getAttribute('aria-pressed') === 'true' &&
      window.__r3f.scene.getObjectByName('marble-hand-sculpture')?.material.name === 'marble-hand-mirrored-chrome',
    { timeout: 5_000 }, panelSelector)
    await page.waitForFunction((rootSelector, expected) => Object.entries(expected).every(([key, value]) => {
      const input = document.querySelector(`${rootSelector} input[data-tuning-key="${key}"][type="number"]`)
      return input instanceof HTMLInputElement && Math.abs(Number(input.value) - value) < 0.000001
    }), { timeout: 5_000 }, panelSelector, chromeDefaults)
    requireAuthoredPanelNumbers(await readPanelNumbers(page, chromePanelKeys), 'controls Reset all')
    await waitForPanelScene(page, { ...initialChromeScene, height: authoredTuning.heightPx }, 'Reset all')
    requireMirroredChrome(await readHandMaterial(page))
    requireThat((await readPanelCheckbox(page, 'Show stroke')).checked === authoredTuning.strokeEnabled,
      'Reset all did not restore stroke visibility')
    const resetStrokeColor = await page.$eval(panelSelector, (root) =>
      [...root.querySelectorAll('input[type="color"]')].find((input) =>
        [...input.labels].some((label) => label.textContent.trim().startsWith('Stroke color')))?.value)
    requireThat(resetStrokeColor === authoredTuning.strokeColor,
      `Reset all did not restore stroke color: ${resetStrokeColor}`)

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
    const afterThemeClicks = await readThemeClickCount(page)
    requireThat(afterThemeClicks === themeClicks,
      `controls: panel input clicked a native theme ${themeClicks} → ${afterThemeClicks}`)
    clause = 'distinct theme reflections'
    const themeReflections = await verifyThemeReflections(page)
    requireThat(problems.length === 0, `page errors: ${problems.join('\n')}`)
    if (artifactDirectory) {
      await mkdir(artifactDirectory, { recursive: true })
      await page.screenshot({ path: path.join(artifactDirectory, 'flagged-page.png') })
      const png = await page.$eval('[data-marble-page-capture]', (wrapper) =>
        wrapper.closest('canvas').toDataURL('image/png').split(',')[1])
      await writeFile(path.join(artifactDirectory, 'full-page-source.png'), Buffer.from(png, 'base64'))
      console.log(`marble-hand artifacts: ${artifactDirectory}`)
    }
    return { parkedDrift, themeClicks, heldHeight: heldPress.height, restoredHeight: authoredTuning.heightPx,
      reflection, chrome, heading, reflectionRate, stroke, themeReflections }
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
    await page.goto(`http://127.0.0.1:${port}/?scene=marble-hand&framed`, { waitUntil: 'domcontentloaded' })
    const available = await page.evaluate(() => 'drawElementImage' in document.createElement('canvas').getContext('2d'))
    if (available) {
      console.warn('marble-hand no-flag clause SKIPPED: this browser exposes HTML-in-canvas without the flag')
      return false
    }
    await page.waitForSelector(`${panelSelector} [data-marble-reflection-notice]`, { visible: true, timeout: 30_000 })
    await page.waitForFunction(() => Boolean(window.__r3f?.scene.environment), { timeout: 30_000 })
    await observeThemeClicks(page)
    const native = await page.evaluate(() => ({
      sheets: document.querySelectorAll('.mh-app > .mh-sheet').length,
      copies: document.querySelectorAll('[data-marble-reflection-copy]').length,
      clear: getComputedStyle(window.__r3f.gl.domElement).pointerEvents === 'none',
      kind: window.__r3f.scene.environment.userData.captureKind,
      notice: document.querySelector('[data-marble-hand-controls] [data-marble-reflection-notice]').textContent,
      removed: document.querySelector('.mh-app > .mh-sheet').querySelectorAll(
        '.mh-masthead, .mh-kicker, .mh-deck, .mh-status, .mh-footer, .mh-capture-notice, [data-marble-motion-toggle], [data-marble-reflection-notice]',
      ).length,
    }))
    requireThat(native.sheets === 1 && native.copies === 0 && native.clear && native.kind !== 'full-page' &&
      native.notice.includes('Full-page reflections need Chrome') && native.removed === 0,
    `no-flag page falsely claimed full capture or lost native ownership: ${JSON.stringify(native)}`)
    await setPanelOpen(page, false)
    for (const theme of themes) await selectTheme(page, theme.id)
    await setPageMotion(page, false)
    for (const theme of themes) {
      await selectTheme(page, theme.id)
      requireThat((await readColorMotion(page)).state === 'paused',
        `no-flag ${theme.id}: theme discarded Pause color`)
    }
    await setPageMotion(page, true)
    await selectTheme(page, 'waves')
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
  await page.goto(`http://127.0.0.1:${port}/?scene=marble-hand&framed`, { waitUntil: 'domcontentloaded' })
  await requested
  await page.waitForSelector('.mh-app > .mh-sheet', { visible: true, timeout: 30_000 })
  await page.waitForSelector(`aside${panelSelector}`, { visible: true, timeout: 30_000 })
  await observeThemeClicks(page)
  await setPageMotion(page, false)
  requireThat((await readColorMotion(page)).state === 'paused',
    'cold page could not pause its background before the hand loaded')
  await setPageMotion(page, true)
  await setPanelOpen(page, false)
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
  const coldChecker = await readTheme(page, 'checker')
  const coldClicks = await readThemeClickCount(page)
  requireThat(coldChecker.directHit, 'cold page did not hit the native Checker button')
  await page.mouse.click(coldChecker.x, coldChecker.y)
  await requireTheme(page, 'checker')
  requireThat(await readThemeClickCount(page) === coldClicks + 1 &&
    await page.$eval('.mh-app > .mh-sheet [data-theme-option="checker"]',
      (button) => document.activeElement === button),
  'cold Checker click did not keep native focus or produced duplicate events')
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
  const colorMotion = await verifyColorMotion(page)

  let worstTipError = 0
  let lowestStone = Infinity
  for (const [x, y] of [[240, 220], [980, 280], [760, 610], [360, 690]]) {
    await page.mouse.move(x, y)
    await nextPaint(page)
    const sample = await readHand(page)
    worstTipError = Math.max(worstTipError, checkHand(sample, { x, y }, `move ${x},${y}`))
    lowestStone = Math.min(lowestStone, sample.minWorldZ)
  }

  const waves = await readTheme(page, 'waves')
  const wavesClicks = await readThemeClickCount(page)
  requireThat(waves.directHit, 'loaded overlay blocked the native Waves button')
  await page.mouse.move(waves.x, waves.y)
  await page.waitForFunction((height) => Math.abs(
    window.__r3f.scene.getObjectByName('marble-hand-pointer').position.z - height,
  ) < 0.1, undefined, authoredTuning.heightPx)
  await page.mouse.down()
  await page.waitForFunction((height) => Math.abs(
    window.__r3f.scene.getObjectByName('marble-hand-pointer').position.z - height,
  ) < 0.1, undefined, authoredTuning.pressHeightPx)
  await nextPaint(page)
  const pressed = await readHand(page)
  checkHand(pressed, waves, 'press')
  lowestStone = Math.min(lowestStone, pressed.minWorldZ)
  await page.mouse.up()
  await requireTheme(page, 'waves')
  await page.waitForFunction((height) => Math.abs(
    window.__r3f.scene.getObjectByName('marble-hand-pointer').position.z - height,
  ) < 0.1, undefined, authoredTuning.heightPx)
  await nextPaint(page)
  const released = await readHand(page)
  checkHand(released, waves, 'click release')
  const after = await page.$eval('.mh-app > .mh-sheet', (sheet) => {
    const button = sheet.querySelector('.mh-theme-button[data-theme-option="waves"]')
    return {
      wavesPressed: button?.getAttribute('aria-pressed'),
      wavesFocused: document.activeElement === button,
    }
  })
  requireThat(await readThemeClickCount(page) === wavesClicks + 1 && after.wavesPressed === 'true' && after.wavesFocused,
    `one Waves click did not keep native focus or produced duplicate events: ${JSON.stringify(after)}`)
  const selectedCharacters = await selectNativeText(page)
  requireThat(await readThemeClickCount(page) === wavesClicks + 1, 'native text selection activated a theme')
  const tap = await verifyIdleTap(page)
  if (artifactDirectory) {
    await mkdir(artifactDirectory, { recursive: true })
    await page.mouse.move(viewport.width * 0.53, viewport.height * 0.42)
    await nextPaint(page)
    await page.screenshot({ path: path.join(artifactDirectory, 'poster-desktop.png') })
  }
  const mobile = await verifyMobileLayout(page)
  requireThat(problems.length === 0, `page errors: ${problems.join('\n')}`)
  await page.close()
  const panel = await verifyPanel(port)
  const unavailable = await verifyReflectionUnavailable(port, headless)
  requireThat(hdrRequests.length === 0, `page-derived room requested HDR assets: ${hdrRequests.join(', ')}`)
  console.log(`marble-hand gate PASSED: native full-page capture; cold cursor ${cold.pageCursor}; ` +
    `one native sheet; ${selectedCharacters} selected characters; no HDR requests; ` +
    `field ${colorMotion.map((result) => `${result.id} ${result.moving.fps}fps ±${result.moving.maxClockError.toFixed(2)}ms`).join(', ')}; ` +
    `all themes support native click, keyboard, pause/resume, reduced motion; ` +
    `all six theme pairs change page and hand pixels (${panel.themeReflections.map((pair) => `${pair.from}/${pair.to}: ${pair.hand.changedPixels}`).join(', ')}); ` +
    `${mobile[0].viewport}px mobile without overflow in all themes; ` +
    `tip error ${worstTipError.toFixed(3)}px; height ${authoredTuning.heightPx} → ${pressed.height.toFixed(2)} → ${released.height.toFixed(2)}; ` +
    `lowest stone ${lowestStone.toFixed(2)}px; one trusted Waves click with native focus; ` +
    `panel degree/material/light/reset checks; parked drift ${panel.parkedDrift.toFixed(3)}px; ` +
    `held press ${panel.restoredHeight.toFixed(2)} → ${panel.heldHeight.toFixed(2)}; ` +
    `panel did not click themes; reflection ${panel.reflection.changedPixels} hand pixels, ` +
    `peak ${panel.reflection.maxDelta}/255; Chrome ${panel.chrome.changedPixels} hand pixels, ` +
    `peak ${panel.chrome.maxDelta}/255; mirror intensity ${panel.chrome.intensity.changedPixels} hand pixels, ` +
    `peak ${panel.chrome.intensity.maxDelta}/255, unchanged map generation ${panel.chrome.intensity.generation}; ` +
    `H1 ink ${panel.heading.sourceInk} → ${panel.heading.hiddenInk}, ` +
    `${panel.heading.changedPixels} reflected hand pixels; no-flag notice ${unavailable ? 'passed' : 'skipped'}; ` +
    `reflection rate ${panel.reflectionRate.low.measuredFps.toFixed(1)}fps at 2 → ` +
    `${panel.reflectionRate.high.measuredFps.toFixed(1)}fps at 60; ` +
    `${panel.reflectionRate.low.movingBetweenReflections} hand moves between low-rate reflections; ` +
    `stroke 6px measured ${panel.stroke.samples.map((sample) => `${sample.widthPx.toFixed(2)}px at DPR${sample.dpr}/z${sample.height}`).join(', ')}; ` +
    `stroke color/opacity/mode/copy/reset passed; ` +
    `idle tap after ${tap.startedAfter}ms rest, ${tap.hashes} distinct frames and ` +
    `${tap.drumChanged} moving overlay pixels per cycle, fingertip drift ${tap.tipDrift.toFixed(3)}px, ` +
    `flat ${tap.stoppedAfter}ms after a 40px move with ${tap.restChanged} pixels still moving, ` +
    `off for reduced motion and for the panel switch; ` +
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
