# Materials and lighting API: lighting

Part of the [materials and lighting API proposal](../materials-api.md). Status: proposal. Nothing in it is built, and code blocks marked "Sketch" show an API that does not exist yet.

## 3. Lighting

The question is where lights and the environment are declared, what they
light, and what a finish sees when none are declared.

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
lab works around velvet's case with `keySheen`, which evaluates sheen
from the key's center in the material. Its wax uses `keyScatter` the same
way. Both read the rig's key uniforms. A `RectAreaLight` also needs
`RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init())`. Those
lookup tables bundle to 247 kB, 103 kB gzip (rolldown 1.2.2 `--minify`,
three external). The lab imports them statically (materialFinishesStudio.ts:39-43).

### What rebuilds a lit material

- `LightsNode` keys its cache on each light's id and `castShadow`, plus a
  spot light's map and color node (LightsNode.js:147-156). The render list
  collects only visible lights.
- A material's `lightsNode` replaces the scene's lights for that material
  (NodeMaterial.js:1097). The render object's key still includes the
  scene's own lights (RenderObject.js:926-935). Adding, removing, hiding
  or showing a scene light, or toggling its shadow, therefore rebuilds
  every lit material on the canvas, including one with its own
  `lightsNode`.
- Materials whose node graphs give the same key share one node build. A
  node keys on its own id by default (Node.js:470-472), so a material with
  its own uniform or texture nodes builds once per instance. Every finish
  Surface has its own capture texture, so each builds its own node graph.
  Pipelines key on shader text, so those Surfaces still share one
  pipeline.
- Assigning a new `lightsNode` takes effect only with
  `material.needsUpdate = true`, and then it builds again.
- Moving a light or changing its intensity or color is a uniform update.
- Toggling `receiveShadow` rebuilds that mesh's material
  (RenderObject.js:945).

### Probe: lights and rebuilds

A throwaway page on m2 drew planes with `MeshPhysicalNodeMaterial` into
a 64 × 64 render target, in headless Chrome for Testing 156 on Apple
metal-3. It counted node builds by wrapping `NodeMaterial.prototype.setup`
and read the size of the pipeline cache, which counts every pipeline
built so far. It waited for an animation frame before each step's two
draws. A second page read the red channel at three points across the
middle row, with the light at the left or the right.

| Change | Node builds | Pipelines so far |
|---|---|---|
| first draw, one scene light | 1 | 1 |
| `lightsNode = lights([copy])` with a light outside the scene, with `needsUpdate` | 1 | 1 |
| that light moved, or its intensity doubled | 0 | 1 |
| a scene light hidden, then shown, while the material uses its own `lightsNode` | 1, then 1 | 1 |
| a second plain material on the same light set | 0 | 1 |
| a third material on its own new light objects | 1 | 1 |
| that material given another new set, with `needsUpdate` | 1 | 1 |
| the same without `needsUpdate` | 0 | 1 |
| three materials on one light set, each with its own color uniform | 3 | 1 |
| a scene light hidden, then shown, under those three | 3, then 3 | 1 |
| `outputNode` multiplied by a uniform, first draw, then the uniform set to 2 and to 0.5 | 1, then 0, 0 | 2 |

| Light | Left, middle, right |
|---|---|
| scene light at the left, intensity 1 | 18, 7, 4 |
| the same, intensity 2 | 37, 14, 8 |
| outside the scene through `lightsNode`, world matrix never updated | 0, 0, 0 |
| the same after `updateMatrixWorld()` | 18, 7, 4 |
| intensity 2 | 37, 14, 8 |
| moved right, then `updateMatrixWorld()` | 8, 14, 39 |
| a new set assigned without `needsUpdate` | 8, 14, 39, unchanged |

A first run without the frame waits gave the same build counts. A light
outside the scene draws exactly as a scene light does, once its owner
updates its world matrix. three updates world matrices only while it
traverses the scene (Renderer.js:961). The lab already updates its own
lights (materialFinishesStudio.ts:143-145). The probe used plain physical materials, not
finish materials.

### Designs

| Design | Usage | Consequence |
|---|---|---|
| A. Lights as canvas children, as today | `<pointLight position={[0, 0.3, 1.2]} />` | Nothing new to learn. A light "300 px above the cart button" needs the lab's unprojection math, and a finish on a bare canvas is black |
| B. The rig adds lights to the scene | `<SurfaceCanvas lighting="studio" />` | The rig also lights the caller's meshes. Changing the default later changes every page that kept it |
| C. The rig lights finishes only | `<SurfaceCanvas lighting="studio" />` | Finish materials take the rig through `lightsNode` and `envMap`. The caller's scene is untouched |
| D. Lights per Surface | `light={{ brightness: 5 }}` on a Surface | Each Surface is its own light set and node build, and no single light can follow the pointer |

### Recommendation: C

The canvas owns one rig and gives it to every finish material on the
canvas. The default rig, `studio`, adds nothing to the scene, so it is
safe on every canvas. A scene that lights its own meshes and uses no
finish needs no change. A scene moved from `Surface.LitMaterial` to a
finish, such as Knobs, passes `lighting="none"` to keep its own lights.
`SurfaceCanvas` keeps its rule that the scene's lights are the caller's.

- The rig's lights are shared by every finish material on the canvas.
  Munari places them and updates their world matrices in its before-draw
  step. Each finish Surface still costs its own node build, and finishes
  of one shape share a pipeline.
- A caller's own `<pointLight>` lights the caller's meshes and not the
  finishes. Adding or hiding one still rebuilds every finish Surface on
  the canvas, 17 node builds for the lab's gallery, because the render
  object's key includes the scene's lights.
- `lighting="none"` gives finishes the scene's lights and
  `scene.environment`. A finish's `environment` field is then ignored.
  `keySheen` and `keyScatter` have no key to read and add nothing, so
  velvet keeps only three's own sheen and wax loses its scatter.
- The rig always declares its lights. An unused light gets intensity 0,
  so turning the rim off rebuilds nothing.
- The finish rolls off highlights with `neutralToneMapping`, as the lab
  does, because the canvas does not tone-map (decision #69). Tone mapping
  the canvas would shift the colors of every unlit Surface.

### The rig's shape

```ts
// Sketch, not built.
type SurfaceLighting = 'studio' | 'none' | {
  key?: SurfaceLight | KeyLight
  rim?: { brightness?: number; elevation?: number } | false
  environmentIntensity?: number
}
```

- A softbox is a key with a size. `size: [width, height]` in CSS px makes
  the key a `RectAreaLight`, and Munari loads the lookup tables by dynamic
  import. Until they arrive, a finish Surface stays on the page, because
  the rig joins what the lift waits for. The lab's `room` rig was its
  first build, kept for comparison, so it is not offered.
- `x` and `y` are client CSS px, the coordinates of a pointer event. A
  light at a fixed client position stays fixed in the viewport while the
  page scrolls. Omitted, the key sits at the viewport's horizontal center,
  0.687 of its height down, so one handle sits at the same point for every
  canvas. The looks were tuned with the key that low. A coat's highlight
  lands about halfway between the key and the camera's axis, so it falls
  just below the middle (materialFinishesTuning.ts on materials-more). The
  lab's 0.517 across is its form card's center, a fact of its layout. `z`
  is CSS px above the page, default 480, the lab's height.
- `brightness` is the irradiance straight under the light, relative to
  the studio default, which is 1. three's `PointLight.power` is luminous
  power in lumens, so the rig does not use the word `power`.
- The rim's `brightness` is relative to the studio rim, which is 1, and
  `elevation` is its angle above the page in degrees, default 15.
- Each frame Munari converts the key's client position with the canvas's
  camera, onto the plane where match-DOM Surfaces sit. When the camera
  moves, as `FocusScene` moves it, the key stays at the same point in
  the viewport. A finish on a mesh with manual placement needs a
  view-space normal, which the lab material does not compute. That case
  is unverified.

### Environment and light gain per finish

- Each finish reflects the environment it names. A material's `envMap`
  and `envMapIntensity` replace the scene's environment and its intensity
  for that material (MaterialProperties.js). The canvas bakes each
  environment kind once, when the first finish asks. The bake joins
  `Surface.Prewarm` and the lift's wait, because today's `Prewarm` builds
  pipelines only (SurfacePrewarm.tsx:89-95). Bake time is unmeasured.
  Whether two environment textures keep one pipeline is unverified.
- `lightGain` is one number, 0 or more, default 1. The finish's lighting
  model is a subclass of three's `PhysicalLightingModel`. It multiplies
  each light's color by a gain uniform in `direct` and `directRectArea`
  (PhysicalLightingModel.js:624, 686), and the finish multiplies
  `keySheen` and `keyScatter` by the same uniform. The environment and
  the finish's own `emissiveIntensity` do not scale. Under
  `lighting="none"` the gain scales the scene's direct lights. A uniform
  write builds nothing in the probe's output row. Whether a uniform inside
  the lighting model behaves the same is unverified. Velvet tuned its key
  at 3.2 times the studio, its rim at 1.25 times and its environment from
  1.35 to 1.4, so one number changes its look, and velvet needs a re-tune
  under it.

### Shadows

A match-DOM Surface is a flat plane facing the camera at a fixed distance
(`MATCH_DOM_DISTANCE`, matchDom.ts), so one Surface cannot shadow
another. A shadow shows only when a scene mesh stands in front of a
Surface. `SurfaceCanvas` already takes `shadows`. The recommendation adds
no shadow API. `Surface.Mesh` would pass `receiveShadow` through, and
the rig's lights cast no shadows.
