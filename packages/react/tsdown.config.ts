import { defineConfig } from 'tsdown'

// React hooks and context run only in client components. Next.js reads
// 'use client' per module, and a module without it that calls createContext
// fails in a server component with "createContext is not a function".
// The build emits one file per source module, so the directive goes on every
// emitted file that imports React rather than on named files. The entry that a
// server component imports and every module below it both qualify.
const REACT_SPECIFIERS = new Set(['react', 'react/jsx-runtime', 'react-dom'])
const useClientDirective = {
  name: 'munari:use-client',
  renderChunk(code: string, chunk: { imports: string[]; fileName: string }) {
    if (!chunk.fileName.endsWith('.js')) return null
    if (!chunk.imports.some(specifier => REACT_SPECIFIERS.has(specifier))) return null
    return { code: `'use client'\n${code}`, map: null }
  },
}

// The publish build. Seven things about it are load-bearing:
//
// 1. `@munari/core` is BUNDLED, not externalized. One public package is
//    the doctrine (decisions.md #1): a consumer installs `@petepetrash/munari` and
//    gets the kernel inside it. The workspace dependency exists so the
//    lab and the type-checker resolve the source; it must never survive
//    into the published manifest as something npm would try to fetch.
// 2. `./advanced` is a second entry, not a second package. It is where the
//    whole kernel and the caller-owned-renderer primitives are named, and
//    it must be built and declared everywhere the root entry is.
// 3. three, @react-three/fiber and react are EXTERNAL because they are
//    peers. three does internal `instanceof` checks, so a second copy in
//    the graph fails silently and confusingly — the consumer owns the one
//    instance, and bundling ours would manufacture the second.
// 4. The chunks that import React start with a 'use client' directive, so
//    a Next.js server component can import `Surface` directly.
// 5. `./snapdom` is the third entry, and `@zumer/snapdom` is external for a
//    different reason: it is an OPTIONAL peer. Bundling it would put a beta
//    rasterizer in the graph of every consumer, including the ones on a
//    browser that never needs a second capture engine.
// 6. `process.env.NODE_ENV` stays as written. tsdown otherwise replaces it
//    with "development" even under NODE_ENV=production (measured
//    2026-10-10, tsdown 0.22.14), which would print development warnings in
//    every consumer's production build. Left as text, the consumer's
//    bundler substitutes its own value (lib/developmentRuntime.ts).
// 7. `unbundle: true` emits one module per source module, so a consumer's
//    bundler keeps only the modules its imports reach. With each entry
//    bundled into one file, an app importing only `encodedOutput` shipped
//    224.7 kB gzip; unbundled it ships about 129.8 kB
//    (instruments/payload/, docs/opt-in-dx-proposal.md Step 1). The kernel
//    still travels inside the package (#1): `alwaysBundle` keeps it in the
//    output, now as nested modules.
export default defineConfig({
  entry: ['src/index.ts', 'src/advanced.ts', 'src/gpu.ts', 'src/snapdom.ts'],
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  clean: true,
  treeshake: true,
  unbundle: true,
  plugins: [useClientDirective],
  define: { 'process.env.NODE_ENV': 'process.env.NODE_ENV' },
  platform: 'browser',
  target: 'es2022',
  deps: {
    alwaysBundle: ['@munari/core'],
    neverBundle: ['react', 'react-dom', 'three', '@react-three/fiber', '@zumer/snapdom'],
  },
  // The stylesheet is public surface (`@petepetrash/munari/style.css`) but is not
  // reachable from the entry graph, so it is not bundled — the staging
  // script copies it, alongside the manifest that declares it.
  // The emitted package is judged separately (`npx publint packages/react/dist`
  // after staging) rather than here: tsdown's built-in hook lints THIS
  // manifest, which points at source on purpose, so it would fail on a
  // package we never publish.
})
