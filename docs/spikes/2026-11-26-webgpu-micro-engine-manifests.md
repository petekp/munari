# WebGPU-only micro-engine — Step 2.5, Step 3 & Step 4 measurements

Part of [2026-11-26-webgpu-micro-engine.md](2026-11-26-webgpu-micro-engine.md).

## Step 2.5 — TypeGPU (`v0.12.12`) + `unplugin-typegpu` (`v0.12.9`) probe

Validated `typegpu@0.12.12` and `unplugin-typegpu@0.12.9` inside [instruments/webgpu-micro-probe/](file:///Users/petepetrash/Code/munari/instruments/webgpu-micro-probe/engine/typegpuMaterial.ts) against Vite `8.2.0` / Rolldown, TypeScript `7.0.2`, `oxlint --deny-warnings`, and Chrome `158.0.0.0`.

### Stack compatibility

- **TypeScript 7.0.2 & `oxlint`:** Installing `typegpu` + `unplugin-typegpu` passed repo-wide `npm run typecheck` across all four tsconfig programs (`root`, `apps/lab`, `registry`, `tools`) and passed `oxlint` (`0` errors, `0` warnings) without adding `@webgpu/types` or modifying `tsconfig.json`.
- **Vite 8 / Rolldown + `unplugin-typegpu/vite`:** Default `typegpu()` plugin transformed `'use gpu'` TypeScript functions (`sampleSurface`, `surfaceRadiusMask`, `srgbOetf`, `srgbEotf`, vertex/fragment entry points in [flightTypegpu.ts](file:///Users/petepetrash/Code/munari/instruments/webgpu-micro-probe/scenes/flightTypegpu.ts) and [fisheyeTypegpu.ts](file:///Users/petepetrash/Code/munari/instruments/webgpu-micro-probe/scenes/fisheyeTypegpu.ts)) cleanly in both Vite dev and production builds.

### Behavioral verification (`?material=typegpu`, Chrome 158)

- **`FlightSlice` (TypeGPU):** Matched the raw-WGSL slice on every check with zero `pageerror` or console/WebGPU errors — `beforeLift` (`presentation === 'page'`, `pageHidden: false`), `airborne` (`presentation === 'scene'`, `pageHidden: true`, `"initial note + edited"` preserved), airborne 3D button click (`count: 0 → 1`), `landed` (`presentation === 'page'`, `pageHidden: false`, `cardRect` `{240, 40, 300, 170}`), and `idleDelta { renders: 0, paints: 0 }`.
- **`FisheyeSlice` (TypeGPU):** Matched the raw-WGSL slice on every check with zero errors — warped row routing (`row9 shiftY: -60 → 9`, `row14 shiftY: 0 → 14`, `row19 shiftY: 60 → 19`), off-center `Done` click (`act9Shift { x: 2, y: -60 }` with no row leak), filter typing (`'relay'` → `5/28`), and `idleDelta { renders: 0, paints: 0 }`.

### Vite 8 / Rolldown production payload (9-entry comparison, corrected `NODE_ENV=production`)

Note: `FlightSlice` / `FisheyeSlice` kept TypeGPU material drivers dependency-injected so raw-WGSL and precompiled Material Manifest entries remained completely isolated from `typegpu`.

| Entry | Minified (`B`) | Gzip l9 (`B`) | Brotli q11 (`B`) | Net over React (`B` gz) | Delta vs raw WGSL (`B` gz) | TypeGPU modules |
|---|---|---|---|---|---|---|
| `reactBaseline` (`react` + `react-dom`) | `189,326` | `58,732` | `50,693` | `0` | — | `0` |
| `minimalSurface` (raw WGSL) | `242,041` | `77,572` | `67,254` | `+18,840` | — | `0` |
| `flightApp` (raw WGSL) | `247,267` | `79,119` | `68,751` | `+20,387` | — | `0` |
| `fisheyeApp` (raw WGSL) | `251,012` | `80,490` | `69,789` | `+21,758` | — | `0` |
| `flightAppManifest` (compiled `.material.gen.ts`) | `253,002` | `80,530` | `69,858` | `+21,798` | `+1,411` | `0` |
| `fisheyeAppManifest` (compiled `.material.gen.ts`) | `255,916` | `81,725` | `70,732` | `+22,993` | `+1,235` | `0` |
| `minimalSurfaceTypegpu` (runtime TypeGPU) | `520,178` | `156,031` | `132,797` | `+97,299` | `+78,459` | `149` |
| `flightAppTypegpu` (runtime TypeGPU) | `530,577` | `158,776` | `135,192` | `+100,044` | `+79,657` | `149` |
| `fisheyeAppTypegpu` (runtime TypeGPU) | `532,757` | `159,687` | `135,888` | `+100,955` | `+79,197` | `149` |

- Runtime TypeGPU adds **`~78.5–79.7 kB` gz** (`149` TypeGPU modules). Compiling `.material.ts` manifests ahead of time to `.material.gen.ts` eliminates all `149` TypeGPU modules (`+1,235–1,411 B` gz over handwritten WGSL for the typed packer and explicit layouts).

### Agent-facing TypeGPU seam findings

1. **`root.createRenderPipeline(...).initAsync()` preserves non-blocking warmup:** Calling `.initAsync()` on two TypeGPU pipelines (normal `writeMask: 0xf` and warmup `writeMask: 0`) and extracting the native `GPURenderPipeline` via `root.unwrap(...)` keeps async pipeline compilation and write-free lift readiness intact while letting TypeGPU handle `@location` varying matching automatically.
2. **Explicit `$idx(0)` / `$idx(1)` bind-group layouts isolate kernel vs shader uniforms:** Defining `surfaceLayout` (`frame`, `samp`, `tex`) at `@group(0)` and per-material `custom` uniform layouts (`FlightCustomUniforms`) at `@group(1)` lets custom shaders access `d.struct` uniforms via `customLayout.$.u.*` and update them via `customBuffer.write(...)` with zero manual `Float32Array` packing or `_pad` fields, while Munari keeps `@group(0)` bind-group invalidation tied to `MicroSurfaceTexture` resize/view swaps.
3. **Raw dual-view `GPUTextureView` + `GPUSampler` bind cleanly into `root.createBindGroup`:** `surfaceLayout` accepts Munari's own `srgbView`/`rawView` (`GPUTextureView`) and `GPUSampler` directly, keeping single-allocation dual-view premultiplied upload under `@munari/core` ownership.
4. **Fragment return convention:** Returning a `d.vec4f` directly from `tgpu.fragmentFn({ ..., out: d.vec4f })` expects a single `GPUColorTargetState` object (not a 1-element array) in `root.createRenderPipeline({ targets })`.

---

## Step 3 — Probe hardening, Material Manifest CLI, and perceptual / multi-surface checks (2026-11-27)

### Engine & probe hardening (`webgpu.ts`, `manifest.ts`, `reactHost.tsx`, `typegpuMaterial.ts`)

1. **Explicit pipeline layouts & dynamic `@group(0)` frame ring:** Replaced `layout: 'auto'` with explicit `surfaceBindGroupLayout` (binding 0 uniform buffer with `hasDynamicOffset: true`, `256 B` stride for `FRAME_UNIFORM_BYTES = 160`) and `customBindGroupLayout` (`@group(1)`). Fixed `createFlightTypeGpuDriver` shared closure collision by indexing per-instance uniform writers via `WeakMap<MicroMaterial, ...>`.
2. **`rgba8unorm` mipmap filtering & WebGPU error oracle:** Switched `mipPipeline` and `generateMipmaps` to `rgba8unorm` (`decisions.md #48`), added `device.addEventListener('uncapturederror', ...)` + `pushErrorScope('validation')` asserted empty in `run.mjs`, and decoupled `extraLocations` from vertex buffer slot indices (`2 + idx`).
3. **Two silent bugs caught by testing against pixel parity and 2+ surfaces:**
   - **Vertex buffer stride (`d.arrayOf(d.vec3f)` vs `d.disarrayOf(d.vec3f)`):** `tgpu.vertexLayout((n) => d.arrayOf(d.vec3f, n))` computed WGSL array stride `16` instead of packed `Float32Array` stride `12` (`d.disarrayOf(d.vec3f, n)`), scrambling runtime TypeGPU `FlightSlice` vertices across `30,532–31,813` px with **zero** WebGPU validation error while `flightCardManifest` matched handwritten WGSL bit-for-bit (`0/255` diff).
   - **Multi-surface epoch check (`reactHost.tsx`):** `MicroSurface` passed `token` (`tokenSeq++`, `2` on the second surface) instead of `acquiredEpoch` (`1`) into `surfaceEpochCurrent`, causing every second+ mounted surface to reject its own frame receipts forever. Fixed to track `acquiredEpoch = identityRef.current.epoch`.

### Material Manifest CLI (`cli/compile.mjs`) & fresh-agent authoring trial

- **Compile-time shader + packer emission:** [cli/compile.mjs](file:///Users/petepetrash/Code/munari/instruments/webgpu-micro-probe/cli/compile.mjs) + [cli/preload.mjs](file:///Users/petepetrash/Code/munari/instruments/webgpu-micro-probe/cli/preload.mjs) load TypeGPU authoring modules via `unplugin-typegpu/node` over a stub `GPUDevice`, extract resolved WGSL and entry points, generate zero-dep `DataView` packers via `d.memoryLayoutOf`, and assert byte-for-byte parity against TypeGPU's own `typed-binary` buffer writes at compile time.
- **Compiled probe manifests (`oxlint --deny-warnings` + `tsc --noEmit` + Chrome parity clean):**
  - [flight.material.ts](file:///Users/petepetrash/Code/munari/instruments/webgpu-micro-probe/materials/flight.material.ts) -> `flight.material.gen.ts` (`2,771 B` WGSL, `24 B` uniforms): **`maxDelta: 0`, `differingPixelsOver2: 0`** vs runtime TypeGPU across all `1,032,000` pixels (`1200×860`).
  - [fisheye.material.ts](file:///Users/petepetrash/Code/munari/instruments/webgpu-micro-probe/materials/fisheye.material.ts) -> `fisheye.material.gen.ts` (`2,121 B` WGSL, `0 B` uniforms): **`maxDelta: 0`, `differingPixelsOver2: 0`** vs runtime TypeGPU across all `1,032,000` pixels.
  - [alignmentStress.material.ts](file:///Users/petepetrash/Code/munari/instruments/webgpu-micro-probe/materials/alignmentStress.material.ts) (`vec3f + f32 + mat3x3f + arrayOf(vec4f, 3)`) -> `alignmentStress.material.gen.ts` (`1,828 B` WGSL, `112 B` uniform struct, handles both 9-float packed and 12-float WGSL-strided `mat3x3f` layouts with `packElem`/`packMat3` helpers keeping `oxlint` cyclomatic complexity clean).
- **Fresh-agent authoring trial (`731aaf9d`):** A cold subagent given only the 1-page authoring guide and `flight.material.ts` authored `foil`, `vignette`, and `tilt-shadow` (`mat3x3f` + `extraAttributes`). All 3 compiled on the first run (`2,158 / 1,889 / 2,079 B` WGSL; `16 / 32 / 64 B` uniforms) and passed `typed-binary` byte parity, while surfacing 4 authoring UX gaps to fix in the production guide/API:
  1. Document `surfaceLayout.$.frame` fields (`mvp`, `modelWorld`, `size`, `radii`) and standard `@location(0)` (`position`) / `@location(1)` (`uv`).
  2. Avoid duplicating extra-attribute names and `@location(2+)` between `defineScalarAttribute(...)` and `tgpu.vertexFn` `in`, and document how runtime `setExtraAttribute(slot, data)` populates them.
  3. Specify `d.mat3x3f` input conventions for `initial` / `sampleValue`.
  4. Document explicitly whether `sampleSurface(uv)` returns linear or sRGB premultiplied RGB under `sampleViewFormat: 'rgba8unorm'`.

### Perceptual, DPR 2, overlapping card, and cold-compile checks

| Probe (`run.mjs`) | Measured result | Negative control / comparison |
|---|---|---|
| `Claim 5` — translucent 1px edge mip level 2 (`rgba8unorm`, metal-3 & swiftshader) | `{100, 40, 20, 128}` (`rawDeltaMax: 0` vs premultiplied ref `{100, 40, 20, 128}`) | `rgba8unorm-srgb` mip filter: `{146, 57, 27, 128}` on metal-3 (`srgbBadDeltaMax: 46` bright edge fringe); `{146, 56, 26, 128}` on swiftshader (`46`) |
| `Claim 5` — realistic `2,769 B` lit/glass WGSL cold compile (`metal-3`) | `asyncCompileMs: 206.6 ms`, `asyncMaxFrameGapMs: 17.5 ms` (`p95: 17.5 ms`) | SwiftShader `asyncCompileMs: 9.8 ms` (`maxGap: 17.6 ms`); explicit `@group(0)`/`@group(1)` layout (`0` validation errors) |
| `OverlapSlice` — 2 overlapping translucent cards sharing one `flightCardManifest` over `rgb(40, 101, 180)` | Backdrop `{40, 101, 180}`, Card A `{139, 90, 103}`, Card B `{40, 145, 136}`, overlap `{85, 140, 102}` | Both cards draw concurrently with distinct dynamic group-0 offsets and per-instance uniforms (`0` WebGPU errors) |
| `Dpr2SnapSlice` — `301×121` fractional-phase card at DPR 2 (`2400×1720` PNG) | `pixelGridSnap`: column `[0..0, 255, 255, 0..0]` (`grayRows: 0`, `maxStep: 255`) | Unsnapped (`x = -200.25, y = 0.25`): `[0..0, 128, 255, 128, 0..0]` (`grayRows: 2`, `maxStep: 128`) |

---

## Step 4 — Phase 1 substrate (`@group(2)` + `device.lost`), `@petepetrash/munari/gpu`, and `@petepetrash/munari-cli` (2026-11-27)

1. **Two-pass `@group(2)` backdrop & `device.lost` recovery in Chrome 158 (Metal-3 + SwiftShader, `instruments/webgpu-micro-probe/run.mjs`):**
   - `glassBackdrop`: `baseOrangeLeft {200,80,40,255}`, `refractedRight {200,80,40,255}` (`0/255` delta via `sampleBackdropLinear` + `srgbOetf`), `pageBackdrop {40,101,180,255}`, `0` validation errors.
   - `deviceLostRecovery`: 1st `device.destroy()` recovered to `'scene'` with retained DOM input (`'initial note + kept across loss'`, `rendererLosses: 1`, `pageHidden: true`); 2nd loss within `10 s` degraded permanently to `'page'` (`rendererLosses: 2`, `pageHidden: false`).
   - Probe Vite production payloads: `reactBaseline 58,732 B` gz -> `minimalSurface 78,123 B` gz (`+19,391 B` gz), `flightAppManifest 81,250 B` gz (`0` TypeGPU modules), `fisheyeAppManifest 82,363 B` gz (`0` TypeGPU modules), vs runtime TypeGPU `156,624..160,260 B` gz (`149` modules).
2. **Production `@petepetrash/munari/gpu` & `@petepetrash/munari-cli`:**
   - Published subpath `packages/react/src/gpu.ts` + `packages/react/src/gpu/` (`SurfaceCanvas`, `Surface`, `createManifestDriver`, lazy `finishMaterial.ts` + `ltc64Half.ts`): `npm run gate:payload` measures `gpuSurface` at `80,069 B` gz loaded + `42,106 B` gz deferred (vs `537,715 B` gz loaded on `surface`).
   - `packages/cli` (`@petepetrash/munari-cli`) ships `init`, `list`, `add`, `compile`, `check` over `registry/materials/` (`flight-card`, `fisheye-lens`, `foil`, `vignette`, `tilt-shadow`, `glass-refract`) with auto-inferred `@location(2+)` vertex attributes and `d.mat3x3f` uniform parity checks.
   - Production browser gate (`instruments/gpu-runtime/run.mjs` -> `npm run gate:gpu` against `apps/lab/?scene=gpu-studio`): passes Flight retained input + airborne click (`clicks: 1`, `idleRenders: 0`), Fisheye warped row/done clicks + filter typing (`row: 9`, `done: 1`, `rows: 1`, `idleRenders: 0`), `SurfaceFinish` `--munari-body` + `@group(2)` backdrop pixels (`orange {212,48,15}`, refracted glass `{200,84,76}`), and single-retry `device.lost` recovery -> permanent `'page'` fallback (`0` page/WebGPU validation errors).
