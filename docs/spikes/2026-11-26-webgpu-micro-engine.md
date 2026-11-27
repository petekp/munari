# WebGPU-only micro-engine — Step 1 & Step 2 probe

**Date:** 2026-11-26  
**Probe:** [instruments/webgpu-micro-probe/run.mjs](file:///Users/petepetrash/Code/munari/instruments/webgpu-micro-probe/run.mjs)  
**Authoring contract:** WebGPU substrate, `@munari/core` kernel integration, zero Three.js / R3F / `react-reconciler`

## Verdict

- **Dual-view single-allocation texture (`rgba8unorm-srgb` + `viewFormats: ['rgba8unorm']`) works without copying on both Metal-3 and SwiftShader:** hardware and fallback runs hit `0/255` channel delta against premultiplied 2D canvas references on the unlit sRGB view, `1/255` max delta when recovering unpremultiplied straight RGB via the raw `rgba8unorm` view (negative control dividing by alpha after sRGB hardware decode shifted by `62/255`), and `0/255` delta across dynamic `200×120 → 480×240 → 120×80` resize reallocations with `0` WebGPU validation errors.
- **Direct premultiplied swapchain compositing over page HTML matches native HTML alpha blending and preserves additive glow:** `bgra8unorm` with `alphaMode: 'premultiplied'` matched `rgba(200, 80, 40, 0.5)` HTML over `rgb(40, 101, 180)` (`120, 90, 110`) with `0/255` channel difference, brightened transparent additive glow regions to `168, 165, 180`, and left the straight-alpha negative control indistinguishable from backdrop (`40, 101, 180`).
- **A zero-Three, zero-R3F, zero-`react-reconciler` micro-host passes both `FlightSlice` and `FisheyeSlice` behavioral checks and cuts bundle size from `535,833 B` gz (`budgets.json`) to `77,572 B` gz (`+18,840 B` gz over React 19's `58,732 B` gz production baseline; updated from initial `NODE_ENV=development` Vite leak of `113,900 B` gz), and precompiled TypeGPU Material Manifests hold `flightAppManifest` at `80,530 B` gz (`0` TypeGPU runtime modules, `0/255` pixel delta vs TypeGPU runtime).**

## Sections

- **Substrate & micro-host (`Step 1` – `Step 2`, seam lessons):** [2026-11-26-webgpu-micro-engine-substrate.md](2026-11-26-webgpu-micro-engine-substrate.md)
- **TypeGPU, compiled Material Manifests & Phase 1 production checks (`Step 2.5` – `Step 4`):** [2026-11-26-webgpu-micro-engine-manifests.md](2026-11-26-webgpu-micro-engine-manifests.md)

## Environment

| Property | Hardware run | Fallback / software run |
|---|---|---|
| User agent | `HeadlessChrome/158.0.0.0` (macOS arm64) | `HeadlessChrome/158.0.0.0` (macOS arm64) |
| Adapter vendor / architecture | `apple` / `metal-3` | `google` / `swiftshader` |
| `isFallbackAdapter` | `false` | `true` |
| `maxTextureDimension2D` | `16384` | `8192` |
| Preferred canvas format | `bgra8unorm` | `bgra8unorm` |

Raw measurements from `node instruments/webgpu-micro-probe/run.mjs`.
