// Shared browser lifetime for API probes; each case owns its assertions.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { setChromeViewport } from './chromeViewport.mjs'

const repo = path.resolve(import.meta.dirname, '..')

export async function fixtureServer(directory, environment, output) {
  if (process.env[environment]) return { url: process.env[environment].replace(/\/$/, ''), close: async () => {} }
  const root = path.join(repo, directory)
  const options = {
    root,
    cacheDir: path.join(output, `.vite-${path.basename(directory)}`),
    server: { host: '127.0.0.1', port: 0, fs: { allow: [repo] } },
    logLevel: 'warn',
  }
  if (directory !== 'apps/lab') { options.configFile = false; options.esbuild = { jsx: 'automatic' } }
  const server = await createServer(options)
  try {
    await server.listen()
    const address = server.httpServer.address()
    assert.ok(Number.isInteger(address?.port) && address.port > 0, 'The fixture server did not bind a TCP port')
    return { url: `http://127.0.0.1:${address.port}`, close: () => server.close() }
  } catch (error) {
    await server.close()
    throw error
  }
}

export async function evidenceDirectory(name) {
  const output = process.env.API_PROOF_OUTPUT ?? path.join(tmpdir(), 'munari-api', name)
  await mkdir(output, { recursive: true })
  return output
}

export function selectedCases(cases) {
  assert.ok(cases.length > 0, 'The probe declares no cases')
  if (process.env.API_CASES === undefined) return cases
  const requested = new Set(process.env.API_CASES.split(',').map(value => value.trim()).filter(Boolean))
  assert.ok(requested.size > 0, 'API_CASES selected no cases')
  for (const name of requested) assert.ok(cases.some(entry => entry.id === name), `Unknown API case: ${name}`)
  return cases.filter(entry => requested.has(entry.id))
}

export async function runBrowserCases(cases, output) {
  const selected = selectedCases(cases)
  const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync)
  assert.ok(chrome, 'Set CHROME_PATH to an installed Chrome executable')
  const results = []
  for (const entry of selected) {
    let browser
    let timer
    try {
      browser = await puppeteer.launch({
        defaultViewport: null, executablePath: chrome, headless: process.env.HEADED !== '1', protocolTimeout: 30_000,
        args: [...(entry.native ? [] : ['--enable-features=CanvasDrawElement']), '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', ...(process.env.CI ? ['--no-sandbox'] : [])],
      })
      const page = await browser.newPage()
      page.setDefaultTimeout(15_000)
      page.setDefaultNavigationTimeout(30_000)
      await setChromeViewport(page, { width: 1280, height: 900 })
      const errors = []
      page.on('pageerror', error => errors.push(String(error)))
      page.on('console', message => {
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text())
      })
      const detail = await Promise.race([
        entry.run(page),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${entry.id} exceeded 60 seconds`)), 60_000) }),
      ])
      assert.deepEqual(errors, [], `${entry.id} reported browser errors`)
      await page.screenshot({ path: path.join(output, `${entry.id}.png`) })
      results.push({ id: entry.id, passed: true, mode: entry.native ? 'native' : 'enhanced', ...detail, browser: await browser.version(), errors })
    } catch (error) {
      results.push({ id: entry.id, passed: false, error: error.stack ?? String(error) })
    } finally {
      clearTimeout(timer)
      await browser?.close()
      await writeFile(path.join(output, 'results.json'), JSON.stringify({ selected: selected.map(entry => entry.id), results }, null, 2))
    }
    console.log(JSON.stringify(results.at(-1)))
  }
  assert.equal(results.length, selected.length)
  assert.ok(results.every(entry => entry.passed), `Failed API cases: ${results.filter(entry => !entry.passed).map(entry => entry.id).join(', ')}`)
  return results
}

export async function capability(page, expected) {
  const supported = await page.evaluate(() => { const context = document.createElement('canvas').getContext('2d'); return Boolean(context && 'drawElementImage' in context) })
  assert.equal(supported, expected, expected ? 'HTML-in-canvas capability is required' : 'Native coverage requires actual absence of HTML-in-canvas')
}

export async function fill(page, selector, value) {
  assert.equal(await page.$$eval(selector, elements => elements.length), 1, `${selector} must identify one live field`)
  await page.click(selector)
  assert.ok(await page.$eval(selector, element => document.activeElement === element), `${selector} must acquire focus from the click`)
  // Arrange the replacement range; the browser still owns focus and typing.
  await page.$eval(selector, element => element.setSelectionRange(0, element.value.length))
  assert.ok(await page.$eval(selector, element => document.activeElement === element && element.selectionStart === 0 && element.selectionEnd === element.value.length), `${selector} must own focus and the complete text selection`)
  await page.keyboard.press('Backspace')
  await page.keyboard.type(value)
  assert.ok(await page.$eval(selector, element => document.activeElement === element), `${selector} must retain focus through typing`)
  assert.equal(await page.$eval(selector, element => element.value), value, `${selector} did not accept the replacement text`)
}

export async function screenshotPixel(page, x, y) {
  const png = await page.screenshot({ encoding: 'base64' })
  return page.evaluate(async ({ data, x, y }) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(data), letter => letter.charCodeAt(0))], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d')
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    return Array.from(context.getImageData(Math.floor(x * canvas.width / innerWidth), Math.floor(y * canvas.height / innerHeight), 1, 1).data)
  }, { data: png, x, y })
}
