<!-- review-gate author: claude-opus-5-5 -->
# Measurements

Part of the [quality levels proposal](README.md). Status: proposal, unbuilt, 2026-11-26.

All runs used m2 (MacBook Pro, Apple Silicon) in headless Chrome
159.0.8154.33, with Chrome for Testing 156.0.8078.47 as a check. WebGPU and
the `html-in-canvas` engine ran on every row, and no run failed. The
viewport was 1440 × 900 CSS pixels at device scale 2 unless a section
says 3. The probe is `instruments/quality/run.mjs`. It patches the lab in
a measurement checkout so each cost can be set from the page
([its README](../../instruments/quality/README.md)). The lab served one
missing resource: each first-frame load logged one 404, and the other
runs logged it once per browser launch.

What each measure means:

- Frame time is GPU-complete time per frame. The page renders 30 frames
  back to back, then waits for the GPU queue. Six such batches give a
  median. Three rounds each load a fresh browser context, and the settings
  run in a fixed order within a round. The tables give the median of the
  three round medians, and the range of those three. This measures how
  much of a frame budget rendering uses. It is not the frame rate a user
  sees.
- Memory is the bytes of live GPU textures, counted by wrapping
  `GPUDevice.createTexture` and `destroy`. It leaves out the swap chain,
  buffers, and the 2D canvases that hold captures. The swap chain and
  those canvases grow with the pixel ratio, so the counts understate how
  much a lower ratio saves.
- Pixel differences compare a screenshot of each card against the same
  card at the base setting. The page is shot until three shots in a row
  match. "Max" is the largest channel difference, out of 255. "Over 2" is
  the share of the card's pixels that differ by more than 2/255. Each cell
  gives the worst card's max and the worst card's share, which can come
  from different cards. A repeat of the base setting gave 0 on every card,
  so the noise floor is 0.

The settings:

| Setting | What changes |
|---|---|
| base | The lab's canvas: pixel ratio `[1, 2]`, no MSAA, no depth buffer, environment 256 |
| dpr1.5, dpr1, dpr3 | Pixel ratio fixed at 1.5, 1 or 3 |
| msaa4 | `antialias: true`, which three turns into 4 samples |
| pmrem128, pmrem64 | Environment bake at 128 or 64 px per face |
| res1 | Every capture pinned to resolution 1 |
| taps4, onetap | Glass taps 4; or every glass finish drawn with one tap |
| nodetail, plain | Detail relief and crackle removed; or every finish layer removed |

## Frame time and memory

The bench page shows 12 cards of one preset over a backdrop Surface that
fills the viewport
(`?scene=material-finishes&compare=glass&finish=<preset>&count=12&bare`).
It runs on `cdf9501`, the glass branch, which lacks five commits that
`a2b6320` has. The page fills the screen, so it measures a fill-bound
canvas. Small overlay canvases were not measured. Chrome 159, ms per
frame, median (range):

| Preset | base | dpr1.5 | dpr1 | msaa4 | pmrem128 | taps4 | onetap | nodetail | plain |
|---|---|---|---|---|---|---|---|---|---|
| polymer-charcoal | 1.22 (1.17–1.43) | 0.68 | 0.37 | 1.16 | 1.18 | — | — | 1.21 | 1.28 |
| lacquer-crimson | 1.64 (1.63–1.92) | 0.99 | 0.47 | 1.62 | 1.62 | — | — | 1.44 | 1.21 |
| velvet-midnight | 1.41 (1.41–1.53) | 0.84 | 0.45 | 1.54 | 1.50 | — | — | 1.35 | 1.21 |
| foil-holographic | 1.66 (1.65–1.66) | 0.99 | 0.50 | 1.63 | 1.66 | — | — | 1.68 | 1.23 |
| wax-beeswax | 1.31 (1.19–1.95) | 0.74 | 0.39 | 1.22 | 1.25 | — | — | 1.24 | 1.21 |
| paper-kraft | 1.56 (1.56–1.71) | 1.05 | 0.48 | 1.66 | 1.66 | — | — | 1.25 | 1.25 |
| glass-clear | 1.52 (1.48–1.60) | 0.86 | 0.42 | 1.81 | 1.51 | 1.47 | 1.57 | — | — |
| glass-frosted | 2.17 (2.16–2.30) | 1.26 | 0.59 | 2.40 | 2.18 | 1.79 | 1.62 | — | — |
| glass-crystal | 2.31 (2.10–2.34) | 1.27 | 0.61 | 2.40 | 2.15 | 1.80 | 2.18 | — | — |

pmrem64 matched pmrem128 within 0.1 ms on every preset. The other ranges
are in the raw data. Five cells spread more than 0.4 ms: wax-beeswax base
(1.19–1.95), velvet-midnight nodetail (1.31–1.90), and glass-frosted at
dpr1.5 (1.20–1.66), taps4 (1.72–2.54) and onetap (1.53–3.06). The last two
had one slow round each. Their other two rounds sit within 0.1 ms of the
median.

A separate run compared ratio 3 with base on three presets. The canvas
drew 4320 × 2700 pixels, 2.25 times as many:

| Preset | base | dpr3 | Ratio |
|---|---|---|---|
| polymer-charcoal | 1.33 ms | 2.64 ms | 2.0× |
| lacquer-crimson | 1.71 ms | 3.57 ms | 2.1× |
| glass-frosted | 2.24 ms | 5.08 ms | 2.3× |

Chrome for Testing 156 gave the same picture on polymer-charcoal,
lacquer-crimson and glass-frosted: base 1.23, 1.67 and 2.24 ms; dpr1
0.37, 0.49 and 0.61 ms; msaa4 1.32, 1.71 and 2.49 ms.

What the frame data shows:

- Frame time tracks pixel count. Ratio 1.5 draws 56% of the pixels and
  took 55–67% of the time. Ratio 1 draws 25% and took 26–32%. Ratio 3
  draws 225% and took 200–230%.
- MSAA cost 0–0.3 ms per frame.
- Environment size changed frame time by less than the noise.
- Four glass taps saved 0.38 ms on frosted and 0.51 ms on crystal. One tap
  saved 0.55 ms on frosted and nothing on crystal, which keeps its taps
  for dispersion.
- Removing every layer saved up to 0.43 ms. Removing detail relief alone
  saved 0.31 ms on paper-kraft and 0.20 ms on lacquer-crimson.

Texture memory differs by page. The bench page carries a full-viewport
backdrop capture, and its glass presets add a canvas-sized copy (20.7 MB at
ratio 2). The first-frame page holds three cards on a plain background:

| Setting | Bench, opaque | Bench, glass | Three cards |
|---|---|---|---|
| base | 40.8 MB | 61.5 MB | 13.32 MB |
| dpr1.5 | 27.1 MB | 38.7 MB | — |
| dpr1 | 17.3 MB | 22.5 MB | 10.41 MB |
| dpr3 | 77.5 MB | 124.2 MB | — |
| msaa4 | 123.7 MB | 144.5 MB | 96.27 MB |
| pmrem128 | 33.7 MB | 54.4 MB | 6.25 MB |
| pmrem64 | 32.4 MB | 53.1 MB | 4.92 MB |
| res1 | — | — | 10.73 MB |

On the bench page, ratio 1.5 saves a third of texture memory and ratio 1
saves 58–63%. On the three-card page, ratio 1 saves 22%, while an
environment of 128 saves 53%. On a small page, the environment bake is
the largest texture.

Memory by part, at ratio 2, on the three-card page:

- The environment bake at 256 holds 6.29 MB of RGBA16F and a 3.15 MB depth
  buffer, about 9.4 MB per environment kind. At 128 it holds 2.4 MB, at 64
  about 1.0 MB.
- The three captures hold 3.88 MB at `'auto'` density. At ratio 1 they
  hold 0.97 MB. Pinned to resolution 1 they hold 1.29 MB, because pinned
  captures carry mipmaps.
- MSAA adds 82.94 MB, one 2880 × 1800 BGRA8 color buffer with 4 samples.
  These pages have no depth buffer. A default `SurfaceCanvas` has one, so
  MSAA there also needs a 4-sample depth buffer, computed at 82.9 MB for
  depth24plus and not measured. Whether Dawn allocates these buffers in
  full on Apple GPUs is unverified.

## First frame

The finishes page (`?scene=material-finishes` on `a2b6320`, three cards of
lacquer-crimson with the point key) loaded five times per setting, each in
a new browser and profile. "Presented" is the time from navigation until
every card's scene presentation drew. "Bake to presented" starts when the
environment bake's CPU part ends.

| Setting | Presented, median (range) | Bake to presented, median | Bake CPU |
|---|---|---|---|
| base | 1524 ms (1441–1595) | 191 ms | 44 ms |
| dpr1 | 1591 ms (1378–1620) | 186 ms | 43 ms |
| msaa4 | 1471 ms (1411–1482) | 198 ms | 45 ms |
| pmrem128 | 1767 ms (1512–1840) | 212 ms | 43 ms |
| pmrem64 | 1529 ms (1513–1657) | 185 ms | 43 ms |
| res1 | 1537 ms (1457–1888) | 204 ms | 43 ms |
| softbox key | 1621 ms (1435–1951) | 208 ms | 58 ms |

The bake starts 1.2–1.4 s after navigation, mostly while the dev server
serves modules. The time from bake to presented, 185–212 ms in every
setting, is the part a setting could shorten, and none did. The bake's CPU
time stayed at 43–45 ms at every environment size, so the bake's cost is
setup, not texels.

Two observations have no explanation yet. The `gpu` mark waits for the
whole GPU queue, not just the bake, and it came 3–380 ms after the CPU
part. At base it came over 110 ms later in 4 of 5 loads. At dpr1 and res1
it never did. The longest gap between animation frames had a median of
83 ms in every setting but pmrem128 (100 ms), with a maximum of 350 ms
(pmrem128).

## Download

No proposed field changes what a page downloads. Finish layer code
already loads on first use. In `packages/react/dist` at `a2b6320`, each
layer is one module of 0.2–1.5 kB gzip: film 1446 B, scatter 640 B, sheen
630 B, crackle 588 B, and 200–674 B for each relief kind. An app's bundler
may merge them. The softbox tables are the one large download, at 102,355
B gzip as three ships them. The softbox-size measurements found that a
half-float 64 × 64 table costs 37,063 B with a largest difference of
5/255. That choice belongs to lighting, for every page.

## Pixel differences

Finishes: 17 presets, three flat cards each, on the finishes page at
`a2b6320`, device scale 2:

| Preset | dpr1.5 | dpr1 | pmrem128 | pmrem64 | res1 |
|---|---|---|---|---|---|
| lacquer-crimson | 173 / 11.9% | 179 / 15.8% | 30 / 9.0% | 48 / 14.1% | 179 / 10.5% |
| polymer-charcoal | 154 / 10.0% | 159 / 15.2% | 4 / 0.4% | 8 / 18.0% | 159 / 10.6% |
| aluminum-blue | 125 / 40.3% | 141 / 54.6% | 7 / 52.3% | 13 / 80.9% | 141 / 10.3% |
| velvet-midnight | 162 / 9.2% | 173 / 13.7% | 1 / 0.0% | 2 / 0.0% | 173 / 10.5% |
| ceramic-celadon | 121 / 12.4% | 114 / 18.8% | 10 / 1.2% | 17 / 1.9% | 114 / 10.2% |
| foil-holographic | 144 / 11.0% | 172 / 15.3% | 10 / 31.1% | 16 / 49.3% | 172 / 10.4% |
| foil-oil-slick | 182 / 11.3% | 182 / 15.5% | 4 / 2.1% | 10 / 18.0% | 182 / 10.7% |
| foil-crumpled | 141 / 17.3% | 172 / 23.0% | 12 / 25.6% | 17 / 32.0% | 172 / 10.4% |
| paper-office | 149 / 8.7% | 168 / 11.9% | 1 / 0.0% | 2 / 0.0% | 168 / 10.5% |
| paper-kraft | 109 / 8.8% | 125 / 12.1% | 1 / 0.0% | 2 / 0.0% | 125 / 10.2% |
| paper-cold-press | 147 / 8.8% | 164 / 12.0% | 1 / 0.0% | 2 / 0.0% | 164 / 10.5% |
| rubber-black | 155 / 9.2% | 157 / 12.5% | 1 / 0.0% | 2 / 0.0% | 157 / 10.6% |
| rubber-grip | 129 / 14.5% | 144 / 22.2% | 1 / 0.0% | 2 / 0.0% | 144 / 10.3% |
| rubber-silicone | 95 / 8.7% | 112 / 11.9% | 1 / 0.0% | 2 / 0.0% | 112 / 10.1% |
| wax-candle | 136 / 8.5% | 156 / 11.8% | 1 / 0.0% | 2 / 0.0% | 156 / 10.5% |
| wax-beeswax | 115 / 14.8% | 134 / 21.4% | 1 / 0.0% | 2 / 0.0% | 134 / 10.3% |
| wax-silicone | 125 / 9.0% | 141 / 13.4% | 3 / 0.1% | 6 / 1.4% | 141 / 10.3% |

MSAA changed no pixel on any flat card. Flat cards face the camera, so
their silhouette edges run along the pixel grid.

Tilted cards: four presets on `cdf9501`, with `tilt=pointer` and the
mouse held near the top-right corner. The cards turn as slabs with visible side edges:

| Preset | msaa4 | again |
|---|---|---|
| lacquer-crimson | 60 / 0.35% | 0 / 0% |
| aluminum-blue | 51 / 0.34% | 0 / 0% |
| foil-holographic | 53 / 0.35% | 0 / 0% |
| paper-kraft | 47 / 0.35% | 0 / 0% |

The changed pixels lie along the slab's silhouette. In one enlarged crop,
judged by eye, the edge without MSAA shows steps that MSAA smooths.

Device scale 3: the 17 finish presets on `cdf9501`, with the lab's cap
of 2 against native ratio 3. This is what a cap of 2 changes on a DPR-3 screen:

| Preset | Native 3 vs cap 2 |
|---|---|
| lacquer-crimson | 134 / 10.1% |
| polymer-charcoal | 119 / 7.4% |
| aluminum-blue | 110 / 32.3% |
| velvet-midnight | 130 / 7.1% |
| ceramic-celadon | 92 / 10.3% |
| foil-holographic | 132 / 9.3% |
| foil-oil-slick | 135 / 9.6% |
| foil-crumpled | 142 / 13.5% |
| paper-office | 127 / 7.1% |
| paper-kraft | 94 / 7.0% |
| paper-cold-press | 125 / 7.2% |
| rubber-black | 119 / 7.2% |
| rubber-grip | 109 / 12.1% |
| rubber-silicone | 85 / 6.8% |
| wax-candle | 118 / 6.7% |
| wax-beeswax | 102 / 10.8% |
| wax-silicone | 107 / 7.0% |

Glass: the comparison page on `cdf9501` shows each of the 4 glass presets
in two tints. Each cell is the worse of its two cards:

| Preset | dpr1.5 | dpr1 | pmrem128 | pmrem64 | res1 | taps4 | onetap |
|---|---|---|---|---|---|---|---|
| glass-clear | 195 / 18.9% | 163 / 25.2% | 28 / 10.8% | 42 / 15.4% | 154 / 17.1% | 0 | 0 |
| glass-cobalt | 125 / 19.6% | 143 / 28.7% | 30 / 12.9% | 48 / 18.1% | 171 / 17.7% | 0 | 0 |
| glass-frosted | 100 / 68.2% | 135 / 69.9% | 2 / 0.0% | 4 / 0.6% | 152 / 24.5% | 113 / 65.1% | 127 / 93.9% |
| glass-crystal | 80 / 22.6% | 107 / 33.2% | 29 / 1.2% | 44 / 2.0% | 123 / 15.3% | 58 / 4.0% | 0 |

MSAA changed one pixel by 1/255 on one frosted card and nothing else.

What the pixel data shows:

- A lower pixel ratio or capture density softens text and edges. At ratio
  1.5 the worst card changed on 8.5–17% of its pixels for finishes other
  than aluminum, and on 19–23% for clear, cobalt and crystal glass.
  Aluminum and frosted glass changed on 40–70%, because brushed
  anisotropy and frost noise are drawn per pixel.
- A cap of 2 on a DPR-3 screen changed 7–14% of each card's pixels (32% on
  aluminum), with maxima of 85–142.
- A smaller environment leaves matte presets alone (paper, rubber, wax,
  velvet: at most 3/255 at 128). It moves glossy reflections by up to
  30/255 at 128 and 48/255 at 64.
- Four taps turn frosted glass's even frost into a visible coarse grain.
  One tap removes the frost and shows the backdrop sharply, which makes it
  a different material. Clear and cobalt already draw one tap.

These numbers say where pixels change, not whether a viewer minds. The
probe saves the worst card of each setting as a crop for a person to judge.

## Limits

- One machine. m2 is not a phone, and the ratio-3 runs used m2's GPU.
- The frame bench renders back to back on a page that fills the viewport.
  It measures GPU work per frame, not presented frame rate or input
  latency. Smaller canvases would save less in absolute terms.
- Settings ran in a fixed order within each round.
- Memory counts textures only, which understates the ratio's saving.
- First-frame runs used one preset and five loads per setting.
- Frame, glass, ratio-3 and tilt runs used `cdf9501`, the unmerged glass
  branch. The finish pixel and first-frame runs used `a2b6320`.
- Pixel differences cover flat cards, and four finish presets tilted
  toward one point. Plain Surfaces with no finish were not tilted. The
  light was at rest.
