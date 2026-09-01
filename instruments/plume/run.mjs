// Plume gate — native text survives its ink becoming separate particles.
//
// The law: evaporation changes pixels, not the textarea's value or caret.
// Restore must restamp the existing grain buffer and replay the same ink.
// On 2026-08-30 the old 3px quads stretched 22–40 times along their travel,
// producing long threads. This gate measures isolated sprites from the real
// shader, not a JavaScript copy of its motion, and keeps full-cloud images.
// Ownership: the lab owns the scene; this runner owns isolated Chrome and
// Vite processes. No probe state or test hook is added to the application.
// The centered page is measured with short, wrapped, and scrollable native
// text so a fixed-height box cannot pass as intrinsic text layout.

import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
import { defaultPlumeEffects, PLUME_GROUPS, plumeTuning } from '../../apps/lab/src/scenes/plume/plumeTuning.ts'

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
const artifactDirectory = process.env.PLUME_ARTIFACT_DIR
const text = 'Small particles rise\ninto the evening air.'
const inputSelector = 'textarea.plume-input'
const panelSelector = '[data-plume-controls]'
const restoreSelector = '[data-plume-restore]'
const clearSelector = '[data-plume-clear]'
const effects = [
  { label: 'Updraft', uniform: 'uWisps' },
  { label: 'Ghost ink', attribute: 'data-afterglow' },
  { label: 'Sparks', uniform: 'uEmbers' },
  { label: 'Draft', uniform: 'uDraftOn' },
]
// Longest edge one isolated puff may cover. Raised from 8px on 2026-08-31:
// smoke puffs expand as they thin, and 16 real sprites at 4s now top out at
// 27px against 5px for the old dots. The cap sits a third above that
// measurement, which is the same headroom the 8px clause carried. The aspect
// clause beside it is unchanged and is still the anti-thread clause: a
// stretched grain fails it at any diameter.
const SPRITE_CAP = 36
const numberControls = PLUME_GROUPS.flatMap((group) => group.controls)
const colorControls = PLUME_GROUPS.flatMap((group) => group.colors ?? [])
const uniformKeys = {
  particleSize: 'uParticleSize', sizeVariation: 'uSizeVariation', particleGrowth: 'uParticleGrowth',
  particleOpacity: 'uParticleOpacity', particleSoftness: 'uParticleSoftness', lifetimeVariation: 'uLifetimeVariation',
  rise: 'uRise', spread: 'uSpread', depth: 'uDepth', turbulence: 'uTurbulence', billow: 'uBillow',
  shading: 'uShading', depthFog: 'uDepthFog', turbulenceSpeed: 'uTurbulenceSpeed',
  draftStrength: 'uDraftStrength', tint: 'uTint', sparkAmount: 'uSparkAmount',
}
// Non-whitespace grapheme clusters: what character mode must produce one
// anchor and one clock for.
const marks = (value) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)]
  .filter((piece) => !/^\s+$/u.test(piece.segment)).length
const errors = []
let browser
let fallbackBrowser
let server

function requireThat(condition, message) {
  if (!condition) throw new Error(message)
}

function skip(reason) {
  const message = `plume gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message)
  process.exitCode = strict ? 1 : 0
}

function launch(headless, capture = true) {
  return puppeteer.launch({
    executablePath: chromePath,
    headless,
    args: [
      ...(capture ? ['--enable-features=CanvasDrawElement'] : []),
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })
}

async function capable(instance) {
  const page = await instance.newPage()
  const supported = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    return context !== null && 'drawElementImage' in context && 'requestPaint' in canvas
  })
  await page.close()
  return supported
}

async function openPage(instance, url) {
  const page = await instance.newPage()
  await page.setViewport(viewport)
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url?.endsWith('/favicon.ico')) {
      errors.push(message.text())
    }
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(inputSelector, { visible: true })
  await page.evaluate(() => document.fonts.ready)
  return page
}

function readCloud(page) {
  return page.evaluate(() => {
    let cloud
    window.__r3f?.scene.traverse((object) => {
      if (object.geometry?.getAttribute('aRelease')) cloud = object
    })
    if (!cloud) return null
    const releases = cloud.geometry.getAttribute('aRelease').array
    let first = Infinity
    let last = -Infinity
    let count = 0
    const clocks = new Set()
    for (let index = 0; index < releases.length; index += 4) {
      if (releases[index] >= 1e8) continue
      first = Math.min(first, releases[index])
      last = Math.max(last, releases[index])
      clocks.add(releases[index])
      count++
    }
    const uniforms = cloud.material.uniforms
    return {
      geometry: cloud.geometry.uuid,
      cells: cloud.geometry.getAttribute('position').count / 4,
      first,
      last,
      count,
      clocks: clocks.size,
      time: uniforms.uTime.value,
      duration: uniforms.uDuration.value,
      reduced: uniforms.uReduced.value,
      sparks: uniforms.uEmbers.value,
    }
  })
}

async function waitForCloud(page) {
  await page.waitForFunction(() => {
    let ready = false
    window.__r3f?.scene.traverse((object) => {
      const releases = object.geometry?.getAttribute('aRelease')?.array
      if (releases?.some((value) => value < 1e8)) ready = true
    })
    return ready
  }, { timeout: 15_000 })
}

async function enterText(page, value) {
  await act(page, clearSelector)
  await page.click(inputSelector)
  await page.keyboard.type(value, { delay: 12 })
  await page.waitForFunction((value) => document.querySelector('textarea.plume-input')?.value === value,
    undefined, value)
}

async function setPanelOpen(page, open) {
  const visible = await page.$eval(panelSelector, (panel) => !panel.hidden)
  if (visible !== open) {
    await page.click(open ? '[data-plume-controls-opener]' : '[data-plume-controls-close]')
  }
  await page.waitForSelector(panelSelector, open ? { visible: true } : { hidden: true })
}

async function act(page, selector) {
  await setPanelOpen(page, true)
  await page.click(selector)
  await setPanelOpen(page, false)
}

async function capturePage(page, name) {
  if (!artifactDirectory) return
  await mkdir(artifactDirectory, { recursive: true })
  await page.screenshot({ path: path.join(artifactDirectory, `${name}-page.png`) })
}

async function captureHeld(page, name) {
  await act(page, restoreSelector)
  await page.waitForFunction(() => {
    const words = [...document.querySelectorAll('.plume-mirror .plume-word')]
    return words.length > 0 && words.every((word) => word.dataset.phase === 'held' &&
      Number(getComputedStyle(word).opacity) > 0.99)
  }, { timeout: 3000 })
  await capturePage(page, name)
}

async function requirePlainLayout(page, label, captured = true) {
  await page.waitForFunction((captured) => {
    const input = document.querySelector('textarea.plume-input')
    const copy = document.querySelector('.plume-capture')
    if (!input || (captured && !copy)) return false
    if (!captured) return true
    const native = input.getBoundingClientRect()
    const source = copy.getBoundingClientRect()
    return Math.abs(native.width - source.width) < 1 && Math.abs(native.height - source.height) < 1
  }, { timeout: 5000 }, captured)
  const layout = await page.evaluate(() => {
    const page = document.querySelector('.plume-page')
    const work = document.querySelector('.plume-work')
    const sheet = document.querySelector('.plume-sheet')
    const measure = document.querySelector('.plume-measure')
    const input = document.querySelector('textarea.plume-input')
    const rect = work.getBoundingClientRect()
    const pageStyle = getComputedStyle(page)
    const sheetStyle = getComputedStyle(sheet)
    const typography = (element) => {
      if (!element) return null
      const style = getComputedStyle(element)
      return {
        family: style.fontFamily,
        size: style.fontSize,
        weight: style.fontWeight,
        leading: style.lineHeight,
        spacing: style.letterSpacing,
        align: style.textAlign,
        padding: style.padding,
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
      }
    }
    const flowOffset = (selector) => {
      const flow = document.querySelector(selector)
      return flow ? new DOMMatrixReadOnly(getComputedStyle(flow).transform).m42 : null
    }
    return {
      width: innerWidth,
      height: innerHeight,
      x: rect.left,
      y: rect.top,
      workWidth: rect.width,
      workHeight: rect.height,
      centerError: Math.hypot(rect.left + rect.width / 2 - innerWidth / 2,
        rect.top + rect.height / 2 - innerHeight / 2),
      background: pageStyle.backgroundColor,
      backgroundImage: pageStyle.backgroundImage,
      sheetBackground: sheetStyle.backgroundColor,
      sheetImage: sheetStyle.backgroundImage,
      border: [sheetStyle.borderTopWidth, sheetStyle.borderRightWidth,
        sheetStyle.borderBottomWidth, sheetStyle.borderLeftWidth],
      shadow: sheetStyle.boxShadow,
      measureHeight: measure?.getBoundingClientRect().height,
      measureHidden: measure ? getComputedStyle(measure).visibility === 'hidden' : false,
      input: typography(input),
      mirror: typography(document.querySelector('.plume-mirror')),
      capture: typography(document.querySelector('.plume-capture')),
      scrollTop: input.scrollTop,
      scrollHeight: input.scrollHeight,
      clientHeight: input.clientHeight,
      mirrorOffset: flowOffset('.plume-mirror .plume-copy__flow'),
      captureOffset: flowOffset('.plume-capture .plume-copy__flow'),
      pageScroll: scrollY,
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
      oldChrome: [...document.querySelectorAll('.plume-intro, .plume-rule, .plume-sheet__meta, .plume-actions, .plume-status')]
        .filter((element) => !element.closest('[data-plume-controls]')).length,
      open: !document.querySelector('[data-plume-controls]').hidden,
    }
  })
  requireThat(layout.centerError <= 1 && layout.x >= 0 && layout.y >= 0 &&
    layout.x + layout.workWidth <= layout.width + 1 &&
    layout.y + layout.workHeight <= layout.height + 1 && !layout.pageOverflow,
  `${label}: text area is not centered within the viewport: ${JSON.stringify(layout)}`)
  requireThat(layout.background === 'rgb(229, 221, 234)' && layout.backgroundImage === 'none' &&
    layout.sheetBackground === 'rgba(0, 0, 0, 0)' && layout.sheetImage === 'none' &&
    layout.border.every((width) => width === '0px') && layout.shadow === 'none' &&
    layout.oldChrome === 0 && !layout.open && layout.measureHidden,
  `${label}: the quiet page regained visible chrome: ${JSON.stringify(layout)}`)
  requireThat(layout.input.align === 'center' && layout.input.family.toLowerCase().includes('archivo') &&
    JSON.stringify(layout.input) === JSON.stringify(layout.mirror) &&
    (!captured || JSON.stringify(layout.input) === JSON.stringify(layout.capture)),
  `${label}: native, mirror, and capture typography diverged: ${JSON.stringify(layout)}`)
  return layout
}

async function verifyPanel(page) {
  requireThat(await page.$eval(panelSelector, (panel) => panel.hidden), 'Plume controls must start closed')
  await setPanelOpen(page, true)
  requireThat(await page.$eval('[data-plume-controls-close]', (button) => document.activeElement === button),
    'opening controls did not move focus into the panel')
  await capturePage(page, 'controls')
  await setPanelOpen(page, false)
  requireThat(await page.$eval('[data-plume-controls-opener]', (button) => document.activeElement === button),
    'closing controls did not return focus to the opener')
  await setPanelOpen(page, true)
  await page.keyboard.press('Escape')
  await page.waitForSelector(panelSelector, { hidden: true })
  requireThat(await page.$eval('[data-plume-controls-opener]', (button) => document.activeElement === button),
    'Escape did not close controls and restore focus')
}

async function verifyIntrinsicSize(page, captured = true) {
  await enterText(page, 'Breathe.')
  if (captured) await waitForCloud(page)
  const short = await requirePlainLayout(page, 'one line', captured)
  await enterText(page, 'One quiet line.\nThen another.\nLet both drift.')
  if (captured) await waitForCloud(page)
  const multiple = await requirePlainLayout(page, 'three lines', captured)
  requireThat(multiple.workHeight > short.workHeight + Number.parseFloat(short.input.leading),
    `the intrinsic field did not grow with lines: ${short.workHeight} → ${multiple.workHeight}`)
  const long = Array.from({ length: 24 }, (_, index) => `Line ${index + 1}`).join('\n')
  await enterText(page, long)
  await requireNativeText(page, long)
  await page.waitForFunction(() => {
    const input = document.querySelector('textarea.plume-input')
    return input.scrollTop > 20 && input.scrollHeight > input.clientHeight
  }, { timeout: 5000 })
  const overflow = await requirePlainLayout(page, 'long native text', captured)
  requireThat(overflow.workHeight <= overflow.height * 0.7 + 2,
    `long text exceeded the 70vh cap: ${JSON.stringify(overflow)}`)
  await page.mouse.move(overflow.x + overflow.workWidth / 2, overflow.y + overflow.workHeight / 2)
  await page.mouse.wheel({ deltaY: -300 })
  await page.waitForFunction(({ previous, captured }) => {
    const input = document.querySelector('textarea.plume-input')
    const offset = (selector) => {
      const element = document.querySelector(selector)
      return element ? new DOMMatrixReadOnly(getComputedStyle(element).transform).m42 : null
    }
    return input.scrollTop < previous - 20 &&
      Math.abs(offset('.plume-mirror .plume-copy__flow') + input.scrollTop) < 1 &&
      (!captured || Math.abs(offset('.plume-capture .plume-copy__flow') + input.scrollTop) < 1)
  }, { timeout: 5000 }, { previous: overflow.scrollTop, captured })
  await requireNativeText(page, long)
  const scrolled = await requirePlainLayout(page, 'native scrolling', captured)
  requireThat(scrolled.pageScroll === 0, 'native scrolling moved the page instead of the writing field')
  await enterText(page, 'Breathe.')
  if (captured) await waitForCloud(page)
  const shrunk = await requirePlainLayout(page, 'short again', captured)
  requireThat(Math.abs(shrunk.workHeight - short.workHeight) <= 1 && shrunk.scrollTop === 0 &&
    shrunk.mirrorOffset === 0 && (!captured || shrunk.captureOffset === 0),
  `the field kept its old height or scroll after Clear: ${JSON.stringify(shrunk)}`)
  return { short: short.workHeight, multiple: multiple.workHeight, long: overflow.workHeight, scroll: scrolled.scrollTop }
}

async function putCaretAtEnd(page) {
  await page.click(inputSelector)
  const modifier = await page.evaluate(() => navigator.platform.includes('Mac') ? 'Meta' : 'Control')
  await page.keyboard.down(modifier)
  // Headless macOS does not always translate synthetic Cmd+A through its
  // platform shortcut map. This is Chromium's native editor command, not
  // a selection mutation on the application node.
  await page.keyboard.press('KeyA', { commands: ['SelectAll'] })
  await page.keyboard.up(modifier)
  await page.keyboard.press('ArrowRight')
  requireThat(await page.$eval(inputSelector, (input) => document.activeElement === input &&
    input.selectionStart === input.value.length && input.selectionEnd === input.value.length),
  'native Select All and Arrow Right did not put the caret at the end')
}

async function requireNativeText(page, value, focused = true) {
  const native = await page.$eval(inputSelector, (input) => ({
    value: input.value,
    start: input.selectionStart,
    end: input.selectionEnd,
    focused: document.activeElement === input,
    count: document.querySelectorAll('textarea.plume-input').length,
    underCanvas: input.closest('canvas') !== null,
  }))
  requireThat(native.value === value && native.count === 1 && !native.underCanvas,
    `the native textarea changed ownership or value: ${JSON.stringify(native)}`)
  if (focused) requireThat(native.focused && native.start === value.length && native.end === value.length,
    `evaporation moved the native caret: ${JSON.stringify(native)}`)
  return native
}

async function waitForGone(page) {
  await page.waitForFunction(() => {
    const words = [...document.querySelectorAll('.plume-mirror .plume-word')]
    return words.length > 0 && words.every((word) => word.dataset.phase === 'gone' &&
      Number(getComputedStyle(word).opacity) < 0.001)
  }, { timeout: plumeTuning.holdMs + plumeTuning.durationMs + 5_000 })
}

async function sampleFlight(page, age, name, isolate = false) {
  const sample = await page.evaluate(async ({ age, isolate, image }) => {
    const state = window.__r3f
    let cloud
    state.scene.traverse((object) => {
      if (object.geometry?.getAttribute('aRelease')) cloud = object
    })
    if (!cloud) throw new Error('missing plume cloud')
    const releases = cloud.geometry.getAttribute('aRelease').array
    let release = -Infinity
    for (let index = 0; index < releases.length; index += 4) {
      if (releases[index] < 1e8) release = Math.max(release, releases[index])
    }
    await new Promise((resolve, reject) => {
      const deadline = performance.now() + 12_000
      const tick = () => {
        if (cloud.material.uniforms.uTime.value >= release + age) resolve()
        else if (performance.now() >= deadline) reject(new Error(`no frame at plume age ${age}s`))
        else requestAnimationFrame(tick)
      }
      tick()
    })

    const renderer = state.gl
    const context = renderer.getContext()
    const width = context.drawingBufferWidth
    const height = context.drawingBufferHeight
    const pixels = new Uint8Array(width * height * 4)
    const read = () => {
      // Read only a finished, real default-framebuffer draw. A deferred
      // read after the compositor has cleared it is not particle evidence.
      renderer.setRenderTarget(null)
      renderer.render(state.scene, state.camera)
      context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels)
      let visible = 0
      let totalAlpha = 0
      let alphaViolations = 0
      const sum = [0, 0, 0, 0]
      let minX = width
      let maxX = -1
      let minY = height
      let maxY = -1
      for (let pixel = 0; pixel < width * height; pixel++) {
        const alpha = pixels[pixel * 4 + 3]
        totalAlpha += alpha
        if (Math.max(pixels[pixel * 4], pixels[pixel * 4 + 1], pixels[pixel * 4 + 2]) > alpha + 1) {
          alphaViolations++
        }
        if (alpha < 8) continue
        visible++
        for (let channel = 0; channel < 4; channel++) sum[channel] += pixels[pixel * 4 + channel]
        const x = pixel % width
        const y = Math.floor(pixel / width)
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
      return { visible, totalAlpha, alphaViolations, sum,
        width: maxX - minX + 1, height: maxY - minY + 1 }
    }
    const full = read()
    const actualAge = cloud.material.uniforms.uTime.value - release
    let png
    if (image) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const paint = canvas.getContext('2d')
      const data = paint.createImageData(width, height)
      for (let y = 0; y < height; y++) {
        const from = (height - y - 1) * width * 4
        // Canvas ImageData wants straight alpha; WebGL returned the
        // premultiplied color that actually blends over the native page.
        for (let x = 0; x < width; x++) {
          const source = from + x * 4
          const destination = (y * width + x) * 4
          const alpha = pixels[source + 3]
          for (let channel = 0; channel < 3; channel++) {
            data.data[destination + channel] = alpha ? Math.min(255, pixels[source + channel] * 255 / alpha) : 0
          }
          data.data[destination + 3] = alpha
        }
      }
      paint.putImageData(data, 0, 0)
      png = canvas.toDataURL('image/png').split(',')[1]
    }

    const sprites = []
    if (isolate) {
      const texture = cloud.material.uniforms.tMap.value
      const source = texture.image
      if (!(source instanceof HTMLCanvasElement)) throw new Error('missing captured ink canvas')
      const ink = source.getContext('2d').getImageData(0, 0, source.width, source.height).data
      const uv = cloud.geometry.getAttribute('aUv')
      const candidates = []
      for (let vertex = 0; vertex < releases.length; vertex += 4) {
        if (releases[vertex] >= 1e8) continue
        const x = Math.min(source.width - 1, Math.floor(uv.getX(vertex) * source.width))
        const y = Math.min(source.height - 1, Math.floor((1 - uv.getY(vertex)) * source.height))
        if (ink[(y * source.width + x) * 4 + 3] >= 240) candidates.push(vertex / 4)
      }
      const original = { ...cloud.geometry.drawRange }
      try {
        for (let index = 0; index < Math.min(16, candidates.length); index++) {
          const cell = candidates[Math.floor(index * candidates.length / 16)]
          cloud.geometry.setDrawRange(cell * 6, 6)
          const sprite = read()
          if (sprite.visible >= 2) sprites.push({ ...sprite, cell })
        }
      } finally {
        cloud.geometry.setDrawRange(original.start, original.count)
        renderer.render(state.scene, state.camera)
      }
    }
    return { age: actualAge, ...full, sprites, png }
  }, { age, isolate, image: Boolean(artifactDirectory) })
  if (artifactDirectory) {
    await mkdir(artifactDirectory, { recursive: true })
    await writeFile(path.join(artifactDirectory, `${name}-particles.png`), Buffer.from(sample.png, 'base64'))
    await page.screenshot({ path: path.join(artifactDirectory, `${name}-page.png`) })
  }
  delete sample.png
  return sample
}

async function verifyEffects(page) {
  await setPanelOpen(page, true)
  const labels = await page.$$eval('.plume-effect strong', (items) => items.map((item) => item.textContent))
  requireThat(labels.join('|') === effects.map((effect) => effect.label).join('|'),
    `unexpected effect controls: ${labels.join(', ')}`)
  for (const [index, effect] of effects.entries()) {
    const selector = `.plume-effect:nth-of-type(${index + 1})`
    for (const enabled of [false, true]) {
      await page.click(selector)
      await page.waitForFunction(({ index, effect, enabled }) => {
        const input = document.querySelectorAll('.plume-effect input')[index]
        if (input?.checked !== enabled) return false
        if (effect.attribute) return document.querySelector('.plume-page').hasAttribute(effect.attribute) === enabled
        let value
        window.__r3f.scene.traverse((object) => {
          if (object.geometry?.getAttribute('aRelease')) value = object.material.uniforms[effect.uniform]?.value
        })
        return value === Number(enabled)
      }, { timeout: 3000 }, { index, effect, enabled })
    }
  }
  await setPanelOpen(page, false)
  return labels
}

async function verifyReduced(page) {
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.waitForSelector('.plume-page[data-reduced]')
  await act(page, restoreSelector)
  await putCaretAtEnd(page)
  const frame = await sampleFlight(page, 0.14, 'reduced')
  const cloud = await readCloud(page)
  requireThat(cloud.reduced === 1 && cloud.sparks === 0 &&
    cloud.duration === plumeTuning.reducedDurationMs / 1000,
  `reduced motion did not disable travel and sparks: ${JSON.stringify(cloud)}`)
  requireThat(frame.visible > 20, 'reduced-motion ink disappeared without a readable dissolve')
  await waitForGone(page)
  await requireNativeText(page, text)
  return frame.visible
}

async function revealControl(page, selector) {
  await setPanelOpen(page, true)
  const group = await page.$eval(selector, (input) => {
    const details = input.closest('details')
    return details && !details.open
      ? [...document.querySelectorAll('.tweak-group')].indexOf(details) + 1
      : 0
  })
  if (group) await page.click(`.tweak-group:nth-child(${group}) > summary`)
}

async function replaceField(page, selector, value) {
  await revealControl(page, selector)
  await page.click(selector)
  await page.keyboard.press('KeyA', { commands: ['SelectAll'] })
  await page.keyboard.type(String(value))
  await page.keyboard.press('Tab')
}

async function setNumber(page, key, value) {
  const control = numberControls.find((control) => control.key === key)
  requireThat(control, `missing numeric schema for ${key}`)
  const displayed = value * (control.displayScale ?? 1)
  await replaceField(page, `[data-plume-number="${key}"]`, displayed)
  await page.waitForFunction(({ key, displayed }) =>
    Math.abs(document.querySelector(`[data-plume-number="${key}"]`).valueAsNumber - displayed) < 1e-6,
  { timeout: 3000 }, { key, displayed })
}

function readTuningState(page) {
  return page.evaluate((uniformKeys) => {
    let cloud
    window.__r3f.scene.traverse((object) => {
      if (object.geometry?.getAttribute('aRelease')) cloud = object
    })
    const uniforms = cloud.material.uniforms
    const style = (selector) => {
      const node = document.querySelector(selector)
      const css = getComputedStyle(node)
      const box = node.getBoundingClientRect()
      return {
        family: css.fontFamily, size: Number.parseFloat(css.fontSize), weight: Number(css.fontWeight),
        leading: Number.parseFloat(css.lineHeight), spacing: Number.parseFloat(css.letterSpacing),
        align: css.textAlign, color: css.color, ink: css.getPropertyValue('--plume-ink').trim(),
        width: box.width, height: box.height,
      }
    }
    const page = getComputedStyle(document.querySelector('.plume-page'))
    return {
      uniforms: Object.fromEntries(Object.entries(uniformKeys).map(([key, name]) => [key, uniforms[name]?.value])),
      duration: uniforms.uDuration.value,
      stagger: uniforms.uStagger.value,
      wind: uniforms.uDraft.value.toArray(),
      particleColor: uniforms.uSmoke.value.getHexString(),
      sparkColor: uniforms.uEmber.value.getHexString(),
      geometry: cloud.geometry.uuid,
      ids: [...document.querySelectorAll('.plume-capture [data-munari-anchor]')]
        .map((word) => word.getAttribute('data-munari-anchor')),
      styles: ['textarea.plume-input', '.plume-mirror', '.plume-capture', '.plume-measure'].map(style),
      width: document.querySelector('.plume-work').getBoundingClientRect().width,
      background: page.backgroundColor,
      ghostOpacity: Number(page.getPropertyValue('--plume-ghost-opacity')),
      ghostBlur: Number.parseFloat(page.getPropertyValue('--plume-ghost-blur')),
      time: uniforms.uTime.value,
    }
  }, uniformKeys)
}

async function requireTuningDefaults(page) {
  const values = await page.evaluate(() => ({
    numbers: [...document.querySelectorAll('[data-plume-number]')].map((input) => ({
      key: input.dataset.plumeNumber, value: input.valueAsNumber, min: Number(input.min), max: Number(input.max),
    })),
    colors: [...document.querySelectorAll('[data-plume-color]')].map((input) => ({ key: input.dataset.plumeColor, value: input.value })),
    ranges: document.querySelectorAll('[data-plume-range]').length,
    font: document.querySelector('[data-plume-font]').value,
    releaseUnit: document.querySelector('[data-plume-release-unit]').value,
  }))
  requireThat(values.numbers.length === numberControls.length && values.ranges === numberControls.length &&
    values.colors.length === colorControls.length && values.font === plumeTuning.fontFamily &&
    values.releaseUnit === plumeTuning.releaseUnit,
  `the panel is missing tuning fields: ${JSON.stringify(values)}`)
  for (const control of numberControls) {
    const field = values.numbers.find((field) => field.key === control.key)
    const scale = control.displayScale ?? 1
    requireThat(field && Math.abs(field.value - plumeTuning[control.key] * scale) < 1e-6 &&
      field.min === control.min * scale && field.max === control.max * scale,
    `${control.key}: panel default or limits differ from authored tuning: ${JSON.stringify(field)}`)
  }
  for (const control of colorControls) requireThat(values.colors.find((field) => field.key === control.key)?.value === plumeTuning[control.key],
    `${control.key}: wrong color default`)
  await page.waitForFunction(({ keys, tuning }) => {
    let uniforms
    window.__r3f.scene.traverse((object) => {
      if (object.geometry?.getAttribute('aRelease')) uniforms = object.material.uniforms
    })
    return uniforms && Object.entries(keys).every(([key, name]) => Math.abs(uniforms[name]?.value - tuning[key]) < 1e-6)
  }, { timeout: 3000 }, { keys: uniformKeys, tuning: plumeTuning })
  const scene = await readTuningState(page)
  for (const key of Object.keys(uniformKeys)) requireThat(Math.abs(scene.uniforms[key] - plumeTuning[key]) < 1e-6,
    `${key}: the authored default never reached the shader`)
}

async function samplePointerResponse(page, damping) {
  await setNumber(page, 'draftDamping', damping)
  await setPanelOpen(page, false)
  const target = await page.$eval(inputSelector, (input) => {
    const rect = input.getBoundingClientRect()
    return { x: rect.left + rect.width * 0.1, y: rect.top + rect.height / 2 }
  })
  const before = await readTuningState(page)
  await page.mouse.move(target.x, target.y)
  const after = await page.evaluate(() => new Promise((resolve) => {
    const start = performance.now()
    const sample = () => {
      if (performance.now() - start < 240) return requestAnimationFrame(sample)
      let wind
      window.__r3f.scene.traverse((object) => {
        if (object.geometry?.getAttribute('aRelease')) wind = object.material.uniforms.uDraft.value.x
      })
      resolve({ wind, elapsed: (performance.now() - start) / 1000 })
    }
    requestAnimationFrame(sample)
  }))
  const initialError = Math.abs(before.wind[0] + 0.8)
  requireThat(initialError > 0.15, `pointer response had no displacement to measure at ${damping}/s`)
  return { damping, remaining: Math.abs(after.wind + 0.8) / initialError, elapsed: after.elapsed }
}

async function requireExpiredCloud(page, duration, name) {
  await waitForGone(page)
  const frame = await sampleFlight(page, duration, name)
  requireThat(frame.visible === 0 && frame.alphaViolations === 0,
    `${name}: particles survived the timeline: ${JSON.stringify(frame)}`)
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 120)))
  const first = await readCloud(page)
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 160)))
  const last = await readCloud(page)
  requireThat(first.time === last.time, `${name}: the particle loop did not stop after the ink vanished`)
}

async function verifyTypeTuning(page) {
  const original = await readTuningState(page)
  for (const [key, value] of [['typeScale', 1.25], ['fontWeight', 700], ['lineHeight', 1.4], ['letterSpacing', 0.015], ['textWidth', 720]]) {
    await setNumber(page, key, value)
  }
  await revealControl(page, '[data-plume-font]')
  await page.select('[data-plume-font]', 'serif')
  await setPanelOpen(page, false)
  await page.evaluate(() => document.fonts.ready)
  await waitForCloud(page)
  const type = await readTuningState(page)
  const native = type.styles[0]
  const typeMetrics = ({ color: _color, ink: _ink, ...metrics }) => metrics
  requireThat(type.ids.length === original.ids.length && type.ids.every((id) => !original.ids.includes(id)) &&
    Math.abs(native.size - original.styles[0].size * 1.25) < 0.2 && native.weight === 700 &&
    Math.abs(native.leading / native.size - 1.4) < 0.01 && Math.abs(native.spacing / native.size - 0.015) < 0.001 &&
    native.family !== original.styles[0].family && Math.abs(type.width - 720) < 1 &&
    type.styles.every((copy) => JSON.stringify(typeMetrics(copy)) === JSON.stringify(typeMetrics(native))),
  `type controls did not reach every copy with fresh anchors: ${JSON.stringify(type)}`)
  await requireNativeText(page, text, false)
}

async function verifyParticleTuning(page) {
  for (const [key, value] of [['particleSize', 4], ['sizeVariation', 0], ['particleGrowth', 1]]) await setNumber(page, key, value)
  await act(page, restoreSelector)
  const fine = await readCloud(page)
  const fineFrame = await sampleFlight(page, 2, 'tuning-pitch-2', true)
  const fineIds = (await readTuningState(page)).ids
  await setNumber(page, 'pitch', 6)
  await setPanelOpen(page, false)
  await waitForCloud(page)
  const coarse = await readCloud(page)
  const coarseState = await readTuningState(page)
  requireThat(coarse.geometry !== fine.geometry && coarse.cells < fine.cells * 0.4 && coarse.last > fine.last &&
    coarseState.ids.join('|') === fineIds.join('|') && coarseState.uniforms.particleSize === 4,
  `spacing did not safely rebuild and replay the grid: ${JSON.stringify({ fine, coarse, coarseState })}`)
  const coarseFrame = await sampleFlight(page, 2, 'tuning-pitch-6', true)
  const diameter = (frame) => frame.sprites.reduce((sum, sprite) => sum + (sprite.width + sprite.height) / 2, 0) / frame.sprites.length
  requireThat(fineFrame.sprites.length >= 8 && coarseFrame.sprites.length >= 8 &&
    Math.abs(diameter(fineFrame) - diameter(coarseFrame)) < 0.75,
  `particle diameter still depends on grid spacing: ${JSON.stringify({ fine: fineFrame.sprites, coarse: coarseFrame.sprites })}`)
  await setNumber(page, 'particleSize', 6)
  await setPanelOpen(page, false)
  const bigger = await sampleFlight(page, 2, 'tuning-size-6', true)
  requireThat((await readCloud(page)).geometry === coarse.geometry && diameter(bigger) > diameter(coarseFrame) + 1.25,
    'particle size did not enlarge the existing GPU sprites')

  await setNumber(page, 'draftStrength', 2.5)
  const slow = await samplePointerResponse(page, 0.5)
  const fast = await samplePointerResponse(page, 20)
  requireThat(slow.remaining > 0.65 && fast.remaining < 0.15 &&
    (await readTuningState(page)).uniforms.draftStrength === 2.5,
  `pointer strength or response did not reach the live cloud: ${JSON.stringify({ slow, fast })}`)
  return { fine: diameter(fineFrame), coarse: diameter(coarseFrame), bigger: diameter(bigger), slow, fast }
}

async function verifyAppearanceTuning(page) {
  const colors = { inkColor: '#244f62', backgroundColor: '#e8d5c4', particleColor: '#2f6e83', sparkColor: '#d54732' }
  for (const [key, value] of Object.entries(colors)) await replaceField(page, `[data-plume-color-hex="${key}"]`, value)
  for (const [key, value] of [['particleOpacity', 0.63], ['sparkAmount', 0.125], ['ghostOpacity', 0.23], ['ghostBlur', 3.2], ['holdMs', 1300]]) {
    await setNumber(page, key, value)
  }
  await setPanelOpen(page, false)
  await waitForCloud(page)
  const colored = await readTuningState(page)
  requireThat(colored.background === 'rgb(232, 213, 196)' && colored.styles.every((copy) => copy.ink === '#244f62') &&
    colored.styles.slice(1).every((copy) => copy.color === 'rgb(36, 79, 98)') &&
    colored.particleColor === '2f6e83' && colored.sparkColor === 'd54732' &&
    colored.uniforms.particleOpacity === 0.63 && colored.uniforms.sparkAmount === 0.125 &&
    colored.ghostOpacity === 0.23 && colored.ghostBlur === 3.2,
  `color and ghost fields did not reach page/capture/shader: ${JSON.stringify(colored)}`)
}

async function verifyCopiedTuning(page, url) {
  await browser.defaultBrowserContext().overridePermissions(new URL(url).origin,
    ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'])
  await setPanelOpen(page, true)
  await page.evaluate(() => navigator.clipboard.writeText('plume-gate-empty'))
  await page.click('[data-tweak-copy]')
  await page.waitForFunction(() => document.querySelector('.tweak-panel-feedback')?.textContent === 'Copied',
    { timeout: 3000 })
  // The panel copies a bare TS object literal, not JSON — evaluating it in
  // the page context turns it back into an object without a JSON.parse
  // that would reject the unquoted keys.
  const copied = await page.evaluate(async () => {
    const text = await navigator.clipboard.readText()
    return new Function('return ' + text)()
  })
  requireThat(copied.holdMs === 1300 && copied.particleOpacity === 0.63 &&
    copied.sparkAmount === 0.125 && copied.ghostOpacity === 0.23 &&
    copied.pitch === 6 && copied.fontFamily === 'serif' &&
    copied.releaseUnit === 'character' &&
    Object.keys(copied).length === Object.keys(plumeTuning).length,
  `Copy text changed stored units or dropped fields: ${JSON.stringify(copied)}`)
  await capturePage(page, 'tuned-controls')
}

async function verifyShortTimingAndReset(page) {
  const timingIds = (await readTuningState(page)).ids
  for (const [key, value] of [['holdMs', 100], ['durationMs', 600], ['staggerMs', 1800], ['reducedDurationMs', 150]]) {
    await setNumber(page, key, value)
  }
  await act(page, restoreSelector)
  const timing = await readTuningState(page)
  requireThat(timing.duration === 0.6 && timing.stagger === 1.8 && timing.ids.join('|') === timingIds.join('|'),
    `timing changes lost word identity or stored units: ${JSON.stringify(timing)}`)
  await requireExpiredCloud(page, 0.6, 'minimum-lifetime')
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await act(page, restoreSelector)
  await requireExpiredCloud(page, 0.15, 'minimum-reduced-lifetime')
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
  await setPanelOpen(page, true)
  await page.click('.plume-effect:first-of-type')
  await act(page, '[data-plume-reset]')
  await waitForCloud(page)
  await requireTuningDefaults(page)
  await requireNativeText(page, text, false)
  await requirePlainLayout(page, 'reset tuning')
  const restoredEffects = await page.$$eval('.plume-effect input', (inputs) => inputs.map((input) => input.checked))
  requireThat(restoredEffects.every((value, index) => value === Object.values(defaultPlumeEffects)[index]),
    'Reset all did not restore the effect switches')
}

const hexRgb = (hex) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16))

function hueOf(rgb) {
  const [red, green, blue] = rgb.map((value) => value / 255)
  const high = Math.max(red, green, blue)
  const low = Math.min(red, green, blue)
  const delta = high - low
  if (delta < 1e-6) return { hue: 0, chroma: 0 }
  const sextant = high === red
    ? ((green - blue) / delta + 6) % 6
    : high === green ? (blue - red) / delta + 2 : (red - green) / delta + 4
  return { hue: sextant * 60, chroma: delta / high }
}

function hueGap(left, right) {
  const gap = Math.abs(left - right) % 360
  return gap > 180 ? 360 - gap : gap
}

/** Alpha-weighted mean of the straight colour behind a premultiplied frame. */
function meanInk(frame) {
  const alpha = frame.sum[3]
  return [0, 1, 2].map((channel) => frame.sum[channel] * 255 / alpha)
}

// Colour retention, measured 2026-08-31: a sprite's base colour is the
// captured texel's own, recovered by unpremultiplying, not a swatch. Purple
// ink with tint at 0 must arrive as purple smoke and stay far from the
// particle swatch's hue; at 100% it must arrive as the swatch. The page
// colour stays a near-neutral so depth fog cannot supply the hue.
async function verifyColorRetention(page) {
  const ink = '#6a2a7a'
  const swatch = '#d8641f'
  // A neutral stand-in for the duration of this section only — the authored
  // wisteria ground comes back below so the plain-layout pin holds after.
  for (const [key, value] of [['inkColor', ink], ['particleColor', swatch], ['backgroundColor', '#e7ecee']]) {
    await replaceField(page, `[data-plume-color-hex="${key}"]`, value)
  }
  await setNumber(page, 'sparkAmount', 0)
  await setPanelOpen(page, false)
  await waitForCloud(page)
  await act(page, restoreSelector)
  const kept = hueOf(meanInk(await sampleFlight(page, 1, 'color-kept')))
  await setNumber(page, 'tint', 1)
  await act(page, restoreSelector)
  const tinted = hueOf(meanInk(await sampleFlight(page, 1, 'color-tinted')))
  const inkHue = hueOf(hexRgb(ink)).hue
  const swatchHue = hueOf(hexRgb(swatch)).hue
  const measured = { kept, tinted, inkHue, swatchHue }
  requireThat(kept.chroma > 0.12 && hueGap(kept.hue, inkHue) <= 20 && hueGap(kept.hue, swatchHue) > 60,
    `particles lost the captured ink colour: ${JSON.stringify(measured)}`)
  requireThat(tinted.chroma > 0.12 && hueGap(tinted.hue, swatchHue) <= 20,
    `full tint did not reach the particle swatch: ${JSON.stringify(measured)}`)
  await setNumber(page, 'tint', 0)
  await replaceField(page, '[data-plume-color-hex="backgroundColor"]', '#e5ddea')
  await setPanelOpen(page, false)
  return { kept: kept.hue, tinted: tinted.hue, ink: inkHue, swatch: swatchHue }
}

// Character mode, measured 2026-08-31: one anchor and one clock per
// non-whitespace grapheme, so a word typed over two seconds leaves letter by
// letter. Word mode stamps one clock per word, so the distinct-clock count
// in the live buffer is what separates the two settings.
async function verifyCharacterRelease(page) {
  await revealControl(page, '[data-plume-release-unit]')
  await page.select('[data-plume-release-unit]', 'character')
  await setPanelOpen(page, false)
  await act(page, clearSelector)
  const expected = marks(text)
  await page.click(inputSelector)
  const started = Date.now()
  await page.keyboard.type(text, { delay: 40 })
  const typedMs = Date.now() - started
  await page.waitForFunction((value) => document.querySelector('textarea.plume-input')?.value === value,
    undefined, text)
  await waitForCloud(page)
  await page.waitForFunction((expected) =>
    document.querySelectorAll('.plume-capture [data-munari-anchor]').length === expected,
  { timeout: 6000 }, expected)
  await page.waitForFunction((expected) => {
    let clocks = 0
    window.__r3f.scene.traverse((object) => {
      const releases = object.geometry?.getAttribute('aRelease')?.array
      if (!releases) return
      const seen = new Set()
      for (let index = 0; index < releases.length; index += 4) {
        if (releases[index] < 1e8) seen.add(releases[index])
      }
      clocks = seen.size
    })
    return clocks >= expected * 0.5
  }, { timeout: 8000 }, expected)
  const cloud = await readCloud(page)
  const anchors = (await readTuningState(page)).ids.length
  // One getBoundingClientRect per anchor per paint is the cost of the
  // per-character ledger; the number below is what keeps it off the budget.
  const rects = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.plume-capture [data-munari-anchor]')]
    const samples = []
    for (let pass = 0; pass < 5; pass++) {
      const start = performance.now()
      for (const span of spans) span.getBoundingClientRect()
      samples.push(performance.now() - start)
    }
    return { count: spans.length, ms: samples.sort((left, right) => left - right)[2] }
  })
  const spread = cloud.last - cloud.first
  requireThat(anchors === expected && cloud.clocks >= expected * 0.5,
    `character mode did not give every mark its own anchor and clock: ${JSON.stringify({ expected, anchors, cloud })}`)
  requireThat(spread >= (typedMs - plumeTuning.holdMs) / 1000,
    `character clocks did not follow typing order: ${spread.toFixed(2)}s over ${typedMs}ms of typing`)
  await requirePlainLayout(page, 'character release')
  const frame = await sampleFlight(page, 2, 'character-flight-2s', true)
  requireThat(frame.visible > 150 && frame.alphaViolations === 0 && frame.sprites.length >= 8 &&
    frame.sprites.every((sprite) => Math.max(sprite.width, sprite.height) <= SPRITE_CAP &&
      Math.max(sprite.width, sprite.height) / Math.min(sprite.width, sprite.height) <= 2.5),
  `character-mode sprites failed the puff shape clause: ${JSON.stringify(frame.sprites)}`)
  const before = await readCloud(page)
  await act(page, restoreSelector)
  await page.waitForFunction((previous) => {
    let fresh = false
    window.__r3f.scene.traverse((object) => {
      const releases = object.geometry?.getAttribute('aRelease')?.array
      if (releases) fresh = releases.some((value) => value < 1e8 && value > previous + 1)
    })
    return fresh
  }, { timeout: 4000 }, before.last)
  const replay = await readCloud(page)
  requireThat(replay.geometry === before.geometry && replay.count === before.count,
    'Restore rebuilt the character cloud instead of restamping its live buffer')
  await revealControl(page, '[data-plume-release-unit]')
  await page.select('[data-plume-release-unit]', 'word')
  await setPanelOpen(page, false)
  return { marks: expected, clocks: cloud.clocks, spread, typedMs, rects }
}

async function verifyTuning(page, url) {
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
  await enterText(page, text)
  await waitForCloud(page)
  await requireTuningDefaults(page)
  await verifyTypeTuning(page)
  const particles = await verifyParticleTuning(page)
  await verifyAppearanceTuning(page)
  await verifyCopiedTuning(page, url)
  await verifyShortTimingAndReset(page)
  const color = await verifyColorRetention(page)
  const characters = await verifyCharacterRelease(page)
  // Two selects sit beside the numbers and colors: typeface and release unit.
  return { fields: numberControls.length + colorControls.length + 2, ...particles, color, characters }
}

async function verifyMobile(instance, url) {
  const page = await openPage(instance, url)
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
  await page.waitForSelector('.plume-page:not([data-degraded])')
  await waitForCloud(page)
  await verifyPanel(page)
  const intrinsic = await verifyIntrinsicSize(page)
  await enterText(page, 'Small particles\nbecome air.')
  await waitForCloud(page)
  const layout = await requirePlainLayout(page, '390px mobile')
  await captureHeld(page, 'mobile-held')
  const frame = await sampleFlight(page, 2, 'mobile-flight-2s')
  requireThat(frame.visible > 150 && frame.alphaViolations === 0,
    `mobile ink did not become visible premultiplied particles: ${JSON.stringify(frame)}`)
  await putCaretAtEnd(page)
  await requireNativeText(page, 'Small particles\nbecome air.')
  await page.close()
  return { width: layout.width, centerError: layout.centerError, pixels: frame.visible, intrinsic }
}

async function verifyFallback(url, headless) {
  fallbackBrowser = await launch(headless, false)
  if (await capable(fallbackBrowser)) {
    console.warn('plume no-flag clause SKIPPED: Chrome already has HTML-in-canvas without the flag')
    return false
  }
  const page = await openPage(fallbackBrowser, url)
  await page.waitForSelector('.plume-page[data-degraded]')
  await verifyPanel(page)
  await verifyIntrinsicSize(page, false)
  await enterText(page, text)
  await requirePlainLayout(page, 'no-flag fallback', false)
  await captureHeld(page, 'fallback-held')
  await putCaretAtEnd(page)
  await requireNativeText(page, text)
  requireThat(await page.$('.plume-canvas') === null, 'no-flag route mounted a WebGL overlay')
  await page.waitForFunction(() => [...document.querySelectorAll('.plume-mirror .plume-word')]
    .every((word) => word.dataset.phase !== 'held' && Number(getComputedStyle(word).opacity) < 0.001),
  { timeout: plumeTuning.holdMs + 3000 })
  await requireNativeText(page, text)
  await act(page, restoreSelector)
  await page.waitForSelector('.plume-mirror .plume-word[data-phase="held"]')
  await act(page, clearSelector)
  await requireNativeText(page, '', false)
  requireThat(await page.$('.plume-mirror .plume-word') === null, 'Clear left visible fallback ink')
  await page.close()
  return true
}

async function run() {
  if (!chromePath) return skip('no Chrome executable found (set CHROME_PATH)')
  const headless = process.env.HEADED !== '1'
  browser = await launch(headless)
  if (!await capable(browser)) return skip(`Chrome at ${chromePath} has no HTML-in-canvas`)
  server = await createServer({
    root: path.join(repoRoot, 'apps', 'lab'),
    configFile: path.join(repoRoot, 'apps', 'lab', 'vite.config.ts'),
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  const url = `http://127.0.0.1:${server.httpServer.address().port}/?scene=plume&framed`
  const page = await openPage(browser, url)
  await page.waitForSelector('.plume-page:not([data-degraded])')
  await waitForCloud(page)
  await verifyPanel(page)
  const intrinsic = await verifyIntrinsicSize(page)
  await enterText(page, text)
  await waitForCloud(page)
  const layout = await requirePlainLayout(page, 'desktop')
  await captureHeld(page, 'held')
  await putCaretAtEnd(page)
  const before = await readCloud(page)
  await requireNativeText(page, text)

  const frames = []
  for (const age of [0.5, 2, 4]) frames.push(await sampleFlight(page, age, `flight-${age}s`, age === 4))
  requireThat(frames.every((frame) => frame.visible > 150 && frame.width > 80 && frame.height > 35),
    `the live ink did not become a visible cloud: ${JSON.stringify(frames)}`)
  const sprites = frames.at(-1).sprites
  requireThat(sprites.length >= 8 && sprites.every((sprite) =>
    Math.max(sprite.width, sprite.height) <= SPRITE_CAP &&
    Math.max(sprite.width, sprite.height) / Math.min(sprite.width, sprite.height) <= 2.5),
  `particles still read as stretched threads: ${JSON.stringify(sprites)}`)
  // Both the captured ink and the two authored tints are bounded colors.
  // Encoding premultiplied linear RGB before its coverage fade used to
  // lift edge channels above alpha and draw a pale halo over the page.
  requireThat(frames.every((frame) => frame.alphaViolations === 0) &&
    sprites.every((sprite) => sprite.alphaViolations === 0),
  `particle tint broke premultiplied alpha: ${JSON.stringify(frames)}`)
  const labels = await verifyEffects(page)
  await putCaretAtEnd(page)
  await waitForGone(page)
  await requireNativeText(page, text)
  const gone = await sampleFlight(page, plumeTuning.durationMs / 1000, 'gone')
  requireThat(gone.visible === 0, `finished ink left ${gone.visible} WebGL pixels`)

  await act(page, restoreSelector)
  await page.waitForFunction((previous) => {
    let fresh = false
    window.__r3f.scene.traverse((object) => {
      const releases = object.geometry?.getAttribute('aRelease')?.array
      if (releases) fresh = releases.some((value) => value < 1e8 && value > previous + 1)
    })
    return fresh
  }, { timeout: 3000 }, before.last)
  const replay = await readCloud(page)
  requireThat(replay.geometry === before.geometry && replay.count === before.count,
    'Restore rebuilt the cloud instead of restamping its live buffer')
  const replayFrame = await sampleFlight(page, 0.5, 'replay')
  requireThat(replayFrame.visible > 150, 'Restore changed clocks but did not visibly replay ink')
  const reducedPixels = await verifyReduced(page)
  await act(page, clearSelector)
  await requireNativeText(page, '', false)
  requireThat(await page.$('.plume-mirror .plume-word') === null, 'Clear left words in the mirror')
  await page.waitForFunction(() => {
    let clear = false
    window.__r3f.scene.traverse((object) => {
      const releases = object.geometry?.getAttribute('aRelease')?.array
      if (releases) clear = releases.every((value) => value >= 1e8)
    })
    return clear
  }, { timeout: 3000 })
  const tuning = await verifyTuning(page, url)
  await page.close()
  const mobile = await verifyMobile(browser, url)
  const fallback = await verifyFallback(url, headless)
  requireThat(errors.length === 0, `browser errors: ${errors.join('\n')}`)
  console.log(`plume gate PASSED: ${frames.map((frame) => `${frame.age.toFixed(2)}s ${frame.visible}px`).join(', ')}; ` +
    `${sprites.length} isolated round sprites, longest edge ${Math.max(...sprites.map((sprite) => Math.max(sprite.width, sprite.height)))}px, valid premultiplied alpha; ` +
    `native value and caret retained; same-buffer Restore ${before.last.toFixed(2)} → ${replay.last.toFixed(2)}s; ` +
    `${labels.join(', ')} controls; reduced-motion dissolve ${reducedPixels}px; Clear; ` +
    `plain centered desktop (${layout.centerError.toFixed(2)}px) and ${mobile.width}px mobile (${mobile.centerError.toFixed(2)}px); ` +
    `intrinsic height ${intrinsic.short.toFixed(1)} → ${intrinsic.multiple.toFixed(1)} → ${intrinsic.long.toFixed(1)}px; ` +
    `native scroll ${intrinsic.scroll.toFixed(1)}px, mobile ${mobile.intrinsic.scroll.toFixed(1)}px; ` +
    `${tuning.fields} tuning fields; particle spacing ${tuning.fine.toFixed(2)} → ${tuning.coarse.toFixed(2)}px, size ${tuning.bigger.toFixed(2)}px; ` +
    `pointer remainder ${tuning.slow.remaining.toFixed(2)} → ${tuning.fast.remaining.toFixed(2)}; short lifetime/Copy JSON/reset; ` +
    `ink hue ${tuning.color.ink.toFixed(0)}° kept at ${tuning.color.kept.toFixed(0)}°, tinted to ${tuning.color.tinted.toFixed(0)}° toward ${tuning.color.swatch.toFixed(0)}°; ` +
    `${tuning.characters.marks} character anchors, ${tuning.characters.clocks} clocks over ${tuning.characters.spread.toFixed(2)}s of ${(tuning.characters.typedMs / 1000).toFixed(2)}s typing, ` +
    `${tuning.characters.rects.count} anchor rects in ${tuning.characters.rects.ms.toFixed(2)}ms; ` +
    `no-flag ${fallback ? 'passed' : 'skipped'}`)
}

let deadline
try {
  await Promise.race([
    run(),
    new Promise((_, reject) => {
      // 2026-08-31: the colour-retention and character-mode sections added
      // about 25s of real typing and flight waits to a 75s run.
      deadline = setTimeout(() => reject(new Error('hard 150s deadline hit')), 150_000)
    }),
  ])
} catch (error) {
  console.error(`plume gate FAILED: ${error.message}`)
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
  await Promise.allSettled([browser?.close(), fallbackBrowser?.close(), server?.close()])
}
