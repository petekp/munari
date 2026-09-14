// Controls and caller-owned capture lifetimes; pixel budgets live in the focused probes.
import assert from 'node:assert/strict'
import { capability, evidenceDirectory, fill, fixtureServer, runBrowserCases } from '../apiBrowser.mjs'

const output = await evidenceDirectory('api-lifecycle-contracts')
const lab = await fixtureServer('apps/lab', 'API_PROOF_URL', output)
const capture = await fixtureServer('instruments/api-capture', 'API_CAPTURE_URL', output)
const settled = (page, presentation) => page.waitForFunction(presentation => window.__apiControls.status.presentation === presentation && !window.__apiControls.status.isTransitioning, {}, presentation)
async function controls(page, native = false, delayed = false) {
  await page.goto(`${lab.url}/?scene=controls&framed${delayed ? '&delayScene' : ''}`, { waitUntil: 'load' })
  await capability(page, !native)
  await page.waitForFunction(() => window.__apiControls?.status?.presentation === 'page' && document.querySelector('[data-api-live] input'))
  await page.evaluate(() => {
    window.originalControl = document.querySelector('[data-api-live] input')
    originalControl.dataset.controlProof = ''
    window.__apiControls.frames.length = 0; window.__apiControls.holds.length = 0
  })
}
const state = page => page.evaluate(() => ({
  status: window.__apiControls.status, holds: [...window.__apiControls.holds],
  same: originalControl === document.querySelector('[data-api-live] input'), value: originalControl.value,
}))
async function requestAt(page, returning) {
  await page.waitForFunction(returning => {
    const amount = window.__apiControls.frames.at(-1)?.amount
    return returning ? amount > 0 && amount < 0.65 : amount > 0.04 && amount < 0.95
  }, {}, returning)
  return page.evaluate(returning => {
    const amount = window.__apiControls.frames.at(-1)?.amount
    if (!(returning ? amount > 0 && amount < 0.65 : amount > 0.04 && amount < 0.95)) throw new Error('The motion reversal missed its intermediate window')
    window.__apiControls.request(returning)
    return amount
  }, returning)
}

const cases = [
  { id: 'controls-motion', async run(page) {
    await controls(page)
    await fill(page, '[data-api-live] [data-control-proof]', 'Controls continuity')
    await page.click('.controls-mode button'); await settled(page, 'scene')
    await fill(page, '[data-api-live] [data-control-proof]', 'Edited while physical')
    await page.click('.controls-mode button'); await settled(page, 'page')
    const full = await state(page)
    assert.ok(full.same); assert.equal(full.value, 'Edited while physical')
    assert.ok(full.holds.some(hold => hold.presentation === 'scene'))
    assert.ok(full.holds.some(hold => hold.presentation === 'page'))
    assert.ok(full.holds.filter(hold => hold.presentation === 'page').every(hold => hold.progress === 0))

    await page.evaluate(() => { window.__apiControls.frames.length = 0; window.__apiControls.holds.length = 0 })
    await page.click('.controls-mode button')
    const earlyAmount = await requestAt(page, false)
    await settled(page, 'page')
    const early = await state(page)
    assert.ok(early.same); assert.equal(early.value, full.value)
    assert.ok(early.holds.some(hold => hold.presentation === 'page' && hold.progress === 0))

    await page.click('.controls-mode button'); await settled(page, 'scene')
    await page.evaluate(() => { window.__apiControls.frames.length = 0; window.__apiControls.holds.length = 0 })
    await page.click('.controls-mode button')
    const reversalAmount = await requestAt(page, true)
    await settled(page, 'scene')
    const reversed = await state(page)
    assert.ok(reversed.same)
    assert.equal(reversed.holds.some(hold => hold.presentation === 'page'), false)
    await page.click('.controls-mode button'); await settled(page, 'page')
    return { full, early: { ...early, earlyAmount }, reversed: { ...reversed, reversalAmount }, input: 'browser toggles and typing; programmatic requests at measured intermediate progress' }
  } },
  { id: 'controls-focus', async run(page) {
    await controls(page, false, true)
    await page.evaluate(() => {
      window.controlsFocusTrace = []
      for (const type of ['focusin', 'focusout']) document.addEventListener(type, event => {
        window.controlsFocusTrace.push({ type, target: event.target?.localName, original: event.target === originalControl, originalConnected: originalControl.isConnected, inCanvas: Boolean(originalControl.closest('canvas')), presentation: window.__apiControls.status.presentation })
      }, { capture: true })
    })
    await fill(page, '[data-api-live] [data-control-proof]', 'State before delayed preparation')
    await page.focus('[data-api-live] [data-control-proof]')
    await page.evaluate(() => { originalControl.setSelectionRange(2, 7); window.__apiControls.request(true) })
    await page.waitForFunction(() => window.__apiControls.status.isTransitioning && !window.__apiControls.sceneResolved)
    const preparing = await page.evaluate(() => ({ status: window.__apiControls.status, focus: document.activeElement === originalControl, selection: [originalControl.selectionStart, originalControl.selectionEnd], frames: window.__apiControls.frames.length }))
    assert.equal(preparing.status.presentation, 'page'); assert.ok(preparing.focus); assert.equal(preparing.frames, 0)
    assert.deepEqual(preparing.selection, [2, 7])
    await page.click('[data-api-live] button[type="submit"]')
    const action = await page.evaluate(() => ({ resolved: window.__apiControls.sceneResolved, actions: [...window.__apiControls.actions] }))
    assert.equal(action.actions.length, 1); assert.ok(action.actions[0].trusted); assert.equal(action.resolved, false)
    await page.focus('[data-api-live] [data-control-proof]'); await page.evaluate(() => originalControl.setSelectionRange(2, 7))
    assert.ok(await page.evaluate(() => document.activeElement === originalControl), 'The real input must be refocused before observing the handoff')
    await settled(page, 'scene')
    const entered = await page.evaluate(() => ({ focused: document.activeElement === originalControl, active: document.activeElement?.localName, connected: originalControl.isConnected, inCanvas: Boolean(originalControl.closest('canvas')), inert: Boolean(originalControl.closest('[inert]')), visibility: getComputedStyle(originalControl).visibility, trace: window.controlsFocusTrace }))
    assert.ok(entered.focused, JSON.stringify(entered))
    assert.deepEqual(await page.evaluate(() => [originalControl.selectionStart, originalControl.selectionEnd]), [2, 7])
    await fill(page, '[data-api-live] [data-control-proof]', 'Typed in the scene')
    await page.evaluate(() => { originalControl.setSelectionRange(3, 8); window.__apiControls.request(false) })
    await settled(page, 'page')
    const returned = await state(page)
    assert.ok(returned.same); assert.equal(returned.value, 'Typed in the scene')
    assert.ok(await page.evaluate(() => document.activeElement === originalControl))
    assert.deepEqual(await page.evaluate(() => [originalControl.selectionStart, originalControl.selectionEnd]), [3, 8])

    await page.evaluate(() => { Object.assign(document.querySelector('.controls-page').style, { transformOrigin: '0 0', transform: 'translate(24px,12px) scale(0.9)' }); window.__apiControls.request(true) })
    await settled(page, 'scene')
    const count = await page.evaluate(() => window.__apiControls.actions.length)
    await page.click('[data-api-live] button[type="submit"]')
    const scaled = await page.evaluate(() => ({ count: window.__apiControls.actions.length, last: window.__apiControls.actions.at(-1) }))
    assert.equal(scaled.count, count + 1); assert.ok(scaled.last.trusted)
    await page.evaluate(() => { document.querySelector('.controls-page').style.transform = ''; window.__apiControls.request(false) })
    await settled(page, 'page')
    await page.evaluate(() => {
      window.constructed = 0
      customElements.define('api-content-probe', class extends HTMLElement { constructor() { super(); window.constructed++ } })
      const widget = document.createElement('api-content-probe'); widget.textContent = 'Native widget'
      document.querySelector('[data-api-live]').append(widget)
    })
    await page.waitForFunction(() => window.__apiControls.status.reason !== null)
    await page.evaluate(() => window.__apiControls.request(true))
    await page.waitForFunction(() => window.__apiControls.status.requestedInScene)
    const refused = await page.evaluate(() => ({ status: window.__apiControls.status, constructors: window.constructed, widgets: document.querySelectorAll('api-content-probe').length }))
    assert.equal(refused.constructors, 1); assert.equal(refused.widgets, 1)
    assert.equal(refused.status.presentation, 'page'); assert.equal(refused.status.supported, false)
    return { preparing, action, returned, scaled, refused, input: 'browser typing and trusted submit; programmatic renderer requests' }
  } },
  { id: 'native-controls', native: true, async run(page) {
    await controls(page, true)
    await fill(page, '[data-api-live] [data-control-proof]', 'native fallback')
    await page.evaluate(() => window.__apiControls.request(true))
    await page.waitForFunction(() => window.__apiControls.status.requestedInScene)
    const result = await state(page)
    assert.ok(result.same); assert.equal(result.value, 'native fallback')
    assert.equal(result.status.presentation, 'page'); assert.equal(result.status.supported, false)
    assert.equal(await page.$$eval('canvas', elements => elements.filter(element => element.layoutSubtree).length), 0)
    return result
  } },
  { id: 'shared-capture', async run(page) {
    await page.goto(capture.url, { waitUntil: 'load' }); await capability(page, true)
    await page.waitForSelector('[data-api-capture]')
    await page.waitForFunction(() => window.__captureProbe?.read().latest.a?.pixel?.[0] === 36 && window.__captureProbe.read().latest.b?.pixel?.[0] === 36)
    const read = () => page.evaluate(() => window.__captureProbe.read())
    const initial = await read()
    assert.equal(initial.consumers, 2)
    assert.equal(initial.latest.a.uuid, initial.latest.b.uuid)
    await page.evaluate(() => window.__captureProbe.paint('rgb(180,40,80)', 'Frame two'))
    await page.waitForFunction(() => window.__captureProbe.read().latest.a?.pixel?.[0] === 180 && window.__captureProbe.read().latest.b?.pixel?.[0] === 180)
    const changed = await read()
    assert.deepEqual(changed.renders, initial.renders); assert.equal(changed.frame.uuid, initial.frame.uuid)
    assert.ok(changed.frame.generation > initial.frame.generation)
    await page.evaluate(() => window.__captureProbe.resize(320, 180))
    await page.waitForFunction(() => window.__captureProbe.read().latest.a?.width === 320 && window.__captureProbe.read().latest.b?.width === 320 && window.__captureProbe.read().latest.a?.anchor?.x === 24)
    const resized = await read(); assert.equal(resized.frame.uuid, initial.frame.uuid)
    await page.evaluate(() => window.__captureProbe.showSecond(false))
    await page.waitForFunction(() => window.__captureProbe.read().consumers === 1)
    const one = await read(); assert.equal(one.disposal, resized.disposal)
    await page.evaluate(() => window.__captureProbe.paint('rgb(21,148,110)', 'Frame three'))
    await page.waitForFunction(() => window.__captureProbe.read().latest.a?.pixel?.[0] === 21)
    const continued = await read(); assert.equal(continued.draws.b, one.draws.b)
    const quiescence = await page.evaluate(async () => {
      const read = () => { const record = window.__captureProbe.read(); return { draws: record.draws.a, revision: record.frame.revision } }
      const samples = [read()]
      let stable = 0
      for (let i = 0; i < 8 && stable < 2; i++) {
        await new Promise(resolve => setTimeout(resolve, 500))
        const next = read(), previous = samples.at(-1)
        stable = next.draws === previous.draws && next.revision === previous.revision ? stable + 1 : 0
        samples.push(next)
      }
      return { stable, samples }
    })
    assert.equal(quiescence.stable, 2, `The capture never became quiescent: ${JSON.stringify(quiescence.samples)}`)
    const idle = await page.evaluate(async () => {
      const samples = []
      for (let i = 0; i < 3; i++) {
        const record = window.__captureProbe.read(); samples.push({ draws: record.draws.a, revision: record.frame.revision })
        if (i < 2) await new Promise(resolve => setTimeout(resolve, 500))
      }
      return samples
    })
    assert.deepEqual(idle[1], idle[0]); assert.deepEqual(idle[2], idle[0])
    await page.evaluate(() => window.__captureProbe.showSource(false))
    await page.waitForFunction(() => window.__captureProbe.read().status.status === 'waiting' && window.__captureProbe.read().latest.a?.empty === true)
    assert.equal((await read()).frame, null)
    await page.evaluate(() => window.__captureProbe.showSource(true))
    await page.waitForFunction(id => window.__captureProbe.read().latest.a?.pixel?.[0] === 21 && window.__captureProbe.read().frame?.sourceId !== id, {}, continued.frame.sourceId)
    const remounted = await read()
    await page.evaluate(() => window.__captureProbe.replace())
    await page.waitForFunction(id => window.__captureProbe.read().latest.a?.pixel?.[0] === 36 && window.__captureProbe.read().frame?.sourceId !== id && window.__captureProbe.read().latest.a?.width === 200, {}, remounted.frame.sourceId)
    const replaced = await read()
    await page.evaluate(() => window.__captureProbe.invalid())
    await page.waitForFunction(() => window.__captureProbe.read().status.status === 'error')
    const invalid = await read(); assert.equal(invalid.frame, null)
    assert.equal(await page.$eval('#parented-source', element => element.inert), false)
    await page.evaluate(() => window.__captureProbe.showSource(false))
    await page.waitForFunction(() => window.__captureProbe.read().status.status === 'waiting')
    return { initial, changed, resized, continued, quiescence, idle, remounted, replaced, invalid }
  } },
]
try { await runBrowserCases(cases, output) } finally { await capture.close(); await lab.close() }
