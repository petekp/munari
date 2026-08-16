# @munari/core

Everything in munari that has no idea React or `three` exist. It has no
dependencies and never ships on its own; the build bundles it into
`@petepetrash/munari`.

The DOM stays the real thing. This package decides when its pixels move
to a WebGL scene, how many of them there should be, where they have to
land, and who is allowed to show them.

## Turning a live element into a texture

`htmlInCanvas` `textureStorage` `frameSource`

Chrome's HTML-in-canvas trial (versions 148 to 150) is the foundation,
and its contract came from experiment rather than a spec: the element
has to be a child of the canvas you draw into, the canvas needs
`layoutSubtree`, and the draw only succeeds inside an `onpaint`
callback. Chrome defers it to paint time, so a texture trails the DOM by
one frame.

`textureStorage` is here because GL storage is immutable once allocated.
A source canvas that changes size falls out of step with its own texture
and nothing throws: a grow is rejected and the stale texels stay, a
shrink writes into one corner and leaves the old image around it. Both
read as a paint bug.

`frameSource` is the other way in, for pixels you render yourself. Core
names the frames so a receipt can prove which one a mesh actually drew.

## Keeping it sharp

`camera` `lodTier` `pixelGrid` `densitySchedule` `filterPolicy`

Sharpness is three budgets and you have to pay all of them: enough
texels, texels that land on the display's pixel grid, and filtering that
doesn't undo the first two.

Supply is cheaper here than it would be for a screenshot.
`drawElementImage` replays paint records, so the same element
re-rasterizes at a larger scale and the glyphs come out sharper.
`lodTier` picks that scale with a dead zone, so a camera parked on a
threshold cannot thrash between two tiers. `densitySchedule` decides
when a flying card may change its answer, going by the card's measured
height rather than a mode flag, with hysteresis so a card bobbing on its
spring can't flap it.

Phase is the budget nothing else can cover. Put a card a third of a
pixel off the grid and every texel gets read across two, so the whole
card blurs by the same amount. Adding texels doesn't help, because the
new ones land off-grid too.

Then `filterPolicy`. A tier pinned high oversupplies at distance, and
minifying without mipmaps aliases: shredded text and grid moiré, the
first time a lab pinned the top tier.

## Handing pixels between the page and the scene

`crossing` `presentation` `motionCarrier` `motionSamples` `conductorTiming`

`crossing` is a four-phase machine with one invariant: in every phase,
somebody is drawing. Three scenes wrote this by hand before it was law
and all three hit the same bug. Hide the page before the canvas has
proven it can draw, and the content spends a frame belonging to nobody.
That frame is the flicker people see.

Proof is narrow on purpose. A queued upload proves nothing.
`presentation` accepts only a color-writing draw that reached the
default framebuffer, and it turns down stale transfers and reused
revisions on the way.

Motion is the other half. A CSS animation's clock lives in the
compositor, and neither renderer can read it at the swap, so idle motion
eases to zero and the swap waits for it. `motionCarrier` is the
exemption: keep the clock in JS, have the page and the mesh read the
same sample, and motion crosses mid-flight with its velocity intact.

`motionSamples` covers CSS animations that still need to fly. It pauses
one, asks the style engine what it would have painted at a series of
times, and replays that table on the mesh; letting it play inside the
texture instead costs a paint and an upload every frame, around 120 a
second with a popover open. `conductorTiming` keeps the small print,
like stopping half a millisecond short of the end, because an animation
scrubbed to its exact end fires `animationend` and a library listening
for that tears the content out 130ms early.

## CSS as a channel to the mesh

`styleChannel`

A custom property registered with a real syntax is interpolable, so
`transition: --depth 300ms ease` is a genuine CSS transition, timed and
eased by the cascade and painting nothing: zero paints across a full
600ms run. Read it mid-transition and `getComputedStyle` returns the
eased intermediate value, so the style engine does the interpolation and
no easing math exists in our code. A Tailwind utility can declare what a
surface's depth or tilt should be and how it gets there, and the scene
reads that channel every frame and moves matter.

## Clicks, hover and typing

`forwardEvents` `relay` `gestures` `hoverGrace`

A hit on a mesh becomes a UV, the UV becomes pixel coordinates inside
the live subtree parked behind the canvas, and the deepest element under
that point gets the event. The browser handles the rest: hover and focus
styles repaint into the texture on their own, and once an input has
focus, real keystrokes reach it with no forwarding at all.

Every synthetic event leaves through `relay` and carries a marker. The
user's hand and the library's echo arrive at the same window, and code
on the page side has to tell them apart. `gestures` is the listener that
does, reading the real pointer while a card is in flight and ignoring
everything munari sent.

`hoverGrace` handles a hover layer standing across the room from its
trigger, where the walk from trigger to content stops being a few pixels
and becomes a flight across the screen, racing a 300ms close timer
written for the short version.

## The parts of a component the rasterizer misses

`surfaceChrome` `shadowQuadFrame`

A texture is a rectangle and a component isn't. Border radius and outer
shadows never reach the capture, and the corners aren't even empty:
under a 14px radius, the corner texel measured 255,255,255,255, which is
the app's own background. The texture can't say where the element ends,
so the element's computed style is measured instead, and the radius
becomes a distance function a shader can read. The shadow comes back as
its own quad, with `shadowQuadFrame` computing the geometry and the
shader's uniforms in one pass so the two can't disagree.

## Controls that behave like objects

`physics1D` `plate`

Feel is written as force fields. A dial is a detent field plus damping;
a toggle is an over-center field plus damping. Release velocity flows
into the field and the field decides where things come to rest, so there
are no durations and no easing curves.

`plate` is a rigid body rather than the one-dimensional integrator,
because a card picked up by a corner has to swing, and swing is the
lever arm between the hand and the mass. It works in CSS pixels and
seconds, which is what lets a `getBoundingClientRect` be a world pose
with nothing in between.

## Smaller pieces

- `uvAnchor` runs the raycast backwards: hand it a texture coordinate
  and it finds the point on the surface. The triangle search reads only
  the UV attribute, which holds still while vertices move, so an anchor
  resolves once and then rides a deforming surface for free.
- `math` is `vec2`, `vec3` and `quat`, written out because core can't
  import them from three.
- `sourceIdentity` numbers the pixel sources. Internal, not exported.

## Two rules that hold everywhere

Every DOM-sourced texture uploads premultiplied, and every material
sampling one blends premultiplied (`docs/decisions.md` #5).

A Surface nobody is touching costs nothing: zero paints per second,
checked on every push by `npm run gate:idle-zero`.

## House rules

Tests live in `tests/conformance/`, one directory per area, never beside
the module. `tests/boundary.test.ts` enforces both halves: no import
here may leave `packages/core/src`, and no test file may sit in this
directory. Move the test; don't widen the allowlist.

`src/index.ts` is the export list, grouped to match the directories. A
module gets exported once its tests exist.

Modules open with a comment saying what the thing is, then the browser
behavior or bug that shaped it, with the date and the measured number.
Constants cite `docs/decisions.md` or `docs/platform.md` by entry
number. Keep that pattern.
