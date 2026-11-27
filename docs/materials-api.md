# Materials and lighting API

Status: accepted on 2026-11-26 and built on `finish-api`.
[Decision #79](decisions/renderer.md#79) states the current constraints, and
the published types are the API. This page is the proposal as accepted. It
describes `main` at 5bc70f3, the material finishes lab scene on
`origin/materials-more` at 678f0d9, three r186 and R3F 9.8.1. Every number
comes from a measurement named beside it.

This proposal answers how `@petepetrash/munari` should let a developer
give a Surface a physical material, light it, and move the light.

## Recommendation

- A Surface is lit by a `finish` prop on `Surface.Root`, `<Surface>`,
  `SceneSurface.Root` and `<SceneSurface>`. The mesh and the HTML both
  read it. A finish is plain data.
- Munari owns the body color. It writes the finish color into a
  `--munari-body` custom property on the elements it renders around the
  HTML, and it orders each change with capture and presentation. The
  author's CSS uses `background: var(--munari-body)` once.
- Finish fields are grouped by layer. A layer that is present is compiled,
  so moving its amount through zero builds nothing.
- The canvas owns one rig, and the rig lights finishes only. Each finish
  material takes the rig's lights through three's `material.lightsNode`
  and its environment through `material.envMap`. The rig adds nothing to
  the caller's scene. The default rig is a point key, a rim light and an
  even environment.
- A finish scales the rig's direct light with one number, `lightGain`.
  Its lighting model multiplies direct light by a uniform, so a change
  builds nothing.
- A light moves through a handle from `createSurfaceLight()`, or follows
  the pointer by itself. Each change draws one frame and no React render.
  On m2 that costs 0.8 to 0.9 ms of main thread per move above idle,
  against 2.1 to 3.8 ms when React state drives the light.
- The 17 looks ship as presets named `<family>-<look>`, such as
  `paper-kraft`, in a registry module with suggested ink colors. The
  package ships the finish type, the material and the rig.

The full API appears in [the recommended API](materials-api/recommended-api.md),
on four examples. [Decisions for Pete](#decisions-for-pete) lists what
remains open.

## Contents

- [Naming and configuration](materials-api/naming-and-configuration.md): where the finish goes, its fields and layers, presets and their names, escape hatches and new finishes.
- [Body and text color](materials-api/body-and-text.md): one source for the body color, how Munari orders it with capture and presentation, and the text color.
- [Lighting](materials-api/lighting.md): what each light gives each layer, what rebuilds a material, the rig's scope, its shape and its defaults.
- [Light control](materials-api/light-control.md): the measured cost of moving a light, the light handle, and the pointer light's lifecycle.
- [Relationships and other settled points](materials-api/relationships.md): instances, themes, several canvases, SSR, payload, disposal, entries and the evidence a build owes.
- [The recommended API](materials-api/recommended-api.md): the full sketch and four examples.

## Terms

- A Surface is retained HTML that Munari can draw in a Three.js scene. The
  HTML stays in the page and keeps focus, input and accessibility.
- Munari keeps a Surface's HTML in two places: its page element and a
  source host element (`data-munari-source-host`), whose content Munari
  captures. The live DOM moves between them. While the page presents, the
  live DOM sits in the page element and the source host holds a copy.
  While the scene presents, the live DOM sits under the source host and
  the page element holds a hidden copy.
- The capture is the texture Munari paints from the source host's content. Its
  pixels are premultiplied (decision #5).
- The presenter is the mesh that draws a Surface in the scene:
  `Surface.Mesh`. With `placement="match-dom"` it covers the HTML's page
  box exactly.
- The lift is the handoff from page to scene. It stays closed until every
  part uploads a capture taken at or after the point the handoff asks for
  (decision #65).
- A material decides how the presenter's pixels are shaded. The default is
  unlit: the capture's pixels exactly as the page drew them.
- A finish is a lit material described as data: a body color, how rough
  and metallic the body is, which layers it has, the shape of its edge and
  surface detail, the environment it reflects, and how strongly it takes
  the rig's direct light.
- A layer is a part of the shading that compiles its own shader code:
  coat, sheen, anisotropy, film, scatter, detail and crackle.
- A look is one tuned set of finish values. The lab has 17: crimson
  lacquer, charcoal satin polymer, blue anodized aluminum, celadon glazed
  ceramic and midnight velvet, plus three looks each of thin-film foil,
  paper, soft-touch rubber and translucent wax.
- Lit text means the capture is printed on the body and takes the light
  with it. Unlit text means the capture is laid over the lit body at the
  colors the page drew.
- The environment is the surrounding image a finish reflects, prefiltered
  into a PMREM texture. A rig is a set of lights plus an environment.
- `frameloop="demand"` draws a frame only when something requests one,
  through R3F's `invalidate()`.
- A pipeline is a compiled GPU program. A node build is three turning a
  material's node graph into shader code. Changing the shape of a material
  costs both and takes long enough to drop frames (decision #76).

## What exists today

The library has one lit material. `Surface.LitMaterial`
(packages/react/src/primitives/surface/surfaceMaterials.tsx) is a
`MeshStandardNodeMaterial` with four props: `roughness` (default 0.55),
`metalness`, `emissiveIntensity` and `side`. The capture is its color
everywhere, so the HTML's own CSS background is the lit body. It does not
roll off highlights. Knobs, Optics, Review notes, two Why snippets and the
lit surface-texture instrument use it.

A custom material goes in the slot `<Surface.Mesh material={…}>`, which
takes a React element or a `THREE.Material`. An element can read the
capture and the corner mask through `useSurfaceNodes()` and
`useSurfaceTexture()`. `SurfaceCanvas` declares no lights and no
environment, and it does not tone-map (decision #69). Lab scenes add their
own lights or `scene.environment`. Among them are Knobs, Controls,
Cutaway, Marble hand, Polymer, Review notes, Lamp, Light, the wordmark,
and Glass and Workspace on the lab's shared canvas.

The material finishes lab scene (apps/lab/src/scenes/material-finishes/)
holds the settled finishes. On `origin/materials-more` it has nine
finishes, 17 looks and a `Finish` struct with 25 fields. It builds one
`MeshPhysicalNodeMaterial` per card. It sets three's `iridescence` to 0
and runs its own thin-film code, and it adds a scatter term for wax. It
runs three rigs, `room`, `softbox` and `studio-point`, and defaults to
`softbox`. The key sits at viewport fractions 0.517 and 0.687, 480 px
above the page. The softbox is 290 × 80 px. Both were fitted so the
highlight falls in a text-free band of the lab's form card.

Two facts from that scene constrain any design.

- Velvet is the only look that changes the lights. It raises the key from
  1.55 to 5, the rim from 1.2 to 1.5 and the environment from 1.35 to 1.4.
  Every other look names only its environment, gradient or even.
- The content root is transparent in the scene and paints the body color
  on the page. The lab switches a class from its requested `inScene`
  state. When the page presents while `inScene` stays true, as after
  renderer loss, its cards show no body.

### Names already in use

| Name | Where | Visibility |
|---|---|---|
| `Surface.LitMaterial`, `SceneSurface.LitMaterial` | Surface.tsx statics | root entry |
| `SurfaceLitMaterialProps` | surfaceMaterials.tsx | root entry (type) |
| `material` prop | `Surface.Mesh` | root entry |
| `useSurfaceNodes`, `SurfaceNodes` | surfaceMaterials.tsx | root entry |
| `useSurfaceStatus`, `onPresentationChange` | surfaceStatus.ts, Surface.tsx | root entry |
| `passMaterial` | lib/passMaterial.ts | /advanced |
| `SurfaceMaterialContext`, `SurfaceMaterialValue` | surfaceContext.ts | internal |
| `createGlassMaterial`, `createBlitMaterial` | registry/glass | copyable |
| `Finish`, `FinishId`, `FINISHES`, `createFinishMaterial` | material finishes lab scene | lab only |

No export is named `finish`, `lighting`, `createSurfaceLight` or
`--munari-body`.

## Decisions for Pete

Two points are settled: a finish is set per Surface, and every look
becomes its own preset.

1. Where a Surface declares its finish.
   - A: a `Surface.Material` component in the `material` slot.
   - B: a `finish` prop on `Surface.Mesh`.
   - C: a `finish` prop on `Surface.Root` and the shorthands.

   Recommended: C. The finish changes the HTML's body color as well as the
   mesh, and the Root is the one component that provides context to both.
2. How the body color reaches the page and the scene.
   - A: Munari sets a presented-state attribute, and author CSS switches
     the background.
   - B: the author switches a class from their own state, as the lab does.
   - C: Munari writes `--munari-body` on its own elements and orders each
     change with capture and presentation.

   Recommended: C, built as its own piece of work with a check for each of
   the five cases in [Body and text color](materials-api/body-and-text.md#cases-a-build-must-check).
   A probe showed that a CSS change alone does not reach the scene.
3. What the rig lights.
   - A: the rig adds lights to the scene, which also light the caller's
     meshes.
   - B: the rig reaches finish materials only, through `lightsNode` and
     `envMap`.

   Recommended: B. A default rig is then safe on every canvas, and scenes
   that bring their own lights and use no finish need no change. A scene
   moved off `Surface.LitMaterial` passes `lighting="none"` to keep its
   own lights. A probe showed lights outside the scene draw the same as
   scene lights.
4. The default key.
   - A: a point key.
   - B: a 290 × 80 px softbox, which the lab defaults to.
   - C: no default rig.

   Recommended: A, once you have compared the 17 looks under the lab's
   `studio-point` rig. A point key lights sheen and anisotropy, which a
   softbox does not, and needs none of the softbox's 103 kB gzip tables.
   The lab notes that under its first point key "lacquer read as a dot
   over a broad wash" (materialFinishesStudio.ts on materials-more), so the
   comparison matters. The proposed default position is the viewport's
   horizontal center, 0.687 of the way down, 480 px above the page. The
   looks were tuned with the key that low, and a coat's highlight then
   lands just below the middle. The lab's 0.517 across is its form card's
   center, a fact of its layout. The position also needs your eye.
5. Velvet's stronger light.
   - A: `lightGain` is one number, and velvet is re-tuned under it.
   - B: `lightGain: { key, rim }`, through shared copies of the rig's
     lights.

   Recommended: A. A gain change is a uniform write, and no other look
   changes the lights. B ties every finish to a rig with two named lights,
   and a gain change swaps the material's light set, which rebuilds it.
   Velvet raised its key 3.2 times, its rim 1.25 times and its
   environment from 1.35 to 1.4, so one number cannot keep all three.
6. Finish fields.
   - A: flat fields with three's names, where a layer compiles when its
     amount crosses 0.
   - B: one object per layer. A present layer compiles, `null` removes it.

   Recommended: B. A slider through zero then builds nothing, and the
   materials-more film no longer runs through three's iridescence.
7. Where the presets live.
   - A: the root entry exports them, and a decision entry says a re-tune is
     a visible change that goes in the changelog.
   - B: a registry module that projects copy, with the inks beside them.

   Recommended: B. Decision #6 puts tuned values in `registry/`, and the
   values are set by eye and still changing. A re-tune then changes no page
   that did not copy it. The cost is that a Surface passes a value, such as
   `finish={finishes['paper-kraft']}`, instead of a string name.
8. Preset names.
   - A: the lab's finish ids plus the look, such as
     `thin-film-foil-oil-slick` and `soft-touch-rubber-silicone`.
   - B: a short family noun plus the look for all 17, such as
     `lacquer-crimson`, `polymer-charcoal` and `paper-kraft`.
   - C: one word per look, with a family prefix only where two clash.

   Recommended: B. Every name has the same two parts, so a picker can group
   by family, and a second lacquer look needs no rename. `silicone` is a
   look of both rubber and wax, so C needs exceptions. B drops "satin",
   "anodized", "glazed", "thin-film", "soft-touch" and "translucent" from
   the names, and each preset's doc comment keeps them.
9. Who sets the text color over a finish.
   - A: the author's CSS, with suggested inks in a table beside the presets.
   - B: Munari writes ink custom properties on the content root.

   Recommended: A. The page needs the same colors in CSS, and contrast
   stays the author's. A suggested ink stops matching once a Surface
   overrides `color`, so it is a starting point.
