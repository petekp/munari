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
    if (id.endsWith('/surface/SurfaceCanvas.tsx')) {
      return once(code, '    await renderer.init()', `
        await renderer.init()
        const probe = globalThis.gpuProbe
        if (probe) {
          const update = renderer.backend.updateTexture.bind(renderer.backend)
          renderer.backend.updateTexture = (texture, options) => {
            const source = probe.sources.get(texture)
            if (!probe.held(source)) return update(texture, options)
            probe.blocked++
            const edited = source.element.querySelector('.gallery-card[data-gallery-edit="1"]')
            if (edited && source.currentPaint()?.read >= probe.minimumRead) probe.freshPaint = true
            if (!probe.primed.has(texture)) {
              probe.primed.add(texture)
              const old = new OffscreenCanvas(source.canvas.width, source.canvas.height)
              return update(texture, { ...options, image: old })
            }
          }
        }`)
    }
    if (id.endsWith('/surface/surfaceSourceRuntime.ts')) {
      return once(code, '  texture.onUpdate = () => {', `
      const probe = globalThis.gpuProbe
      if (probe) {
        probe.sources.set(texture, source)
        let onUpdate = texture.onUpdate
        Object.defineProperty(texture, 'onUpdate', {
          get: () => probe.held(source) ? null : onUpdate,
          set: callback => { onUpdate = callback },
        })
      }
      texture.onUpdate = () => {`)
    }
    if (id.endsWith('/scenes/gallery/galleryCrossing.ts')) {
      return once(code, '      setP(from + (to - from) * springEase(q, tune.crossingSpring))', `
      if (globalThis.gpuProbe && !globalThis.gpuProbe.finish && q >= 1) {
        setP(from + (to - from) * 0.98)
        globalThis.gpuProbe.pausedCrossing = true
        raf = requestAnimationFrame(step)
        return
      }
      setP(from + (to - from) * springEase(q, tune.crossingSpring))`)
    }
    if (id.endsWith('/scenes/gallery/Gallery.tsx')) {
      return once(code, '      <div className="gallery-figure">', `
      <div className="gallery-figure">
        {globalThis.gpuProbe && revision === 1 && <div style={{position:'absolute', inset:0, background:'#ff00ff', zIndex:1}} />}`)
    }
    if (id.endsWith('/scenes/glass/Glass.tsx')) {
      return once(code, "'linear-gradient(180deg, rgba(6,8,12,0.62) 0%, rgba(6,8,12,0.44) 55%, rgba(6,8,12,0.30) 100%)'", "globalThis.gpuProbe ? '#ff00ff' : 'linear-gradient(180deg, rgba(6,8,12,0.62) 0%, rgba(6,8,12,0.44) 55%, rgba(6,8,12,0.30) 100%)'")
    }
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
      if (process.env.STALE_GPU_CONTROL === '1') {
        code = once(code, '  return uploaded', '  return true')
      }
      code = once(code, '        minimumRead = source.nextRead()', '        minimumRead = source.nextRead(); if (globalThis.gpuProbe) globalThis.gpuProbe.minimumRead = minimumRead')
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
        check.heard = panels.filter(({ presenter }) => presenter.hearsPointer()).length
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
    if (process.env.STALE_GPU === '1') {
      const scene = process.env.STALE_GPU_SCENE
      if (!scene || scene === 'gallery') await staleGpu(browser, base, 'gallery')
      if (!scene || scene === 'glass') await staleGpu(browser, base, 'glass')
    } else {
    await gallery(browser, base)
    await gallery(browser, base, true)
    await galleryNative(browser, base)
    await glass(browser, base, false, false)
    await glass(browser, base, true, false)
    await glass(browser, base, false, true)
    }
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

async function magentaPixels(page) {
  const png = Buffer.from(await page.screenshot()).toString('base64')
  return page.evaluate(async encoded => {
    const image = await createImageBitmap(await (await fetch('data:image/png;base64,' + encoded)).blob())
    const canvas = new OffscreenCanvas(image.width, image.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    const { data } = ctx.getImageData(0, 0, image.width, image.height)
    let count = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 140 && data[i + 1] < 90 && data[i + 2] > 125) count++
    }
    return count
  }, png)
}

async function staleGpu(browser, base, scene) {
  const { page, errors } = await pageFor(browser, { scene, fault: null })
  try {
    await page.evaluateOnNewDocument(() => {
      const probe = window.gpuProbe = {
        blocked: 0, release: false, minimumRead: Infinity, freshPaint: false,
        sources: new WeakMap(), primed: new WeakSet(),
      }
      probe.held = source => !!source && !probe.release && !!source.element.querySelector(
        '.gallery-card[data-gallery-edit="1"], [data-glass-root]',
      )
    })
    await page.goto(new URL(`?scene=${scene}&framed&bare&capture=snapdom`, base).href, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__munari?.engine)
    assert.equal(await page.evaluate(() => window.__munari.engine()), 'snapdom')
    if (scene === 'gallery') {
      await page.waitForFunction(() => window.frameProbe.gallery.captures.some(c => c.item === 'genie'))
      await page.evaluate(() => window.frameProbe.gallery.releaseFresh())
      await page.click('.gallery-pick[aria-label="Knobs"]')
      await page.waitForFunction(() => window.gpuProbe.freshPaint)
      assert.equal(await page.$eval('.gallery-scrub', input => input.valueAsNumber), 0)
    } else {
      await page.waitForFunction(() => window.gpuProbe.blocked > 0 && window.frameProbe.glass.drawFrames > 3)
      assert.equal(await page.evaluate(() => window.frameProbe.glass.heard), 0)
    }
    const before = await magentaPixels(page)
    if (scene === 'gallery') {
      assert.equal(await page.$eval('.gallery-scrub', input => input.valueAsNumber), 0)
    } else {
      assert.equal(await page.evaluate(() => window.frameProbe.glass.heard), 0)
    }
    await page.evaluate(() => { window.gpuProbe.release = true })
    if (scene === 'gallery') {
      await page.waitForFunction(() => {
        const p = document.querySelector('.gallery-scrub').valueAsNumber
        return window.gpuProbe.pausedCrossing && p === 0.98
      })
      assert(await magentaPixels(page) > before + 100, 'Gallery must draw the new texture during the crossing')
      assert.equal(await page.$eval('.gallery-scrub', input => input.valueAsNumber), 0.98)
      await page.evaluate(() => { window.gpuProbe.finish = true })
      await page.waitForSelector('.gallery-pick[aria-label="Knobs"][aria-current="true"]')
    } else {
      await page.waitForFunction(() => window.frameProbe.glass.heard === 2)
      assert(await magentaPixels(page) > before + 100, 'Glass must draw the new texture onto the screen')
    }
    assert.deepEqual(errors, [])
    console.log(`${scene}: stale upload held the handoff and fresh pixels completed it`)
  } finally {
    await page.close()
  }
}
