# Opt-in payload architecture research

> **Status: Measured research and proposed architecture (unbuilt except [Step 1](opt-in-dx-proposal.md#step-1-build-output-that-follows-imports)).** Measured 2026-11-21 on `stewardship/full` against `@petepetrash/munari@0.4.1`, `three@0.186.1`, `@react-three/fiber@9.8.1`, `@zumer/snapdom@3.3.3`, `react@19`, and Vite 8 (Rolldown, `NODE_ENV="production"`, `minify: true`, `gzip -9`, `brotli -q 11`). None of the proposed package subpaths or build changes below are implemented yet. Their scripts are not committed; [the opt-in proposal](opt-in-dx-proposal.md#appendix-measurement-method) re-measures the figures it uses.

A minimal flat unlit `<Surface>` inside `<SurfaceCanvas>` currently ships **`1,874.5 kB` min / `519.6 kB` gzip / `399.4 kB` brotli** (`+462.3 kB` gzip over React 19) — **97.8%** of the payload of an app importing every capability in `@petepetrash/munari` (`529.8 kB` gzip). Adding static `@petepetrash/munari/snapdom` brings total payload to **`2,177.5 kB` min / `617.7 kB` gzip**.

Munari's own code is small: `@munari/core` is **`39.2 kB` min / `14.6 kB` gzip**, and the entire `@petepetrash/munari` binding (kernel included) is **`153.3 kB` min / `54.6 kB` gzip**. Nearly **90%** of a consumer's bundle comes from how the published chunks and peer bindings pull in duplicate or unused parts of `three`, `three/webgpu`, and `@react-three/fiber`, plus top-level expressions inside `packages/react/dist/index.js` that defeat dead-code elimination.

---

## 1. Measured payload baseline

All full-app measurements run Vite 8 / Rolldown in production mode against the staged package (`packages/react/dist`, built by `npm run build`; `"sideEffects": ["*.css"]` in [stage-manifest.mjs](../packages/react/scripts/stage-manifest.mjs)). "Net gzip" subtracts the `57.3 kB` gzip React 19 + `react-dom/client` baseline.

### 1.1 End-to-end consumer bundles today

| Consumer bundle | Minified | Gzip | Brotli | Net gzip | What enters the graph |
|---|---:|---:|---:|---:|---|
| React 19 + `react-dom/client` baseline | `184.8 kB` | `57.3 kB` | `49.5 kB` | `0.0 kB` | React runtime only |
| `useCaptureSupport()` gate only | `193.4 kB` | `60.8 kB` | `52.6 kB` | `+3.5 kB` | `SurfaceCanvas-*.js` + `src-*.js` (Three & R3F tree-shake out) |
| `encodedOutput` (6-line TSL helper) only | `765.3 kB` | `226.3 kB` | `180.4 kB` | `+169.0 kB` | Evaluates `dist/index.js` -> drags `Surface`, `three/webgpu`, `three/tsl` |
| `useElementCapture` + `useCaptureFrame` only | `929.1 kB` | `275.9 kB` | `214.5 kB` | `+218.6 kB` | Evaluates `dist/index.js` + `three` (`CanvasTexture`) + R3F (`useThree`) |
| Minimal flat unlit `<Surface>` + `<SurfaceCanvas>` | `1,874.5 kB` | `519.6 kB` | `399.4 kB` | `+462.3 kB` | `three/webgpu` + legacy `three` (`WebGLRenderer`) + R3F `<Canvas>` + all `Surface.*` |
| Kitchen-sink (all 37 root exports) | `1,904.5 kB` | `529.8 kB` | `407.9 kB` | `+472.5 kB` | Adds `FocusScene`, `Dial`, `deform`, `elementCapture` (`+10.2 kB` gz over minimal) |
| Minimal `<Surface>` + static `/snapdom` | `2,177.5 kB` | `617.7 kB` | `479.4 kB` | `+560.4 kB` | Adds `dist/snapdom.js` (`18.5 kB` gz) + `@zumer/snapdom` (`~79.6 kB` gz) |

### 1.2 Munari's own code size (peers externalized)

Marking `react`, `react-dom`, `three`, `@react-three/fiber`, and `@zumer/snapdom` external compares what `dist/` retains today against each module's true source footprint:

| Target | From `dist/` today (min / gz) | Isolated `src/` (min / gz) | Diagnosis |
|---|---:|---:|---|
| `@munari/core` (entire kernel) | — | `39.2 kB` / `14.6 kB` | Zero runtime dependencies ([decisions.md #1](decisions.md#1)) |
| `@petepetrash/munari` (all 37 exports) | `153.3 kB` / `54.6 kB` | `153.3 kB` / `54.6 kB` | Full React/Three binding + bundled kernel |
| `encodedOutput` (`lib/surfaceOutput.ts`) | `109.4 kB` / `39.6 kB` | `0.2 kB` / `0.2 kB` | **508x bloat** from `dist/index.js` top-level `Object.assign` |
| `FocusScene` + `FocusGroup` + `Dial` | `127.9 kB` / `46.1 kB` | `22.2 kB` / `8.7 kB` | **5.3x bloat** from `dist/index.js` chunk sharing |
| `useElementCapture` + `useCaptureFrame` | `115.0 kB` / `41.3 kB` | `~21.0 kB` / `~8.1 kB` | **5.1x bloat** from `dist/index.js` + `Surface.tsx` cross-import |
| `SurfaceCanvas` / `SurfaceRoot` / `SurfaceMesh` | — | `16.6` / `26.0` / `52.0 kB` min | `6.5` / `9.9` / `19.3 kB` gz respectively |
| `@petepetrash/munari/snapdom` | `52.7 kB` / `18.5 kB` | `20.9 kB` / `8.2 kB` (base) | `33.0 kB` min / `10.3 kB` gz (`61%`) is opt-in `isolatedTextInputs` |

---

## 2. Four root causes of payload bloat

### 2.1 Flattened `tsdown` chunks + unannotated `Object.assign` defeat tree-shaking
[packages/react/tsdown.config.ts](../packages/react/tsdown.config.ts) flattens 75+ modules into 6 coarse chunks (`dist/index.js` `201.4 kB`, `dist/SurfaceCanvas-*.js` `131.4 kB`, `dist/src-*.js` `80.7 kB`). Inside [Surface.tsx](../packages/react/src/primitives/Surface.tsx), both `Surface` and `SceneSurface` mutate functions at module evaluation time without `/* @__PURE__ */`:

```ts
export const Surface = Object.assign(BasicSurface, {
  Root: SurfaceRoot, HTML: SurfaceHTML, Scene: SurfaceScene,
  Mesh: SurfaceMesh, Anchor: SurfaceAnchor, LitMaterial: SurfaceLitMaterial,
})
```

Importing *any* symbol from `dist/index.js` — even `encodedOutput` ([Lamp.tsx](../apps/lab/src/scenes/lamp/Lamp.tsx), [Rain.tsx](../apps/lab/src/scenes/rain/Rain.tsx)) or `useElementCapture` ([Veil.tsx](../apps/lab/src/scenes/veil/Veil.tsx), [Selection.tsx](../apps/lab/src/scenes/selection/Selection.tsx)) — evaluates unannotated `Object.assign`, 13 `createContext(...)` calls, and 15 module-scope `new THREE.*()` scratch allocations (`SurfaceMesh.tsx`, `SurfaceAnchor.tsx`, `FocusScene.tsx`, `matchDom.ts`), pinning `Surface`, `SceneSurface`, `SurfaceMesh`, `SurfaceLitMaterial`, `SurfaceAnchor`, `forwardEvents`, `three/webgpu`, and `three/tsl`.

### 2.2 Shipping TWO Three.js renderers and TWO shader stacks (`+77.6 kB` gzip)
`SurfaceCanvas` renders through `WebGPURenderer` from `three/webgpu` ([decisions.md #69](decisions.md#69)), which already contains both `WebGPUBackend` (WGSL) and `WebGLBackend` (GLSL WebGL 2 fallback). However, `@react-three/fiber` imports `from 'three'` (`three/build/three.module.js`), adding the **entire unused legacy `THREE.WebGLRenderer` and GLSL `ShaderLib`** (`89.4 kB` gz in `@munari/lab`'s build) beside `three.core.js` (`100.7 kB` gz) and `three.tsl.js` (`192.9 kB` gz).

Measured in Rolldown: aliasing bare `three` -> `three/webgpu` drops minimal `<Surface>` from `1,874.5 kB` min / `519.6 kB` gz to **`1,543.5 kB` min / `442.0 kB` gz (`-331.0 kB` min / `-77.6 kB` gz / `-55.2 kB` brotli)** with zero Munari source changes.

The whole saving comes from R3F's own `three` import: an alias applied only to imports from `@react-three/fiber` gives the same bytes. A global alias breaks drei and three-stdlib builds, because `three/webgpu` lacks `ShaderChunk`, `ShaderLib`, `UniformsLib`, `UniformsUtils`, `WebGLCubeRenderTarget`, `WebGLRenderer` and `WebGLUtils`. The R3F-only alias leaves R3F's fallback `WebGLRenderer` undefined, so a plain `<Canvas>` without a `gl` factory fails at runtime.

### 2.3 R3F `<Canvas>` wildcard `extend(THREE)` (`+84.7 kB` gzip) + `react-reconciler` (`+51.2 kB` gzip)
`@react-three/fiber`'s `<Canvas>` executes `import * as THREE from 'three'; extend(THREE)`, preventing bundlers from tree-shaking any class in `three` (`SkinnedMesh`, `AudioListener`, `AnimationMixer`, `ExtrudeGeometry`, helpers, loaders).

R3F's `createRoot` with a targeted `extend({ Group, Mesh, PlaneGeometry })` measured **`357.3 kB` gz**, but only with R3F's `three` resolved to `three/webgpu`, which is unsafe (§2.2). Without the alias, the [opt-in proposal](opt-in-dx-proposal.md)'s host builds measured `405.1 kB` gz against `458.2 kB` for `<Canvas>`. The targeted catalogue also breaks drei, whose components create lowercase elements.

### 2.4 Empirical trap check: what does *not* save bytes in `three/webgpu`
1. **Splitting `Surface.LitMaterial` (`MeshStandardNodeMaterial`) or `ShadowNode` saves `0.0 kB` of Three.js on standard `three/webgpu`:** `WebGPURenderer` + `MeshBasicNodeMaterial` measures **`1,054.5 kB` min / `291.5 kB` gz**; adding `MeshStandardNodeMaterial` + `ShadowNode` measures **`1,054.5 kB` min / `291.5 kB` gz (`+0.0 kB`)**, because `WebGPURenderer` instantiates `new StandardNodeLibrary()`, registering all 13 node materials (`Physical`, `Standard`, `Toon`, `Phong`, `Shadow`, etc.).
2. **Library-side `three/src/renderers/webgpu/WebGPURenderer.nodes.js` is unsafe:** `three/package.json#exports` does not expose `./build/three.webgpu.nodes.js`, and importing `three/src/*` inside Munari while a consumer imports `three/webgpu` (`three/build/*`) creates **two `Object3D`/`NodeMaterial` class hierarchies**, breaking `instanceof` ([decisions.md #1](decisions.md#1)) and inflating bundles to `1,395.5 kB` min.

---

## 3. Effect classes across `apps/lab` vs required machinery

Auditing all 28 routes and 7 candidate studies in [ALL-DEMO-API.md](../ALL-DEMO-API.md) separates workloads into six runtime classes:

| Class | Scenes (`apps/lab/src/scenes/*`) | Required machinery | Dead weight bundled today |
|---|---|---|---|
| **0. Standalone Three / pure DOM** | `home`, `style`, `why`, `wordmark`, `lamp`, `rain` | `useCaptureSupport` (`+3.5 kB` gz) or `encodedOutput` (`0.2 kB` gz) | `lamp` & `rain` pull `109.4 kB` min (`39.6 kB` gz) of Munari just for `encodedOutput` |
| **1A. Imperative capture + raw Three** | `light` (`createDomTextureSource` + `CanvasTexture` on raw `WebGPURenderer`) | `@munari/core` capture (`3.6 kB` gz) + `encodedOutput` + `three/webgpu` | Pulls `109.4 kB` min of `Surface` + R3F bindings via root `encodedOutput` |
| **1B. In-place DOM + shader overlay** | `veil`, `selection`, `distortion-wave`, `plume`, `marble-hand` | `useElementCapture` / `CaptureContent` + `useCaptureFrame` + 1-quad stage | Pays for `Surface`, `SceneSurface`, `SurfaceMesh`, `forwardEvents`, `Anchor`, `LitMaterial`, R3F `react-reconciler`, wildcard `THREE` |
| **2. Scene-only HTML & compositors** | `explode`, `glass`, `crystal`, `candidates/unroll`, `copy` | `SceneSurface.Root/HTML/Mesh`, `SurfaceCanvas`, `forwardEvents`, `passMaterial` | Pays for page-handoff rig (`Surface.HTML`, `surfacePageClip`, `surfaceHostSpace`, `retainedMove`, `pageTarget`), `Anchor`, `LitMaterial` |
| **3. Planar page-to-scene handoffs** | `flight`, `logo`, `refraction`, `gallery`, `gravity`, `dissolve`, `analyze`, `delete` | `Surface.Root/HTML/Scene/Mesh`, `crossing`, `surfacePass`, `retainedMove`, `forwardEvents` | Pays for `Anchor` (3/28 scenes), `LitMaterial` (2/28), `surfaceNativeRoute` + 3D homography (**0/28** scenes use `pointerRoute="auto"`), wildcard `THREE` |
| **4. Deformed interactive surfaces** | `genie`, `postcard`, `fisheye`, `slider`, `optics`, `ripple`, `billow` | Class 3 + `deformSurfaceGeometry`, `FrameSurface` (`genie`) | Deformed meshes are ineligible by law for `surfaceNativeRoute` ([decisions.md #39](decisions.md#39)), yet bundle it |
| **5. Anchors, PBR & spatial focus** | `controls` (`Anchor`), `knobs` (`LitMaterial` + `Anchor`), `workspace` (`FocusScene` + `Dial`) | Adds `SurfaceAnchor`, `SurfaceLitMaterial`, `FocusScene` + `Dial` (`workspace` — **1/28**) | Pays `+162 kB` gz for duplicate `WebGLRenderer` + wildcard `extend(THREE)` |

---

## 4. Proposed opt-in roadmap (four progressive phases)

All four phases preserve [decisions.md #1](decisions.md#1) (one published package `@petepetrash/munari`, `@munari/core` bundled inside, Three-first) and extend the registration-seam pattern proven by `@petepetrash/munari/snapdom` ([decisions.md #60](decisions.md#60)).

### Phase 1 — Zero-breaking-change build & chunk fixes
1. **Unbundled ESM output in `tsdown` + pure annotations:**
   - Per-module ESM output is built ([proposal Step 1](opt-in-dx-proposal.md#step-1-build-output-that-follows-imports)). Pure annotations on `Object.assign` and `createContext`, and lazy `new THREE.*()` scratch vectors, stay proposed.
   - Extract the 18-line `copyFieldState` / `applyCopyScrolls` helpers out of [elementCapture.tsx](../packages/react/src/primitives/elementCapture.tsx) so `Surface` and `elementCapture` sever their cross-import.
   - **Gain:** `encodedOutput` drops from `39.6 kB` gz -> **`0.2 kB` gz** of Munari code (peers external). In a whole app it then costs exactly the `three/tsl` functions it calls; `FocusScene` + `Dial` (`8.7 kB` gz) stop bundling for the 27/28 scenes that omit them.
2. **Dynamic `import()` for `isolatedTextInputs` in `@petepetrash/munari/snapdom`:**
   - [snapdom.ts](../packages/react/src/snapdom.ts) statically imports `createInputRegionRasterizer` (`33.0 kB` min / `10.3 kB` gz — `61%` of `dist/snapdom.js`) even though it only runs when `options.isolatedTextInputs` is passed ([decisions.md #62](decisions.md#62)). Lazy-loading it cuts default `dist/snapdom.js` from `18.5 kB` gz -> **`8.2 kB` gz**.
3. **Bundler alias (`three -> three/webgpu`): not safe to ship.**
   - A global alias removes `three.module.js`'s duplicate `WebGLRenderer` + GLSL `ShaderLib` (**`-331.0 kB` min / `-77.6 kB` gz**) but breaks drei and three-stdlib builds, and an R3F-only alias breaks a plain `<Canvas>` at runtime (§2.2).

### Phase 2 — Tree-shaken R3F host (not recommended)
- Build `SurfaceCanvas` (or `<SurfaceCanvasLite>`) in [SurfaceCanvas.tsx](../packages/react/src/primitives/surface/SurfaceCanvas.tsx) on R3F's `createRoot` + `FiberProvider` + `extend({ Group, Mesh, PlaneGeometry })` instead of `<Canvas>` (`extend(THREE)`).
- **Measured result:** `519.6 kB` to `357.3 kB` gz with the unsafe alias. Without it the host saves about `53 kB` (§2.3).

### Phase 3 — Opt-in subpaths & registration seams
1. **`@petepetrash/munari/capture` (`@react-three/fiber` optional peer):**
   - [capture.tsx](../packages/react/src/primitives/capture.tsx) imports `useThree` only for 8-line `useCaptureFrame`, and [elementCapture.tsx](../packages/react/src/primitives/elementCapture.tsx) imports R3F's `context` only for a dev warning. Splitting `useCaptureFrame` makes `useElementCapture`, `CaptureContent`, `useCaptureHandle`, and `useCaptureStatus` R3F-free so `@react-three/fiber` could become an optional peer in `peerDependenciesMeta`.
2. **Optional `<SurfaceAnchor>`, `enableNativePointerRoute()`, and `/focus`:**
   - Detach `Anchor` and `LitMaterial` from `Surface` `Object.assign` (or expose a slim `<SurfaceRoot>`/`<SurfaceMesh>` subpath), hooking anchor collection into `SurfaceMesh` only when `<SurfaceAnchor>` mounts (`-4.2 kB` min).
   - Register 3D homography native routing (`surfaceNativeRoute.ts` + `surfacePose.ts`, `8.4 kB` min / `3.4 kB` gz, used by 0/28 scenes) via `enableNativePointerRoute()`, preserving the `~2.1 kB` min flat caret rig ([decisions.md #63](decisions.md#63)) on `Surface.HTML`.

### Phase 4 — Non-R3F stage (`@petepetrash/munari/stage`) & kernel quad escape hatch
Five `apps/lab` scenes (`Light`, `Lamp`, `Rain`, the `Marble hand` background, the `Gravity` fallback) run their own `WebGPURenderer` outside `SurfaceCanvas` for one or two quads, and the `Wordmark` component runs a classic `WebGLRenderer` from `three`:
1. **`@petepetrash/munari/stage` (React + `three/webgpu`, zero R3F):** Wraps `WebGPURenderer` + `DirectRenderPipeline` (`NoToneMapping`, premultiplied sRGB, device-loss replacement, demand sleep — [decisions.md #69, #72, #73](decisions.md#69)). Measured total app: **`1,094.2 kB` min / `306.1 kB` gz (`-213.5 kB` gz / `-41%`)**. It lacks the page-to-scene handoff and device-loss replacement, so a real stage would be larger.
2. **Classic `three` `WebGLRenderer` + `/advanced` `createDomTextureSource`:** Because Munari captures via parked 2D `drawElementImage` rather than `texElementImage2D` ([platform.md #14–#15](platform/texture-upload.md#item-14)), `source.canvas` feeds `THREE.WebGLRenderer` + `ShaderMaterial` directly for GLSL-only quads. Measured total app: **`736.3 kB` min / `197.8 kB` gz (`-321.8 kB` gz / `-62%`)**.
3. **Zero-Three single-quad shader transitions over `/advanced` + `registry/` recipe:** Pure 2D/shader transitions (`DistortionWave`, `Veil`, `Selection`, `Rain`) consuming `createDomTextureSource` from `/advanced` with a ~4 kB copyable `registry/` WebGL 2 / WebGPU quad runner keep `@petepetrash/munari` free of non-Three renderer abstractions ([decisions.md #1](decisions.md#1)) at an estimated **`~235 kB` min / `~75 kB` gz (`+18 kB` gz over React)**. The estimate was not built. Importing a kernel function from `/advanced` already bundles kernel-only (3.5 kB gz). `relocatePreservingState` and `createSurfaceCoordinator` do not exist, and the `moveBefore` logic is in `packages/react/src/primitives/retainedMove.ts`, outside `@munari/core`.

---

## 5. Summary: effect classes mapped to target payload tiers

| Tier | Target effect classes | Entry / configuration | Total app gzip (min) | Net gzip | vs today (`519.6 kB` gz) |
|---|---|---|---:|---:|---:|
| **Tier 0: Probe / TSL util** | `useCaptureSupport`, `encodedOutput` in existing Three app | `@petepetrash/munari` (Phase 1) | `60.8 kB` (`193 kB`) probe; `129.8 kB` (`472 kB`) `encodedOutput`, all of it `three/tsl` | `+3.5 kB` probe | `-88%` probe; `encodedOutput` `224.7` -> `129.8 kB` gz |
| **Tier 1A: Kernel + raw quad** | Single-quad DOM transitions & lenses (`DistortionWave`, `Veil`, `Rain`) | `/advanced` + `registry/` WebGL2/WebGPU quad | `~75 kB` (`~235 kB`), estimated | `+18 kB` | **`-86%` total / `-96%` net** |
| **Tier 1B: Classic WebGL Three** | Unlit GLSL quads/planes (`Light` backdrop, flat tilted cards) | `/advanced` `createDomTextureSource` + `three` `WebGLRenderer` | `197.8 kB` (`736 kB`) | `+140.5 kB` | **`-62%` (`-321.8 kB` gz)** |
| **Tier 2: `/stage` (no R3F)** | TSL overlays, `useElementCapture`, single `<Surface>` without JSX scene | `/stage` + `/capture` (`three/webgpu`, R3F optional) | `306.1 kB` (`1,094 kB`) | `+248.8 kB` | **`-41%` (`-213.5 kB` gz)** |
| **Tier 3: `<SurfaceCanvasLite>`** | Multi-surface 3D scenes (`Flight`, `Genie`, `Postcard`, `Fisheye`, `Glass`) | `.` with R3F `createRoot` + `three -> three/webgpu` | `357.3 kB`, with the alias | `+300.0 kB` | `-31%` with the alias; about `-10%` without it (§2.3) |
| **Tier 4: Full R3F + Safari** | Full `THREE.*` JSX + `FocusScene` + `Dial` + dynamic `/snapdom` | `.` + `/focus` + dynamic `import('.../snapdom')` | `366 kB` Chrome / `454 kB` Safari, with the alias | `+309` / `+397 kB` | Unverified |

---

## 6. Load-bearing invariants that must stay non-optional

Four small mechanisms (`<5 kB` min combined) look optional on a call graph yet enforce core correctness laws and must remain in every handoff tier:

1. **Pass write-mask & primitive verification ([surfacePass.ts](../packages/react/src/primitives/surface/surfacePass.ts), `~1.8 kB` min):** Stops `Surface.Mesh` from hiding page DOM during warm-up, VSM shadow, or empty/uncompiled WebGPU passes ([decisions.md #25, #70](decisions.md#25)).
2. **Backing-store hysteresis (`storeForBox` in [textureStorage.ts](../packages/core/src/paint/textureStorage.ts), `~1.0 kB` min):** Prevents `canvas.width` clearing (`38/40` blank resize frames, [platform.md #12](platform/capture.md#item-12)).
3. **Software-GPU storage check (`chooseCaptureMemory` in [domTextureSource.ts](../packages/core/src/paint/domTextureSource.ts), `~0.9 kB` min):** Enables `willReadFrequently: true` on `isFallbackAdapter` so SwiftShader uploads take `0–6 ms` instead of blocking `299–564 ms` ([decisions.md #74](decisions.md#74)).
4. **Premultiplied sRGB + `DirectRenderPipeline` ([SurfaceCanvas.tsx](../packages/react/src/primitives/surface/SurfaceCanvas.tsx), [surfaceOutput.ts](../packages/react/src/lib/surfaceOutput.ts)):** Keeps `NoToneMapping`, `premultiplyAlpha = true`, and `DirectRenderPipeline` so translucent UI and additive glow match DOM compositing ([decisions.md #5, #69, #72](decisions.md#5)).
