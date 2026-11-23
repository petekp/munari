# Capture engines

Munari ships two ways to turn your HTML into pixels. Both feed the same
textures, pointer routing and handoff; they differ in what they need from the
browser and what they can draw.

| | HTML-in-canvas (default) | snapDOM |
|---|---|---|
| Needs | HTML-in-canvas support; enabled by default in Chrome 157+ | any browser with a document |
| Draws | the live element | a rasterized copy of the subtree |
| What the texture follows | user input, layout/font/image changes, transition ends, and `useSurfaceRefresh()`; ongoing changes need `live` | same, but a Surface ignores `live`; a live `useElementCapture` re-captures at most ~4 times/s |
| Caret and selection | real, painted by the browser | not painted |
| Everything else on the page | pixel-exact | close: laid-out lengths snap to whole CSS pixels, and vertical geometry can sit up to two device pixels off |
| Input to texture, Knobs panel at dpr 2 | 12 ms | 37 ms for a change that lands on a quiet Surface; up to 150 ms more on one that is already re-capturing |
| Pointer route `"auto"` | native: the browser hit-tests the real element | relay |
| Page-to-scene handoff | yes | yes, in every browser; a running CSS animation restarts where `Element.moveBefore` is missing (Safari) |
| Sub-pixel CSS lengths | exact | a fractional `border-width`, padding or offset rounds to whole pixels; type and SVG strokes keep their fractions |

HTML-in-canvas is the default engine. It needs no code, but the browser must
provide it (see [Requirements](../README.md#requirements)). To add snapDOM, install it and
enable it once, before you render:

```sh
npm install @zumer/snapdom
```

```ts
import { enableSnapdomCapture } from '@petepetrash/munari/snapdom'

enableSnapdomCapture()
```

That call keeps HTML-in-canvas when the browser has it and falls back to snapDOM
when it does not. Pass `{ always: true }` to force snapDOM everywhere, which is
what a cross-engine test run wants. Call it before the first `Surface` mounts.
A Surface that is already mounted keeps the engine it was built with.

For isolated text fields, snapDOM can replace a small region in a cached image:

```ts
enableSnapdomCapture({ isolatedTextInputs: 'input[data-munari-capture-region]' })
```

Mark eligible inputs with `data-munari-capture-region=""`. This declares that
value edits affect only pixels inside the input's border box. The field must
not change surrounding layout, counters or content through CSS state selectors.
Its capture area must be free of unrelated overlapping paint. Controls' Project
field is the [working example](https://github.com/petekp/munari/blob/v0.4.1/apps/lab/src/scenes/controls/Controls.tsx).

This opt-in keeps the original form and input nodes. It supports focused text
inputs with stable geometry and paint. Focus, other content changes, unsupported
effects, fractional density and `live` sources use full captures. CPU-backed
captures also use full images for outer shadows, outlines beyond five CSS
pixels, and regions that extend outside the root. Unrecognized snapDOM SVG
output disables region capture for that source and uses full images.

For compatible CPU-backed fields at two capture pixels per CSS pixel, the adapter checks
its first Canvas text rendering against the accepted SVG pixels. Matching fields
can then redraw text over a cached background without SVG serialization or
decoding. This path requires unscrolled, left-aligned ASCII text and supported
font settings. Other compatible edits reuse and decode the parsed region SVG. A change in scroll position, a text selection, or a character selecting
another declared font range requires a fresh region capture. The font check
considers all declared families, so it can recapture an edit whose pixels would
have stayed safe to reuse.

Call the function returned by `useSurfaceRefresh()` for paint changes outside the captured subtree that
have no observed signal, including CSSOM edits and canvas redraws. The cache adds
one full-size RGBA bitmap and at most one parsed region SVG per initialized
source. Direct text drawing also retains a blank field bitmap and its decoded
SVG image. Its drawing canvas is connected to the document with `display:none`
so Chromium applies the field's font smoothing. CPU region capture uses another
bitmap bounded by the source dimensions.
Resident memory has not been measured. Texture uploads remain full-size.

Write once and the same code runs on both engines. Without `live`, both engines
follow user input on the content (typing, hover, focus, clicks, drags, scroll),
layout resizes, font/image loads, transition ends, and `useSurfaceRefresh()`,
while pausing declarative CSS/Web Animations in the scene. Changes nobody asked
for — a clock, an animation loop, or new props/data arriving from outside the
Surface after mount — require `live`. With `live`, HTML-in-canvas accepts every
compositor paint. snapDOM ignores a Surface's `live`, because each of its
captures is a full raster, so that content holds still in the scene there. Call
the `useSurfaceRefresh()` function when a change must reach the scene on
snapDOM. `useElementCapture` takes the same `live` option because it also
maintains a copy of the native element; on snapDOM a live capture re-captures at
most about four times a second.

```tsx
<Surface inScene={inScene} live><Clock /></Surface>
```

After drawing canvas pixels, call the function returned by `useSurfaceRefresh()`.
The hook reads the enclosing Surface, or accepts a handle with
`useSurfaceRefresh(surface)`.

Refresh synchronizes retained content and requests captures for its mounted
HTML parts. It also works with `SceneSurface`. Rendering readiness and handoff
still wait for the resulting frames to be drawn. For a caller-owned canvas
used directly as a texture, use `FrameSurface` and publish complete frames.
For a directly captured scene source, refresh can also wake a script-created
Web Animation; keep `live` enabled for its later frames. Page preparation uses
structural copies, which reproduce CSS animations but do not clone script-created
Web Animations.

`useSurfaceStatus().engine` names the engine a Surface is using, or is `null`
when no engine can run.
[Authoring](https://github.com/petekp/munari/blob/v0.4.1/docs/authoring.md) lists the content rules each engine adds.
