# GPU runtime & agent-native roadmap

Architecture, milestones, and lab migration plan for `@petepetrash/munari/gpu`, copyable `registry/` modules, and the `@petepetrash/munari-cli` toolchain.

> **Status note:** Only `@petepetrash/munari/gpu` Phase 1 (basic `SurfaceCanvas`, `Surface`, `finishMaterial`, `createManifestDriver`, 6 `registry/materials/` manifests, `munari init/list/add/compile/check`, and `gpu-studio`) is built today. **M0** below is **In progress**; **M1–M5** are **Unbuilt** specifications and exit gates. Do not infer runtime APIs from unbuilt milestones (`AGENTS.md`).

---

## Core architecture (4 layers)

Munari brings a **Core Animation-like layer model** to retained web DOM while keeping the primary library consumer an **AI agent writing UI under human direction**:

1. **Minimal retained-DOM WebGPU runtime (`@petepetrash/munari/gpu`)**
   - Single React reconciler, zero Three.js, zero `@react-three/fiber`, zero runtime `typegpu`.
   - `SurfaceCanvas` owns the `GPUDevice`, adapter recovery (`device.lost`), dynamic-offset frame ring, two-pass backdrop capture (`@group(2)`), host-level `GPURenderPipeline` cache, and demand/seekable frame scheduling (`frameloop="manual"` in M5).
   - `Surface` owns `@munari/core` four-phase crossing (`page` <-> `scene`), dual-view premultiplied DOM texture (`rgba8unorm-srgb` + `rgba8unorm`), pointer/wheel relay (`surfaceRadiusSd` rounded-corner mask + `canvasIsTopmostAt` occlusion), and `onFrame` callbacks returning `true` while motion is unsettled (M3).
   - **Eager weight rule:** Keep `gpuSurface` loaded payload `<= 82,069 B` gz (`instruments/payload/budgets.json`), and report both bundled-React and React-externalized sizes in `instruments/payload/run.mjs`.
2. **Composable TypeGPU materials -> zero-dep `*.material.gen.ts` + compiled finish manifests**
   - Developers and agents author shaders in strict TypeScript using `typegpu` (`registry/materials/*.material.ts`), compiled offline to zero-dependency `*.material.gen.ts` modules containing WGSL + byte-exact `DataView` uniform packers.
   - M1 adds composable shader authoring (`defineGpuMaterial` / composable vertex & fragment hooks) enforcing premultiplied alpha, linear/sRGB contracts, and rounded-corner clipping automatically.
   - M2 replaces the placeholder `finishMaterial.ts` WGSL with compiled TypeGPU manifests (`finishOpaque`, `finishTransmissive`) implementing real `@group(2)` backdrop refraction/blur, Beer tint, Fresnel rim, and LTC softbox area lights (`ltc64Half` actually bound and sampled in WGSL).
3. **Ownable behaviors & shadows (`registry/behaviors/`, shadcn model)**
   - **Closed-form springs & behavior composition stay out of `@munari/core` and out of a `<Surface behaviors={...} />` runtime prop.** Instead, `registry/behaviors/` ships copyable TypeScript modules (`spring`, `compose`, `flight`, `fisheye`, `pulse`, `press`, `parallax`) copied into user code via `npx munari add` and driven from `onFrame(ctx)` (returning `true` while active).
   - **Grounded cast shadows** use a dedicated **content-less shadow quad** behind the surface (never inflating DOM texture resolution or sampling DOM capture bits); `Surface`'s `bleed` prop (M3) is strictly for in-plane optical halos/glow and a default 1-device-pixel AA skirt.
4. **Agent loop & verification split (`packages/cli` vs `instruments/`)**
   - `packages/cli` (`@petepetrash/munari-cli`) stays lightweight (zero Puppeteer / Chromium dependency): `init`, `list` (with `runtime: 'gpu' | 'three'` tags), `add`, `compile`, static source-hash `check`, `info --json` (exact uniform byte layout, `@location` attributes, WGSL bindings, runtime support), and a CI-tested 1-page `SKILL.md` guide.
   - `instruments/` owns Chrome-driving tools: `gate:gpu` (`instruments/gpu-runtime/`), payload measurements (`instruments/payload/`), WebGPU substrate probes (`instruments/webgpu-micro-probe/`), and M5 keyframe `film` / `verify` runners.

---

## Milestones & exit gates

| Milestone | Status | Scope & key deliverables | Quantitative exit gate |
|---|---|---|---|
| **M0 — Correctness & Honest Gate** | **In progress** | Fix unlit `'rgba8unorm'` dark-render bug (`#e85d04` exact match); fix `matchDomPose` canvas viewport offset; enforce `canvasIsTopmostAt` + `surfaceRadiusSd` in hover/wheel; back-to-front Z sort; reactive `Surface` prop changes (`size`, `segments`, `resolution`, `live`, `material`); `ctx.setUniforms(...)`; host pipeline cache; opt-in dev error scopes; `maxTextureDimension2D` clamp; drop `{ powerPreference: 'high-performance' }`; remove unused `ltc64Half` import until M2 & memoize `updateFinish`; add React-external payload line. | `gate:gpu` upgraded to DPR 2 passes `#e85d04` (`delta <= 5`), rounded-corner click rejection, scrolled/offset canvas, chrome occlusion, `STRICT_CAPABILITY=1`, and headless `--disable-features=WebGPUService` HTML fallback (`0` errors). `gpuSurface <= 82,069 B` gz. |
| **M1 — Composable TypeGPU Material Authoring** | Unbuilt | `defineGpuMaterial` composable TypeGPU builder (displace + surface/color hooks, automatic `surfaceRadiusMask`, `@group(0)`/`@group(1)`/`@group(2)` layouts, explicit linear vs sRGB contract); re-compile `flightCard`, `fisheyeLens`, `foil`, `vignette`, `tiltShadow`, `glassRefract`; add source-hash `munari check` & machine-readable `munari info --json`. | Cold subagent authors 2 new stacked materials without reading runtime internals; `0` compile errors, byte-exact `typed-binary` parity, `0/255` pixel delta vs runtime TypeGPU. |
| **M2 — Production Finish Shaders (`SurfaceFinish`)** | Unbuilt | Compile TypeGPU-authored `finishOpaque` & `finishTransmissive` manifests; fix `@group(2)` mip/blur backdrop refraction (replaces broken pass-through refract), bind `ltc64Half` LTC LUT textures in WGSL for softbox area lights, Fresnel rim, specular highlight, Beer tint, subtle grain. | Visual side-by-side & pixel probe in Chrome matches `@petepetrash/munari` finish material quality (reflected softbox highlight + refracted blurred backdrop over DOM) with `<= 1 ms` per-frame JS work. |
| **M3 — Behaviors, `onFrame` Scheduling, Shadow Quad & `bleed`** | Unbuilt | Allow `onFrame(ctx)` to return `boolean` (`true` while animating on `demand` loop); ship `registry/behaviors/` (`spring`, `compose`, `flight`, `fisheye`, `pulse`, `press`); add `bleed` prop for in-plane halo/1px AA skirt; ship content-less shadow quad helper/component. | `Flight` & `Fisheye` settle to `idleRenders === 0` after spring rest within `+/- 1` frame; no clipped AA seams on tilted cards; `gpuSurface` eager payload remains `<= 82,069 B` gz. |
| **M4 — Wave 1 Lab Demos** | Unbuilt | Port `apps/lab` demos cleanly to `@petepetrash/munari/gpu` + `registry/materials/` + `registry/behaviors/` without custom shader duplication. | Wave 1 scenes render & pass interactive Puppeteer checks cleanly on WebGPU with zero Three.js chunks loaded. |
| **M5 — Agent-Native Loop (`manual` Clock, `SKILL.md`, `film` & `verify`)** | Unbuilt | Add `frameloop="manual"`, `step(dtMs)`, `settle()` deterministic clock on `SurfaceCanvas`; add Chrome `film` keyframe filmstrip + `verify` probe in `instruments/`; add `runtime` tags in `catalog.json` and CI-verified 1-page `SKILL.md` in `packages/cli`. | Cold agent uses `munari info --json` + `SKILL.md` + `manual` clock filmstrip to debug & ship an interactive UI card without manual pixel squinting. |

---

## Lab demo refactoring plan (`apps/lab`)

- **Wave 1 (M4 priority):** `gpu-studio` (Fisheye & Flight upgraded to animated spring behaviors + M2 finish) -> standalone `Flight` -> `finish-demo` -> `Genie` warp.
- **Wave 2 (M4/M5 follow-through):** `Genie` full filmstrip/gesture -> `Tear-off planner` -> `Postcard` -> `Selection` -> `Plume` -> `Slider`.
- **Stay on Three.js (`.`) permanently (true 3D camera/meshes/volumetrics):** `light`, `marble-hand`, `knobs`, `logo`, `review-notes`, `cutaway-prototype`, `distortion-wave`, `glass`.
