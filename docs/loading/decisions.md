<!-- review-gate author: claude-opus-5-5 -->
# Loading decisions

Status: decided 2026-11-26 and built: D1 B, D2 B, D3 A with C, D4 B, D5 A,
D6 A and D7 A. D8 stays deferred. Decisions #80 and #81 state the result.
Part of the [loading design](README.md).

Each decision lists its options, what each costs, and a recommendation.
Times come from [the measurements](measurements.md) on one machine.

## D1. The page look while a finish prepares

A finish card's body is drawn by its finish material. Until the lift, the
page presentation shows the card's text with no body. On Bench, cold,
that lasted 2.1 s.

| Option | What the user sees | Cost |
|---|---|---|
| A. Body color only | A flat card in the finish's color, then the lit finish | The finish API proposal already writes `--munari-body` on the page element. A glossy or foil finish changes visibly at the lift |
| B. A CSS look per finish preset | A flat approximation of the finish: color, a gradient for the light, and a shadow | Each preset carries a few CSS declarations to keep close to the material. The match is approximate under a dragged light |
| C. Hide the card until the lift | An empty area | Breaks "no blank". Needs app code |

Recommendation B. A low-quality image placeholder does the same for a
photo. So does a fallback font during `font-display`'s swap period. In
each, the content is readable and close to final before the swap. B
builds on A's body color.

## D2. A SceneSurface before it is ready

A `SceneSurface` has no page presentation. Knobs' panel is one. On a
cold load it was absent until 1.66 s on the shell's clock, then an empty
slab until 1.92 s.

| Option | What the user sees | Cost |
|---|---|---|
| A. Nothing, as today | An empty area, then the panel | No work. The panel pops in |
| B. A placeholder the app renders in the page | The app's own stand-in, such as the panel's frame in CSS | App code per scene. The library only says when to remove it, through loading-spec's Shown |
| C. A stand-in mesh with a shared basic material | The panel's shape in its body color, drawn in the scene | One extra pipeline per canvas, built before anything else. Its cold build time is unmeasured |

Recommendation B now, C later if more scenes need it. B uses
loading-spec's reporting with no new library behavior. C is Unreal's
default-material approach, and its value depends on that unmeasured build
time.

## D3. A scene that is ready late

The scene can become ready after the user has started reading or using
the page presentation.

| Option | Behavior | Cost |
|---|---|---|
| A. Lift whenever ready | The lift happens at readiness, however late | A late lift is visible. With D1's look, the change is small |
| B. A swap window in the library | Past a window, the page presentation stays for the page's life, as `font-display: fallback` does | A wall-clock rule in the library. loading-spec rules out time turning waiting into anything but a notice. The effect may never appear on a slow first visit |
| C. The app decides | The library lifts whenever ready. The app uses loading-spec's `late` notice to choose another path, as Light does | App code where it matters |

Recommendation A with C. It keeps loading-spec's rule that time is only a
notice. The fixes in the [README](README.md#what-munari-does-by-default)
should shorten the wait. By how much is unmeasured, and one machine
cannot show how often a scene is late for real visitors.

## D4. What the async hold covers

Decision #76 holds a Surface presenter hidden until its first material's
pipelines are built asynchronously. Other meshes in the same canvas build
with the blocking call. Knobs, inside a `SurfaceCanvas`, makes 9 blocking
builds after its first draw, mostly for meshes that are not Surfaces.
Light builds everything with the blocking call, but it runs its own
renderers, so no `SurfaceCanvas` option reaches it.

| Option | Behavior | Cost |
|---|---|---|
| A. Surface presenters only, as today | Lamps, rooms and other meshes freeze frames on their first draw | None now |
| B. Every mesh in a SurfaceCanvas | The canvas holds each mesh until its pipelines are built | The compiler's stand-in logic (`surfaceCompile.ts`) must cover materials it does not know, such as app shaders and post passes |
| C. An opt-in per mesh | The app marks meshes to hold | Each app has to know which meshes compile slowly |

Recommendation B. A blocking build stops frames for the whole page,
whoever owns the mesh. Whether `surfaceCompile.ts` handles every three material
correctly is unverified.

## D5. Material changes after the lift

`useSurfaceCompiled` does not hold a material replaced after the first
draw (`surfaceCompile.ts:281-284`). On Bench, switching to Oil-slick
foil stopped frames for 250–350 ms cold.

| Option | Behavior | Cost |
|---|---|---|
| A. Keep drawing the old material until the new one is built | The new look appears 0.6 s or so later on a cold cache, with no freeze | Two materials alive during the build. The change lags the input that caused it |
| B. Keep #76 as it is | The change shows on the next frame after a freeze | The measured freeze |
| C. Require `Surface.Prewarm` for every look a page can show | No freeze for prewarmed looks | The developer must list every look. Tweak panels that cross a shader threshold still freeze |

Recommendation A. A late change is a smaller fault than a stopped page,
and it matches how a browser swaps an image after decoding it. The 0.6 s
figure is the promise latency of Bench's cold async builds, used as an
estimate. The real wait is unmeasured.

## D6. Eager or lazy

| Option | Behavior | Cost |
|---|---|---|
| A. Eager by default, `loading="lazy"` to opt in | Every Surface prepares at mount. A lazy one starts near the viewport | A long page builds everything at once |
| B. Lazy by default | Surfaces out of view wait | A Surface scrolled into view shows its page look while it prepares |
| C. Eager only | No control | Long pages pay for content the user may never see |

Recommendation A, with a margin of 50% of the viewport, as CSS
Containment suggests for `content-visibility: auto`. Images and iframes
also default to eager. Every scene measured is in the first viewport, so
no measurement here shows the cost of eager loading on a long page.

## D7. The readiness API

| Option | Cost |
|---|---|
| A. loading-spec's `<Loading onLoaded late independent>` and `useLoadingWait`, amended as the README says | Already specified, unbuilt |
| B. A promise per Surface, like `img.decode()` | Callers must collect promises across components |
| C. Suspense | A suspended subtree has no page presentation to show. loading-spec already rejects it |

Recommendation A. B can come later as a thin layer over the same Shown
state if a caller needs one Surface.

## D8. Deferred: route preloading and priority

Two controls a browser offers have no measured need yet.

- A `preload` function that starts the adapter, device and finish builds
  before a route renders. On loopback the page painted early, and the
  cost was compile time, which starts once a canvas exists. A real network
  could change that.
- A `priority` prop, like `fetchpriority`. No measurement showed two
  Surfaces competing.

Recommendation: build neither until a measurement on a real network or a
long page shows the need.
