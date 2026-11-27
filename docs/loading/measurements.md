<!-- review-gate author: claude-opus-5-5 -->
# Loading measurements

Status: measured 2026-11-26 on one machine, at `f844db5`. Part of the
[loading proposal](README.md).

The first visit is slow because shader pipelines compile with blocking
calls while the page is on screen. On a cold load, each scene produced no
frames for 1.6–3.3 s in total, in stretches of up to 2.1 s. A warm load
lost 0.08–0.5 s in total. The page itself paints early on loopback. The
scene arrives late, and the lab reveals the page before the scene is ready.

## How it was measured

The probe is throwaway code in `.scratch/loading-probe/` on the
`loading-design` branch (`install.mjs`, `run.mjs`, `patch-lab.mjs`,
`diag.mjs`). It was not committed. It follows
`instruments/genie-first-flight/`.

- Machine: m2, a MacBook Pro with an Apple GPU. WebGPU reported
  vendor `apple`, architecture `metal-3`.
- Browsers: headless Chrome for Testing 156.0.8078.47 and Chrome
  159.0.8154.33, both through Puppeteer with the repo's `WEBGPU_CHROME_ARGS`,
  `--enable-features=CanvasDrawElement`,
  `--disable-renderer-backgrounding` and
  `--disable-backgrounding-occluded-windows`. Viewport 1440×900 at DPR 2.
- Build: `npm run build` of the lab at `f844db5` plus the marks
  below, served by `vite preview` on `http://127.0.0.1:5192`. A second
  preview of the same build listened only on the Tailscale address. The loopback address matters.
  WebGPU needs a secure context. The Tailscale address served the same
  build over plain HTTP, and three fell back to WebGL 2 without an error.
- Scenes: Bench (`?scene=finish-demo`), Knobs and Light. Knobs and Light
  are catalog demos, which the shell loads in an iframe, so the probe reads
  the iframe's clock. Times for them start at the iframe's own navigation,
  which began 95–157 ms after the shell's on cold loads and 45–96 ms on
  warm loads. Filmstrip times use the shell's clock.
- Engines: html-in-canvas, and snapDOM forced with `?capture=snapdom`.
- Cold and warm: each of 3 fresh profiles loads a page twice in one
  browser process. The first load is cold. The second, a new tab on the
  same URL, is warm: the HTTP cache and the GPU process's in-memory caches
  both hold the first load's work. A visit after a browser restart, which
  has only the disk caches, was not measured. The probe adds a
  random number to every WGSL entry point. It differs per profile and
  stays the same for both loads. So no earlier run's compiled shader can
  match a cold load, and the warm load can reuse the cold load's cache.
- A load settles when fonts are loaded, no async pipeline is pending, and
  no capture, node build or adapter request has started for 2.5 s. The
  wait is at least 3 s and at most 25 s. No load hit the limit.
- Bench loads then switch one card's finish to Oil-slick foil and record
  3 s.

The recorder runs before any page script. It wraps the WebGPU entry
points, three's renderer, `onpaint`, image decode and `fetch`, and reads
Performance Observer entries. `patch-lab.mjs` added `performance.mark`
calls around the softbox tables and each environment bake, and an
`onSubmittedWorkDone()` call to time the bake's GPU work, on m2 only.
One traced load per cell added a Chrome trace with screenshots.

## What the probes can and cannot show

- Times are page clock times from the recorder's install, which runs at
  navigation start. A wrapped call's time is when JavaScript issued it.
  `createRenderPipeline` returns at once in the page; the compile runs
  in the GPU process. Its cost shows as a frame gap and in the trace's
  `DeviceBase::APICreateRenderPipeline` events on `CrGpuMain`, not as a
  long call.
- Frame gaps come from `requestAnimationFrame` timestamps in the page.
  Headless Chrome paces frames without a display, so a gap shows that the
  page produced no frame, not what a monitor showed.
- One machine, one GPU, no other load on it. An integrated GPU, Windows
  or Linux drivers, or a busy system will differ. The direction is known
  only for software adapters: `domTextureSource.ts` records slower uploads
  there.
- Loopback serving removes network time. Script, font and lookup table
  downloads cost nothing here and would cost more on a real network.
- Three profiles per cell is enough to show a pattern and its spread, not
  a distribution. Each table gives the median and the range.
- The trace adds overhead to every process, so traced loads are used only
  for the filmstrip and the GPU process breakdown, never for the medians.
- Async build and adapter request times are promise latency. They
  include time queued behind other GPU work, so they overstate each call's
  own cost.
- A frame gap shows the page produced no animation frame. It does not show
  whether input was handled. On Bench, the long frames report a
  `blockingDuration` of 0, and the GPU process held the time. In Light and
  Knobs, the renderer's main thread ran one task of 2.2 s and 0.6 s. The
  shell's own frames and input latency were not recorded.
- The longest gap is unstable at three loads: one stall can split into two
  gaps a few frames apart. The total is the steadier number.
- The recorder's own overhead, from hashing shaders and wrapping calls,
  was not measured.
- The filmstrip is Chrome's own screenshot stream, about one frame per
  change, downscaled to 500 px wide. Visual completeness is the last
  frame where more than 0.2% of a 48×30 grid of cells changed by more than
  10 levels.

## Every scene, cold and warm

Times are in milliseconds from navigation start, as median [min–max] of
3 loads. Knobs and Light use the iframe's clock.

- First capture is the first frame a Surface's capture reported paints.
- First scene draw is three's first render to the canvas.
- Longest frozen frame is the largest gap between animation frames in the
  load. Frozen in total adds the gaps over 50 ms, up to the first 12.

| Scene | Browser | Engine | Load | FCP | First capture | First scene draw | Slowest adapter request | Longest async compile | Longest frozen frame | Frozen in total |
|---|---|---|---|---|---|---|---|---|---|---|
| Bench | Chrome 159 | html-in-canvas | cold | 68 [60–76] | 488 [475–501] | 904 [888–929] | 5 [1–10] | 637 [624–728] | 1067 [850–1133] | 1633 [1550–1650] |
| Bench | Chrome 159 | html-in-canvas | warm | 44 [36–64] | 453 [443–454] | 870 [869–878] | 5 [4–8] | 6 [5–6] | 83 [83–83] | 83 [83–134] |
| Bench | Chrome 159 | snapDOM | cold | 56 [56–76] | 587 [568–605] | 981 [965–1011] | 14 [4–15] | 631 [592–676] | 850 [567–1083] | 1717 [1716–1750] |
| Bench | Chrome 159 | snapDOM | warm | 32 [28–44] | 507 [504–508] | 938 [932–940] | 2 [2–2] | 18 [12–19] | 133 [133–133] | 200 [200–200] |
| Bench | CfT 156 | html-in-canvas | cold | 76 [60–264] | 506 [482–704] | 961 [938–1222] | 6 [2–10] | 695 [596–727] | 650 [567–1117] | 1600 [1500–1733] |
| Bench | CfT 156 | html-in-canvas | warm | 68 [48–88] | 492 [454–494] | 925 [923–936] | 5 [2–8] | 9 [9–10] | 117 [100–117] | 117 [100–167] |
| Bench | CfT 156 | snapDOM | cold | 60 [56–64] | 569 [565–592] | 1002 [1000–1028] | 2 [2–4] | 600 [570–616] | 1067 [817–1133] | 1633 [1567–1750] |
| Bench | CfT 156 | snapDOM | warm | 56 [44–60] | 537 [527–550] | 967 [953–1004] | 2 [2–3] | 14 [12–16] | 133 [133–183] | 233 [217–250] |
| Knobs | Chrome 159 | html-in-canvas | cold | 492 [484–552] | 1681 [1674–1797] | 930 [911–986] | 726 [716–750] | 960 [941–1037] | 1183 [1133–1350] | 2233 [2150–2617] |
| Knobs | Chrome 159 | html-in-canvas | warm | 448 [440–460] | 950 [949–964] | 869 [863–887] | 41 [38–41] | 40 [39–89] | 117 [100–117] | 267 [183–267] |
| Knobs | Chrome 159 | snapDOM | cold | 496 [488–504] | 1775 [1763–1794] | 949 [931–966] | 4 [3–17] | 1008 [966–1009] | 1183 [1167–1183] | 2300 [2300–2316] |
| Knobs | Chrome 159 | snapDOM | warm | 452 [436–472] | 1129 [1095–1154] | 937 [918–953] | 15 [3–21] | 45 [41–45] | 150 [150–150] | 250 [250–333] |
| Knobs | CfT 156 | html-in-canvas | cold | 496 [396–532] | 1712 [1659–1717] | 956 [823–962] | 715 [713–808] | 948 [908–969] | 1133 [1100–1167] | 2283 [2200–2367] |
| Knobs | CfT 156 | html-in-canvas | warm | 444 [444–456] | 995 [984–1003] | 900 [897–904] | 55 [53–61] | 50 [32–51] | 117 [117–133] | 234 [217–333] |
| Knobs | CfT 156 | snapDOM | cold | 492 [488–552] | 1830 [1817–1846] | 981 [960–1053] | 3 [3–611] | 948 [924–1011] | 1117 [1083–1217] | 2300 [2283–2317] |
| Knobs | CfT 156 | snapDOM | warm | 464 [456–472] | 1206 [1184–1234] | 966 [941–976] | 21 [13–21] | 64 [60–65] | 183 [167–200] | 417 [283–433] |
| Light | Chrome 159 | html-in-canvas | cold | 464 [460–468] | 3058 [2957–3087] | 686 [684–701] | 2362 [2212–2372] | 0 [0–0] | 1833 [1817–2050] | 2983 [2834–3117] |
| Light | Chrome 159 | html-in-canvas | warm | 432 [428–540] | 851 [834–859] | 657 [651–665] | 33 [31–33] | 0 [0–0] | 117 [117–133] | 333 [333–350] |
| Light | Chrome 159 | snapDOM | cold | 552 [464–552] | 3003 [2914–3104] | 665 [664–713] | 2248 [2205–2405] | 0 [0–0] | 2067 [2017–2183] | 2850 [2783–2950] |
| Light | Chrome 159 | snapDOM | warm | 456 [448–528] | 938 [879–943] | 666 [642–682] | 142 [135–152] | 0 [0–0] | 250 [250–267] | 350 [317–400] |
| Light | CfT 156 | html-in-canvas | cold | 476 [468–572] | 3069 [3024–3328] | 715 [688–776] | 2335 [2320–2496] | 0 [0–0] | 1683 [1683–2317] | 2950 [2916–3250] |
| Light | CfT 156 | html-in-canvas | warm | 464 [444–576] | 872 [857–921] | 661 [647–697] | 139 [48–158] | 0 [0–0] | 267 [133–300] | 400 [350–550] |
| Light | CfT 156 | snapDOM | cold | 488 [480–500] | 3850 [3674–3999] | 714 [708–740] | 2606 [2480–2711] | 0 [0–0] | 1900 [1867–2500] | 3250 [3133–3333] |
| Light | CfT 156 | snapDOM | warm | 464 [464–476] | 1059 [1056–1086] | 683 [672–683] | 55 [52–57] | 0 [0–0] | 217 [183–233] | 500 [483–500] |

Three patterns hold across browsers and engines.

- A cold load freezes the page for over half a second at least once. A
  warm load does not.
- Chrome 159 and CfT 156 differ by less than the spread between profiles,
  except CfT 156's snapDOM capture of Light.
- The engine changes when the first capture lands, not how long frames
  freeze. snapDOM captured 50–210 ms later on Bench and Knobs.

## Bench

Bench is `?scene=finish-demo`: four cards, each wearing a finish, beside
a picker and a code panel.

What a user sees on the traced cold load in Chrome 159:

| Time | Screen |
|---|---|
| 212 ms | The lab's opening cover, with the logo |
| 521 ms | The cover fades out over the page, picker and code panel |
| 650 ms – 2.77 s | The four cards show their text, with no card bodies |
| 2.81 s | The lit cards appear at once |

The card bodies are drawn by the finish material, so the page
presentation shows the text alone. A warm load shows the cards at about
1.0 s. In untraced loads the cover left at 436–501 ms.

### Why the cards arrive late

Three sets of blocking pipeline builds stop frames on a cold load. The
times are from Chrome 159 with html-in-canvas.

| Step | Time |
|---|---|
| Softbox lookup tables initialised | 101–131 ms, 3–7 ms each |
| Mipmap passes prebuilt with the blocking call | 504–536 ms, then 100–102 ms on the GPU process |
| Device ready | 508 ms |
| Environment bake, CPU part, with blocking PMREM builds | 818–871 ms |
| First scene draw, cards held hidden | 904 ms |
| Frame gap during the bake's builds | 267–350 ms, in all 12 cold loads |
| 8 async pipeline builds start | 937 ms |
| The bake's GPU work finishes | 0.39–0.46 s after the bake's CPU part ends cold, 0.07–0.15 s warm |
| The async builds resolve | about 1.57 s |
| 4 blocking pipeline builds for the cards | from 1.56 s. In one load the last came at 2.57 s |
| Frames resume | about 2.8 s |

Decision #76 holds a presenter hidden until async builds of its material
finish. Those builds finished. The cards then drew with different
shaders, so three built them with the blocking call.

A diagnostic load kept the WGSL of every module. The card shaders differ
from the async stand-ins in two ways.

- All four blocking shaders sample a PMREM environment. They define
  `roughnessToMip`, `getFace` and `getUV`, and bind one more texture,
  one more sampler and `cameraWorldMatrix`. The stand-ins do not.
- Three of the four also use a finish feature the stand-ins lack:
  anisotropy, clearcoat or sheen. The satin polymer card differs by the
  environment alone.

The lab writes both the finish values and the environment map in the
card's before-draw callback (`MaterialFinishesSurface.tsx:168-176`).
`useSurfaceCompiled` clones the material in `useFrame`
(`surfaceCompile.ts:292-304`), which runs earlier in the same frame. So
the stand-ins were cloned before that callback had ever run. Setting
clearcoat, sheen or anisotropy across zero, or `needsUpdate`, raises
three's `Material.version`, but the build is keyed on the material
object and does not restart.

In the trace, the GPU process's main thread ran
`DeviceBase::APICreateRenderPipeline` 20 times on the cold load, 1.62 s
in all. Four calls of 271–283 ms follow the four blocking card builds.
The bake's blocking builds took 394–403 ms there.

### Layout shift

With html-in-canvas, Bench's cumulative layout shift is 0.033–0.058. The
shifted node is a `DIV` inside a `CANVAS` whose height grows from 0 to
280 px, at the moment of the freeze. snapDOM loads score 0.000. Whether a
user can see this shift is unverified: the node is the canvas's
html-in-canvas child, which the canvas draws itself.

### Changing a finish

Switching one card to Oil-slick foil after load built 4 new pipelines
with the blocking call, after 42–59 ms of node builds. Frames stopped for
250–350 ms cold and up to 83 ms warm. `useSurfaceCompiled` holds only a
presenter's first material (`surfaceCompile.ts:281-284`), so every
finish change pays this.

## Knobs

Knobs draws an animated pattern and a control panel. The panel is a
`SceneSurface`, which has no page presentation.

| Time, shell clock | Screen, cold, from the filmstrip |
|---|---|
| 276 ms | The demo area is blank grey |
| 526 ms | The pattern shows. The panel is absent |
| 1.66 s | The panel shows as an empty slab |
| 1.92 s | The panel's controls appear |

The panel's first capture lands at 1.68 s cold and 0.95 s warm, on the
iframe clock. Both engines wait for `captureMemoryChosen()`, the
adapter request in `chooseCaptureMemory`
(`domTextureSource.ts:458-490`; snapDOM through
`rasterizedSource.ts:349`). That request took 726 ms cold with
html-in-canvas. With snapDOM it usually started at 1.75–1.84 s, just after
a frame gap of about 0.7 s ended. Either way, the capture waits on the
stalled GPU process.

Knobs runs two async builds of about 960 ms for the panel. After its
first draw it makes 9 blocking builds, mostly for materials that are not
Surface presenters (`MeshStandardMaterial`, `MeshBasicMaterial`,
`MeshPhysicalMaterial`). Its environment bake and mipmap passes also
build with the blocking call, before the first draw. The trace shows the GPU process's
main thread spending about 1.94 s in 10 long pipeline builds on the cold
load.

Visual completeness is not reported for Knobs. The pattern animates, so
the filmstrip never settles.

## Light

Light does not use `SurfaceCanvas`. It creates three `WebGPURenderer`s
itself (`LightLamp.tsx:320`, `:491`, `lightHeadlineTreatments.ts:36`)
and imports only capture and material helpers from the library.

| Time, shell clock | Screen, cold, from the filmstrip |
|---|---|
| 311 ms | The opening cover fades over grey |
| 679 ms | The page presentation: headline, text and slider |
| 1.42 s | The headline's shadow appears |
| 3.22 s | The lamp appears, unlit |
| 3.70 s | The lamp is lit and its glass refracts the headline |

Each cold load made 4 adapter requests and 3 device requests. The first
two adapter requests took about 30 ms. The third and fourth started at
0.69–0.88 s and took 2.1–2.4 s, while the GPU process's main thread ran 15
long pipeline builds, 61–267 ms each and 2.6 s in total. Light makes no
async builds. Its longest node build took about 94 ms.

Light's own opening waits for fonts, then gives graphics 4 s of visible
time before it settles on native controls (decision #57,
`lightOpening.ts:8`). Its `data-page-ready` landed at 3.15 s cold in
Chrome 159. In one CfT 156 snapDOM load, fonts were ready at 152 ms and
`data-page-ready` landed at 4.11 s. That load stayed enhanced with about
40 ms to spare.

Light shifts layout by 0.029 on every load. The shifted node is
`CANVAS.light-headline-canvas` inside the headline's `H1`.

## snapDOM

On a cold Bench load, snapDOM decoded 17 images and fetched 12 fonts.
Knobs decoded 3 images and Light 3–4. The decode figures are sums of
overlapping promise waits, not decode work. On Bench they summed to
203–250 ms cold in Chrome 159, and to about 1.57 s in two of three CfT 156
loads and 288 ms in the third. Warm Bench loads decode the 17 images
again, summing to 372–525 ms. Whether decodes stopped frames was not
separated from the pipeline builds.

The branch measured against this baseline is in [After the loading build](measurements-after-build.md).
