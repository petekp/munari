# GPU runtime & agent-native roadmap

Architecture, milestones, and lab migration plan for `@petepetrash/munari/gpu`, copyable `registry/` modules, and the `@petepetrash/munari-cli` toolchain.

> **Status note:** **M0** (`edb501c`) and **M0.5** are **Complete**; **M1–M5** are **Unbuilt** specifications and exit gates. Do not infer unbuilt runtime APIs from future milestones (`AGENTS.md`).

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
| **M1 — Manifest v2, Linear Builder & Opaque LTC Finish** | Unbuilt | Finalize Manifest v2 ABI (version field, `@group(1)` static textures alongside uniforms, host-fed frame uniforms `viewport`/`cameraZ`/`time`/`keyLight` inside 256 B stride); linear-color `defineGpuMaterial` builder owning decode/encode/premultiply/mask/discard (remove authoring `sampleViewFormat`); author **lacquer with LTC softbox** (`ltc64Half`) as acceptance finish; recompile the 6 starter materials; WGSL validation strategy; pull minimal 1-frame render-and-readback check from M5; `munari check` hash + `info --json`. | 3 cold agents author/compile stacked materials & render pixels cleanly in Chrome; each manifest passes Chrome pipeline + pixel readback oracle (`0` validation errors); `typed-binary` byte parity. |
| **M2 — Controlled Parity Probe, Backdrop Blur & Transmissive Finish** | Unbuilt | Build controlled parity probe (identical `SurfaceFinish`, light rig, DOM across Three.js vs `/gpu`) before shader work; add multi-level backdrop mip/blur pass prerequisite (new target format / `RENDER_ATTACHMENT` backdrop); compile `finishTransmissive` (beer tint, spectral dispersion, frosted blur); delete placeholder `finishMaterial.ts`. | Controlled side-by-side probe matches Three.js lacquer/velvet/glass within agreed perceptual tolerance at `<= 1 ms` per-frame JS work. |
| **M3 — Analytic Springs, Content-less Shadow & `bleed`** | Unbuilt | True closed-form analytic spring + `compose(...)` behaviors in `registry/behaviors/`; decide & implement content-less shadow primitive (secondary draw item on same Surface sharing pose, zero DOM capture source); add `bleed` prop for in-plane halos/1px AA skirt; `Flight`/`Fisheye` animated cleanly. | Re-run shadow check with asserted non-background shadow pixels outside card; analytic spring matches identical trajectory at 60 Hz & 120 Hz and settles to `idleRenders === 0`; `gpuSurface <= 82,069 B` gz. |
| **M4 — Wave 1 Lab Demos** | Unbuilt | Port Wave 1 `apps/lab` demos cleanly to `@petepetrash/munari/gpu`, `registry/materials/`, `registry/behaviors/`. | Wave 1 scenes pass interactive Puppeteer checks with zero Three.js chunks loaded. |
| **M5 — Agent-Native Loop (`manual` Clock, `SKILL.md`, `film` & `verify`)** | Unbuilt | `frameloop="manual"`, `step(dtMs)`, `settle()` deterministic clock on `SurfaceCanvas`; Chrome keyframe `film` & `verify` runners in `instruments/`; catalog `runtime` tags + CI-tested `SKILL.md` in `packages/cli`. | Cold agent uses `munari info --json`, `SKILL.md`, and `manual` clock filmstrip to debug & verify an interactive UI card cleanly. |

---

## Lab demo refactoring plan (`apps/lab`)

- **Wave 1 (M4 priority):** `gpu-studio` (Fisheye & Flight upgraded to analytic spring behaviors + M1/M2 finishes) -> standalone `Flight` -> `finish-demo` -> `Genie` warp.
- **Wave 2 (M4/M5 follow-through):** `Genie` full filmstrip/gesture -> `Tear-off planner` -> `Postcard` -> `Selection` -> `Plume` -> `Slider`.
- **Stay on Three.js (`.`) permanently (true 3D camera/meshes/volumetrics):** `light`, `marble-hand`, `knobs`, `logo`, `review-notes`, `cutaway-prototype`, `distortion-wave`, `glass`.
