# Softbox download size

Measured 2026-11-26 on branch `softbox-size`. Nothing here changes main.

The softbox light loads three's area-light tables, a 102 kB gzip chunk. Half-float
64 × 64 tables draw the same picture at 36% of that size, or 44% under brotli.
Their largest difference from today is 5/255 on one channel, and no card has more
than 0.04% of its pixels over 2/255. They also load in 4.8 ms instead of 8.0 ms.
The recommendation is to ship them.

The 32 × 32 tables are 11 kB, but they move the lacquer, polymer, ceramic, aluminum,
and foil presets by up to 17/255. The table-free representative point downloads
no tables. On 9 of the 17 presets, it moves more than 1% of a card's pixels by
over 2/255.

## Results

All numbers come from m2 (the MacBook Pro reached over Tailscale) and headless
Chrome 159.0.8154.33 with WebGPU. Download is gzip -9 and brotli 11 of the production chunk.
Load time covers import, decode, and GPU upload, as a median with its 10th to
90th percentile over 20 runs. Pixel columns compare each option with today's
softbox over 17 presets, 3 key positions, and 3 cards each.

| Option | Download, gzip (brotli) | Load time | Largest difference | Worst card mean | Worst card, pixels over 2/255 | Presets with a card over 1% |
|---|---|---|---|---|---|---|
| Today: three's tables | 102,355 B (74,139 B) | 7.95 ms (7.20–9.22) | — | — | — | — |
| Today, loaded again | — | — | 0 | 0 | 0% | 0 |
| 64 × 64 half-float | 37,063 B (32,841 B) | 4.80 ms (4.60–5.20) | 5 | 0.010 | 0.04% | 0 |
| 32 × 32 half-float | 11,016 B (9,910 B) | 4.15 ms (4.00–4.70) | 17 | 0.333 | 3.98% | 1 |
| Representative point | no table chunk; shader code in the entry chunk | none | 99 | 4.40 | 61.3% | 9 |
| Point key, for scale | no table chunk | none | 192 | 18.9 | 91.6% | 16 |

"Today, loaded again" repeats the baseline in a new page load. Its zero row shows
the captures are deterministic, so every difference above it comes from the option.
"Point key" is the light the scene uses by default. It shows how far a picture
moves when the softbox is removed entirely.

Differences are in 0–255 per RGB channel. A card's mean is the mean absolute
channel difference over its device pixels. A pixel counts as over 2/255 when its
largest channel difference is above 2.

### Where each option differs

- The 64 × 64 tables stay within 1/255 on 15 presets. The two exceptions are
  lacquer-crimson at 5/255 and ceramic-celadon at 3/255, and both stay under
  0.05% of pixels over 2/255.
- The 32 × 32 tables stay within 1/255 on the paper, rubber, wax, and velvet
  presets. The lacquer, polymer, ceramic, aluminum, and foil presets move by up
  to 17/255, on foil-crumpled. On aluminum-blue, 3.98% of one card's pixels move
  by more than 2/255.
- The representative point moves polymer-charcoal, aluminum-blue, the three
  foils, and wax-silicone across 20–61% of a card's pixels. Lacquer-crimson
  peaks at 99/255 in its highlight. Paper, rubber, and velvet stay within 5/255.

For each option, `compose.mjs` draws its worst preset beside today's render,
with their difference scaled by 8.

### Bundle cost of the prototype

The prototype adds 1,285 bytes gzip to what the `surface` payload entry loads
up front: 541,139 at the base commit 608c147 and 542,424 on the branch. The
loader and decoder module alone is 1.20 kB gzip in the library build. The split
between it and the representative point's shader code was not measured.

The deferred bytes grow by 48,076, from 102,361 to 150,437. That is both new
table chunks, because the prototype can load any of the three sources. A shipped
version keeps one table source.

The `surface` entry is over its payload budget at the base commit already:
541,139 bytes against a limit of 537,833.

## The options

The softbox uses three's `RectAreaLightNode`. It shades with linearly
transformed cosines (LTC), which sample two 64 × 64 RGBA tables.
`RectAreaLightNode.setLTC` accepts any `DataTexture` pair, so the smaller
tables need no change to three.

The lighting model reads all four channels of the first table and only the first
two of the second. The encoded options therefore store six channels instead of
eight. Each one is a TypeScript module holding base64 text. Every bundler ships
that as a plain JavaScript chunk, with no asset configuration.

- 64 × 64 half-float: three's tables rounded to 16-bit floats and stored as
  byte planes, low bytes first. Planes compress to 31,613 B gzip, against
  41,762 B for interleaved bytes.
  The largest rounding error is 0.00098 against values from −0.30 to 1.66.
  Float32 was not needed, because the screen difference is at most 5/255.
  These are bit for bit the values in three's own half-float tables.
- 32 × 32 half-float: three's shader still addresses the tables as 64 × 64, so
  the 32 × 32 table is a least-squares fit. Bilinear sampling of it at the 64 × 64
  texel centres best matches the original. Its largest error against the original
  is 0.056 absolute. Relative to small values, it reaches 640%.
- Representative point: no tables. Diffuse uses three's own `LTC_Evaluate`
  with an identity transform. Specular is GGX toward the point where the
  reflected ray meets the light's plane, clamped into the rectangle. Its roughness widens by the light's
  equal-area radius over twice its distance, with the energy renormalised (Karis,
  Real Shading in Unreal Engine 4, 2013). Clearcoat uses the same method.

A raw binary file loaded through `new URL(…, import.meta.url)` would save about
5.4 kB more on the 64 × 64 tables (31,613 B gzip) and 1.5 kB on the 32 × 32 tables
(9,533 B gzip). It was not built. It needs every consuming bundler to emit the
asset and every host to compress `application/octet-stream`.

## How it was measured

All runs used a worktree of this branch on m2.

- Table encoding and error: `node instruments/softbox-size/ltcTables.mjs <dir>`
  writes both modules and prints rounding error and the size of each encoding.
- Download: `node instruments/softbox-size/size.mjs` builds an entry that imports
  three and the table loader with Vite, then measures each chunk with gzip -9, as
  `instruments/payload` does, and with brotli 11.
- Load time: `RUNS=20 node instruments/softbox-size/timing.mjs` builds a page
  that loads one table source and uploads it through three's `initTexture`. It
  waits for the GPU queue to finish. Each sample runs in a fresh incognito context
  from a local server, interleaving sources.
- Pixels: `OUT=<dir> node instruments/softbox-size/pixels.mjs` against the lab
  dev server. It loads the material-finishes scene with `?light=softbox&softbox=<option>`
  at 1440 × 900, DPR 2. It moves the key to three positions and waits for three
  identical screenshots in a row before comparing the three cards.
- Images: `OUT=<dir> node instruments/softbox-size/compose.mjs`.
- Bundle cost: `npm run build && npm run gate:payload` at 608c147 and at the
  branch head.

The pixel run checks its own setup. On every load, the key moved the cards. Table
options recorded their decode mark before the first capture, and the other
options recorded none. Pages logged no errors except one 404, a missing resource
on the first load, most likely the favicon.

## Limits

- One machine, one GPU, and one Chrome build. The GPU here supports
  `float32-filterable`, so today's baseline is three's float32 tables. Devices
  without it already draw from three's half-float 64 × 64 tables. The 64 × 64
  option decodes to the same half-float values in every channel the shader reads.
  A node script compared all 24,576 values. Those devices were not rendered.
- Load times exclude the network, because the page came from localhost. On a
  real connection the 65 kB saved by the 64 × 64 tables matters more than the
  3 ms of processing saved. At 10 Mbit/s, the 65 kB gzip saving takes about
  52 ms, and the 41 kB brotli saving about 33 ms.
- Each timing run loads the sources in a fixed order, three's tables first. Any
  first-load effect would fall on today's time. Its size was not measured.
- The representative point's shader compile time and per-frame GPU cost were not
  measured.
- Pixel differences are against today's render, not against a ground truth. A
  difference is a change, not necessarily an error.
- Only the three cards' rectangles were compared.
- The pixel run checks that the representative option loaded no tables. It does
  not check directly that the representative lighting path ran. The evidence
  that it ran is indirect. Its pictures differ from both today's and the point
  key's on every preset.
