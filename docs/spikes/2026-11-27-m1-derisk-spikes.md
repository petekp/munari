# M1–M5 De-Risk Spikes (Pre-M1 Validation)

**Date:** 2026-11-27  
**Baseline:** `pkp/munari-gpu` (`edb501c`)  
**Questions tested:** Can the 4-layer architecture hold across (1) unflagged browsers + snapDOM, (2) TypeGPU `0.12.x` M2 finish shaders, (3) Three.js visual parity, (4) spring + shadow-quad feel, and (5) cold-agent authoring — and what must M0.5–M5 fix or adjust?

---

## Summary of Outcomes & Design Implications

| Spike | Verdict | Verified Finding & Action |
|---|---|---|
| **1. Unflagged WebGPU (`CanvasDrawElement` OFF)** | **Crash confirmed on `?capture=none`; snapDOM works** | With `capture=auto` (snapDOM), Flight lifted in `815 ms` (one cold run including page load), airborne click hit `1`, `row: 9` clicked, `idleRenders: 0`, `0` errors. With `?capture=none` (and in any browser lacking native capture + snapDOM), `<Surface>` throws `UnsupportedPlatformError` in `useLayoutEffect`, unwinding into `SceneBoundary` regardless of WebGPU availability. **Action (M0.5):** Stay on `'page'` gracefully when capture is absent, export `supportsCapture` in `/gpu`, and add both gates to `gate:gpu`. |
| **2. TypeGPU `0.12.x` Compiler Ceiling** | **Metal-3 compile/pipeline OK; not drawn** | Multi-file `'use gpu'` blocks + `@group(0)`–`@group(3)` compiled (`5,662 B` WGSL) and created Metal-3 pipeline (`203.5 ms`, `0` errors); no pixels were drawn and D3D12/Vulkan remain untested. TypeGPU `0.12.12` logs a `logger.warn('implicit-conversion', ...)` and silently emits `i32(...)` when `let acc = 0.0` lowers to integer. **Action (M0.5/M1):** Hard-fail `munari compile` on implicit-conversion warnings, fix `generateMaterialSource` options arg + tuple types, move M1 static textures into `@group(1)`. |
| **3. Three.js vs `/gpu` Finish Parity (DPR 2)** | **Gap real; comparison uncontrolled** | The two captures differed in preset values (`#1b2247` / gain `2.5` vs `velvetMidnight` `#141a3a` + pile + edge), light rig (pointer point light vs softbox), and content. [finishMaterial.ts](file:///Users/petepetrash/Code/munari/packages/react/src/gpu/finishMaterial.ts) has no LTC or environment lighting — it is additive Blinn-Phong scaled by `lightGain`. **Action (M2):** Build a controlled parity probe first, then replace `finishMaterial.ts` with compiled TypeGPU finishes and a backdrop blur/mip chain. |
| **4. Spring + Shadow Quad (DPR 2)** | **Loop & input OK; shadow never rendered** | Saved capture shows **no shadow** outside the card (all surrounding pixels match background `(238, 242, 247)`): the shadow `<Surface>` used `exclusive={false}`, which renders no page slot so `ctx.pageRect` is always `null`, causing `onShadowFrame` to return early at `opacity: 0`. Also the quad mounted a full `<Surface>` DOM capture source (not content-less) and used semi-implicit Euler integration rather than a closed-form analytic spring. Airborne/landed clicks (`1` -> `2`), `idleAtRestRenders: 0`, and `33` non-stalled rAF gaps (`16.7 ms` median) hold. **Action (M0.5/M3):** Add `ctx.basePose` + `onFrame(): boolean` in M0.5; re-run content-less shadow + analytic spring in M3 with an asserted pixel check. |
| **5. Cold Blind-Agent Authoring Trial** | **`n = 1`, compiled, never rendered** | One agent read the draft 1-page guide + JSON catalog and compiled `tiltSheen.material.ts` (`3,804 B` WGSL, `0` oxlint errors; WGSL not browser-validated). Both `frameloop` toggling and manual pose math in `HoverLiftCard.tsx` came from our own draft guide; `ctx.pageRect` nullability and manual decode/premultiply caused the main friction. **Action (M1):** Linear-color builder hooks + `ctx.basePose` + `onFrame(): boolean` + 3-agent M1 benchmark with browser render verification. |

---

## Measured Evidence Notes

- **Spike 1:** Saved `run-browser-spikes.mjs` passed `?capture=native`, which [captureMode.ts](file:///Users/petepetrash/Code/munari/apps/lab/src/captureMode.ts) maps to `'auto'` (snapDOM). The separate `?capture=none` run reproduced `UnsupportedPlatformError: munari: this browser has no drawElementImage...` in `SceneBoundary` with `hasNote: false` and `hasBtn: false`.
- **Spike 2:** `author.ts:85` (`0.0`) -> WGSL `0`, confirming `0.0` becomes `i32` in TypeGPU `tgsl/conversion.js:284`; implicit float truncation only emits `console.warn('implicit-conversion', ...)` unless intercepted at compile time. `munari compile` validates only via stub device (`compiler.mjs:38`), not Dawn/browser WGSL validation.
- **Spike 3:** Controlled parity requires matching preset, light rig, and DOM tree across Three.js (`finishNodes.ts` / `finishTransmission.ts`) and `/gpu`. Backdrop snapshotting currently allocates `mipLevelCount: 1` without `RENDER_ATTACHMENT`, so M2 frosted glass requires a mip/blur pass prerequisite.
- **Spike 4:** `traceSamples` confirmed `idleAtRestRenders: 0` across `600 ms` settle, `clicks: 1` airborne and `clicks: 2` landed. Adding `ctx.basePose` (never `null`, defined at canvas origin for `exclusive={false}`) eliminates the early-return bug.
