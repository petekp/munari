# Drawing only when something changes

<!-- review-gate author: claude-opus-5-5 -->

This proposal makes `"demand"` the default frame loop of `SurfaceCanvas`. It is not built yet. Today a `SurfaceCanvas` with no `frameloop` prop passes `undefined` to R3F's `Canvas`, which then draws on every display refresh, and the host treats it as `"always"` (`SurfaceCanvas.tsx:280`). Under `"demand"`, R3F draws only after something calls `invalidate()`.

On m2, the idle canvases measured spent 45–904 ms of GPU time per second as they ship today. Under `"demand"`, the ones with nothing animating drew 0 frames and spent 0 ms. Canvases with live captures kept drawing as those captures repainted. Every package path that changes what a Surface shows already requests its frame. Three package hooks never request theirs and would stall under the new default, and R3F's clock would restart at every capture. Three lab scenes depend on `"always"` without saying so in a prop.

## Recommendation

- Make `"demand"` the default where `SurfaceCanvas` destructures its props (`SurfaceCanvas.tsx:499`), so R3F's `Canvas` starts in `"demand"` and `:280` follows. Keep `frameloop="always"` as the explicit choice for scenes that animate continuously.
- An author's animation calls R3F's `invalidate()` from `useFrame` while it moves, and clamps `delta`. The first frame after an idle gap carries the whole gap as `delta`.
- In the same change, make `FocusScene`'s default camera tween, `use1DOF` (behind `Dial`) and `useCarriedMotion` request their frames. Keep R3F's clock from restarting when a work claim switches the frame loop.
- Give every lab canvas that leaves `frameloop` unset an explicit `frameloop="always"` in the same change, so no lab scene changes behavior. Convert them one at a time afterwards.
- Extend the idle-zero gate so an idle default `SurfaceCanvas` must draw nothing, and a DOM change or a resize must draw.

## What must draw a new frame

R3F draws a demand canvas only after `invalidate()`. A work claim (`host.claimWork()`) also switches the canvas to `"always"` until the last claim is released, then draws once more (`surfaceHostRegistry.ts:298-311`). The table lists every source of change found in `packages/` and `registry/`. "Yes" means the code requests the frame under `"demand"`.

| What changes | Requests a frame under "demand" | Where |
| --- | --- | --- |
| Captured DOM content repaints, including live captures | Yes | `surfaceSourceHost.tsx:254,260`. Optics' live clock drew 3.9 frames/s idle under demand. |
| A Surface's page box moves (scroll, layout) | Yes, through a polling loop | `SurfaceMesh.tsx:590-603` calls `watchSurfacePlacement(…, invalidate)`. The loop runs on every animation frame while idle (see the cost below). |
| Handoffs, lifts, landings, transitions, `useSurfaceDriver`, `useSurfaceMotion` | Yes | Protocol work claims frames (`SurfaceRoot.tsx:148`). `captureTransitionEffect.ts` invalidates on each capture frame. |
| Light handles (`createSurfaceLight`): `set`, resize, pointer under `follow: 'pointer'` | Yes | `surfaceLight.ts`: `attach` collects each canvas's `invalidate`. |
| Finish and lighting changes, finish chunk loads | Yes | `finishRig.tsx:245,359`, `finishLoader.tsx:149`, `SurfaceFinishMaterial.tsx:120` |
| Shader compile finishing | Yes | `surfaceCompile.ts:199` |
| A Surface unmounting | Yes | `SurfaceMesh.tsx:486`, and `docs/decisions/surface.md` |
| `FrameSurface` publishing a frame | Yes | `FrameSurface.tsx:255,450` |
| Canvas resize | Yes, by R3F | Fixture: a resize under demand drew 1 frame at the new size. |
| Renderer loss and remount | Yes | Fixture: after a forced GPU process crash, the new canvas drew 11 frames and all 12 Surfaces presented again. |
| Pointer tilt | Not a package feature | The finish pages tilt in lab code that invalidates (`MaterialFinishesSurface.tsx:140`). |
| `FocusScene`'s default 0.32 s camera tween | **No** | `FocusScene.tsx:958` steps the tween in `useFrame`. Arming it (`:392`) never invalidates, and `dt` is not clamped, so one late frame would finish the tween. Inferred from code; no lab scene exercised it. |
| `use1DOF` spring, behind the public `Dial` | **No** | `use1DOF.ts:148` steps the spring in `useFrame`. Releasing a drag and `impulse()` never invalidate. `delta` is clamped. Inferred from code; the sweep did not drag a dial. |
| `useCarriedMotion` | **No** | The page side runs its own `requestAnimationFrame` loop (`useCarriedMotion.ts:56`). The mesh reads the sample in `useFrame` and never invalidates. Logo uses it and showed no stall in the sweep, which did not test it directly. |
| R3F's clock across work claims | **No** | Each work-claim edge calls `setFrameloop`, which in R3F 9.8.1 sets `clock.elapsedTime` to 0 (`SurfaceCanvas.tsx:206-220`). Today a default canvas is already `"always"`, so the edge is skipped. Under a `"demand"` default every capture switches the mode twice, and anything posed from `clock.elapsedTime` would snap back. Inferred from code; not measured. |
| `SurfaceAnchorGroup`, `SurfacePrewarm`, `surfaceOcclusion` | Not needed | They run inside frames other code requests. |
| `registry/focus-orbit` camera tween | **No** | `FocusOrbitRig.tsx:381` steps the tween in `useFrame`. drei's `OrbitControls` invalidates on its own changes. |
| `registry/glass` compositor | Not needed | `glassSdf.tsx:726` takes over rendering at priority 1 and draws when a frame runs. Lab Glass's pointer parallax (`Glass.tsx:615`) reads `pointer` in `useFrame` and never invalidates. |

### Lab scenes under "demand"

The activity probe ran 39 lab scenes on m2. `default-demand` gives `"demand"` only to canvases that leave `frameloop` unset, which is the proposed change. `all-demand` forces it on every `SurfaceCanvas`. Frames are counted in an idle window of about 2.3 s, a pointer sweep and a click. Settled screenshots are compared with `all-always`, and a repeat of `all-always` sets the noise floor.

Six lab files leave `frameloop` unset: `Candidates.tsx`, `Selection.tsx`, `Optics.tsx`, `Crystal.tsx`, `MarbleHand.tsx` and `logoScene.tsx`. Under `default-demand`:

- MarbleHand stops updating. Its hand follows the pointer in `useFrame` (`MarbleHand.tsx:284`) and never invalidates. After the sweep, the hand stayed where it was, while under `"always"` it followed the pointer. Its background is a separate `requestAnimationFrame` canvas and kept drawing.
- Candidates and Selection depend on `"always"`, and say so in comments (`Candidates.tsx:16-18`, `Selection.tsx:405-407`). Candidates' effects and Selection's bead step in `useFrame` and never invalidate. Selection also moves its pointer light on `pointermove` without invalidating (`Selection.tsx:352`). The sweep never selected text or started an effect, so their matching screenshots show only that nothing was triggered.
- Crystal's main pipeline fails to compile in every mode (`no matching constructor for 'vec2<f32>(vec3<f32>)'`), so its result says nothing. It drew 86 frames in the idle window under demand, from its live capture.
- Optics drew 8 frames in the idle window, from its live clock. Logo drew 8. Both settled screenshots matched `"always"` within the noise floor (Logo's floor is 1.2%). Logo's mark floats through `useCarriedMotion`, which is one of the package gaps, so its scene-mode float is unverified.
- Scenes that set `frameloop` themselves, including FinishDemo through `finishDemoRecipe.ts:79`, are unchanged under `default-demand` by construction.

Four scenes set `frameloop="always"` explicitly: Knobs, ReviewNotes, Controls, and the room canvas in `App.tsx:434` that serves Glass, Explode and Workspace. The proposed default does not touch them. Under `all-demand`, three of them break without code changes:

- Knobs drew 0 frames during the sweep and the click. Its settled frame differed from `"always"` mostly in the panel's lighting (4.8% of pixels, floor 1.9%).
- ReviewNotes drew 0 frames. Its notes never landed on the teapot (12.6% differ, floor 0%).
- Glass drew 0 frames during the sweep. Its bubbles and pointer parallax did not move (4.4% differ, floor 0.6%).
- Explode, Workspace and Controls matched `"always"`. The sweep does not drag, focus or scroll, so their main interactions are unverified.

Eight scenes switch between the two modes themselves. Forcing `"demand"` broke Fisheye (6.6%) and Slider (1.6%), which use `"always"` while their lens moves.

## What idle costs

The cost probe measures a 5 s idle window after an 8 s settle, three rounds per page, on m2 (Chrome 159, headless, 1440 × 900 at device pixel ratio 2). Cells give the median and range. "Today" is the page as committed; "demand" forces it on every `SurfaceCanvas`. "Frames/s" counts frames that ran GPU passes. "GPU" sums render-pass durations from three's timestamp queries. "GPU process" is the CPU time of Chrome's GPU process, which encodes commands and composites.

| Page | Frame loop today | Frames/s today → demand | GPU ms/s today | GPU ms per frame | Main ms/s today → demand | GPU process ms/s today → demand |
| --- | --- | --- | --- | --- | --- | --- |
| Blank page | – | – | – | – | 1.1 | 0.8 |
| Knobs | always | 60 → 0 | 904 (762–981) | 15.1 (12.6–16.4) | 170 → 106 | 393 → 311 |
| Glass (`registry/glass`) | always | 60 → 0 | 585 (519–687) | 9.7 (8.6–11.4) | 107 → 16 | 280 → 12 |
| Workspace (`registry/focus-orbit`) | always | 60 → 27 (24–29) | 187 (184–193) | 3.1 (3.1–3.2) | 534 → 277 | 205 → 132 |
| Optics | unset | 60 → 3.9 | 45 (44–47) | 0.7 (0.7–0.8) | 91 → 24 | 218 → 33 |
| Bench, 12 `glass-frosted` cards, forced to `"always"` | demand | 60 → 0 | 230 (172–252) | 3.8 (2.9–4.2) | 135 → 24 | 225 → 12 |
| Light | own renderers | 180 in every mode | 537 (526–540) | 3.0 (2.9–3.0) | 174 | 372 |

The probe also ran each page with every canvas forced to `"always"`. For Knobs and Glass that is the same configuration as today, yet the medians differed by 13% for Knobs (787) and 24% for Glass (724). Treat differences under about 25% between rows as run noise.

Under `"demand"`, GPU time fell to 0 wherever nothing animated. Workspace and Optics kept some, because their live captures repaint: 81 ms/s and 3.2 ms/s.

Light does not use `SurfaceCanvas`. It drives three of its own `WebGPURenderer`s from `requestAnimationFrame` (`LightLamp.tsx`), so the default does not affect it. Its numbers come from a separate three-round run with the same settings.

The bench calls `getCurrentTexture` twice per frame, so a count of those calls reads 120 while it draws 60 frames a second. The bench page already sets `frameloop="demand"` (`MaterialFinishesGlass.tsx:221`) and drew 0 frames idle as committed. Its `"always"` row is what the page would cost without that prop. The quality finding on `origin/quality-tiers` (`docs/quality/README.md`) gives 1.2–2.3 ms of GPU time per frame. That is the cost of one frame, not evidence that the bench draws while idle.

Under `"demand"`, most of the remaining idle work comes from outside the canvas.

- The idle bench under demand spent 24 ms/s of main thread and ran 120 animation-frame callbacks a second, against 1.1 ms/s and none on a blank page. The profile attributes a few ms/s to `getBoundingClientRect` and the placement watcher's `sample`. The watcher accounts for 60 of the callbacks (`docs/performance-audit.md` item 3). Which code runs the other 60 is unverified.
- Knobs under demand kept 106 ms/s of main thread and 311 ms/s of GPU process with the canvas drawing nothing. Its `KnobsArt` loop redraws a drifting SVG picture up to about 80 times a second (`KnobsArt.tsx:26-75`). The profile shows about 10 ms/s of self time in that loop and its `setAttribute` calls. The rest of the cost is unattributed. The scene's light rig reads the same clock (`Knobs.tsx:502`). Converting Knobs to `"demand"` would therefore need that loop to request frames, or the glints would stop while the picture drifts.
- The lab header wordmark rebuilds its letter geometry on every animation frame. Knobs with the header spent 326 ms/s of main thread under demand, against 106 without it, so the header costs about 220 ms/s. The table uses `?bare` pages, which leave the header out.

### What an author's animation needs

A fixture (`instruments/idle-render/fixture`) mounts 12 Surfaces on one `SurfaceCanvas` and a mesh the author animates in `useFrame`. Each case ran once on m2.

| Frame loop | Animation | Idle frames/s | Result |
| --- | --- | --- | --- |
| default (`"always"`) | none | 60.5 | – |
| `"demand"` | none | 0 | A resize drew 1 frame at the new size. |
| `"demand"` | rotation += `delta`, no `invalidate` | 0 | Frozen. One external `invalidate()` drew 1 frame and the rotation jumped 4.95 rad, the whole idle gap as `delta`. |
| `"demand"` | the same, `invalidate()` every frame | 60 | Works, and costs what `"always"` costs. |
| `"demand"` | eases to a target, clamps `delta` to 1/30 s, `invalidate()` only while moving | 0 | A new target drew 69 frames and ended exactly on target. |

An animation that runs forever needs `frameloop="always"` or an `invalidate()` every frame. An animation that ends needs `invalidate()` while it moves and a clamped `delta`. Without the clamp, the first frame after a pause jumps.

## Proposal

### The default

`SurfaceCanvas` uses `"demand"` when `frameloop` is unset. Every package path that changes a Surface already requests its frame, so a page of static Surfaces draws nothing until something changes.

### How an author's animation asks for frames

Use R3F's `invalidate()` from `useFrame` while the animation moves, and clamp `delta`, as the fixture's `settle` case does. This needs no new API and is how R3F documents demand rendering. A scene that animates continuously sets `frameloop="always"`. The README and `docs/authoring.md` should each show the pattern once, with the clamp.

### What the idle-zero gate asserts

Add a case to `gate:idle-zero` that mounts the fixture with `frameloop` unset and asserts:

- 0 canvas frames over the quiet window, counted with `GPUCanvasContext.getCurrentTexture`;
- at least 1 frame after a DOM change inside a Surface;
- at least 1 frame after a viewport resize, with the canvas at its new size.

These checks count frames and need no timestamp queries.

### Migration

1. Package, in the same change as the default:
   - `FocusScene`'s default tween invalidates while it runs and clamps `dt`.
   - `use1DOF` invalidates while the spring is unsettled, after a release and after `impulse()`.
   - `useCarriedMotion` makes the mesh side request a frame while the sample moves. Logo's float never stops, so in scene mode Logo would draw every frame, as it does today.
   - `settleFrameloop` keeps `clock.elapsedTime` when it switches the frame loop.
2. Registry: `focus-orbit`'s tween invalidates while it runs.
3. Lab:
   - The six files that leave `frameloop` unset set `frameloop="always"`, which keeps today's behavior. MarbleHand, Candidates and Selection stall without it. Optics, Crystal and Logo were not shown to need it, but the sweep cannot clear them. MarbleHand's canvas drew nothing while idle under `"demand"`, so invalidating on pointer movement may serve it later at lower cost.
   - Converting a scene to `"demand"` is separate work, scene by scene, with a check that drives its own interaction. Knobs and Glass would save the most: 904 and 585 GPU ms/s idle on m2. Each needs its pointer code to invalidate. ReviewNotes needs its note landings to invalidate.

## Decisions for Pete

1. The default.
   - A: `"demand"`. Idle `SurfaceCanvas` pages draw nothing. Costs four package fixes and an explicit `frameloop="always"` on six lab files. **Recommended.**
   - B: keep `"always"` and recommend `"demand"` in docs. Costs nothing now. Every author who forgets pays the idle cost, 45–904 GPU ms/s per canvas on the pages measured on m2.
2. How an author's animation asks for frames.
   - A: R3F's `invalidate()` plus a clamped `delta`, documented. No new API. An author who forgets the clamp gets a one-frame jump after each pause. **Recommended.**
   - B: a helper hook that steps an animation with a clamped `delta` and requests frames until it reports done. Removes the jump by construction; adds a public name and a little payload.
   - C: `frameloop="always"` only. Simplest; costs the full idle price on any page with one animation.
3. What the gate covers.
   - A: canvas frames only, as above. **Recommended.**
   - B: also bound idle animation-frame callbacks. This would fail today on the placement watcher, so it waits until that polling is replaced.
4. How far the lab migration goes.
   - A: pin the six unset files to `"always"` and change nothing else in the lab. **Recommended** for the default change.
   - B: also convert scenes to `"demand"`, starting with Knobs and Glass. Saves the most GPU time. Needs per-scene work, and checks of drag, selection, focus and scroll that this probe does not cover.

## Method and limits

- All numbers come from one machine, m2, in headless Chrome 159. Spot checks during the runs showed other load: OrbStack at 118–174% CPU, Spotlight, Safari and an XProtect scan. The blank-page row ran between pages as a floor. A different machine or a headed browser will give different absolute numbers.
- Headless Chrome ran animation frames at 60 Hz. m2's built-in Liquid Retina XDR display refreshes at up to 120 Hz. An earlier session recorded headed Chrome running at 120 Hz on that kind of display; this run did not check it. If so, a headed page under `"always"` draws twice as often, and the "today" columns understate it.
- Every cost row ran with timestamp queries on, resolved every 250 ms. That adds main-thread and GPU-process work to the drawing rows. It may also explain part of the 11–12 ms/s of GPU process left on idle demand pages, against 0.8 on a blank page. No run without timestamps was made.
- GPU time is the sum of render-pass durations. Passes can overlap on Apple GPUs, so the sum is an upper bound on how long the GPU was busy. For the bench it gave 3.8 ms per frame; the quality branch's throughput measure gave 2.17 ms for the same finish (`docs/quality/measurements.md` on `origin/quality-tiers`). Each "GPU ms/s" figure is comparable only with the others in this table.
- The activity sweep runs at 1280 × 800, device pixel ratio 1. It moves the pointer and clicks the centre. It does not drag, select, type, scroll, focus or resize. A scene that matched `"always"` is verified only for those inputs. The noise floor comes from one repeat, and the 8/255 threshold hides differences under about 1% of pixels.
- Pixel comparison cannot judge continuously animated scenes (MarbleHand, Lamp, Genie, Home, Rain). MarbleHand's background alone differs by 67% between two `"always"` runs, so it was judged from its screenshots and frame counts.
- The four package gaps are inferred from code. No browser run exercised `FocusScene`'s tween, a `Dial` release, `useCarriedMotion` or a clock restart under `"demand"`.
- The fixture cases ran once each, and report counts and positions, not timings.

The quality branch proposes a `PerformanceMonitor` recipe that lowers quality when the frame rate drops. Under `"demand"` an idle canvas reports no frames, and a short burst reports few. That recipe would need to judge frame time during bursts instead of frame rate. This is not measured.

To repeat a run, see `instruments/idle-render/README.md`.
