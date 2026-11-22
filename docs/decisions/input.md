# Decisions: pointer input

Rules for routing pointer input to the presenter the user sees, and for keeping deformed geometry and hit testing in agreement. Code cites each rule as `decisions.md #N`; the [index](../decisions.md) maps every number to its file.

<a id="33"></a>

## #33 — Input follows the eye

`crossingPointer(phase)` equals `crossingPresentation(phase)` (#29): exactly one side hears the pointer, and it is the side that is seen. The binding reads the hold, not the phase, so hearing flips at the draw that changes the pixels. A canvas that does not hear declines every ray in its raycast, so neither Munari's pointer routing nor React Three Fiber counts it. `<FrameSurface>` does the same when told its crossing, and an authored `raycast` wins.

Each flip sends edge events. The side that loses cancels its relayed press and clears its hover twins. The side that gains forwards one buttonless move at the last trusted pointer position, and `bridgeHover` keeps hover on the page copy until a trusted contact resumes it. A press that straddles a flip ends at the edge. On any frame where the position attribute's version changes while the canvas hears, the presenter replays the last pointer position, so routing follows moving geometry. `gate:lifting-pointer` and `gate:fisheye-pointer` check this in Chrome.

<a id="35"></a>

## #35 — Bend a Surface by moving vertices, never in the vertex shader

The supported way to bend a presented Surface is `deformSurfaceGeometry(geometry, [w, h], place)`, called from the consumer's frame loop. `place` maps content pixels (origin top-left, y down) to positions. The helper moves vertices and owns the uv-to-content flip, the upload flag and the bounding-sphere reset. An identity `place` restores the flat plane. Extra per-vertex outputs write through the callback's index argument.

Deforming in a vertex shader is unsupported. Three still raycasts the flat plane, so every relayed event lands off by the displacement: 60 px against 44 px rows at the fisheye scene's lens rim.

<a id="39"></a>

## #39 — One pure law picks the pointer route, and one pose feeds both routes

A Surface has two pointer routes. The relay synthesizes the interaction and serves every pose. The native route lifts the parked capture canvas above the renderer canvas, sets the presented pose on it as a CSS `matrix3d`, and lets Chrome hit-test the real element. This lifted canvas is the native rig. Only trusted events give caret placement, drag selection, `:focus-visible` and real `:hover`. The native route is opt-in through `<Surface.Mesh pointerRoute="auto">`; the default is `"relay"`.

`routeFor` in `packages/core/src/pointer/pointerRoute.ts` is pure and picks one owner from one request and six observed booleans. Both the `matrix3d` string and the relay's hit point come from `surfacePose`, so they cannot drift. `surfacePose` agrees with Chrome's hit region within 1.25 px at device pixel ratios 1 and 2.

The binding takes the native route only for a plane the library built, that nothing deformed (#35) and no scene raycast reshaped, with one interactive pose per capture source. Otherwise it relays. The native rig hides the canvas with `visibility`, never `opacity`, because a static `opacity: 0` root captures as blank. Its z-index is one above the tallest explicit z-index between the renderer canvas and the document. While the native rig is in place, the library writes no cursor. Whether Chrome applies the `cursor` of an unpainted canvas child is unmeasured, which is one reason the route stays opt-in. Scenes keep writing `[data-hover]` and `[data-active]` attributes, the twins that stand in for `:hover` and `:active` in a capture (docs/authoring.md).
