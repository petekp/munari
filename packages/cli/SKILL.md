---
name: munari-gpu
description: Author TypeGPU WebGPU materials, compile zero-dependency manifests, wire retained-DOM SurfaceCanvas/Surface scenes, and verify transitions with frameloop="manual".
---

# Munari GPU Material & Surface Authoring

Write real WGSL shaders in TypeScript, compile them AOT with `munari compile`, and drive interactive DOM-to-WebGPU `Surface` transitions verified pixel-by-pixel with deterministic `manual` frames.

## 1. Discover Existing Materials & Runtime API

```bash
munari init            # initialize munari.json in a project
munari list            # shows [gpu], [shared], or [three] runtime per entry
munari info --json     # exports, compiled files, frameloop="manual" API, frameUniforms
munari add <name>      # vendor a starter shader (e.g. liquid-glass, frosted, shadow)
```

## 2. Author a `*.material.ts` Shader

Default-export `defineGpuMaterial(...)` (or `defineManifestMaterial({ name, vertex, fragment, uniforms?, needsBackdrop? })` when writing custom vertex/fragment passes outside `[0,1]` into `bleed`). Inside `defineGpuMaterial`, `shade(ctx)` takes and returns **straight linear RGB + alpha** while Munari applies `sampleSurfaceLinear`, `surfaceRadiusMask`, `srgbOetf`, premultiply, and discard (`alpha < 0.004`).

```ts
import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import {
  createMaterialUniformLayout,
  defineGpuMaterial,
  sampleBackdropLinearLod,
  SurfaceFragmentIn,
  surfaceLayout,
} from '@petepetrash/munari-cli/author'

const uniformsSchema = d.struct({ strength: d.f32, tint: d.vec3f })
const layout = createMaterialUniformLayout(uniformsSchema)

export default defineGpuMaterial({
  name: 'custom-finish', // `munari compile` emits `export const customFinishManifest`
  needsBackdrop: false, // set true + sampleBackdropLinearLod(...) for refraction/blur
  animated: false, // true requests continuous ticks even when `frameloop="demand"`
  uniforms: { schema: uniformsSchema, layout, initial: { strength: 1, tint: d.vec3f(1, 1, 1) } },
  shade: tgpu.fn([SurfaceFragmentIn], d.vec4f)((ctx) => {
    'use gpu'
    const f = surfaceLayout.$.frame
    const u = layout.$.u
    const timeSec = f.camera.z
    // ctx: uv(vec2f, [0,1] card box, Y-up 0=bottom..1=top; extends across bleed), color(vec3f linear),
    // alpha(f32), worldPos(vec3f), worldNormal(vec3f), localNormal(vec3f), screenPos(vec4f top-down px).
    const lit = ctx.color.mul(u.tint).add(std.max(ctx.worldNormal.z, 0.0) * 0.02 * u.strength)
    return d.vec4f(lit, ctx.alpha)
  }),
})
```

`surfaceLayout.$.frame` (`256 B`): `mvp: mat4x4f`, `modelWorld: mat4x4f`, `size: vec2f` (card px), `viewport: vec2f` (canvas px), `radii: vec4f` (`[tl, tr, br, bl]` px), `camera: vec4f` (`[cameraZ, dpr, timeSec, dtSec]`), `keyPos: vec4f` (`[sceneX, sceneY, sceneZ, brightness]`), `keySize: vec4f` (`[w, h, envIntensity, rimBrightness]`), `rimDir: vec4f`, `uvRect: vec4f` (`[0, 0, 1, 1]`).

Backdrop (`needsBackdrop: true`): `sampleBackdropLinearLod(ctx.screenPos.xy.div(f.viewport), lod)` -> linear `vec4f(rgb, alpha)`. LTC area lighting: `createLtcMaterialLayout(schema)` + `ltcEvaluate`.

## 3. Compile & Verify Artifacts

```bash
munari compile         # compiles *.material.ts -> sibling *.material.gen.ts exporting <camelName>Manifest
munari check --deep    # checks manifest freshness, ABI hashes, and TypeGPU warnings
```

Import the generated manifest by its camelCased name: `import { customFinishManifest } from './customFinish.material.gen'`.

## 4. Wire `<SurfaceCanvas>` & `<Surface>` (`@petepetrash/munari/gpu`)

```tsx
import {
  SurfaceCanvas,
  Surface,
  createSurfaceLight,
  supportsCapture,
  detectHtmlInCanvas,
  paintStats,
  requestGpuFrame,
  getGpuHostStats,
  stepGpuFrame,
  settleGpuFrames,
} from '@petepetrash/munari/gpu'
```

- **Tree & transitions**: place `<Surface inScene={bool}>` inside `<SurfaceCanvas id="main">` (or pass `canvasId="main"`). Toggling `inScene` drives `phase` `'page' -> 'entering' -> 'scene' -> 'landing' -> 'page'` and `presentation` (`'page' | 'scene' | 'none'`). `exclusive` hides the retained DOM slot once presented in-scene.
- **`SurfaceCanvas`**: `id?`, `frameloop?: 'demand' | 'always' | 'manual'`, `pointerMode?: 'scene' | 'surfaces'`, `fov?: number` (default `42`), `lighting?: 'studio' | 'none' | { key?: SurfaceLight | KeyLight, rim?, environmentIntensity? }`.
- **`createSurfaceLight({ x?, y?, z?, brightness?, size?: [w, h], follow?: 'pointer' })`**: client CSS px key-light handle; pass via `lighting={{ key: light }}` and mutate with `light.set(...)` without React re-renders.
- **`Surface`**: `canvasId?`, `inScene?`, `exclusive?`, `size?: [w, h]` (DOM-measured if omitted), `bleed?: number | [bx, by]` (px), `shadow?: boolean | { opacity?, blur?, spread?, elevationScale?, color? }`, `finish?: SurfaceFinish`, `material?: MaterialManifest<T>`, `uniforms?: T`, `onFrame?: (ctx) => boolean | void`, `onPresentationChange?: (p) => void`.
- **`onFrame(ctx)`**: `dtMs`, `elapsedMs`, `progress`, `easedProgress`, `phase`, `presentation`, `size`, `pageRect`, `basePose`, `pose` (`{ x, y, z, rx?, ry?, rz?, sx?, sy?, sz? }` in CSS px & radians), `setPose(p)`, `snapPose(x, y, mag?)`, `deform((lx, ly, i) => ({ x, y, z? }))` (`lx, ly` card-local px returning absolute vertex position), `setUniforms(fullValues)` (use number tuples like `[1, 1, 1]` for `vec*f`). Return `true` to keep drawing.
- **Capabilities & telemetry**: `supportsCapture()` / `detectHtmlInCanvas()`, `paintStats()`, `getGpuHostStats(id)`, `requestGpuFrame(id)`.
- **Pointer events**: in `'scene'` mode, HTML child handlers (`onPointerDown`, clicks) receive relayed synthetic events (`isTrusted === false`), while `window` sees native events.

## 5. Inspect Transitions Deterministically in Chrome (`manual` Mode)

1. Mount `<SurfaceCanvas id="inspect" frameloop="manual">`.
2. Both helpers are **synchronous**: `stepGpuFrame('inspect', dtMs)` returns `{ stepped, renderCount, elapsedMs, workClaims }`; `settleGpuFrames('inspect', { dtMs: 16, maxSteps: 90 })` steps until `workClaims === 0` and returns `{ steps, settled, renderCount, elapsedMs, workClaims }`.
3. Capture Chrome WebGPU keyframes across lift, landing handoff, and post-return HTML rest (`0` pixel diff after return).
