// Softbox download sizes — what each softbox table source costs when a page
// first uses a softbox key, measured the way instruments/payload measures
// an entry: Vite in production mode, minified, gzip -9 over each chunk.
//
// The entry imports three and the table loader statically, as finishRig
// does, so three's own code stays in the entry chunk and each table source
// lands in the chunk its dynamic import() makes. Brotli 11 is reported
// beside gzip because most hosts serve it to browsers that ask.
//
// Run: node instruments/softbox-size/size.mjs

import { build } from 'vite'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const loader = join(repo, 'packages/react/src/primitives/surface/softboxTables.ts')
const root = mkdtempSync(join(tmpdir(), 'softbox-size-'))
const entry = join(root, 'entry.js')
writeFileSync(entry, `import * as THREE from 'three'
import { loadSoftboxTables } from ${JSON.stringify(loader)}
globalThis.keep = [THREE, loadSoftboxTables]
`)

try {
  const result = await build({
    configFile: false,
    root,
    logLevel: 'silent',
    mode: 'production',
    resolve: { dedupe: ['three'] },
    build: { write: false, minify: true, reportCompressedSize: false, modulePreload: false, rollupOptions: { input: entry } },
  })
  const chunks = (Array.isArray(result) ? result : [result]).flatMap((output) => output.output).filter((item) => item.type === 'chunk')
  const gzip = (code) => gzipSync(code, { level: 9 }).length
  const brotli = (code) => brotliCompressSync(code, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length
  for (const chunk of chunks) {
    const modules = Object.keys(chunk.modules).map((id) => id.replace(repo, '').replace(/.*node_modules\//, ''))
    const label = chunk.isEntry ? 'entry (three and the loader)' : modules.join(', ')
    console.log(JSON.stringify({ chunk: label, bytes: Buffer.byteLength(chunk.code), gzip: gzip(chunk.code), brotli: brotli(chunk.code) }))
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}
