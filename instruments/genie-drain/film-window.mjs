// film-window — does one film source survive repeated custody changes?
//
// The film has one decoder and one canvas. The canvas is visible in the DOM
// at rest and is the CanvasTexture source in flight. This gate uses the
// controller's DOM data attributes and Chrome's composited output. It checks
// identity, frame progress, media continuity, visual coverage, and landings
// across enough round trips to expose a later-cycle race.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const labRoot = path.join(here, '..', '..', 'apps', 'lab')
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]
  .filter(Boolean)
  .find((candidate) => existsSync(candidate))

const WIN = 'triangolo'
const ROUNDS = Number(process.env.ROUNDS || 24)
const SLOWCPU = Number(process.env.SLOWCPU ?? 6)
const VIEWPORT = { width: 1100, height: 800, deviceScaleFactor: 1 }
const CAPTURE = { format: 'jpeg', quality: 92, maxWidth: 1100, maxHeight: 800 }
const SETTLE_MS = Number(process.env.SETTLE_MS || 140)
const POUR_AT_WALL = 0.025
// Screencast frames are timestamped in the browser process, while the source
// recorder runs on a CPU-throttled page rAF. Search enough nearby source
// samples to cover that deliberate scheduling skew; a desk-colored hole still
// cannot match any of the moving film samples.
const SOURCE_WINDOW_MS = Math.max(85, SLOWCPU * 45)
const SCREEN_DARK_LUMA = 20
const SCREEN_DARK_MAX = 0.72
const MIN_BASELINE_FRAMES = 2
const MIN_BOUNDARY_FRAMES = 1
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (!CHROME) throw new Error('film-window: Chrome was not found; set CHROME_PATH')
if (!Number.isInteger(ROUNDS) || ROUNDS < 1) {
  throw new Error(`film-window: ROUNDS must be a positive integer, got ${ROUNDS}`)
}

let browser
let server
let exitCode = 0
const problems = []
const pageErrors = []
const deadline = setTimeout(() => {
  console.error('film-window: hard 240s deadline hit')
  process.exit(1)
}, 240_000)

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--enable-features=CanvasDrawElement',
      '--disable-renderer-backgrounding',
      '--autoplay-policy=no-user-gesture-required',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })
  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  const page = await browser.newPage()
  await page.setViewport(VIEWPORT)
  page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error)))
  page.on('console', (message) => {
    // A bare Vite root has no favicon. Resource 404s are browser noise; a
    // broken module still reports a page error or a Vite overlay error.
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) {
      pageErrors.push(`console: ${message.text()}`)
    }
  })
  await page.goto(`http://localhost:${port}/?scene=genie`, { waitUntil: 'load' })
  await page.waitForFunction(
    () => {
      const decoder = document.querySelector('[data-genie-film-role="decoder"]')
      const canvas = document.querySelector('[data-genie-film-role="canvas"]')
      return (
        document.fonts.status === 'loaded' &&
        decoder instanceof HTMLVideoElement &&
        decoder.dataset.genieFilmAttached === 'true' &&
        decoder.readyState >= 2 &&
        !decoder.paused &&
        decoder.currentTime > 0 &&
        canvas instanceof HTMLCanvasElement &&
        canvas.dataset.genieFilmAttached === 'true' &&
        canvas.dataset.genieFilmReady === 'true' &&
        Number(canvas.dataset.genieFilmGeneration) > 0 &&
        Number(canvas.dataset.genieFilmDrawCount) > 0
      )
    },
    { timeout: 20_000 },
  )

  // Bring the film to the front. The fixed film rectangle must not be hidden
  // by another desk window when the compositor screenshots are sampled.
  const exposedTitlebar = await page.evaluate((win) => {
    const bar = document.querySelector(`.gen-slot[data-win="${win}"] .gen-titlebar`)
    const slot = bar?.closest('.gen-slot')
    if (!bar || !slot) return null
    const rect = bar.getBoundingClientRect()
    const y = Math.round(rect.top + rect.height / 2)
    for (let x = Math.round(rect.right) - 4; x > rect.left; x -= 4) {
      const hit = document.elementFromPoint(x, y)
      if (hit && slot.contains(hit) && !hit.closest('.gen-lamp')) return { x, y }
    }
    return null
  }, WIN)
  if (!exposedTitlebar) throw new Error('film-window: no exposed film titlebar point')
  await page.mouse.click(exposedTitlebar.x, exposedTitlebar.y)
  await page.waitForFunction(
    (win) => document.querySelector(`.gen-slot[data-win="${win}"] .gen-sheet`)?.dataset.front === 'true',
    { timeout: 3000 },
    WIN,
  )
  await sleep(250)

  // The recorder keeps object references in the page so a replacement cannot
  // pass by copying an attribute. Attribute mutations catch short freeze and
  // generation states that can begin and end between two animation frames.
  await page.evaluate((win) => {
    const decoder = document.querySelector('[data-genie-film-role="decoder"]')
    const canvas = document.querySelector('[data-genie-film-role="canvas"]')
    if (!(decoder instanceof HTMLVideoElement) || !(canvas instanceof HTMLCanvasElement)) {
      throw new Error('film-window recorder could not find its decoder and canvas')
    }

    const sample = document.createElement('canvas')
    sample.width = 13
    sample.height = 9
    const sampleContext = sample.getContext('2d', { alpha: false, willReadFrequently: true })
    const gate = {
      decoder,
      canvas,
      phase: 'idle',
      stopped: false,
      trace: [],
      changes: [],
      events: [],
      probes: [],
      identityFaults: [],
      lastMediaTime: decoder.currentTime,
      loopSeekPending: false,
      loopWindowUntil: 0,
      source: null,
    }

    const sourcePixels = () => {
      sampleContext.drawImage(canvas, 0, 0, sample.width, sample.height)
      const data = sampleContext.getImageData(0, 0, sample.width, sample.height).data
      const pixels = []
      // Keep the sample away from rounded corners and window chrome.
      for (let y = 2; y <= 6; y++) {
        for (let x = 2; x <= 10; x++) {
          const offset = (y * sample.width + x) * 4
          pixels.push(data[offset], data[offset + 1], data[offset + 2])
        }
      }
      return pixels
    }

    const read = () => {
      const decoders = [...document.querySelectorAll('[data-genie-film-role="decoder"]')]
      const canvases = [...document.querySelectorAll('[data-genie-film-role="canvas"]')]
      const slot = document.querySelector(`.gen-slot[data-win="${win}"]`)
      const tile = document.querySelector(`.gen-tile[data-win="${win}"]`)
      const rect = canvas.getBoundingClientRect()
      const generation = Number(canvas.dataset.genieFilmGeneration)
      const drawCount = Number(canvas.dataset.genieFilmDrawCount)
      const presentedFrames = Number(canvas.dataset.genieFilmPresentedFrames)
      gate.lastMediaTime = decoder.currentTime
      gate.trace.push({
        t: Date.now(),
        phase: gate.phase,
        decoderCount: decoders.length,
        canvasCount: canvases.length,
        sameDecoder: decoders[0] === decoder,
        sameCanvas: canvases[0] === canvas,
        sourceId: canvas.dataset.genieFilmSourceId ?? null,
        generation,
        drawCount,
        presentedFrames,
        mediaTime: Number(canvas.dataset.genieFilmMediaTime),
        currentTime: decoder.currentTime,
        readyState: decoder.readyState,
        paused: decoder.paused,
        attached: canvas.dataset.genieFilmAttached === 'true',
        ready: canvas.dataset.genieFilmReady === 'true',
        frozen: canvas.dataset.genieFilmFrozen === 'true',
        error: canvas.dataset.genieFilmError ?? null,
        away: slot?.dataset.away === 'true',
        filled: tile?.dataset.filled === 'true',
        pour: Number.parseFloat(tile?.style.getPropertyValue('--pour') || '0') || 0,
        progress:
          Number.parseFloat(tile?.style.getPropertyValue('--gen-progress') || '0') || 0,
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        sourcePixels: sourcePixels(),
      })
    }

    const attributeNames = [
      'data-genie-film-generation',
      'data-genie-film-frozen',
      'data-genie-film-ready',
      'data-genie-film-draw-count',
    ]
    new MutationObserver((records) => {
      const relevant = records.filter((record) => attributeNames.includes(record.attributeName))
      for (let i = 0; i < relevant.length; i++) {
        const record = relevant[i]
        let next = canvas.getAttribute(record.attributeName)
        for (let j = i + 1; j < relevant.length; j++) {
          if (relevant[j].attributeName === record.attributeName) {
            next = relevant[j].oldValue
            break
          }
        }
        gate.changes.push({
          t: Date.now(),
          phase: gate.phase,
          name: record.attributeName,
          old: record.oldValue,
          next,
        })
      }
    }).observe(canvas, { attributes: true, attributeOldValue: true, attributeFilter: attributeNames })

    const roleIdentity = () => {
      const decoders = [...document.querySelectorAll('[data-genie-film-role="decoder"]')]
      const canvases = [...document.querySelectorAll('[data-genie-film-role="canvas"]')]
      if (
        decoders.length !== 1 ||
        canvases.length !== 1 ||
        decoders[0] !== decoder ||
        canvases[0] !== canvas ||
        !decoder.isConnected ||
        !canvas.isConnected
      ) {
        gate.identityFaults.push({
          t: Date.now(),
          phase: gate.phase,
          decoderCount: decoders.length,
          canvasCount: canvases.length,
          sameDecoder: decoders[0] === decoder,
          sameCanvas: canvases[0] === canvas,
          decoderConnected: decoder.isConnected,
          canvasConnected: canvas.isConnected,
        })
      }
    }
    new MutationObserver(roleIdentity).observe(document.documentElement, { childList: true, subtree: true })

    const mediaEvents = ['seeking', 'seeked', 'pause', 'waiting', 'stalled', 'emptied', 'abort']
    for (const type of mediaEvents) {
      decoder.addEventListener(type, () => {
        const nearLoopStart = decoder.loop && decoder.currentTime < 0.25
        const wasNearLoopEnd = gate.lastMediaTime > decoder.duration - 0.75
        const loopMediaEvent = type === 'seeking' || type === 'seeked' || type === 'waiting'
        const now = Date.now()
        const automaticLoop =
          loopMediaEvent &&
          ((type === 'seeking' && nearLoopStart) ||
            (type === 'waiting' && (nearLoopStart || wasNearLoopEnd)) ||
            (type === 'seeked' && (nearLoopStart || gate.loopSeekPending)) ||
            now <= gate.loopWindowUntil)
        if (type === 'seeking') gate.loopSeekPending = automaticLoop
        if (type === 'seeked') gate.loopSeekPending = false
        if (automaticLoop) gate.loopWindowUntil = now + 1500
        gate.events.push({
          t: now,
          phase: gate.phase,
          type,
          currentTime: decoder.currentTime,
          readyState: decoder.readyState,
          automaticLoop,
        })
      })
    }

    // Genie calls this narrow lab hook at each protocol edge. DOM state still
    // proves what was visible; this tuple proves which upload/draw receipt
    // opened that state gate.
    window.__genieFilmProbe = (event) => {
      const base = {
        seq: gate.probes.length,
        t: Date.now(),
        phase: gate.phase,
        type: event.type,
        token: event.token,
      }
      if (event.type === 'require') {
        if (gate.source && gate.source !== event.source) {
          gate.identityFaults.push({ t: base.t, phase: base.phase, differentSourceObject: true })
        }
        gate.source ??= event.source
        gate.probes.push({
          ...base,
          direction: event.direction,
          frame: event.frame,
          presentationRevision: event.presentationRevision,
          sourceId: event.source.currentFrame().sourceId,
          sameSourceObject: event.source === gate.source,
          sameSourceCanvas: event.source.canvas === canvas,
          sameCanvas: event.canvas === canvas,
          sameVideo: event.video === decoder,
        })
        return
      }
      if (event.type === 'receipt' || event.type === 'accept' || event.type === 'present') {
        gate.probes.push({ ...base, receipt: event.receipt })
        return
      }
      if (event.type === 'surface') {
        gate.probes.push({ ...base, stage: event.stage })
        return
      }
      if (event.type === 'land' || event.type === 'release') {
        gate.probes.push({ ...base, wall: event.wall, frame: event.frame ?? null })
        return
      }
      if (event.type === 'revoke') {
        gate.probes.push({ ...base, reason: event.reason })
        return
      }
      gate.probes.push({ ...base, frame: event.frame })
    }

    const tick = () => {
      if (gate.stopped) return
      read()
      requestAnimationFrame(tick)
    }
    window.__filmWindowGate = gate
    requestAnimationFrame(tick)
  }, WIN)

  const client = await page.createCDPSession()
  if (SLOWCPU > 1) await client.send('Emulation.setCPUThrottlingRate', { rate: SLOWCPU })
  const screenshots = []
  let capturePhase = 'idle'
  let castRunning = true
  client.on('Page.screencastFrame', async (frame) => {
    if (capturePhase !== 'idle') {
      screenshots.push({
        data: frame.data,
        t: Date.now(),
        mediaTimestamp: frame.metadata.timestamp,
        phase: capturePhase,
      })
    }
    try {
      await client.send('Page.screencastFrameAck', { sessionId: frame.sessionId })
    } catch {
      if (castRunning) throw new Error('film-window: failed to acknowledge a screencast frame')
    }
  })
  await client.send('Page.startScreencast', { everyNthFrame: 1, ...CAPTURE })

  const setPhase = async (phase) => {
    capturePhase = phase
    await page.evaluate((next) => {
      window.__filmWindowGate.phase = next
    }, phase)
  }
  const pressKey = async (selector, where) => {
    const focused = await page.evaluate((value) => {
      const element = document.querySelector(value)
      if (!element) return false
      element.focus()
      return document.activeElement === element
    }, selector)
    if (!focused) throw new Error(`${where}: ${selector} did not take focus`)
    await page.keyboard.press('Enter')
  }
  const waitLanding = async (filled, away, where) => {
    try {
      await page.waitForFunction(
        (win, expectedFilled, expectedAway) => {
          const tile = document.querySelector(`.gen-tile[data-win="${win}"]`)
          const slot = document.querySelector(`.gen-slot[data-win="${win}"]`)
          const canvas = document.querySelector('[data-genie-film-role="canvas"]')
          return (
            tile?.dataset.filled === expectedFilled &&
            (slot?.dataset.away === 'true') === expectedAway &&
            canvas?.dataset.genieFilmFrozen === 'false'
          )
        },
        { timeout: 10_000 },
        WIN,
        String(filled),
        away,
      )
    } catch {
      const state = await page.evaluate((win) => {
        const tile = document.querySelector(`.gen-tile[data-win="${win}"]`)
        const slot = document.querySelector(`.gen-slot[data-win="${win}"]`)
        const canvas = document.querySelector('[data-genie-film-role="canvas"]')
        return {
          filled: tile?.dataset.filled,
          away: slot?.dataset.away,
          pour: tile?.style.getPropertyValue('--pour'),
          frozen: canvas?.dataset.genieFilmFrozen,
          generation: canvas?.dataset.genieFilmGeneration,
          error: canvas?.dataset.genieFilmError,
          probes: window.__filmWindowGate?.probes,
        }
      }, WIN)
      throw new Error(`${where}: landing timed out: ${JSON.stringify(state)}`)
    }
  }

  // Establish the normal DOM canvas-to-screen error before a custody swap.
  await setPhase('baseline')
  await sleep(450)
  await setPhase('idle')

  const cycles = []
  for (let cycle = 0; cycle < ROUNDS; cycle++) {
    const downPhase = `minimize:${cycle}`
    await setPhase(downPhase)
    const downStart = Date.now()
    await pressKey(
      `.gen-slot[data-win="${WIN}"] .gen-lamp[data-role="minimize"]`,
      `cycle ${cycle + 1} minimize`,
    )
    await waitLanding(true, true, `cycle ${cycle + 1} minimize`)
    const downEnd = Date.now()
    await sleep(SETTLE_MS)

    const upPhase = `restore:${cycle}`
    await setPhase(upPhase)
    const upStart = Date.now()
    await pressKey(`.gen-tile[data-win="${WIN}"]`, `cycle ${cycle + 1} restore`)
    await waitLanding(false, false, `cycle ${cycle + 1} restore`)
    const upEnd = Date.now()
    await sleep(SETTLE_MS)
    await setPhase('idle')
    cycles.push({ cycle, downPhase, downStart, downEnd, upPhase, upStart, upEnd })
  }

  // Post-commit invalidation: once WebGL owns the film, revoke its context.
  // The native canvas must return without waiting for another renderer draw.
  const contextLossPhase = 'context-loss'
  await setPhase(contextLossPhase)
  await pressKey(
    `.gen-slot[data-win="${WIN}"] .gen-lamp[data-role="minimize"]`,
    'context-loss minimize',
  )
  await page.waitForFunction(
    (win) => {
      const pageRoot = document.querySelector('.gen-page')
      const slot = document.querySelector(`.gen-slot[data-win="${win}"]`)
      return (
        pageRoot?.dataset.genieFilmShown === 'true' &&
        pageRoot?.dataset.genieFilmDirection === 'minimizing' &&
        slot?.dataset.away === 'true'
      )
    },
    { timeout: 10_000 },
    WIN,
  )
  const contextLossStart = Date.now()
  const contextLossSupported = await page.evaluate(() => {
    const canvas = document.querySelector('.gen-overlay canvas')
    if (!(canvas instanceof HTMLCanvasElement)) return false
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl')
    const extension = context?.getExtension('WEBGL_lose_context')
    if (!extension) return false
    extension.loseContext()
    return true
  })
  if (!contextLossSupported) {
    problems.push('WEBGL_lose_context is not available for the Genie renderer')
  } else {
    await page.waitForFunction(
      (win) => {
        const pageRoot = document.querySelector('.gen-page')
        const slot = document.querySelector(`.gen-slot[data-win="${win}"]`)
        const tile = document.querySelector(`.gen-tile[data-win="${win}"]`)
        const canvas = document.querySelector('[data-genie-film-role="canvas"]')
        return (
          pageRoot?.dataset.genieFilmDirection === undefined &&
          slot?.dataset.away !== 'true' &&
          tile?.dataset.filled === 'false' &&
          canvas?.dataset.genieFilmFrozen === 'false'
        )
      },
      { timeout: 3000 },
      WIN,
    )
  }
  const contextLossEnd = Date.now()
  await sleep(250)
  await setPhase('idle')

  castRunning = false
  await client.send('Page.stopScreencast')
  await page.evaluate(() => {
    window.__filmWindowGate.stopped = true
  })
  const evidence = await page.evaluate(() => {
    const gate = window.__filmWindowGate
    const last = gate.trace.at(-1)
    return {
      trace: gate.trace,
      changes: gate.changes,
      events: gate.events,
      probes: gate.probes,
      identityFaults: gate.identityFaults,
      final: last,
    }
  })
  const contextLoss = {
    phase: contextLossPhase,
    supported: contextLossSupported,
    start: contextLossStart,
    end: contextLossEnd,
  }

  // Decode screenshots in the page. Samples use the same normalized grid as
  // the source canvas recorder. This finds a transparent hole as well as a
  // black texture: both differ from the source picture at the custody wall.
  await page.evaluate(() => {
    window.__readFilmScreens = async (batch) => {
      const output = []
      for (const item of batch) {
        const image = new Image()
        image.src = `data:image/jpeg;base64,${item.data}`
        await image.decode()
        const bitmap = new OffscreenCanvas(image.width, image.height)
        const context = bitmap.getContext('2d', { alpha: false, willReadFrequently: true })
        context.drawImage(image, 0, 0)
        const pixels = []
        const sx = image.width / window.innerWidth
        const sy = image.height / window.innerHeight
        for (let y = 2; y <= 6; y++) {
          for (let x = 2; x <= 10; x++) {
            const px = Math.max(
              0,
              Math.min(image.width - 1, Math.round((item.rect.x + ((x + 0.5) / 13) * item.rect.w) * sx)),
            )
            const py = Math.max(
              0,
              Math.min(image.height - 1, Math.round((item.rect.y + ((y + 0.5) / 9) * item.rect.h) * sy)),
            )
            const value = context.getImageData(px, py, 1, 1).data
            pixels.push(value[0], value[1], value[2])
          }
        }
        output.push({ id: item.id, pixels })
      }
      return output
    }
  })

  const nearestTrace = (shot) => {
    let nearest = null
    let distance = Infinity
    for (const row of evidence.trace) {
      if (row.phase !== shot.phase) continue
      const nextDistance = Math.abs(row.t - shot.t)
      if (nextDistance < distance) {
        nearest = row
        distance = nextDistance
      }
    }
    return distance <= SOURCE_WINDOW_MS ? nearest : null
  }
  const screenInputs = screenshots
    .map((shot, id) => ({ ...shot, id, state: nearestTrace(shot) }))
    .filter((shot) => shot.state)
    .map((shot) => ({ id: shot.id, data: shot.data, rect: shot.state.rect }))
  const screenPixels = new Map()
  for (let offset = 0; offset < screenInputs.length; offset += 20) {
    const batch = await page.evaluate(
      (items) => window.__readFilmScreens(items),
      screenInputs.slice(offset, offset + 20),
    )
    for (const item of batch) screenPixels.set(item.id, item.pixels)
  }

  const mae = (left, right) => {
    let total = 0
    for (let i = 0; i < left.length; i++) total += Math.abs(left[i] - right[i])
    return total / left.length
  }
  const darkShare = (pixels) => {
    let dark = 0
    for (let i = 0; i < pixels.length; i += 3) {
      const luma = (pixels[i] * 77 + pixels[i + 1] * 150 + pixels[i + 2] * 29) >> 8
      if (luma < SCREEN_DARK_LUMA) dark++
    }
    return dark / (pixels.length / 3)
  }
  const sourceCandidates = (shot) =>
    evidence.trace.filter(
      (row) => row.phase === shot.phase && Math.abs(row.t - shot.t) <= SOURCE_WINDOW_MS,
    )
  const measuredScreens = screenshots.flatMap((shot, id) => {
    const state = nearestTrace(shot)
    const pixels = screenPixels.get(id)
    if (!state || !pixels) return []
    const sources = sourceCandidates(shot)
    if (!sources.length) return []
    const sourceError = Math.min(...sources.map((row) => mae(pixels, row.sourcePixels)))
    return [{ ...shot, id, state, sourceError, dark: darkShare(pixels) }]
  })
  const percentile = (values, p) => {
    if (!values.length) return NaN
    const ordered = [...values].sort((a, b) => a - b)
    return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * p))]
  }
  const baseline = measuredScreens.filter((frame) => frame.phase === 'baseline')
  const baselineP95 = percentile(
    baseline.map((frame) => frame.sourceError),
    0.95,
  )
  // JPEG and sample timing set a small non-zero baseline. A custody frame may
  // move by a fraction of a pixel, but it may not look like the desk behind it.
  const visualErrorMax = Number.isFinite(baselineP95) ? Math.max(24, baselineP95 + 16) : 24

  if (baseline.length < MIN_BASELINE_FRAMES) {
    problems.push(`only ${baseline.length} baseline compositor frames were sampled`)
  }

  const cycleRows = []
  for (const cycle of cycles) {
    const downTrace = evidence.trace.filter((row) => row.phase === cycle.downPhase)
    const upTrace = evidence.trace.filter((row) => row.phase === cycle.upPhase)
    const downFrames = measuredScreens.filter(
      (frame) =>
        frame.phase === cycle.downPhase &&
        frame.state.away &&
        !frame.state.filled &&
        frame.state.progress <= POUR_AT_WALL,
    )
    const upAirFrames = measuredScreens.filter(
      (frame) =>
        frame.phase === cycle.upPhase &&
        frame.state.away &&
        frame.state.filled &&
        frame.state.progress <= POUR_AT_WALL,
    )
    const upDomFrames = measuredScreens.filter(
      (frame) => frame.phase === cycle.upPhase && !frame.state.away && !frame.state.filled,
    )
    const boundaryFrames = [...downFrames, ...upAirFrames, ...upDomFrames]
    const badVisual = boundaryFrames.filter(
      (frame) => frame.sourceError > visualErrorMax || frame.dark > SCREEN_DARK_MAX,
    )
    const phaseChanges = evidence.changes.filter(
      (change) => change.phase === cycle.downPhase || change.phase === cycle.upPhase,
    )
    const frozeDown = phaseChanges.some(
      (change) =>
        change.phase === cycle.downPhase &&
        change.name === 'data-genie-film-frozen' &&
        change.next === 'true',
    )
    const resumedDown = phaseChanges.some(
      (change) =>
        change.phase === cycle.downPhase &&
        change.name === 'data-genie-film-frozen' &&
        change.next === 'false',
    )
    const frozeUp = phaseChanges.some(
      (change) =>
        change.phase === cycle.upPhase &&
        change.name === 'data-genie-film-frozen' &&
        change.next === 'true',
    )
    const resumedUp = phaseChanges.some(
      (change) =>
        change.phase === cycle.upPhase &&
        change.name === 'data-genie-film-frozen' &&
        change.next === 'false',
    )
    const checkProtocol = (phase, direction, wall) => {
      const allProbes = evidence.probes.filter((probe) => probe.phase === phase)
      const requires = allProbes.filter((probe) => probe.type === 'require')
      const required = requires[0]
      const probes = allProbes.filter((probe) => probe.token === required?.token)
      const accepts = probes.filter((probe) => probe.type === 'accept')
      const presentations = probes.filter((probe) => probe.type === 'present')
      const shows = probes.filter((probe) => probe.type === 'show')
      const lands = probes.filter((probe) => probe.type === 'land')
      const reveals = probes.filter((probe) => probe.type === 'reveal')
      const releases = probes.filter((probe) => probe.type === 'release')
      const revokes = probes.filter((probe) => probe.type === 'revoke')
      const receipts = probes.filter((probe) => probe.type === 'receipt')
      const accepted = accepts[0]
      const presented = presentations[0]
      const landed = lands[0]
      const revealed = reveals[0]
      const released = releases[0]
      const foreignCritical = allProbes.filter(
        (probe) =>
          probe.token !== required?.token &&
          (probe.type === 'require' ||
            probe.type === 'accept' ||
            probe.type === 'present' ||
            probe.type === 'show' ||
            probe.type === 'land' ||
            probe.type === 'reveal' ||
            probe.type === 'release' ||
            probe.type === 'revoke'),
      )
      const covers = (receipt, frame) =>
        receipt?.frame?.sourceId === frame?.sourceId &&
        receipt.frame.generation >= frame.generation
      const acquisitionReceipt = receipts.find(
        (probe) => required && probe.seq < (accepted?.seq ?? Infinity) && covers(probe.receipt, required.frame),
      )
      const presentationMatches =
        presented?.receipt?.transferId === required?.token &&
        presented?.receipt?.presentationRevision === required?.presentationRevision &&
        Number.isFinite(presented?.receipt?.surfaceEpoch) &&
        presented.receipt.surfaceEpoch > 0 &&
        covers(presented.receipt, required?.frame)
      const showMatches =
        shows[0]?.frame?.sourceId === presented?.receipt?.frame?.sourceId &&
        shows[0]?.frame?.generation === presented?.receipt?.frame?.generation
      const reverseOrder =
        wall === 1
          ? reveals.length === 0
          : reveals.length === 1 &&
            landed?.seq < revealed.seq &&
            revealed.seq < released?.seq
      return {
        ok:
          requires.length === 1 &&
          foreignCritical.length === 0 &&
          required.direction === direction &&
          required.sameSourceObject &&
          required.sameSourceCanvas &&
          required.sameCanvas &&
          required.sameVideo &&
          accepts.length === 1 &&
          covers(accepted.receipt, required.frame) &&
          Boolean(acquisitionReceipt) &&
          presentations.length === 1 &&
          presentationMatches &&
          shows.length === 1 &&
          accepted.seq < presented.seq &&
          presented.seq < shows[0].seq &&
          showMatches &&
          lands.length === 1 &&
          landed.wall === wall &&
          releases.length === 1 &&
          released.wall === wall &&
          reverseOrder &&
          revokes.length === 0,
        required: required?.frame?.generation ?? null,
        accepted: accepted?.receipt?.frame?.generation ?? null,
        presented: presented?.receipt?.frame?.generation ?? null,
        presentationRevision: presented?.receipt?.presentationRevision ?? null,
        surfaceEpoch: presented?.receipt?.surfaceEpoch ?? null,
        landingRequired: landed?.frame?.generation ?? null,
        revealed: revealed?.frame?.generation ?? null,
        counts: {
          require: requires.length,
          receipt: receipts.length,
          accept: accepts.length,
          present: presentations.length,
          show: shows.length,
          land: lands.length,
          reveal: reveals.length,
          release: releases.length,
          revoke: revokes.length,
        },
        foreignCritical: foreignCritical.map((probe) => ({
          type: probe.type,
          token: probe.token,
          seq: probe.seq,
        })),
      }
    }
    const downProtocol = checkProtocol(cycle.downPhase, 'minimizing', 1)
    const upProtocol = checkProtocol(cycle.upPhase, 'restoring', 0)
    const maxError = boundaryFrames.length
      ? Math.max(...boundaryFrames.map((frame) => frame.sourceError))
      : NaN
    const maxDark = boundaryFrames.length
      ? Math.max(...boundaryFrames.map((frame) => frame.dark))
      : NaN
    cycleRows.push({
      cycle: cycle.cycle + 1,
      downMs: cycle.downEnd - cycle.downStart,
      upMs: cycle.upEnd - cycle.upStart,
      downFrames: downFrames.length,
      upAirFrames: upAirFrames.length,
      upDomFrames: upDomFrames.length,
      maxError,
      maxDark,
      badVisual: badVisual.length,
      frozeDown,
      resumedDown,
      frozeUp,
      resumedUp,
      downProtocol,
      upProtocol,
      downLanded: downTrace.some((row) => row.filled && row.away),
      upLanded: upTrace.some((row) => !row.filled && !row.away),
    })

    if (downFrames.length < MIN_BOUNDARY_FRAMES) {
      problems.push(`cycle ${cycle.cycle + 1}: no compositor frame covered the minimize handoff`)
    }
    if (upDomFrames.length < MIN_BOUNDARY_FRAMES) {
      problems.push(`cycle ${cycle.cycle + 1}: no compositor frame covered the restored DOM canvas`)
    }
    if (!frozeDown || !resumedDown || !frozeUp || !resumedUp) {
      problems.push(
        `cycle ${cycle.cycle + 1}: freeze/resume trace was incomplete ` +
          `(down ${frozeDown}/${resumedDown}, up ${frozeUp}/${resumedUp})`,
      )
    }
    if (!downProtocol.ok || !upProtocol.ok) {
      problems.push(
        `cycle ${cycle.cycle + 1}: receipt protocol was incomplete ` +
          `(down ${JSON.stringify(downProtocol)}, up ${JSON.stringify(upProtocol)})`,
      )
    }
    if (!cycleRows.at(-1).downLanded || !cycleRows.at(-1).upLanded) {
      problems.push(`cycle ${cycle.cycle + 1}: a landing state was not observed in the rAF trace`)
    }
    if (badVisual.length) {
      problems.push(
        `cycle ${cycle.cycle + 1}: ${badVisual.length} boundary compositor frame(s) did not contain ` +
          `the source picture (worst MAE ${maxError.toFixed(1)}, dark ${(maxDark * 100).toFixed(0)}%)`,
      )
    }
  }

  const contextProbes = evidence.probes.filter(
    (probe) => probe.phase === contextLoss.phase,
  )
  const contextRequired = contextProbes.find((probe) => probe.type === 'require')
  const contextPresented = contextProbes.find(
    (probe) =>
      probe.type === 'present' && probe.token === contextRequired?.token,
  )
  const contextShown = contextProbes.find(
    (probe) => probe.type === 'show' && probe.token === contextRequired?.token,
  )
  const contextRevoked = contextProbes.find(
    (probe) => probe.type === 'revoke' && probe.token === contextRequired?.token,
  )
  const staleAfterRevoke = contextRevoked
    ? contextProbes.filter(
        (probe) =>
          probe.seq > contextRevoked.seq &&
          (probe.type === 'receipt' ||
            probe.type === 'accept' ||
            probe.type === 'present'),
      )
    : []
  const contextTraceAfterRevoke = contextRevoked
    ? evidence.trace.filter(
        (row) => row.phase === contextLoss.phase && row.t >= contextRevoked.t,
      )
    : []
  const contextNativeFrames = measuredScreens.filter(
    (frame) =>
      frame.phase === contextLoss.phase &&
      contextRevoked &&
      frame.t >= contextRevoked.t &&
      !frame.state.away,
  )
  const badContextFrames = contextNativeFrames.filter(
    (frame) => frame.sourceError > visualErrorMax || frame.dark > SCREEN_DARK_MAX,
  )
  const firstMatchingNativeFrame = contextNativeFrames.findIndex(
    (frame) => frame.sourceError <= visualErrorMax && frame.dark <= SCREEN_DARK_MAX,
  )
  const regressedNativeFrames =
    firstMatchingNativeFrame < 0
      ? []
      : contextNativeFrames
          .slice(firstMatchingNativeFrame)
          .filter(
            (frame) =>
              frame.sourceError > visualErrorMax || frame.dark > SCREEN_DARK_MAX,
          )
  const contextLossPassed =
    contextLoss.supported &&
    contextRequired &&
    contextPresented &&
    contextShown &&
    contextRevoked &&
    contextShown.seq < contextRevoked.seq &&
    contextRevoked.reason === 'context-lost' &&
    contextLoss.end - contextLoss.start < 1000 &&
    contextTraceAfterRevoke.length > 0 &&
    contextTraceAfterRevoke.every((row) => !row.away && !row.filled && !row.frozen) &&
    contextNativeFrames.length >= 1 &&
    firstMatchingNativeFrame >= 0 &&
    contextNativeFrames.every((frame) => frame.dark <= SCREEN_DARK_MAX) &&
    regressedNativeFrames.length === 0 &&
    staleAfterRevoke.length === 0

  if (!contextLossPassed) {
    problems.push(
      `context-loss fallback failed: ${JSON.stringify({
        supported: contextLoss.supported,
        durationMs: contextLoss.end - contextLoss.start,
        required: contextRequired?.seq ?? null,
        presented: contextPresented?.seq ?? null,
        shown: contextShown?.seq ?? null,
        revoked: contextRevoked?.seq ?? null,
        traceAfterRevoke: contextTraceAfterRevoke.length,
        nativeFrames: contextNativeFrames.length,
        badContextFrames: badContextFrames.length,
        firstMatchingNativeFrame,
        regressedNativeFrames: regressedNativeFrames.length,
        contextErrors: contextNativeFrames.map((frame) =>
          Number(frame.sourceError.toFixed(1)),
        ),
        contextDark: contextNativeFrames.map((frame) =>
          Number((frame.dark * 100).toFixed(0)),
        ),
        staleAfterRevoke: staleAfterRevoke.length,
      })}`,
    )
  }

  const generations = evidence.changes
    .filter((change) => change.name === 'data-genie-film-generation')
    .map((change) => ({ ...change, old: Number(change.old), next: Number(change.next) }))
  const badGenerations = generations.filter(
    (change) => !Number.isFinite(change.old) || !Number.isFinite(change.next) || change.next <= change.old,
  )
  const sourceIds = new Set(evidence.trace.map((row) => row.sourceId).filter(Boolean))
  const frameRows = evidence.trace.filter((row) => row.phase !== 'idle')
  const badIdentity = frameRows.filter(
    (row) =>
      row.decoderCount !== 1 ||
      row.canvasCount !== 1 ||
      !row.sameDecoder ||
      !row.sameCanvas,
  )
  const badSourceState = frameRows.filter((row) => !row.attached || !row.ready || row.error)
  const regressed = (key) => {
    let previous = -Infinity
    return frameRows.filter((row) => {
      const value = row[key]
      const bad = Number.isFinite(value) && value < previous
      if (Number.isFinite(value)) previous = Math.max(previous, value)
      return bad
    })
  }
  const drawRegressions = regressed('drawCount')
  const presentedRegressions = regressed('presentedFrames')
  const unexpectedEvents = evidence.events.filter((event) => !event.automaticLoop)
  const loopEvents = evidence.events.filter((event) => event.automaticLoop)
  const loopClusters = []
  for (const event of loopEvents) {
    if (!loopClusters.length || event.t - loopClusters.at(-1) > 2000) loopClusters.push(event.t)
  }
  const loopWraps = loopClusters.length
  const outsideLoopWindow = (row) =>
    loopEvents.every((event) => Math.abs(row.t - event.t) > 1500)
  const badPlayback = frameRows.filter(
    (row) => (row.paused || row.readyState < 2) && outsideLoopWindow(row),
  )
  const staleReceipts = evidence.probes.filter(
    (probe) =>
      (probe.type === 'receipt' || probe.type === 'accept' || probe.type === 'present') &&
      !sourceIds.has(String(probe.receipt.frame.sourceId)),
  )

  if (sourceIds.size !== 1) problems.push(`saw ${sourceIds.size} film source IDs: ${[...sourceIds].join(', ')}`)
  if (evidence.identityFaults.length) {
    problems.push(`${evidence.identityFaults.length} DOM mutation(s) replaced or detached the decoder/canvas`)
  }
  if (badIdentity.length) problems.push(`${badIdentity.length} rAF samples changed decoder/canvas identity`)
  if (badSourceState.length) problems.push(`${badSourceState.length} rAF samples had an invalid source state`)
  if (badPlayback.length) problems.push(`${badPlayback.length} rAF samples had a playback fault outside a native loop`)
  if (badGenerations.length) problems.push(`${badGenerations.length} generation changes were not monotonic`)
  if (!generations.length) problems.push('no generation changes were observed')
  if (drawRegressions.length) problems.push(`${drawRegressions.length} draw-count samples moved backward`)
  if (presentedRegressions.length) {
    problems.push(`${presentedRegressions.length} presented-frame samples moved backward`)
  }
  if (staleReceipts.length) problems.push(`${staleReceipts.length} draw receipt(s) named a stale source`)
  if (unexpectedEvents.length) {
    problems.push(
      `decoder emitted ${unexpectedEvents.map((event) => `${event.type}@${event.phase}`).join(', ')}`,
    )
  }
  if (pageErrors.length) problems.push(`${pageErrors.length} page/console error(s): ${pageErrors.join(' | ')}`)

  const first = frameRows[0]
  const last = evidence.final
  const identityOk = evidence.identityFaults.length === 0 && badIdentity.length === 0
  console.log(`\n  ${ROUNDS} film minimize/restore cycles (${SLOWCPU}x CPU throttle)`)
  console.log(
    `    decoder nodes                    ${identityOk ? '1, same object for every sample' : 'FAILED identity/count check'}`,
  )
  console.log(
    `    source canvases                  ${identityOk ? '1, same object for every sample' : 'FAILED identity/count check'}`,
  )
  console.log(`    source ID                        ${[...sourceIds].join(', ') || 'missing'}`)
  console.log(
    `    generation                      ${first?.generation ?? 'n/a'} -> ${last?.generation ?? 'n/a'} ` +
      `(${generations.length} observed changes)`,
  )
  console.log(`    canvas draws                     ${first?.drawCount ?? 'n/a'} -> ${last?.drawCount ?? 'n/a'}`)
  console.log(
    `    presented video frames          ${first?.presentedFrames ?? 'n/a'} -> ${last?.presentedFrames ?? 'n/a'}`,
  )
  console.log(
    `    media interruptions             ${unexpectedEvents.length} ` +
      `(${loopWraps} native loop wrap(s) excluded)`,
  )
  console.log(`    compositor screenshots          ${measuredScreens.length}`)
  console.log(
    `    normal DOM/source MAE p95        ${Number.isFinite(baselineP95) ? baselineP95.toFixed(1) : 'n/a'} ` +
      `(boundary limit ${Number.isFinite(visualErrorMax) ? visualErrorMax.toFixed(1) : 'n/a'})`,
  )
  console.log(
    `    context-loss fallback           ${contextLossPassed ? 'yes' : 'NO'} ` +
      `(${contextLoss.end - contextLoss.start}ms, ${contextNativeFrames.length} native frame(s))`,
  )
  console.log('')
  console.table(
    cycleRows.map((row) => ({
      cycle: row.cycle,
      down_ms: row.downMs,
      up_ms: row.upMs,
      down_frames: row.downFrames,
      up_air_frames: row.upAirFrames,
      up_dom_frames: row.upDomFrames,
      worst_mae: Number.isFinite(row.maxError) ? row.maxError.toFixed(1) : 'n/a',
      darkest: Number.isFinite(row.maxDark) ? `${(row.maxDark * 100).toFixed(0)}%` : 'n/a',
      freeze: row.frozeDown && row.resumedDown && row.frozeUp && row.resumedUp ? 'yes' : 'NO',
      receipts: row.downProtocol.ok && row.upProtocol.ok ? 'yes' : 'NO',
      landed: row.downLanded && row.upLanded ? 'yes' : 'NO',
    })),
  )

  console.log(
    `film-window: ${
      problems.length === 0
        ? 'PASS — one decoder and one canvas crossed every custody boundary without a blank or stale landing'
        : 'FAIL'
    }`,
  )
  for (const problem of problems) console.log(`  ${problem}`)
  for (const row of cycleRows.filter((row) => !row.downProtocol.ok || !row.upProtocol.ok)) {
    const phases = [`minimize:${row.cycle - 1}`, `restore:${row.cycle - 1}`]
    const critical = evidence.probes.filter(
      (probe) =>
        phases.includes(probe.phase) &&
        probe.type !== 'receipt' &&
        probe.type !== 'surface' &&
        probe.type !== 'flight' &&
        probe.type !== 'chrome',
    )
    console.log(`  cycle ${row.cycle} protocol trace: ${JSON.stringify(critical)}`)
  }
  console.log(`  draw-receipt tuples              ${evidence.probes.filter((probe) => probe.type === 'receipt').length}`)
  console.log(`  presentation-receipt tuples       ${evidence.probes.filter((probe) => probe.type === 'present').length}`)
  exitCode = problems.length ? 1 : 0
} catch (error) {
  exitCode = 1
  console.error(error?.stack || error)
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}

process.exitCode = exitCode
