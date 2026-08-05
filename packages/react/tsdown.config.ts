import { defineConfig } from 'tsdown'

// The publish build. Two things about it are load-bearing:
//
// 1. `@munari/core` is BUNDLED, not externalized. One public package is
//    the doctrine (decisions.md #1): a consumer installs `@petekp/munari` and
//    gets the kernel inside it. The workspace dependency exists so the
//    lab and the type-checker resolve the source; it must never survive
//    into the published manifest as something npm would try to fetch.
// 2. three, @react-three/fiber and react are EXTERNAL because they are
//    peers. three does internal `instanceof` checks, so a second copy in
//    the graph fails silently and confusingly — the consumer owns the one
//    instance, and bundling ours would manufacture the second.
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  clean: true,
  treeshake: true,
  platform: 'browser',
  target: 'es2022',
  deps: {
    alwaysBundle: ['@munari/core'],
    neverBundle: ['react', 'react-dom', 'three', '@react-three/fiber'],
  },
  // The stylesheet is public surface (`@petekp/munari/style.css`) but is not
  // reachable from the entry graph, so it is not bundled — the staging
  // script copies it, alongside the manifest that declares it.
  // The emitted package is judged separately (`npx publint packages/react/dist`
  // after staging) rather than here: tsdown's built-in hook lints THIS
  // manifest, which points at source on purpose, so it would fail on a
  // package we never publish.
})
