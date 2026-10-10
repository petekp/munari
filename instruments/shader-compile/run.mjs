// shader-compile — do the lab's shaders actually become programs?
//
// A shader in this repo is a TSL node graph. Three builds it into WGSL,
// or GLSL on the WebGL 2 fallback, and only the browser's compile of
// that code can tell you it is wrong. A graph that passes typecheck and
// lint can still build code the browser rejects.
//
// The gap is not theoretical. Moving the letter's height description
// into one shared GLSL block dropped `tFine` and `tCoarse`: declared in
// neither stage, used in both. Every letter went to a black canvas. The
// suite that exists to guard that block passed — it checked that no
// uniform was declared TWICE and never that each one was declared at
// all — and the failure surfaced two commands later as a phase-wait
// timeout inside the crossing gate, which is as far from "line 144
// names an identifier nobody declared" as a symptom gets (2026-08-14).
//
// So this instrument compiles them. It boots the lab the way a person
// does, hooks shader compiles and program links from inside the page
// (WebGPU shader modules and pipelines, or WebGL's `compileShader` and
// `linkProgram` on the fallback),
// walks the scene through the states that build materials, and reports
// every info log against its own source. It is the cheapest gate in the
// repo and it answers the one question the other gates assume.
//
// Coverage is honest rather than total: a program that no state in the
// walk below constructs is a program this gate does not see. Adding a
// material means adding the state that builds it here.

import { existsSync } from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const labRoot = path.join(ROOT, 'apps', 'lab')
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
]
  .filter(Boolean)
  .find((p) => existsSync(p))

// The letter material's live uniform values, for the walk's state checks.
// Node uniforms live on the material, not on a GL program, so the gate
// wraps the factory and keeps each live material with its values.
const LETTER_FACTORY = 'export function createLetterMaterial('
const observeLetters = {
  name: 'shader-compile-letters',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('/scenes/logo/logoNodes.ts')) return
    if (code.split(LETTER_FACTORY).length !== 2) throw new Error(`logoNodes.ts: expected one ${LETTER_FACTORY}`)
    return `${code.replace(LETTER_FACTORY, 'function __createLetterMaterial(')}
export function createLetterMaterial(t: LetterTextures, u: LetterUniforms): MeshBasicNodeMaterial {
  const material = __createLetterMaterial(t, u)
  const letters = (window.__letterMaterials ??= new Set())
  const entry = { material, u }
  letters.add(entry)
  material.addEventListener('dispose', () => letters.delete(entry))
  return material
}
`
  },
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// How long a step may take to reach its state. This gate checks that shaders
// compile and that each state is reached, not how fast. A hosted runner took
// 7650 ms to return to the page (2026-09-29, one run), where a Mac takes about
// 1200 ms. One sample at 1200 ms failed a walk whose shaders had all compiled.
const STATE_DEADLINE_MS = 30_000

// Same convention as the other browser gates: an environmental gap is a
// loud annotation, not a red build, unless STRICT_CAPABILITY says so.
function skip(reason) {
  const msg = `shader-compile gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : msg)
  if (process.env.STRICT_CAPABILITY === '1') {
    console.error('STRICT_CAPABILITY=1 — treating the gap as a failure.')
    process.exit(1)
  }
  process.exit(0)
}
if (!CHROME) skip('no Chrome executable found (set CHROME_PATH)')

// The hook. Installed before any page script runs, so it sees the first
// program three builds. It keeps each shader's source next to its
// handle, which is what turns "ERROR: 0:144" into a readable line.
const INSTALL = () => {
  window.__shaderFails = []
  const state = { compiled: 0, linked: 0 }
  window.__shaderState = () => ({
    compiled: state.compiled,
    linked: state.linked,
    holds: document.querySelector('.logo-canvas')?.getAttribute('data-holds') === 'true',
    letters: [...(window.__letterMaterials ?? [])].map(({ u }) => ({ slab: u.slab.value, body: u.meshFrac.value })),
  })
  // WebGPU: every shader module is a compile and every pipeline a link.
  // Compile messages arrive asynchronously, and pipeline or validation
  // failures surface as uncaptured device errors.
  if ('GPUDevice' in globalThis) {
    const createShaderModule = GPUDevice.prototype.createShaderModule
    GPUDevice.prototype.createShaderModule = function (descriptor) {
      // Three reuses one descriptor object for every module, so the source
      // is read now, not when the compile messages arrive.
      const src = descriptor.code || ''
      const module = createShaderModule.call(this, descriptor)
      state.compiled++
      module.getCompilationInfo().then((info) => {
        const errors = info.messages.filter((m) => m.type === 'error')
        if (errors.length) {
          window.__shaderFails.push({
            what: 'compile',
            log: errors.map((m) => `ERROR: 0:${m.lineNum}: ${m.message}`).join('\n'),
            src,
          })
        }
      })
      return module
    }
    for (const name of ['createRenderPipeline', 'createRenderPipelineAsync']) {
      const create = GPUDevice.prototype[name]
      GPUDevice.prototype[name] = function (descriptor) {
        state.linked++
        const result = create.call(this, descriptor)
        if (result instanceof Promise) {
          result.catch((error) => window.__shaderFails.push({ what: 'link', log: String(error), src: '' }))
        }
        return result
      }
    }
    const requestDevice = GPUAdapter.prototype.requestDevice
    GPUAdapter.prototype.requestDevice = async function (...args) {
      const device = await requestDevice.apply(this, args)
      device.addEventListener('uncapturederror', (event) => {
        window.__shaderFails.push({ what: 'link', log: String(event.error?.message ?? event.error), src: '' })
      })
      return device
    }
  }
  const classes = [
    'WebGL2RenderingContext' in globalThis ? WebGL2RenderingContext : null,
  ].filter(Boolean)
  for (const C of classes) {
    const shaderSource = C.prototype.shaderSource
    C.prototype.shaderSource = function (sh, src) {
      sh.__src = src
      return shaderSource.call(this, sh, src)
    }
    const compileShader = C.prototype.compileShader
    C.prototype.compileShader = function (sh) {
      compileShader.call(this, sh)
      state.compiled++
      if (!this.getShaderParameter(sh, this.COMPILE_STATUS)) {
        window.__shaderFails.push({
          what: 'compile',
          log: this.getShaderInfoLog(sh) || '(no info log)',
          src: sh.__src || '',
        })
      }
    }
    const linkProgram = C.prototype.linkProgram
    C.prototype.linkProgram = function (pr) {
      linkProgram.call(this, pr)
      state.linked++
      // A link failure with both stages compiled is the OTHER half of
      // this class of bug: a varying written by one stage and read by
      // the other under a different type, or one too many of them.
      if (!this.getProgramParameter(pr, this.LINK_STATUS)) {
        window.__shaderFails.push({
          what: 'link',
          log: this.getProgramInfoLog(pr) || '(no info log)',
          src: '',
        })
      }
    }
  }
}

/** The info log, with each error's own source line under it. */
function render(fail) {
  const out = [`── ${fail.what} failed ──`, fail.log.trim()]
  const lines = fail.src.split('\n')
  const at = [...new Set([...fail.log.matchAll(/ERROR: \d+:(\d+)/g)].map((m) => Number(m[1])))]
  for (const n of at) {
    out.push('')
    for (let i = Math.max(0, n - 3); i < Math.min(lines.length, n + 2); i++) {
      out.push(`  ${String(i + 1).padStart(4)} ${i + 1 === n ? '>' : ' '} ${lines[i]}`)
    }
  }
  return out.join('\n')
}

let server, browser
const deadline = setTimeout(() => {
  console.error('shader-compile: hard 120s deadline hit')
  browser?.process()?.kill('SIGKILL')
  process.exit(1)
}, 120_000)

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      ...WEBGPU_CHROME_ARGS,
      '--enable-unsafe-swiftshader',
      '--enable-features=CanvasDrawElement',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })
  server = await createServer({ root: labRoot, plugins: [observeLetters], logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource'))
      errors.push(message.text())
  })
  const capable = await page.evaluate(() => 'drawElementImage' in document.createElement('canvas').getContext('2d'))
  if (!capable) {
    await browser.close()
    browser = null
    await server.close()
    server = null
    skip(`Chrome at ${CHROME} has no drawElementImage`)
  }
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(INSTALL)

  // probe=still pauses the conductor: this gate wants every material
  // built, not a choreography running under it. `framed` keeps the nav
  // shell from wrapping the scene in an iframe this page handle cannot
  // see into; the scene's own panel (the data-renderer buttons this
  // gate clicks) still renders.
  await page.goto(`http://localhost:${port}/?scene=logo&probe=still&framed`, {
    waitUntil: 'load',
  })
  await page.waitForFunction(
    () => document.querySelector('.logo-word') && document.fonts.status === 'loaded',
    { timeout: 15_000 },
  )
  await sleep(900)

  // The walk. Every state below builds materials the previous one did
  // not, and a state that reaches the canvas is a state whose programs
  // must link.
  // Knobs move through the scene's own handle, never through the tuning
  // panel. A panel row is a design decision and gets hidden; a walk that
  // clicked one reported 'ok' for a state it never reached. A missing
  // handle throws here instead.
  const knob = async (name, v) => {
    const ok = await page.evaluate(
      (name_, v_) => {
        if (!window.__logo) return false
        window.__logo.setKnob(name_, v_)
        return true
      },
      name,
      v,
    )
    if (!ok) throw new Error(`window.__logo is missing: cannot set ${name}`)
  }

  const steps = [
    ['the page at rest', async () => {}, state => !state.holds],
    ['scene rendering', async () => page.click('.logo-renderer button[data-renderer="gl"]'), state => state.holds && state.letters.length > 0],
    // Extrusion is off by default and builds the slab material, so the
    // gate has to ask for it — the default-on states alone would have
    // left the letter's edge shader unproven.
    ['extruded', async () => knob('extrude', 60), state => state.holds && state.letters.some(letter => letter.slab > 0)],
    // Same reasoning, other direction: `body` now defaults to 0, so the
    // states above are the bump-only relief and the mesh body is the one
    // nothing reaches by default.
    ['mesh body', async () => knob('body', 1), state => state.holds && state.letters.some(letter => letter.body > 0)],
    ['back to the page', async () => page.click('.logo-renderer button[data-renderer="html"]'), state => !state.holds],
  ]
  const seen = []
  let compiled = 0
  let linked = 0
  for (const [what, act, reached] of steps) {
    const began = Date.now()
    await act()
    await sleep(1200)
    let observed = await page.evaluate(() => window.__shaderState())
    while (!reached(observed) && Date.now() - began < STATE_DEADLINE_MS) {
      await sleep(100)
      observed = await page.evaluate(() => window.__shaderState())
    }
    const took = Date.now() - began
    const fails = await page.evaluate(() => window.__shaderFails.splice(0))
    for (const f of fails) seen.push({ what, f })
    if (!reached(observed)) {
      for (const { what: state, f } of seen) console.error(`[${state}]\n${render(f)}`)
      throw new Error(`${what}: the shader walk did not reach its state: ${JSON.stringify(observed)}`)
    }
    compiled = observed.compiled
    linked = observed.linked
    console.log(`  ${what.padEnd(22)} ${fails.length ? `${fails.length} FAILED` : 'ok'}  ${took}ms`)
  }

  if (compiled === 0 || linked === 0) throw new Error('shader observer saw no compile/link activity')
  if (seen.length) {
    console.error('')
    for (const { what, f } of seen) {
      console.error(`[${what}]`)
      console.error(render(f))
      console.error('')
    }
    console.error(`shader-compile gate FAILED: ${seen.length} shader(s) never became a program`)
    throw new Error(`${seen.length} shader compilation or link failure(s)`)
  }
  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`)
  console.log(`shader-compile gate PASSED: ${compiled} compile calls, ${linked} link calls; every requested state reached`)
} catch (err) {
  console.error('shader-compile gate FAILED:', err)
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
