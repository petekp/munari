<!-- review-gate author: claude-opus-5-5 -->
# Loading Munari's effects

Status: built, 2026-11-26. Decisions #80 and #81 state the current
behavior; this page keeps the design and its reasons. The finish API it
mentions as a proposal has since landed (decision #79).

Users notice loading on a first visit because shader pipelines compile
with blocking calls while the page is on screen. On m2, each scene
produced no frames for 1.6–3.3 s in total on a cold load, and 0.08–0.5 s
on a warm load. On loopback, the page itself painted early: a median
first paint of 32–76 ms on Bench and 0.43–0.55 s in the catalog demos,
which load in an iframe. A real network would move both later.

The proposal makes loading look like a browser feature. The page
presentation is the first frame and stays until the scene presentation is
complete. Every pipeline is built with the asynchronous calls. A blocking build
stops frames for the whole page, so none should run before the lift or
after it.

| Part | What it holds |
|---|---|
| [Inventory](inventory.md) | Every asynchronous or costly step, with its code |
| [Measurements](measurements.md) | Cold and warm timings on m2, and what the probes can show |
| [After the loading build](measurements-after-build.md) | The same cells measured on the branch against its base |
| [Browser precedents](browser-precedents.md) | How images, fonts, CSS, view transitions and paint holding hide their costs |
| [Decisions](decisions.md) | The choices Pete needs to make, with options and costs |
| [Review](REVIEW-loading.md) | The independent review of these files |

## What the user sees

Terms used below:

- The page presentation is the Surface's live HTML in the page.
- The scene presentation is the same content drawn by three.js in a
  canvas.
- The lift is the handoff from page to scene, which today waits for a
  qualified draw of the current capture (decisions #65, #68).

| Moment | What is on screen | What Munari does |
|---|---|---|
| First paint | The page presentation, in its final box. Nothing moves later | Nothing yet. The finish API proposal keeps three's renderer out of page code |
| Preparing | The page presentation, live and interactive. No cover, spinner or blank area | Adapter, device, capture, environment bake, node builds and async pipeline builds, all off screen |
| Ready | The lift, in one frame | Draws the final material, whose pipelines are built |
| Late | The page presentation until ready, then the lift ([D3](decisions.md#d3-a-scene-that-is-ready-late)) | Nothing extra. The app may react to `late` |
| A later change, such as a new finish | The previous look until the new one is built ([D5](decisions.md#d5-material-changes-after-the-lift)) | Builds the new pipelines asynchronously |
| Failure | The page presentation, for good | Reports the error. Never shows a broken scene |

Two cases do not fit the first row today.

- A finish card's page presentation shows its text with no body, because
  the finish material draws the body. On Bench, cold, that lasted from
  650 ms to 2.77 s. [D1](decisions.md#d1-the-page-look-while-a-finish-prepares)
  chooses what the page shows instead.
- A `SceneSurface` has no page presentation, so nothing shows until its
  scene draws. Knobs' panel was absent until 1.66 s cold.
  [D2](decisions.md#d2-a-scenesurface-before-it-is-ready) chooses its
  placeholder.

## What Munari does by default

These are defects the measurements found. Fixes 1, 2 and 3 need no new
API.

1. Build from the material as it will draw. Bench's four cards stopped
   frames for over 1 s on four blocking builds at reveal. The async
   stand-ins were cloned before the card's before-draw callback had set
   its finish values and environment map
   ([measurements](measurements.md#why-the-cards-arrive-late)). The build
   should start after that callback has run once, and restart when the
   material's `Material.version` changes. three raises it on
   `needsUpdate` and when clearcoat, sheen or anisotropy cross zero
   (three 0.186.1, `Material.js:1227-1231`,
   `MeshPhysicalMaterial.js:383-540`).
2. Build the environment bake and the mipmap passes asynchronously too.
   On a cold Bench load, the bake's blocking builds stopped frames for
   267–350 ms, and the mipmap prebuild cost the GPU process about 100 ms.
   three's `PMREMGenerator` builds its pipelines with the blocking call.
   How to build them ahead with `compileAsync` is not yet worked out.
3. Let the lift wait for the bake and the builds. The finish API proposal
   already asks for this. The bake's CPU part took about 48 ms. Its GPU
   work finished 0.39–0.46 s later cold and 0.07–0.15 s later warm.
4. Request the adapter and device once per page, and build every
   pipeline asynchronously, including meshes that are not Surfaces
   ([D4](decisions.md#d4-what-the-async-hold-covers)). A one-canvas
   `SurfaceCanvas` page requests the adapter three times
   ([inventory](inventory.md)). Knobs builds 9 pipelines with the blocking
   call after its first draw, mostly for meshes that are not Surfaces.
   Light creates its own three renderers, so these fixes reach it only if
   Light moves onto `SurfaceCanvas` or shares one device.

How soon a fixed Bench would be ready is unmeasured. The final shaders are
larger than the stand-ins, which would lengthen the async builds. The
bake's blocking builds delayed the async ones, which inflates the measured
0.64–0.73 s. Neither effect has been sized.

Shader caches only help revisits. Dawn in Chrome has a memory cache and a
disk cache for its blobs. A warm load in the same browser process cut the
longest stopped stretch to under 0.3 s. What the disk cache stores on
Metal, and how a visit after a browser restart compares, were not
measured.

## What a developer controls

| Control | Default | Where it lives | Decision |
|---|---|---|---|
| When preparation starts | Eager, at mount | `loading="lazy"` on a Surface, a sketch | [D6](decisions.md#d6-eager-or-lazy) |
| Preparing ahead | Off | `Surface.Prewarm`, which exists; the finish API proposal adds finishes | none |
| Knowing when content is complete | Reported | loading-spec's `<Loading onLoaded late>` and `useLoadingWait` | [D7](decisions.md#d7-the-readiness-api) |
| Suspense | Not used | none | [D7](decisions.md#d7-the-readiness-api) |
| What shows while preparing | The page presentation | Finish presets and `SceneSurface` placeholders | [D1](decisions.md#d1-the-page-look-while-a-finish-prepares), [D2](decisions.md#d2-a-scenesurface-before-it-is-ready) |
| A late scene | Lift when ready | loading-spec's `late` notice | [D3](decisions.md#d3-a-scene-that-is-ready-late) |
| Errors | Stay on the page presentation | loading-spec's `error` status | none |
| Route preloading and priority | none | Deferred | [D8](decisions.md#d8-deferred-route-preloading-and-priority) |

Sketch, not built:

```tsx
<Loading onLoaded={announceLoaded} late={{ afterMs: 4000, onLate: chooseNative }}>
  <SurfaceCanvas>
    <Surface.Prewarm finishes={[finishes['velvet-midnight']]} />
    <Surface finish={finishes['lacquer-oxblood']}>…</Surface>
    <Surface loading="lazy" finish={finishes['satin-polymer']}>…</Surface>
  </SurfaceCanvas>
</Loading>
```

## Errors and fallbacks

The page presentation is the fallback. It is already on screen, so a
failure changes nothing the user sees.

- No WebGPU adapter, a failed device or a lost device: Surfaces stay on,
  or return to, the page. Renderer loss already does this
  (`surfaceHandle.ts:892-900`).
- A failed pipeline build: today it resolves and the presenter draws as
  three builds it (`surfaceCompile.ts`). Under this proposal the
  Surface stays on the page and reports `error`.
- An app that wants a different fallback, such as Light's native
  controls, uses loading-spec's `late` notice or `error` status.

## What happens to loading-spec.md

[loading-spec.md](../loading-spec.md) stays. It is the reporting layer:
`<Loading>`, `useLoadingWait`, the term Shown, and its settled policy.
This proposal is the behavior layer under it. Four amendments:

- A Surface on the scene is Shown only once its final material has drawn,
  with its environment and with pipelines built asynchronously.
- It plans a decision entry numbered #76. That number now
  belongs to the pipeline hold, so the entry needs a new number.
- Its product contract says covering is the app's job. That stays true,
  and a cover becomes unnecessary: the page presentation is a complete
  first frame once D1 and D2 are settled.
- A lazy Surface out of view does not hold `onLoaded`, as a lazy image
  does not delay `load`. Its settled policy otherwise holds out-of-view
  presenters.

## What this changes in the finish API proposal

The finish API proposal on the `materials-api` branch
([relationships](https://github.com/petekp/munari/blob/materials-api/docs/materials-api/relationships.md),
[lighting](https://github.com/petekp/munari/blob/materials-api/docs/materials-api/lighting.md))
is a proposal, unbuilt. This design touches it in four places.

- `Surface.Prewarm finishes` must build from the finished material, with
  its environment and finish values set. Bench's stand-ins miss both today.
- Its list of evidence a build owes names the bake time as unmeasured.
  Bench measured about 48 ms of CPU work, 267–350 ms of stopped frames
  from its blocking builds, and 0.39–0.46 s more until the GPU finished
  it cold.
- A finish change after the lift follows D5.
- If Pete picks D1's per-finish page look, each finish preset gains CSS
  for its page presentation. The proposal's `--munari-body` already
  paints the body color there.

## Not yet known

- How a restart-only visit compares, with disk caches and empty memory.
- Other GPUs, other platforms and real networks.
- Whether Bench's 0.03–0.06 layout shift is visible.
