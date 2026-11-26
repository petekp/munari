# Materials and lighting API

Status: proposal. Nothing in it is built. Code blocks marked "Sketch" show
an API that does not exist yet. Everything else describes `main` at
b9f46c5 and three r186, and every number comes from a measurement named
beside it.

This proposal answers how `@petepetrash/munari` should let a developer
give a Surface a physical material, light it, and move the light. It
replaces nothing until Pete picks a design and a decision entry records it.

## Recommendation

- A Surface is lit by a `finish` prop on `Surface.Mesh` and on the
  `<Surface>` shorthand. A finish is a preset name, or a preset plus
  overrides. `material` stays the slot for custom shaders, and
  `Surface.LitMaterial` is removed.
- One finish type covers every preset. Its fields use three's names and
  units, plus CSS px for the edge and detail fields Munari adds.
- The canvas owns the lights through `<SurfaceCanvas lighting>`, with a
  studio rig as the default. Lights are placed in page CSS coordinates.
  Each finish names the environment it reflects and can scale the rig's
  lights for itself.
- A light moves through a handle from `createSurfaceLight()`, or follows
  the pointer by itself. Each change draws one frame and no React render.
  On m2 that costs 0.8 to 0.9 ms of main thread per move above idle,
  against 2.1 to 3.8 ms when React state drives the light.
- Themes are plain values, with no inheritance. Everything ships from the
  root entry, and the softbox light's 103 kB gzip lookup tables load only
  when a page uses a softbox.

The full API appears in [the recommended API](materials-api/recommended-api.md), on four examples. The decisions Pete has
to make are listed in [Decisions for Pete](#decisions-for-pete).

## Contents

- [Naming and configuration](materials-api/naming-and-configuration.md): what a developer writes, the finish fields, units, escape hatches and new finishes.
- [Lighting and light control](materials-api/lighting.md): where lights live, what each light gives each finish, and the measured cost of moving a light.
- [Relationships and other settled points](materials-api/relationships.md): instances, themes, several canvases, SSR, payload, disposal and entries.
- [The recommended API](materials-api/recommended-api.md): the full sketch and four examples.

## Terms

- A Surface is retained HTML that Munari can draw in a Three.js scene. The
  HTML stays in the page and keeps focus, input and accessibility.
- The capture is the texture Munari paints from that HTML each time it
  changes. Its pixels are premultiplied (decision #5).
- The presenter is the mesh that draws a Surface in the scene:
  `Surface.Mesh`. With `placement="match-dom"` it covers the HTML's page
  box exactly.
- A material decides how the presenter's pixels are shaded. The default is
  unlit: the capture's pixels exactly as the page drew them.
- A finish is a lit material described as data: a body color, how rough
  and metallic the body is, which reflection layers it has, and the shape
  of its edge and surface detail.
- A look is a finish plus the light it was judged under. Pete picked five:
  crimson lacquer under a gradient sky, charcoal satin polymer, blue
  anodized aluminum, celadon glazed ceramic and midnight velvet.
- Lit text means the capture is printed on the body and takes the light
  with it. Unlit text means the capture is laid over the lit body at the
  colors the page drew.
- The environment is the surrounding image a finish reflects, prefiltered
  once into a PMREM texture. A rig is a set of lights plus an environment.
- `frameloop="demand"` draws a frame only when something requests one,
  through R3F's `invalidate()`.
- A pipeline is a compiled GPU program. Changing the shape of a material
  builds a new one, which takes long enough to drop frames (decision #76).

## What exists today

The library has one lit material. `Surface.LitMaterial`
(packages/react/src/primitives/surface/surfaceMaterials.tsx) is a
`MeshStandardNodeMaterial` with four props: `roughness` (default 0.55),
`metalness`, `emissiveIntensity` and `side`. The capture is its color
everywhere, so the HTML's own CSS background is the lit body. It
un-premultiplies the capture in encoded space before decoding it
(decision #48). Knobs, Optics, Review notes and the Why snippets use it.

A custom material goes in the slot `<Surface.Mesh material={…}>`. The
slot takes a React element or a `THREE.Material`. An element can read the
capture and the corner mask through `useSurfaceNodes()` and
`useSurfaceTexture()`. The presenter forces `premultipliedAlpha` on
whatever lands in the slot (`configureSurfaceMaterial`) and logs an error
for GLSL materials, which WebGPURenderer cannot run (decision #71).

`SurfaceCanvas` declares no lights and no environment. Each lab scene
adds plain R3F lights as canvas children. Under no light,
`Surface.LitMaterial` draws black apart from its emissive term. The canvas
does not tone-map (decision #69).

The material finishes lab scene (apps/lab/src/scenes/material-finishes/)
holds the settled finishes. It builds one `MeshPhysicalNodeMaterial` per
card (`createFinishMaterial`) from a shared `Finish` struct with 22
fields. It runs three rigs: `room`, `softbox` and `studio-point`. Lights
are placed from viewport CSS values inside `useSurfaceBeforeRender`
(`placeStudioLights`). The tweak panel and the draggable light handle
mutate plain objects and call `invalidate()` through a listener set, so no
slider move renders React. The scene keeps its own copy of the lit capture
read (`materialFinishesCaptureView.ts`) "until a finish API owns it".

Two facts from that scene constrain any design.

- Each look was tuned with its own studio. Lacquer and ceramic reflect a
  gradient environment, satin and aluminum an even one, and velvet raises
  the key to power 5, the rim to 1.5 and the environment to 1.4
  (`FINISH_STUDIOS`). The lab shows one finish at a time, so this never
  conflicts. A page that mixes finishes on one canvas has one set of lights.
- The content root is transparent in the scene and paints the body color
  on the page. The lab switches a CSS class from its own `inScene` state.
  The finish's body color comes from the finish, and the HTML's alpha
  separates text from body.

### Names already in use

| Name | Where | Visibility |
|---|---|---|
| `Surface.LitMaterial`, `SceneSurface.LitMaterial` | Surface.tsx statics | root entry |
| `SurfaceLitMaterialProps` | surfaceMaterials.tsx | root entry (type) |
| `material` prop | `Surface.Mesh` | root entry |
| `useSurfaceNodes`, `SurfaceNodes` | surfaceMaterials.tsx | root entry |
| `passMaterial` | lib/passMaterial.ts | /advanced |
| `SurfaceMaterialContext`, `SurfaceMaterialValue` | surfaceContext.ts | internal |
| `SurfaceMaterialWrites` | surfaceWrites.ts | internal |
| `createGlassMaterial`, `createBlitMaterial` | registry/glass | copyable |
| `Finish`, `FINISHES`, `FinishMaterial` | material finishes lab scene | lab only |

No export is named `finish`, `Surface.Material`, `lighting` or
`createSurfaceLight`. The lab scene named Light (apps/lab/src/scenes/light)
runs its own renderer and exports only its lab entry, `LightApp`.

## Decisions for Pete

1. Where the finish goes.
   - A: `Surface.Material`.
   - B: `Surface.LitMaterial` with `finish`.
   - C: a `finish` prop on the presenter.

   Recommended: C, because it needs no component and lets the shorthand
   Surface be lit.
2. Whether a look keeps its own environment on a shared canvas.
   - A: each finish names the environment it reflects.
   - B: the canvas has one environment and the looks are re-tuned to it.

   Recommended: A, because it keeps the picked looks on a mixed page. It
   costs one bake per environment kind. With A, velvet's stronger key
   becomes its `lightGain` and needs no re-tune. With B, velvet needs
   re-tuning and your eye.
3. The default rig.
   - A: `studio`, with a point key.
   - B: `softbox`, which the looks were judged under.
   - C: none, as today.

   Recommended: A, because a point key lights every layer, and a
   `softbox` default would put 103 kB gzip on every canvas.
4. How CSS learns where a Surface is presented, so a finish's body color
   can replace the HTML's background in the scene.
   - A: Munari sets an attribute on the content root's host.
   - B: authors switch a class from their own state, as the lab does.

   Recommended: A, provided a probe shows the attribute changes in the
   same frame as the presentation. A lag shows one frame with two bodies
   or none.
5. Preset names.
   - A: the lab's ids, `satin-polymer`, `anodized-aluminum` and
     `glazed-ceramic`.
   - B: shorter names such as `satin`, `anodized` and `ceramic`,
     renaming the lab to match.

   Recommended: B, because these are typed often and one name per concept
   holds either way.
6. Who sets the text color over a finish.
   - A: the author's CSS, with suggested ink colors in `finishes`.
   - B: Munari writes ink custom properties on the content root.

   Recommended: A, because the page presentation needs the same colors in
   CSS and the author keeps control of contrast.
