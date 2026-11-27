<!-- review-gate author: claude-opus-5-5 -->
# How the browser hides its own costs

Status: research for the [loading proposal](README.md), 2026-11-26.

Each feature below costs time the browser does not show. Most share three
parts:

- Space is reserved before the content exists, so nothing moves.
- Something already complete stays on screen while the new content
  prepares off screen.
- A bound limits the wait. Past it, the browser shows the fallback for
  good or skips the effect. It does not block. Some features have no
  bound: `font-display: block` has an infinite swap period, and an image
  has none.

Each section ends with what Munari takes from it.

## Images

- An `<img>` with `width` and `height` attributes
  maps them to `aspect-ratio: auto w / h` as a presentational hint, so
  the box has its size before any byte arrives
  ([HTML, rendering](https://html.spec.whatwg.org/multipage/rendering.html)).
- Inserting an image and letting the paint decode it
  "can cause notable dropped frames, as the paint that occurs after
  inserting the image into the DOM causes a synchronous decode on the main
  thread". `img.decode()` returns a promise that settles when the image
  can be inserted without that cost
  ([HTML, embedded content](https://html.spec.whatwg.org/multipage/embedded-content.html)).
- `loading="lazy"` defers the fetch
  until the image nears the viewport. `fetchpriority` signals "a
  high-priority fetch relative to other resources with the same
  destination", or a low one
  ([HTML, URLs and fetching](https://html.spec.whatwg.org/multipage/urls-and-fetching.html)).

Munari takes two things. The page presentation reserves the effect's
box. A report says when the effect can be shown without a dropped frame.
Eager or lazy is a separate control ([D6](decisions.md#d6-eager-or-lazy)).
A priority control is deferred
([D8](decisions.md#d8-deferred-route-preloading-and-priority)).

## Fonts

- A face that has not loaded gets a block period, where text draws
  with an invisible fallback. A swap period follows, where text draws in a
  visible fallback and the face replaces it when it loads. `block` is "a short block period (3s is recommended in most
  cases) and an infinite swap period". `fallback` gives "an extremely
  small block period" and "a short swap period". After that, "the fallback
  will be used for the rest of the page's lifetime"
  ([CSS Fonts 4](https://www.w3.org/TR/css-fonts-4/)).
- `document.fonts.ready` settles when the font set stops being
  "pending on the environment": no document loading, no pending
  stylesheets, and no layout that might request a font
  ([CSS Font Loading](https://drafts.csswg.org/css-font-loading/)).

Munari takes the swap period. The page presentation is the fallback face,
and the scene replaces it when ready. Whether a late scene should be
declined for the rest of the page view, as `font-display: fallback` does,
is [D3](decisions.md#d3-a-scene-that-is-ready-late).

## CSS

- A document stays render-blocked while its
  render-blocking element set is non-empty, and only until "an
  implementation-defined timeout value". `blocking="render"` adds an
  element to that set
  ([HTML, DOM](https://html.spec.whatwg.org/multipage/dom.html);
  [blocking attributes](https://html.spec.whatwg.org/multipage/urls-and-fetching.html)).
- Under `content-visibility: auto`, an element that is not "relevant to the
  user" skips its contents. "On-screen" includes "a user-agent defined
  margin around the viewport", "meant to allow the user agent to begin
  preparing for an element to be in the viewport soon. A margin of 50% is
  suggested" ([CSS Containment 2](https://www.w3.org/TR/css-contain-2/)).
- With `contain-intrinsic-size: auto`, a skipped element keeps its last
  remembered size, so skipping causes no shift
  ([CSS Sizing 4](https://drafts.csswg.org/css-sizing-4/)).

Munari takes the margin. A lazy effect starts preparing before it enters
the viewport. It takes no render-blocking: the page presentation must
paint at once.

## View transitions

`document.startViewTransition(callback)` captures the old view and keeps
showing it while the callback updates the DOM. During that time the
document has "rendering suppression for view transitions", and "all
pointer hit testing must target its document element". A user agent "may"
skip a transition after "an implementation-defined duration", rejecting
with a `TimeoutError`
([CSS View Transitions 1](https://www.w3.org/TR/css-view-transitions-1/)).
Cross-document transitions are opted in with `@view-transition`
([Level 2](https://drafts.csswg.org/css-view-transitions-2/)).

Munari takes the shape. Its handoff from page to scene is a transition
between two complete frames, and input never waits on it. Whether a late
handoff is skipped is [D3](decisions.md#d3-a-scene-that-is-ready-late).

## Paint holding

On same-origin navigations Chrome "defer[s] compositor commits until a
given page load signal (PLS) (e.g. first contentful paint / fixed timeout)
is reached", so the old page stays until the new one has content
([Chrome blog](https://developer.chrome.com/blog/paint-holding)). A
Chromium-only test checks that the paint holding timeout cancels a
cross-document view transition
([WPT](https://chromium.googlesource.com/external/w3c/web-platform-tests.git/+/HEAD/css/css-view-transitions/navigation/chromium-paint-holding-timeout.html)).

Munari takes the rule that the last complete frame stays until the next
complete frame exists. The canvas never shows an empty or partial scene
over the page.

## Shader and pipeline compiles

- In WebGPU, `createRenderPipelineAsync` returns a promise that
  "resolves when the created pipeline is ready to be used without
  additional delay". The spec says: "Use of this method is preferred
  whenever possible, as it prevents blocking the queue timeline work on
  pipeline compilation" ([WebGPU](https://www.w3.org/TR/webgpu/)).
- In WebGL, `KHR_parallel_shader_compile` adds a "non-blocking poll", so
  `COMPLETION_STATUS_KHR` "can be queried without potentially incurring
  stalls"
  ([Khronos registry](https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/)).
- three.js's `compileAsync` "compiles all materials in the given
  scene" to avoid "shader compilation stutter, which occurs when rendering
  an object with a new shader for the first time"
  ([three.js Renderer](https://threejs.org/docs/pages/Renderer.html)).
- Dawn's caching interface in Chrome wraps "an
  in-memory DawnMemoryCache and a disk cache"
  ([Chromium source](https://chromium.googlesource.com/chromium/src/+/HEAD/gpu/command_buffer/service/dawn_caching_interface.h)).
  How much of a compile a warm cache saves on macOS is measured in
  [measurements](measurements.md).
- Unreal's PSO precaching collects and compiles the
  pipelines a component could use, ahead of use. One option waits to
  create a component's render proxy until its pipelines are compiled.
  Another draws the default material while they compile
  ([Epic, PSO precaching](https://dev.epicgames.com/documentation/unreal-engine/pso-precaching-for-unreal-engine)).

Munari already holds a presenter until its pipelines are built (decision
#76). Unreal's default material is Munari's page presentation. The gap is
coverage. Every material a Surface will draw has to be compiled from its
final state, including its environment.

## React

A component that renders `<link rel="stylesheet" precedence>` "will
suspend while the stylesheet is loading". `preinit` and `preload` start
fetches early
([React, link](https://react.dev/reference/react-dom/components/link);
[preload](https://react.dev/reference/react-dom/preload)). A Suspense
boundary shows its fallback in place of children that suspend
([React, Suspense](https://react.dev/reference/react/Suspense)).

A preload function for Munari is deferred until a measurement shows the
need ([D8](decisions.md#d8-deferred-route-preloading-and-priority)).
Suspense hides content while it
prepares, and a capture needs that content mounted, laid out and painted,
so it does not fit a Surface (the same reason `loading-spec.md` gives).
