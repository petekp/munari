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

A font fixture checks cache hits for a covered declared range and
cache misses for an additional range. It does not prove that an input-only
font subset is embedded: the existing font selector reads clone text nodes
and can omit native input values.

`REGION_OUTPUT` selects the evidence directory. It defaults to
`/tmp/munari-input-regions`. Each case saves both PNGs and its result in
`results.json`. `completion.json` confirms that the whole run finished.
`CHROME_PATH` selects the Chrome executable.

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
