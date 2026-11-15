// Real lab routes with capture and screen output faults injected by Vite.
// Run with node instruments/surface-frames/run.mjs.
import assert from 'node:assert/strict'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

const lab = path.resolve(import.meta.dirname, '../../apps/lab')
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

function once(source, from, to) {
  assert.equal(source.split(from).length, 2, `Unexpected fixture marker ${from}`)
  return source.replace(from, to)
}

const probe = {
  name: 'lab-surface-frame-proof',
  enforce: 'pre',
  transform(code, id) {
    if (id.endsWith('/paint/rasterizedSource.ts')) {
      code = once(code, '      const image = await rasterize(element, scaleX, scaleY)', `
      const check = globalThis.frameProbe?.gallery
      const card = element.querySelector('.gallery-card')
      const item = card?.getAttribute('data-item')
      const edit = card?.getAttribute('data-gallery-edit')
      if (check && edit && edit !== '0') {
        check.pendingEdit = edit
        await check.fresh
      }
      const image = await rasterize(element, scaleX, scaleY)
      if (check && check.pauseOld && item === 'genie' && edit === '0') {
        check.oldPending = true
        await check.old
      }`)
      return once(code, '      body.completePaint(box, changesDuringPaint, read)', `
      body.completePaint(box, changesDuringPaint, read)
      if (check) {
        check.captures.push({ item, edit, read })
        if (item === 'genie' && edit === '0' && check.oldPending) check.oldPublished = true
      }`)
    }
    if (id.endsWith('/lib/surfaceFrames.ts')) {
      return once(code, 'frame.paint.read >= minimumRead', '(frame.paint.read >= minimumRead || (globalThis.frameProbe?.acceptStale && globalThis.frameProbe.gallery.oldPublished))')
    }
    if (id.endsWith('/scenes/glass/glassSdf.tsx')) {
      return once(code, '    if (frameOutput) frameOutput.draw(blitMesh, drawFinal, sampledFrames)\n    else drawFinal()', `
      const check = globalThis.frameProbe?.glass
      const fault = check?.fault
      blitMesh.visible = fault !== 'skip' && fault !== 'early'
      blit.material.colorWrite = fault !== 'colorless'
      if (fault === 'early') {
        for (const { presenter } of sampledFrames) {
          presenter.prove()
          presenter.present()
        }
      }
      frameOutput.draw(blitMesh, drawFinal, sampledFrames)
      if (check) {
        check.samples = sampledFrames.length
        check.heard = sampledFrames.filter(({ presenter }) => presenter.hearsPointer()).length
        check.drawFrames++
      }`)
    }
  },
}

const server = await createServer({ root: lab, plugins: [probe], server: { host: '127.0.0.1', port: 0 } })
try {
  await server.listen()
  const base = server.resolvedUrls.local[0]
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: [...WEBGPU_CHROME_ARGS, '--enable-features=CanvasDrawElement'],
  })
  try {
    await gallery(browser, base)
    await gallery(browser, base, true)
    await galleryNative(browser, base)
    await glass(browser, base, false, false)
    await glass(browser, base, true, false)
    await glass(browser, base, false, true)
  } finally {
    await browser.close()
  }
} finally {
  await server.close()
}

async function pageFor(browser, config) {
  const page = await browser.newPage()
  const errors = []
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(String(error)))
  await page.setViewport({ width: 1024, height: 700 })
  await page.evaluateOnNewDocument(({ scene, fault }) => {
    if (scene === 'glass') {
      window.frameProbe = { glass: { fault, samples: 0, heard: 0, drawFrames: 0 } }
      return
    }
    const state = { captures: [], pauseOld: false, oldPublished: false, oldPending: false, pendingEdit: null }
    state.old = new Promise(resolve => { state.releaseOld = resolve })
    state.fresh = new Promise(resolve => { state.releaseFresh = resolve })
    window.frameProbe = { gallery: state, acceptStale: fault }
  }, config)
  return { page, errors }
}

async function gallery(browser, base, fault = false) {
  const { page, errors } = await pageFor(browser, { scene: 'gallery', fault })
  try {
    const url = new URL('?scene=gallery&framed&bare&capture=snapdom', base)
    await page.goto(url.href, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__munari?.engine)
    assert.equal(await page.evaluate(() => window.__munari.engine()), 'snapdom')
    await page.waitForFunction(() => window.frameProbe.gallery.captures.some(c => c.item === 'genie'))
    await page.evaluate(() => { window.frameProbe.gallery.pauseOld = true })
    await page.waitForFunction(() => window.frameProbe.gallery.oldPending)
    await page.click('.gallery-pick[aria-label="Knobs"]')
    await page.waitForSelector('.gallery-card[data-gallery-edit="1"][data-item="knobs"]')
    await page.click('.gallery-pick[aria-label="Selection"]')
    await page.waitForSelector('.gallery-card[data-gallery-edit="2"][data-item="selection"]')
    await page.evaluate(() => window.frameProbe.gallery.releaseOld())
    await page.waitForFunction(() => window.frameProbe.gallery.oldPublished && window.frameProbe.gallery.pendingEdit === '2')
    if (fault) {
      await page.waitForFunction(() => {
        const position = document.querySelector('.gallery-scrub').valueAsNumber
        return position > 0 && position < 1
      })
      assert.deepEqual(errors, [])
      console.log('Gallery negative control detected a crossing on the stale read')
      return
    }
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.$eval('.gallery-scrub', scrub => scrub.valueAsNumber), 0)
    assert.equal(await page.$eval('.gallery-pick[aria-current="true"]', pick => pick.getAttribute('aria-label')), 'Flight')

    await page.evaluate(() => window.frameProbe.gallery.releaseFresh())
    await page.waitForFunction(() => {
      const { valueAsNumber } = document.querySelector('.gallery-scrub')
      return valueAsNumber > 0 && valueAsNumber < 1
    })
    const paint = await page.evaluate(() => window.frameProbe.gallery.captures.find(c => c.edit === '2'))
    assert.equal(paint.item, 'selection')
    await page.waitForSelector('.gallery-pick[aria-label="Selection"][aria-current="true"]')
    assert.deepEqual(errors, [])
    console.log('Gallery waited for the matching edit after an earlier read completed')
  } finally {
    await page.close()
  }
}

async function galleryNative(browser, base) {
  const { page, errors } = await pageFor(browser, { scene: 'gallery' })
  try {
    await page.goto(new URL('?scene=gallery&framed&bare', base).href, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__munari?.engine && window.__r3f)
    assert.equal(await page.evaluate(() => window.__munari.engine()), 'html-in-canvas')
    await page.click('.gallery-pick[aria-label="Knobs"]')
    await page.waitForFunction(() => {
      const position = document.querySelector('.gallery-scrub').valueAsNumber
      return position > 0 && position < 1
    })
    await page.waitForSelector('.gallery-pick[aria-label="Knobs"][aria-current="true"]')
    assert.deepEqual(errors, [])
    console.log('Gallery completed a requested crossing with HTML-in-canvas')
  } finally {
    await page.close()
  }
}

async function glass(browser, base, early, snapdom) {
  const { page, errors } = await pageFor(browser, { scene: 'glass', fault: early ? 'early' : 'skip' })
  try {
    const url = new URL('?scene=glass&framed&bare', base)
    if (snapdom) url.searchParams.set('capture', 'snapdom')
    await page.goto(url.href, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__munari?.engine)
    const engine = snapdom ? 'snapdom' : 'html-in-canvas'
    assert.equal(await page.evaluate(() => window.__munari.engine()), engine)
    await page.waitForFunction(() => window.frameProbe.glass.samples === 2)
    const blocked = await page.evaluate(() => window.frameProbe.glass)
    if (early) {
      assert.equal(blocked.heard, 2)
      console.log('Glass negative control detected presentation from a skipped final draw')
      return
    }
    assert.equal(blocked.heard, 0)
    await page.evaluate(() => { window.frameProbe.glass.fault = 'colorless' })
    await page.waitForFunction(frames => window.frameProbe.glass.drawFrames > frames + 2, {}, blocked.drawFrames)
    const colorless = await page.evaluate(() => window.frameProbe.glass)
    assert.equal(colorless.heard, 0)
    await page.evaluate(() => { window.frameProbe.glass.fault = null })
    await page.waitForFunction(() => window.frameProbe.glass.heard === 2)
    assert.deepEqual(errors, [])
    console.log(`Glass claimed presentation after the final color draw with ${engine}`)
  } finally {
    await page.close()
  }
}
