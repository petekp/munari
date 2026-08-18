// Shared-Canvas acceptance for the exclusive handoff.
//
// Three Surfaces composite in one Canvas on the Gold route: two exclusive
// handoffs and one translucent Twin. The gate drives every case the
// handoff has to survive and checks the protocol's own answers rather than
// pixels, because the faults it exists for — a receipt from a write-free
// pass, a page released before its mesh drew, a sibling taken off screen
// by someone else's warm-up — all show up as protocol order, and a
// screenshot diff would only say "it looks wrong".
//
// What it pins:
//
// - Forward and reverse: the page releases only after `ready`, and the
//   hold comes back at the end of the return.
// - Reversal: an ask that arrives mid-crossing never skips to the far side.
// - Sibling isolation: lifting one Surface leaves the other two presenting.
// - Source replacement: a new captured element voids readiness and earns it
//   again, with no window where the page is released over unproven pixels.
// - Context loss: the renderer comes back and both Surfaces present again.
// - Parts: a multi-part Surface transfers all of its parts or none, and
//   dropping one part leaves the rest presenting.
// - Anchors: a child parked on a named box lands on that box in the
//   geometry's own coordinates, and does not exist before the geometry has
//   drawn the paint the box was measured against.
// - Post-processing: a scene drawn into an off-screen target and composited
//   to the default framebuffer in the SAME frame still completes an
//   exclusive handoff, and does not release the page before its evidence.
// - Material writes: a warm-up borrows colour, depth and stencil writes and
//   gives back exactly what the caller authored, on the Surface's own
//   material and on the scene matter overlapping it.
// - Identity: two unnamed Surfaces in one Canvas keep their own content, and
//   two Canvases under one id fault instead of silently sharing.
// - The fallback: a lost renderer shows the supplied fallback, and a
//   recovered one takes it away without remounting the Canvas.
// - Teardown: unmounting every Surface leaves the host with no registrations.

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function skip(reason) {
  const message = `surface-canvas gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message)
  process.exit(strict ? 1 : 0)
}

if (!chromePath) skip('no Chrome executable found (set CHROME_PATH)')

let browser
let server
const deadline = setTimeout(() => {
  console.error('surface-canvas gate: hard 180s deadline hit')
  process.exit(1)
}, 180_000)

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
  const page = await browser.newPage()
  const errors = []
  // Munari's own faults are evidence here, not failures: the duplicate-id
  // case below asks for one on purpose. They are kept apart from the page
  // errors that would mean something broke.
  const faults = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() !== 'error' || message.text().startsWith('Failed to load resource:')) return
    if (message.text().startsWith('[munari]')) {
      faults.push(message.text())
      return
    }
    errors.push(message.text())
  })

  const state = () =>
    page.evaluate(() => {
      const element = document.querySelector('[data-gold-state]')
      const meshes = []
      window.__r3f?.scene?.traverse((object) => {
        if (!object.isMesh) return
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) {
          if (material?.map?.image instanceof HTMLCanvasElement) {
            meshes.push({ visible: object.visible, colorWrite: material.colorWrite !== false })
          }
        }
      })
      const held = (name) =>
        document.querySelector(
          `[data-munari-source-host][data-munari-surface="${name}"]`,
        ) !== null
      return {
        gold: element?.getAttribute('data-gold-presented') ?? null,
        silver: element?.getAttribute('data-silver-presented') ?? null,
        plate: element?.getAttribute('data-plate-presented') ?? null,
        // The anchored child, in the local coordinates of the geometry its
        // box was collected from. Absent while the set is incomplete.
        stud: (() => {
          let found = null
          window.__r3f?.scene?.traverse((object) => {
            if (object.name !== 'plate-stud' || !object.parent) return
            const { x, y, z } = object.parent.position
            found = { x, y, z }
          })
          return found
        })(),
        parts: [...document.querySelectorAll('[data-munari-source-host][data-munari-surface="plate"]')]
          .map((element) => element.getAttribute('data-munari-part'))
          .sort(),
        // A released page copy keeps its layout box and loses visibility.
        goldPageVisible:
          document.querySelector('[data-gold-button]:not([aria-hidden="true"])') !== null &&
          getComputedStyle(
            document.querySelector('[data-gold-button]:not([aria-hidden="true"])').parentElement,
          ).visibility !== 'hidden',
        sources: {
          gold: held('gold-button'),
          silver: held('silver-card'),
          bronze: held('bronze-twin'),
        },
        meshes: meshes.length,
        // The authored write flags, read between frames. A warm-up turns all
        // three off for the duration of its own draw; anything still off
        // here was written for good.
        writes: (() => {
          const read = (material) =>
            material
              ? {
                  colorWrite: material.colorWrite,
                  depthWrite: material.depthWrite,
                  stencilWrite: material.stencilWrite,
                  stencilRef: material.stencilRef,
                }
              : null
          let silverMaterial = null
          let goldMaterial = null
          let occluderMaterial = null
          window.__r3f?.scene?.traverse((object) => {
            if (object.name === 'gold-default-material') goldMaterial = object.material
            if (object.name === 'gold-occluder') occluderMaterial = object.material
            if (
              object.isMesh &&
              object.material?.isMeshBasicMaterial &&
              object.material.stencilRef === 7
            ) {
              silverMaterial = object.material
            }
          })
          return {
            gold: read(goldMaterial),
            silver: read(silverMaterial),
            occluder: read(occluderMaterial),
          }
        })(),
        unnamed: [...document.querySelectorAll('[data-gold-unnamed]')]
          .map((element) => element.getAttribute('data-gold-unnamed'))
          .sort(),
        fallback: document.querySelector('[data-gold-fallback]') !== null,
        log: (window.__gold?.log ?? []).map((entry) => `${entry.surface}:${entry.event}`),
      }
    })

  // Dispatched on the element, not at its coordinates: the shared Canvas is
  // `position: fixed; inset: 0`, so a coordinate click lands on the canvas
  // and the pointer gate correctly refuses it everywhere no Surface stands.
  const click = async (selector) => {
    await page.$eval(selector, (element) => element.click())
    await sleep(40)
  }

  await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:${port}/?scene=gold&bare`, { waitUntil: 'load' })
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-munari-source-host]').length >= 3 &&
      Boolean(window.__r3f?.scene),
    { timeout: 20_000 },
  )
  await sleep(800)

  const rest = await state()
  if (rest.gold !== 'dom' || rest.silver !== 'dom') {
    errors.push(`at rest both exclusive Surfaces should hold on the page: ${JSON.stringify(rest)}`)
  }
  if (rest.meshes < 3) errors.push(`expected three Surface meshes in one Canvas, saw ${rest.meshes}`)
  if (!rest.sources.gold || !rest.sources.silver || !rest.sources.bronze) {
    errors.push(`a Surface never mounted its source: ${JSON.stringify(rest.sources)}`)
  }

  // ── forward, with the sibling untouched ────────────────────────────────
  await click('[data-gold-lift]')
  await page.waitForFunction(
    () => document.querySelector('[data-gold-state]')?.getAttribute('data-gold-presented') === 'webgl',
    { timeout: 10_000 },
  )
  const lifted = await state()
  if (lifted.silver !== 'dom') {
    errors.push(`lifting gold moved silver: ${lifted.silver}`)
  }
  if (lifted.goldPageVisible) errors.push('gold released the hold without hiding its page copy')
  if (!lifted.sources.bronze) errors.push('the Twin companion lost its source during a sibling handoff')
  // Evidence before release: `ready` is every presenter's proven draw, and
  // it must be in the log before the page hands anything over.
  const goldEvents = lifted.log.filter((entry) => entry.startsWith('gold:'))
  const readyAt = goldEvents.indexOf('gold:ready')
  const releaseAt = goldEvents.indexOf('gold:presented:webgl')
  if (readyAt < 0 || releaseAt < 0 || readyAt > releaseAt) {
    errors.push(`gold released without evidence first: ${goldEvents.join(' ')}`)
  }

  // ── the second exclusive Surface, independent of the first ─────────────
  await click('[data-silver-lift]')
  await page.waitForFunction(
    () =>
      document.querySelector('[data-gold-state]')?.getAttribute('data-silver-presented') === 'webgl',
    { timeout: 10_000 },
  )
  const both = await state()
  if (both.gold !== 'webgl') errors.push(`silver's handoff disturbed gold: ${both.gold}`)
  if (!both.sources.bronze) errors.push('the Twin companion lost its source during the second handoff')

  // ── reversal: an ask arriving mid-crossing ─────────────────────────────
  await click('[data-gold-lift]') // start the return
  await sleep(60) // mid-ramp, before it lands
  await click('[data-gold-lift]') // and ask for WebGL again
  await sleep(1_200)
  const reversed = await state()
  if (reversed.gold !== 'webgl') {
    errors.push(`a reversal did not climb back to WebGL: ${reversed.gold}`)
  }
  // Reversal must not skip a phase: the page never took the hold back.
  const afterBoth = reversed.log.slice(both.log.length).filter((entry) => entry === 'gold:presented:dom')
  if (afterBoth.length > 0) errors.push('a mid-crossing reversal handed the page back on the way')

  // ── source replacement while the mesh is presenting ────────────────────
  await click('[data-gold-adopt]')
  await sleep(900)
  const beforeReplace = await state()
  await click('[data-gold-replace]')
  await sleep(1_200)
  const replaced = await state()
  const replaceEvents = replaced.log.slice(beforeReplace.log.length)
  if (!replaceEvents.includes('gold:ready')) {
    errors.push(`a replaced source never proved its new pixels: ${replaceEvents.join(' ')}`)
  }
  if (replaced.gold !== 'webgl') {
    errors.push(`a source replacement dropped the hold: ${replaced.gold}`)
  }
  if (replaced.silver !== 'webgl') {
    errors.push(`a source replacement disturbed the sibling: ${replaced.silver}`)
  }

  // Back to the React source before the landing check: an adopted source
  // has no page copy at all, so `goldPageVisible` would read false for a
  // reason that has nothing to do with the hold coming home.
  await click('[data-gold-adopt]')
  await sleep(1_200)

  // ── return, both directions land ───────────────────────────────────────
  await click('[data-gold-lift]')
  await click('[data-silver-lift]')
  await page.waitForFunction(
    () => {
      const element = document.querySelector('[data-gold-state]')
      return (
        element?.getAttribute('data-gold-presented') === 'dom' &&
        element.getAttribute('data-silver-presented') === 'dom'
      )
    },
    { timeout: 10_000 },
  )
  const landed = await state()
  if (landed.goldPageVisible === false) errors.push('gold landed without taking its page copy back')

  // ── the authored material writes come back ─────────────────────────────
  // Read after a full lift-and-land, which is at least one write-free
  // warm-up followed by presenting passes. The fault this pins, 2026-08-17:
  // the warm-up wrote `false` onto the material and read the next pass's
  // value back out of it, so depth and stencil never returned — on the
  // SHARED material, for every mesh using it.
  const restored = await state()
  const AUTHORED_GOLD = { colorWrite: true, depthWrite: true, stencilWrite: false, stencilRef: 0 }
  const AUTHORED_SILVER = { colorWrite: true, depthWrite: true, stencilWrite: true, stencilRef: 7 }
  const AUTHORED_OCCLUDER = { colorWrite: true, depthWrite: true, stencilWrite: true, stencilRef: 5 }
  if (JSON.stringify(restored.writes.gold) !== JSON.stringify(AUTHORED_GOLD)) {
    errors.push(
      `a handoff left the default Surface material written: ${JSON.stringify(restored.writes.gold)}`,
    )
  }
  if (JSON.stringify(restored.writes.silver) !== JSON.stringify(AUTHORED_SILVER)) {
    errors.push(
      `a handoff left the Surface material written: ${JSON.stringify(restored.writes.silver)}`,
    )
  }
  if (JSON.stringify(restored.writes.occluder) !== JSON.stringify(AUTHORED_OCCLUDER)) {
    errors.push(
      `a handoff reached scene matter overlapping it: ${JSON.stringify(restored.writes.occluder)}`,
    )
  }

  // ── post-processing: off screen first, composited second ───────────────
  await click('[data-gold-post]')
  await sleep(400)
  const postBefore = await state()
  await click('[data-silver-lift]')
  try {
    await page.waitForFunction(
      () =>
        document.querySelector('[data-gold-state]')?.getAttribute('data-silver-presented') ===
        'webgl',
      { timeout: 10_000 },
    )
  } catch {
    errors.push('an exclusive handoff never completed through a post-processing pipeline')
  }
  const postLifted = await state()
  const postEvents = postLifted.log
    .slice(postBefore.log.length)
    .filter((entry) => entry.startsWith('silver:'))
  if (!postEvents.includes('silver:presented:webgl')) {
    errors.push(`a post-processed handoff never released the page: ${postEvents.join(' ')}`)
  }
  // Evidence before release, counted rather than positioned: readiness is
  // earned once per crossing and a lift can inherit the one earned while
  // the page still held, so the invariant is that the page has never been
  // released more times than evidence has been produced.
  const releasedBeforeEvidence = (name) => {
    let evidence = 0
    let released = 0
    for (const entry of postLifted.log) {
      if (entry === `${name}:ready`) evidence += 1
      if (entry === `${name}:presented:webgl`) released += 1
      if (released > evidence) return true
    }
    return false
  }
  if (releasedBeforeEvidence('silver')) {
    errors.push(`silver released the page before its evidence: ${postLifted.log.join(' ')}`)
  }
  if (releasedBeforeEvidence('gold')) {
    errors.push(`gold released the page before its evidence: ${postLifted.log.join(' ')}`)
  }
  if (JSON.stringify(postLifted.writes.silver) !== JSON.stringify(AUTHORED_SILVER)) {
    errors.push(
      `a post-processed pass left the material written: ${JSON.stringify(postLifted.writes.silver)}`,
    )
  }
  await click('[data-silver-lift]')
  await page.waitForFunction(
    () =>
      document.querySelector('[data-gold-state]')?.getAttribute('data-silver-presented') === 'dom',
    { timeout: 10_000 },
  )
  await click('[data-gold-post]')
  await sleep(400)

  // ── two Surfaces with no name, and two Canvases with one ───────────────
  const faultsBeforeUnnamed = faults.length
  await click('[data-gold-unnamed-toggle]')
  await sleep(600)
  const unnamedUp = await state()
  if (unnamedUp.unnamed.join(',') !== 'a,b') {
    errors.push(`two unnamed Surfaces did not both keep their content: ${JSON.stringify(unnamedUp.unnamed)}`)
  }
  if (faults.length !== faultsBeforeUnnamed) {
    errors.push(`two unnamed Surfaces reported a fault: ${faults.slice(faultsBeforeUnnamed).join(' | ')}`)
  }
  // A re-render must replace each entry rather than delete its neighbour.
  await click('[data-gold-lift]')
  await sleep(700)
  const unnamedAfterRender = await state()
  if (unnamedAfterRender.unnamed.join(',') !== 'a,b') {
    errors.push(`a commit took one unnamed Surface's content away: ${JSON.stringify(unnamedAfterRender.unnamed)}`)
  }
  await click('[data-gold-lift]')
  await sleep(700)
  await click('[data-gold-unnamed-toggle]')
  await sleep(400)
  const unnamedGone = await state()
  if (unnamedGone.unnamed.length !== 0) {
    errors.push(`unmounting the unnamed pair left ${JSON.stringify(unnamedGone.unnamed)} behind`)
  }

  const faultsBeforeDuplicate = faults.length
  await click('[data-gold-duplicate-canvas]')
  await sleep(800)
  const duplicateFaults = faults.slice(faultsBeforeDuplicate)
  if (!duplicateFaults.some((fault) => fault.includes('id="gold"'))) {
    errors.push(`two Canvases under one id reported no fault: ${duplicateFaults.join(' | ')}`)
  }
  if (!await page.$('[data-gold-duplicate-source]')) {
    errors.push('the duplicate Canvas lost its own source registry/runtime')
  }
  // Neither host lost its runtime: the original Canvas still performs a
  // whole handoff while the impostor is mounted.
  await click('[data-gold-lift]')
  try {
    await page.waitForFunction(
      () =>
        document.querySelector('[data-gold-state]')?.getAttribute('data-gold-presented') === 'webgl',
      { timeout: 10_000 },
    )
  } catch {
    errors.push('a duplicate Canvas id took the live Canvas down with it')
  }
  await click('[data-gold-lift]')
  await page.waitForFunction(
    () =>
      document.querySelector('[data-gold-state]')?.getAttribute('data-gold-presented') === 'dom',
    { timeout: 10_000 },
  )
  await click('[data-gold-duplicate-canvas]')
  await sleep(600)
  if (await page.$('[data-gold-duplicate-source]')) {
    errors.push('unmounting the duplicate Canvas left its source registration behind')
  }
  // And the survivor is still the one the Surfaces are talking to.
  await click('[data-gold-lift]')
  try {
    await page.waitForFunction(
      () =>
        document.querySelector('[data-gold-state]')?.getAttribute('data-gold-presented') === 'webgl',
      { timeout: 10_000 },
    )
  } catch {
    errors.push('unmounting the duplicate Canvas cleared the surviving one\'s renderer')
  }
  await click('[data-gold-lift]')
  await sleep(900)

  // ── context loss, and the fallback that stands in for the scene ────────
  const lost = await page.evaluate(() => {
    const canvas = window.__r3f?.gl?.domElement
    const context = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl')
    const extension = context?.getExtension('WEBGL_lose_context')
    if (!extension) return false
    extension.loseContext()
    window.__goldLoseContext = extension
    return true
  })
  if (lost) {
    try {
      await page.waitForFunction(() => document.querySelector('[data-gold-fallback]') !== null, {
        timeout: 5_000,
      })
    } catch {
      errors.push('a lost renderer never showed the supplied fallback')
    }
    await page.evaluate(() => window.__goldLoseContext?.restoreContext())
    try {
      await page.waitForFunction(() => document.querySelector('[data-gold-fallback]') === null, {
        timeout: 5_000,
      })
    } catch {
      errors.push('the fallback stayed up after the renderer came back')
    }
    await sleep(800)
    await click('[data-gold-lift]')
    await sleep(1_500)
    const recovered = await state()
    if (recovered.gold !== 'webgl') {
      errors.push(`the Canvas did not recover from context loss: ${recovered.gold}`)
    }
    if (recovered.fallback) errors.push('the fallback returned over a working renderer')
    await click('[data-gold-lift]')
    await sleep(1_200)
  }

  // ── a multi-part Surface transfers all of its parts or none ───────────
  const platePartsAtRest = await state()
  if (platePartsAtRest.plate !== 'dom') {
    errors.push(`the multi-part Surface did not start on the page: ${platePartsAtRest.plate}`)
  }
  if (platePartsAtRest.parts.join(',') !== 'body,head') {
    errors.push(`expected two named parts, saw ${JSON.stringify(platePartsAtRest.parts)}`)
  }
  if (platePartsAtRest.stud !== null) {
    errors.push('an anchored child existed before its geometry had drawn anything')
  }

  const beforePlate = platePartsAtRest.log.length
  await click('[data-plate-lift]')
  await page.waitForFunction(
    () => document.querySelector('[data-gold-state]')?.getAttribute('data-plate-presented') === 'webgl',
    { timeout: 10_000 },
  )
  await sleep(400)
  const plateUp = await state()
  const plateEvents = plateUp.log.slice(beforePlate).filter((entry) => entry.startsWith('plate:'))
  // Every part's presenter into one ledger: `ready` is all of them, and it
  // has to be in the log before the page lets go of any of them.
  if (plateEvents.indexOf('plate:ready') > plateEvents.indexOf('plate:presented:webgl')) {
    errors.push(`a part transferred before every part was ready: ${plateEvents.join(' ')}`)
  }
  // The anchor transaction: the stud stands on the box named in the second
  // part's source, in that geometry's own coordinates. The dot sits 24px
  // from the left and 22px from the top of a 176×64 box, so its centre is
  // u = 34/176 and v = 1 - 32/64.
  if (!plateUp.stud) {
    errors.push('the anchored child never appeared once its geometry was drawn')
  } else {
    if (Math.abs(plateUp.stud.x - (34 / 176 - 0.5)) > 0.02) {
      errors.push(`the anchor landed at x ${plateUp.stud.x}, not on its named box`)
    }
    if (Math.abs(plateUp.stud.y - (1 - 32 / 64 - 0.5)) > 0.02) {
      errors.push(`the anchor landed at y ${plateUp.stud.y}, not on its named box`)
    }
  }

  // Removing a part is a change to the expected set, not a fault: the rest
  // of the Surface keeps presenting.
  await click('[data-plate-head-toggle]')
  await sleep(600)
  const withoutHead = await state()
  if (withoutHead.parts.join(',') !== 'body') {
    errors.push(`dropping a part left ${JSON.stringify(withoutHead.parts)}`)
  }
  if (withoutHead.plate !== 'webgl') {
    errors.push(`dropping a part dropped the whole handoff: ${withoutHead.plate}`)
  }
  await click('[data-plate-head-toggle]')
  await sleep(800)
  await click('[data-plate-lift]')
  await page.waitForFunction(
    () => document.querySelector('[data-gold-state]')?.getAttribute('data-plate-presented') === 'dom',
    { timeout: 10_000 },
  )

  // ── teardown leaves nothing registered ─────────────────────────────────
  await click('[data-gold-companion]')
  await sleep(400)
  const withoutTwin = await state()
  if (withoutTwin.sources.bronze) errors.push('an unmounted Twin left its source host behind')
  if (withoutTwin.gold !== 'dom' || withoutTwin.silver !== 'dom') {
    errors.push(`unmounting a sibling disturbed the others: ${JSON.stringify(withoutTwin)}`)
  }

  await page.goto(`http://localhost:${port}/?scene=logo&bare`, { waitUntil: 'load' })
  await sleep(600)
  const leftBehind = await page.evaluate(
    () => document.querySelectorAll('[data-munari-surface="gold-button"]').length,
  )
  if (leftBehind !== 0) errors.push(`leaving the route left ${leftBehind} source hosts behind`)

  if (errors.length) {
    console.error(`surface-canvas gate FAILED (${errors.length})`)
    for (const error of errors) console.error(`  - ${error}`)
    process.exitCode = 1
  } else {
    console.log(
      'surface-canvas gate PASSED: two exclusive handoffs and a Twin share one Canvas ' +
        'through forward, reverse, reversal, replacement, post-processing, unnamed and ' +
        'duplicate identities, context loss with a fallback, and teardown',
    )
  }
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
