// Screencast recording check — real transport, image identity, and resource lifetime.
// A measurement must retain every image and release its Chrome resources on failure.
// Full-viewport decode messages can exhaust DevTools' 100 MB buffer; eight-image
// batches bound the payload (docs/browser-gate-recording-plan.md). Closing a page
// hides listener and object leaks, so their release is observed while it remains alive.
// This check owns ordinary DOM fixtures; the Genie gates own rendered scene judgments.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'

import puppeteer from 'puppeteer-core'
import { createScreencastRecorder, scoreScreencast } from './screencastRecording.ts'
import { IncompleteScreencastError } from './screencastCoverage.ts'
import { WEBGPU_CHROME_ARGS } from './webgpuChrome.mjs'

const chrome = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean).find(candidate => existsSync(candidate))
if (!chrome) throw new Error('screencast-recording: Chrome was not found; set CHROME_PATH')

const viewport = { width: 320, height: 180, deviceScaleFactor: 1 }
const captureOptions = { format: 'png', everyNthFrame: 1, maxWidth: viewport.width, maxHeight: viewport.height }
const results = []
const deadline = setTimeout(() => {
  console.error('screencast-recording: FAIL — hard 300s deadline hit')
  process.exit(1)
}, 300_000)

function record(name, evidence) {
  const result = { name, ...evidence }
  results.push(result)
  console.log(JSON.stringify(result))
}

function combineFailure(primary, cleanup) {
  if (primary === null) return { error: new AggregateError([cleanup], `Cleanup failed: ${String(cleanup)}`, { cause: cleanup }) }
  return { error: new AggregateError([primary.error, cleanup], `${String(primary.error)}; cleanup failed: ${String(cleanup)}`, { cause: primary.error }) }
}

async function withPage(browser, check) {
  const page = await browser.newPage()
  let failure = null
  try {
    await page.setViewport(viewport)
    await page.setContent('<!doctype html><html><body style="margin:0;background:rgb(20,120,220)"></body></html>')
    await check(page)
  } catch (error) {
    failure = { error }
  } finally {
    try {
      await page.close()
    } catch (error) {
      failure = combineFailure(failure, error)
    }
  }
  if (failure !== null) throw failure.error
}

async function withRecorder(page, check) {
  const recorder = await createScreencastRecorder(page, captureOptions)
  let failure = null
  try {
    await check(recorder)
  } catch (error) {
    failure = { error }
  } finally {
    try {
      await recorder.dispose()
    } catch (error) {
      failure = combineFailure(failure, error)
    }
  }
  if (failure !== null) throw failure.error
}

// These observers forward the actual calls. Their oracles query Chrome while the
// page is alive; detaching a session or reading a local disposed flag is insufficient.
function observeHandles(page) {
  const original = page.evaluateHandle.bind(page)
  const evaluate = page.evaluate.bind(page)
  const handles = []
  const messages = []
  const clients = new Map()
  const observeClient = client => {
    if (clients.has(client)) return
    const send = client.send.bind(client)
    clients.set(client, send)
    client.send = async (...args) => {
      const observation = args[0] === 'Runtime.releaseObject' ? handles.find(handle => handle.objectId === args[1].objectId) : undefined
      if (observation === undefined || observation.released) return send(...args)
      const properties = await send('Runtime.getProperties', { objectId: observation.objectId, ownProperties: true, accessorPropertiesOnly: true })
      assert.ok(Array.isArray(properties.result), 'The remote object must exist before its actual release request')
      observation.beforeRelease = true
      const response = await send(...args)
      await assert.rejects(
        () => send('Runtime.getProperties', { objectId: observation.objectId, ownProperties: true, accessorPropertiesOnly: true }),
        /Could not find object|Invalid remote object id|Cannot find object/,
        'Chrome must reject the released remote object while its execution context remains alive',
      )
      observation.released = true
      return response
    }
  }
  const retain = handle => {
    const objectId = handle.remoteObject().objectId
    if (objectId) {
      const observation = { objectId, beforeRelease: false, released: false, disposedLocal: false }
      handles.push(observation)
      observeClient(handle.client)
      const dispose = handle.dispose.bind(handle)
      const evaluateHandle = handle.evaluateHandle.bind(handle)
      handle.evaluateHandle = async (...args) => retain(await evaluateHandle(...args))
      handle.dispose = async () => {
        try { return await dispose() } finally { observation.disposedLocal = handle.disposed }
      }
    }
    return handle
  }
  page.evaluateHandle = async (...args) => retain(await original(...args))
  page.evaluate = async (...args) => {
    const images = args.slice(1).find(argument => Array.isArray(argument) && argument.length > 0 && argument.every(image => Number.isInteger(image?.index) && Number.isFinite(image?.t) && image?.data))
    if (images !== undefined) messages.push({ indices: images.map(image => image.index), payloadBytes: images.reduce((bytes, image) => bytes + Buffer.byteLength(image.data), 0) })
    return evaluate(...args)
  }
  return {
    handles,
    messages,
    restore() {
      page.evaluateHandle = original
      page.evaluate = evaluate
      for (const [client, send] of clients) client.send = send
    },
    assertReleasedSince(start, minimum) {
      const owned = handles.slice(start)
      assert.ok(owned.length >= minimum, `Expected at least ${minimum} real browser objects, observed ${owned.length}`)
      assert.ok(owned.every(handle => handle.beforeRelease && handle.released && handle.disposedLocal), 'Every observed remote object must be released, and its local handle disposed')
      return owned.length
    },
  }
}

function observeSessions(page, detachFirst = false) {
  const original = page.createCDPSession.bind(page)
  const sessions = []
  page.createCDPSession = async () => {
    const session = await original()
    const observation = {
      session,
      received: 0,
      acknowledged: 0,
      pending: 0,
      stopCommands: 0,
      stopping: false,
      stopReturned: false,
      duringStop: 0,
      afterStop: 0,
      acknowledgementFailures: [],
    }
    const delivered = () => {
      observation.received++
      if (observation.stopping) observation.duringStop++
      if (observation.stopReturned) observation.afterStop++
    }
    session.on('Page.screencastFrame', delivered)
    observation.baseline = session.listenerCount('Page.screencastFrame')
    const send = session.send.bind(session)
    session.send = async (...args) => {
      const acknowledgement = args[0] === 'Page.screencastFrameAck'
      const stop = args[0] === 'Page.stopScreencast'
      if (acknowledgement) observation.pending++
      if (stop) {
        observation.stopCommands++
        observation.stopping = true
      }
      try {
        const response = await send(...args)
        if (acknowledgement) observation.acknowledged++
        return response
      } catch (error) {
        if (acknowledgement) observation.acknowledgementFailures.push(String(error))
        throw error
      } finally {
        if (acknowledgement) observation.pending--
        if (stop) {
          observation.stopping = false
          observation.stopReturned = true
        }
      }
    }
    sessions.push(observation)
    if (detachFirst && sessions.length === 1) await session.detach()
    return session
  }
  return {
    sessions,
    restore() { page.createCDPSession = original },
    assertClosed(observation, capture = null) {
      assert.equal(observation.session.listenerCount('Page.screencastFrame'), observation.baseline, 'The owned listener must be removed from the actual retained session')
      assert.equal(observation.session.detached, true)
      assert.equal(observation.pending, 0, 'No actual acknowledgement may remain pending')
      if (capture) {
        assert.equal(capture.diagnostics.received, observation.received)
        assert.equal(capture.diagnostics.acknowledged, observation.acknowledged)
        assert.equal(capture.diagnostics.pendingAcknowledgements, 0)
        assert.equal(capture.diagnostics.sessionId, observation.session.id())
        assert.equal(observation.acknowledged, observation.received)
        assert.deepEqual(observation.acknowledgementFailures, [])
        assert.equal(observation.stopCommands, 1)
      }
    },
  }
}

async function waitForImages(observation, minimum = 3) {
  const end = Date.now() + 5000
  while (observation.received < minimum) {
    if (Date.now() >= end) throw new Error(`Actual Chrome acquisition did not deliver ${minimum} images; received ${observation.received}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function fixtures(page, encoding) {
  return page.evaluate((format) => {
    const paint = (id, identity, color) => {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 180
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('The independent fixture needs a 2D context')
      ctx.fillStyle = `rgb(${color.join(',')})`
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      const bytes = [id % 256, Math.floor(id / 256) % 256, Math.floor(id / 65536) % 256]
      const checksum = bytes.reduce((value, byte) => value ^ byte, 165)
      const bits = [1, 0, 1, 0, 1, 1, 0, 0]
      for (const byte of [...bytes, checksum]) {
        for (let bit = 0; bit < 8; bit++) bits.push(Math.floor(byte / 2 ** bit) % 2)
      }
      bits.forEach((bit, index) => {
        ctx.fillStyle = bit ? '#fff' : '#000'
        ctx.fillRect(2 + index * 4, 10, 4, 4)
      })
      for (let bit = 0; bit < 8; bit++) {
        ctx.fillStyle = Math.floor(identity / 2 ** bit) % 2 ? '#fff' : '#000'
        ctx.fillRect(20 + bit * 8, 40, 8, 8)
      }
      return canvas.toDataURL(`image/${format}`, 1).split(',')[1]
    }
    const frames = Array.from({ length: 19 }, (_, index) => ({
      index: 100 + index * 3,
      t: 1000 + index * 10,
      data: paint(65528 + index, index + 1, [20 + index * 7, 120, 220]),
    }))
    return { frames, reference: paint(42, 231, [31, 97, 173]) }
  }, encoding)
}

function fixtureCapture(encoding, frames) {
  return {
    encoding,
    frames,
    collectionEnd: { requested: frames.at(-1).t, reached: true, timedOut: false },
    diagnostics: { received: frames.length, acknowledged: frames.length, pendingAcknowledgements: 0, sessionId: 'independent-raster-fixture' },
  }
}

function fixtureScorer(reference, context) {
  const readIdentity = image => {
    let value = 0
    for (let bit = 0; bit < 8; bit++) {
      if (image.ctx.getImageData(24 + bit * 8, 44, 1, 1).data[0] > 127) value += 2 ** bit
    }
    return value
  }
  const referenceIdentity = reference === null ? null : readIdentity(reference)
  const referenceColor = reference === null ? null : [...reference.ctx.getImageData(200, 100, 1, 1).data].slice(0, 3)
  let inspected = 0
  return {
    inspect(image) {
      inspected++
      return {
        identity: readIdentity(image),
        color: [...image.ctx.getImageData(200, 100, 1, 1).data].slice(0, 3),
        ordinal: inspected,
        referenceIdentity,
        referenceColor,
        contextIdentity: context.identity,
      }
    },
    summarize() { return { inspected, referenceIdentity, referenceColor, contextIdentity: context.identity } },
  }
}

function assertColor(actual, expected, tolerance) {
  assert.equal(actual.length, 3)
  expected.forEach((level, index) => assert.ok(Math.abs(actual[index] - level) <= tolerance, `Color channel ${index}: expected ${level}, observed ${actual[index]}`))
}

async function decodingCheck(page) {
  const decodes = await page.evaluateHandle(() => {
    const original = HTMLImageElement.prototype.decode
    const sources = []
    HTMLImageElement.prototype.decode = function (...args) {
      sources.push(this.src)
      return original.apply(this, args)
    }
    return {
      take(reference) {
        const observed = { images: sources.length, reference: sources.filter(source => source === reference).length }
        sources.length = 0
        return observed
      },
      restore() { HTMLImageElement.prototype.decode = original },
    }
  })
  const observer = observeHandles(page)
  let failure = null
  try {
    await withRecorder(page, async () => {
      const png = await fixtures(page, 'png')
      for (const encoding of ['png', 'jpeg']) {
        const input = await fixtures(page, encoding)
        const capture = fixtureCapture(encoding, input.frames)
        const start = observer.handles.length
        const messageStart = observer.messages.length
        const scored = await scoreScreencast(page, capture, {
          reference: { kind: 'image', encoding: 'png', data: png.reference },
          context: { identity: 719 },
          createScorer: fixtureScorer,
        })
        const actualMessages = observer.messages.slice(messageStart)
        assert.ok(actualMessages.every(message => message.indices.length <= 8), 'Each decode message must contain at most eight images')
        assert.deepEqual(scored.diagnostics.batchSizes, actualMessages.map(message => message.indices.length))
        assert.deepEqual(actualMessages.flatMap(message => message.indices), Array.from({ length: 19 }, (_, index) => 100 + index * 3))
        assert.deepEqual(scored.diagnostics.payloadBytes, actualMessages.map(message => message.payloadBytes))
        const actualDecodes = await decodes.evaluate((observation, reference) => observation.take(reference), `data:image/png;base64,${png.reference}`)
        assert.deepEqual(actualDecodes, { images: 20, reference: 1 })
        assert.equal(scored.diagnostics.decodedImages, actualDecodes.images)
        assert.equal(scored.diagnostics.referenceDecoded, true)
        assert.equal(scored.rows.length, 19)
        scored.rows.forEach((row, index) => {
          assert.equal(row.index, 100 + index * 3)
          assert.equal(row.t, 1000 + index * 10)
          assert.equal(row.pageFrame, 65528 + index)
          assert.equal(row.value.identity, index + 1)
          assert.equal(row.value.ordinal, index + 1)
          assert.equal(row.value.referenceIdentity, 231)
          assert.equal(row.value.contextIdentity, 719)
          assertColor(row.value.color, [20 + index * 7, 120, 220], encoding === 'png' ? 0 : 5)
          assertColor(row.value.referenceColor, [31, 97, 173], 0)
        })
        assert.deepEqual(scored.summary, { inspected: 19, referenceIdentity: 231, referenceColor: [31, 97, 173], contextIdentity: 719 })
        const releasedObjects = observer.assertReleasedSince(start, 3)
        record(`${encoding}: independent raster identity and scorer continuity`, {
          images: scored.rows.length,
          batchSizes: scored.diagnostics.batchSizes,
          actualDecodeMessages: actualMessages.length,
          actualDecodes,
          payloadBytes: scored.diagnostics.payloadBytes,
          releasedObjects,
          knownClockRange: [65528, 65546],
        })
      }
      const capture = fixtureCapture('png', png.frames)
      const selected = await scoreScreencast(page, capture, {
        reference: { kind: 'recorded', index: 124 },
        selectedIndices: [148, 103, 124],
        context: { identity: 83 },
        createScorer: fixtureScorer,
      })
      assert.deepEqual(selected.rows.map(row => row.index), [103, 124, 148])
      assert.deepEqual(selected.rows.map(row => row.value.identity), [2, 9, 17])
      assert.deepEqual(selected.rows.map(row => row.value.ordinal), [1, 2, 3])
      assert.equal(selected.summary.referenceIdentity, 9)
      const actualDecodes = await decodes.evaluate((observation, reference) => observation.take(reference), `data:image/png;base64,${png.frames.find(frame => frame.index === 124).data}`)
      assert.ok(actualDecodes.reference >= 1 && actualDecodes.reference <= 2, 'The recorded reference may also be decoded as a selected image')
      assert.equal(actualDecodes.images, 2 + actualDecodes.reference)
      assert.equal(selected.diagnostics.decodedImages, actualDecodes.images)
      record('recorded reference and selected original indices', { indices: selected.rows.map(row => row.index), referenceIdentity: selected.summary.referenceIdentity, actualDecodes })
    })
    observer.assertReleasedSince(0, 7)
  } catch (error) {
    failure = { error }
  } finally {
    observer.restore()
    try { await decodes.evaluate(observation => observation.restore()) } catch (error) { failure = combineFailure(failure, error) }
    try { await decodes.dispose() } catch (error) { failure = combineFailure(failure, error) }
  }
  if (failure !== null) throw failure.error
}

async function exceptionalScoringCheck(page) {
  const observer = observeHandles(page)
  try {
    await withRecorder(page, async () => {
      const input = await fixtures(page, 'png')
      const reference = { kind: 'image', encoding: 'png', data: input.reference }
      const cases = [
        {
          name: 'malformed image after the first decode batch',
          frames: input.frames.map((frame, index) => index === 10 ? { ...frame, data: 'invalid-image-data' } : frame),
          createScorer: fixtureScorer,
          pattern: /decode|source image|EncodingError|image data/i,
        },
        {
          name: 'scorer factory failure',
          frames: input.frames,
          createScorer() { throw new Error('fixture factory failure') },
          pattern: /fixture factory failure/,
        },
        {
          name: 'scorer inspection failure after the first decode batch',
          frames: input.frames,
          createScorer() {
            let inspected = 0
            return {
              inspect() {
                if (++inspected === 10) throw new Error('fixture inspection failure')
                return inspected
              },
              summarize() { return inspected },
            }
          },
          pattern: /fixture inspection failure/,
        },
      ]
      for (const test of cases) {
        const start = observer.handles.length
        let thrown = null
        try {
          await scoreScreencast(page, fixtureCapture('png', test.frames), { reference, context: { identity: 12 }, createScorer: test.createScorer })
        } catch (error) {
          thrown = error
        }
        assert.notEqual(thrown, null, 'The actual browser failure must reach the caller')
        assert.ok(!(thrown instanceof IncompleteScreencastError), 'A decoder or scorer failure must be terminal')
        assert.match(String(thrown), test.pattern)
        const releasedObjects = observer.assertReleasedSince(start, test.name === 'scorer factory failure' ? 2 : 3)
        assert.equal(await page.evaluate(() => document.body.isConnected), true, 'The release oracle must keep its original page alive')
        record(test.name, { terminal: true, releasedObjects, error: String(thrown) })
      }
    })
  } finally {
    observer.restore()
  }
}

function liveScorer() {
  return {
    inspect(image) { return [...image.ctx.getImageData(200, 100, 1, 1).data].slice(0, 3) },
    summarize() { return null },
  }
}

function fingerprint(capture) {
  return createHash('sha256').update(JSON.stringify(capture)).digest('hex')
}

async function acquisitionCheck(page) {
  const observer = observeSessions(page)
  try {
    await withRecorder(page, async recorder => {
      let earlier = null
      let earlierFingerprint = null
      for (let cycle = 0; cycle < 3; cycle++) {
        const color = [20 + cycle * 60, 120, 220]
        await page.evaluate(async levels => {
          document.body.style.background = `rgb(${levels.join(',')})`
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        }, color)
        await recorder.start()
        const observation = observer.sessions.at(-1)
        await waitForImages(observation)
        const end = await page.evaluate(() => performance.timeOrigin + performance.now())
        const capture = await recorder.stop({ through: cycle === 2 ? end + 60_000 : end, timeoutMs: cycle === 2 ? 80 : 3000 })
        assert.ok(capture.frames.length >= 3)
        assert.equal(Object.isFrozen(capture), true)
        assert.equal(Object.isFrozen(capture.frames), true)
        assert.ok(capture.frames.every(frame => Object.isFrozen(frame)))
        assert.deepEqual(capture.frames.map(frame => frame.index).toSorted((left, right) => left - right), Array.from({ length: capture.frames.length }, (_, index) => index))
        observer.assertClosed(observation, capture)
        assert.equal(capture.collectionEnd.reached, cycle !== 2)
        assert.equal(capture.collectionEnd.timedOut, cycle === 2)
        const scored = await scoreScreencast(page, capture, { context: null, createScorer: liveScorer })
        assert.equal(scored.rows.length, capture.frames.length)
        scored.rows.forEach(row => {
          assert.ok(Number.isInteger(row.pageFrame))
          assertColor(row.value, color, 0)
        })
        if (earlier !== null) assert.equal(fingerprint(earlier), earlierFingerprint, 'A later actual recording must leave the earlier capture unchanged')
        earlier = capture
        earlierFingerprint = fingerprint(capture)
        record(`actual Chrome recording cycle ${cycle + 1}`, {
          sessionId: capture.diagnostics.sessionId,
          images: capture.frames.length,
          acknowledged: observation.acknowledged,
          pendingAcknowledgements: observation.pending,
          listenerBaseline: observation.baseline,
          listenerAfterStop: observation.session.listenerCount('Page.screencastFrame'),
          duringStop: observation.duringStop,
          afterStop: observation.afterStop,
          collectionEnd: capture.collectionEnd,
          color,
        })
      }
      assert.equal(new Set(observer.sessions.map(observation => observation.session.id())).size, 3)
    })
    observer.sessions.forEach(observation => observer.assertClosed(observation))
    record('late delivery evidence limit', {
      deliveredDuringStop: observer.sessions.reduce((total, observation) => total + observation.duringStop, 0),
      deliveredAfterStop: observer.sessions.reduce((total, observation) => total + observation.afterStop, 0),
      limit: 'Fresh sessions and immutable prior captures are verified. A run with zero late images does not establish late-delivery behavior.',
    })
  } finally {
    observer.restore()
  }
}

async function observeClock(page) {
  await page.evaluate(() => {
    const request = window.requestAnimationFrame.bind(window)
    const cancel = window.cancelAnimationFrame.bind(window)
    const pending = new Set()
    const cancelled = []
    window.requestAnimationFrame = callback => {
      const id = request(time => {
        pending.delete(id)
        callback(time)
      })
      pending.add(id)
      return id
    }
    window.cancelAnimationFrame = id => {
      cancelled.push(id)
      pending.delete(id)
      cancel(id)
    }
    window.__recordingClockObservation = { pending, cancelled, animations: [] }
  })
}

async function clockCheck(page) {
  await observeClock(page)
  const handles = observeHandles(page)
  try {
    const recorder = await createScreencastRecorder(page, captureOptions)
    const installed = await page.evaluate(() => {
      const observed = window.__recordingClockObservation
      observed.animations = document.getAnimations()
      return {
        marker: document.querySelectorAll('[data-screencast-clock="marker"]').length,
        strip: document.querySelectorAll('[data-screencast-clock="strip"]').length,
        pending: observed.pending.size,
        animations: observed.animations.length,
        hook: Object.hasOwn(window, '__screencastClock'),
      }
    })
    assert.deepEqual(installed, { marker: 1, strip: 1, pending: 1, animations: 1, hook: true })
    await recorder.dispose()
    await recorder.dispose()
    const disposed = await page.evaluate(() => ({
      markers: document.querySelectorAll('[data-screencast-clock]').length,
      pending: window.__recordingClockObservation.pending.size,
      cancelled: window.__recordingClockObservation.cancelled.length,
      animationStates: window.__recordingClockObservation.animations.map(animation => animation.playState),
      hook: Object.hasOwn(window, '__screencastClock'),
    }))
    assert.equal(disposed.markers, 0)
    assert.equal(disposed.pending, 0)
    assert.ok(disposed.cancelled >= 1)
    assert.deepEqual(disposed.animationStates, ['idle'])
    assert.equal(disposed.hook, false)
    const replacement = await createScreencastRecorder(page, captureOptions)
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-screencast-clock]').length), 2)
    await page.evaluate(() => Object.defineProperty(window, '__screencastClock', { configurable: true, value: { foreign: 813 } }))
    await replacement.dispose()
    assert.deepEqual(await page.evaluate(() => window.__screencastClock), { foreign: 813 })
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-screencast-clock]').length), 0)
    assert.equal(await page.evaluate(() => window.__recordingClockObservation.pending.size), 0)
    await page.evaluate(() => { delete window.__screencastClock })
    const releasedObjects = handles.assertReleasedSince(0, 2)
    record('owned clock cleanup, replacement, and foreign hook preservation', { installed, disposed, releasedObjects })
  } finally {
    handles.restore()
  }
}

async function constructionCollisionCheck(page) {
  await observeClock(page)
  await page.evaluate(() => Object.defineProperty(window, '__screencastClock', { configurable: false, value: { foreign: 419 } }))
  await assert.rejects(() => createScreencastRecorder(page, captureOptions), /clock|property|ownership|already/i)
  const after = await page.evaluate(() => ({
    markers: document.querySelectorAll('[data-screencast-clock]').length,
    animations: document.getAnimations().length,
    pending: window.__recordingClockObservation.pending.size,
    foreign: window.__screencastClock.foreign,
  }))
  assert.deepEqual(after, { markers: 0, animations: 0, pending: 0, foreign: 419 })
  record('construction collision preserves the foreign clock', after)
}

async function constructionRollbackCheck(page) {
  await observeClock(page)
  await page.evaluate(() => {
    const define = Object.defineProperty
    window.__recordingClockObservation.restoreDefinition = () => { Object.defineProperty = define }
    Object.defineProperty = (target, name, descriptor) => {
      const result = define(target, name, descriptor)
      if (target === window && name === '__screencastClock') {
        const observed = window.__recordingClockObservation
        observed.animations = document.getAnimations()
        observed.atFault = {
          markers: document.querySelectorAll('[data-screencast-clock]').length,
          animations: observed.animations.length,
          pending: observed.pending.size,
          hook: Object.hasOwn(window, '__screencastClock'),
        }
        throw new Error('fixture failure after actual clock allocation')
      }
      return result
    }
  })
  try {
    await assert.rejects(() => createScreencastRecorder(page, captureOptions), /fixture failure after actual clock allocation/)
  } finally {
    await page.evaluate(() => window.__recordingClockObservation.restoreDefinition())
  }
  const after = await page.evaluate(() => ({
    atFault: window.__recordingClockObservation.atFault,
    markers: document.querySelectorAll('[data-screencast-clock]').length,
    animations: document.getAnimations().length,
    animationStates: window.__recordingClockObservation.animations.map(animation => animation.playState),
    pending: window.__recordingClockObservation.pending.size,
    hook: Object.hasOwn(window, '__screencastClock'),
  }))
  assert.deepEqual(after.atFault, { markers: 2, animations: 1, pending: 0, hook: true })
  assert.equal(after.markers, 0)
  assert.equal(after.animations, 0)
  assert.deepEqual(after.animationStates, ['idle'])
  assert.equal(after.pending, 0)
  assert.equal(after.hook, false)
  await withRecorder(page, async () => {
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-screencast-clock]').length), 2)
  })
  record('construction failure rolls back actual allocated clock resources', after)
}

async function checkedReleaseFailureCheck(browser) {
  const context = await browser.createBrowserContext()
  let recorder = null
  let disposed = false
  let failure = null
  const clients = new Map()
  try {
    const page = await context.newPage()
    await page.setViewport(viewport)
    await page.setContent('<!doctype html><html><body></body></html>')
    recorder = await createScreencastRecorder(page, captureOptions)
    const input = await fixtures(page, 'png')
    const original = page.evaluateHandle.bind(page)
    const owned = []
    const releaseObservations = new Map()
    const checkedRejections = []
    const retain = handle => {
      const objectId = handle.remoteObject().objectId
      if (!objectId) return handle
      owned.push(handle)
      releaseObservations.set(objectId, { attempted: false, usableBeforeRelease: false, fallbackReleased: false })
      const evaluateHandle = handle.evaluateHandle.bind(handle)
      handle.evaluateHandle = async (...args) => retain(await evaluateHandle(...args))
      const client = handle.client
      if (!clients.has(client)) {
        const send = client.send.bind(client)
        clients.set(client, send)
        client.send = async (...args) => {
          if (args[0] !== 'Runtime.releaseObject') return send(...args)
          const id = args[1].objectId
          const observed = releaseObservations.get(id)
          if (observed === undefined) return send(...args)
          if (observed.attempted) {
            const response = await send(...args)
            await assert.rejects(() => send('Runtime.getProperties', { objectId: id, ownProperties: true, accessorPropertiesOnly: true }), /Could not find object|Invalid remote object id|Cannot find object/)
            observed.fallbackReleased = true
            return response
          }
          observed.attempted = true
          const properties = await send('Runtime.getProperties', { objectId: id, ownProperties: true, accessorPropertiesOnly: true })
          observed.usableBeforeRelease = Array.isArray(properties.result)
          try {
            return await send('Runtime.releaseObject', { objectId: 'fixture-invalid-remote-object-id' })
          } catch (error) {
            checkedRejections.push(error)
            throw error
          }
        }
      }
      return handle
    }
    page.evaluateHandle = async (...args) => retain(await original(...args))
    let scoringFailure = null
    try {
      await scoreScreencast(page, fixtureCapture('png', input.frames), {
        reference: { kind: 'image', encoding: 'png', data: input.reference },
        context: null,
        createScorer() {
          return {
            inspect() { throw new Error('fixture primary before checked release') },
            summarize() { return null },
          }
        },
      })
    } catch (error) {
      scoringFailure = error
    }
    assert.ok([...releaseObservations.values()].every(observed => observed.usableBeforeRelease))
    assert.ok(scoringFailure instanceof AggregateError)
    assert.equal(scoringFailure.cause, scoringFailure.errors[0])
    assert.match(String(scoringFailure.errors[0]), /fixture primary before checked release/)
    assert.equal(checkedRejections.length, owned.length, 'Every owned object must receive a rejecting actual checked release request')
    assert.ok(checkedRejections.every(error => scoringFailure.errors.includes(error)), 'The aggregate must retain every actual checked release rejection')
    assert.ok(scoringFailure.errors.slice(1).every(error => checkedRejections.includes(error)), 'Cleanup failures must be the actual checked release rejections')
    assert.equal(scoringFailure.errors.length, owned.length + 1)
    assert.match(String(scoringFailure), /fixture primary before checked release.*cleanup failed.*Invalid remote object id/s)
    assert.ok(owned.every(handle => handle.disposed), 'Native disposal still updates every local handle when actual release rejects')
    assert.ok([...releaseObservations.values()].every(observed => observed.fallbackReleased), 'Every native fallback must release its original valid remote object')
    assert.equal(await page.evaluate(() => document.body.isConnected), true)
    await recorder.dispose()
    disposed = true
    record('checked remote release preserves actual protocol rejection', {
      ownedObjects: owned.length,
      actualRejectedCheckedReleases: checkedRejections.length,
      nativeFallbackReleasedObjects: [...releaseObservations.values()].filter(observed => observed.fallbackReleased).length,
      localHandlesDisposed: owned.every(handle => handle.disposed),
      scorerError: String(scoringFailure),
      pageRemainedAlive: true,
      limit: 'Only the first release request per object receives a malformed ID. Chrome rejects it; native disposal then releases the original valid ID. No protocol result is replaced.',
    })
  } catch (error) {
    failure = { error }
  } finally {
    if (recorder !== null && !disposed) {
      try { await recorder.dispose() } catch (error) { failure = combineFailure(failure, error) }
    }
    for (const [client, send] of clients) client.send = send
    try { await context.close() } catch (error) { failure = combineFailure(failure, error) }
  }
  if (failure !== null) throw failure.error
}

async function startFailureCheck(page) {
  const observer = observeSessions(page, true)
  try {
    await withRecorder(page, async recorder => {
      await assert.rejects(() => recorder.start(), /closed|detached|session/i)
      observer.assertClosed(observer.sessions[0])
      assert.equal(await page.evaluate(() => document.querySelectorAll('[data-screencast-clock]').length), 2)
      await recorder.start()
      const active = observer.sessions.at(-1)
      await waitForImages(active)
      const capture = await recorder.stop({ through: await page.evaluate(() => performance.timeOrigin + performance.now()), timeoutMs: 3000 })
      observer.assertClosed(active, capture)
      record('failed start cleans its real session and restores idle', { rejectedSession: observer.sessions[0].session.id(), replacementSession: active.session.id(), images: capture.frames.length })
    })
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-screencast-clock]').length), 0)
  } finally {
    observer.restore()
  }
}

async function interruptionCheck(page) {
  const observer = observeSessions(page)
  const recorder = await createScreencastRecorder(page, captureOptions)
  let failure = null
  try {
    await recorder.start()
    const observation = observer.sessions.at(-1)
    await waitForImages(observation)
    await observation.session.detach()
    try {
      await recorder.stop({ through: Date.now() + 60_000, timeoutMs: 100 })
    } catch (error) {
      failure = { error }
    }
    assert.notEqual(failure, null, 'Actual session interruption must not return partial evidence as a successful stop')
    assert.ok(!(failure.error instanceof IncompleteScreencastError))
    await recorder.dispose()
    observer.assertClosed(observation)
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-screencast-clock]').length), 0)
    record('actual protocol interruption is terminal and cleaned', { error: String(failure.error), imagesDelivered: observation.received, pendingAcknowledgements: observation.pending })
  } finally {
    observer.restore()
    await recorder.dispose()
  }
}

async function stoppingDisposalCheck(page) {
  const observer = observeSessions(page)
  try {
    const recorder = await createScreencastRecorder(page, captureOptions)
    await recorder.start()
    const observation = observer.sessions.at(-1)
    await waitForImages(observation)
    const stopping = recorder.stop({ through: Date.now() + 60_000, timeoutMs: 80 })
    const disposal = recorder.dispose()
    const capture = await stopping
    await disposal
    await recorder.dispose()
    assert.ok(capture.frames.length >= 3)
    assert.equal(capture.collectionEnd.timedOut, true)
    observer.assertClosed(observation, capture)
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-screencast-clock]').length), 0)
    record('disposal joins an actual pending stop', { images: capture.frames.length, stopCommands: observation.stopCommands, pendingAcknowledgements: observation.pending, collectionEnd: capture.collectionEnd })
  } finally {
    observer.restore()
  }
}

async function acknowledgementDisposalCheck(page) {
  await observeClock(page)
  for (const timing of ['after stop', 'before disposal']) {
    const createSession = page.createCDPSession.bind(page)
    const acknowledgementGate = Promise.withResolvers()
    const acknowledgementRejected = Promise.withResolvers()
    let intercepted = false
    let stopSucceeded = false
    let acknowledgementFailure = null
    let acknowledgementFailedAfterStop = null
    page.createCDPSession = async () => {
      const session = await createSession()
      const send = session.send.bind(session)
      session.send = async (method, parameters) => {
        if (method === 'Page.screencastFrameAck' && !intercepted) {
          intercepted = true
          // The ACK belongs to a real frame; malformed parameters make Chrome reject it.
          await acknowledgementGate.promise
          try {
            return await send(method, { ...parameters, sessionId: 'invalid-acknowledgement-id' })
          } catch (error) {
            acknowledgementFailure = error
            acknowledgementFailedAfterStop = stopSucceeded
            acknowledgementRejected.resolve()
            throw error
          }
        }
        const response = await send(method, parameters)
        if (method === 'Page.stopScreencast') {
          stopSucceeded = true
          acknowledgementGate.resolve()
        }
        return response
      }
      return session
    }
    const observer = observeSessions(page)
    let recorder = null
    let disposalSettled = false
    let failure = null
    try {
      recorder = await createScreencastRecorder(page, captureOptions)
      await recorder.start()
      const observation = observer.sessions.at(-1)
      await waitForImages(observation, 1)
      assert.equal(intercepted, true, 'The held ACK must belong to an actual Chrome frame')
      assert.ok(observation.pending >= 1)
      assert.equal(acknowledgementFailure, null)
      if (timing === 'before disposal') {
        acknowledgementGate.resolve()
        await acknowledgementRejected.promise
        await page.evaluate(() => document.body.isConnected)
        assert.equal(stopSucceeded, false)
        assert.deepEqual(observation.acknowledgementFailures, [String(acknowledgementFailure)])
      }
      let disposalFailure = null
      try {
        await recorder.dispose()
      } catch (error) {
        disposalFailure = error
      } finally {
        disposalSettled = true
      }
      assert.equal(stopSucceeded, true, 'Disposal must complete the actual stop command')
      assert.equal(acknowledgementFailedAfterStop, timing === 'after stop')
      assert.match(String(acknowledgementFailure), /Protocol error \(Page\.screencastFrameAck\).*Invalid parameters/)
      assert.deepEqual(observation.acknowledgementFailures, [String(acknowledgementFailure)])
      observer.assertClosed(observation)
      const clock = await page.evaluate(() => ({
        markers: document.querySelectorAll('[data-screencast-clock]').length,
        pending: window.__recordingClockObservation.pending.size,
        animations: document.getAnimations().length,
        hook: Object.hasOwn(window, '__screencastClock'),
      }))
      assert.deepEqual(clock, { markers: 0, pending: 0, animations: 0, hook: false })
      assert.ok(disposalFailure instanceof AggregateError, 'Active disposal must report the actual ACK rejection as a terminal cleanup failure')
      assert.deepEqual(disposalFailure.errors, [acknowledgementFailure], 'Disposal must retain the actual ACK rejection exactly once')
      assert.equal(disposalFailure.errors[0], acknowledgementFailure)
      assert.equal(disposalFailure.cause, acknowledgementFailure)
      record(`active disposal retains ACK rejection ${timing}`, {
        error: String(disposalFailure),
        imagesDelivered: observation.received,
        pendingAcknowledgements: observation.pending,
        stopSucceeded,
        clock,
      })
    } catch (error) {
      failure = { error }
    } finally {
      acknowledgementGate.resolve()
      if (recorder !== null && !disposalSettled) {
        try { await recorder.dispose() } catch (error) { failure = combineFailure(failure, error) }
      }
      observer.restore()
      page.createCDPSession = createSession
    }
    if (failure !== null) throw failure.error
  }
}

let browser
let failure = null
try {
  browser = await puppeteer.launch({ executablePath: chrome, headless: process.env.HEADED !== '1', args: [...WEBGPU_CHROME_ARGS,'--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] })
  console.log(`screencast-recording: ${await browser.version()} · ordinary DOM · PNG/JPEG · ${viewport.width}×${viewport.height} DPR 1`)
  for (const check of [decodingCheck, exceptionalScoringCheck, acquisitionCheck, clockCheck, constructionCollisionCheck, constructionRollbackCheck, startFailureCheck, interruptionCheck, stoppingDisposalCheck, acknowledgementDisposalCheck]) {
    await withPage(browser, check)
  }
  await checkedReleaseFailureCheck(browser)
} catch (error) {
  failure = { error }
} finally {
  try {
    await browser?.close()
  } catch (error) {
    failure = combineFailure(failure, error)
  } finally {
    clearTimeout(deadline)
  }
}

if (failure !== null) {
  console.error('screencast-recording: FAIL', failure.error)
  process.exitCode = 1
} else {
  console.log(`screencast-recording: PASS — ${results.length} measurements; real scene pixels and hosted reliability remain the gates' responsibility`)
}
