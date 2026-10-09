# WebGPU migration plan

**Status: `SurfaceCanvas` and `FrameSurface` ported and verified with `gate:frame-surface`. `Surface` and the lab scenes are not ported.**

Munari will move from Three's `WebGLRenderer` to its `WebGPURenderer`. Shaders
will be written once in Three Shading Language (TSL). TSL compiles to WGSL for
WebGPU and to GLSL for the renderer's WebGL 2 fallback.

The migration uses stock Three and React Three Fiber through their public APIs.
No patched dependency, fork, or installed-source edit is allowed.

| Fact | Value |
| --- | --- |
| Base commit | `origin/main` at `70fd423` |
| Worktree | `~/Code/worktrees/munari/webgpu-restart` |
| Three | `0.185.1`, unchanged from `main` |
| Fiber | `9.7.0`, unchanged from `main` |

The three local commits on `pkp/browser-gate-recording` are not in this base.

## Evidence rule

The new renderer must prove a frame was drawn as well as `main` proves it
today. It does not need to prove more.

`main` releases retained HTML on these signals (decisions.md #25, #29):

- `Object3D.onBeforeRender` and `onAfterRender` on the drawing mesh
- `renderer.getRenderTarget() === null`, meaning the draw targets the canvas
- the material's `colorWrite`, `depthWrite`, and `stencilWrite`
- `texture.onUpdate`, which labels the generation Three uploaded

These callbacks also fire when an upload fails or a draw is empty. That gap
exists on WebGL today and stays out of this migration. If a check seems to need
proof that GPU commands ran or a copy was validated, stop and report it. Stock
Three exposes no API for that proof.

## Spike: one frame-backed Surface on stock WebGPU

The spike answers one question: can `FrameSurface` meet its existing browser
check on stock `WebGPURenderer`, using only the signals above?

1. Run the unmodified `npm run gate:frame-surface` on WebGL and record the
   result as the baseline.
2. Port `FrameSurface` and the `SurfaceCanvas` renderer setup to
   `WebGPURenderer`.
3. Port the gate's pixel reading. It calls `gl.readPixels` inside the draw
   callback, which WebGPU cannot do. The port reads the canvas after
   `render()` returns, in the same task, under the demand frameloop. This
   change stays inside `instruments/frame-surface/`.
4. Prove the ported gate still fails when it should:
   - a receipt naming generation N+1 while N is drawn
   - the existing tone-mapped control
   - the color-write-disabled and off-screen passes, which must produce no
     presentation receipt
5. Run the gate on WebGPU, then with `forceWebGL: true`. Each run asserts
   which backend actually ran, because headless Chrome can fall back to WebGL
   2 without saying so. Record any Chrome flags needed.

**Time box: three hours of work.** At the end, report the result whether it
passed or not, with backend identity, receipt sequence, RGB deltas, and fault
results. Scene ports start only after that report.

A failure that public APIs cannot fix is an upstream limitation. Report it
with options. Do not work around it.

### Spike result

Stock Three `0.185.1` runs `FrameSurface` on both backends. Chrome needed
`--enable-unsafe-webgpu` to expose WebGPU headless. Each run confirmed the
backend Three started.

These match the WebGL baseline exactly on WebGPU and on the WebGL 2 fallback:

- the receipt sequence `[A0, A2, B0, B2, B4, B6, B8]`, with a fresh epoch per hold
- mesh, geometry, and material identity through live replacement
- exact pixels for every receipt when the scene has no tone mapping
- the backing-store resize, at RGB error 0
- a blank canvas after the color-write-disabled pass

The ported pixel reader fails when it should. Reading the canvas before each
render instead of after gives RGB error 250 on both backends.

`FrameSurface` itself needed one change: its draw callback's renderer
parameter is typed by the one method it calls, `getRenderTarget()`.

Two behaviors differ from WebGL. Both come from one design choice in
`WebGPURenderer`. It draws each frame into an internal half-float target,
then runs an output pass that applies tone mapping and sRGB conversion to the
whole frame (`Renderer._renderScene`, `_renderOutput`).

**1. A material cannot opt out of tone mapping.** On WebGL, Surface and
`FrameSurface` materials set `toneMapped: false`, so HTML keeps its exact
colors under a tone-mapped scene. `WebGPURenderer` never reads `toneMapped`.
Under ACES tone mapping the HTML colors are off by up to 114 per channel on
both backends.

The gate's tone-mapping control depends on `toneMapped` too, so it cannot fail
on WebGPU. Color accuracy under a tone-mapped scene stays unproven until that
control is rebuilt.

**2. A plain Fiber `Canvas` issues no presentation receipts.** During every
draw, `renderer.getRenderTarget()` returns the internal target, never `null`.
`FrameSurface` therefore rejects every draw as off-screen, including the
visible one. It checks the target before color writes, so the
color-write-disabled pass was also rejected as off-screen. The color-write
check never ran.

`SurfaceCanvas` already defers render-target draws to the end of `render()`,
where the render target is `null` again. That path should work on WebGPU. The
spike did not port `SurfaceCanvas`, so it is unverified.

### Tone mapping

**Decision, 2026-10-08: renderer tone mapping stays off.** `SurfaceCanvas`
always renders with `NoToneMapping`, so HTML keeps its source colors. A scene
that wants tone mapping applies it in its own 3D materials:
`material.outputNode = toneMapping(mode, exposure, output)`. `output` holds the
lit color before `outputNode` replaces it.

The rejected alternatives were a post-processing pass that skips HTML pixels,
which costs a full-screen pass every frame, and tone-mapped HTML.

No browser run has yet confirmed a material-applied tone map.

What this changes in the lab:

| Tone mapping today | Canvases |
| --- | --- |
| `flat`, so none | 3 |
| Fiber's default ACES | 20 |
| Set explicitly by the scene | Glass, Home masthead, Lamp, Marble hand |

How many of the 20 default Canvases have 3D content whose look depends on ACES
is not yet counted. An upstream issue could ask Three for a per-material
opt-out.

### Presentation requires `SurfaceCanvas`

**Decision, 2026-10-08.** `FrameSurface` issues presentation receipts only
inside a `SurfaceCanvas`. In a plain Fiber `Canvas` it issues draw receipts
only. During a draw, `WebGPURenderer` reports its internal target, so only the
end of `render()` shows whether the frame reached the canvas. `SurfaceCanvas`
already owns that step.

The rejected alternative was for `FrameSurface` to wrap `renderer.render`
itself, which would give the end-of-frame step two owners.

### Current work

Done and verified on 2026-10-08:

- `SurfaceCanvas` creates a `WebGPURenderer` and awaits `init()`. Its `gl` prop
  takes `WebGPURendererParameters`, such as `forceWebGL`. The `flat` prop is
  gone because tone mapping is always off. Its callers no longer pass it.
- In development, `SurfaceCanvas` reports renderer tone mapping that a caller
  turned on, once per Canvas.
- `FrameSurface` marks a presentation receipt as spent when it reaches
  `onPresented`, not when it is taken (decisions.md #69).
- `FrameSurface` issues no receipts for empty geometry, for a source over the
  renderer's texture limit, or for a tainted source. `SurfaceCanvas` requests
  the adapter's full texture limit on WebGPU (decisions.md #70).
- All three gate stages run in a `SurfaceCanvas`. The presentation stage draws
  each phase itself, so the host sees the render target that phase uses. The
  tone-mapping control turns on renderer tone mapping.
- `gate:frame-surface` passes on WebGPU and the WebGL 2 fallback. `npm test`,
  `npm run lint`, and `npm run typecheck` pass.

Next:

1. Run a disposable check that a lit material applying its own ACES matches
   the same material under renderer ACES, beside exact HTML.
2. Handle WebGPU device loss in `SurfaceCanvas`. It listens only for WebGL
   context loss, which covers the fallback.
3. Apply the empty-geometry, texture-limit, and origin checks to `Surface`
   when it is ported.

The lab will not render on this branch until its GLSL materials are ported.

### Receipts for frames that never drew

A disposable probe drew one `FrameSurface` inside a `SurfaceCanvas` with one
fault per run. Headless Chrome, Apple Metal, Three `0.185.1`. The adapter's
texture limit was 16384 px. Results with the checks from decisions.md #70:

| Fault | WebGPU | WebGL 2 fallback |
| --- | --- | --- |
| None | both receipts, exact pixel | both receipts, exact pixel |
| Empty geometry | no receipts | no receipts |
| 10000 px source | both receipts, exact pixel | both receipts, exact pixel |
| 20000 px source, over the limit | no receipts, one development error | no receipts, one development error |
| Tainted source, before or after creation | no receipts, one development error | no receipts, one development error |
| Tainted source, then resized and redrawn clean | receipts, exact pixel | receipts, exact pixel |

Before the checks, empty geometry and over-limit sources issued both receipts
and drew nothing on both backends. WebGPU's default device limit of 8192 px
also made the 10000 px source draw nothing. A tainted source issued both
receipts on WebGPU, and on the fallback `render()` threw every frame. Main's
`WebGLRenderer` was not probed.

**Tainted sources.** On WebGPU, Three catches and ignores the exception from
`copyExternalImageToTexture` (`WebGPUTextureUtils`, the catch added for
three.js #32391), then calls `texture.onUpdate` as if the upload succeeded.
`FrameSurface` now checks once per canvas allocation and never hands Three a
tainted canvas. Whether HTML-in-canvas or snapDOM can produce a tainted canvas
is unverified.

A host-wide fallback on `renderer.onError` is not proposed. The callback is
device-wide and arrives after the frame, and an unrelated error in a scene
would send every Surface back to the page.

No upstream report is planned.

CI runs `gate:frame-surface` on a hosted Linux runner with no GPU. There Chrome
offers WebGPU through SwiftShader, but without three extra flags it cannot
allocate a WebGPU canvas texture and loses the device on the first frame. The
runner passes those flags on Linux. With them the gate passed on both backends
in a Debian amd64 container running Chrome 155, emulated on an Apple Silicon
Mac. It has not yet run on a hosted runner. `ci.yml` is unchanged.

## Known gaps on stock WebGPU

These affect the `Surface` path, not the spike. Each has a public replacement.

| `main` uses | WebGPU status | Replacement |
| --- | --- | --- |
| `gl.getCurrentViewport()` in `SurfaceMesh` raster alignment | absent | `renderer.getViewport()` scaled by pixel ratio, or the target's own viewport |
| material `onBeforeRender` for `litTexture.sync` | never called | the mesh's `onBeforeRender`, or a TSL uniform update callback |
| `onBeforeCompile` GLSL injection in `surfaceMaterials` | not supported by node materials | a TSL node graph |
| `SurfaceMesh` presents directly on a draw with a null render target | every draw shows the internal target | defer to the `SurfaceCanvas` frame tail, as `FrameSurface` does |
| the hardware texture size limit | device default 8192 | done in `SurfaceCanvas` (decisions.md #70); DOM Surfaces cap their texture size to it when ported |

DOM capture already draws into a 2D canvas that a `CanvasTexture` uploads. The
investigation confirmed that path works on WebGPU. Three's `ExternalTexture`
can wrap a native GPU texture later if a direct HTML upload is wanted.

## After a go

Port in this order, verifying each step on both backends before the next:

1. The binding: `Surface`, materials, capture uploads, and lifecycle.
2. The lab scenes, one at a time.
3. The registry copies.
4. Docs, packaging, and the full browser-check matrix.

Draft TSL ports of the lab scenes exist as 27 `*Nodes.ts` files in the Git ref
`refs/codex/snapshots/51df4817b7b7095c53b2093eaa371d61bceadcb3`, a snapshot of
the abandoned Codex worktree. They were tested only against a patched Three.
Copy one at a time as a starting draft with `git show <ref>:<path>`, and verify
each on stock Three. Do not check out or cherry-pick that snapshot.
