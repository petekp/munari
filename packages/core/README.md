# @munari/core

`@munari/core` is an internal package. It contains shared code that does not
depend on React or `three`, and it has no runtime dependencies. You do not
install it. The build includes it in [`@petepetrash/munari`](../../README.md).

The DOM remains the source of content and interaction. Core coordinates its
captured pixels with WebGL and routes input back to the live elements.

## Turning a live element into a texture

Modules: [`htmlInCanvas`](./src/paint/htmlInCanvas.ts),
[`textureStorage`](./src/paint/textureStorage.ts), and
[`frameSource`](./src/paint/frameSource.ts).

Munari uses Chrome's HTML-in-canvas origin trial, a browser experiment available
in Chrome 148 to 150. Tests found three requirements:

1. The source element must be a child of the canvas.
2. The canvas must set `layoutSubtree` to `true`.
3. The code must call `drawElementImage` from the canvas's `onpaint` callback.

Chrome completes the draw during its paint step. The resulting texture shows
the DOM from the previous frame.

WebGL allocates fixed storage when it creates a texture. If the source canvas
grows, the next upload fails and leaves the old pixels in place. If the canvas
shrinks, WebGL writes the new image into one corner of the old storage. The
browser reports neither case to JavaScript. `textureStorage` detects a size
change and tells the renderer to allocate new storage.

`frameSource` gives each frame in a caller-owned canvas a source ID and
generation number. The renderer records which generation it uploaded and drew.

## Keeping a Surface sharp

Modules: [`camera`](./src/mapping/camera.ts),
[`lodTier`](./src/paint/lodTier.ts), [`pixelGrid`](./src/mapping/pixelGrid.ts),
[`filterPolicy`](./src/paint/filterPolicy.ts).

A Surface stays sharp when three conditions hold:

1. Its texture contains enough texels. A texel is one pixel in a texture.
2. Its texture grid lines up with the display's pixel grid.
3. WebGL uses the right filter when it shrinks the texture on screen.

`drawElementImage` can redraw the DOM at a larger scale. It replays Chrome's
paint commands, so text gains detail instead of stretching an old image.
`lodTier` chooses the scale. Demand must cross a small boundary around the
threshold before the tier changes. This hysteresis prevents repeated tier
changes when the camera rests near that threshold.

`pixelGrid` makes small position and size corrections so texture pixels land
on display pixels. More texels cannot fix a Surface that sits between display
pixels because WebGL still blends each texel across its neighbors.

WebGL minifies a texture when it covers fewer screen pixels than its source
image contains. Mipmaps are smaller copies that reduce jagged text and grid
patterns during this shrink. `filterPolicy` gives pinned high-resolution
textures mipmaps and blends between them with trilinear filtering. Textures
that track screen density use linear filtering.

## Moving pixels between the page and WebGL

Modules: [`crossing`](./src/transfer/crossing.ts),
[`presentation`](./src/transfer/presentation.ts),
and [`motionCarrier`](./src/transfer/motionCarrier.ts).

A handoff changes which renderer shows the content. During the change, the
page and WebGL may both draw. The user sees one renderer's output. In this
table, "draws" means a renderer produces pixels, while "visible" means the
user sees those pixels.

| Phase | Page draws | WebGL draws | Visible output |
| --- | --- | --- | --- |
| `page` | Yes | No | Page |
| `lifting` | Yes | Yes | Page |
| `gl` | No | Yes | WebGL |
| `landing` | No | Yes | WebGL |

`crossing` controls these phases. It keeps the page visible until each WebGL
surface has drawn the required content. Hiding the page sooner can leave one
frame with no content, which appears as a flicker.

`presentation` checks the draw record used for that handoff. A queued texture
upload does not show that a mesh reached the screen. The record must come from
a draw that wrote color to the browser's visible framebuffer. It must also
match the current transfer, pixel source, and presenter version.

A CSS animation can run on Chrome's compositor, which places page layers on the
screen. JavaScript cannot read the same animation state from both renderers on
the handoff frame. Munari lets idle CSS motion settle to zero before it changes
the visible renderer.

`motionCarrier` supports motion that must continue through the handoff. It
keeps the animation clock in JavaScript. The page and the mesh read the same
sample, so their position and velocity match.

## Sending CSS values to a mesh

Module: [`styleChannel`](./src/paint/styleChannel.ts).

`CSS.registerProperty` gives a custom property a type that Chrome can
interpolate. For example, `transition: --depth 300ms ease` changes `--depth`
over 300 milliseconds. If no paint rule reads that property, the transition
does not repaint the DOM. A 600 millisecond test produced zero paints.

`getComputedStyle` returns the current value during the transition. A consumer
can read that value each frame and apply it to depth, tilt, or another mesh value.
CSS and Tailwind can define the target value and transition.

## Forwarding clicks, hover, and typing

Modules: [`forwardEvents`](./src/pointer/forwardEvents.ts),
[`relay`](./src/pointer/relay.ts), and
[`hoverGrace`](./src/pointer/hoverGrace.ts).

A WebGL raycast finds where the pointer hit a 3D object. It returns a UV
coordinate, which marks a position on the texture from 0 to 1 on each axis.
`forwardEvents` converts that coordinate into a point inside the live DOM
subtree behind the canvas. It finds the deepest element at that point and sends
the pointer event there.

The live element keeps its browser behavior. Focus changes repaint into the
texture. Once a form control has focus, browser keyboard events reach it
without forwarding.

The browser cannot apply `:hover` or `:active` to DOM behind the canvas.
`forwardEvents` mirrors those states to `data-hover` and `data-active`.
Authors must give each hover or active rule a matching attribute selector.

Munari creates synthetic pointer events for the live DOM. `relay` marks each
one so page code can separate Munari events from browser events created by the
user.

`hoverGrace` keeps a detached hover layer open while the pointer travels from
its trigger to the layer's projected position. It builds a corridor in screen
coordinates and closes the layer after the pointer leaves that corridor.

## Restoring border radius and shadows

Module: [`surfaceChrome`](./src/chrome/surfaceChrome.ts).

HTML capture covers the element's layout box. It cannot include an outer
shadow because the shadow lies outside that box. Rounded corners can contain
the application's background color instead of transparent pixels. A test with
a 14-pixel radius measured an opaque white corner texel.

`surfaceChrome` reads border radius and outer shadows from the element's
computed style. A material can use the radius to cut the captured rectangle
into the correct shape and can draw the measured shadows outside it.

## Giving controls physical motion

Module: [`physics1D`](./src/physics/physics1D.ts).

`physics1D` models a control with a position, velocity, and forces. A detent is
a spring that pulls the control toward a stop. Damping slows the control. A
toggle uses two stable positions with an unstable point between them. The
release velocity carries into the simulation, so the control settles from the
gesture instead of following a fixed duration.

## Smaller pieces

- [`uvAnchor`](./src/mapping/uvAnchor.ts) starts with a texture coordinate and
  finds its position on the surface. It finds the triangle once, then reads
  the current vertex positions as the surface deforms.
- [`vec3`](./src/math/vec3.ts) provides the math types that core needs without
  importing `three`.
- [`sourceIdentity`](./src/paint/sourceIdentity.ts) assigns IDs to pixel
  sources. Core does not export it.

## Rules that apply across core

DOM textures use premultiplied alpha. Each color channel is multiplied by the
pixel's alpha before upload, and materials use the matching blend mode. See
[`docs/decisions.md` #5](../../docs/decisions.md).

An idle Surface produces zero paints per second. CI checks this on each push
with `npm run gate:idle-zero`.

## House rules

Core tests live in [`tests/conformance/`](../../tests/conformance/), grouped by
area. They do not sit beside the modules. [`tests/boundary.test.ts`](../../tests/boundary.test.ts)
checks that imports stay inside `packages/core/src` and that no test file sits
in this directory. Move a misplaced test instead of widening the allowlist.

[`src/index.ts`](./src/index.ts) lists exports in the same groups as the source
directories. Export a module after its tests exist.

Start each module with a comment that names the module and explains the browser
behavior or bug that shaped it. Include the date and measured value when a
test produced them. Cite [`docs/decisions.md`](../../docs/decisions.md) or
[`docs/platform.md`](../../docs/platform.md) for constants that come from a
recorded decision or measurement.
