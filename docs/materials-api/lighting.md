# Materials and lighting API: lighting and light control

Part of the [materials and lighting API proposal](../materials-api.md). Status: proposal. Nothing in it is built, and code blocks marked "Sketch" show an API that does not exist yet.

## 3. Lighting

The question is where lights and the environment are declared, what a
finish sees when none are, and which lights work with which finish.

### What three r186 does with each light

Checked in three 0.186.1 source (`PhysicalLightingModel`,
`RectAreaLightNode`, `EnvironmentNode`, `HemisphereLightNode`).

| Light | Diffuse | Base reflection | Clearcoat | Sheen | Anisotropy | Iridescence |
|---|---|---|---|---|---|---|
| ambient, hemisphere | yes | no | no | yes, as indirect light | no | no |
| point, spot, directional | yes | yes | yes | yes | yes | yes |
| `RectAreaLight` (softbox) | yes | yes, isotropic | yes | no | no | no |
| environment (PMREM) | yes | yes | yes | yes | yes, bent normal | yes |

A softbox gives velvet no sheen and aluminum no stretched highlight. The
lab works around velvet's case by evaluating sheen from the softbox's
center as a point light in the material (`keySheen`). A `RectAreaLight`
also needs `RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init())`.
Those lookup tables bundle to 247 kB, 103 kB gzip (rolldown 1.2.2
`--minify`, three external).

Lights also decide when lit materials compile. `LightsNode` keys its cache
on each light's id and `castShadow`, plus a spot light's map and color
node, and the render list collects only visible lights. Adding, removing, hiding or showing a light, or toggling
its shadow, rebuilds every lit material on that canvas. Moving a light or
changing its intensity or color is a uniform update.

### A. Lights as canvas children, as today

```tsx
<SurfaceCanvas id="shop">
  <ambientLight intensity={0.4} />
  <pointLight position={[0, 0.3, 1.2]} intensity={40} />
</SurfaceCanvas>
```

A three developer has nothing new to learn. Positions are world units in
front of a camera Munari places, so a light "300 px above the page, over
the cart button" needs the unprojection math the lab wrote. Every page
builds its own environment and sets up the softbox tables, and a finish on
a bare canvas is black.

### B. A canvas `lighting` prop with a default rig

```tsx
// Sketch — not built.
<SurfaceCanvas id="shop" />                       // studio rig
<SurfaceCanvas id="shop" lighting="softbox" />
<SurfaceCanvas id="shop" lighting={{ rig: 'studio', key: { x: 640, y: 520, z: 480, power: 1.55 } }} />
<SurfaceCanvas id="knobs" lighting="none">…your own lights…</SurfaceCanvas>
```

The canvas owns one rig, placed in page CSS terms the way the lab places
its studio: `x` and `y` in client CSS px, `z` in CSS px above the page,
and `power` as irradiance straight under the key. Munari converts to
world space each frame, before the draw, with the canvas's own camera.
Lights added as children still work and add to the rig.

### C. Lights per Surface

```tsx
// Sketch — not built.
<Surface.Mesh finish="velvet" light={{ power: 5 }} />
```

This would give each look its own studio, as the lab tuned them. three
r186 supports it in the same scene and pass: a node material's
`lightsNode` replaces the scene's lights with a chosen set
(`material.lightsNode = lights([key, rim])`, NodeMaterial.js). Each
distinct light set is its own cache key, so it builds its own pipeline.
Placing lights per Surface also leaves the page with no single light to
move. A pointer-following key would have to be wired into every Surface.

### Recommendation: B, with the environment and light gain in the finish

The canvas owns where the lights are, because placement and control are
page concerns: one key light follows one pointer. A finish may scale those
lights for itself, which is the narrow part of C the looks need. The
default is the `studio` rig: a point key, a grazing directional rim and an
even environment. It uses no `RectAreaLight`, so every layer in the table
above lights, and it costs none of the 103 kB. `softbox` loads its
tables by dynamic import when chosen. `room` is three's
`RoomEnvironment` and one point light. `lighting="none"` keeps today's
behavior for scenes that bring their own lights. Knobs, Controls and Glass
would pass it.

The looks need two things a shared canvas cannot give per finish.

- Each look reflects its own environment. three lets a material carry its
  own `envMap` and `envMapIntensity`, which replace the scene's
  environment and `environmentIntensity` for that material
  (`MaterialProperties.js`). The canvas bakes each environment kind once,
  when the first finish asks for it, and every finish that names it shares
  the texture. Lacquer and satin on one canvas then reflect the gradient
  and the even fill. Whether two environment textures keep one pipeline
  is unverified.
- Velvet's stronger key and rim become the finish's `lightGain`. Munari
  gives a finish whose gain is not 1 its own copies of the rig's lights,
  at the same positions and scaled intensity, through `lightsNode`. Its
  environment strength becomes its `envMapIntensity`. Velvet then keeps
  its tuned studio next to satin on one canvas, at the cost of one more
  pipeline. Whether lights outside the scene graph need their world
  matrices updated by hand is unverified. Munari would place them in its
  before-draw step either way.

The rig always declares its lights, setting an unused one to intensity 0
instead of removing or hiding it. Turning the rim off then costs no
rebuild.

The finish owns highlight roll-off, as the lab's `neutralToneMapping` in
the material does, because the canvas does not tone-map (decision #69). Tone mapping the canvas would shift the colors of every unlit Surface
on it.

### Shadows

A match-DOM Surface is a flat plane facing the camera at a fixed distance
(`MATCH_DOM_DISTANCE`, matchDom.ts). Every Surface sits at that
distance, so one Surface cannot shadow another. A shadow only shows when a
scene mesh stands in front of a Surface. `SurfaceCanvas` already takes
`shadows`, which maps to three's `PCFShadowMap`. `Surface.Mesh` sets no
shadow flags. The recommendation adds no shadow API. When a scene needs a shadow on a
Surface, `Surface.Mesh` would pass `receiveShadow` through. Toggling it
rebuilds that Surface's material, because three keys the render object's
cache on `receiveShadow`. The rig's lights cast no shadows, because
toggling `castShadow` rebuilds every lit material.

## 4. Light control

The question is how a light follows the pointer without a React render per
move, including under `frameloop="demand"`, and what each move costs.

### Measured cost

A throwaway probe ran on m2, an M2 Pro, in headless Chrome for Testing 156
with WebGPU. It drew three Surfaces with `Surface.LitMaterial`, an
ambient light and a point light, on a `frameloop="demand"` canvas of
2880 × 1800 pixels (1440 × 900 at DPR 2). Puppeteer moved the pointer in a
loop for 4 s per block. Each block measured Chrome's main-thread task time
(CDP `TaskDuration`) and divided it by the moves sent. Five modes ran in
one page load, three times each, in alternating order.

| Mode | What one move does | Task ms per move (3 blocks) | Mean |
|---|---|---|---|
| idle | nothing | 0.65, 0.67, 0.59 | 0.64 |
| handle | write the light's position in the event, call `invalidate()` | 1.75, 1.41, 1.19 | 1.45 |
| placed at draw | store the pointer, call `invalidate()`; the frame places the light | 1.32, 1.64, 1.53 | 1.50 |
| React state in the light component | `setState` in a canvas component that renders the light | 2.48, 2.80, 2.95 | 2.74 |
| React state at the page root | `setState` in the app root, which re-renders the three Surfaces | 4.71, 4.27, 4.42 | 4.46 |

Every mode but idle drew one frame per move (52 to 60 frames per second),
and in every block the light moved. Above idle, a move that draws costs 0.8 to 0.9 ms without React and 2.1
or 3.8 ms with React state. Most of the 0.8 ms is the frame's own draw,
because idle draws nothing. React adds 1.3 ms in the light component and
3.0 ms at the page root. The two non-React modes differ by less than the
spread between their blocks.

These numbers have limits.

- Puppeteer delivered about 56 moves per second, and headless Chrome
  paces frames at 60 Hz, so each move drew its own frame. A 120 Hz pointer
  on a 120 Hz screen would request up to twice the frames. The cost per
  frame at 120 Hz is unmeasured.
- Only `frameloop="demand"` ran.
- The page reported `navigator.gpu`, which shows WebGPU is exposed. The
  probe did not record which adapter drew.
- `TaskDuration` counts all main-thread work, including the input
  dispatch. Idle measures that floor.
- GPU time was not measured. The materials research measured the GPU cost
  of each layer on a full-screen draw: 0.71 ms for the standard model up
  to 2.37 ms with all four reflection layers (docs/materials-research.md
  §2).
- The probe used three Surfaces and the standard material, not finish
  materials. The page-root cost grows with the page tree, which the probe
  did not vary. That mode committed the page root 1.5 times per move, so
  its 3.0 ms includes more than one render.

### A. Declarative props

```tsx
// Sketch — not built.
const [pointer, setPointer] = useState({ x: 0, y: 0 })
<SurfaceCanvas lighting={{ key: { x: pointer.x, y: pointer.y } }} onPointerMove={(e) => setPointer({ x: e.clientX, y: e.clientY })} />
```

This is the most familiar React shape. It renders React on every move,
measured at 2.1 to 3.8 ms above idle per move, and it grows with what the state
re-renders. It suits a light that changes on a click, not on a drag.

### B. A light handle

```tsx
// Sketch — not built.
const key = createSurfaceLight({ z: 480, power: 1.55 })

<SurfaceCanvas lighting={{ rig: 'studio', key }} />
window.addEventListener('pointermove', (e) => key.set({ x: e.clientX, y: e.clientY }))
```

`createSurfaceLight` returns a plain object, like `createSurface` and
`createPageTarget` do today. `set` writes numbers and requests a frame on
every canvas whose rig uses the handle. Each canvas converts the position
during its next draw. R3F 9.8.1's `invalidate()` sets a pending frame to 1
outside `useFrame`, so several writes before one frame draw one frame.
`get()` reads the current values and `subscribe(fn)` reports changes, so
DOM UI such as a drag handle can follow the light without React state.
Converting at draw is the probe's "placed at draw" mode, 0.9 ms above
idle per move.

### C. The light follows the pointer by itself

```tsx
// Sketch — not built.
const key = createSurfaceLight({ follow: 'pointer', z: 480 })
```

The handle listens to `pointermove` on the window and reads the latest
position when the frame draws. This is the "placed at draw" mode, measured
the same as B. It needs no event code. A `smoothing` option would need
frames to continue after the pointer stops, which a demand canvas only
does while something keeps requesting them.

### D. Signals

A signal library or a new reactive primitive would give the light the same
behavior as B. It adds a dependency or a concept for one kind of value, and
B already matches the library's handle pattern.

### Recommendation: B, with C as an option of the handle

The handle is the one primitive. `follow: 'pointer'` is an option of it,
for the common case. Positions are page CSS px, so the numbers a pointer
event gives are the numbers the light takes. One handle drives several
canvases. Each move draws one frame and no React. Under the default
`frameloop="always"` a write should cost nothing beyond the frame that
was already coming. That mode was not measured. The page-side handle imports no three code.
