// Lab interaction acceptance — real pointer, focus, and handoff proof.
//
// Unit tests can prove the routing laws, but they cannot prove that a canvas
// actually receives a mouse stream, that a parked form keeps its focused DOM
// node, or that an airborne card carries its measured shadow. This gate uses
// the public lab routes as a consumer would: one capability-enabled browser,
// real coordinates, and only visible state as its verdict.

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const labRoot = path.join(repoRoot, 'apps', 'lab')
const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
].filter(Boolean).find(existsSync)
const strict = process.env.STRICT_CAPABILITY === '1'

function skip(reason) {
  const message = `lab-interactions gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message)
  process.exit(strict ? 1 : 0)
}

if (!chromePath) skip('no Chrome executable found (set CHROME_PATH)')

let browser
let server
const deadline = setTimeout(() => {
  console.error('lab-interactions gate: hard 300s deadline hit')
  process.exit(1)
}, 300_000)

try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--enable-features=CanvasDrawElement',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })
  const probe = await browser.newPage()
  const capable = await probe.evaluate(
    () => 'drawElementImage' in document.createElement('canvas').getContext('2d'),
  )
  await probe.close()
  if (!capable) skip(`Chrome at ${chromePath} has no drawElementImage`)

  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port
  const errors = []
  let page

  const problems = []
  // Wait for a condition instead of guessing at a delay. Returns false on
  // timeout rather than throwing, so the caller reports what it actually saw.
  const settle = async (fn, timeout = 5_000, ...args) => {
    try {
      await page.waitForFunction(fn, { timeout, polling: 'raf' }, ...args)
      return true
    } catch {
      return false
    }
  }
  // A canvas element exists long before the route behind it can be driven, so
  // each route names the handle its own checks read first.
  const ready = {
    // The shared room mounts its scene and its OrbitControls behind the same
    // Suspense boundary as <Environment>, and `scene.environment` lands when
    // that boundary resolves. So it is the one signal that means "the room is
    // up" for all three — including explode, whose plates come from a HUD that
    // `&bare` never renders, leaving its scene graph legitimately empty.
    workspace: () => Boolean(window.__r3f?.scene?.environment),
    explode: () => Boolean(window.__r3f?.scene?.environment),
    glass: () => Boolean(window.__r3f?.scene?.environment),
    // Knobs and optics run their own canvases, with no shared room to wait on.
    knobs: () => Boolean(window.__r3f?.scene?.children?.length),
    optics: () => Boolean(window.__r3f?.scene?.getObjectByName('optics-rail-loupe')),
    // Flight's overlay canvas stays empty until a card is airborne, so it is
    // the dealt deck in the DOM that says the route is up.
    flight: () => document.querySelectorAll('.l14-slot').length === 9,
    // Logo runs its own canvas and hangs nothing on window.
    logo: () =>
      Boolean(
        document.querySelector('.logo-word')?.getAttribute('data-phase') &&
          document.querySelector('button[data-renderer="gl"]'),
      ),
  }
  const go = async (scene) => {
    await page?.close()
    page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 820, deviceScaleFactor: 1 })
    page.on('pageerror', (error) => errors.push(String(error)))
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
        errors.push(message.text())
      }
    })
    await page.goto(`http://localhost:${port}/?scene=${scene}&bare`, { waitUntil: 'load' })
    if (scene === 'logo') await page.waitForSelector('.logo-word', { timeout: 20_000 })
    else await page.waitForSelector('canvas[data-engine]', { timeout: 20_000 })
    if (!(await settle(ready[scene], 30_000))) problems.push(`${scene} never finished mounting`)
  }
  const sourcePoint = async (sourceName, objectName, selector) => {
    // The parked DOM the point is measured FROM and the mesh it is measured
    // ONTO arrive on different clocks; projecting before both are up returns
    // null, which reads as a missing control rather than a slow one.
    await settle(
      ({ sourceName, objectName, selector }) =>
        Boolean(
          document
            .querySelector(`[data-munari-source-host][data-munari-surface="${sourceName}"]`)
            ?.querySelector(selector) && window.__r3f?.scene?.getObjectByName(objectName),
        ),
      5_000,
      { sourceName, objectName, selector },
    )
    return page.evaluate(
      ({ sourceName, objectName, selector }) => {
        const host = document.querySelector(
          `[data-munari-source-host][data-munari-surface="${sourceName}"]`,
        )
        const target = host?.querySelector(selector)
        const object = window.__r3f?.scene?.getObjectByName(objectName)
        if (!host || !target || !object?.geometry) return null
        object.geometry.computeBoundingBox()
        const box = object.geometry.boundingBox
        if (!box) return null
        const hostRect = host.getBoundingClientRect()
        const targetRect = target.getBoundingClientRect()
        const u = (targetRect.left + targetRect.width / 2 - hostRect.left) / hostRect.width
        const v = (targetRect.top + targetRect.height / 2 - hostRect.top) / hostRect.height
        const point = object.position.clone().set(
          box.min.x + (box.max.x - box.min.x) * u,
          box.max.y - (box.max.y - box.min.y) * v,
          0,
        )
        object.localToWorld(point)
        point.project(window.__r3f.camera)
        const canvas = window.__r3f.gl.domElement.getBoundingClientRect()
        return {
          x: canvas.left + ((point.x + 1) / 2) * canvas.width,
          y: canvas.top + ((1 - point.y) / 2) * canvas.height,
        }
      },
      { sourceName, objectName, selector },
    )
  }
  const drag = async (from, to) => {
    await page.mouse.move(from[0], from[1])
    await page.mouse.down()
    await page.mouse.move(to[0], to[1], { steps: 8 })
    await page.mouse.up()
  }
  const changed = (a, b) => a.some((value, index) => Math.abs(value - b[index]) > 1e-3)

  // Workspace: real focus enters a real field, a relayed click changes it,
  // and a panel drag cannot strand the camera controls disabled.
  await go('workspace')
  // The reroute happens on the canvas's own focus event, so the interior
  // control has to exist BEFORE focus is handed over — waiting afterwards
  // would never recover, because the event has already been handled.
  if (!(await settle(() =>
    Boolean(document.querySelector('[data-munari-surface="workspace-pr"] input')),
  ))) {
    problems.push('workspace source published no control to route focus into')
  }
  await page.evaluate(() => document.querySelector('canvas[data-engine]')?.focus())
  const routed = await settle(
    () =>
      document.activeElement?.tagName === 'INPUT' &&
      window.__focusScene?.locate?.().level === 'interior',
    2_000,
  )
  if (!routed) {
    const focus = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      level: window.__focusScene?.locate?.().level,
    }))
    problems.push(
      `focusing the workspace canvas left focus at ${JSON.stringify(focus)}, not an interior control`,
    )
  }
  const workspace = await sourcePoint('workspace-pr', 'workspace-pr', 'input')
  if (!workspace) problems.push('workspace did not expose a projected checkbox')
  else {
    const before = await page.$eval('[data-munari-surface="workspace-pr"] input', (el) => el.checked)
    await page.mouse.click(workspace.x, workspace.y)
    const after = await page.$eval('[data-munari-surface="workspace-pr"] input', (el) => el.checked)
    if (before === after) problems.push('workspace Surface click did not reach its checkbox')
  }
  await drag([600, 400], [490, 470])
  const recovered = await page.evaluate(() => window.__workspaceRig?.().enabled)
  if (recovered !== true) problems.push('workspace panel drag left OrbitControls disabled')
  const workspaceCamera = await page.evaluate(() => window.__r3f.camera.position.toArray())
  await drag([60, 760], [170, 700])
  const workspaceMoved = await page.evaluate(() => window.__r3f.camera.position.toArray())
  if (!changed(workspaceCamera, workspaceMoved)) problems.push('workspace camera did not move on canvas drag')

  // Glass: pointer movement drives parallax and an actual press reaches the
  // nested DOM button through the transparent material.
  await go('glass')
  await page.mouse.move(100, 100)
  // The parallax camera is damped, so it keeps moving for a while after the
  // pointer stops. Take the baseline once it has come to rest, then wait for
  // the second pointer position to move it off that rest.
  const cameraAtRest = async () => {
    await settle(() => {
      const now = window.__r3f.camera.position.toArray().join()
      const still = now === window.__labCam
      window.__labCam = now
      return still
    }, 3_000)
    return page.evaluate(() => window.__r3f.camera.position.toArray())
  }
  const glassA = await cameraAtRest()
  await page.mouse.move(1100, 700)
  const moved = await settle(
    (from) =>
      window.__r3f.camera.position
        .toArray()
        .some((value, index) => Math.abs(value - from[index]) > 1e-3),
    3_000,
    glassA,
  )
  if (!moved) problems.push('glass pointer movement did not move the parallax camera')
  const glass = await sourcePoint('glass-pill', 'glass-pill', 'button')
  if (!glass) problems.push('glass did not expose the CTA hit point')
  else {
    const before = await page.evaluate(() => window.__glass.glows().length)
    await page.mouse.move(glass.x, glass.y)
    await page.mouse.down()
    const struck = await settle((count) => window.__glass.glows().length > count, 2_000, before)
    await page.mouse.up()
    if (!struck) problems.push('glass CTA press did not reach its DOM button')
  }

  // Knobs and Optics are full-scene canvases, not overlay routes. Their
  // controls prove SurfaceCanvas keeps normal R3F input when it is not in
  // `surfaces` pointer mode.
  await go('knobs')
  const knob = await sourcePoint(
    'knobs-panel',
    'knobs-panel-surface',
    '[data-munari-anchor="toggle:power"]',
  )
  if (!knob) problems.push('knobs did not expose the power toggle hit point')
  else {
    const selector = '[data-munari-surface="knobs-panel"] [data-munari-anchor="toggle:power"]'
    const before = await page.$eval(selector, (el) => el.getAttribute('aria-pressed'))
    await page.mouse.click(knob.x, knob.y)
    const after = await page.$eval(selector, (el) => el.getAttribute('aria-pressed'))
    if (before === after) problems.push('knobs Surface click did not toggle power')
  }

  await go('optics')
  const loupe = await page.evaluate(() => {
    const object = window.__r3f.scene.getObjectByName('optics-rail-loupe')
    if (!object) return null
    const point = object.getWorldPosition(object.position.clone()).project(window.__r3f.camera)
    const canvas = window.__r3f.gl.domElement.getBoundingClientRect()
    return {
      x: canvas.left + ((point.x + 1) / 2) * canvas.width,
      y: canvas.top + ((1 - point.y) / 2) * canvas.height,
    }
  })
  if (!loupe) problems.push('optics did not expose the loupe rail')
  else {
    await page.mouse.click(loupe.x, loupe.y)
    await page.waitForFunction(() => document.querySelector('.opt-readout h2')?.textContent !== 'nothing in hand')
  }

  await go('explode')
  const explodeA = await page.evaluate(() => window.__r3f.camera.position.toArray())
  await drag([1080, 180], [970, 250])
  const explodeB = await page.evaluate(() => window.__r3f.camera.position.toArray())
  if (!changed(explodeA, explodeB)) problems.push('explode camera did not move on mouse drag')

  // Flight: a delete keeps the Surface alive until it hands back, so this
  // checks two full delete cycles as well as the measured two-layer shadow.
  await go('flight')
  const erase = async (nextCount) => {
    const button = await page.$('[data-card] .l14-del')
    await button.click()
    await page.waitForFunction((count) => document.querySelectorAll('.l14-slot').length === count, { timeout: 10_000 }, nextCount)
  }
  await erase(8)
  await erase(7)
  const flightCounts = await page.evaluate(() => [...document.querySelectorAll('.l14-count')].map((el) => el.textContent))
  if (flightCounts.join(',') !== '03,04') problems.push(`flight counts were ${flightCounts.join(',')} after two deletes`)
  const flightCard = await page.$('[data-card]')
  const flightBox = await flightCard.boundingBox()
  await page.mouse.move(flightBox.x + flightBox.width / 2, flightBox.y + flightBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(850, 210, { steps: 10 })
  await page.waitForFunction(() => Boolean(window.__flight), { timeout: 3_000 })
  const shadow = await page.evaluate(() => {
    const mesh = window.__r3f.scene.getObjectByName('flight-card-shadow')
    return mesh ? { visible: mesh.visible, count: mesh.material.uniforms.uCount.value } : null
  })
  await page.mouse.up()
  if (!shadow?.visible || shadow.count !== 2) problems.push(`flight shadow was ${JSON.stringify(shadow)}`)

  // Logo: no compositor frame may hide both the HTML letters and WebGL copy.
  await go('logo')
  const logoSamples = page.evaluate(() => new Promise((resolve) => {
    let gaps = 0
    let total = 0
    const until = performance.now() + 4_000
    const frame = () => {
      const letter = document.querySelector('.logo-letter')
      const canvas = document.querySelector('.logo-canvas')
      if (letter && canvas) {
        total++
        if (getComputedStyle(letter).visibility === 'hidden' && Number(getComputedStyle(canvas).opacity) < 0.01) gaps++
      }
      if (performance.now() >= until) resolve({ gaps, total })
      else requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }))
  await page.click('button[data-renderer="gl"]')
  await page.waitForFunction(() => document.querySelector('.logo-word')?.getAttribute('data-phase') === 'gl', { timeout: 3_000 })
  await page.click('button[data-renderer="html"]')
  await page.waitForFunction(() => document.querySelector('.logo-word')?.getAttribute('data-phase') === 'page', { timeout: 3_000 })
  const logo = await logoSamples
  if (logo.gaps !== 0) problems.push(`logo had ${logo.gaps}/${logo.total} invisible handoff frames`)

  if (errors.length) problems.push(...errors.map((error) => `page error: ${error}`))
  if (problems.length) {
    console.error(`lab-interactions gate FAILED (${problems.length})`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
  } else {
    console.log('lab-interactions gate PASSED')
  }
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
