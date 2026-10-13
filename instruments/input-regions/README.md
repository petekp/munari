# Input region capture proof

```sh
node instruments/input-regions/run.mjs
```

This runs the real Controls form with its lab styles in headless Chrome. It
uses the public capture engine, keeps the original form nodes, and compares
the source canvas against a fresh full snapDOM capture after each change.
Every RGBA channel must match exactly. Capture observations require the typing,
deletion and horizontal-scroll cases to exercise the region path.

The cases cover placeholders, overlapping fields, duplicate IDs with unique
anchors, outside content changes, CSSOM refresh, stylesheet and media-query
changes, resize, density, fractional origins, filters and transformed ancestors.
A held decode checks refresh during capture and disposal without a late paint.
Deliberate decode and cache-draw failures check recovery without publishing a
partial image.

`REGION_OUTPUT` selects the evidence directory. It defaults to
`/tmp/munari-input-regions`. Each case saves both PNGs and its result in
`results.json`. `completion.json` confirms that the whole run finished.
`CHROME_PATH` selects the Chrome executable.

The deliberate one-pixel placement fault must exit nonzero on a pixel mismatch:

```sh
REGION_SHIFT_PATCH=1 REGION_OUTPUT=/tmp/munari-input-regions-fault \
  node instruments/input-regions/run.mjs
```

The failed-cache control must also fail on a pixel mismatch during recovery:

```sh
REGION_REUSE_FAILED_CACHE=1 REGION_OUTPUT=/tmp/munari-input-regions-cache-fault \
  node instruments/input-regions/run.mjs
```

The probe exposes capture observations and decode holds through served-module
instrumentation. It adds no production test hooks. It verifies Chromium pixels
and source lifecycle; the [performance benchmark](../performance/README.md)
checks the rendered Controls scene, trusted input, submission and handoff.
