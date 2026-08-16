// shader-compile — do the lab's shaders actually become programs?
//
// A shader in this repo is a JavaScript string until the moment a
// browser compiles it, and nothing before that moment can tell you it
// is wrong. typecheck sees a string. lint sees a string. The unit
// suites read the string with regexes and answer only the questions
// they were told to ask.
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
// does, hooks `compileShader` and `linkProgram` from inside the page,
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  window.__glslFails = []
  const classes = [
    'WebGLRenderingContext' in globalThis ? WebGLRenderingContext : null,
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
      if (!this.getShaderParameter(sh, this.COMPILE_STATUS)) {
        window.__glslFails.push({
          what: 'compile',
          log: this.getShaderInfoLog(sh) || '(no info log)',
          src: sh.__src || '',
        })
      }
    }
    const linkProgram = C.prototype.linkProgram
    C.prototype.linkProgram = function (pr) {
      linkProgram.call(this, pr)
      // A link failure with both stages compiled is the OTHER half of
      // this class of bug: a varying written by one stage and read by
      // the other under a different type, or one too many of them.
      if (!this.getProgramParameter(pr, this.LINK_STATUS)) {
        window.__glslFails.push({
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
  process.exit(1)
}, 120_000)

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--enable-features=CanvasDrawElement',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })
  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(INSTALL)

  // probe=still pauses the conductor: this gate wants every material
  // built, not a choreography running under it.
  await page.goto(`http://localhost:${port}/?scene=logo&probe=still`, { waitUntil: 'load' })
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
    ['the page at rest', async () => {}],
    ['matter mode', async () => page.click('.logo-matter button[data-renderer="gl"]')],
    // Extrusion is off by default and builds the slab material, so the
    // gate has to ask for it — the default-on states alone would have
    // left the letter's edge shader unproven.
    ['extruded', async () => knob('extrude', 60)],
    // Same reasoning, other direction: `body` now defaults to 0, so the
    // states above are the bump-only relief and the mesh body is the one
    // nothing reaches by default.
    ['mesh body', async () => knob('body', 1)],
    ['back to the page', async () => page.click('.logo-matter button[data-renderer="html"]')],
  ]
  const seen = []
  for (const [what, act] of steps) {
    await act()
    await sleep(1200)
    const fails = await page.evaluate(() => window.__glslFails.splice(0))
    for (const f of fails) seen.push({ what, f })
    console.log(`  ${what.padEnd(22)} ${fails.length ? `${fails.length} FAILED` : 'ok'}`)
  }

  clearTimeout(deadline)
  await browser.close()
  await server.close()

  if (seen.length) {
    console.error('')
    for (const { what, f } of seen) {
      console.error(`[${what}]`)
      console.error(render(f))
      console.error('')
    }
    console.error(`shader-compile gate FAILED: ${seen.length} shader(s) never became a program`)
    process.exit(1)
  }
  console.log('shader-compile gate PASSED: every shader the walk builds compiled and linked')
} catch (err) {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
  console.error('shader-compile gate FAILED:', err)
  process.exit(1)
}
