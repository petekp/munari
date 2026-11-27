# Materials and lighting API: naming and configuration

Part of the [materials and lighting API proposal](../materials-api.md). Status: proposal. Nothing in it is built, and code blocks marked "Sketch" show an API that does not exist yet.

## 1. Where the finish goes

The question is what a developer writes to make a Surface lit, and what
that says about unlit content, custom shaders and registry packs.

### A. A `Surface.Material` component

```tsx
// Sketch, not built.
<Surface.Mesh material={<Surface.Material finish="lacquer-crimson" />} />
```

The line says "material" twice, and the default unlit presenter is also a
material. A finish is data, and this puts it inside JSX in the slot meant
for code.

### B. A `finish` prop on `Surface.Mesh`

```tsx
// Sketch, not built.
<Surface.Mesh finish={finishes['lacquer-crimson']} />
```

The finish sits on the mesh that draws it. The HTML side cannot see it,
and a finish with a body color changes the HTML side too: the page copy
paints the body and the captured copy must not.

### C. A `finish` prop on the Root

```tsx
// Sketch, not built.
<Surface.Root canvasId="shop" finish={finishes['lacquer-crimson']}>…</Surface.Root>
<Surface canvasId="shop" finish={finishes['velvet-midnight']}>…</Surface>
<SceneSurface finish={finishes['paper-kraft']}>…</SceneSurface>
```

`Surface.Root` renders only context providers (Surface.tsx:99-103), and
its context already reaches the mesh (`SurfaceRootContext`,
SurfaceRoot.tsx:201, provided again in SurfaceScene.tsx:58). The Root is
the one component above both the HTML and the mesh, so both read the
finish from it. `SceneSurface` has the same Root and shorthand forms.

### Recommendation: C

A Surface reads as unlit by default and lit when its Root has a
`finish`. `Surface.LitMaterial`, `SceneSurface.LitMaterial` and
`SurfaceLitMaterialProps` are removed. 0.5.0 kept a renamed export as an
alias for one minor release. Munari has no outside users, so this removal
keeps no alias. The rename touches:

- the scenes: `Knobs.tsx`, `Optics.tsx`, `ReviewNotesNoteMesh.tsx`,
  `whySnippets.ts` (two snippets) and `whyData.ts`;
- `instruments/surface-textures/lit.tsx` (two uses);
- `tests/surfaceTypes.tsx`, `surfaceSceneLookup.tsx` and its test;
- in packages/react, `index.ts`, `Surface.tsx`, `surfaceMaterials.tsx`,
  `surfaceLitTexture.ts` and `surfaceSceneComponents.ts`;
- `docs/decisions/renderer.md` and the changelog.

A `LitMaterial` scene moves to a finish with `color: null`, which lights
the whole capture as `Surface.LitMaterial` does. Knobs becomes
`finish={{ color: null, roughness: 0.5, metalness: 0.18, emissiveIntensity: knobsTuning.lightDom }}`.
Its canvas passes `lighting="none"`, because Knobs lights itself with its
own point, ambient and directional lights and an environment built from
its artwork (Knobs.tsx:476, 551-562). Under the default rig a finish would
see only the rig. Its look will still change, for two reasons:

- the finish material rolls highlights off with `neutralToneMapping`, and
  `Surface.LitMaterial` does not;
- the lab material writes its normal in the card's own frame, which is a
  view-space normal only for a match-DOM mesh. `Surface.Mesh` defaults to
  manual placement unless it is tunneled (SurfaceMesh.tsx:377).

Knobs, Optics and Review notes need a visual check after the move.

### Escape hatches

1. Finish values cover the 17 looks.
2. `/advanced` exports `useSurfaceFinishMaterial(inputs)`. An element in
   the `material` slot calls it and gets the live finish material, or
   `null` when the Root has no finish. The material arrives with its
   capture, finish values, key light and environment already wired. The
   caller changes it through named inputs, such as `normal` and
   `bodyColor`, each a function from the finish's own node to a new one.
   Munari builds the material from them, so every term that reads the
   normal reads the changed one. Replacing `normalNode` afterwards would
   not work: the lab feeds the same normal node to roughness filtering,
   the key's sheen and scatter, and the film (materialFinishesNodes.ts:285-308
   on materials-more). The full list of inputs is settled with the build.
   A bare `createFinishMaterial()` factory would not be enough either. The lab material needs work before every draw: it syncs
   the capture view, writes the finish, places the lights and sets the
   key's uniforms (`FinishMaterial` in MaterialFinishesSurface.tsx).
3. A custom material with no finish keeps today's path, as the lab's
   Analyze candidate does (apps/lab/src/scenes/candidates/CandidateAnalyze.tsx).
   `useSurfaceNodes()` gains `litMap`, the capture with alpha divided out
   in encoded space and then decoded (decision #48). That read is the hard
   part of every lit custom shader, and the lab copied it.

```tsx
// Sketch, not built. emboss is a module-level function, so its identity is stable.
const embossed = { normal: emboss }

function Embossed() {
  const finished = useSurfaceFinishMaterial(embossed)
  return finished ? <primitive object={finished} attach="material" /> : null
}

<Surface.Root canvasId="shop" finish={finishes['paper-kraft']}>
  <Surface.HTML>…</Surface.HTML>
  <Surface.Scene><Surface.Mesh material={<Embossed />} /></Surface.Scene>
</Surface.Root>
```

## 2. Configuration

The question is how a developer picks a finish, changes part of it, and
goes past it.

| Design | Usage | Consequence |
|---|---|---|
| A. One shared type, presets plus overrides | `{ ...finishes['lacquer-crimson'], color: '#1d4e89' }` | One type to learn. Plain objects serialize, diff and sit in a tweak panel. The types cannot stop a meaningless mix, such as sheen on a mirror metal |
| B. A type per finish | `{ type: 'velvet', pile: 0.08 }` | Shorter autocomplete. Every new finish adds a type and a translation, and a finish between two types needs a new one |
| C. Factory functions | `lacquer({ color })` | Validates at the call. One import per finish, and a stored finish is opaque to a panel |

Recommendation A. The lab carries all 17 looks in one struct, and three
draws them through one lighting model.

### Fields by layer

Each layer is an object, or `null` when the finish has none. A present
layer compiles, so its amount can move through zero with no rebuild.
three compiles a layer whenever its node is set: `useClearcoat` returns
`this.clearcoat > 0 || this.clearcoatNode !== null`, and sheen,
anisotropy and iridescence follow the same form
(MeshPhysicalNodeMaterial.js:292-331). A probe on m2 confirmed it. With
`clearcoatNode` set to a uniform, moving the uniform from 0 to 0.6 and
back built nothing. Setting the `clearcoat` property from 0 to 0.6 built
the material again, and so did setting it from 0.3 back to 0. The probe is
described in [Lighting](lighting.md#probe-lights-and-rebuilds).

Flat fields with three's names also stopped matching three. On
materials-more the lab sets `material.iridescence = 0` and feeds the
film's values to its own film code (materialFinishesNodes.ts:357-363).

| Field | Unit and range | Compiles |
|---|---|---|
| `color` | a color three parses, or `null`: the HTML paints the body | `null` against a color |
| `text` | `'unlit'` (default) or `'lit'`; read only when `color` is set | yes |
| `roughness`, `metalness` | 0–1 | no |
| `ior` | 1.0–2.333 | no |
| `specularIntensity` | 0–1 | no |
| `coat`: `amount`, `roughness` | 0–1, 0–1 | present or `null` |
| `sheen`: `amount`, `color`, `roughness` | 0–1, color, 0–1 | present or `null` |
| `anisotropy`: `amount`, `rotation` | 0–1, radians in the Surface's UV frame | present or `null` |
| `film`: `amount`, `ior`, `thickness`, `variation`, `scale` | 0–1, 1.0–2.333, nm at the thickest, fraction of the thickness, CSS px | present or `null` |
| `scatter`: `amount` | share of the diffuse light scattering under the surface, 0–1 | present or `null` |
| `transmission`: `amount`, `thickness`, `dispersion` | share of the body's light passing through, 0–1; CSS px; 20 / Abbe number, 0 for none. `color` is the tint ([#80](../decisions/renderer.md#80)) | present or `null` |
| `edge`: `width`, `rimColor` | CSS px, 0 is flat; color or `null` | no |
| `detail`: `kind`, `scale`, `depth` | kind; CSS px; slope | kind, or present or `null` |
| `crackle`: `amount`, `scale` | 0–1, CSS px | present or `null` |
| `emissiveIntensity` | 0 and up | no |
| `environment` | `'even'` or `'gradient'` | see [Lighting](lighting.md) |
| `lightGain` | multiplier of the rig's direct light, default 1 | no |
| `side` | `'front'` or `'double'` | yes |

The detail kinds are `orange-peel`, `brushed`, `pile`, `glaze`,
`crumple`, `fiber`, `dots` and `honeycomb`. With `color: null` the
whole capture is the lit body, so `text` has no effect.

A finish without a preset starts from neutral defaults: `color: null`,
`text: 'unlit'`, `roughness: 0.55` (today's `Surface.LitMaterial`
default), `metalness: 0`, `ior: 1.5`, `specularIntensity: 1`, no layers,
`edge: { width: 0, rimColor: null }`, `emissiveIntensity: 0`,
`environment: 'even'`, `lightGain: 1` and `side: 'front'`.

A finish is plain data: strings, numbers, `null` and plain objects. A
page can build one without importing three (see
[SSR](relationships.md#ssr-and-the-page-bundle)). An override spreads
one level into each layer:
`{ ...base, coat: { ...base.coat, roughness: 0.1 } }`.

A change in the right column builds a new pipeline. Every other write is
a uniform update. The types document the column, and a development
warning fires when a compiling field changes more than once in a second.

three's `Color.setStyle` parses hex, `rgb()`, `hsl()` and color names. It
does not parse `var()`, `oklch()` or `light-dark()`. A finish color is
therefore a JavaScript value, and a theme switch passes a new finish.
That is a uniform write. A development warning fires for a color three
cannot parse.

### How the lab's knobs map

| Lab control | Finish field or lighting value |
|---|---|
| colors group | `color`, `sheen.color` |
| base group | `roughness`, `metalness`, `ior`, `specularIntensity` |
| edge and relief group | `edge.width`, `detail.scale`, `detail.depth`, `crackle` |
| clearcoat, sheen, anisotropy groups | `coat`, `sheen`, `anisotropy` |
| iridescence group | `film` |
| finish and look choice | the preset, including `detail.kind` and `edge.rimColor` |
| lit and unlit text buttons | `text` |
| light and environment group | the canvas `lighting` value |

### Presets

Each look is a preset: a frozen finish value in a registry module,
`registry/finishes`. Projects copy it, as they copy `registry/glass`.
Decision #6 says scene recipes with tuned values belong in `registry/`.
The preset values were set by eye and are still changing on
materials-more, so a re-tune should change only the pages that copy it.
The module also exports `inks`, the suggested text colors per preset (see
[Text color](body-and-text.md#text-color)).

| Preset | Lab finish | Lab look |
|---|---|---|
| `lacquer-crimson` | `lacquer` | its only look |
| `polymer-charcoal` | `satin-polymer` | its only look |
| `aluminum-blue` | `anodized-aluminum` | its only look |
| `ceramic-celadon` | `glazed-ceramic` | its only look |
| `velvet-midnight` | `velvet` | its only look |
| `foil-holographic`, `foil-oil-slick`, `foil-crumpled` | `thin-film-foil` | `holographic`, `oil-slick`, `crumpled` |
| `paper-office`, `paper-kraft`, `paper-cold-press` | `paper` | `office`, `kraft`, `cold-press` |
| `rubber-black`, `rubber-grip`, `rubber-silicone` | `soft-touch-rubber` | `black`, `grip`, `silicone` |
| `wax-candle`, `wax-beeswax`, `wax-silicone` | `translucent-wax` | `candle`, `beeswax`, `silicone` |
| `glass-clear`, `glass-cobalt`, `glass-frosted`, `glass-crystal` | none | built on the finish API, shown at `?scene=material-finishes&compare=glass` |

Names follow `<family>-<look>`. The family is a short material noun, so
`polymer` replaces "satin polymer", which beside `velvet` reads as a
fabric. The longer words move into each preset's doc comment.

### Adding a finish

The shared model held all nine lab finishes. Foil fits through the film
layer and the `crumple` detail, paper through `fiber`, the grip rubber
through `dots`, and wax through the scatter layer and `honeycomb`. Glass added
the transmission layer. A finish that needs new shading adds a layer
or a detail kind, with its conformance check and a decision entry.
three r186 also ships `MeshSSSNodeMaterial`, a physical material with
its own scattering model, for a finish the scatter layer cannot reach.

A developer adds a finish as a value, which needs no code:

```tsx
// Sketch, not built.
export const brushedBrass = { ...finishes['aluminum-blue'], color: '#b5a06a', anisotropy: { amount: 0.8, rotation: 0 } } satisfies SurfaceFinish
```
