# Decisions: handoffs between page and canvas

Rules for moving a renderer hold between the page and the scene: the crossing phases, what each side draws and shows, and the evidence a handoff waits for. Code cites each rule as `decisions.md #N`; the [index](../decisions.md) maps every number to its file.

<a id="27"></a>

## #27 — A handoff never doubles or drops translucent pixels

Showing the new presenter before hiding the old one is safe only for opaque pixels. If both presenters show the same translucent layer in one composited frame, the layer darkens; if neither shows it, it disappears. At a handoff exactly one presenter shows each translucent layer, and the swap happens inside one renderer turn, so the browser cannot composite between the two writes. `gate:genie-shadow` measures the strip beside a Genie sheet in both directions and fails on a luma change above 6.

<a id="28"></a>

## #28 — The crossing is a four-phase kernel law

A crossing is one move of content between the page and a canvas (#31 defines hold and lift). It runs through a pure reducer in core: `page → lifting → gl → landing`. The page lets go when the canvas has drawn a capture taken after the lift and every incoming presenter has its presentation receipt (#25, #65, #68). A request that arrives mid-crossing reverses the crossing; it never skips a phase. Someone draws in every phase, which `tests/conformance/transfer/crossing` pins. The binding collects receipts, advances the reducer once per rendered frame, and publishes each swap as one React commit.

A source never exists without its content. `surfaceSourceHost.tsx` creates and fills the capture container in the same commit that arms capture, because an empty container issues receipts for a blank card.

<a id="29"></a>

## #29 — Presentation is exclusive, and drawing is inclusive

`crossingDraws(phase)` says who must draw, and more than one side may. During `lifting` both sides draw, because the canvas earns its receipts then. `crossingPresentation(phase)` says who may be seen, and exactly one side is composited in every phase. Visibility changes hands only at the two swap edges. A consumer ties canvas visibility to this law, never to mount: an unmounted canvas cannot draw, and an uncomposited canvas still can. A canvas composited early covers a page element that is still moving.

<a id="30"></a>

## #30 — Carried motion crosses mid-flight

Motion whose source of truth lives outside both renderers keeps running through a crossing. `createMotionCarrier` gives it one clock, one program, one evaluation per frame, and any number of readers. Sampling never advances time, so the page style write and the mesh transform read the same value in the same frame. `useCarriedMotion` owns the animation-frame driver and the page-side writer. The mesh reads `sample()` in `useFrame` at full value, never scaled by lift progress. Carried motion runs on the main thread instead of the compositor, so a scene declares each one explicitly. `tests/conformance/transfer/motionCarrier` pins the carrier.

<a id="31"></a>

## #31 — Hold, handoff and lift are the vocabulary, and choreography is a function of progress

A renderer holds the pixels. A handoff moves the hold, at the swap edges. The trip from page to scene and back is a lift, with phases `page`, `lifting`, `gl` and `landing`.

A scene scripts a transition as pure functions of the lift's progress, never as timelines. `crossingRange(progress, from, distance)` is a clamped linear window, shaped like drei's `useScroll().range`. `crossingCurve(progress, from, distance)` is the sine bell over the same window, for effects that exist only mid-lift. The handle exposes both as `range()` and `curve()`. Every window composes with the eased progress, so a choreographed effect is zero, with zero velocity, at both handoff edges. `tests/conformance/transfer/choreography` pins this.

<a id="61"></a>

## #61 — A handoff works without `moveBefore`

A handoff moves the same node between the page and the capture host, so the content keeps its state. `moveRetained` in `retainedMove.ts` uses `moveBefore` where the browser has it. Without it, `moveRetained` saves focus, the text selection and every scroll offset, reparents with `insertBefore`, and restores them. Input values, canvas pixels, `<details>` state and listeners survive a reparent on their own. A running CSS animation restarts, and snapDOM already freezes compositor-only animation (platform.md #22).

`unsupportedSnapshot` refuses content holding `iframe`, `video`, `audio`, `object` or `embed`, because a reparent reloads them. Surface never requires `moveBefore`.

<a id="63"></a>

## #63 — Preparation borrows the live node only for a caret

Preparation runs before a handoff, while the page still presents. It moves the live node over the page copy only when focus is inside the node or a selection intersects it. The capture then shows the real caret and selection. The borrowed node shows its capture through the native input rig, and an inert clone holds its layout. A host that receives hits always paints on both engines, so preparation substitutes the node fully or not at all. Otherwise the node stays where the author put it, and the capture reads a copy that `snapshot` keeps equal in markup, field values, checked state, scroll and hover, active and focus-visible twins.

Preparation also requires the page copy to be visible by computed style (`checkVisibility` with visibility and opacity), so a scene that hides its own copy never sees the node flash. The crossing itself takes the live node unconditionally. Owners are `Surface.tsx`, `gate:genie-restore-flash` and `probe:api-preparation`.

<a id="65"></a>

## #65 — A lift releases the page only onto pixels read after the lift began

On the page-to-lifting edge, the store asks each part's source for an immediate capture with `repaint({ immediate: true })`. Each paint carries `read`, the order in which its raster read the DOM. The lift stays closed until every part uploads a paint whose `read` is at or past `nextRead()` from that request. `CrossingEvidence.contentCurrent` carries this to the kernel law. Readiness keeps its own meaning: pixels exist.

`CURRENT_CAPTURE_WAIT_MS` bounds the wait at 500 ms, about ten times a measured capture of 30 ms, so a source that stops answering cannot hold a crossing open. Replacing one part's source resets only that part's read floor.

<a id="66"></a>

## #66 — Declarative motion stands still while a canvas holds the content

While a canvas holds a Surface's content, the content's CSS animations, CSS transitions and Web Animations pause, and they resume where they stopped. A `live` source is exempt. The store pauses motion on the page-to-lifting edge, before it requests the capture, and resumes it only when the page holds the content again.

`holdMotion` and `releaseMotion` in core pause and resume every animation under both the live root and the capture root. `matchMotion` puts each copy at its original's pose after insertion. Each part owns its own pause. A consumer's own `requestAnimationFrame` loop or `<video>` is outside it (#67).

<a id="67"></a>

## #67 — Consumer clocks stop on `onFreezeChange`, before the capture

`onFreezeChange(frozen)` and `useFreezeSurface()` report the motion pause of #66. They turn on at the lift's first frame, before the requested capture, and off when the page holds the content again, including after an abandoned lift. A Surface whose every part is `live` never freezes. A consumer with its own clock, such as an animation-frame loop, a timer or a `<video>`, stops it on this signal. `onPresentationChange` fires after the capture, which is too late. The name is "freeze" because "hold" already means the renderer hold.

<a id="68"></a>

## #68 — A crossing waits for evidence, not for time

`Surface`, `Surface.Root` and `SceneSurface.Root` take no `timing`. The page lets go on the frame the scene has drawn a capture taken after the lift. Without a driver, the progress ramp is a step. There is no dwell, because #66 pauses motion on the lift's first frame and a wait would only hold still content longer. A pending capture keeps frames coming until its 500 ms bound (#65).

Motion outside the captured content rides a carrier that the page and the mesh both read (#30, `logoMotion.ts`). A lift test that needs a window holds the lift with a declared part whose presenter arrives late.
