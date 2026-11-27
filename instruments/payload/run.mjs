// Payload budget check — gzip size of what each public import costs a consumer.
//
// Each entry in entries/ is a tiny app that imports the built package the way
// a consumer does, through the published specifiers. Vite builds it in
// production mode and the script sums gzip -9 over the chunks the browser must
// load before the entry runs: the entry chunk and everything it imports
// statically. A chunk reached only through a dynamic import() is reported
// apart and not counted, which is how /snapdom proves it leaves the input-region
// rasterizer out until it is used.
//
// Run `npm run build` first; this script measures packages/react/dist, the
// package that is published. Each entry is judged on its own against
// budgets.json, so a failure names the import that grew.

import { build } from 'vite'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { judgeEntry } from './budget.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const dist = join(here, '..', '..', 'packages', 'react', 'dist')

if (!existsSync(join(dist, 'package.json'))) {
  console.error('payload: packages/react/dist is not staged. Run npm run build first.')
  process.exit(1)
}

const budgets = JSON.parse(readFileSync(join(here, 'budgets.json'), 'utf8'))
const entryNames = readdirSync(join(here, 'entries'))
  .filter((file) => file.endsWith('.js'))
  .map((file) => file.slice(0, -'.js'.length))
  .sort()
const unrecorded = entryNames.filter((name) => !(name in budgets))
const unbuilt = Object.keys(budgets).filter((name) => !entryNames.includes(name))
if (unrecorded.length > 0 || unbuilt.length > 0) {
  console.error(
    `payload: entries and budgets.json disagree. No budget for: ${unrecorded.join(', ') || 'none'}. ` +
      `No entry for: ${unbuilt.join(', ') || 'none'}.`,
  )
  process.exit(1)
}

// The published specifiers resolve to the staged package, not to the
// workspace source that the lab and the type-checker use.
const alias = [
  { find: /^@petepetrash\/munari$/, replacement: join(dist, 'index.js') },
  { find: /^@petepetrash\/munari\/advanced$/, replacement: join(dist, 'advanced.js') },
  { find: /^@petepetrash\/munari\/gpu$/, replacement: join(dist, 'gpu.js') },
  { find: /^@petepetrash\/munari\/snapdom$/, replacement: join(dist, 'snapdom.js') },
]

const gzipBytes = (code) => gzipSync(code, { level: 9 }).length

async function measure(name, external = []) {
  const result = await build({
    configFile: false,
    root: here,
    logLevel: 'silent',
    mode: 'production',
    resolve: { alias },
    build: {
      write: false,
      minify: true,
      reportCompressedSize: false,
      modulePreload: false,
      rollupOptions: { input: join(here, 'entries', `${name}.js`), external },
    },
  })
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((output) => output.output)
    .filter((item) => item.type === 'chunk')
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
  const loaded = new Set()
  const visit = (chunk) => {
    if (loaded.has(chunk)) return
    loaded.add(chunk)
    for (const file of chunk.imports) {
      const imported = byFile.get(file)
      if (imported) visit(imported)
    }
  }
  const entryChunk = chunks.find((chunk) => chunk.isEntry)
  if (!entryChunk) throw new Error(`payload: ${name} built no entry chunk`)
  visit(entryChunk)
  const sum = (list) => list.reduce((total, chunk) => total + gzipBytes(chunk.code), 0)
  return { loadedBytes: sum([...loaded]), deferredBytes: sum(chunks.filter((chunk) => !loaded.has(chunk))) }
}

const results = []
for (const name of entryNames) {
  const { loadedBytes, deferredBytes } = await measure(name)
  const { gzipBytes: recordedBytes, marginBytes } = budgets[name]
  results.push({ ...judgeEntry({ name, measuredBytes: loadedBytes, recordedBytes, marginBytes }), deferredBytes })
}

const pad = (text, width) => String(text).padEnd(width)
console.log(`${pad('entry', 18)}${pad('loaded', 9)}${pad('recorded', 10)}${pad('limit', 9)}${pad('deferred', 10)}result  (gzip bytes)`)
for (const result of results) {
  console.log(
    pad(result.name, 18) +
      pad(result.measuredBytes, 9) +
      pad(result.recordedBytes, 10) +
      pad(result.limitBytes, 9) +
      pad(result.deferredBytes, 10) +
      (result.ok ? 'ok' : 'OVER BUDGET'),
  )
}

const gpuExternal = await measure('gpuSurface', ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'])
console.log(
  `gpuSurface (react external): ${gpuExternal.loadedBytes} loaded / ${gpuExternal.deferredBytes} deferred (gzip bytes, info only)`,
)

const failed = results.filter((result) => !result.ok)
if (failed.length > 0) {
  console.error(`payload: over budget: ${failed.map((result) => result.name).join(', ')}`)
  process.exit(1)
}
