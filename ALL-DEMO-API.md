# Demo source map

Use the [README](README.md) for the public API and the linked source for complete
examples. This map identifies each demo's current responsibility; it does not
keep another set of copied component snippets or claim that a past test run is
current proof.

Run `npm run lab`, then use `?scene=<route>`. Browser probes that inspect a scene's
own DOM use `&framed` to bypass the website shell. The [instrument guide](instruments/README.md)
records commands, measured limits, and what each check can establish.

| Route | Source | What it demonstrates |
| --- | --- | --- |
| `home` | [Home](apps/lab/src/scenes/home/Home.tsx), [postcard](apps/lab/src/scenes/home/HomePostcard.tsx), [starter](apps/lab/src/scenes/home/HomeStarter.tsx) | A basic Surface, a custom handoff, and a post-pose shadow companion |
| `workspace` | [Workspace](apps/lab/src/scenes/workspace/Workspace.tsx) | SceneSurface panels, keyboard focus, camera navigation, and a physical Dial |
| `glass` | [Glass](apps/lab/src/scenes/glass/Glass.tsx), [SDF compositor](apps/lab/src/scenes/glass/glassSdf.tsx) | SceneSurface content sampled by custom render passes and manual presentation receipts |
| `flight` | [Flight](apps/lab/src/scenes/flight/Flight.tsx) | One retained card moving between page targets, drag/reversal, and scene cleanup |
| `explode` | [Explode](apps/lab/src/scenes/explode/Explode.tsx) | Detached DOM paint layers supplied to SceneSurface.HTML at different depths |
| `genie` | [Genie](apps/lab/src/scenes/genie/Genie.tsx) | A reversible window handoff, retained form input, and FrameSurface video composition |
| `fisheye` | [Fisheye](apps/lab/src/scenes/fisheye/Fisheye.tsx) | Deformed Surface geometry whose input mapping follows its rendered shape |
| `slider` | [Slider](apps/lab/src/scenes/slider/Slider.tsx) | A magnifying lens over a retained, interactive HTML slider |
| `veil` | [Veil](apps/lab/src/scenes/veil/Veil.tsx) | useElementCapture samples a native article for a scrolling blur effect |
| `knobs` | [Knobs](apps/lab/src/scenes/knobs/Knobs.tsx) | Named parts and paint-matched anchors align responsive HTML with physical controls |
| `optics` | [Optics](apps/lab/src/scenes/optics/Optics.tsx) | SceneSurface specimens, lit materials, and lens-specific pointer mapping |
| `logo` | [Logo](apps/lab/src/scenes/logo/Logo.tsx) | Coordinated letter handoffs with separate geometry, materials, and motion |
| `selection` | [Selection](apps/lab/src/scenes/selection/Selection.tsx) | Native text selection plus captured pixels in a glass shader |
| `candidates` | [Candidates](apps/lab/src/scenes/candidates/Candidates.tsx) | A shared SurfaceCanvas for the seven interaction studies below |
| `refraction` | [Refraction](apps/lab/src/scenes/refraction/Refraction.tsx) | Two named HTML parts, sampled-source coverage, and native content after landing |
| `gallery` | [Gallery](apps/lab/src/scenes/gallery/Gallery.tsx) | Two content slots with the same aperture field driving pixels and pointer routing |
| `crystal` | [Crystal](apps/lab/src/scenes/crystal/Crystal.tsx) | Scene-only HTML viewed through a custom refracting material |
| `controls` | [Controls](apps/lab/src/scenes/controls/Controls.tsx) | A retained form gaining scene hardware through Surface anchors |
| `marble-hand` | [Marble Hand](apps/lab/src/scenes/marble-hand/MarbleHand.tsx), [page capture](apps/lab/src/scenes/marble-hand/marbleHandPageCapture.tsx) | CaptureContent supplies page reflections while native content remains visible |
| `plume` | [Plume](apps/lab/src/scenes/plume/Plume.tsx) | CaptureContent supplies letter images and anchors while editing stays native |
| `gravity` | [Gravity](apps/lab/src/scenes/gravity/Gravity.tsx), [word Surfaces](apps/lab/src/scenes/gravity/gravitySurfaces.tsx) | Inline Surface.HTML with layout reflow, physics, and restoration to its paragraph |
| `lamp` | [Lamp](apps/lab/src/scenes/lamp/Lamp.tsx) | Native HTML and separate lighting canvases; no Surface handoff |
| `rain` | [Rain](apps/lab/src/scenes/rain/Rain.tsx) | Native page geometry driving an independent canvas effect; no Surface handoff |
| `wordmark` | [Wordmark](apps/lab/src/scenes/wordmark/Wordmark.tsx), [MunariLogo](apps/lab/src/components/MunariLogo.tsx) | The reusable mark and its coordinated letter presentation |

## Candidate studies

Use `?scene=candidates&candidate=<study>`; add `&framed` for a direct browser probe.

| Study | Source | What it demonstrates |
| --- | --- | --- |
| `ripple` | [Ripple](apps/lab/src/scenes/candidates/CandidateRipple.tsx) | A press deforming captured control pixels and their shadow |
| `billow` | [Billow](apps/lab/src/scenes/candidates/CandidateBillow.tsx) | The shared press/wave behavior applied to one button |
| `unroll` | [Unroll](apps/lab/src/scenes/candidates/CandidateUnroll.tsx) | A SceneSurface menu retained through opening and closing, including early cancellation |
| `dissolve` | [Dissolve](apps/lab/src/scenes/candidates/CandidateDissolve.tsx) | Two stable HTML parts and a coordinated particle transfer between their slots |
| `analyze` | [Analyze](apps/lab/src/scenes/candidates/CandidateAnalyze.tsx) | A temporary material treatment on retained reading content |
| `copy` | [Copy](apps/lab/src/scenes/candidates/CandidateCopy.tsx) | A separately authored SceneSurface copy flying to the cursor |
| `delete` | [Delete](apps/lab/src/scenes/candidates/CandidateDelete.tsx) | Retaining a row until its exit animation and clearing draw finish |

## Choosing an example

Start with HomeStarter for setup, Flight for changing page parents, Controls for
DOM-aligned hardware, Selection for native element capture, and Plume for authored
capture content. Genie and Glass exercise advanced frame/presentation ownership.
Lamp and Rain show cases where ordinary HTML and canvas rendering are sufficient.

The [API/browser checks](instruments/api-all-demos/README.md) cover composition,
identity, capture, native fallback, and the full route-load sweep. A route loading
successfully is separate from its input, motion, and pixel-quality contracts.
