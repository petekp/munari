# Opt-in payload proposal

**Status: proposed, 2026-11-21. Nothing in this document is built.**

This proposal rests on [payload-optimization-research.md](payload-optimization-research.md)
and on the builds listed in [the appendix](#appendix-measurement-method). Every
name marked *(proposed)* is a proposal, not an export. Every other name exists
today.

## Summary

A React app that renders one flat `<Surface>` inside a `<SurfaceCanvas>` ships
532.1 kB gzip. React alone is 58.7 kB of that. Munari's own code is about
55 kB ([research §1.2](payload-optimization-research.md#12-munaris-own-code-size-peers-externalized)).
Three.js and React Three Fiber (R3F) make up the rest.

Three separate causes add bytes, and each has its own fix:

1. The published build bundles unrelated code together. A caller who imports
   one small helper also gets `Surface`, `three/webgpu` and R3F. One output file
   per source module fixes this without an API change. It saves nothing for an
   app that renders a Surface.
2. R3F's `<Canvas>` registers every class in `three`. A host built on R3F's
   `createRoot` that registers only the classes in use is up to 108.9 kB
   smaller. Scenes would then register their own elements, so this needs a
   spike and Pete's decision.
3. R3F 9 bundles Three's older `WebGLRenderer`, which Munari never uses. It
   costs 79.5 kB. No supported change in Munari removes it. R3F 10, now in
   alpha, drops it.

Payload should follow what a caller imports, whatever the entry point. Entry
points then only decide which names are public, as [decision #6](decisions.md#6--the-binding-re-exports-the-kernel-whole-and-the-shader-string-lives-beside-the-material-2026-08-03-react-binding)
says. This proposal adds no entry point and no bundler plugin. A caller never
chooses an app type up front, and adding an import never changes existing code.

## Where the bytes go today

These builds ran on 2026-11-21 with Vite 8.2.0, `three` 0.186.1,
`@react-three/fiber` 9.8.1 and React 19.2.8. Sizes sum every emitted JavaScript
file, minified and with `gzip -9`. The [appendix](#appendix-measurement-method)
has the script.

The "Today" column imports the staged package in `packages/react/dist`. The
"Per module" column imports `packages/react/src` directly, so the bundler sees
one file per module. Both trees declare `"sideEffects": ["*.css"]`, so the
bundler drops any module the entry does not reach. That column estimates what
Step 1 would produce; the Step 1 build itself must be measured again.

| Consumer entry | Today, min / gzip | Per module, min / gzip |
|---|---:|---:|
| React 19 and `react-dom/client` only | 189.3 / 58.7 kB | — |
| `encodedOutput` only | 761.7 / 224.7 kB | 471.5 / 129.8 kB |
| `three/tsl` functions that `encodedOutput` uses, without Munari | — | 471.5 / 129.8 kB |
| `useElementCapture` in one component | 950.9 / 282.4 kB | 297.3 / 92.1 kB |
| `createDomTextureSource` from `/advanced` | 7.9 / 3.5 kB | 7.9 / 3.5 kB |
| Minimal `<Surface>` in `<SurfaceCanvas>` | 1,919.3 / 532.1 kB | 1,919.0 / 532.1 kB |

The research measured 519.6 kB for the minimal Surface with different entry
files and no committed script. This proposal uses its own builds, plus the
research's figures for Munari's code with peers left external.

The table shows three things.

- With one file per module, `encodedOutput` costs nothing beyond the
  `three/tsl` functions it calls. An app that already uses TSL pays 0 bytes for
  it.
- `/advanced` already gives a kernel-only path. Importing a kernel function from
  it today bundles 3.5 kB and no Three.js or R3F.
- Build changes alone do not help an app that renders a Surface. That app's cost
  sits in the R3F host.

The R3F host was measured without Munari, to separate its two costs. Each entry
renders one plane through a `WebGPURenderer` factory, as `SurfaceCanvas` does
([SurfaceCanvas.tsx:197](../packages/react/src/primitives/surface/SurfaceCanvas.tsx)).

| R3F host entry | min / gzip | Contains `three`'s `WebGLRenderer` |
|---|---:|---|
| `<Canvas>` | 1,685.6 / 458.2 kB | yes |
| `createRoot` and `extend({ Mesh, Group, PlaneGeometry })` | 1,312.9 / 349.3 kB | yes |
| `<Canvas>`, R3F's `three` import resolved to `three/webgpu` | 1,444.6 / 404.9 kB | no |
| `createRoot`, R3F's `three` import resolved to `three/webgpu` | 958.3 / 265.4 kB | no |

With R3F's `three` import resolved to `three/webgpu`, the minimal Surface app
drops from 532.1 to 452.6 kB. Resolving every `three` import that way gives the
same 452.6 kB. Munari's own imports from `three` therefore add nothing to the
older renderer. Switching them to `three/webgpu` would save no bytes.

## Step 1: build output that follows imports

This step changes the package build and no public API. It makes three changes.

- tsdown emits one ESM file per source module instead of six shared chunks.
  `@munari/core` stays bundled inside the package, under an internal path, as
  [decision #11](decisions.md#11--the-published-package-is-staged-and-the-kernel-travels-inside-it-2026-08-03) requires. The staging check that no
  `@munari/core` import survives stays.
- `enableSnapdomCapture` loads the input-region rasterizer with a dynamic
  `import()` inside the asynchronous rasterize callback, where it is built today
  only when the `isolatedTextInputs` selector matches
  ([snapdom.ts:342](../packages/react/src/snapdom.ts)). The function stays
  synchronous and keeps returning `void`. The default `/snapdom` code drops from
  18.5 to 8.2 kB gzip
  ([research §1.2](payload-optimization-research.md#12-munaris-own-code-size-peers-externalized)).
- The measurement script is committed under `instruments/payload/`
  *(proposed)*. A budget check fails when one entry grows past its recorded size
  plus a stated margin. It catches a helper that starts importing `Surface`, a
  kernel import that starts pulling in R3F, and the snapDOM entry loading the
  input rasterizer eagerly.

Step 1 leaves three things out.

- Pure annotations on `Object.assign` in
  [Surface.tsx](../packages/react/src/primitives/Surface.tsx) and on
  `createContext`. The bundler drops unused modules whole, which is how the
  per-module column got its numbers. Add one only where the budget check shows
  a cost.
- Moving `copyFieldState` out of
  [elementCapture.tsx](../packages/react/src/primitives/elementCapture.tsx).
  Today `Surface` reaches `elementCapture` through
  [surfacePageSnapshot.ts:9](../packages/react/src/primitives/surface/surfacePageSnapshot.ts).
  `useElementCapture` does not reach `Surface`. Move it only if the budget
  check shows a cost.
- Switching Munari's imports from `three` to `three/webgpu`. The measurement
  above shows that it saves nothing.

To verify Step 1, run `npm run build`, the measurement script, `npm test`,
`npm run typecheck` and `npx publint packages/react/dist`. Then install the
packed package in a temporary consumer outside the repository. Check that every
public entry resolves and that each output file importing React still starts
with `'use client'`. Check that `process.env.NODE_ENV` stays unreplaced
([tsdown.config.ts](../packages/react/tsdown.config.ts), points 4 and 6).

The build config and staging script are package tooling, so this step needs
Pete's approval for that change. Whether the budget check runs in CI is a
separate approval.

## Step 2: a SurfaceCanvas without R3F's full catalogue

This step changes the public contract. It needs a spike before a decision.

R3F's `<Canvas>` runs `extend(THREE)` with `import * as THREE from 'three'`
(`@react-three/fiber` 9.8.1, `dist/react-three-fiber.esm.js` lines 4 and 40).
The bundler then keeps every Three.js class, and `<Canvas>` cannot skip it.
R3F's `createRoot` starts with an empty catalogue, which saves 108.9 kB on the
R3F host alone. Munari imports some of those classes itself, so a full app
saves less. The spike must measure it.

Without it, a scene registers each element it uses. In R3F 9, `extend(Class)`
returns a typed component.

```tsx
import { extend } from '@react-three/fiber'
import { AmbientLight } from 'three/webgpu'

const Light = extend(AmbientLight)

export function Lighting() {
  return <Light intensity={0.4} />
}
```

A scene that wants every lowercase element writes `extend(THREE)` once, with
`THREE` imported from `three/webgpu`.

There are three options.

- In option A, SurfaceCanvas registers only Munari's own elements, and scenes
  register theirs with `extend`. This saves the most. R3F declares every
  lowercase element globally, so an unregistered `<ambientLight>` compiles and
  then throws on mount. Munari would add a development message naming the
  missing class. In this repo, 41 `.tsx` files use lowercase elements.
- In option B, SurfaceCanvas keeps the full catalogue, and a second host
  component *(proposed, unnamed)* skips it. Two components then do one job, and
  moving to the smaller one still means registering every element.
- In option C, nothing changes and nothing is saved.

A `catalogue` prop on SurfaceCanvas is not an option. R3F keeps one catalogue
per module, shared by every root, so a prop on one canvas would register classes
for all of them. The prop would suggest a locality it does not have.

Building on `createRoot` moves work into Munari. `<Canvas>` handles resizing,
the event source, the error boundary and the bridge that carries React context
into the scene. R3F does not export its bridge hook, so Munari would depend on
`its-fine`, the library R3F uses for it, directly. The
[React API improvement plan](react-api-improvement-plan.md) changes the same
context transport.

**Recommendation: spike option A, then decide.** The spike builds the host on
`createRoot` in a branch. It passes when it measures the full minimal-Surface
app and the lab, and when `probe:api-lifecycle`, `probe:api-composition-check`
and `gate:native-pointer` pass with `STRICT_CAPABILITY=1` and on the no-flag
native path. The spike settles the real saving and the size of the host code.

## Step 3: the older WebGLRenderer comes from R3F 9

R3F 9.8.1 falls back to `new THREE.WebGLRenderer(...)` when `gl` is not a
function (`dist/events-9ce18a08.esm.js` line 1374). `SurfaceCanvas` always
passes a factory, but the bundler keeps the class and its GLSL shader library.
That costs 79.5 kB on the minimal Surface app.

There are three options.

- Munari can wait for R3F 10. In `@react-three/fiber@10.0.0-alpha.6`, the default and
  `/webgpu` entries import `three/webgpu`, and only `/legacy` refers to
  `WebGLRenderer`. This was read from the packed tarball; its payload is not
  measured. Its peer range admits the repo's React and `three`. Moving to R3F 10
  is its own project once a stable release exists.
- The docs can describe an app-level alias that resolves only R3F's `three`
  import to `three/webgpu`. It builds: a drei `RoundedBox` app built cleanly with it.
  But it breaks at runtime any plain R3F `<Canvas>` without a `gl` factory,
  because `WebGLRenderer` becomes `undefined`. Each bundler needs its own
  importer-scoped config, and R3F does not support the setup.
- Munari can ship a global alias from `three` to `three/webgpu`. This is
  rejected. `three/webgpu` lacks seven exports that drei and three-stdlib
  import, and an app importing only drei's `RoundedBox` failed with 55
  `MISSING_EXPORT` errors.

**Recommendation: no change in Munari. Track R3F 10 and measure it at its first
stable release.**

## Overlay configuration

The review of the earlier proposal recommended an `overlay` preset. This
proposal does not.

In the lab, 18 files set `pointerMode="surfaces"` and 19 lines call
`setClearAlpha(0)`. Most also pass `gl={{ alpha: true }}`. Reading the code shows
that both alpha settings already match the defaults.

- R3F passes `alpha: true` to the renderer factory
  (`@react-three/fiber` 9.8.1, `dist/events-9ce18a08.esm.js` line 1370),
  and SurfaceCanvas forwards it
  ([SurfaceCanvas.tsx:191, :197](../packages/react/src/primitives/surface/SurfaceCanvas.tsx)).
- A `WebGPURenderer` with `alpha: true` clears to alpha 0
  (`three` 0.186.1, `src/renderers/common/Renderer.js` line 465).
- Neither R3F nor SurfaceCanvas sets a clear color.

Position, stacking and `frameloop` differ from scene to scene. A preset would
therefore bundle one real setting, `pointerMode`, with two settings that do
nothing. Work package 8 of the [React API improvement plan](react-api-improvement-plan.md)
reaches the same conclusion from the lab's recipes.

**Recommendation: no preset.** The code reading is unverified in a browser. A
pixel check on one overlay scene with both alpha settings removed should come
first. Then the recipes drop them.

## Alternatives not pursued

| Alternative | Why not |
|---|---|
| A `@petepetrash/munari/vite` plugin that aliases `three` to `three/webgpu` | The global alias breaks drei and three-stdlib builds (Step 3). A narrower alias belongs to the app, not the package. |
| A `/stage` entry with a React host that skips R3F | A second implementation of Surface. The page-to-scene handoff lives in the R3F binding, and device-loss replacement for standalone renderers is lab code ([decision #73](decisions.md#73--surfacecanvas-replaces-a-lost-renderer-2026-10-08-react-binding--instruments)). |
| A `/kernel` entry | `/advanced` already bundles kernel-only for kernel imports (3.5 kB). The functions the earlier proposal listed for it (`createSurfaceCoordinator`, `relocatePreservingState`) do not exist, `chooseCaptureMemory` is private, and the `moveBefore` logic is in `packages/react/src/primitives/retainedMove.ts`. |
| Making R3F an optional peer | It would amend [decision #1](decisions.md#1--the-name-is-munari-and-the-hourglass-is-the-shape-2026-08-02-renamed-2026-08-04). A required peer costs disk space at install, not bundle size, and the lab, the only consumer, uses R3F. Open question 4. |
| Splitting `Surface.Anchor` and `Surface.LitMaterial` off `Surface` | `LitMaterial` adds no Three.js code, because `WebGPURenderer` already registers `MeshStandardNodeMaterial` ([research §2.4](payload-optimization-research.md#24-empirical-trap-check-what-does-not-save-bytes-in-threewebgpu)). Detaching `Anchor` saves 4.2 kB minified ([research §4, phase 3](payload-optimization-research.md#phase-3--opt-in-subpaths--registration-seams)). Neither justifies a public API change. |
| Startup registration calls such as `enableAnchors()` | They split one decision between a component and a startup file, and a forgotten call fails silently. |

## Open questions for Pete

1. Should SurfaceCanvas drop R3F's full catalogue in Step 2? Recommendation:
   approve the spike of option A. Decide between A, B and C on its measured
   saving and host code size.
2. Should the budget check run in CI? Recommendation: yes, as its own job
   after the package build, once Step 1 lands. This changes CI membership.
3. Should the docs describe the app-level R3F alias from Step 3?
   Recommendation: no. It breaks plain R3F canvases at runtime, and R3F 10 makes
   it unnecessary.
4. Should R3F become an optional peer? Recommendation: no, until a consumer
   uses Munari without R3F.
5. Should SurfaceCanvas get an `overlay` preset? Recommendation: no. Run
   the pixel check, then remove the two no-op alpha settings from the recipes.

The capability check keeps its current name, `useSurfaceSupport`, in this
document. The [React API improvement plan](react-api-improvement-plan.md)
proposes renaming it `useCaptureSupport`; neither proposal depends on the other.

## Rollout

1. Step 1, with the measurement script and budget check. Needs approval for the
   package tooling change.
2. The Step 2 spike, in a branch, measured and probed as described. Then Pete's
   decision on open question 1.
3. Step 3 waits on a stable R3F 10.
4. If Step 2 lands, the README, `docs/authoring.md` and the Munari skill
   explain how to register Three.js elements.

## Appendix: measurement method

`measure.mjs` builds one entry file with Vite in production mode and sums every
emitted `.js` file. It prints minified, `gzip -9` and Brotli quality 11 sizes,
and flags strings that exist only in `three`'s `WebGLRenderer` and
`ShaderLib`. Its second argument picks the alias. `none` uses none. `all`
resolves every `three` import to `three/webgpu`. `r3f` does that only for
imports from `@react-three/fiber`.

Save it as `.scratch/measure/measure.mjs`, write each entry as
`.scratch/measure/entries/<name>.js`, and run from the repository root:

```sh
npm run build   # stages packages/react/dist
node .scratch/measure/measure.mjs distSurface none
node .scratch/measure/measure.mjs distSurface r3f
node .scratch/measure/measure.mjs dreiRoundedBox all   # fails: 55 MISSING_EXPORT
```

| Entry | What it imports and renders |
|---|---|
| `react` | A `<div>` through `react-dom/client` |
| `distSurface`, `srcSurface` | `SurfaceCanvas` and a `Surface` holding one `<div>` |
| `distEncodedOutput`, `srcEncodedOutput` | `encodedOutput`, assigned to `window` |
| `tslOnly` | `sRGBTransferEOTF`, `sRGBTransferOETF` and `vec4` from `three/tsl` |
| `distElementCapture`, `srcElementCapture` | One component that calls `useElementCapture` |
| `distAdvancedKernel`, `srcAdvancedKernel` | `createDomTextureSource` from `/advanced` |
| `r3fCanvas` | `<Canvas>` with a `WebGPURenderer` factory, one mesh and plane |
| `r3fCreateRoot` | The same scene through `createRoot` and `extend({ Mesh, Group, PlaneGeometry })` |
| `dreiRoundedBox` | `<Canvas>` with drei's `RoundedBox` |

`dist` entries import by absolute path from `packages/react/dist`, and `src`
entries from `packages/react/src`. Step 1 commits this script under
`instruments/payload/`.

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
await build({ configFile: false, root: here, logLevel: 'silent', mode: 'production', plugins,
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
const src = buf.toString();
console.log(JSON.stringify({ name, aliasMode, files: files.length, min: kb(buf.length), gz: kb(gz), br: kb(br),
  hasLegacyWebGLRenderer: /WebGLRenderer: Use|THREE.WebGLRenderer: Context Lost|WebGLRenderer: A WebGL context could not be created/.test(src) || src.includes('WebGLRenderer: Context Lost'),
  hasShaderLib: src.includes('meshphysical_frag') || src.includes('ShaderLib'),
  warnings: warnings.slice(0, 6), warningCount: warnings.length }));
```

</details>
