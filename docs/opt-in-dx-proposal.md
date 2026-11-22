# Opt-in payload developer experience proposal

**Status: proposed, 2026-11-21. Runtime work is unbuilt.**

Companion to [payload-optimization-research.md](payload-optimization-research.md). The names `@petepetrash/munari/stage`, `@petepetrash/munari/kernel`, `@petepetrash/munari/vite`, `<SurfaceStage>`, `<StageSurface>`, and `<BareSurfaceCanvas>` below are proposed interfaces, not shipped exports.

---

## 1. The DX problem: why naive bundle splitting hurts callers

[Payload optimization research](payload-optimization-research.md) showed that a minimal flat `<Surface>` ships `519.6 kB` gzip today (`+462.3 kB` over React), even though `@munari/core` is `14.6 kB` gzip and the full `@petepetrash/munari` binding is `54.6 kB` gzip.

Fixing that payload naively — by shattering `@petepetrash/munari` into seven micro-subpaths (`/lite`, `/lit`, `/anchors`, `/deform`, `/focus`, `/native-pointer`, `/capture`) or adding `enableX()` plugin registrations — trades a byte problem for three worse authoring problems:

1. **Premature classification tax:** Before rendering one card, the caller has to predict whether next week's iteration will add a `<directionalLight>`, a `<Surface.Anchor>`, or mesh bending, and pick the matching entry point up front.
2. **Split-brain registration bugs:** Requiring both a local JSX prop (`pointerRoute="auto"` or `<Surface.Anchor>`) *and* a distant startup call (`enableNativePointerRoute()` in `main.tsx`) splits one decision across two files. Forgetting the startup call either silently degrades behavior or throws at runtime.
3. **Silent JSX crashes in R3F:** `@react-three/fiber` declares `<ambientLight>`, `<directionalLight>`, and `<boxGeometry>` in global TypeScript JSX types. If `<SurfaceCanvas>` silently stopped calling `extend(THREE)` to save `84.7 kB` gzip, existing code would pass `tsc` with zero errors and crash on mount (`R3F: AmbientLight is not part of the THREE namespace`).
4. **Refactoring cliffs between tiers:** If a lightweight DOM-shader wrapper uses different material hooks, coordinate conventions, or CSS authoring rules than `<SurfaceCanvas>`, outgrowing the lightweight tier forces a rewrite.

---

## 2. Design principles

Using deep-module design criteria (*interface*, *depth*, *seam*, *adapter*, *leverage*, *locality*):

1. **Organize entry points around authoring posture, not internal subsystems.** Callers know *how they are building* ("DOM + shader on a React page" vs. "3D world in React Three Fiber" vs. "zero-Three micro-transition"), not which internal kernel helpers run underneath.
2. **Tree-shaking is the bundler's job; registration seams are only for environment adapters.** Feature modules (`FocusScene`, `Dial`, `deformSurfaceGeometry`, `useElementCapture`, `encodedOutput`) opt in automatically when imported and vanish when omitted. Global `enableX()` seams are reserved strictly for environment-wide adapters that swap behavior underneath an unchanged component interface — specifically `@petepetrash/munari/snapdom` ([decisions.md #60](decisions.md#60)).
3. **Preserve compound `<Surface.*>` ergonomics.** Keeping `Root`, `HTML`, `Scene`, `Mesh`, `Anchor`, and `LitMaterial` together on `Surface` costs only `~3.0 kB` gzip of Munari code (`MeshStandardNodeMaterial` is already inside `WebGPURenderer`). Shattering `Surface.*` saves almost nothing while breaking every existing scene and guide.
4. **Zero-cliff graduation.** Authoring rules ([authoring.md](authoring.md)), TSL output helpers (`premultipliedOutput`, `encodedOutput`, `surfaceRadiusMask`), `deformSurfaceGeometry`, and `enableSnapdomCapture()` stay identical across tiers. Moving from a lightweight stage to a full R3F `<SurfaceCanvas>` changes the outer host wrapper, never the card's HTML, CSS, or shader math.
5. **Never turn a TypeScript pass into a runtime crash.** Any host that omits R3F's wildcard `extend(THREE)` must carry a distinct name (`<BareSurfaceCanvas>`) and an explicit `catalogue` prop, with actionable development diagnostics.

---

## 3. Three caller postures, one coherent package

All entries remain inside the single published package `@petepetrash/munari` ([decisions.md #1](decisions.md#1)), with `@react-three/fiber` promoted to an **optional** peer dependency in `peerDependenciesMeta` alongside `@zumer/snapdom`.

| Caller posture | Proposed entry | Peers installed | Total app gzip (net over React) | When to choose it |
|---|---|---|---:|---|
| **Posture A: React DOM + Shader / 2.5D UI** | `@petepetrash/munari/stage` | `react`, `react-dom`, `three` *(no R3F)* | **`~306 kB`** (`+249 kB`) — *zero bundler config* | Lit cards, Genie-style bends, liquid-glass lenses, DOM transitions on ordinary web pages |
| **Posture B: Full 3D R3F Scene** | `@petepetrash/munari` (+ `@petepetrash/munari/vite`) | `react`, `react-dom`, `three`, `@react-three/fiber` | **`~442 kB`** default / **`~357 kB`** `<BareSurfaceCanvas>` | Multi-surface 3D rooms, Drei `<Environment>` / `<OrbitControls>`, GLTF models, `<FocusScene>`, `<Dial>` |
| **Posture C: `<20 kB` Micro-Effect** | `@petepetrash/munari/kernel` + `registry/shader-quad` | `react`, `react-dom` *(0 B of `three` bundled)* | **`~75 kB`** (`+18 kB`) | Design-system button ripples, blur headers, single-quad transitions with strict bundle budgets |
| **Cross-browser Safari / Firefox / iOS** *(any posture)* | `@petepetrash/munari/snapdom` *(dynamic `import()`)* | `+ @zumer/snapdom` *(loaded only when needed)* | `+0 kB` on Chrome 157+ / `+88 kB` fallback | Progressive cross-browser 3D capture |

---

## 4. Authoring walkthrough by posture

### 4.1 Posture A — `@petepetrash/munari/stage` (React DOM + TSL, no R3F)

Today, lifting a single HTML card into lit 3D requires installing `@react-three/fiber`, wiring `useId()` + `useSurfaceSupport()`, configuring six overlay props on `<SurfaceCanvas>` (`pointerMode="surfaces"`, `frameloop="demand"`, `gl={{ alpha: true }}`, `onCreated={({ gl }) => gl.setClearAlpha(0)}`, `style={{ position: 'absolute', inset: 0 }}`), and shipping `519.6 kB` gzip. Five scenes in `apps/lab` (`Light`, `Lamp`, `Rain`, `Wordmark`, `Gravity` fallback) already bypass R3F by hand to avoid this overhead.

`@petepetrash/munari/stage` turns that hand-rolled pattern into a deep module backed directly by `three/webgpu` (`WebGPURenderer` + `DirectRenderPipeline`, [decisions.md #69, #72, #73](decisions.md#69)):

```tsx
import { useState } from 'react'
import { SurfaceStage, StageSurface } from '@petepetrash/munari/stage'
import '@petepetrash/munari/style.css'

export function LitNoteCard() {
  const [lifted, setLifted] = useState(false)

  return (
    <SurfaceStage lights="studio">
      <StageSurface
        inScene={lifted}
        lit={{ roughness: 0.32, metalness: 0.05 }}
        pose={{ z: lifted ? 28 : 0, rotateX: lifted ? -0.12 : 0 }}
      >
        <article className="note-card">
          <h3>Quarterly notes</h3>
          <input defaultValue="Editable before, during, and after lift" />
        </article>
      </StageSurface>

      <button type="button" onClick={() => setLifted((v) => !v)}>
        {lifted ? 'Return to flat HTML' : 'Light in 3D'}
      </button>
    </SurfaceStage>
  )
}
```

**Why this interface is deeper and lighter at the same time:**
- **Zero R3F ceremony or peer conflict:** Callers only run `npm install @petepetrash/munari three@0.186.1 --save-exact`. No `useId()`, no `setClearAlpha(0)`, no `scale={1 / 120}` world-unit math (`pose` and `deform` operate in CSS pixels and radians).
- **`-213.5 kB` gzip out of the box with zero bundler config:** Because `@petepetrash/munari/stage` (and all internal Munari files once switched from `'three'` to `'three/webgpu'`) never imports `'three'` (`three.module.js`), Vite, Next.js, and Webpack never pull in legacy `THREE.WebGLRenderer`, GLSL `ShaderLib`, or R3F's `react-reconciler`. (Verified: `three` and `three/webgpu` share the exact `three.core.js` class references, so `instanceof` remains `true` even if caller code imports `'three'`.)
- **In-place DOM lenses included:** `/stage` also hosts `useElementCapture` + `useStageCaptureTexture(capture)` for `Veil`- and `Selection`-style glass/blur overlays without R3F.
- **Clean graduation to Posture B:** Custom TSL node materials (`MeshBasicNodeMaterial`, `premultipliedOutput`, `surfaceRadiusMask`) and `deform` functions (`(x, y) => ({ x, y, z })`) carry straight into `<SurfaceCanvas>` + `<Surface.Mesh>` without rewriting shader or CSS code.

### 4.2 Posture B — `@petepetrash/munari` + `@petepetrash/munari/vite` (Full R3F 3D Scenes)

For developers building multi-object 3D scenes in `@react-three/fiber`, **nothing in their existing component code changes**:

```tsx
import { SurfaceCanvas, Surface, FocusScene, Dial } from '@petepetrash/munari'
```

Instead, three behind-the-seam improvements cut payload automatically while preserving full compatibility:

1. **Automatic per-export tree-shaking (`tsdown` `unbundle: true` + `/* @__PURE__ */`):**
   - Today, importing `encodedOutput` alone drags in `39.6 kB` gzip of Munari and `169 kB` gzip of Three/R3F because `dist/index.js` evaluates unannotated `Object.assign` calls.
   - Emitting per-module ESM in `dist/` (with `@munari/core` bundled into internal `dist/_core/*` modules) means a scene that imports `{ SurfaceCanvas, Surface }` automatically drops `FocusScene`, `FocusGroup`, `Dial` (`-8.7 kB` gz), `useElementCapture` (`-8.1 kB` gz), and `deformSurfaceGeometry` until imported.
2. **One-line bundler plugin `@petepetrash/munari/vite` (`-77.6 kB` gzip, zero code edits):**
   ```ts
   // vite.config.ts
   import { munari } from '@petepetrash/munari/vite'
   export default defineConfig({ plugins: [react(), munari()] })
   ```
   `munari()` aliases bare `'three'` to `'three/webgpu'` (with an equivalent 3-line `resolve.alias` / `turbopack.resolveAlias` snippet documented for Next.js). Every R3F intrinsic (`<ambientLight>`, `<directionalLight>`, `<boxGeometry>`) and `@react-three/drei` helper continues to work unchanged, while `three.module.js`'s duplicate legacy `WebGLRenderer` + GLSL `ShaderLib` (`331.0 kB` min / `77.6 kB` gz) vanishes from the bundle.
3. **Opt-in `<BareSurfaceCanvas catalogue={...}>` (`-84.7 kB` additional gzip) + `overlay` preset:**
   - First, add an `overlay` boolean preset on both `<SurfaceCanvas overlay>` and `<BareSurfaceCanvas overlay>` that expands to transparent alpha, `setClearAlpha(0)`, `pointerMode="surfaces"`, and `position: absolute; inset: 0`, retiring the 6-prop boilerplate from overlay scenes.
   - Second, for R3F apps that want to drop unused `THREE.*` classes (`SkinnedMesh`, `Audio`, `ExtrudeGeometry`), export `<BareSurfaceCanvas catalogue={{ AmbientLight, DirectionalLight }}>` built on R3F's `createRoot` + `FiberProvider` (`357.3 kB` gz total app). In development, if an un-registered JSX tag mounts inside `<BareSurfaceCanvas>`, catch R3F's error and print:
     `Munari <BareSurfaceCanvas>: <directionalLight> is not registered. Pass catalogue={{ DirectionalLight }} from 'three/webgpu', or use <SurfaceCanvas>.`

### 4.3 Posture C — `@petepetrash/munari/kernel` + `registry/shader-quad` (`+18 kB` gzip micro-effects)

Today, `@petepetrash/munari/advanced` mixes `export * from '@munari/core'` with `FrameSurface` and `passMaterial` (`three/webgpu` + `@react-three/fiber`), so a developer cannot consume Munari's zero-dependency DOM/capture kernel without pulling Three and R3F into the bundle.

Adding `@petepetrash/munari/kernel` (re-exporting only `@munari/core` + pure React lifecycle hooks like `useSurfaceSupport` with **zero** imports from `three` or `@react-three/fiber`) paired with a copyable `registry/shader-quad` recipe (`~120` lines of raw WebGL 2 / WebGPU single-quad boilerplate, following the `registry/focus-orbit` precedent in [decisions.md #6](decisions.md#6)) gives design-system authors:
- Zero-flash handoff coordination (`createSurfaceCoordinator`),
- `Element.moveBefore` + Safari focus/selection/scroll preservation (`relocatePreservingState`),
- `<canvas content="drawable">` + `drawElementImage` + `storeForBox` hysteresis + `chooseCaptureMemory` software-GPU protection (`createDomTextureSource`),
- **`~75 kB` gzip total app (`+18 kB` net over React)** — while keeping `@petepetrash/munari` completely free of non-Three renderer abstractions ([decisions.md #1](decisions.md#1)).

### 4.4 Zero-ceremony cross-browser fallback (`@petepetrash/munari/snapdom`)

The existing dynamic-import pattern in `main.tsx` stays the canonical cross-browser story:

```ts
import { supportsSurfaces } from '@petepetrash/munari' // or '/stage'

if (!supportsSurfaces()) {
  const { enableSnapdomCapture } = await import('@petepetrash/munari/snapdom')
  await enableSnapdomCapture()
}
```

Two small refinements make this cleaner and `10.3 kB` gzip lighter:
1. **Lazy `isolatedTextInputs` inside `enableSnapdomCapture()`:** Return `Promise<void>` (still synchronous-compatible for callers who don't pass `isolatedTextInputs`, or `await`-able when `isolatedTextInputs` dynamically `import()`s `snapdomInputRegions`), cutting default `dist/snapdom.js` by **61%** (`18.5 kB` gz -> `8.2 kB` gz).
2. **Chrome 157+ pays `0 B`:** Because `supportsSurfaces()` is `true` natively in Chrome 157+, the dynamic `import('@petepetrash/munari/snapdom')` chunk (`+88 kB` gzip with `@zumer/snapdom`) is never fetched on Chromium.

---

## 5. Rejected DX alternatives

| Alternative considered | Why it is rejected |
|---|---|
| **Split `Surface` into `SurfaceRoot` + separate `/lit` and `/anchors` subpaths** | Saves `0.0 kB` of Three.js (since `WebGPURenderer` owns `StandardNodeLibrary`) and only `~3.0 kB` gzip of Munari code, while breaking `<Surface.Anchor>` / `<Surface.LitMaterial>` muscle memory across docs, demos, and agent skills. |
| **Add `enableNativePointerRoute()`, `enableFocusScene()`, `enableAnchors()`** | Violates locality: callers already declare intent via imports (`FocusScene`) or props. Global `enableX()` calls create silent "forgot to register in `main.tsx`" bugs. |
| **Silently remove `extend(THREE)` inside existing `<SurfaceCanvas>`** | Causes `<ambientLight />` and `<boxGeometry />` to typecheck cleanly in TypeScript and throw at runtime. Explicit `<BareSurfaceCanvas catalogue={...}>` makes the contract honest. |
| **Import `three/src/renderers/webgpu/WebGPURenderer.nodes.js` inside Munari** | Mixes `three/src/*` with consumer `three/webgpu` (`three/build/*`), duplicating `Object3D`/`NodeMaterial` classes, breaking `instanceof` checks, and inflating bundles to `1.40 MB` min. |
| **Publish separate `@munari/core` or `@munari/stage` npm packages** | Violates [decisions.md #1](decisions.md#1) and [#11](decisions.md#11): multiple versioned npm packages invite duplicate kernel/registry state (`captureEngine` singleton split-brain). Subpaths in `@petepetrash/munari` share one private `dist/_core/*` graph. |

---

## 6. Rollout & regression-prevention plan

Each step ships independently, preserves existing scenes, and locks its savings behind an automated test:

1. **Step 1 — Unbundle `dist/` + pure annotations + internal `'three/webgpu'` imports + `tests/bundleBudgets.test.ts` *(zero public API change)*:**
   - Update [tsdown.config.ts](../packages/react/tsdown.config.ts) and [stage-manifest.mjs](../packages/react/scripts/stage-manifest.mjs) to emit module-preserving ESM with `@munari/core` inlined under `dist/_core/*`; annotate `/* @__PURE__ */` on `Object.assign` and `createContext`; decouple `copyFieldState` from `elementCapture.tsx`; switch internal value imports from `'three'` to `'three/webgpu'`; lazy-load `isolatedTextInputs` in `snapdom.ts`.
   - Add `tests/bundleBudgets.test.ts` (running Rolldown in Vitest against staged `packages/react/dist`) asserting hard byte ceilings on `useSurfaceSupport`, `encodedOutput`, `useElementCapture`, `FocusScene`, and default `snapdom` so accidental cross-imports fail CI immediately.
2. **Step 2 — `@petepetrash/munari/vite`, `<SurfaceCanvas overlay>`, and `<BareSurfaceCanvas>` *(additive, non-breaking)*:**
   - Ship the `'three' -> 'three/webgpu'` Vite plugin (`-77.6 kB` gz across `apps/lab` immediately!), the `overlay` prop shorthand, and `<BareSurfaceCanvas catalogue={...}>` (`-162.3 kB` gz).
3. **Step 3 — `@petepetrash/munari/kernel` + `registry/shader-quad` *(additive)*:**
   - Expose the pure zero-Three kernel subpath (`+14.6 kB` gz) and add one copyable single-quad WebGL 2 / WebGPU transition item under `registry/`.
4. **Step 4 — `@petepetrash/munari/stage` + optional `@react-three/fiber` peer *(additive)*:**
   - Mark `@react-three/fiber` optional in `peerDependenciesMeta`, build `<SurfaceStage>` + `<StageSurface>` over `SurfaceRoot` + `WebGPURenderer` + `DirectRenderPipeline`, and migrate at least two non-scene demos in `apps/lab` (e.g. `Veil` or `Postcard`) to prove parity across enhanced Chrome 157 and `snapDOM` gates.
5. **Step 5 — Agent skill & docs sync:**
   - Update `README.md`, `llms.txt`, and `.agents/skills/munari/SKILL.md` with the three-posture decision table so both humans and coding agents default to `/stage` for page UI effects and `.` for 3D R3F worlds.
