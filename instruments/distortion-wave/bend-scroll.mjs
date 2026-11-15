import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { compareWaveImages } from './images.mjs'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

const settle = page => page.evaluate(() => new Promise(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(resolve)),
))

async function prepare(browser, mode) {
  const page = await browser.newPage()
  await page.setViewport({ width: 895, height: 590, deviceScaleFactor: 2 })
  page.setDefaultTimeout(5000)
  const url = new URL(process.env.WAVE_URL ?? 'http://127.0.0.1:5188/')
  url.search = new URLSearchParams({ scene: 'distortion-wave', framed: '' })
  if (mode === 'snapdom') url.searchParams.set('capture', 'snapdom')
  await page.goto(url.href, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.wave-overlay canvas[data-api-capture-consumer]')
  assert.equal(await page.evaluate(() => window.__munari.engine()), mode === 'native' ? 'html-in-canvas' : 'snapdom')
  await page.evaluate(() => {
    const start = performance.now()
    window.waveTime = 0
    Object.defineProperty(performance, 'now', { value: () => start + window.waveTime })
  })
  return page
}

async function exposedBackground(page, unbent, bent, panel, perimeter = bent) {
  return page.evaluate(async ({ images, panel }) => {
    const decode = async data => {
      const image = new Image()
      image.src = `data:image/png;base64,${data}`
      await image.decode()
      const canvas = new OffscreenCanvas(image.width, image.height)
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      return context
    }
    const [rest, flex, edgeFrame] = await Promise.all(images.map(decode))
    const dpr = devicePixelRatio
    const x = Math.floor(panel.x * dpr)
    const y = Math.floor(panel.y * dpr)
    const width = Math.ceil((panel.x + panel.width) * dpr) - x
    const height = Math.ceil((panel.y + panel.height) * dpr) - y
    const background = rest.getImageData(x + 52, y + height + 6, 1, 1).data
    const before = rest.getImageData(x, y, width, height).data
    const during = flex.getImageData(x, y, width, height).data
    const backgroundDelta = (pixels, i) => Math.max(
      Math.abs(pixels[i] - background[0]),
      Math.abs(pixels[i + 1] - background[1]),
      Math.abs(pixels[i + 2] - background[2]),
    )
    const edgePixels = edgeFrame.getImageData(x, y, width, height).data
    let exposed = 0
    let stationaryBorder = 0
    const inset = Math.ceil(3 * dpr)
    const stroke = Math.ceil(1.5 * dpr)
    const corner = Math.ceil(20 * dpr)
    const edges = [
      { length: width, at: (along, depth) => (depth * width + along) * 4 },
      { length: width, at: (along, depth) => ((height - 1 - depth) * width + along) * 4 },
      { length: height, at: (along, depth) => (along * width + depth) * 4 },
      { length: height, at: (along, depth) => (along * width + width - 1 - depth) * 4 },
    ]
    for (const { length, at } of edges) {
      for (let along = corner; along < length - corner; along++) {
        const inner = at(along, inset)
        if (backgroundDelta(during, inner) >= 4 || backgroundDelta(before, inner) < 8) continue
        exposed++
        for (let depth = 0; depth < stroke; depth++) {
          if (backgroundDelta(edgePixels, at(along, depth)) > 8) stationaryBorder++
        }
      }
    }
    return { exposed, stationaryBorder }
  }, { images: [unbent, bent, perimeter].map(image => Buffer.from(image).toString('base64')), panel })
}

async function bend(browser, mode) {
  const page = await prepare(browser, mode)
  try {
    const offset = activePage => activePage.$eval('.wave-delete', tile => {
      const right = tile.getBoundingClientRect().right
      tile.style.position = 'relative'
      tile.style.left = `${(Math.floor(right * devicePixelRatio) + 0.625) / devicePixelRatio - right}px`
    })
    const sample = async (activePage, displacement) => {
      await activePage.evaluate(value => {
        const file = document.querySelector('.wave-delete')
        if (value !== null) file.dataset.waveBuildupDisplacement = value
        file.querySelector('button').click()
      }, displacement)
      await activePage.waitForFunction(() => document.querySelector('.wave-delete').dataset.deleted === 'true')
      await advance(activePage, 110)
      return activePage.screenshot()
    }
    await offset(page)
    const panel = await bounds(page, '.wave-delete')
    const bent = await sample(page, null)
    await advance(page, 2000)
    const unbent = await compareAfterReset(browser, mode, async reference => {
      await offset(reference)
      return sample(reference, '0')
    })
    const difference = await compareWaveImages(page, unbent, bent, unbent, panel)
    assert(difference.regionPixels[0] > 100, 'The outgoing image must visibly bend before launch with the same glow')
    const { exposed, stationaryBorder } = await exposedBackground(page, unbent, bent, panel)
    assert(exposed > 30, 'The tile must bow inward and expose the backdrop before launch')
    assert.equal(stationaryBorder, 0, 'The original border must clear where the tile bends away')
  } finally {
    await page.close()
  }
}

async function copyRelease(browser, mode) {
  const page = await prepare(browser, mode)
  try {
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async () => {} },
    }))
    const panel = await bounds(page, '.wave-copy')
    await page.mouse.move(panel.x + panel.width - 27, panel.y + panel.height - 34)
    const rest = await page.screenshot()
    await page.mouse.down()
    await page.mouse.up()
    await page.waitForFunction(() => document.querySelector('.wave-copy').dataset.copyState === 'copied')
    await advance(page, 155)
    const bent = await page.screenshot()
    await advance(page, 200)
    const releasing = await page.screenshot()
    const { exposed, stationaryBorder } = await exposedBackground(page, rest, bent, panel, releasing)
    assert(exposed > 30, 'Copy must bend inward before release')
    assert.equal(stationaryBorder, 0, 'The incoming Copy border must remain hidden where the panel is still bent')
  } finally {
    await page.close()
  }
}

async function compareAfterReset(browser, mode, read) {
  const page = await prepare(browser, mode)
  try { return await read(page) } finally { await page.close() }
}

async function advance(page, time) {
  await page.evaluate(value => { window.waveTime = value }, time)
  await settle(page)
}

function bounds(page, selector) {
  return page.$eval(selector, element => {
    const { x, y, width, height } = element.getBoundingClientRect()
    return { x, y, width, height }
  })
}

async function scroll(browser, mode) {
  const page = await prepare(browser, mode)
  try {
    const start = await bounds(page, '.wave-like')
    await page.evaluate(() => {
      window.captures = 0
      new MutationObserver(records => {
        window.captures += records.flatMap(record => [...record.addedNodes])
          .filter(node => node instanceof HTMLElement && node.hasAttribute('data-munari-parked')).length
      }).observe(document.body, { childList: true, subtree: true })
      document.querySelector('.wave-like').click()
    })
    await page.waitForFunction(() => document.querySelector('.wave-like').getAttribute('aria-pressed') === 'true')
    await page.waitForFunction(() => document.querySelectorAll('[data-munari-parked]').length === 0)
    await advance(page, 170)
    const captures = await page.evaluate(() => window.captures)
    assert(captures > 0)
    await page.$eval('.wave-page', element => { element.scrollTop = 120 })
    await page.waitForFunction(() => document.querySelector('.wave-page').scrollTop === 120)
    await settle(page)
    const translated = await bounds(page, '.wave-like')
    assert.equal(start.y - translated.y, 120)
    const moving = await page.screenshot()
    await page.$eval('.wave-overlay', element => { element.style.visibility = 'hidden' })
    const native = await page.screenshot()
    const difference = await compareWaveImages(page, native, moving, native, [start, translated])
    assert.equal(difference.regionPixels[0], 0, 'The wave must leave its old screen position')
    assert(difference.regionPixels[1] > 100, 'The wave must remain visible at the translated target')
    assert.equal(await page.evaluate(() => window.captures), captures, 'Scroll must reuse the snapshot')
  } finally {
    await page.close()
  }
}

async function scrollTheme(browser, mode) {
  const page = await prepare(browser, mode)
  try {
    await page.$eval('.wave-theme', button => button.click())
    await page.waitForFunction(() => document.querySelector('.wave-page').dataset.theme === 'light')
    await advance(page, 110)
    await page.$eval('.wave-page', element => { element.scrollTop = 120 })
    await page.waitForFunction(() => document.querySelector('.wave-page').scrollTop === 120)
    await settle(page)
    const moving = await page.screenshot()
    await page.$eval('.wave-overlay', element => { element.style.visibility = 'hidden' })
    const native = await page.screenshot()
    const captured = { x: 0, y: 0, width: 895, height: 468 }
    const exposed = { x: 0, y: 472, width: 895, height: 117 }
    const difference = await compareWaveImages(page, native, moving, native, [captured, exposed])
    assert(difference.regionPixels[0] > 100, 'The captured page wave must follow the document')
    assert.equal(difference.regionPixels[1], 0, 'Newly exposed content must remain native')
  } finally {
    await page.close()
  }
}

async function queuedOrigin(browser, mode) {
  const sample = async (page, scrollFirst) => {
    await page.evaluate(first => {
      const viewport = document.querySelector('.wave-page')
      if (first) viewport.scrollTop = 120
      document.querySelector('.wave-like').click()
      document.querySelector('.wave-delete button').click()
      if (!first) viewport.scrollTop = 120
    }, scrollFirst)
    await page.waitForFunction(() => document.querySelector('.wave-delete').dataset.deleted === 'true')
    await advance(page, 110)
    return page.screenshot()
  }
  const page = await prepare(browser, mode)
  try {
    const queued = await sample(page, false)
    const panel = await bounds(page, '.wave-delete')
    await advance(page, 2000)
    const reference = await compareAfterReset(browser, mode, other => sample(other, true))
    const difference = await compareWaveImages(page, reference, queued, reference, panel)
    assert.equal(difference.regionPixels[0], 0, 'Scroll during the queue must preserve the same target-local launch as clicking after scroll')
  } finally {
    await page.close()
  }
}

const modes = process.argv.slice(2)
for (const mode of modes.length ? modes : ['native', 'snapdom']) {
  assert(['native', 'snapdom'].includes(mode))
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: [...WEBGPU_CHROME_ARGS, ...(mode === 'native' ? ['--enable-features=CanvasDrawElement'] : [])],
  })
  try {
    await bend(browser, mode)
    await copyRelease(browser, mode)
    await scroll(browser, mode)
    await scrollTheme(browser, mode)
    await queuedOrigin(browser, mode)
    console.log(mode, 'buildup and scroll checks passed')
  } finally {
    await browser.close()
  }
}
