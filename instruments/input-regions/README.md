# Input region capture proof

```sh
REGION_STORAGE=gpu node instruments/input-regions/run.mjs
REGION_STORAGE=cpu node instruments/input-regions/run.mjs
```

This runs the real Controls form with its lab styles in headless Chrome. It
uses the public capture engine, keeps the original form nodes, and compares
the source canvas against a fresh full snapDOM capture after each change.
Every RGBA channel must match exactly. `REGION_STORAGE` forces the source's
canvas storage policy and checks that the requested mode was exercised. It
does not emulate a different GPU. The reference uses the same storage policy.

Both modes require typing, deletion and horizontal scrolling to exercise region
capture. CPU mode also checks fractional and shifted fields, normal-flow
positions, and full-capture fallbacks for wide outlines, outer shadows and
fields outside the root. Omitting
`REGION_STORAGE` uses the adapter's normal storage choice.

The cases cover placeholders, overlapping fields, duplicate IDs with unique
anchors, outside content changes, CSSOM refresh, stylesheet and media-query
changes, resize, densities 1/1.5/2/3, transparency, fractional origins, filters
and transformed ancestors. The normal-flow edit compares every published frame
with a full capture so a later repaint cannot hide a temporary pixel error.
Held fresh and cached decodes check input changes during capture, refresh and
disposal without a late paint. Deliberate decode and cache-draw failures check
recovery without publishing a partial image. Repeated edits must exercise actual
SVG reuse. CPU direct text cases require actual Canvas draws with no upstream
capture or SVG value decode. Trusted complete-value edits cover `JY 1Op` and
punctuation after a different seed has passed the pixel check. Failed direct
drawing must leave the published source intact. Refresh and disposal during
held preparation must abort it, remove its attached canvas and clear its buffers.
Group opacity, clipping paths, restrictive ancestor overflow and unsupported
typography must fall back to SVG. GPU storage must retain SVG reuse without
preparing a direct painter. A held SVG decode also checks that discarded
preparation cannot prevent the next accepted template from preparing again.

Style-cache cases warm the cache, then change ancestor paint through input
validity, a color-scheme media query without resizing, and an inherited host
style. A paused animation outside the captured root is advanced manually.
The media, inheritance and paused-animation fixtures compare full captures
with the input value held constant to prove a visible change before typing.
The next trusted input must capture the current styles and preserve focus.
These cases compare the resulting pixels with a full capture. A separate
fixture renames an empty custom property while keeping the property count
unchanged. It compares the cached serialization with the complete current
declaration. Results record style-cache hits and new serializations.

Full-background cases require CPU captures to reuse the root background during
content edits and trusted submission. They also cover a form inside two ordinary
wrapper divs. Their reference decodes the complete fresh SVG through the image
path, with the background-cache hook omitted. Results count successful background
reuse, new preparations and fallbacks. Separate counters identify memory-budget
fallbacks and viewport-metadata fallbacks before the cache is called.
Setting inactive mask defaults and normal background blending must preserve
reuse. A gradient mask image must use the full SVG fallback.

The cases cover changed root backgrounds, transparent and translucent backgrounds,
and opaque, translucent and shadowed children crossing rounded root edges. Root
opacity, filters, backdrop filters and blend modes must use the full SVG fallback.
A descendant with negative `z-index` also requires fallback, preserving its paint
order relative to the root background.
An overflowing root with `overflow: auto` must also fall back. Its fixture
requires overflow on both axes and removes the negative `z-index` first.
The CPU density-3 case exceeds the per-background RGBA budget of 8 MiB and must
fall back before preparing a new background. The previous background may remain
cached. Replacement can briefly retain two background buffers; the cap does not
bound total capture memory.

Held background preparations exercise input, refresh, density changes and
disposal. The input and refresh case checks each published frame against a
complete captured or final state. A failed composite must preserve the published
canvas. Disposal must clear the pending buffer and prevent a late paint. GPU full
captures must use the original SVG path with no background preparation or reuse.

A font fixture checks cache hits for a covered declared range and
cache misses for an additional range. It does not prove that an input-only
font subset is embedded: the existing font selector reads clone text nodes
and can omit native input values.

`REGION_OUTPUT` selects the evidence directory. It defaults to
`/tmp/munari-input-regions`. Each case saves both PNGs and its result in
`results.json`. `completion.json` confirms that the whole run finished.
`CHROME_PATH` selects the Chrome executable.

Reusing a stale background after the root paint changes must fail
`background-root-change` on a pixel mismatch. The fixture first compares fresh
captures at the same input value to prove that the background change is visible:

```sh
REGION_STORAGE=cpu REGION_FREEZE_BACKGROUND=1 REGION_OUTPUT=/tmp/munari-input-regions-background-fault \
  node instruments/input-regions/run.mjs
```

Freezing a cached style string whenever its property count stays unchanged
must fail the color-scheme pixel comparison. This control removes the name
and value checks after the cache has warmed:

```sh
REGION_STORAGE=cpu REGION_FREEZE_STYLES=1 REGION_OUTPUT=/tmp/munari-input-regions-style-fault \
  node instruments/input-regions/run.mjs
```

The deliberate one-pixel placement fault must exit nonzero on a pixel mismatch:

```sh
REGION_STORAGE=gpu REGION_SHIFT_PATCH=1 REGION_OUTPUT=/tmp/munari-input-regions-fault \
  node instruments/input-regions/run.mjs
```

The failed-cache control must also fail on a pixel mismatch during recovery:

```sh
REGION_STORAGE=gpu REGION_REUSE_FAILED_CACHE=1 REGION_OUTPUT=/tmp/munari-input-regions-cache-fault \
  node instruments/input-regions/run.mjs
```

Unrecognized SVG output must recover with a full capture, then keep using full
captures for that source. This short run removes the clipped SVG's foreignObject
before the adapter inspects it; the full-capture reference stays intact:

```sh
REGION_STORAGE=cpu REGION_UNKNOWN_VIEWPORT=1 REGION_OUTPUT=/tmp/munari-input-regions-unknown \
  node instruments/input-regions/run.mjs
```

The timer-fallback smoke removes `globalThis.scheduler` before the app loads.
Its initial CPU captures must prepare and reuse a background, with exact pixels.
Combining it with the short unsupported-viewport run checks completion through
the timer path. The full CPU run covers held preparation, refresh and disposal.

```sh
REGION_STORAGE=cpu REGION_NO_SCHEDULER=1 REGION_UNKNOWN_VIEWPORT=1 \
  REGION_OUTPUT=/tmp/munari-input-regions-timer-fallback \
  node instruments/input-regions/run.mjs
```

Restoring the old HTML viewport must fail the normal-flow pixel comparison:

```sh
REGION_STORAGE=cpu REGION_LEGACY_VIEWPORT=1 REGION_OUTPUT=/tmp/munari-input-regions-legacy \
  node instruments/input-regions/run.mjs
```

Moving CPU SVG rasterization to the tile's local origin, while preserving the
bitmap's final placement, must fail the pixel comparison:

```sh
REGION_STORAGE=cpu REGION_LOCAL_ORIGIN=1 REGION_OUTPUT=/tmp/munari-input-regions-origin-fault \
  node instruments/input-regions/run.mjs
```

Using a GPU scratch canvas to carry CPU pixels across a density change must
also fail the pixel comparison:

```sh
REGION_STORAGE=cpu REGION_GPU_CARRY=1 REGION_OUTPUT=/tmp/munari-input-regions-carry-fault \
  node instruments/input-regions/run.mjs
```

Removing the input event version guard must expose a stale frame after a held
capture and a real Backspace event:

```sh
REGION_STORAGE=cpu REGION_IGNORE_INPUT_VERSION=1 REGION_OUTPUT=/tmp/munari-input-regions-version-fault \
  node instruments/input-regions/run.mjs
```

Restoring Canvas auto kerning after the seed has passed must fail the CPU
`direct-kerning` pixel comparison:

```sh
REGION_STORAGE=cpu REGION_AUTO_KERNING=1 REGION_OUTPUT=/tmp/munari-text-kerning-fault \
  node instruments/input-regions/run.mjs
```

The probe exposes capture observations and decode holds through served-module
instrumentation. It adds no production test hooks. It verifies Chromium pixels
and source lifecycle; the [performance benchmark](../performance/README.md)
checks the rendered Controls scene, trusted input, submission and handoff.
