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

`routeFor` in `packages/core/src/pointer/pointerRoute.ts` is pure and picks one owner from one request and seven observed booleans. The seventh, `unobstructed`, is #78. Both the `matrix3d` string and the relay's hit point come from `surfacePose`, so they cannot drift. `surfacePose` agrees with Chrome's hit region within 1.25 px at device pixel ratios 1 and 2.

The binding takes the native route only for a plane the library built, that nothing deformed (#35) and no scene raycast reshaped, with one interactive pose per capture source. Otherwise it relays. The native rig hides the canvas with `visibility`, never `opacity`, because a static `opacity: 0` root captures as blank. Its z-index is one above the tallest explicit z-index between the renderer canvas and the document. While the native rig is in place, the library writes no cursor. Whether Chrome applies the `cursor` of an unpainted canvas child is unmeasured, which is one reason the route stays opt-in. Scenes keep writing `[data-hover]` and `[data-active]` attributes, the twins that stand in for `:hover` and `:active` in a capture (docs/authoring.md).

<a id="78"></a>

## #78 — A nearer scene mesh takes the pointer from the Surface behind it

A ray hit on a Surface counts only when no other visible mesh is strictly nearer along the same ray. The Surface's raycast declines the point, so every relay consumer agrees: the canvas pointer gate in `pointerMode="surfaces"`, R3F's delivery in `pointerMode="scene"`, and the arrival move. The test lives in `surfaceOcclusion.ts` and runs from the hit region in `surfaceHitRegion.ts`.

Six kinds of mesh never block. A mesh hidden by its own or an ancestor's `visible = false` is skipped, because three's `Raycaster` tests layers and never visibility. A mesh whose material has `visible: false` is skipped for the same reason. Another Surface's mesh and the Surface's own descendants are skipped. A mesh blocks only when its hit is nearer than the Surface's distance by more than a relative 1e-4. A closer call is a tie and goes to the Surface, so a coplanar decal or backing card does not block. A mesh whose `raycast` does nothing never intersects, which is how a scene opts a prop out.

The native route (#39) has its own condition, `unobstructed`. The browser hit-tests the lifted canvas above the renderer canvas, so a click there lands on the HTML through any mesh drawn in front of it. Each frame, and on every trusted buttonless move and press heard on `window` in the capture phase, the binding asks the same test at the pointer's point. A covered point parks the rig before that event is hit-tested. A press with no move before it, such as a touch, was already aimed at the lifted HTML. The binding stops it and its release, hands both to the renderer canvas, and swallows the click the tap makes.

Until 0.6.0 only meshes with R3F handlers that stopped propagation could block. A press on the review notes teapot's spout focused the note wrapped behind it (23 Nov 2026).

The test raycasts every visible mesh on the raycaster's layers that is not a Surface, once per ray. `probe:review-notes-occlusion` proves the review notes case on both capture engines. It is cached per raycaster and ray until the next microtask. Measured 25 Nov 2026 on an M2 MacBook Pro in headless Chrome 156 and 159 at 1280×900, on review notes with the wheel at −132°, it took 3.8 to 4.2 ms per ray on both capture engines. The 36,864-triangle teapot body took 2.8 to 3.3 ms of that, and a plain raycast of the note took 80 µs. Paired 1.5 s blocks with the body's raycast on and off both held 90 frames at a 16.7 ms mean. Headless Chrome paces frames at 60 Hz, so a 120 Hz frame budget is unmeasured. `surfaceOcclusion.test.ts` checks the exclusions, `surfaceNativeRoute.test.ts` checks the native route's park and the cold tap, and `gate:native-pointer` checks a box in front of the button in both pointer modes and on the native route in Chrome.
