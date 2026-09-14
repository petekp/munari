// Real gestures for routes without dedicated interaction gates, plus native outcomes.
import assert from 'node:assert/strict'
import { capability, evidenceDirectory, fixtureServer, runBrowserCases } from '../apiBrowser.mjs'

const output = await evidenceDirectory('route-gestures')
const server = await fixtureServer('apps/lab', 'API_LAB_URL', output)
const cases = []
function sceneCase(id, scene, run, { candidate, native = false } = {}) {
  cases.push({ id, native, async run(page) {
    await page.goto(`${server.url}/?scene=${scene}&framed${candidate ? `&candidate=${candidate}` : ''}`, { waitUntil: 'load' })
    await capability(page, !native)
    if (candidate) {
      await page.waitForSelector('.cand-app')
      assert.equal(await page.$eval('.cand-rail [aria-current="page"] strong', element => element.textContent.toLowerCase()), candidate)
      if (!native) await page.waitForFunction(() => Boolean(window.__r3f?.scene))
    }
    await page.evaluate(() => document.fonts.ready)
    return run(page)
  } })
}
const meshes = (page, present) => page.waitForFunction(present => {
  if (!window.__r3f?.scene) return false
  let count = 0
  window.__r3f.scene.traverse(object => { if (object.isMesh) count++ })
  return present ? count > 0 : count === 0
}, {}, present)
const center = (page, selector) => page.$eval(selector, element => {
  const box = element.getBoundingClientRect()
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
})

sceneCase('gravity', 'gravity', async page => {
  await page.waitForFunction(() => window.__gravityApi?.elements().length > 1)
  await page.evaluate(() => {
    window.originalWord = window.__gravityApi.elements()[0]
    window.originalParagraph = document.querySelector('.gv-poem')
    window.originalSlot = originalWord.parentElement.parentElement
    window.nextWord = window.__gravityApi.elements()[1]
    window.nextWordBox = nextWord.getBoundingClientRect().toJSON()
  })
  const at = await center(page, '[data-api-live] .gv-word')
  await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(620, 370, { steps: 8 }); await page.mouse.up()
  await page.waitForFunction(() => window.__gravityApi.flights()[0]?.presented && window.__gravityApi.flights()[0]?.asleep)
  const fallen = await page.evaluate(() => ({
    same: originalWord === window.__gravityApi.elements()[0] && originalWord.isConnected,
    removedFromFlow: getComputedStyle(originalSlot).display === 'none',
    paragraphRetained: originalParagraph === document.querySelector('.gv-poem') && originalParagraph.localName === 'p' && originalParagraph.contains(nextWord),
    neighborMoved: Math.hypot(nextWord.getBoundingClientRect().x - nextWordBox.x, nextWord.getBoundingClientRect().y - nextWordBox.y),
    body: window.__gravityApi.flights()[0],
  }))
  assert.ok(fallen.same && fallen.removedFromFlow)
  assert.ok(fallen.paragraphRetained)
  assert.ok(fallen.neighborMoved > 1)
  await page.mouse.click(fallen.body.x, fallen.body.y)
  await page.waitForFunction(() => window.__gravityApi.flights().length === 0 && !originalWord.closest('canvas'))
  assert.notEqual(await page.evaluate(() => getComputedStyle(originalSlot).display), 'none')
  const returned = await page.evaluate(() => ({
    same: originalWord === window.__gravityApi.elements()[0] && originalParagraph.contains(originalWord),
    neighborDrift: Math.hypot(nextWord.getBoundingClientRect().x - nextWordBox.x, nextWord.getBoundingClientRect().y - nextWordBox.y),
  }))
  assert.ok(returned.same)
  assert.ok(returned.neighborDrift <= 1, 'Returning the word must restore its paragraph flow')
  return { ...fallen, returned, input: 'browser mouse' }
})

sceneCase('explode', 'explode', async page => {
  await page.waitForFunction(() => window.__explode?.plates().length > 1)
  await page.evaluate(() => { window.originalSubject = window.__explode.subject(); window.__explode.setSpread(0) })
  await page.waitForFunction(() => {
    const depths = []
    window.__r3f.scene.traverse(object => {
      if (object.material?.map?.image?.querySelector?.('[data-munari-surface^="plate-"]')) depths.push(object.matrixWorld.elements[14])
    })
    return depths.length === window.__explode.plates().length && Math.max(...depths) - Math.min(...depths) < 1e-6
  })
  assert.ok(await page.evaluate(() => originalSubject === window.__explode.subject() && originalSubject.isConnected))
  const plates = await page.evaluate(() => window.__explode.plates().length)
  assert.equal(await page.$$eval('[data-munari-surface^="plate-"]', elements => elements.length), plates)
  await page.evaluate(() => window.__explode.setSpread(1))
  await page.waitForFunction(() => {
    const depths = []
    window.__r3f.scene.traverse(object => {
      if (object.material?.map?.image?.querySelector?.('[data-munari-surface^="plate-"]')) depths.push(object.matrixWorld.elements[14])
    })
    return Math.max(...depths) - Math.min(...depths) > 0.5
  })
  return { plates, nativeSubjectRetained: true, geometryCollapsedAndExpanded: true, input: 'scene API' }
})

sceneCase('selection', 'selection', async page => {
  await page.waitForFunction(() => window.__r3f?.scene && document.querySelector('.sel-prose p'))
  const box = await page.$eval('.sel-prose p', element => element.getBoundingClientRect().toJSON())
  await page.mouse.move(box.x + 5, box.y + 12); await page.mouse.down(); await page.mouse.move(box.x + 260, box.y + 82, { steps: 12 }); await page.mouse.up()
  await page.waitForFunction(() => getSelection().toString().length > 20)
  await page.waitForFunction(() => {
    let drawn = false
    window.__r3f.scene.traverse(object => { const u = object.material?.uniforms; if (u?.uRectCount?.value > 0 && u.uT.value > 0.9 && u.tMap.value) drawn = true })
    return drawn
  })
  return { selectedCharacters: await page.evaluate(() => getSelection().toString().length), captureFeedsGlass: true, input: 'browser mouse selection' }
})

for (const candidate of ['ripple', 'billow']) sceneCase(`candidate-${candidate}`, 'candidates', async page => {
  const before = candidate === 'ripple' ? await page.$eval('.cand-readout strong', element => Number(element.textContent)) : null
  if (candidate === 'ripple') await page.evaluate(() => {
    window.rippleInputTrace = []
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'focusin', 'focusout']) {
      document.addEventListener(type, event => {
        if (!(event.target instanceof Element)) return
        window.rippleInputTrace.push({ type, trusted: event.isTrusted, target: event.target.localName, primary: event.target.matches('.cand-btn--primary'), inCanvas: Boolean(event.target.closest('canvas')) })
      }, { capture: true })
    }
  })
  await page.click('[data-api-live] .cand-btn--primary')
  await meshes(page, true)
  await meshes(page, false)
  if (before !== null) assert.equal(await page.$eval('.cand-readout strong', element => Number(element.textContent)), before + 1, `The original click must activate once: ${JSON.stringify(await page.evaluate(() => window.rippleInputTrace))}`)
  return { drewScene: true, releasedScene: true, input: 'browser click' }
}, { candidate })

sceneCase('candidate-unroll', 'candidates', async page => {
  await page.click('button[aria-expanded]')
  await page.waitForFunction(() => {
    const sheets = []
    window.__r3f.scene.traverse(object => { if (object.isMesh && object.material?.uniforms?.uOpacity) sheets.push(object) })
    const mesh = sheets.length === 1 ? sheets[0] : null
    const position = mesh?.geometry.getAttribute('position')
    let flat = Boolean(position?.count && mesh.material.uniforms.tMap.value && mesh.material.uniforms.uOpacity.value > 0.99 && document.querySelector('.cand-menu__item'))
    if (flat) for (let index = 0; index < position.count; index++) if (Math.abs(position.getZ(index)) > 1e-4) flat = false
    // Opacity is already one during opening. Several flat frames exclude the initial, undeformed plane.
    window.unrollFlatFrames = flat ? (window.unrollFlatFrames ?? 0) + 1 : 0
    return window.unrollFlatFrames >= 3
  })
  const at = await page.evaluate(() => {
    const source = document.querySelector('[data-munari-surface="unroll-menu"]'), item = source.querySelector('.cand-menu__item')
    const sourceBox = source.getBoundingClientRect(), row = item.getBoundingClientRect(), meshes = []
    window.__r3f.scene.traverse(object => { if (object.isMesh && object.material?.uniforms?.uOpacity) meshes.push(object) })
    if (meshes.length !== 1) throw new Error('Expected one menu sheet to project its row through')
    const mesh = meshes[0]; mesh.geometry.computeBoundingBox()
    const bounds = mesh.geometry.boundingBox
    const point = mesh.position.clone().set(bounds.min.x + (bounds.max.x - bounds.min.x) * (row.x + row.width / 2 - sourceBox.x) / sourceBox.width, bounds.max.y - (bounds.max.y - bounds.min.y) * (row.y + row.height / 2 - sourceBox.y) / sourceBox.height, 0)
    mesh.localToWorld(point).project(window.__r3f.camera)
    const canvas = window.__r3f.gl.domElement.getBoundingClientRect()
    if (!(sourceBox.width > 0 && sourceBox.height > 0 && row.width > 0 && row.height > 0 && canvas.width > 0 && canvas.height > 0 && Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && Math.abs(point.z) < 1)) throw new Error('The menu row must project inside the rendered canvas')
    return { x: canvas.left + (point.x + 1) * canvas.width / 2, y: canvas.top + (1 - point.y) * canvas.height / 2, label: item.textContent, flatFrames: window.unrollFlatFrames }
  })
  await page.mouse.click(at.x, at.y)
  await page.waitForFunction(label => document.querySelector('.cand-card--menu p').textContent.includes(`Last action: ${label}`), {}, at.label)
  await meshes(page, false)
  return { selected: at.label, menuClosed: true, input: 'browser mouse at projected menu row' }
}, { candidate: 'unroll' })

for (const native of [false, true]) sceneCase(`${native ? 'native-' : 'candidate-'}dissolve`, 'candidates', async page => {
  await page.evaluate(() => { window.originalShapes = [...document.querySelectorAll('[data-api-live] .cand-shape')] })
  assert.ok(await page.evaluate(() => originalShapes.length > 0))
  for (const origin of [1, 2]) {
    await page.click(`.cand-slot:nth-child(${origin}) [data-api-live] .cand-slot__hit`)
    await page.waitForFunction(origin => {
      const arrived = document.querySelector(`.cand-slot:nth-child(${3 - origin}) [data-api-live] .cand-shape`)
      return Boolean(document.querySelector(`.cand-slot:nth-child(${origin}) .cand-slot__empty`) && arrived && !arrived.closest('canvas'))
    }, {}, origin)
    assert.ok(await page.evaluate(() => originalShapes.every((node, index) => node === [...document.querySelectorAll('[data-api-live] .cand-shape')][index])))
  }
  if (native) assert.equal(await page.$$eval('canvas', elements => elements.filter(element => element.layoutSubtree).length), 0)
  return { bothDirections: true, originalElementsRetained: true, input: 'browser clicks' }
}, { candidate: 'dissolve', native })

sceneCase('candidate-analyze', 'candidates', async page => {
  const blocks = await page.$$eval('.cand-block-holder', elements => elements.length)
  assert.ok(blocks > 0)
  await page.click('.cand-agent button')
  await page.waitForFunction(count => document.querySelectorAll('.cand-findings li:not(.cand-findings__live)').length === count, {}, blocks)
  await meshes(page, false)
  return { analyzedBlocks: blocks, releasedScene: true, input: 'browser click' }
}, { candidate: 'analyze' })

for (const native of [false, true]) sceneCase(`${native ? 'native-' : 'candidate-'}copy`, 'candidates', async page => {
  await page.click('.cand-code-bar button')
  await page.waitForFunction(() => document.querySelector('.cand-hint')?.textContent.includes('Copied 1'))
  await page.waitForFunction(() => document.querySelector('.cand-code-holder').dataset.gone !== 'true')
  if (native) assert.equal(await page.$$eval('canvas', elements => elements.filter(element => element.layoutSubtree).length), 0)
  return { oneCopyEffect: true, nativeBlockRestored: true, input: 'browser click', limit: 'Clipboard contents are not read.' }
}, { candidate: 'copy', native })

for (const variant of ['melt', 'shatter', 'peel']) sceneCase(`candidate-delete-${variant}`, 'candidates', async page => {
  const buttons = await page.$$('[aria-label="delete style"] button')
  for (const button of buttons) if (await button.evaluate(element => element.textContent.trim()) === variant) await button.click()
  assert.equal(await page.$eval('[aria-label="delete style"] [data-on]', element => element.textContent.trim()), variant)
  const count = await page.$$eval('.cand-row-holder', elements => elements.length)
  assert.ok(count > 0)
  await page.click('.cand-row-holder:first-child [data-api-live] .cand-row__x')
  await page.waitForFunction(count => document.querySelectorAll('.cand-row-holder').length === count - 1, {}, count)
  await meshes(page, false)
  await page.click('.cand-card--list > button')
  await page.waitForFunction(count => document.querySelectorAll('.cand-row-holder').length === count, {}, count)
  return { variant, removedAfterExit: true, restored: true, input: 'browser clicks' }
}, { candidate: 'delete' })

sceneCase('home-starter', 'home', async page => {
  await page.waitForSelector('.home-starter-demo > div > button')
  await page.click('.home-starter-demo > div > button')
  await page.waitForFunction(() => document.querySelector('.home-starter-demo').textContent.includes('Drawn by the scene'))
  await page.click('.home-starter-demo > div > button')
  await page.waitForFunction(() => document.querySelector('.home-starter-demo').textContent.includes('Drawn by the page'))
  return { independentStarterReturned: true, input: 'browser clicks' }
})

sceneCase('native-unroll', 'candidates', async page => {
  await page.click('button[aria-expanded]'); await page.click('.cand-menu__item:first-child')
  await page.waitForFunction(() => document.querySelector('.cand-card--menu p').textContent.includes('Last action: Duplicate'))
  assert.equal(await page.$$eval('canvas', elements => elements.filter(element => element.layoutSubtree).length), 0)
  return { nativeMenuAction: true, captureCanvases: 0 }
}, { candidate: 'unroll', native: true })
sceneCase('native-delete', 'candidates', async page => {
  const count = await page.$$eval('.cand-row-holder', elements => elements.length)
  assert.ok(count > 0)
  await page.click('.cand-row-holder:first-child [data-api-live] .cand-row__x')
  await page.waitForFunction(count => document.querySelectorAll('.cand-row-holder').length === count - 1, {}, count)
  assert.equal(await page.$$eval('canvas', elements => elements.filter(element => element.layoutSubtree).length), 0)
  return { rowRemoved: true, captureCanvases: 0 }
}, { candidate: 'delete', native: true })
sceneCase('native-selection', 'selection', async page => {
  await page.waitForFunction(() => window.__r3f?.scene && document.querySelector('.sel-prose p'))
  await page.evaluate(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('.sel-prose p')); getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event('selectionchange')) })
  assert.ok(await page.evaluate(() => getSelection().toString().length > 20))
  const visible = await page.evaluate(() => { let count = 0; window.__r3f.scene.traverse(object => { if (object.isMesh && object.visible) count++ }); return count })
  assert.equal(visible, 0)
  return { nativeSelection: true, visibleCaptureMeshes: visible, input: 'DOM Range; enhanced case owns real mouse selection' }
}, { native: true })
sceneCase('native-gravity', 'gravity', async page => {
  await page.waitForSelector('.gv-canvas'); await page.click('.gv-word:first-child')
  await page.waitForFunction(() => document.querySelector('.gv-word').style.display === 'none')
  return { nativeWordRemoved: true, existingRendererFallback: true, input: 'browser click' }
}, { native: true })

try { await runBrowserCases(cases, output) } finally { await server.close() }
