# Materials and lighting API: relationships and other settled points

Part of the [materials and lighting API proposal](../materials-api.md). Status: proposal. Nothing in it is built, and code blocks marked "Sketch" show an API that does not exist yet.

## 5. Relationships

### Instances and pipelines

A finish is per Surface. Two cards on one canvas can wear lacquer and
velvet side by side. The lab on `main` cannot do this: `FinishCard` and
`FinishMaterial` read the shared `liveFinish` and `studio` objects, so
every card wears the same finish. A tweak panel in the proposed API edits
one Surface's finish value.

Every Surface gets its own material instance. The capture texture, the
size and the corner radii are per Surface, so an instance cannot be shared.
Compiled programs are shared: three r186 caches pipelines by generated
shader code (`Pipelines.js` keys stages on the vertex and fragment source),
so twenty lacquer cards build one pipeline and lacquer beside velvet builds
two. Node builds are not shared: each Surface's material has its own
capture texture and uniform nodes, and three keys a node on its own id
(Node.js:470-472). Twenty lacquer cards cost twenty node builds and one
pipeline. A change to a compiling field on one Surface builds for that
one.

### Preset values

A preset is a value copied from the registry, so a later re-tune in
Munari's registry changes no page until its author copies the new value.
The registry module's history records each re-tune.

### Themes

| Design | Usage | Consequence |
|---|---|---|
| A. Values in a module | `export const theme = { card: { ...finishes['lacquer-crimson'], color: brand } }` | No API. Explicit at each Surface. Works across canvases |
| B. A canvas default | `<SurfaceCanvas finish={…}>` | Lights every Surface on the canvas, including ones written for unlit display, such as Glass |
| C. A context provider | `<Surface.FinishProvider value={…}>` around a page section | Inherits through the page tree. A reader has to look up the tree to know why a card is lit |

Recommendation A. A Surface should be lit only where its code says so,
because a lit Surface changes how its HTML's colors appear. Nothing
inherits.

### Several canvases

Each `SurfaceCanvas` has its own renderer, scene, rig and environment
bakes, and each pays its own bakes. Pipelines do not cross canvases,
because each renderer has its own GPU device. Finish values and light
handles do cross them. A light handle resolves its position in client
CSS px, from the viewport when `x` or `y` is omitted, so it lights a
header canvas and a content canvas from the same point.

### How a finish fits the existing parts

- `Surface.Root`, `<Surface>`, `SceneSurface.Root` and `<SceneSurface>`
  take `finish`. The Root's context carries it to the mesh and the HTML.
- `Surface.Mesh` draws the finish material when its Root has a finish.
  An element in its `material` slot can take that material over through
  `useSurfaceFinishMaterial(inputs)`.
- `Surface.HTML` is unchanged. Munari writes `--munari-body` on the
  page element and the source host (see [Body and text color](body-and-text.md)).
- `Surface.Prewarm` takes finishes, builds their pipelines, bakes their
  environments and loads the softbox tables when the rig has a sized key:
  `<Surface.Prewarm finishes={[finishes['velvet-midnight']]} />`.
  Prewarmed pipelines stay valid because the rig declares all its lights
  before the first draw.
- The rig and the finish are defined for match-DOM Surfaces. A
  `SceneSurface` mesh with manual placement in a 3D scene gets the rig at
  the same viewport point, and its shading is unverified.

## 6. Other things the design settles

### SSR and the page bundle

Page code that runs before a canvas mounts imports no three renderer code
(surfaceSceneLookup.tsx). A finish is plain data, and a light handle holds
plain numbers and adds no listener until a canvas mounts, so both are
safe to build on the server and on the first page. The page element's
`--munari-body` renders on the server. The finish material joins
`surfaceSceneComponents`, which `SurfaceCanvas` loads.

### Payload

- The physical material adds no bytes over the standard one, because
  WebGPURenderer registers every node material already
  (docs/payload-optimization-research.md).
- The lab's finish code on `main` is 19.8 kB gzip of commented TypeScript
  source across its five modules. The tuning module also holds the lab's
  live copies and listeners. The minified size of a library finish module
  is unmeasured, and materials-more adds film and relief modules.
- The softbox tables are 103 kB gzip minified, loaded only when the rig's
  key has a size.

### Disposal

Each finish material is disposed when its presenter unmounts, as
`Surface.LitMaterial` is today. The canvas owns its rig lights and
environment textures and disposes them when it unmounts. After the renderer
is lost the canvas bakes them again. A `THREE.Material` passed in
`material` stays the caller's to dispose.

### Entries

| Design | Consequence |
|---|---|
| A. Root entry, `/advanced` and registry | `finish` types, `lighting` types and `createSurfaceLight` sit beside `Surface`. `useSurfaceFinishMaterial` goes in `/advanced`. The presets and inks go in `registry/finishes` |
| B. A `/materials` entry | Saves no bytes: the page side is data and the canvas side already loads with `SurfaceCanvas`. Adds an import path to learn |
| C. Registry only | Every project copies the finish material too and keeps its own fork |

Recommendation A. The material finishes scene is the lab consumer that
decision #6 asks for before a name enters the root entry, and
`packages/react/src/index.test.ts` gains each new export.

### Evidence a build owes

Adopting this proposal needs decision #79 and checks for:

- premultiplied output of every finish (decision #5);
- the encoded-space alpha division in `litMap` (decision #48);
- one pipeline per finish shape across many Surfaces, and the node build
  time for N finish Surfaces, which a scene light toggle repeats;
- no rebuild when the rig changes a light's intensity, when `lightGain`
  changes through the lighting model, or when a present layer's amount
  crosses zero;
- the rig's lights placed outside the scene, with their world matrices
  updated before each draw;
- the five body color cases, on the native path and the snapDOM fallback,
  reading the first scene frame;
- finishes on the WebGL 2 backend;
- the environment bake time, and the lift waiting for it;
- the Knobs, Optics and Review notes looks after the move off
  `Surface.LitMaterial`, each under `lighting="none"` with its own lights.
