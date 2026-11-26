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

Only a `THREE.Mesh` blocks, including `InstancedMesh` and `SkinnedMesh`; `Points`, `Line` and `Sprite` never do. A mesh blocks only on the layers of the canvas's R3F raycaster, whichever route asks. A mesh hidden by its own or an ancestor's `visible = false` is skipped, because three's `Raycaster` tests layers and never visibility. A hit on a material, or on a material group, with `visible: false` is skipped for the same reason. Opacity and `colorWrite` do not count, so a transparent mesh is a hit proxy that blocks. Another Surface's mesh and the Surface's own descendants are skipped. A mesh blocks only when its hit is nearer than the Surface's distance by more than a relative 1e-4. A closer call is a tie and goes to the Surface, so an exactly coplanar decal or backing card does not block. A mesh whose `raycast` does nothing never intersects, which is how a scene opts a prop out.

The native route (#39) has its own condition, `unobstructed`. The browser hit-tests the lifted canvas above the renderer canvas, so a click there lands on the HTML through any mesh drawn in front of it. Each frame, and on every trusted buttonless move and press heard on `window` in the capture phase, the binding asks the same test at the pointer's point. A covered point parks the rig before that event is hit-tested. A press with no move before it, such as a touch, was already aimed at the lifted HTML. The binding stops it and its release, hands both to the renderer canvas, and swallows the click the tap makes. A press never lifts the parked canvas, because the browser has already aimed it at the renderer canvas, so the relay delivers it. A touch leaves no pointer place for the next frame once it lifts, so the end of a gesture reads the cover again: the click that ends a tap, or a cancel that makes no click. An uncovered point lifts the canvas on the next frame, unless a covered press is still held. Chrome hit-tests a tap's click after its release, so lifting at the release would also hand that click to the lifted HTML.

Until 0.6.0 only meshes with R3F handlers that stopped propagation could block. A press on the review notes teapot's spout focused the note wrapped behind it (23 Nov 2026).

One walk of the scene serves every caller that asks along the same ray in the same R3F frame: the gate and R3F for one pointer event, each Surface under the ray, the deform replay, the gate's per-frame recheck and the native route. The next R3F frame ends the reuse. The walk uses its own raycaster with `far` set to the Surface's distance, so three skips a mesh whose bounding sphere the ray enters beyond it. While the pointer is over a Surface, the relay routes walk once per pointer event, and once per frame in `pointerMode="surfaces"` (the gate's recheck) or for a Surface that deforms (the deform replay). The native route walks on each trusted buttonless move and press, and once per frame. Under `frameloop="demand"` a pointer at rest walks only when a frame runs.

`probe:review-notes-occlusion` proves the review notes case on both capture engines and meters the teapot body's raycast. Measured 25 Nov 2026 on an M2 MacBook Pro in headless Chrome 156 and 159 at 1280×900, with about two frames per pointer move, the body took 13 ms per move and 4.8 to 5.3 ms per frame at rest. Before the walks were shared it took 23 to 25 ms per move and 8.1 to 8.5 ms per frame at rest. Paired 1.5 s blocks with the body's raycast on and off both held 90 frames at a 16.7 ms mean. Headless Chrome paces frames at 60 Hz, so a 120 Hz frame budget is unmeasured; an estimated two walks per frame with the pointer moving, 9 to 11 ms, would exceed 8.3 ms. `surfaceOcclusion.test.ts` checks the exclusions, `surfaceNativeRouteOcclusion.test.ts` checks the native route's park, the cold tap and a touch beside the mesh after a touch on it, and `gate:native-pointer` checks a box in front of the button in both pointer modes and on the native route in Chrome.
