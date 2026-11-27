# GPU runtime & agent-native roadmap

Architecture, milestones, and lab migration plan for `@petepetrash/munari/gpu`, copyable `registry/` modules, and the `@petepetrash/munari-cli` toolchain.

> **Status note:** **M0** (`edb501c`), **M0.5** (`c43913a`), and **M1** are **Complete**; **M2–M5** are **Unbuilt** specifications and exit gates. Do not infer unbuilt runtime APIs from future milestones (`AGENTS.md`).

---

## Core architecture (4 layers)

Munari brings a **Core Animation-like layer model** to retained web DOM while keeping **AI agents under human direction** as first-class consumers:

1. **Minimal retained-DOM WebGPU runtime (`@petepetrash/munari/gpu`)**
   - Single React reconciler, zero Three.js, zero `@react-three/fiber`, zero runtime `typegpu`.
   - `SurfaceCanvas` owns `GPUDevice`, `device.lost` recovery, dynamic-offset frame ring (`256 B` stride), two-pass backdrop capture (`@group(2)`), host pipeline cache, and demand/seekable frame scheduling (`requestGpuFrame`, plus `frameloop="manual"` in M5).
   - `Surface` owns `@munari/core` four-phase crossing (`page` <-> `scene`), dual-view premultiplied DOM texture (`rgba8unorm-srgb` + `rgba8unorm`), pointer/wheel relay (`surfaceRadiusSd` + `canvasIsTopmostAt`), graceful no-capture fallback (`supportsCapture`), non-null `ctx.basePose`, and `onFrame(): boolean | void` demand work claims.
   - **Eager weight rule:** Keep `gpuSurface` loaded payload `<= 82,069 B` gz (`instruments/payload/budgets.json`), and report both bundled-React and React-externalized sizes in `instruments/payload/run.mjs`.
2. **Composable TypeGPU materials -> zero-dep `*.material.gen.ts` + compiled finishes**
   - Authors write shaders in strict TypeScript (`registry/materials/*.material.ts`), compiled offline to zero-dependency `*.material.gen.ts` modules containing WGSL, typed tuple uniform specs, static texture bindings, and `DataView` packers.
   - **M1 (`defineGpuMaterial` + Manifest v2):** Composable hooks take and return **straight linear color** while the builder owns sRGB decode/encode, premultiply, `surfaceRadiusMask`, and discard. Material static textures bind in **`@group(1)`** beside custom uniforms (`@group(0)` frame/surface and `@group(2)` backdrop stay runtime-owned), keeping total bind groups `<= 3` (under WebGPU's default 4-group limit).
   - **M2 (`finishTransmissive` + controlled parity):** Replaces placeholder `finishMaterial.ts` after building a backdrop mip/blur prerequisite and controlled side-by-side Three.js parity probe.
3. **Ownable behaviors & shadows (`registry/behaviors/`, shadcn model)**
   - **Closed-form analytic springs & behavior combinators live in `registry/behaviors/`** (not inside `@munari/core` or a runtime `behaviors` prop), so 60 Hz, 120 Hz, and M5 deterministic `step(dtMs)` agree.
   - **Grounded cast shadows** use a dedicated **content-less shadow primitive** (e.g. a second draw item emitted from the same `Surface` with no DOM source, sharing its pose); `bleed` is reserved strictly for in-plane optical halos/glow and a default 1-device-pixel AA skirt.
4. **Agent loop & verification split (`packages/cli` vs `instruments/`)**
   - `packages/cli` (`@petepetrash/munari-cli`) stays lightweight (zero Puppeteer / Chromium dependency): `init`, `list` (with `runtime` tags), `add`, `compile` (failing hard on TypeGPU implicit-conversion warnings), static source-hash `check`, `info --json`, and a CI-tested 1-page `SKILL.md`.
   - `instruments/` owns Chrome-driving tools (`gate:gpu`, payload gates, M1 single-frame render/readback oracle, M2 controlled parity probe, M5 keyframe `film`/`verify`).

---

## Milestones & exit gates

| Milestone | Status | Scope & key deliverables | Quantitative exit gate |
|---|---|---|---|
| **M0 — Correctness & Honest Gate** | **Complete** (`edb501c`) | Unlit `'rgba8unorm'`, offset `matchDomPose`, `surfaceRadiusSd` + `canvasIsTopmostAt`, Z sort, prop reactivity, `setUniforms`, pipeline cache, dev error scopes, `maxTextureDimension2D` clamp, React-external payload reporting, DPR 2 `gate:gpu`. | `gpuSurface` `80,668 B` gz loaded (`22,351 B` React-external); DPR 2 `#e85d04` `{232, 93, 4}` (`0/255` diff), rounded-corner, chrome occlusion, offset/scrolled click, `device.lost`, no-WebGPU fallback (`1,583` unit tests). |
| **M0.5 — Runtime & Compiler Contract Fixes** | **Complete** | Graceful no-capture `Surface` fallback (`supportsCapture` exported in `/gpu`, skip `crossingRequest`); `onFrame(): boolean` own work claim + `requestGpuFrame`; non-null `ctx.basePose` (defined at origin for `exclusive={false}`); hard-fail `munari compile` on TypeGPU implicit-conversion warnings; `generateMaterialSource(absPath, options)` + tuple uniform types (`readonly [number, ...]`); spike doc + `Glass Frosted` copy cleanup. | `gpuSurface` `80,982 B` gz loaded (`22,646 B` React-external); `1,585` unit tests; `materialsCli.test.ts` fails compile on float-to-`i32` truncation; DPR 2 `gate:gpu` passes all 7 checks including no-native + snapDOM (`'scene'`, airborne click, `0` idle renders) and `?capture=none` (`'page'`, editable/clickable, `0` errors). |
| **M1 — Manifest v2, Linear Builder & Opaque LTC Finish** | **Complete** | Finalized Manifest v2 ABI (`version: 2`, `sourceHash`, `@group(1)` lazy `staticTextures.ts`, 256 B host-fed frame uniforms `viewport`/`camera`/`keyPos`/`keySize`/`rimDir`/`uvRect` with canvas offset correction); linear-color `defineGpuMaterial` + `composeShades` builder owning `sampleSurfaceLinear`/`surfaceRadiusMask`/`encodeSurfaceOutput`; lazy 64x64 `rgba16float` LTC table loader (`ltc.ts`); opaque `lacquer-ltc` (`depthWrite: true`, SDF bevel); all 7 starter manifests compiled (`checkFast` folds `author.ts` + `ltcAuthor.ts` into ABI; `add --manifest-import` re-stamps hashes); `munari info --json`; hardened Chrome oracle (`gate:oracle`). | `gpuSurface` `81,625 B` gz loaded (`23,285 B` React-external, `6,083 B` deferred, `-395 B` reclaimed); `1,587` unit tests (`0` boundary errors); `gate:gpu` 7/7; `gate:oracle` 7/7 (`0` Dawn errors, `(19,19)` radius clip `0`, `glass-refract` cyan backdrop `{90,144,194}`, `lacquer-ltc` pos-only `keyShiftDiff: 30.20` & behind-plane `behindLumaDelta: 40.15`); `HEAD` parity `0/255` on `flight-card`/`glass-refract` (linear shift on `foil`/`vignette`); `3/3` cold-agent stacked compile + oracle pass. |
| **M2 — Controlled Parity Probe, Backdrop Blur & Transmissive Finish** | Unbuilt | Build controlled parity probe (matching Three.js `finishRig` point-key vs softbox selection, `STUDIO_KEY_POWER`, `softboxLuminance`, `worldPerCss`, and `DOM` across renderers) before shader work; build multi-level backdrop mip/blur on `generateMipmaps` loaded lazily only for `needsBackdrop`; route `finish` prop through a lazy lookup of compiled finish manifests (deleting placeholder `finishMaterial.ts`) and ship `finishTransmissive`. | Controlled side-by-side probe matches Three.js lacquer/velvet/glass within agreed perceptual tolerance at `<= 1 ms` per-frame JS work; zero eager payload growth. |
| **M3 — Analytic Springs, Content-less Shadow & `bleed`** | Unbuilt | True closed-form analytic spring + `compose(...)` behaviors in `registry/behaviors/`; dedicated content-less shadow primitive deriving cast direction from `frame.keyPos` (second draw item on same Surface, zero DOM source); implement `bleed` using FrameUniforms `uvRect` content-UV transform for in-plane halos/1px AA skirt; `Flight`/`Fisheye` animated cleanly. | Re-run shadow check with asserted non-background shadow pixels outside card; analytic spring matches identical trajectory at 60 Hz & 120 Hz and settles to `idleRenders === 0`; any `budgets.json` change requires explicit owner approval + measured delta. |
| **M4 — Wave 1 Lab Demos** | Unbuilt | Port Wave 1 `apps/lab` demos cleanly to `@petepetrash/munari/gpu`, `registry/materials/`, `registry/behaviors/`. | Wave 1 scenes pass interactive Puppeteer checks with zero Three.js chunks loaded. |
| **M5 — Agent-Native Loop (`manual` Clock, `SKILL.md`, `film` & `verify`)** | Unbuilt | `frameloop="manual"`, `step(dtMs)`, `settle()` deterministic clock on `SurfaceCanvas` driving `frame.camera.zw` (`timeSec`, `dtSec`); Chrome keyframe `film` & `verify` built on the `gate:oracle` harness with reference image checks; catalog `runtime` tags + CI-tested `SKILL.md` in `packages/cli`. | Cold agent uses `munari info --json`, `SKILL.md`, and `manual` clock filmstrip to debug & verify an interactive UI card cleanly. |

---

## Lab demo refactoring plan (`apps/lab`)

- **Wave 1 (M4 priority):** `gpu-studio` (Fisheye & Flight upgraded to analytic spring behaviors + M1/M2 finishes) -> standalone `Flight` -> `finish-demo` -> `Genie` warp.
- **Wave 2 (M4/M5 follow-through):** `Genie` full filmstrip/gesture -> `Tear-off planner` -> `Postcard` -> `Selection` -> `Plume` -> `Slider`.
- **Stay on Three.js (`.`) permanently (true 3D camera/meshes/volumetrics):** `light`, `marble-hand`, `knobs`, `logo`, `review-notes`, `cutaway-prototype`, `distortion-wave`, `glass`.
