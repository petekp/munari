// Mask optimization proof — compare every packed byte with the dense reference.
// Both paths use the same native raster grid and exact distance transform.
import assert from 'node:assert/strict'
import {mkdir, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'vite'
import puppeteer from 'puppeteer-core'
import {setChromeViewport} from '../chromeViewport.mjs'

const output = process.env.MASK_OUTPUT ?? path.join(tmpdir(), 'munari-mask-fidelity')
await mkdir(output, {recursive: true})
const server = await createServer({root: path.resolve(import.meta.dirname, '../../apps/lab'), logLevel: 'warn', server: {host: '127.0.0.1', port: 0}})
await server.listen()
const browser = await puppeteer.launch({executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: process.env.HEADED !== '1', defaultViewport: null, signal: AbortSignal.timeout(30_000), args: ['--enable-features=CanvasDrawElement']})
try {
  const page = await browser.newPage(), results = []
  await setChromeViewport(page, {width: 1280, height: 700})
  await page.emulateMediaFeatures([{name: 'prefers-reduced-motion', value: 'reduce'}])
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scene=home&framed`, {waitUntil: 'load'})
  await page.waitForFunction(() => document.documentElement.dataset.homeReady === 'true')
  for (const width of [1280, 390]) {
    await setChromeViewport(page, {width, height: 844})
    const result = await page.evaluate(async referenceUrl => {
      const [{measureRelief, paintRelief, buildInkMask}, {referenceDistances, referencePack}] = await Promise.all([
        import('/src/scenes/home/homeRelief.ts'), import(referenceUrl),
      ])
      const inner = document.querySelector('#root .home-inner')
      const plans = [
        {name: 'page', ...measureRelief(inner, inner)},
        {name: 'fractional-overlap', width: 901.25, height: 1300.75, rect: {x: 0, y: 0, width: 901.25, height: 1300.75}, boxes: [
          {kind: 'raised', x: 17.125, y: 22.75, width: 212.375, height: 87.25, radius: 19.5},
          {kind: 'raised', x: 185.0625, y: 95.25, width: 100.125, height: 71.25, radius: 5.75},
          {kind: 'well', x: 600.125, y: 950.375, width: 234.5, height: 175.75, radius: 21.125},
        ]},
        {name: 'saturated-space', width: 420, height: 4096, rect: {x: 0, y: 0, width: 420, height: 4096}, boxes: [
          {kind: 'raised', x: 31.5, y: 35.25, width: 80.75, height: 34.5, radius: 0},
          {kind: 'well', x: 250.125, y: 4010.75, width: 130.5, height: 62.75, radius: 7.5},
        ]},
        {name: 'empty-kind-and-edge', width: 800, height: 1100, rect: {x: 0, y: 0, width: 800, height: 1100}, boxes: [
          {kind: 'raised', x: -10.25, y: -15.5, width: 112.25, height: 80.125, radius: 16},
          {kind: 'raised', x: 750.5, y: 1000.75, width: 130.25, height: 125.5, radius: 0},
        ]},
      ]
      const exact = (a, b, label) => {
        if (a.length !== b.length) throw Error(`${label}: length differs`)
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw Error(`${label}: byte ${i}: ${a[i]} != ${b[i]}`)
      }
      const results = []
      for (const offscreen of [false, true]) {
        const create = (width, height) => {
          const canvas = offscreen ? new OffscreenCanvas(width, height) : document.createElement('canvas')
          canvas.width = width; canvas.height = height
          return canvas.getContext('2d')
        }
        // Independent reference: rasterize and transform the complete domain.
        const dense = plan => {
          const width = Math.ceil(plan.width * .5), height = Math.ceil(plan.height * .5)
          const fields = ['raised', 'well'].map(kind => {
            const context = create(width, height)
            context.scale(.5, .5); context.fillStyle = '#fff'
            for (const box of plan.boxes) if (box.kind === kind) {
              context.beginPath(); context.roundRect(box.x, box.y, box.width, box.height, box.radius); context.fill()
            }
            const pixels = context.getImageData(0, 0, width, height).data
            return referenceDistances(pixels, width, height, .5)
          })
          return referencePack(fields[0], fields[1])
        }
        for (const plan of plans) {
          const start = performance.now(), reference = dense(plan), middle = performance.now()
          const optimized = paintRelief(plan, create), end = performance.now()
          exact(reference, optimized.data, plan.name)
          results.push({name: plan.name, offscreen, bytes: reference.length, referenceMs: middle - start, optimizedMs: end - middle})
        }
      }
      const lines = [...document.querySelectorAll('#root .home-masthead-title > span')]
      const first = buildInkMask(inner, lines)
      const same = buildInkMask(inner, lines, first)
      if (first !== same) throw Error('Unchanged native coverage did not reuse the mask')
      const word = document.querySelector('#root .home-headline-html'), original = word.textContent
      word.textContent = '<form>'
      const changed = buildInkMask(inner, lines, first)
      if (changed === first) throw Error('Changed glyphs reused stale distances')
      word.textContent = original
      const restored = buildInkMask(inner, lines, changed)
      exact(first.data, restored.data, 'restored headline')
      return {width: innerWidth, results, cache: {reused: first === same, changed: first !== changed, restored: true}}
    }, '/@fs' + path.join(import.meta.dirname, 'maskReference.mjs'))
    results.push(result)
  }
  assert.equal(results.length, 2)
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results))
} finally { await browser.close(); await server.close() }
