<!-- review-gate author: claude-opus-5-5 -->
# Proposal

Part of the [quality levels proposal](README.md). Status: proposal, unbuilt, 2026-11-26.

## What each level sets

| Field | high (default) | medium | low |
|---|---|---|---|
| `renderScale` | 1 | 0.75 | 0.5 |

The canvas draws at the native ratio times `renderScale`, never below 1.
When the native ratio is already below 1, as at 67% zoom on a DPR-1
screen, the canvas draws at the native ratio.

| Native ratio | high | medium | low |
|---|---|---|---|
| 1 | 1 | 1 | 1 |
| 1.25 (a common Windows scale) | 1.25 | 1 | 1 |
| 1.5 (a common Windows scale) | 1.5 | 1.125 | 1 |
| 2 | 2 | 1.5 | 1 |
| 2.5 (DPR 2 at 125% zoom) | 2.5 | 1.875 | 1.25 |
| 3 | 3 | 2.25 | 1.5 |

A fraction, rather than a fixed cap, scales with the screen and with zoom.
At native ratio 2 and above, medium draws about 56% of high's pixels and
low about 25%. Below 2 the floor reduces the saving: at 1.5, low draws 44%
of high's pixels, and at 1.25 medium and low are the same. On a DPR-1
screen the levels change nothing. On m2 at native ratio 2, medium took
55–67% of high's frame time and low took 26–32%.

The floor of 1 is a convention: at least one canvas pixel per CSS pixel,
the same lower bound as R3F's default `dpr`. It binds an explicit
`renderScale` too. An app that wants fewer pixels sets `dpr`. Every level
below `high` softens captured text relative to the page, as the pixel
tables show. The floor limits how far.

Capture density follows the canvas through `resolution="auto"`. The probe
confirmed it at ratio 1: the three captures shrank from 3.88 to 0.97 MB.
The levels also produce ratios between capture tiers, such as 2.25 and
1.875. A new capture rounds up to the next tier (`seedTier`), so 2.25
starts at tier 3. Whether it settles at the exact density is unverified,
and no pixel data exists for the proposed levels at device scale 3.
A Surface with a pinned `resolution` keeps its pin, because the author
chose it.

## The API

```tsx
type SurfaceQualityLevel = 'high' | 'medium' | 'low'

interface SurfaceQualitySettings {
  /** The fraction of the native pixel ratio the canvas draws at, in (0, 1]. */
  readonly renderScale?: number
}

<SurfaceCanvas quality="medium">…</SurfaceCanvas>
<SurfaceCanvas quality={{ renderScale: 0.6 }}>…</SurfaceCanvas>
```

`quality` is a `SurfaceCanvas` prop, because the pixel ratio belongs to
the canvas. In the object, a field left out takes `high`'s value. With one
field, the object needs no `level` key. If a second field is added (Q2),
the object gains `level`, the level fills the fields left out, and the
fields given replace the level's values. A `renderScale` outside (0, 1] is
a development error, and the level's value applies.

R3F's `dpr` prop stays (decision Q3). The level applies where the native
ratio enters `surfaceCanvasPixelRatio` today. A `dpr` range then clamps
the result, and the display-scale correction multiplies last, as it does
now. A numeric `dpr` fixes the ratio, as it does today, so `quality` then
has no effect. An app that wants a cap, such as 2 on a 5K display, sets
`dpr={[1, 2]}`.

A simpler alternative is to keep only `dpr` and change its default. It
was not chosen because `dpr` holds absolute ratios. It cannot say "three
quarters of this screen", and a page does not know the screen or the zoom
level in advance.

## Fields left out

- Environment bake size saves 7 MB at 128 and 8.4 MB at 64, per
  environment kind. On a three-card page that is over half of texture
  memory. It changed neither frame time nor the first frame, and it moves
  glossy finishes by up to 48/255. Decision Q2 offers it.
- Glass taps save 0.38–0.51 ms at 12 cards at ratio 2, and four taps turn
  frost into grain. Medium saves 0.9–1.0 ms on the same cards and keeps the
  material. Decision Q2 offers it.
- MSAA cannot change after the renderer starts, and it smooths the edges
  of tilted cards. It stays a `gl` parameter.
- Finish layers and their relief are the material the author chose.
  Dropping them by level would make one preset look like two materials.
- Pinned capture density, the `live` period and the idle frame loop
  already have their own props.

## Changing the level at runtime

Nothing in this section was measured. The probe sets its values only at
load.

A new level changes the ratio R3F passes to the renderer, which resizes
the drawing buffer. Munari already handles a ratio change when a window
moves between displays or zooms: `useSurfaceDevicePixelRatio` reports the
new native ratio, and `'auto'` captures follow it (decision #44,
`probe:display-density`). A level change would take the same path. Each
`'auto'` capture would rasterize again at the new density, and the user
would see the content sharpen or soften. How long that takes, and whether
it drops frames, is unmeasured.

If Q2 adds an environment or glass field, changing it builds new
pipelines. Loading decision D5 (keep drawing the old material until the
new one is built) would cover that. Without D5, it stops frames as a
finish change does today.

## Loading

The level is a prop, so the canvas knows it at mount. The first drawing
buffer and the first captures use the scaled ratio, and nothing builds
twice. `Surface.Prewarm` and the loading proposal's preparation build for
the current level only. A level change before the lift resizes the buffer
and requests captures again. The lift then waits for a capture at the new
density, as it waits for any current capture (decisions #65, #68).

On m2, no setting shortened the wait from bake to lift. These runs give no
reason to use a level to load faster. They cover one machine, one preset
and three cards.

## Automatic choice

Munari does not choose a level from the device in the first version. The
README would show the app how to drive `quality` from drei's
`PerformanceMonitor`:

```tsx
const [level, setLevel] = useState<SurfaceQualityLevel>('high')
<SurfaceCanvas quality={level}>
  <PerformanceMonitor
    onDecline={() => setLevel(lower)}
    onIncline={() => setLevel(higher)}
  />
  …
</SurfaceCanvas>
```

`lower` and `higher` are the app's own steps between levels. drei's
`flipflops` and `onFallback` do not fit here: drei 10.7.7 counts every
incline and decline, so a fast device that keeps inclining would reach
the fallback. The recipe has the same costs as a built-in controller.
Sharpness changes while someone reads, and every `'auto'` capture
rasterizes again, which could itself drop frames and trigger another
decline. `PerformanceMonitor` reads the frame rate, so it works only while
the canvas renders continuously, which is the default today. The recipe is
untested, and the README should not print it until one run confirms it.

The reasons not to build automatic choice now:

- A device table such as detect-gpu's needs upkeep, a download and a GPU
  name.
- A frame-time controller changes sharpness while someone reads, and
  each change rasterizes every capture again.
- No measurement here shows a device missing its frame budget at any
  level. m2 drew 12 frosted glass cards at ratio 3 in 5.1 ms. Phones were
  not measured.
