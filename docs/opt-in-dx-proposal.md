# Opt-in payload proposal

**Status: proposed, 2026-11-21. Step 1 is built (2026-11-22); everything after it is unbuilt.**

This proposal rests on [payload-optimization-research.md](payload-optimization-research.md)
and on the builds in [the appendix](#appendix-measurement-method). Names marked
*(proposed)* are not exports.

## Summary

A React app that renders one flat `<Surface>` in a `<SurfaceCanvas>` ships
532.1 kB gzip. React is 58.7 kB of it and Munari's own code about 55 kB
([research §1.2](payload-optimization-research.md#12-munaris-own-code-size-peers-externalized)). Three.js and React Three Fiber (R3F) are the rest.

On R3F 9, no supported change brings that app much lower. The build fix in
Step 1 saves it 0.5 kB. Step 1 matters for apps that import only some helpers.
It cuts an `encodedOutput`-only app from 224.7 to 129.8 kB.

The next real saving comes with R3F 10, now in alpha. It drops Three's older
`WebGLRenderer`, which costs 79.5 kB. The estimate for the minimal Surface app
on R3F 10 is about 452 kB, a 15% cut, with no Munari-specific work beyond the
migration. For scale, `WebGPURenderer` with one material is 291.5 kB
([research §2.4](payload-optimization-research.md#24-empirical-trap-check-what-does-not-save-bytes-in-threewebgpu)).

An app can also defer the canvas. The `Surface` module alone is 278.9 kB, so
loading `SurfaceCanvas` lazily moves about 256 kB after first paint. A
browser has not checked that the page stays usable meanwhile.

This proposal adds no entry point and no bundler plugin. Payload follows what a
caller imports, and entry points only decide which names are public
([decision #6](decisions.md#6--the-binding-re-exports-the-kernel-whole-and-the-shader-string-lives-beside-the-material-2026-08-03-react-binding)).

## Where the bytes go today

Builds ran on 2026-11-21 with Vite 8.2.0, `three` 0.186.1,
`@react-three/fiber` 9.8.1 and React 19.2.8. Sizes sum every emitted
JavaScript file, minified and with `gzip -9`.

"Today" imports the staged package. "Source" imports `packages/react/src`.
"Unbundled" imports a real tsdown build with `unbundle: true`. In those two columns,
the bundler drops unreached modules, because `packages/react/package.json` declares
`"sideEffects": ["*.css"]`.

| Consumer entry | Today | Source | Unbundled |
|---|---:|---:|---:|
| React and `react-dom/client` only | 58.7 | | |
| `encodedOutput` only | 224.7 | 129.8 | 129.8 |
| The `three/tsl` functions `encodedOutput` calls, no Munari | | 129.8 | |
| `useElementCapture` in one component | 282.4 | 92.1 | |
| `createDomTextureSource` from `/advanced` | 3.5 | 3.5 | 3.4 |
| Minimal `<Surface>` in `<SurfaceCanvas>` | 532.1 | 532.1 | 531.6 |
| `<Surface>` without `<SurfaceCanvas>` | | 278.9 | |

All sizes are kB gzip. The research measured 519.6 kB for the minimal Surface
and 529.8 kB for an app importing every export, with an uncommitted script.
That gap to 532.1 kB is unexplained, so this proposal uses only its own builds.

The R3F host was measured without Munari. Each entry mounts from a React DOM
root and renders one plane through a `WebGPURenderer` factory, as
`SurfaceCanvas` does.

| R3F 9 host | No alias | R3F's `three` resolved to `three/webgpu` |
|---|---:|---:|
| `<Canvas>` | 458.2 | 404.9 |
| `createRoot`, `extend({ Mesh, Group, PlaneGeometry })` | 405.1 | 321.2 |
| `createRoot`, `extend(THREE)` from `three` | 453.5 | |
| `createRoot`, `extend(THREE)` from `three/webgpu` | 484.1 | 400.2 |

With R3F's `three` import resolved to `three/webgpu`, the minimal Surface app
is 452.6 kB from today's build and 452.3 kB unbundled. Resolving every `three`
import that way gives the same bytes. Munari's own `three` imports add nothing to
the older renderer, so switching them to `three/webgpu` would save nothing.

## Step 1: build output that follows imports

This step changes the package build and no public API.

- tsdown builds with `unbundle: true`. The trial build emitted 101 files, with
  the kernel in a nested folder. `@munari/core` stays inside the package, as
  [decision #11](decisions.md#11--the-published-package-is-staged-and-the-kernel-travels-inside-it-2026-08-03) requires.
- The staging script
  ([stage-manifest.mjs](../packages/react/scripts/stage-manifest.mjs)) scans
  `dist` recursively. Today it reads only the top folder. Its `@munari/core`
  check would miss nested files, and its `process.env.NODE_ENV` check would
  fail, because only the nested `lib/developmentRuntime.js` contains it.
- `UnsupportedRegionCaptureError` moves to its own module. Then
  `enableSnapdomCapture` can load the input-region rasterizer with a dynamic
  `import()` inside the async rasterize callback, and stay synchronous.
  [snapdom.ts:35](../packages/react/src/snapdom.ts) imports both from one
  module today, and the error is thrown at lines 168 to 184. A module imported
  both ways stays in the main bundle. The research measured the default
  `/snapdom` code at 18.5 kB, and 8.2 kB without the rasterizer
  ([research §1.2](payload-optimization-research.md#12-munaris-own-code-size-peers-externalized)). The split is built. The default `/snapdom` entry loads 96.2 kB gzip, snapDOM itself included, and the rasterizer's 9.3 kB loads on first use.
- The budget check is [instruments/payload/](../instruments/payload/run.mjs),
  run with `npm run gate:payload` after `npm run build`. It builds five small
  apps against the staged package and fails an entry that grows past its
  recorded size plus a margin. It catches a helper that starts importing
  `Surface`, a kernel import that pulls in R3F, and `/snapdom` loading the
  rasterizer eagerly. CI runs it as its own job.

Pure annotations and moving `copyFieldState` are left out. The unbundled build
reached the source column's numbers without them. The `'use client'` plugin
marked every emitted file that imports React.

To verify Step 1, run `npm run build`, the measurement script, `npm test`,
`npm run typecheck` and `npx publint packages/react/dist`. Then install the
packed package in a temporary consumer outside the repository and import each
public entry.

Pete approved the build config and staging script change, and one CI job for the
budget check, on 2026-11-22.

The built package, measured by `npm run gate:payload`, gives these sizes in kB
gzip: `encodedOutput` only 129.8, `useElementCapture` in one component 92.0,
`createDomTextureSource` from `/advanced` 3.4, `/snapdom` default 96.2, and the
minimal `<Surface>` in `<SurfaceCanvas>` 531.6. The check records exact bytes in
[budgets.json](../instruments/payload/budgets.json).

## Step 2: move to R3F 10, and keep `<Canvas>` until then

R3F 10 removes the older renderer. In `@react-three/fiber@10.0.0-alpha.6`, read
from the packed tarball, the default and `/webgpu` entries import
`three/webgpu`. Only `/legacy` refers to `WebGLRenderer`. The 452 kB estimate
comes from the alias builds above. R3F 10 itself is not measured.

The migration is its own project once R3F 10 is stable. Its default entry throws
on the `gl` prop and takes `renderer` instead, so `SurfaceCanvas` changes.
`SurfaceCanvasProps` extends R3F's `CanvasProps`
([SurfaceCanvas.tsx:77](../packages/react/src/primitives/surface/SurfaceCanvas.tsx)),
so R3F's prop changes become Munari's.

Munari should not build its own host on R3F 9's `createRoot`, for five reasons.

- It saves at most 53.1 kB, 458.2 down to 405.1. A full Munari app saves less,
  because Munari imports some of those classes itself.
- It breaks drei. drei components create lowercase elements internally, such
  as `<mesh>` and `<extrudeGeometry>` in `RoundedBox`, and the lab uses them.
  Registering the whole `three` namespace fixes that but leaves 453.5 kB.
  Registering `three/webgpu` costs 484.1 kB, more than today.
- R3F keeps one catalogue shared by every root. One `extend(THREE)` or plain
  `<Canvas>` anywhere fills it for all roots, so a missing registration could
  pass or fail depending on mount order. This follows from the code and is not
  tested.
- The [React API improvement plan](react-api-improvement-plan.md) already
  rules out "a parallel Canvas implementation", in its startup-owner
  experiment. R3F 9's `<Canvas>` uses seven helpers that R3F does not export.
- R3F 10 removes the option. Its public `createRoot` is bound to the whole
  `three/webgpu` namespace. The closest R3F 9 measurement, 400.2 kB, matches
  `<Canvas>` with the alias.

A lean catalogue on R3F 10 would need an option from R3F. Asking for one is
open question 1.

## Deferring the canvas

`Surface` without `SurfaceCanvas` bundles 278.9 kB. An entry that loads
`SurfaceCanvas` with `React.lazy` has the same static imports, so first paint
needs about 279 kB and the remaining 256.5 kB loads after. In total it ships
535.4 kB, 3.3 kB more than loading everything at once.

The README says a Surface's HTML stays native and usable without a canvas. A
browser has not confirmed that this holds while the canvas module loads.
Deferring more would mean separating Surface's page code from its scene code.
That is not measured.

**Recommendation: a README recipe, after a browser check of the lazy pattern.**

## Overlay configuration

The first review recommended an `overlay` preset. This proposal does not.

In the lab, 18 files set `pointerMode="surfaces"` and 19 lines call
`setClearAlpha(0)`. Most also pass `gl={{ alpha: true }}`. Reading the code
shows that both alpha settings match the defaults. R3F passes `alpha: true` to
the factory (`dist/events-9ce18a08.esm.js` line 1370), and SurfaceCanvas
forwards it
([SurfaceCanvas.tsx:191, :197](../packages/react/src/primitives/surface/SurfaceCanvas.tsx)).
`WebGPURenderer` with `alpha: true` clears to alpha 0 (`three`
`src/renderers/common/Renderer.js` line 465). Neither R3F nor SurfaceCanvas sets a clear color.

`setClearColor(color)` resets alpha to 1 unless it gets a second argument. All
16 calls in the lab pass one. Among overlay scenes, only Marble hand calls it,
in its stroke pass, which restores the previous alpha. The other calls are in
standalone renderers or in non-overlay passes.

Position, stacking and `frameloop` vary by scene, so a preset would bundle one
real setting with two that do nothing.

**Recommendation: no preset.** First run a pixel check with both alpha settings
removed, on a plain overlay scene and on Marble hand. Then drop them from the
recipes.

## Alternatives not pursued

| Alternative | Why not |
|---|---|
| A `createRoot` host on R3F 9 | Step 2. |
| A `@petepetrash/munari/vite` plugin aliasing `three` to `three/webgpu` | A global alias fails on drei: 55 `MISSING_EXPORT` errors importing only `RoundedBox`. |
| Documenting an alias for R3F's `three` import only | It builds, with an `IMPORT_IS_UNDEFINED` warning for `WebGLRenderer`. A plain `<Canvas>` without a `gl` factory then fails at runtime. R3F 10 makes it unnecessary. |
| A `/stage` entry with a host that skips R3F | A second implementation of Surface. The handoff lives in the R3F binding, and device-loss replacement for standalone renderers is lab code. |
| A `/kernel` entry | `/advanced` already bundles kernel-only, at 3.5 kB. |
| Making R3F an optional peer | Amends [decision #1](decisions.md#1--the-name-is-munari-and-the-hourglass-is-the-shape-2026-08-02-renamed-2026-08-04). A required peer costs install size, not bundle size. |
| Splitting `Surface.Anchor` and `Surface.LitMaterial` off `Surface` | `LitMaterial` adds no Three.js code, and detaching `Anchor` saves 4.2 kB minified ([research §2.4](payload-optimization-research.md#24-empirical-trap-check-what-does-not-save-bytes-in-threewebgpu), [phase 3](payload-optimization-research.md#phase-3--opt-in-subpaths--registration-seams)). |
| Startup calls such as `enableAnchors()` | One decision split across two files, and a forgotten call fails silently. |

## Open questions for Pete

1. Should we ask R3F's maintainers for a lean catalogue option in R3F 10, such
   as a `createRoot` that is not bound to the whole namespace? Recommendation:
   yes, while 10 is in alpha. With the alias, it saved about 84 kB on the R3F 9
   host (404.9 to 321.2), for an app that does not use drei. Sending it needs Pete's yes to the text.
2. What payload should a Surface app target? Recommendation: no fixed number.
   The budget check stops regressions, and R3F 10 sets the next floor.
3. Should the budget check run in CI? Recommendation: yes, as its own job after
   the package build.
4. Should R3F become an optional peer? Recommendation: no, until a consumer uses
   Munari without R3F.
5. Should SurfaceCanvas get an `overlay` preset? Recommendation: no, after the
   pixel check.

The capability check keeps its name, `useSurfaceSupport`, here. The React API
improvement plan proposes `useCaptureSupport`. Neither depends on the other.

## Rollout

1. Step 1. Built.
2. A browser check of the lazy canvas pattern, then the README recipe.
3. The R3F 10 migration, after a stable release, measured with the same script.

## Appendix: measurement method

`measure.mjs` builds one entry with Vite in production mode. It prints total
and entry-chunk sizes, minified and `gzip -9`, and flags strings unique to
`three`'s `WebGLRenderer` and `ShaderLib`. Its second argument picks the alias.
`none` uses none, `all` resolves every `three` import to `three/webgpu`, and
`r3f` does so only for imports from `@react-three/fiber`.

Save it as `.scratch/measure/measure.mjs` and each entry as
`.scratch/measure/entries/<name>.js`. Entries import by absolute path. Run
from the repository root:

```sh
npm run build   # stages packages/react/dist
(cd packages/react && npx tsdown --no-dts --unbundle -d ../../.scratch/measure/unbundle-dist)
node .scratch/measure/measure.mjs distSurface r3f
```

The unbundled folder needs a `package.json` with `"sideEffects": ["*.css"]`.

| Entry | What it imports and renders |
|---|---|
| `distSurface`, `srcSurface`, `ubSurface` | `SurfaceCanvas` and a `Surface` holding one `<div>` |
| `srcPageSurface` | The same `Surface`, no canvas |
| `srcLazyCanvas` | `srcSurface` with `SurfaceCanvas` behind `React.lazy` |
| `*EncodedOutput`, `tslOnly` | `encodedOutput`, or the three `three/tsl` functions it calls |
| `*ElementCapture` | One component calling `useElementCapture` |
| `*AdvancedKernel` | `createDomTextureSource` from `/advanced` |
| `r3fCanvas` | `<Canvas>` with a `WebGPURenderer` factory and one plane |
| `hostLean`, `hostThree`, `hostWebgpu` | The same plane through `createRoot`, mounted beside a React DOM root |
| `dreiRoundedBox` | `<Canvas>` with drei's `RoundedBox` |

<details>
<summary>measure.mjs</summary>

```js
import { build } from 'vite';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
const [,, name, aliasMode = 'none'] = process.argv;
const here = new URL('.', import.meta.url).pathname;
const outDir = join(here, 'out', name + '-' + aliasMode);
rmSync(outDir, { recursive: true, force: true });
const plugins = [];
if (aliasMode === 'r3f') plugins.push({ name: 'r3f-three-webgpu', enforce: 'pre', async resolveId(src, importer) {
  if (src === 'three' && importer && importer.includes('@react-three/fiber')) return this.resolve('three/webgpu', importer, { skipSelf: true });
} });
const warnings = [];
const result = await build({ configFile: false, root: here, logLevel: 'silent', mode: 'production', plugins,
  resolve: aliasMode === 'all' ? { alias: [{ find: /^three$/, replacement: 'three/webgpu' }] } : {},
  build: { outDir, minify: true, write: true, emptyOutDir: true, reportCompressedSize: false, modulePreload: false,
    rollupOptions: { input: join(here, 'entries', name + '.js'), onwarn(w) { warnings.push(w.code + ': ' + (w.message || '').slice(0, 160)); } } } });
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p); } };
walk(outDir);
const buf = Buffer.concat(files.map((f) => readFileSync(f)));
const kb = (n) => (n / 1000).toFixed(1);
const gz = files.reduce((s, f) => s + gzipSync(readFileSync(f), { level: 9 }).length, 0);
const br = files.reduce((s, f) => s + brotliCompressSync(readFileSync(f), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length, 0);
const outs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
const entryGz = outs.filter((c) => c.type === 'chunk' && c.isEntry).reduce((s, c) => s + gzipSync(c.code, { level: 9 }).length, 0);
const src = buf.toString();
console.log(JSON.stringify({ name, aliasMode, files: files.length, min: kb(buf.length), gz: kb(gz), entryGz: kb(entryGz), br: kb(br),
  hasLegacyWebGLRenderer: /WebGLRenderer: Use|THREE.WebGLRenderer: Context Lost|WebGLRenderer: A WebGL context could not be created/.test(src) || src.includes('WebGLRenderer: Context Lost'),
  hasShaderLib: src.includes('meshphysical_frag') || src.includes('ShaderLib'),
  warnings: warnings.slice(0, 6), warningCount: warnings.length }));
```

</details>
