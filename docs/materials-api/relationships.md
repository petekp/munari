# Materials and lighting API: relationships and other settled points

Part of the [materials and lighting API proposal](../materials-api.md). Status: proposal. Nothing in it is built, and code blocks marked "Sketch" show an API that does not exist yet.

## 5. Relationships

### Instances and pipelines

A finish is per Surface. Two cards on one canvas can wear lacquer and
velvet side by side. The lab cannot do this today: `FinishCard` and
`FinishMaterial` read the shared `liveFinish` and `studio` objects, so
every card wears the same finish. A tweak panel in the proposed API edits
one Surface's finish value.

Every Surface gets its own material instance. The capture texture, the
size and the corner radii are per Surface, so an instance cannot be shared.
Compiled programs are shared: three r186 caches pipelines by generated
shader code (`Pipelines.js` keys stages on the vertex and fragment source),
so twenty lacquer cards build one pipeline and lacquer beside velvet builds
two. Changing a shape field on one Surface builds a pipeline for that one.

### Themes

| Design | Usage | Consequence |
|---|---|---|
| A. Values in a module | `export const theme = { card: { preset: 'lacquer', color: brand } }` | No API. Explicit at each Surface. Works across canvases |
| B. A canvas default | `<SurfaceCanvas finish="satin-polymer">` | Lights every Surface on the canvas, including ones written for unlit display, such as Glass |
| C. A context provider | `<Surface.FinishProvider value={…}>` around a page section | Inherits through the page tree. A reader has to look up the tree to know why a card is lit |

Recommendation A. A Surface should be lit only where its code says so,
because a lit Surface changes how its HTML's colors appear. A theme is
then an ordinary module. Overrides are one level deep: a preset, then the
fields given. Nothing inherits.

### Several canvases

Each `SurfaceCanvas` has its own renderer, scene, rig and environment
bakes. Pipelines do not cross canvases, because each renderer has its own
GPU device. Finish values and light handles do cross them. A light handle
in page CSS coordinates lights a header canvas and a content canvas from
the same point.

### How a finish fits the existing parts

- `Surface.Mesh` takes `finish` beside `placement`, `geometry`,
  `alpha` and `radius`. `finish` and `material` are exclusive.
- `<Surface>` passes `finish` to its mesh.
- `SceneSurface.Mesh` takes `finish` in the same way.
- `Surface.HTML` is unchanged. A finish with a body color asks its
  content root to be transparent in the scene.
- `Surface.Prewarm` takes finishes and builds their pipelines:
  `<Surface.Prewarm finishes={['lacquer', 'velvet']} />`. The light set is
  part of the cache key, so prewarm builds pipelines that stay valid only
  because the rig declares all its lights before the first draw.
- Lit or unlit text is the `text` field, default `'unlit'`. Unlit keeps
  the contrast the author chose under any light. Lit is the more physical
  choice, with highlights crossing the text.

## 6. Other things the design settles

### SSR and the page bundle

Page code that runs before a canvas mounts imports no three renderer code
(surfaceSceneLookup.tsx). A finish is strings and numbers, and a light
handle holds plain numbers, so both are safe to build on the server and on
the first page. The finish material joins `surfaceSceneComponents`, which
`SurfaceCanvas` loads.

### Payload

- The physical material adds no bytes over the standard one, because
  WebGPURenderer registers every node material already
  (docs/payload-optimization-research.md).
- The lab's finish code is 19.8 kB gzip of commented TypeScript source
  across its five modules. The tuning module also holds the lab's live
  copies and listeners. The minified size of a library finish module is
  unmeasured and probably smaller.
- The softbox tables are 103 kB gzip minified, loaded only with
  `lighting="softbox"`.

### Disposal

Each finish material is disposed when its presenter unmounts, as
`Surface.LitMaterial` is today. The canvas owns its rig lights and
environment textures and disposes them when it unmounts. After the renderer
is lost the canvas bakes them again. A `THREE.Material` passed in
`material` stays the caller's to dispose.

### Entries

| Design | Consequence |
|---|---|
| A. Root entry | `finish` types, the `finishes` table, `lighting` types and `createSurfaceLight` sit beside `Surface`. Decision #6 admits them when a lab scene uses them |
| B. A `/materials` entry | Saves no bytes: the page side is data and the canvas side already loads with `SurfaceCanvas`. Adds an import path to learn |
| C. Registry only | Every project copies the finish code and keeps its own fork |

Recommendation A, with `createFinishMaterial` in `/advanced` and extra
finish packs in the registry. The material finishes scene is the first
consumer that decision #6 asks for.

### Evidence a build owes

Adopting this proposal needs decision #79 and checks for:

- premultiplied output of every finish (decision #5);
- the encoded-space alpha division in `litMap` (decision #48);
- one pipeline per finish shape across many Surfaces;
- no lit material rebuild when the rig changes a light's intensity.
