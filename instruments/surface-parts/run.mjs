// Duplicate-part recovery through public Surface APIs; run Chrome serially.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { setChromeViewport } from '../chromeViewport.mjs'

const output = process.env.API_PROOF_OUTPUT ?? path.join(tmpdir(), 'munari-api/surface-parts')
await mkdir(output, { recursive:true })
const server = await createServer({ configFile:false, root:import.meta.dirname, cacheDir:path.join(output,'.vite'), server:{ host:'127.0.0.1', port:0, fs:{ allow:[path.resolve(import.meta.dirname,'../..')] } }, esbuild:{ jsx:'automatic' }, logLevel:'warn' })
await server.listen()
const browser = await puppeteer.launch({ executablePath:process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:process.env.HEADED !== '1', defaultViewport:null, args:['--enable-features=CanvasDrawElement','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'] })
const results = []
try {
  for (const wiring of ['scene','page']) for (const strict of [false,true]) for (const removed of ['first','last']) {
    const name = `${wiring}-${strict ? 'strict' : 'normal'}-remove-${removed}`
    const survivor = removed === 'first' ? 'last' : 'first'
    const expected = survivor === 'first' ? [255,0,0,255] : [0,255,0,255]
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(String(error)))
    try {
      await setChromeViewport(page, { width:900, height:700 })
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?wiring=${wiring}&strict=${strict ? '1' : '0'}`, { waitUntil:'load' })
      assert.equal(await page.evaluate(() => 'drawElementImage' in CanvasRenderingContext2D.prototype), true, 'Capture capability is required')
      if (wiring === 'page') assert.equal(await page.evaluate(() => 'moveBefore' in Element.prototype), true, 'Retained page capture requires moveBefore')
      await page.waitForFunction(() => {
        const state = window.__partsProof?.read()
        return state?.presentation === 'scene' && state.inputs.first !== null && state.inputs.last !== null && state.pixel?.join(',') === '0,255,0,255'
      }, { timeout:15000 })
      const before = await page.evaluate(() => window.__partsProof.read())
      await page.evaluate(owner => window.__partsProof.remember(owner), survivor)
      await page.click(`#remove-${removed}`)
      await page.waitForFunction(pixel => {
        const state = window.__partsProof.read()
        return state.presentation === 'scene' && state.pixel?.join(',') === pixel.join(',')
      }, { timeout:10000 }, expected)
      const after = await page.evaluate(() => window.__partsProof.read())
      const result = { name, removed, survivor, before, after, errors, nativeDpr:await page.evaluate(() => devicePixelRatio) }
      results.push(result)
      await page.screenshot({ path:path.join(output, `${name}.png`) })
      await writeFile(path.join(output,'results.json'), JSON.stringify(results,null,2))
      console.log(JSON.stringify(result))
      assert.deepEqual(errors, [])
      assert.equal(after.error, 0)
      assert.equal(after.dpr, result.nativeDpr)
      assert.deepEqual(after.pixel, expected)
      assert.equal(after.inputs[removed], null)
      assert.equal(after.retained.sameInput, true)
      assert.equal(after.retained.connected, true)
      assert.equal(after.retained.value, `${survivor} edited before removal`)
      assert.equal(after.retained.mountsAfter, after.retained.mountsBefore)
      assert.equal(after.retained.unmountsAfter, after.retained.unmountsBefore)
      assert.ok(before.diagnostics.some(message => message.includes('two parts named "panel"')))
      assert.deepEqual(after.diagnostics.filter(message => !message.includes('two parts named "panel"')), [])
    } catch (error) {
      const state = await page.evaluate(() => window.__partsProof?.read()).catch(() => null)
      await page.screenshot({ path:path.join(output, `${name}-failure.png`) }).catch(() => {})
      await writeFile(path.join(output, `${name}-failure.json`), JSON.stringify({ name, errors, state, failure:String(error) },null,2))
      throw error
    } finally { await page.close() }
  }
} finally { await browser.close(); await server.close() }
