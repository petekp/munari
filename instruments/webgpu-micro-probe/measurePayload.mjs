// Measure production Vite 8 / Rolldown bundle sizes for the micro-engine entries.
import assert from 'node:assert/strict'
import { build } from 'vite'
import typegpu from 'unplugin-typegpu/vite'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const here = import.meta.dirname
const repoRoot = path.resolve(here, '..', '..')
const coreEntry = path.join(repoRoot, 'packages', 'core', 'src', 'index.ts')
const budgetsPath = path.join(repoRoot, 'instruments', 'payload', 'budgets.json')
const budgets = JSON.parse(readFileSync(budgetsPath, 'utf8'))

const entries = [
  'reactBaseline',
  'minimalSurface',
  'flightApp',
  'fisheyeApp',
  'flightAppManifest',
  'fisheyeAppManifest',
  'minimalSurfaceTypegpu',
  'flightAppTypegpu',
  'fisheyeAppTypegpu',
]

const wgslTwin = {
  flightAppManifest: 'flightApp',
  fisheyeAppManifest: 'fisheyeApp',
  minimalSurfaceTypegpu: 'minimalSurface',
  flightAppTypegpu: 'flightApp',
  fisheyeAppTypegpu: 'fisheyeApp',
}

export async function measureMicroPayloads() {
  assert.notEqual(
    process.env.NODE_ENV,
    'development',
    'measurePayload must run with NODE_ENV !== development so React uses production builds',
  )
  const results = []
  for (const name of entries) {
    const out = await build({
      configFile: false,
      root: here,
      logLevel: 'silent',
      mode: 'production',
      plugins: name.endsWith('Typegpu') ? [typegpu()] : [],
      resolve: {
        alias: [{ find: /^@munari\/core$/, replacement: coreEntry }],
      },
      build: {
        write: false,
        minify: true,
        reportCompressedSize: false,
        modulePreload: false,
        rollupOptions: {
          input: path.join(here, 'payload-entries', `${name}.tsx`),
        },
      },
    })
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((r) => r.output)
    const jsChunks = outputs.filter((c) => c.type === 'chunk')
    const minBytes = jsChunks.reduce((s, c) => s + Buffer.byteLength(c.code), 0)
    const gzBytes = jsChunks.reduce((s, c) => s + gzipSync(c.code, { level: 9 }).length, 0)
    const brBytes = jsChunks.reduce(
      (s, c) =>
        s +
        brotliCompressSync(c.code, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
        }).length,
      0,
    )
    const typegpuModules = jsChunks.flatMap((c) =>
      Object.keys(c.modules ?? {}).filter((id) => id.includes('/node_modules/typegpu/')),
    )
    results.push({ name, minBytes, gzBytes, brBytes, chunks: jsChunks.length, typegpuModuleCount: typegpuModules.length })
  }
  const byName = new Map(results.map((r) => [r.name, r]))
  const baselineGz = byName.get('reactBaseline')?.gzBytes ?? 0
  return {
    baselineGz,
    currentSurfaceBudgetGz: budgets.surface.gzipBytes,
    entries: results.map((r) => {
      const twinName = wgslTwin[r.name]
      const twinGz = twinName ? byName.get(twinName)?.gzBytes : undefined
      const row = {
        ...r,
        netGzOverReact: r.gzBytes - baselineGz,
      }
      if (twinGz !== undefined) row.deltaVsWgslGz = r.gzBytes - twinGz
      return row
    }),
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await measureMicroPayloads()
  console.log(JSON.stringify(report, null, 2))
}
