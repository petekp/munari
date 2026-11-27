# WebGPU-only micro-engine — Step 1 & Step 2 substrate measurements

Part of [2026-11-26-webgpu-micro-engine.md](2026-11-26-webgpu-micro-engine.md).

## Step 1 — WebGPU substrate claims

### Claim 1: Dual-view premultiplied upload & dynamic resize

Swatch source: opaque `rgb(200, 80, 40)` and translucent `rgba(200, 80, 40, 0.5)` HTML rendered via `DomTextureSource` (`createDomTextureSource`) and uploaded once per paint via `copyExternalImageToTexture(..., { premultipliedAlpha: true })`.

| Check | Hardware (`metal-3`) | Fallback (`swiftshader`) | Notes |
|---|---|---|---|
| Unlit sRGB opaque (`deltaMax`) | `0` (`{200, 80, 40, 255}`) | `0` (`{200, 80, 40, 255}`) | Matches premultiplied ref `{200, 80, 40, 255}` |
| Unlit sRGB translucent (`deltaMax`) | `0` (`{100, 40, 20, 128}`) | `0` (`{100, 40, 20, 128}`) | Matches premultiplied ref of 2D `getImageData` straight `{199, 80, 40, 128}` |
| Lit raw `rgba8unorm` unpremultiplied | `{199, 80, 40, 255}` (`deltaMax: 1`) | `{199, 80, 40, 255}` (`deltaMax: 1`) | Single allocation, second view only |
| Negative control (divide after sRGB decode) | `{138, 58, 32, 255}` (`deltaMax: 62`) | `{138, 58, 31, 255}` (`deltaMax: 62`) | Proves `rgba8unorm-srgb` cannot be unpremultiplied cleanly in shader |
| Resize `200×120 → 480×240 → 120×80` | `deltaMax: 0` at both sizes | `deltaMax: 0` at both sizes | Destroy + reallocate, `0` validation errors |

### Claim 2: Direct `alphaMode: 'premultiplied'` swapchain compositing

Page HTML backdrop `rgb(40, 101, 180)` behind four zones captured via Puppeteer `page.screenshot` PNG readback (`probeEntry.ts` + `run.mjs`):

| Zone | Measured RGBA (`sRGB`) | Expected role |
|---|---|---|
| Backdrop | `{40, 101, 180, 255}` | Exposed page HTML |
| Zone A (native HTML `rgba(200, 80, 40, 0.5)`) | `{120, 90, 110, 255}` | Reference composite |
| Zone B (WebGPU premultiplied `{0.392, 0.157, 0.078, 0.5}`) | `{120, 90, 110, 255}` | Matches Zone A (`0/255` difference) |
| Zone C (WebGPU additive glow `{0.5, 0.4, 0.25, 0.0}`) | `{168, 165, 180, 255}` | RGB > 0 over `alpha = 0` brightens page |
| Zone D (negative control: straight RGB with `a = 0`) | `{40, 101, 180, 255}` | No emissive bleed when premultiplied contract holds |

### Claim 3: Pipeline compilation & dual-format mipmaps (`256×256`, 9 mip levels)

4 shaders salted per run via `const PROBE_SALT: u32` in [probeShaders.ts](file:///Users/petepetrash/Code/munari/instruments/webgpu-micro-probe/probeShaders.ts).

| Metric | Hardware (`metal-3`) | Fallback (`swiftshader`) |
|---|---|---|
| `createRenderPipelineAsync` total (4 shaders) | `1.8 ms` | `3.5 ms` |
| `rAF` max gap during async compile | `16.7 ms` (5 frames) | `16.8 ms` (5 frames) |
| `createRenderPipeline` sync total (4 shaders) | `0.1 ms` | `0 ms` |
| `rAF` max gap during sync compile | `16.7 ms` | `16.7 ms` |
| Level-4 mipmap readback (`rgba8unorm-srgb` / `rgba8unorm`) | `{200, 80, 40, 255}` / `{200, 80, 40, 255}` | `{200, 80, 40, 255}` / `{200, 80, 40, 255}` |

*Measurement caveat:* The 4 probe shaders are small blit/sample passes with only a scalar constant salt (`PROBE_SALT`), so Chrome's pipeline compiler/backend stayed sub-millisecond even synchronously; heavier real-material WGSL compilations still belong on `createRenderPipelineAsync` with write-free warmup until `isReady()`.

### Claim 4: Upload staging cost (`willReadFrequently: false` vs `true`)

| `willReadFrequently` | Hardware (`metal-3`) median / p90 | Fallback (`swiftshader`) median / p90 |
|---|---|---|
| `false` | `0.4 ms` / `0.6 ms` | `3.8 ms` / `4.2 ms` |
| `true` | `0.4 ms` / `0.6 ms` | `1.7 ms` / `2.0 ms` |

No penalty for `willReadFrequently: false` on Metal-3; `willReadFrequently: true` cut upload time roughly in half only on software SwiftShader.

---

## Step 2 — Micro-engine slices & production payload

Built under [instruments/webgpu-micro-probe/engine/](file:///Users/petepetrash/Code/munari/instruments/webgpu-micro-probe/engine/reactHost.tsx) and [instruments/webgpu-micro-probe/scenes/](file:///Users/petepetrash/Code/munari/instruments/webgpu-micro-probe/scenes/FlightSlice.tsx) directly against `@munari/core` (zero `three`, zero `@react-three/fiber`, zero `@types/three`, zero `react-reconciler`).

### Step 2a: `FlightSlice` (exclusive page-to-scene handoff + aero shader)

- **Before lift (`inScene = false`):** `presentation === 'page'`, `pageHidden === false`, `cardRect` `{left: 240, top: 40, width: 300, height: 170}`, typed note preserved (`"initial note + edited"`).
- **Airborne (`inScene = true`, `liftZ = 110`, `ry = 0.14`, `rx = -0.08`):** `presentation === 'scene'`, `pageHidden === true`, `note === "initial note + edited"`. Real Puppeteer click at projected 3D button coordinates incremented React state inside the parked capture DOM (`count: 0 → 1`).
- **After landing (`inScene = false`):** `presentation === 'page'`, `pageHidden === false`, `cardRect` restored to `{left: 240, top: 40, width: 300, height: 170}`, `count === 1`, `note === "initial note + edited"`.
- **Idle-zero check (`1000 ms` settle):** `renders: 0`, `paints: 0`.

### Step 2b: `FisheyeSlice` (deformed `2 × 326` mesh + 28-row lens pointer routing)

- **Flat baseline (`amp = 1`):** row 10 click routed to row `10`.
- **Warped (`amp = 2`):** row 9 (`shiftY: -60`), row 14 (`shiftY: 0`), row 19 (`shiftY: +60`) all clicked their intended rows inside the parked capture `<canvas>` (`instance: 'source'`).
- **Off-center `Done` button (row 9):** warped click at `shift {x: 2, y: -60}` triggered `acts` for row `9` with zero leak to the row click handler.
- **Keyboard & focus:** clicking `.fisheye-filter` and typing `'relay'` updated input value to `'relay'` (`matches: 5` of 28).
- **Idle-zero check (`1000 ms` unlock settle):** `renders: 0`, `paints: 0`.

### Step 2c: Vite 8 / Rolldown production payload comparison

Measured by [measurePayload.mjs](file:///Users/petepetrash/Code/munari/instruments/webgpu-micro-probe/measurePayload.mjs) in a clean `NODE_ENV=production` child process against `budgets.surface.gzipBytes` (`535,833 B`) in [instruments/payload/budgets.json](file:///Users/petepetrash/Code/munari/instruments/payload/budgets.json).

*(Correction note, 2026-11-27: Initial Step 2 / 2.5 measurements reported `reactBaseline: 113,900 B` gz because `run.mjs` called Vite `createServer()` in the same Node process before `measurePayload.mjs`, mutating `process.env.NODE_ENV = 'development'`. Spawning `measurePayload.mjs` with `NODE_ENV=production` restored the true React 19 production baseline of `58,732 B` gz, matching [docs/opt-in-dx-proposal.md](file:///Users/petepetrash/Code/munari/docs/opt-in-dx-proposal.md).)*

| Entry | Minified (`B`) | Gzip level 9 (`B`) | Brotli q11 (`B`) | Net over React (`B` gz) | TypeGPU modules |
|---|---|---|---|---|---|
| `reactBaseline` (`react` + `react-dom`) | `189,326` | `58,732` | `50,693` | `0` | `0` |
| `minimalSurface` (`MicroCanvas` + `MicroSurface` + `@munari/core`) | `242,041` | `77,572` | `67,254` | `+18,840` (`-458,261` vs Three/R3F budget) | `0` |
| `flightApp` (raw WGSL) | `247,267` | `79,119` | `68,751` | `+20,387` | `0` |
| `fisheyeApp` (raw WGSL) | `251,012` | `80,490` | `69,789` | `+21,758` | `0` |

---

## Seam lessons from building a second consumer over `@munari/core`

1. **Dock `source.host` inside React's root as a sibling of `pageEl`:** `createDomTextureSource` initially parks its `<canvas>` host under `document.body`, outside React 19's delegated listener root (`#root`). Moving `source.host` into a `display: contents; pointer-events: none` dock element inside `#root` restores React `onClick` / `onChange` delivery on synthetic events from `forwardPointer`. Placing that dock outside `pageEl` prevents `updatePageVisibility(..., true)` (`visibility: hidden`) from inheriting into the capture host when `inScene` starts `true` on initial mount.
2. **Chrome 158 parked canvas attribute (`content="drawable"` + `[data-munari-parked]`):** `htmlInCanvasEngine` produces `<canvas content="drawable" data-munari-parked="">`, not `[layoutsubtree]`. Selectors targeting parked DOM hosts must match `canvas[data-munari-parked]` (see [FisheyeSlice.tsx](file:///Users/petepetrash/Code/munari/instruments/webgpu-micro-probe/scenes/FisheyeSlice.tsx#L207)).
3. **`crossingProgress(ramp)` vs `crossingCurve(progress, 0, 1)`:** `crossingProgress` produces the monotonic `0 → 1` smoothstep used by `easedProgress`; `crossingCurve(progress, 0, 1)` is a `0 → 1 → 0` sine bell (`sin(0..pi)`), which evaluates back to `0` once `ramp === 1`.
4. **First-class WebGPU render-pass receipt:** `render()` invoking `onPassComplete` directly after GPU command submission avoids `frameReceipt` needing an after-effect hook just to confirm the pass ran, simplifying lifted-surface readiness and `pointerEvents` gating.
