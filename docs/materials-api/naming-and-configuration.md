# Materials and lighting API: naming and configuration

Part of the [materials and lighting API proposal](../materials-api.md). Status: proposal. Nothing in it is built, and code blocks marked "Sketch" show an API that does not exist yet.

## 1. Naming

The question is what a developer writes to make a Surface lit, and what that
name says about unlit content, custom shaders and copyable registry packs.

### A. `Surface.Material` with a `finish` prop

```tsx
// Sketch — not built.
<Surface.Mesh material={<Surface.Material finish="lacquer" color="#1d4e89" />} />
```

`Surface.Material` replaces `Surface.LitMaterial`. The line says
"material" twice, and the name hides that this material needs light: a
developer who drops it on a canvas with no lights gets a black card. The
default unlit presenter is also a material, so "the Material" names the
wrong one. Custom shaders and registry packs keep using the same `material`
slot, which is consistent.

### B. Keep `Surface.LitMaterial` and add `finish`

```tsx
// Sketch — not built.
<Surface.Mesh material={<Surface.LitMaterial finish="lacquer" color="#1d4e89" />} />
```

"Lit" says the material needs light, and existing scenes keep working. The
nesting is the same as A. Today's four props and the finish fields would
share one component, so `emissiveIntensity` sits beside `clearcoat`.

### C. A `finish` prop on the presenter

```tsx
// Sketch — not built.
<Surface.Mesh finish="lacquer" />
<Surface.Mesh finish={{ preset: 'lacquer', color: '#1d4e89' }} />
<Surface canvasId="shop" finish="velvet">…</Surface>
```

The finish is data on the mesh that draws it. A Surface reads as unlit by
default, lit with a `finish` and drawn by your own code with `material`.
The prop types make `finish` and `material` exclusive. The `<Surface>`
shorthand, which today cannot be lit at all, gains one prop. Custom TSL
shaders and registry packs stay in `material` and are unaffected. The
finish material component still exists inside the library, loaded with the
canvas code like `SceneLitMaterial` is today, but no page imports it.

### Recommendation: C

C is the only option where the finish value is the whole API. It needs no component import and no nesting, and the shorthand Surface
can carry it. It also makes "unlit" the visible default, since an unlit
Surface is one with no `finish`. `Surface.LitMaterial` and
`SurfaceLitMaterialProps` are removed. Its scenes move to a finish without
a body color, which reproduces today's look (see
[Body color](#body-color)). Munari has no outside users, so the rename
touches only the four lab scenes, `tests/surfaceTypes.tsx`, the scene
lookup test and one Why snippet string.

A custom shader keeps today's path, as the lab's Analyze candidate does
(apps/lab/src/scenes/candidates/CandidateAnalyze.tsx):

```tsx
function Prism() {
  // The capture, its CSS size, its corner radii and the corner mask.
  const surface = useSurfaceNodes()
  // Your own TSL node material, built from those nodes.
  const material = useMemo(() => createPrismMaterial(surface), [surface])
  return <primitive object={material} attach="material" />
}

<Surface.Mesh material={<Prism />} />
```

## 2. Configuration

The question is how a developer picks a finish, changes part of it, and goes
past it.

### A. One shared type, presets plus overrides

```tsx
// Sketch — not built.
<Surface.Mesh finish="glazed-ceramic" />
<Surface.Mesh finish={{ preset: 'glazed-ceramic', color: '#c9b48a', crackle: 0 }} />
<Surface.Mesh finish={{ roughness: 0.4, clearcoat: 0.6 }} />
```

Every finish has the same fields: the lab's 22-field `Finish` struct, plus
`text`, `environment`, `lightGain`, `emissiveIntensity` and `side`,
which the lab keeps outside it or lacks. A preset is a
named starting value, and overrides merge over it one field at a time.
Mixing layers is allowed: a metallic lacquer is `{ preset: 'lacquer',
metalness: 1 }`. The types cannot stop a meaningless mix, such as sheen on
a mirror metal.

### B. A type per finish

```tsx
// Sketch — not built.
<Surface.Mesh finish={{ type: 'velvet', pile: 0.08, sheenColor: '#b8c4ff' }} />
```

Each finish exposes only the fields that mean something for it, under the
material's own words. Autocomplete is shorter and a typo is caught. Every
new finish adds a type and a translation to physical values, and a finish
between two types (a coated metal, a foil) needs a new type.

### C. Factory functions

```tsx
// Sketch — not built.
import { lacquer } from '@petepetrash/munari'
<Surface.Mesh finish={lacquer({ color: '#1d4e89' })} />
```

Each preset is a typed function. It reads well and can validate ranges at
the call. It adds one import per finish, and a finish stored in a theme is
a function result, opaque to a tweak panel that wants to list fields.

### Recommendation: A

The lab already proved one shared struct carries all five looks, and three
draws them all through one lighting model. A gives one type to learn, one
table to document, and plain objects that serialize, diff and sit in a URL
or a tweak panel. The `finishes` table is exported as data so a panel can
read preset values.

### Fields, units and ranges

Fields that are three properties keep three's name, unit and range, so the
escape hatch and the three docs read the same. One exception is
`iridescenceThickness`, a single film thickness that the lab writes as
three's `iridescenceThicknessRange`. Fields Munari adds use CSS px, the
unit the HTML is written in.

| Field | Unit and range | Changes the shader |
|---|---|---|
| `color` | CSS color three can parse; omitted means the HTML paints the body | omitting or giving it |
| `text` | `'unlit'` (default) or `'lit'` | yes |
| `roughness`, `metalness` | 0–1 | no |
| `ior` | 1.0–2.333 | no |
| `specularIntensity` | 0–1 | no |
| `clearcoat`, `clearcoatRoughness` | 0–1 | `clearcoat` crossing 0 |
| `sheen`, `sheenRoughness`; `sheenColor` | 0–1; CSS color | `sheen` crossing 0 |
| `anisotropy`; `anisotropyRotation` | 0–1; radians in the Surface's UV frame | `anisotropy` crossing 0 |
| `iridescence`, `iridescenceIOR`, `iridescenceThickness` | 0–1, 1.0–2.333, nm | `iridescence` crossing 0 |
| `edgeWidth` | CSS px, 0 is flat | no |
| `detail` | `'none'`, `'orange-peel'`, `'brushed'`, `'pile'`, `'glaze'` | yes |
| `detailScale`, `detailDepth` | CSS px; slope | no |
| `rimColor` | CSS color or null | no |
| `crackle`, `crackleScale` | 0–1; CSS px | `crackle` crossing 0 |
| `emissiveIntensity` | 0 and up, as today | no |
| `environment` | `'even'` or `'gradient'` | see [Lighting](lighting.md#3-lighting) |
| `lightGain` | `{ key, rim }` multipliers of the rig's power, default 1 | moving away from 1 or back |
| `side` | `'front'` or `'double'` | yes |

Values are strings and numbers only, so a page can build a finish without
importing three (see [SSR](relationships.md#ssr-and-the-page-bundle)). `side` is a string
for the same reason: `THREE.DoubleSide` is a three import.

The rows for `text`, `detail`, `crackle` and the four layers follow the
lab. `createFinishMaterial` takes `text`, `detail` and `hasCrackle` as
shape inputs. three's `MeshPhysicalNodeMaterial` switches each layer on
with `useClearcoat`, `useSheen`, `useIridescence` and `useAnisotropy`.
The `color` and `side` rows are new, because the lab always gives a color
and never changes the side. A change in the right column builds a new
pipeline. Every other write is a uniform update
and costs no compile. The types document the column, and a development
warning fires when a shape field changes more than once in a second.

### How the lab's knobs map

| Lab control | Finish field or lighting value |
|---|---|
| colors group | `color`, `sheenColor` |
| base group | `roughness`, `metalness`, `ior`, `specularIntensity` |
| edge and relief group | `edgeWidth`, `detailScale`, `detailDepth`, `crackle`, `crackleScale` |
| clearcoat group | `clearcoat`, `clearcoatRoughness` |
| sheen group | `sheen`, `sheenRoughness` |
| anisotropy group | `anisotropy`, `anisotropyRotation` |
| iridescence group | `iridescence`, `iridescenceIOR`, `iridescenceThickness` |
| finish choice, from the preset only | `detail`, `rimColor` |
| lit and unlit text buttons in the header | `text` |
| light and environment group | the canvas `lighting` value, see section 3 |

### Body color

A finish with a `color` paints its own body, and the HTML's transparent
areas show it. The lab's looks work this way. A finish with no `color`
uses the HTML's own pixels as the body. That is today's
`Surface.LitMaterial`, so Knobs becomes
`finish={{ roughness: 0.5, metalness: 0.18, emissiveIntensity: knobsTuning.lightDom }}`.

A body color in the finish needs a transparent content root in the scene
and a painted one on the page, for browsers that show the HTML. The lab
does this by hand. Munari has no attribute or class that tells CSS where a
Surface is presented, so every author would repeat the lab's switch. See
[Decisions for Pete](../materials-api.md#decisions-for-pete), question 4.

### Text color

A finish changes the body under the text, so the text color has to follow
it. Dark ink is unreadable on crimson lacquer. The material finishes lab
scene sets `--mf-body` from JS on its page wrapper (`.mf-page`), and
`--mf-ink` and `--mf-quiet` come from CSS rules keyed on its
`data-finish` attribute. The page presentation shows the HTML with no
canvas, so the CSS must hold the same colors.

| Design | Usage | Consequence |
|---|---|---|
| A. CSS owns ink, presets carry suggested ink | `style={{ '--ink': finishes.lacquer.ink }}` beside `finish="lacquer"` | The author sees and controls every color. Page and scene match by construction. One more value to pass |
| B. Munari writes custom properties | Munari sets `--munari-body`, `--munari-ink` and `--munari-quiet` on the content root; CSS uses `color: var(--munari-ink)` | No wiring. Munari writes styles on the author's DOM and owns a contrast rule for every custom color |
| C. The shader recolors unlit text | none | The page presentation shows the old colors, and text contrast leaves the author's hands |

Recommended: A. `finishes` gains `ink` and `quietInk` per preset, as
data. A theme value then feeds both the finish and the CSS, as the two
canvases example shows. See [Decisions for Pete](../materials-api.md#decisions-for-pete),
question 6.

### Escape hatches

1. Finish values cover every look the lab has made.
2. `/advanced` exports `createFinishMaterial(nodes, finish)`, which
   returns the `MeshPhysicalNodeMaterial` a finish builds. A caller edits
   its nodes and puts it in `material`. This is the lab's builder, made
   public.
3. A custom material in the `material` slot. `useSurfaceNodes()` gains
   `litMap`, the capture with alpha divided out in encoded space and then
   decoded (decision #48). That read is the hard part of every lit custom
   shader, and the lab copied it.

### Adding a finish

Munari adds a finish as a preset entry when the existing fields can express
it. A finish that needs new shading, such as paper fibers or a wax's light
scattering under the surface, adds a `detail` kind or a field, with its
conformance check and a decision entry. Wax may not fit the shared model at
all. three r186 ships `MeshSSSNodeMaterial`, a subclass of the physical
material with its own lighting model, and a wax finish built on it would
be a second material class behind the same `finish` prop. Foil, paper,
rubber and wax are being built in separate work, and this proposal does
not claim they fit.

A developer adds a finish as a value, which needs no code:

```tsx
// Sketch — not built.
export const brushedBrass = { preset: 'anodized-aluminum', color: '#b5a06a', anisotropy: 0.8 } satisfies SurfaceFinish
```

A finish that needs its own shader is a registry pack in the `material`
slot, built on level 2 or 3 above.
