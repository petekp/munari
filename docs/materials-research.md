# Materials and effects research

> **Status: research with measured GPU cost (nothing built).** Written 2026-11-23 against `three@0.186.1`. GPU costs were measured on an Apple M2 Pro in headless Chrome for Testing 156 ([§2](#2-measured-gpu-cost)). No preset API, material or lab scene described here exists yet. The per-candidate detail is in the [materials catalog](materials-research-catalog.md).

Three's `MeshPhysicalNodeMaterial` already provides most of the finishes a UI panel needs: clearcoat, sheen, iridescence, anisotropy and transmission with dispersion. Each of the four surface lobes costs 0.06 to 1.01 ms more per full screen at 2880×1800 on an M2 Pro, on top of the 0.76 ms that physical lighting costs. `MeshPhysicalNodeMaterial` measured 0.05 ms more than `MeshStandardNodeMaterial`, the base of `Surface.LitMaterial`, and it adds no bundle bytes, because `WebGPURenderer` already registers every node material ([payload research §2.4](payload-optimization-research.md#24-empirical-trap-check-what-does-not-save-bytes-in-threewebgpu)).

How a material treats the captured HTML matters more than its lighting model. A lobe that lights the text also puts highlights and tints on it. The polymer prototype's approach keeps text legible: it lights the body and lays the HTML over it unlit.

The recommendation is to offer physical finishes as preset objects on `Surface.LitMaterial`, with a choice of lit or unlit text. Custom shaders such as the polymer bevel and the glass compositor stay as copyable registry packs until their parameters settle. The first prototypes should be physical finishes, a polymer body on physical lighting, and a blurred backdrop for frosted glass ([§5](#5-shortlist-to-prototype-first)).

---

## 1. What Munari has today

| Material | Where | Does well | Falls short of the best candidates |
|---|---|---|---|
| `Surface.LitMaterial` | [surfaceMaterials.tsx](../packages/react/src/primitives/surface/surfaceMaterials.tsx) | Correct premultiplied handling: it divides alpha out before the sRGB decode, through the raw view in [surfaceLitTexture.ts](../packages/react/src/primitives/surface/surfaceLitTexture.ts) ([decisions.md #48](decisions.md#48)). Uses scene lights and environment. | Exposes only `roughness`, `metalness`, `emissiveIntensity` and `side`. It is `MeshStandardNodeMaterial`, so it has no coat, sheen, film or anisotropy. The text is the albedo, so every highlight lands on the text too. |
| Polymer prototype | [polymer-prototype/](../apps/lab/src/scenes/polymer-prototype/) (`PolymerTuning`, `POLYMER_PRESETS`) | A rounded-rect distance field gives an exact silhouette and a cushion normal in the body pass. A second material on a skirt mesh draws a ray-projected area-light shadow from the same field, with no shadow map. The HTML is composited unlit over the lit body, so text keeps its page color. Four presets (Delrin white, warm ABS, frosted silicone, mineral putty) mutate one tuning object at 60 fps without React renders. | Lighting is hand-built Blinn-Phong with a wrap term: it has no Fresnel, no energy conservation and no environment reflection. Its light is a CSS-space uniform, so it ignores the scene's lights. Grain is a `sin` hash. Presets are `Partial<PolymerTuning>` bags tied to this scene. |
| Glass registry pack | [registry/glass/](../registry/glass/) (`GlassParams`, `GLASS_DEFAULTS`) | Panels are distance fields composited far to near in linear light, so a panel refracts the glass and HTML behind it. The bezel normal comes from the merged field's gradient. Dispersion and frost share 8 spectral taps. Its README pins the ripple constants. | Frost is limited to those 8 jittered taps, which blur a radius of `rough × 0.05`. A heavy frost needs a pre-blurred backdrop. The pack owns render targets and pass order, so it runs as a compositor around the scene and cannot go in a `Surface.Mesh` material slot. |
| `passMaterial` | [passMaterial.ts](../packages/react/src/lib/passMaterial.ts) | States the render-target v-axis law that every multi-pass effect needs. | It is plumbing and has no look of its own. |

The constraints for any new material are in [scene-content.md](scene-content.md#materials-on-a-surfacecanvas) and [compositor-output.md](compositor-output.md). A material that samples a capture returns it through `premultipliedOutput`. A material that samples the canvas draws too bright. Over sRGB (40, 101, 180), stock transmission drew (110, 169, 219) ([decisions.md #72](decisions.md#72)). A compositor that draws Surfaces into targets attaches `useSurfaceOutput` to its final mesh.

---

## 2. Measured GPU cost

All values are GPU milliseconds per frame at 2880×1800 (1440×900 CSS px at device pixel ratio 2). At 120 Hz a frame has 8.3 ms.

| Material, one full-screen layer | Cost (ms) |
|---|---:|
| Basic textured plane (the capture sample alone) | 0.02 |
| Polymer body (lab `createPolymerBodyMaterial`) | 0.42 |
| `MeshStandardNodeMaterial`, the base of `Surface.LitMaterial`, without its alpha divide, sRGB decode and corner mask | 0.71 |
| `MeshPhysicalNodeMaterial` with no extra lobes | 0.76 |
| … with sheen | 0.82 |
| `MeshSSSNodeMaterial` | 0.87 |
| … with anisotropy (metal) | 1.07 |
| … with clearcoat | 1.13 |
| … with iridescence, at a constant 400 nm film | 1.77 |
| … with clearcoat, sheen, iridescence and anisotropy together | 2.37 |
| Basic plane plus 3-octave `mx_fractal_noise_float` grain | 1.73 |

| Whole-frame effect | Added cost (ms) |
|---|---:|
| Stock transmission plane over a depth-tested textured plane, compared with one opaque physical plane | +1.05 |
| … with `dispersion: 5`, on the same comparison (+1.40 over plain transmission) | +2.46 |
| `bloom()` | +0.58 |
| `gaussianBlur()` at sigma 8, full resolution | +2.57 |
| `gaussianBlur()` at sigma 8, half resolution | +0.86 |
| `dof()` | +2.80 |
| `ao()` (GTAO) with a normal MRT, half resolution | +4.00 |
| `ao()` (GTAO) with a normal MRT, full resolution | +15.02 |

Post-processing costs are measured against a `RenderPipeline` that only outputs the scene pass (0.98 ms).

### Method

- The machine was `m2`: Apple M2 Pro with a 19-core GPU, macOS 27.2.1. The browser was headless Chrome for Testing 156.0.8078.47 on the WebGPU backend (Metal 3), with `three@0.186.1` and the Munari checkout at revision `4985fe3`. The installed Chrome 158 on m2 failed to launch because its framework folder did not match its version.
- The scene had a `RoomEnvironment` PMREM and one directional light. Antialiasing was off. The capture was a stand-in 2D canvas of cards and text, not a live DOM capture.
- Each figure is the median of 3 trials, run in alternating order. Each trial takes the median of 8 batches of 30 frames, submitted back to back and timed to `queue.onSubmittedWorkDone()`. Trials agreed within 3.3% for every figure above 1 ms.
- Material cost is the slope between 1 and 6 full-screen layers, blended and drawn without depth test. The blend is needed because Apple's hidden-surface removal skips stacked opaque layers. An earlier opaque version of the bench measured 2.73 ms for both 1 and 6 layers with all four lobes; those results were not saved. A control shader with 18 noise octaves cost 11.37 ms for one layer and 66.51 ms for six. That is linear, so the method sees per-pixel work.
- Back-to-back post-processing renders skip their passes, because three advances its node frame once per animation frame. The bench called three's internal `renderer._nodes.nodeFrame.update()` before each render. That is a private API, used in the throwaway bench only.
- Three's GPU timestamps were not used. On this machine they read about twice the batched throughput of a single-pass frame, and they read negative for an empty frame.

### Limits

- These figures are for full-screen coverage. A 400×300 CSS px card at device pixel ratio 2 covers about 9% of this canvas. Linear scaling would put all four lobes on it at about 0.22 ms. That figure is an estimate and was not measured.
- An M2 Pro is a fast integrated GPU, so slower GPUs will cost more. Safari, the WebGL 2 fallback and capture upload were not measured.
- Throughput includes CPU encoding for cheap cases. The empty frame took 0.31 ms. Differences below about 0.05 ms are noise.

---

## 3. How a material interacts with the captured HTML

Every candidate in the catalog answers three questions.

- Does the text stay legible? Text that is lit as albedo picks up coat highlights, sheen and film tint. The polymer prototype's approach lays the capture over the lit body unlit. It needs a content root with a transparent background, so that the capture's alpha separates text from body. With an opaque card background in the HTML, alpha cannot tell text from body, and the material can only light both.
- Does it need the capture as an input? Refraction, frost and bloom sample what is behind the panel, so they need a render target of the scene, as [registry/glass](../registry/glass/) uses. A normal or roughness map built from the capture, such as embossed text, reads the same `surface.map` node as the color.
- Does it change hit testing? A material that changes only shading keeps the pointer mapping, because `Surface.Mesh` maps a pointer through the raycast hit's mesh UV. Glass draws the HTML unrefracted, so what you see is where you hit. Its `rippleInk` (0.02 of UV in the README) moves the drawn HTML in the shader, which the UV mapping cannot follow; this was not checked in a browser. A bevel that moves vertices changes the mapping and has to go through `deformSurfaceGeometry`, which keeps the mesh off the native pointer route ([decisions.md #39](decisions.md#39)).

A screen effect such as bloom, blur or depth of field needs a compositor. `SurfaceCanvas` draws straight to the canvas, so the compositor renders the Surfaces into a target and attaches `useSurfaceOutput` to its final mesh ([compositor-output.md](compositor-output.md)).

Screen-space AO, reflections and GI read the depth buffer. For a Surface, the depth buffer holds a flat plane, so these effects treat text and controls as flat color.

---

## 4. How presets could be offered

The API sketches below are proposals. None of them exists.

### Option A: copyable registry packs

Each material is a folder such as `registry/polymer/`, holding a TSL node file, a React component and an exported preset table, like `registry/glass`.

- Public API: no change. Packs import `@petepetrash/munari` and `/advanced` only.
- Bundle: an app pays for what it copies and nothing else.
- Maintenance: each pack needs a byte-identity test against its lab copy. Copies in apps do not get fixes, and three upgrades that break TSL break them silently.

### Option B: finish presets on `Surface.LitMaterial`

`Surface.LitMaterial` moves to `MeshPhysicalNodeMaterial` and accepts a finish object plus overrides:

```tsx
import { Surface, finishes } from '@petepetrash/munari'

<Surface.Mesh material={<Surface.LitMaterial finish={finishes.lacquer} clearcoatRoughness={0.1} content="unlit" />} />
```

- Public API: about ten optional props that map one-to-one to physical parameters, plus a frozen `finishes` table. A `content` prop takes `"lit"` or `"unlit"`. It says whether the capture is lit with the body or laid over it unlit. A finish is a plain object, so apps can write their own.
- Bundle: no added three bytes, for the reason in the opening section. The preset table is a few hundred bytes.
- Maintenance: Munari owns the parameter mapping and the unlit-text composite. Looks that need their own geometry or passes, such as the polymer bevel and glass, do not fit.

### Option C: a `@petepetrash/munari/materials` entry

A published subpath with material components (`PolymerMaterial`, `GlassPanel` and others), shared TSL helpers (rounded-rect field, bevel normal, analytic shadow, blue-noise grain) and their presets.

- Public API: the largest of the options. Each material's parameters become a versioned contract.
- Bundle: per-material if the build emits one module per source file, which [opt-in proposal Step 1](opt-in-dx-proposal.md#step-1-build-output-that-follows-imports) already does. The glass compositor alone is about 75 kB of source.
- Maintenance: Munari owns shader quality across three upgrades. Each material needs its own browser pixel checks before it ships.

### Option D: B for physical finishes, A for custom shaders

Physical finishes go on `Surface.LitMaterial` (B). The polymer body and glass stay registry packs (A), and a pack graduates to an entry (C) once its parameters stop changing.

### Recommendation: Option D

The hard part of a physical finish is shared by every app. That covers premultiplied alpha, the unlit-text composite and sensible ranges, and it costs the library no bundle bytes, so it belongs in `Surface.LitMaterial`. The custom shaders are still changing. The polymer prototype was added on 2026-11-21 and glass owns its own render loop. Publishing them now would freeze parameters nobody has tested. Option C alone would publish those APIs early, and Option A alone would make every app rebuild the physical mapping.

---

## 5. Shortlist to prototype first

1. Physical finishes on `Surface.LitMaterial`: lacquer, satin polymer, anodized aluminum, velvet and glazed ceramic, each with lit and unlit text. This is the cheapest to build and it tests Option B directly. The costs are measured: 0.76 to 1.13 ms per full screen for one lobe. It also gives the polymer demo's tweak panel real material parameters.
2. A polymer body on physical lighting. The prototype's distance-field bevel becomes the `normalNode` of a `MeshPhysicalNodeMaterial`, and its analytic shadow stays. It gains Fresnel, environment reflection and the scene's lights for about 0.34 ms more per full screen than today's body (0.76 against 0.42). A light clearcoat suits glossy ABS and sheen suits silicone.
3. A frosted backdrop: a half-resolution `gaussianBlur` of the scene behind a panel, sampled by the glass pass instead of its 8 jittered taps. It measured +0.86 ms at sigma 8. It makes heavy frost possible in glass and in the polymer prototype's translucent variant C.
4. A thin-film foil card, using physical `iridescence` applied only where there is no text. It costs 1.01 ms more than plain physical per full screen with a constant film. A film whose thickness varies needs `iridescenceThicknessNode`, whose cost was not measured. The film responds to the scene's lights and the view angle. CSS foil effects imitate that with pointer-driven gradients.
5. Blue-noise grain and dither from a CC0 texture, replacing the polymer `sin` hash. It removes banding in soft shadows and gradients for the cost of one texture fetch. A 3-octave procedural noise measured 1.73 ms per full screen, so procedural noise costs too much for grain.

GTAO, depth of field, SSR and caustics are left out of the first round. GTAO costs 4 to 15 ms and sees a Surface as flat. Depth of field blurs the text it is meant to frame. Caustics need custom TSL with no measured cost, for a look that suits few UI demos.
