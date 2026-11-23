// Paired capture handoff — actual page pixels with the outgoing draw paused.
// Repeat with the DOM update triggered at texture copy to expose an early commit.
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

function replaceOnce(source, from, to) {
  assert.equal(source.split(from).length, 2, `Browser probe injection changed: ${from}`)
  return source.replace(from, to)
}

const scenes = {
  'distortion-wave': {
    target: '.wave-color-player',
    trigger: '[aria-label="Papaya"]',
    canvas: '.wave-overlay canvas',
    module: 'distortionWaveEffect.tsx',
    visibility: 'element.visible = drawing.length > 0;',
    patchedVisibility: 'element.visible = drawing.length > 0 && window.handoff.draw;',
    changed: () => document.querySelector('.wave-color-name').textContent === 'Papaya',
    done: 4000,
  },
  postcard: {
    target: '[data-api-live] .postcard-card',
    trigger: '[data-api-live] .postcard-msg button',
    canvas: 'canvas[data-api-capture-consumer]',
    module: 'PostcardStamp.tsx',
    visibility: 'element.visible = !!active.current?.visible;',
    patchedVisibility: 'element.visible = !!active.current?.visible && window.handoff.draw;',
    changed: () => !!document.querySelector('[data-api-live] .postcard-postmark'),
    done: 1000,
  },
}

const settle = page => page.evaluate(() => new Promise(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(resolve)),
))

function distance(page, actual, expected, region) {
  return page.evaluate(async (left, right, region) => {
    async function pixels(encoded) {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${encoded}`)).blob())
      const canvas = new OffscreenCanvas(image.width, image.height)
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      return context.getImageData(region.x, region.y, region.width, region.height).data
    }
    const [a, b] = await Promise.all([pixels(left), pixels(right)])
    let sum = 0
    for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2
    return sum / a.length
  }, Buffer.from(actual).toString('base64'), Buffer.from(expected).toString('base64'), region)
}

const staleGpu = process.env.STALE_GPU === '1'

async function handoff(browser, scene, engine, fault) {
  const target = scenes[scene]
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('404 (Not Found)')) errors.push(message.text())
  })
  try {
    // At this width the postcard is scaled below its native layout size.
    await page.setViewport({ width: scene === 'postcard' ? 390 : 895, height: 850, deviceScaleFactor: 1 })
    await page.evaluateOnNewDocument(stale => {
      window.handoff = { draw: stale, copies: [], draws: 0, blocked: null, uploads: 0 }
      if (!stale) return
      const blocked = new WeakMap()
      const renderers = new WeakSet()
      window.holdUpload = (renderer, texture) => {
        const { requested } = window.handoff
        if (!renderers.has(renderer)) {
          renderers.add(renderer)
          const upload = renderer.backend.updateTexture.bind(renderer.backend)
          renderer.backend.updateTexture = (candidate, options) => {
            const phase = blocked.get(candidate)
            if (phase && phase === window.handoff.blocked) {
              window.handoff.uploads++
              window.handoff.lastBlocked = phase
              return
            }
            return upload(candidate, options)
          }
        }
        if (blocked.has(texture)) return
        blocked.set(texture, requested)
        let callback = texture.onUpdate
        Object.defineProperty(texture, 'onUpdate', {
          get: () => requested === window.handoff.blocked ? null : callback,
          set: next => { callback = next },
        })
      }
      window.handoff.blocked = 'capture-before'
    }, staleGpu)
    await page.setRequestInterception(true)
    page.on('request', async request => {
      const pathname = new URL(request.url()).pathname
      const shared = pathname.endsWith('/captureTransitionEffect.ts')
      const upload = staleGpu && shared
      if (!shared && !upload && !pathname.endsWith(`/${target.module}`)) {
        await request.continue()
        return
      }
      try {
        const response = await fetch(request.url())
        assert(response.ok)
        let body = await response.text()
        if (upload) {
          body = replaceOnce(body, 'renderer.initTexture(texture);', 'window.holdUpload(renderer, texture); renderer.initTexture(texture);')
          if (fault) body = replaceOnce(body, 'return uploaded;', `return uploaded || window.handoff.requested === ${JSON.stringify(fault)};`)
        }
        if (shared) {
          body = replaceOnce(body, 'pending.current = current;', 'pending.current = current; window.handoff.requested = phase;')
          body = replaceOnce(body, 'if (status.status === "error" || status.status === "unsupported") {', 'if (status.status === "error" || status.status === "unsupported") { window.handoff.failure = status;')
          body = replaceOnce(body, 'if (!matches) return;', 'window.handoff.last = [status.status, frame && [frame.width, frame.height], source.size]; if (!matches) return;')
          body = replaceOnce(body, 'current.job.run.copy(frame, incoming ? "after" : "before");',
            'current.job.run.copy(frame, incoming ? "after" : "before"); window.handoff.copies.push(incoming ? "after" : "before");')
          body = replaceOnce(body, 'current.phase = "present-before";',
            `current.phase = "present-before"; ${fault && !staleGpu ? 'presented();' : ''}`)
          body = replaceOnce(body, 'const presented = () => {',
            'const presented = () => { if (window.handoff.draw) window.handoff.draws++;')
        } else {
          body = replaceOnce(body, target.visibility, target.patchedVisibility)
        }
        await request.respond({ contentType: 'text/javascript', body })
      } catch (error) {
        errors.push(String(error))
        await request.abort()
      }
    })
    const url = new URL(process.env.HANDOFF_URL ?? 'http://127.0.0.1:5188/')
    url.search = new URLSearchParams({ scene, framed: '' })
    if (engine === 'snapdom') url.searchParams.set('capture', 'snapdom')
    await page.goto(url.href, { waitUntil: 'networkidle0' })
    await page.waitForSelector(target.canvas)
    assert.equal(await page.evaluate(() => window.__munari.engine()), engine === 'native' ? 'html-in-canvas' : 'snapdom')
    if (scene === 'postcard') {
      await page.waitForSelector('.light-page[data-page-ready]')
      await page.$eval('.light-host', host => { host.style.visibility = 'hidden' })
      await page.type('[data-api-live] .postcard-addr input', 'Ada')
    }
    await page.$eval(target.trigger, button => button.scrollIntoView({ block: 'center' }))
    await page.hover(target.trigger)
    // Match the initial focus styling across the reference and both draw paths.
    await page.$eval(target.trigger, button => button.focus())
    await settle(page)
    const region = await page.$eval(target.target, element => {
      const rect = element.getBoundingClientRect()
      return {
        x: Math.ceil(rect.x + rect.width * 0.04),
        y: Math.ceil(rect.y + rect.height * 0.05),
        width: Math.floor(rect.width * 0.92),
        height: Math.floor(rect.height * 0.9),
      }
    })
    assert(region.x >= 0 && region.y >= 0 && region.y + region.height <= 850, `${scene}: sample must be visible`)
    if (scene === 'postcard') {
      assert(await page.$eval(target.target, card => card.getBoundingClientRect().width < card.offsetWidth),
        'The probe must exercise a scaled postcard')
    }
    await page.evaluate(() => {
      window.handoff.time = performance.now()
      Object.defineProperty(performance, 'now', { value: () => window.handoff.time })
    })
    const before = await page.screenshot()
    await page.click(target.trigger)
    if (staleGpu) {
      await page.waitForFunction(() => window.handoff.uploads > 0)
      await settle(page)
      const held = await page.screenshot()
      const early = await page.evaluate(target.changed)
      const copies = await page.evaluate(() => window.handoff.copies)
      const verifyUpload = () => {
        assert(!early && copies.length === 0, 'Outgoing upload must precede the copy and DOM update')
      }
      if (fault === 'capture-before') {
        assert.throws(verifyUpload, /Outgoing upload/)
        assert.deepEqual(errors, [])
        return 'caught an early copy or update with the upload blocked'
      }
      verifyUpload()
      assert.equal(await distance(page, held, before, region), 0)
      await page.evaluate(() => { window.handoff.blocked = 'capture-after' })
      await page.waitForFunction(target.changed)
      await page.waitForFunction(() => window.handoff.lastBlocked === 'capture-after')
      await settle(page)
      const outgoing = await page.screenshot()
      await page.evaluate(() => { window.handoff.time += 500 })
      await settle(page)
      const mismatch = await distance(page, outgoing, await page.screenshot(), region)
      const copyOrder = await page.evaluate(() => window.handoff.copies)
      const verifyIncoming = () => {
        assert(mismatch === 0 && copyOrder.length === 1 && copyOrder[0] === 'before',
          'The outgoing pixels must stay held while the incoming upload is blocked')
      }
      if (fault === 'capture-after') {
        assert.deepEqual(copyOrder, ['before', 'after'])
        assert(mismatch > 0, 'Bypassing the incoming upload check must change painted pixels before release')
        assert.throws(verifyIncoming, /incoming upload is blocked/)
        assert.deepEqual(errors, [])
        return 'caught an early reveal with the incoming upload blocked'
      }
      verifyIncoming()
      await page.evaluate(() => { window.handoff.blocked = null })
    }
    await page.waitForFunction(() => window.handoff.copies.includes('before'), { timeout: 4000 })
    await settle(page)
    if (!staleGpu) {
      const blocked = await page.screenshot()
      const committedBehindBlockedDraw = await page.evaluate(target.changed)
      const blockedMismatch = await distance(page, blocked, before, region)
      const verifyBlocked = () => assert(!committedBehindBlockedDraw && blockedMismatch === 0,
        `${scene}: early commit before the outgoing draw (DOM changed: ${committedBehindBlockedDraw}, pixel error: ${blockedMismatch})`)
      if (fault) {
        assert(committedBehindBlockedDraw && blockedMismatch > 0)
        assert.equal(await page.evaluate(() => window.handoff.draws), 0)
        assert.throws(verifyBlocked, /early commit before the outgoing draw/)
        assert.deepEqual(errors, [])
        return 'caught early commit in the DOM and in painted pixels'
      }
      verifyBlocked()
      await page.evaluate(() => { window.handoff.draw = true })
    }
    await page.waitForFunction(target.changed)
    await page.waitForFunction(() => window.handoff.copies.includes('after'))
    assert.deepEqual(await page.evaluate(() => window.handoff.copies), ['before', 'after'])
    assert(await page.evaluate(() => window.handoff.draws > 0))
    await settle(page)
    const held = await page.screenshot()
    let capturedIncoming
    if (scene === 'postcard') {
      await page.evaluate(() => { window.handoff.time += 310 })
      await page.$eval(target.target, card => { card.style.visibility = 'hidden' })
      await settle(page)
      capturedIncoming = await page.screenshot()
      await page.$eval(target.target, card => { card.style.visibility = '' })
    }
    await page.evaluate(done => { window.handoff.time += done }, target.done)
    await settle(page)
    const after = await page.screenshot()
    const change = await distance(page, before, after, region)
    const heldBefore = await distance(page, held, before, region)
    const heldAfter = await distance(page, held, after, region)
    assert(change > 0 && heldBefore < heldAfter,
      `${scene}: outgoing pixels must cover the committed DOM (change ${change}, held vs before ${heldBefore}, held vs after ${heldAfter})`)
    if (capturedIncoming) {
      const stampRegion = await page.$eval('[data-api-live] .postcard-postmark', mark => {
        const rect = mark.getBoundingClientRect()
        // The bottom arc excludes the overlapped button and its focus outline.
        return {
          x: Math.ceil(rect.left),
          y: Math.ceil(rect.top + rect.height * 0.82),
          width: Math.floor(rect.width),
          height: Math.floor(rect.height * 0.17),
        }
      })
      const incomingAfter = await distance(page, capturedIncoming, after, stampRegion)
      const incomingBefore = await distance(page, capturedIncoming, before, stampRegion)
      assert(incomingAfter < incomingBefore,
        `Postcard must reveal the incoming stamp with the live card hidden (${incomingAfter} vs ${incomingBefore})`)
    }
    await page.$eval(target.canvas, canvas => { canvas.style.visibility = 'hidden' })
    await settle(page)
    assert.equal(await distance(page, after, await page.screenshot(), region), 0,
      `${scene}: end of the effect must match the live page`)
    await page.$eval(target.canvas, canvas => { canvas.style.visibility = '' })
    if (scene === 'postcard') {
      await page.evaluate(() => {
        const input = document.querySelector('[data-api-live] .postcard-addr input')
        input.focus()
        input.setSelectionRange(input.value.length, input.value.length)
        document.querySelector('[data-api-live] .postcard-msg button').click()
      })
      await page.waitForFunction(() => document.querySelectorAll('[data-api-live] .postcard-postmark').length === 2, { timeout: 4000 })
      assert(await page.$eval('[data-api-live] .postcard-addr input', input => input === document.activeElement))
      await page.keyboard.type(' Lovelace')
      await page.waitForFunction(() => document.querySelector('[data-api-live] .postcard-line').textContent === 'For Ada Lovelace, with love.', { timeout: 4000 })
      await settle(page)
      const typed = await page.screenshot()
      await page.$eval(target.canvas, canvas => { canvas.style.visibility = 'hidden' })
      await settle(page)
      assert.equal(await distance(page, typed, await page.screenshot(), region), 0, 'Typing must release the captured form')
    }
    assert.deepEqual(errors, [])
    return 'both captures, held and settled pixels, no early commit'
  } catch (error) {
    console.error(scene, engine, fault, errors, await page.evaluate(() => ({
      status: window.handoff, selected: document.querySelector('.wave-color-name')?.textContent,
      parked: document.querySelectorAll('[data-munari-parked]').length,
      postcardMarks: Array.from(document.querySelectorAll('.postcard-hero-holder'), holder => holder.querySelectorAll('.postcard-postmark').length),
      postcardName: document.querySelector('[data-api-live] .postcard-addr input')?.value,
    })))
    throw error
  } finally {
    await page.close()
  }
}

const engines = process.argv.slice(2)
for (const engine of engines.length ? engines : ['native', 'snapdom']) {
  assert(['native', 'snapdom'].includes(engine))
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: [...WEBGPU_CHROME_ARGS, ...(engine === 'native' ? ['--enable-features=CanvasDrawElement'] : [])],
  })
  try {
    for (const scene of Object.keys(scenes)) {
      const result = await handoff(browser, scene, engine, false)
      console.log(`${engine} ${scene}: ${result}`)
      const faults = staleGpu ? ['capture-before', 'capture-after'] : [true]
      for (const fault of faults) {
        const caught = await handoff(browser, scene, engine, fault)
        console.log(`${engine} ${scene}: ${caught}`)
      }
    }
  } finally {
    await browser.close()
  }
}
