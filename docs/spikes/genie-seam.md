# Spike: seamless DOM and WebGL custody

Run 2026-08-09 in local Chrome 151, React 19.2.8, and Three r185.
The apparatus was standalone Puppeteer/Vite code in `/tmp`. It was deleted.

**Questions asked**

1. Can one video decoder and one frame canvas give DOM and WebGL the exact same frame and pixels during continuous playback?
2. Can one React-owned DOM host move between its native slot and an HTML-in-canvas canvas without losing browser-owned state?
3. Can Three's direct `HTMLTexture` path give exact color and a reliable first-draw receipt within one display frame?

**Verdict: viable with caveats.** The shared frame canvas and movable React host both pass. Stock `HTMLTexture` does not yet pass the evidence bar, so the first implementation should keep Munari's existing 2D `Surface` path.

## What we learned

### 1. One decoder and one shared frame canvas give exact video custody

One persistent `<video>` fed one visible 600×396 canvas. The same canvas fed a Three `CanvasTexture`.

- Decoded generations: **90**
- Simulated custody swaps: **30**
- Frame-generation mismatches: **0**
- RGB mismatches: **0 of 64,152,000 channel comparisons**
- Maximum and mean RGB error: **0**
- Equal-generation DOM and WebGL screenshot error: **0**
- First equal WebGL draw: **one rAF for all 90 frames**
- Upload-to-readback latency: **2.9 ms min, 4.1 ms median, 5.5 ms p95, 5.6 ms max**
- Mean decoded-frame interval: **40.45 ms** for the 25 fps film

This path did not need `CanvasDrawElement`. It removes both causes of the reported film seam: the second decoder and the switch from native-video presentation to canvas presentation.

This proves the pixel and frame-source invariant. It does not yet prove Genie's warped geometry or final compositing.

### 2. A React-owned host survives `moveBefore` when the canvas has layout custody

With `CanvasDrawElement` and `canvas.layoutSubtree = true`, one host completed 100 alternating moves. A React commit was forced after every move.

- React mounts: **1 → 1**; unmounts: **0**
- Host, input, video, and canvas identities: unchanged
- Input focus and selection: unchanged
- Uncontrolled checkbox and React local state: unchanged
- Nested scroll: **(137,53) → (137,53)**
- CSS animation: same object and phase; zero restarts
- Canvas: same node, context, dimensions, and bitmap hash
- Video: **+1.083 s and +27 presented frames**, monotonic
- Dropped frames: **0**
- Pause, seek, wait, stall, empty, and abort events: **0**

A plain canvas control lost nested scroll on its first move. `layoutSubtree = true` is therefore a required custody invariant, not an optional optimization.

One node cannot be visible in its native slot while it is also the immediate child required by HTML-in-canvas. The real handoff still needs a short texture bridge and a receipt that proves the new owner drew the right generation.

This result proves state continuity, not pixel continuity. Moving the same native `<video>` into the current capture path would still cross the native-video-to-canvas color boundary found in the audit. Video that needs an exact seam must use the shared canvas in both states.

### 3. Stock `HTMLTexture` is not ready for this handoff

The direct runtime probe failed before page initialization because its temporary server omitted Three's secondary module. It produced no valid pixel or timing sample, so this question is **not proven**.

The installed Three code still gives two decisive blockers:

- `HTMLTexture` hard-codes `RGBA8` in `three/src/renderers/webgl/WebGLTextures.js:1298–1303`, bypassing the normal `texture.colorSpace` internal-format path. sRGB DOM bytes are therefore sampled as linear unless the material adds an explicit sRGB decode.
- On a cold source, Three moves the node, requests paint, and returns before upload (`WebGLTextures.js:1268–1295`). Upload must occur in a later render.

`texture.onUpdate` followed by `mesh.onAfterRender` can probably form an upload-to-draw fence. The paint event has element identity but no generation number, so exact generation continuity still needs a separate test.

The decision is to avoid direct `HTMLTexture` in the first implementation. It is an optional future optimization, not a requirement for single-root custody.

## What surprised us

- WebGL did not change the shared canvas at all. The prior color shift came from changing presentation paths, not from WebGL itself.
- `moveBefore` preserved video, focus, form, animation, canvas, and React state. The required `layoutSubtree` setting was the difference between preserving and losing nested scroll.
- The existing 2D `Surface` path is sufficient for movable ownership. A new direct-texture stack would add risk before it adds value.
- `Surface.onFirstUpload` is named too strongly. It fires when `texture.needsUpdate` is set, before Three performs the upload or draw ([Surface.tsx](../../packages/react/src/primitives/Surface.tsx#L765-L812)).

## Still unknown

- Pixel continuity through Genie's real identity geometry at both walls.
- The exact bridge schedule when a host moves into or out of the capture canvas.
- A source-generation → paint → upload → draw receipt under CPU load.
- Pointer forwarding, accessibility, resize, cancellation, and WebGL context loss during borrowed custody.
- Direct `HTMLTexture` color parity after an explicit sRGB decode.
- Results on other browsers, Chrome builds, and GPUs. HTML-in-canvas remains experimental, and cross-browser `moveBefore` behavior was not tested.

## Recommended approach

### First build: fix the Genie film without changing generic ownership

- Keep one persistent decoder.
- Draw each `requestVideoFrameCallback` frame into one persistent canvas.
- Make that canvas the visible DOM film surface and the source of the airborne `CanvasTexture`.
- Give each draw a generation number.
- Keep the old owner visible until the texture's matching generation has uploaded and the mesh has drawn.
- Keep the current `SurfaceApp` capture for window chrome. Composite the shared film texture into the film region instead of mounting a second video.

### Next build: one movable window root on the existing 2D Surface path

- Add opt-in **borrowed ownership** to `createDomTextureSource` and `Surface`. Keep current owned adoption as the safe default.
- Render each `WindowBody` once in one persistent React root whose host is independent of the page layout.
- Move that host with `moveBefore` between the native slot and the 2D capture canvas. Require `layoutSubtree = true`.
- Hold the last valid texture across both moves. Release the previous owner only after a matching draw receipt.
- Return borrowed DOM immediately if acquisition is cancelled or WebGL loses context.
- Keep seamless native video on the shared frame-canvas path. Borrowed ownership alone does not normalize media color.

### Upstream improvements outside Genie

1. **Paint/upload/draw generations.** Expose a source epoch plus painted, uploaded, and drawn generation receipts from `Surface`. Add an honest `onFirstDraw` signal instead of treating `needsUpdate` as an upload.
2. **Borrowed source ownership.** Add a cancellable, idempotent opt-in lifecycle in `@munari/core`, then expose it through `@petepetrash/munari`. Record the original parent and anchor and always return the host.
3. **A shared media-frame source.** Provide one reusable decoder → sRGB canvas → generation stream for any lab with live video. This avoids per-scene decoder synchronization.
4. **Color and alpha contracts.** Declare canvas color space and premultiplication at texture birth. Add real-Chrome conformance assets for sRGB and BT.709 media. The current capability probe checks API presence, not pixel correctness.
5. **Context-loss custody.** Let a borrowed host return to native DOM before a renderer reset can leave both owners invisible.
6. **Dynamic raycast bounds.** If CPU-deformed consumer geometry becomes a supported package contract, add an opt-in bounds invalidation helper. Keep the immediate Genie fix local.

Do not replace `SurfaceApp` globally. The repo has nine other runtime consumers. Additive borrowed custody lets them keep the present contract.

## Cost signals

- **Shared film canvas:** about 4–5 Genie and instrument files. No new dependency.
- **Borrowed window root:** at least four production files — `htmlInCanvas.ts`, `Surface.tsx`, `Genie.tsx`, and `genie.css` — plus conformance and real-Chrome lifecycle tests. A clean persistent-root boundary will likely also change `useSourceHost.ts` or add one small primitive.
- **Generation receipts:** `Surface.tsx`, `SurfaceContext.ts`, the public export, conformance tests, and review of five current `onFirstUpload` consumers.
- **Direct `HTMLTexture`:** separate medium-sized work. It needs color correction, generation plumbing, and new runtime tests before adoption.

The real implementation must be written fresh. No spike code should be promoted.
