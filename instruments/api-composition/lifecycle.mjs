// Grouped handoffs, retained views and shared captures through the public composition fixture.
import assert from 'node:assert/strict'
import { capability, evidenceDirectory, fill, fixtureServer, runBrowserCases, screenshotPixel } from '../apiBrowser.mjs'

const output = await evidenceDirectory('composition-lifecycle')
const server = await fixtureServer('instruments/api-composition', 'API_COMPOSITION_URL', output)
async function open(page, pathname = '/') {
  await page.goto(server.url + pathname, { waitUntil: 'load' })
  await capability(page, true)
  await page.evaluate(() => document.fonts.ready)
  if (pathname === '/') await page.waitForFunction(() => window.__composition?.records.group)
}
const waitPage = (page, group) => page.waitForFunction(group => {
  const status = window.__composition.records[group]
  return status.presentation === 'page' && !status.isTransitioning
}, {}, group)
const waitScene = (page, group) => page.waitForFunction(group => {
  const status = window.__composition.records[group]
  return status.presentation === 'scene' && !status.isTransitioning
}, {}, group)
const retainedViews = async page => {
  const result = await page.evaluate(() => ({
    same: Object.entries(window.originalViews).every(([id, node]) => document.querySelector(`[data-api-live] [data-content="${id}"]`) === node),
    mounts: window.__composition.records.mounts, unmounts: window.__composition.records.unmounts, errors: window.__composition.records.errors,
  }))
  assert.ok(result.same)
  for (const name of ['first', 'second', 'view-a', 'view-b']) assert.equal(result.mounts[name], 1, `Missing or remounted ${name}`)
  assert.deepEqual(result.unmounts, {})
  assert.deepEqual(result.errors, [])
  return result
}
async function rememberViews(page) {
  await page.waitForFunction(() => Object.keys(window.__composition.records.mounts).length === 4)
  await page.evaluate(() => { window.originalViews = Object.fromEntries([...document.querySelectorAll('[data-api-live] [data-content]')].map(node => [node.dataset.content, node])) })
  assert.equal(await page.evaluate(() => Object.keys(originalViews).length), 4)
}

const cases = [
  { id: 'grouped-parts', async run(page) {
    await open(page); await rememberViews(page)
    await fill(page, '[data-api-live] [data-content="first"] input', 'group edit')
    await page.click('#group-toggle')
    await page.waitForFunction(() => window.__composition.records.group.requestedInScene)
    // Past the current default settle and capture wait; the presenter remains absent.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 750)))
    const pending = await page.evaluate(() => window.__composition.records.group)
    assert.equal(pending.presentation, 'page'); assert.equal(pending.sceneReady, false)
    await page.click('#group-ready'); await waitScene(page, 'group')
    // Arrange focus on the retained input; its parked DOM bounds do not locate the scene mesh.
    await page.focus('[data-api-live] [data-content="first"] input')
    assert.ok(await page.evaluate(() => document.activeElement === originalViews.first.querySelector('input')))
    await page.$eval('[data-api-live] [data-content="first"] input', element => element.setSelectionRange(0, element.value.length))
    await page.keyboard.type('edited in scene')
    assert.ok(await page.evaluate(() => document.activeElement === originalViews.first.querySelector('input') && originalViews.first.querySelector('input').value === 'edited in scene'))
    await page.click('#group-toggle'); await waitPage(page, 'group')
    assert.equal(await page.evaluate(() => originalViews.first.querySelector('input').value), 'edited in scene')
    return { pending, ...(await retainedViews(page)), sceneEditRetained: true, input: 'programmatic scene focus and selection; browser typing' }
  } },
  { id: 'different-content', async run(page) {
    await open(page); await rememberViews(page)
    const background = await page.evaluate(() => {
      const canvas = new OffscreenCanvas(1, 1), context = canvas.getContext('2d')
      context.fillStyle = getComputedStyle(document.body).backgroundColor
      context.fillRect(0, 0, 1, 1)
      return Array.from(context.getImageData(0, 0, 1, 1).data)
    })
    assert.deepEqual(await screenshotPixel(page, 8, 8), background, 'The initial margin must show the authored page background')
    await fill(page, '[data-api-live] [data-content="view-a"] input', 'A keeps this')
    await page.click('#transition-toggle')
    await page.waitForFunction(() => window.__composition.records.activePage === 'b' && window.__composition.records.transition.presentation === 'page')
    await fill(page, '[data-api-live] [data-content="view-b"] input', 'B keeps this')
    await page.click('[data-api-live] [data-content="view-b"] button')
    assert.deepEqual(await screenshotPixel(page, 8, 8), background, 'A parked capture must not cover the page background')
    await page.click('#transition-toggle')
    await page.waitForFunction(() => window.__composition.records.activePage === 'a' && window.__composition.records.transition.presentation === 'page')
    const values = await page.evaluate(() => [originalViews['view-a'].querySelector('input').value, originalViews['view-b'].querySelector('input').value, originalViews['view-b'].querySelector('button').textContent])
    assert.deepEqual(values, ['A keeps this', 'B keeps this', 'Count 1'])
    return { values, background, ...(await retainedViews(page)) }
  } },
  { id: 'cancel-transition', async run(page) {
    await open(page); await rememberViews(page)
    await page.click('#transition-toggle')
    await page.waitForFunction(() => window.__composition.records.transition.presentation === 'scene' && window.__composition.records.blend > 0.2 && window.__composition.records.blend < 0.85)
    const cancelledAt = await page.evaluate(() => {
      const progress = window.__composition.records.blend
      if (!(progress > 0.2 && progress < 0.85)) throw new Error('Cancellation missed the intermediate motion window')
      document.getElementById('transition-cancel').click()
      return progress
    })
    await waitPage(page, 'transition')
    assert.equal(await page.evaluate(() => window.__composition.records.activePage), 'a')
    return { cancelledAt, ...(await retainedViews(page)), input: 'browser start, programmatic cancellation at observed progress' }
  } },
  { id: 'attached-capture', async run(page) {
    await open(page)
    await page.click('#source-toggle')
    await page.waitForFunction(() => window.__composition.records.samples.a && window.__composition.records.samples.b)
    const first = await page.evaluate(() => window.__composition.records.samples.a)
    await page.evaluate(() => { window.nativeCapture = document.getElementById('capture-original'); window.nativeInput = nativeCapture.querySelector('input') })
    await fill(page, '#capture-original input', 'capture edit')
    await page.evaluate(() => {
      Object.assign(nativeCapture.style, { background: 'rgb(180,40,80)', width: '360px', height: '210px' })
      window.__composition.records.capture.refresh()
    })
    await page.waitForFunction(() => window.__composition.records.samples.a?.width === 360 && window.__composition.records.samples.a.pixel[0] === 180)
    const changed = await page.evaluate(() => ({ sample: window.__composition.records.samples.a, same: nativeCapture === document.getElementById('capture-original') && nativeInput === document.querySelector('#capture-original input'), capturedValue: document.querySelector('[data-api-capture] input')?.value, nativeInert: nativeCapture.inert }))
    assert.equal(changed.sample.sourceId, first.sourceId); assert.ok(changed.same)
    assert.equal(changed.capturedValue, 'capture edit'); assert.equal(changed.nativeInert, false)
    await page.click('#consumer-toggle'); await page.waitForFunction(() => window.__composition.capture().consumers === 1)
    assert.equal(await page.evaluate(() => window.__composition.records.samples.a.sourceId), first.sourceId)
    await page.click('#source-toggle')
    await page.waitForFunction(() => window.__composition.records.samples.a === null && window.__composition.capture().status.status === 'waiting')
    await page.click('#source-toggle'); await page.waitForFunction(() => window.__composition.records.samples.a !== null)
    const restored = await page.evaluate(() => window.__composition.records.samples.a.sourceId)
    assert.notEqual(restored, first.sourceId)
    await page.click('#source-replace')
    await page.waitForFunction(id => window.__composition.records.samples.a !== null && window.__composition.records.samples.a.sourceId !== id, {}, restored)
    assert.equal(await page.$eval('#capture-original input', element => element.value), 'source-1')
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)))
    const before = await page.evaluate(() => window.__composition.capture().frame.revision)
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)))
    assert.equal(await page.evaluate(() => window.__composition.capture().frame.revision), before)
    assert.deepEqual(await page.evaluate(() => window.__composition.records.errors), [])
    return { first, changed, restoredSourceId: restored, idleRevision: before }
  } },
  { id: 'sampled-parts', async run(page) {
    await open(page)
    await page.waitForFunction(() => window.__sampledParts)
    await page.$eval('#sampled-toggle', element => element.scrollIntoView())
    const box = await page.$eval('#sampled-page', element => element.getBoundingClientRect().toJSON())
    await page.click('#sampled-toggle'); await page.waitForFunction(() => window.__sampledParts.requestedInScene)
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)))
    assert.equal(await page.evaluate(() => window.__sampledParts.presentation), 'page')
    assert.equal(await page.evaluate(() => window.__sampledParts.sceneReady), false)
    await page.click('#sampled-source')
    await page.waitForFunction(() => window.__sampledParts.presentation === 'scene' && !window.__sampledParts.isTransitioning)
    const offsets = process.env.API_INVERT_SAMPLES === '1' ? [230, 70] : [70, 230]
    const left = await screenshotPixel(page, box.x + offsets[0], box.y + 90)
    const right = await screenshotPixel(page, box.x + offsets[1], box.y + 90)
    assert.deepEqual(left.slice(0, 3), [255, 0, 0]); assert.deepEqual(right.slice(0, 3), [0, 0, 255])
    await page.click('#sampled-toggle')
    await page.waitForFunction(() => window.__sampledParts.presentation === 'page' && !window.__sampledParts.isTransitioning)
    return { left, right, requiredBothSources: true, returned: true }
  } },
  { id: 'whole-document', async run(page) {
    await open(page, '/whole-page.html')
    await page.waitForFunction(() => window.__wholeCapture?.record.sample)
    const html = await page.evaluate(() => window.__wholeCapture.record.sample)
    assert.equal(html.height, 1800)
    assert.deepEqual(html.top, [36, 96, 192, 255]); assert.deepEqual(html.bottom, [180, 40, 80, 255])
    await page.evaluate(() => { window.originalNote = document.getElementById('native-note') })
    await fill(page, '#native-note', 'The original stays editable'); await page.click('#increment'); await page.click('#target-kind')
    await page.waitForFunction(id => window.__wholeCapture.record.kind === 'body' && window.__wholeCapture.record.sample?.sourceId !== id && window.__wholeCapture.record.sample?.sourceId === window.__wholeCapture.read().frame?.sourceId, {}, html.sourceId)
    const body = await page.evaluate(() => window.__wholeCapture.record.sample)
    assert.notEqual(body.sourceId, html.sourceId); assert.equal(body.height, 1800)
    assert.deepEqual(body.top, html.top); assert.deepEqual(body.bottom, html.bottom)
    assert.ok(await page.evaluate(() => document.getElementById('native-note') === originalNote && originalNote.value === 'The original stays editable' && !document.body.inert && window.__wholeCapture.record.count === 1))
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)))
    const before = await page.evaluate(() => window.__wholeCapture.read().frame.revision)
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)))
    assert.equal(await page.evaluate(() => window.__wholeCapture.read().frame.revision), before)
    return { html, body, nativeInputRetained: true, idleRevision: before }
  } },
  { id: 'native-whole-document', native: true, async run(page) {
    await page.goto(`${server.url}/whole-page.html`, { waitUntil: 'load' }); await capability(page, false)
    await page.waitForFunction(() => window.__wholeCapture?.read()?.status.status === 'unsupported')
    await fill(page, '#native-note', 'uncaptured native input'); await page.click('#increment')
    const record = await page.evaluate(() => ({ status: window.__wholeCapture.read().status, frame: window.__wholeCapture.read().frame, count: window.__wholeCapture.record.count, value: document.getElementById('native-note').value, captures: [...document.querySelectorAll('canvas')].filter(canvas => canvas.layoutSubtree).length }))
    assert.equal(record.frame, null); assert.equal(record.captures, 0)
    assert.equal(record.count, 1); assert.equal(record.value, 'uncaptured native input')
    return record
  } },
]
try { await runBrowserCases(cases, output) } finally { await server.close() }
