# React API improvement plan

**Status: proposed, 2026-10-05. Runtime work is unbuilt.**

Improve ordinary React authoring by preserving application context, making capture
updates explicit, and keeping frame metadata consistent with displayed pixels.
Give the flat Surface helpers explicit input choices and source transparency.
Keep custom scene policy in the scene.

This plan targets the public entries in `packages/react`. The source baseline is
commit `9073983` on `pkp/browser-gate-recording`. Recheck the checkout before
implementation. Existing unrelated documentation work belongs to its current
owners.

A Surface is retained HTML whose page and scene presentations exchange ownership
of display and input. A SceneSurface is HTML authored for a scene. A capture
supplies pixels while leaving presentation policy to its consumer. Keep these
three relationships and the controlled `inScene` request.

The implementation continues to distinguish author intent, capture capability,
renderer availability, preparation, accepted presentation, and motion completion.
An unavailable renderer preserves native content and author intent. Application
code owns the business outcome of a gesture.

| Current behavior | Evidence and limit | Planned response |
|---|---|---|
| Transported content inherits host context and loses declaration-local providers. | [Scene transport](../packages/react/src/primitives/Surface.tsx), [HTML transport](../packages/react/src/primitives/surface/surfaceSourceHost.tsx). React registry probes confirmed both directions, including the R3F bridge dependency. | Preserve local application context at both transports. |
| Flat helpers hardcode relay input and opaque alpha. | [Helper composition](../packages/react/src/primitives/Surface.tsx), [mesh policy](../packages/react/src/primitives/surface/SurfaceMesh.tsx). Select cycling and blending policy are source-backed. The native rig has no scene-occlusion condition. | Expose narrow overrides, keep native routing opt-in, and verify source alpha before changing its default. |
| Non-live sources intentionally hold unsolicited updates on both engines. | [Decision #64](decisions.md#64), [shared laws](../tests/conformance/paint/captureEngines.test.ts). A binding probe confirmed the policy. | Preserve the policy, correct its documentation, and add discrete refresh to captures and Surface sources. |
| Asynchronous capture can attach current layout anchors to an older raster. | [Capture publication](../packages/react/src/primitives/capture.tsx), [snapDOM frame split](../packages/react/src/snapdom.ts). A deferred raster probe demonstrated ordering, not real snapDOM pixels. | Carry anchors from the captured snapshot. |
| Anchor dimensions are source fractions but are described as geometry-local sizes. | [Anchor contract and calculation](../packages/react/src/primitives/surface/SurfaceAnchor.tsx). Default unit-plane callers work; custom geometry has a different unit scale. | Remove the redundant fields and use the existing UV rectangle. |
| Capture support remains true when renderer creation fails. | [Support reads](../packages/react/src/primitives/surface/surfaceSupport.ts), [Surface observations](../packages/react/src/primitives/surface/surfaceStatus.ts). Scene-only Surfaces do not mount after that failure. | Publish host lifecycle outside scene children and derive Surface observations from it. |
| Generic Canvas defaults preserve ordinary R3F interaction and continuous animation. | [Canvas owner](../packages/react/src/primitives/surface/SurfaceCanvas.tsx). Flight and Controls require continuing frames. | Keep those defaults. Teach overlay configuration through the existing starter. |
| The installed skill contains the main authoring constraints; full guidance and examples remain outside the artifact. | [Staging](../packages/react/scripts/stage-manifest.mjs), [package guidance stage](agent-system-plan.md#p1-version-local-package-guidance). npm website link rendering has not been verified. | Complete version-local guidance through the existing P1 work. |

**Recommended interface changes.** The following names and defaults are proposals,
not available APIs.

| Interface | Proposed change | Reason |
|---|---|---|
| `Surface` and `SceneSurface` | Add `alpha` and `pointerRoute` using the Mesh types. Keep `pointerRoute="relay"`; target `alpha="source"` after pixel acceptance. | Explicit native routing avoids a new occlusion regression. Flat content can select input and blending without compound composition. |
| `SceneSurface` | Accept the existing `SurfaceIdentityProps` union. | An explicit handle gives a flat label access to refresh without adding another hook or losing identity validation. |
| `Surface.Mesh` | Keep explicit mesh policies and current defaults during this work. | Custom geometry and scene event handlers have requirements the helper does not have. |
| `CaptureHandle` | Add stable `refresh(): void`. | Both authored content and attached native elements need a discrete update operation. |
| `SurfaceHandle` | Add stable `refresh(part?: SurfacePartId): void`. | Surface and SceneSurface sources need the same discrete update choice while retaining their presentation identity. |
| `SurfaceAnchorBox` | Remove `width` and `height`. Keep `cssWidth`, `cssHeight`, and `uv`. | UV spans already describe normalized size. A source fraction cannot promise a size on arbitrary deformed geometry. |
| `CaptureFrame.anchors` | Allow `null` when snapshot correspondence cannot be established. | Unknown anchor geometry differs from a coherent snapshot containing no named anchors. |
| Global capability functions | Replace `supportsSurfaces` and `useSurfaceSupport` with `supportsCapture` and `useCaptureSupport`. | The names should describe the capture capability they measure. |
| `SurfaceStatus` | Add one discriminated `renderer` snapshot. | A known renderer failure must be distinguishable from normal startup and preparation. |
| `SurfaceCanvas` | Add `onRendererStatusChange(status)`. | The host must report startup failure even when its scene children never mount. |

Keep identities, frame getters, compound composition, and the custom material
slot. Add the two presentation overrides and SceneSurface identity parity in this scope.
Geometry, material, and general R3F prop bags remain on Mesh. Full helper prop
parity is not a prerequisite for these improvements.

## Work packages

**1. Align current guidance with the implemented capture law.**

Correct the README and the `SurfaceHTMLProps.live` documentation. Both capture
engines honor `live`. Without it, unsolicited changes hold their last capture;
user input and the documented layout, resource, and explicit refresh reasons can
request another paint. Continuous motion remains a separate author choice.

Update the support documentation to describe capture capability precisely. The
guide should use global capability to decide whether capture can be attempted.
Explain that the current global check does not establish renderer health or
element eligibility. Document the current startup-failure observation gap using
available names. A missing host or ordinary preparation is a waiting condition.
The new renderer-status recipe belongs with work package 7. New refresh examples
belong with work package 4; neither is required for this independent correction.

Owners: [README](../README.md), [Surface props](../packages/react/src/primitives/Surface.tsx),
[support documentation](../packages/react/src/primitives/surface/surfaceSupport.ts),
[authoring guide](authoring.md), and [Munari skill](../.agents/skills/munari/SKILL.md).
Check the staged copies after the next package build. Amend decisions only when
the supported behavior changes.

Acceptance: the current guide, public prop documentation, skill, and implemented
source laws agree about both engines. Current examples use available names until
their migration lands. This documentation work can proceed independently.

**2. Preserve declaration-local application context.**

Forward application providers surrounding each declaration across inward
`Surface.Scene`, directly tunneled `Surface.Mesh`, and outward HTML transport.
The nearest local override wins.
Providers included in the transported subtree retain their ordinary React
semantics. Munari identity, part selection, and destination renderer context
remain owned by their existing modules.

Reserve Munari's identity, content, host, part, instance, tunnel, material, frame,
anchor, and focus contexts. Reserve R3F's public store context and the context
bridge's provider plumbing. Reinstall the required Surface scopes through their
existing owners. An outward HTML child must see page wiring, even if its source
was declared in the scene.

| Reserved scope | Current context identities |
|---|---|
| Identity and location | `SurfaceContentContext`, `SurfaceRootContext`, `SurfaceHandleContext`, `SurfaceHostContext`, `SurfacePartContext`, `SurfaceInstanceContext`, `SurfaceTunnelContext` |
| Presenter data | `SurfaceMaterialContext`, `SurfaceFrameContext`, `SurfaceAnchorContext`, `SurfaceAnchorBoxContext`, FrameSurface's `SurfaceContext` |
| Scene focus | `FocusSceneContext`, `FocusGroupContext` |
| Renderer and bridge | R3F's public `context`; provider plumbing identified at the adapter through supported APIs |

Focus membership follows the actual destination's focus ancestry and camera. A provider
surrounding the declaration must not register transported geometry in another
canvas's focus group. Compose the existing `FocusScene` and `FocusGroup` in the
destination scene subtree. A separated scene contribution can stand inside an
existing focus manager; a transported contribution can contain its own explicit
scope. A group alone cannot supply a missing focus manager. Providers inside the
transported children still execute normally. Application theme, router, and data
contexts remain forwardable.

Keep the reserved identities in one private policy shared by both directions.
Obtain renderer plumbing identities at the renderer adapter using supported
exports and context capture. Do not identify contexts by debug names or inspect
their values for private Fiber shapes. If supported APIs cannot establish this
filter, the bridge experiment fails before dependency adoption.

Start with one disposable experiment using the public context bridge exported by
`its-fine`, which the installed R3F already uses. React's public context APIs do
not enumerate arbitrary ancestor providers. Explicitly recreating providers in
each consumer would spread that obligation across callers. If the experiment
passes, declare a direct binding dependency and keep the forwarding machinery
private. Core retains zero runtime dependencies. Application authors should not
need a new provider or context list.

Munari must install a `FiberProvider` from its own dependency copy around every
context-capture hook in both trees. The bridge must use that same copy. R3F's
provider cannot satisfy this requirement accidentally. These wrappers belong to
the binding and preserve the existing retained child and registration keys.

Package the helper explicitly and verify compatible React peer ranges. The
recommended build bundles this binding dependency and keeps React and R3F
external. Changing `packages/react/tsdown.config.ts` to include the helper needs
specific package-build approval. The workspace must not rely on R3F's transitive
installation to make the published package work.

The experiment must cover live value updates, provider insertion and removal,
memoized readers, Strict Mode, SSR hydration, and an abandoned Suspense render.
A destination must observe committed provider values. Stable transport identity
must retain local state, an uncontrolled input, focus, and selection across
ordinary provider updates.

Owners: [SceneContribution](../packages/react/src/primitives/Surface.tsx),
[direct Mesh transport](../packages/react/src/primitives/surface/SurfaceMesh.tsx),
[source host](../packages/react/src/primitives/surface/surfaceSourceHost.tsx), and
[Canvas transports](../packages/react/src/primitives/surface/SurfaceCanvas.tsx).
Concentrate bridge policy in one private binding module shared by both directions.
Use supported dependency exports; direct private Fiber traversal would create an
additional React compatibility obligation.

Run this experiment against a packed candidate build before accepting the bridge.
Use an isolated consumer without workspace symlinks or hoisted undeclared
dependencies. Inspect emitted bare import specifiers and compare them with the
published dependency and peer declarations. A bundled error string containing
`its-fine` is not an import and must not fail that check. These artifact checks
share the package-tooling approval requirement.

Acceptance: page-local and scene-local providers reach their transported readers;
shared host providers and providers within the children still work. Provider
value updates do not recreate Surface identity, source ownership, or retained
content. Provider topology changes follow the declaring React tree's lifetime.
Test nested Surfaces in outward HTML, direct Mesh transport, destination focus
membership, and independent canvases with different application providers. An
ordinary context update must not add or remove a renderer-scope provider.
If the dependency cannot meet commit and identity requirements, stop this package
at the experiment and record the exact dependency requirement before selecting
another implementation.

**3. Give flat helpers explicit input and alpha policy.**

Add the two typed overrides and pass them to the helper's own Mesh. Keep source,
identity, callbacks, and timing with their current owners. Keep relay as the input
default on both helpers and Mesh. Target source alpha only after the material
checks pass. Reuse `SurfaceIdentityProps` for the SceneSurface shorthand so callers
can supply its existing handle for discrete refresh.

Native routing is eligible only on a supported engine and known geometry with
one interactive pose. `auto` can still select relay. Document that limit. Leave
the compound Mesh default in place because native routing bypasses its authored
scene pointer handlers. Custom scene authors retain that choice.

Check a flat form with a select, text input, checkbox, and selectable text. A
native click must not cycle a select's value. Use trusted delivery and actual
native selection as evidence. Verify return to the page on the same retained
instance. Separately check relay under snapDOM and unsupported geometry. A relay
fallback must not be described as native control parity.

Characterize native routing with an interactive scene mesh covering half the
panel. The native rig is above the canvas and currently lacks an occlusion
condition, so trusted HTML delivery alone cannot prove correct target ownership.
Check clicks, hover, and a stationary pointer while the foreground object moves.
Verify the cursor visibly in a headed browser; the current automated gate does
not observe its glyph.

This implementation keeps native input opt-in. The guide recommends it for
eligible frontmost panels and explains the foreground-object limitation. Use
relay when scene objects must own overlapping input. A future native-default
change requires a separately reviewed, measured occlusion solution. This work
adds no speculative renderer or compositor to manufacture that guarantee.

Source alpha requires a separate pixel comparison. Compare translucent panels,
antialiased text edges, fully transparent holes, and rounded corners with native
HTML over light, dark, and colored backgrounds. Include overlapping captured
meshes and an ordinary opaque scene object. Check depth ordering and occlusion
from both cameras already supported by the binding.

The default material's premultiplied sampling must be correct before the new
alpha default ships. Reuse the existing material and encoded-texture helpers if
sampling needs repair. Merely enabling `transparent` is not acceptance evidence.
Keep shader, blend, and depth policies with the material owner.

Target premultiplied blending and enabled depth testing for the built-in material.
Measure `depthWrite=false` for source-alpha compositing and adopt it if the
reference scenes confirm the expected ordering. Keep depth writing for explicit
opaque content. Custom materials retain their authored transparency and depth
flags. The overlap fixture must state the intended order and compare its actual
pixels. Three's object sorting remains in force; arbitrary intersecting
transparency and CSS stacking parity are outside this helper's guarantee.

Measure forward and reverse handoffs of translucent content, including reversal
during preparation. The pixel oracle must detect doubled coverage and uncovered
frames using deliberate faults. Derive its budget from the native panel reference;
the existing shadow budget is a different measurement. Run before-and-after pixel
and input checks on Controls, which already uses the built-in source-alpha
material. Preserve its hardware, captured edges, and depth ordering after any
sampling or depth-write repair.

Owners: [flat helpers](../packages/react/src/primitives/Surface.tsx),
[Mesh](../packages/react/src/primitives/surface/SurfaceMesh.tsx),
[materials](../packages/react/src/primitives/surface/surfaceMaterials.tsx), and
[encoded sampling](../packages/react/src/primitives/surface/surfaceLitTexture.ts).
Extend the existing native-input and API composition fixtures. Preserve current
pixel thresholds until a measurement and decision establish a changed contract.

Acceptance: eligible helper inputs use native behavior; unsupported routes remain
explicit when authors select `auto`. Default relay does not claim native picker
or selection parity. Foreground input and cursor observations document the native
route's limits. Fractional alpha matches the native reference within a measured budget.
Existing opaque content, scene handlers, and custom materials retain their
intended behavior. The defined overlap scenes preserve their expected ordering.
Translucent handoffs and existing source-alpha consumers pass their measured
checks. If alpha acceptance fails, land the explicit override and complete the
material fix before changing that default.

**4. Add discrete refresh to captures and Surface sources.**

Use the current source owner's refresh operation. An attached-element refresh
rebuilds its visual copy and then requests a paint. An authored-content refresh
requests a paint of its current root. Keep one public operation for both inputs.
Remove the element hook's separate `refresh` override once the common operation
owns dispatch. Preserve its `ref` and `getBounds` attachment members.

Add `SurfaceHandle.refresh(part?: SurfacePartId): void` to the existing identity.
An omitted part refreshes all sources declared on that Surface at the call.
A named part refreshes only that source. An absent part is a no-op and creates
no request for a future declaration. Surface and SceneSurface share this method;
the SceneSurface shorthand accepts `surface` or `name` through their existing
mutually exclusive identity type.

A page-owned Surface source rebuilds its current visual copy before repainting.
A scene-held source repaints the retained node. Register this operation with the
HTML owner, rather than bypassing it through the runtime's rasterizer. Refresh
changes no author intent, presentation, progress, motion driver, or readiness.
Each part publishes its own coherent frame; refreshing several parts does not
promise a simultaneous presentation of their updates.

The method returns no receipt. A request is not a completed capture. The latest
frame remains readable while another capture is pending. Multiple requests in one
turn coalesce. A request during an active raster schedules one bounded follow-up.
The call leaves `live` and the animation freeze policy unchanged.

Calling refresh with no source attachment or an unavailable capture engine is a
harmless no-op. The first capture reads its current committed content. Requests
belong to the current source lifetime; disposal or replacement cancels them.
A stable handle dispatches to the current owner and never resurrects an old source.

An element attachment owns refresh until detachment or unmount. Its paint
connection is a subordinate resource. Keep the retry callback registered while
content is unsupported or the element has no measurable area. Refresh retries
copying, validation, measurement, and connection creation. Disposing a connection
must not remove that callback. Removing unsupported content from a fixed-size
element must recover after refresh without a resize or native input event.

Refresh reads committed source content. For scene-authored HTML, the R3F commit
publishes children to the outward DOM transport; that publication alone is not a
DOM commit. Track the latest publication, its DOM acknowledgement, and one pending
refresh in the existing source owner. The portal-side component acknowledges its
actual commit. Fulfill the request after the corresponding content commits.
Ignore obsolete acknowledgements and cancel waiting requests on owner replacement.
Waiting for that commit must not retain continuous renderer work claims.

This covers refresh after the authoring tree commits its update. A later child
state change, deferred transition, or resolved suspended result needs another
refresh. Add no public promise, commit hook, request token, or scheduler.

Proposed use:

```tsx
const capture = useCaptureHandle()
useLayoutEffect(() => capture.refresh(), [capture, label])

return (
  <CaptureContent capture={capture} size={[240, 80]}>
    <Label value={label} />
  </CaptureContent>
)
```

For a scene-authored label, use the existing Surface identity:

```tsx
const surface = useSurfaceHandle()
useLayoutEffect(() => surface.refresh(), [surface, label])

return (
  <SceneSurface surface={surface} size={[240, 80]}>
    <Label value={label} />
  </SceneSurface>
)
```

Owners: [capture identity and connection](../packages/react/src/primitives/capture.tsx),
[element capture](../packages/react/src/primitives/elementCapture.tsx), and the
existing source repaint path. Surface refresh also belongs to
[Surface identity](../packages/react/src/primitives/surface/surfaceHandle.ts),
[HTML ownership](../packages/react/src/primitives/Surface.tsx),
[source ownership](../packages/react/src/primitives/surface/surfaceSourceHost.tsx), and
[outward content commits](../packages/react/src/primitives/surface/surfaceOutwardContent.tsx).
Keep the shared `live` law intact.

Acceptance: a committed DOM change becomes visible in captured pixels after
refresh on both engines. The capture returns to zero idle paints. Source
replacement, pending raster completion, multiple readers, and repeated unmounts
preserve ownership. With `live=false`, subsequent unsolicited changes do not
update the capture. Refresh leaves the Surface motion-freeze policy unchanged.
Test a same-size SceneSurface label update while the outward DOM commit is
delayed. An older acknowledgement must not fulfill a newer publication's request.
Test named-part refresh, refresh of all parts, and removal of one pending part.
Recover an attached element after unsupported content is removed and after it
gains a measurable area. Test these paths independently on both engines.

**5. Publish anchors from the captured snapshot.**

Associate anchor rectangles with the actual snapshot used for each raster. The
identity includes the source lifetime, read, and completed generation. Express
rectangles in CSS pixels relative to the captured root, independent of its
viewport pose and display density.

Keep CSS rectangles as the sole public `CaptureFrame` anchor format. They share
units with its width and height and use a top-left origin, X rightward, and Y
downward. Surface anchor scopes derive their existing `SourceUvRect` from these
rectangles and the same captured size. Keep conversion where captured layout
becomes texture placement. Publish no second map or conversion API for Plume alone.

For native HTML-in-canvas, collect geometry at the synchronous draw transaction.
For snapDOM, use its supported clone/render hooks to obtain rectangles from the
final reconciled snapshot. The detached clone is not measurable by a plain layout
read. Check the final clone's existing layout reconciliation before adding a
separate layout pass. Measuring live DOM before the asynchronous call or in
`afterClone` does not establish snapshot correspondence.

Carry the captured image, its actual CSS size, and its anchor metadata together
through one concrete raster result and its immutable paint receipt. snapDOM's
render stage can consult root geometry after cloning, so pre-call size is not
sufficient evidence. Check metadata reuse under memoized captures and density-only
carry-forward. Keep the borrowed public texture and frame getter.

Publish `anchors: null` if correspondence cannot be established. An empty map
means a coherent snapshot contains no named anchors. Duplicate names invalidate
the anchor map. Valid pixels remain available even when anchors are unavailable.
Never retain earlier anchors beside a newer texture generation. A capture with
changes during its asynchronous read can still publish coherent old pixels and
their own old anchors. Discarding every such frame would starve a continuously
changing source.

Change Plume and any other frame-anchor readers to wait for coherent required
keys. Replace the presenter's live-DOM collection with the same recorded snapshot
measurement. Shared sources use one snapshot; each presenter still owns promotion
to the generation it actually draws.

Owners: [capture publication](../packages/react/src/primitives/capture.tsx),
[rasterized source](../packages/core/src/paint/rasterizedSource.ts),
[native source](../packages/core/src/paint/htmlInCanvas.ts),
[paint receipt and canvas owner](../packages/core/src/paint/domTextureSource.ts),
[snapDOM binding](../packages/react/src/snapdom.ts), and
[presenter anchor scope](../packages/react/src/primitives/surface/surfaceAnchorScope.ts).

Acceptance: a real snapDOM capture delayed after cloning keeps anchors with the
frozen raster while live layout changes. Replacement and resize cannot publish
old-lifetime metadata. Test transforms, duplicate names, and continuous motion.
A deliberate live-layout measurement must fail the oracle. Native measurements
must pass independently. Include a rendered `Surface.Anchor` child under a
delayed snapDOM raster and compare its placement with the marker in the delivered
pixels. Repeat during resize and with a posed native host.

Normal supported snapDOM must provide the required coherent anchors and Plume
must actually release its ink. Permanent `null` metadata cannot satisfy that
acceptance. Temporary unknown metadata withholds dependent geometry; recovery
must resume the requested effect without mismatched pixels. If snapshot geometry
is unavailable, keep native content usable and mark the enhancement incomplete.
An intermediate nullable type may land, but the feature remains unfinished until
its supported consumer flows pass.

**6. Correct the anchor dimension interface.**

Remove `width` and `height` from `SurfaceAnchorBox`. Preserve the recorded CSS
dimensions and `uv`, the normalized texture rectangle from the painted snapshot.
Its U axis runs left to right and V axis runs bottom to top. Compute normalized
size from `uv.uMax - uv.uMin` and `uv.vMax - uv.vMin`. Position continues to sample
the presenter's actual geometry.

This is the smallest defined contract across custom and deformed geometry. A
single width and height on a curved UV patch need a chosen geometric metric;
this plan does not introduce one. Unit-plane hardware uses UV spans. Pixel-unit
hardware uses CSS sizes. Other geometry owns its conversion. An eight-unit-wide
plane uses eight times the U span. This also removes the current calculation's
dependence on a newer part size during resize.

Migrate Controls to the painted UV spans and inspect Knobs' CSS-size usage.
Update the public type, doc comments, examples, and decision entry together.
Remove the old fields in the same change, with no compatibility aliases.

Owners: [Anchor](../packages/react/src/primitives/surface/SurfaceAnchor.tsx),
[Controls](../apps/lab/src/scenes/controls/Controls.tsx), and
[Knobs](../apps/lab/src/scenes/knobs/Knobs.tsx).

Acceptance: unit-plane, non-unit-plane, and deformed-geometry examples use the
painted UV rectangle and explicit scene units correctly. Controls hardware keeps
its size. Knobs continues to use its pixel units. Continuous resizing must not
combine old captured boxes with a new part size. Anchor position and generation
checks remain intact.

**7. Expose renderer lifecycle and known startup failure.**

Rename the global checks to describe capture capability. Publish the renderer
snapshot from the existing host through the page-side SurfaceCanvas. Add
`onRendererStatusChange` using that snapshot and derive `SurfaceStatus.renderer`
through the existing Root subscription. The [WebGPU migration lifecycle
contract](webgpu-migration-spec.md#renderer-lifecycle) owns the shared proposed
`SurfaceRendererStatus` shape, callback, renderer/backend observations, and
attempt/ownership rules. This work consumes that contract rather than defining
a second union. Implemented public types become current authority when it lands.

`unmounted` covers an absent host. `starting` covers a mounted host whose renderer
is awaiting usable layout or being created. A zero-sized canvas can stay in this
state indefinitely. `ready` establishes a usable renderer, not Surface preparation
or pixel presentation. `context-lost` is recoverable. `error` requires an observed
failure from the current startup attempt. A timeout never converts waiting to
error.

Keep `supported` as capture and content support. Keep `reason` for its current
support meaning. `requestedInScene` survives loss and failure. `sceneReady`
continues to describe source and draw preparation. Derive stable snapshots from
the host lifecycle; avoid a second mutable status registry.

Deliver the initial committed host snapshot and subsequent changes independently
of scene children. A SceneSurface-only canvas must report failure even when its
R3F children never mount. Callback replacement uses the newest callback without
replaying an older transition. Application callback errors retain their normal
error path and must not be classified as renderer startup failures.

First establish the startup-error seam. Installed R3F starts asynchronous
configuration without catching its rejection. A React error boundary alone cannot
observe that failure. A guard around a renderer factory can report an error, but
rethrowing still leaves an uncaught rejection. It can also change how object-form
`gl` options are reapplied.

Compare two single-owner implementations in the bounded startup experiment:
retain R3F Canvas with a supported startup-error seam, or replace the inner Canvas
with R3F's public `createRoot` and catch awaited configuration failures. Evaluate
the public-root replacement before declaring upstream work necessary. A
replacement has one renderer owner. Keep neither a parallel Canvas implementation
nor private R3F code copied into Munari.

The preferred result uses the supported owner with the smallest maintained
implementation that satisfies error and cancellation acceptance. A public-root
replacement must preserve dimension, resize and scroll measurement, event sources
and prefixes, application context, Suspense, refs, accepted props, renderer
factories, object-option updates, restoration, and cleanup. If it requires
substantial duplication of Canvas behavior, choose the supported Canvas seam and
record the exact dependency requirement. Fake renderers and unresolved promises
are rejected because they conceal failure. Host observation can proceed while
startup ownership is evaluated; failure acceptance remains incomplete until the
selected implementation passes.

Each creation attempt needs lifetime protection. A late result cannot change a
replacement host. An established error stops automatic repeated attempts. A
normal keyed Canvas remount retries. Recovery resets preparation evidence and
proves presentation again.

The startup seam must also cancel or clean up successful results that arrive
after unmount. An old R3F root must not render into a detached canvas or restart
its loop. Test resolution after the installed R3F's delayed unmount cleanup has
finished. Dispose resources owned by the canceled attempt while preserving
caller-owned renderer instances. A guard that only protects status is incomplete.

Update the consumer recipe to branch on observed errors when committing a native
business outcome. Use the application's pending-action identity to confirm that
the action is still active and complete it once. A startup error before any
action, or a stale error after cancellation or replacement, commits no business
outcome. Keep that responsibility in application code. `onMotionComplete` fires
only for motion that reaches its actual endpoint. A waiting host and a temporary
context loss do not synthesize completion.

Deliver a known startup error through each associated Surface's existing
`onError` callback once per failure episode. Deduplicate by host attempt and
Surface lifetime. Callback replacement does not replay an old error. Status stays
readable for a Surface that attaches after the failure. Per-Surface callbacks are
a convenience for mounted declarations; the host callback is the public startup
observation for scene-only content.

Owners: [host lifecycle](../packages/react/src/primitives/surface/surfaceHostRegistry.ts),
[Canvas](../packages/react/src/primitives/surface/SurfaceCanvas.tsx),
[Root subscription](../packages/react/src/primitives/surface/SurfaceRoot.tsx),
[status projection](../packages/react/src/primitives/surface/surfaceHandle.ts),
[public status type](../packages/react/src/primitives/surface/surfaceStatus.ts), and
[capability reads](../packages/react/src/primitives/surface/surfaceSupport.ts).

Acceptance: distinguish late mounting, normal preparation, unavailable capture,
creation failure, loss, restoration, and explicit retry. Native content remains
usable. Include a SceneSurface-only canvas, zero-sized and indefinitely pending
startup, callback replacement, and late rejection from an obsolete attempt.
A sample application commits its native outcome once after a known
failure and never commits because preparation is merely pending. Failure before
an action and failure after its cancellation or replacement produce no business
outcome. Unmount and retry leave no renderer work claims, revived detached roots,
leaked owned resources, or uncaught startup errors.

**8. Make the installed guide and examples sufficient.**

Complete [P1](agent-system-plan.md#p1-version-local-package-guidance) using the
existing staging path. Keep that stage as the packaging owner. This plan supplies
the React acceptance requirements; it does not create a parallel packaging system.

Ship the canonical authoring guide and one complete, maintained custom-effect
example. Select or simplify an existing example using only published entries.
Keep its authored home singular. Internal links must resolve inside the packed
artifact. Pin necessary external references to a proven source revision. Record
dirty-build provenance instead of guessing a release tag from the package version.

The first-use guide should cover a native form handoff, a scoped provider, a
discrete authored-capture refresh, a scene-label refresh, host startup observation,
and a custom material. Explain helper defaults,
engine limitations, anchor coordinate units, and the difference between renderer
readiness and Surface presentation. Replace retired names throughout the README,
skill, compile-only examples, lab, registry, and instruments.

Keep the generic Canvas defaults. Use [HomeStarter](../apps/lab/src/scenes/home/HomeStarter.tsx)
as the overlay recipe with explicit `pointerMode="surfaces"` and demand rendering.
Use an existing continuing-motion example to explain when the application needs
frames after the handoff settles. Two settings do not yet justify another public
wrapper or preset.

Owners: [staging](../packages/react/scripts/stage-manifest.mjs),
[README](../README.md), [authoring](authoring.md), [skill](../.agents/skills/munari/SKILL.md),
[public entries](../packages/react/src/index.ts), and [compile-only examples](../tests/surfaceTypes.tsx).
Changing staging or build enforcement requires explicit approval for the named
package-tooling change. This document authorizes no publication or CI change.

Acceptance: install the packed artifact in a temporary consumer with no repository
imports. Its required guide links resolve. Its examples compile and run through
the public entries. The basic form, discrete capture, and custom material work
under their declared capability modes. A SceneSurface-only canvas reports startup
outside its children. Staged files match their canonical sources.

## Delivery and acceptance

Deliver small, reviewable slices. Preserve pending work in other sessions. Recheck
the branch, dirty files, and source baseline before each slice. The context
dependency and R3F startup seam are feasibility decisions, not assumed solutions.

| Slice | Work | Dependency and completion condition |
|---|---|---|
| A | Current guidance correction; packed context experiment; comparison of startup owners; input/alpha reference measurements | Obtain approval for candidate package-build changes before that experiment. Record provider/filter isolation, native input limits, material references, and the selected startup owner. |
| B | Context transport repair | The packed experiment passes same-copy provider, reserved-context, nested composition, identity, and commit checks. |
| C | Capture and Surface refresh; snapshot-anchor publication | Attachment retries and outward commit acknowledgement pass. Nullable metadata may land first, but supported snapshot-anchor and consumer behavior remain incomplete until proven. |
| D | Anchor field correction and complete caller migration | Coordinate contract is explicit; scene hardware remains correct. |
| E | Shorthand overrides, SceneSurface identity parity, and verified source-alpha default | Relay remains the input default. Alpha handoffs, existing material consumers, and defined scene ordering pass. |
| F | Selected startup owner, host callback, derived Surface status, capability rename, and application fallback | Scene-only failure is observable. Waiting/lost states remain recoverable. Startup cancellation, owner compatibility, and action deduplication pass. |
| G | Packed consumer guidance and complete examples | Runtime names are settled and package-tooling approval is granted. |
| H | External-consumer verification and final adversarial review | Required checks and all claimed browser paths have actual observations. |

CPU-only investigations can run in parallel. Browser and GPU checks run serially.
Implementation starts only after a separate implementation request. Package
context-helper build configuration and staging need the named package-tooling
approvals. Any dependency-owner work outside this repository and any later CI or
release change retain their own scope and approval boundaries.

**Permanent coverage must protect a distinct future failure.**

| Behavior | Primary coverage owner | Failure it must catch and current gap |
|---|---|---|
| Local context across transports | Binding tests beside the transport owner and isolated packed consumer | A transport drops a provider, leaks renderer scope, or remounts retained state. Current checks do not cover a bundled provider copy, nested Surfaces, or committed local provider changes. |
| Discrete refresh ownership | Existing capture, element-capture, and Surface transport tests | A failed connection revokes retry, an old DOM acknowledgement fulfils a newer request, or replacement publishes old pixels. Existing coverage does not exercise shared refresh across the source relationships. |
| Snapshot anchor provenance | Shared source laws, binding publication tests, and rendered anchor fixture | A completed raster receives newer anchor geometry. Compare a rendered Surface.Anchor with the marker in delivered pixels and require normal snapDOM Plume release. Current scalar-box checks cannot establish either. |
| Anchor coordinate dimensions | Existing mapping checks and binding anchor checks | A caller treats source fractions as custom-geometry units or mixes a painted box with current part size. Verify scene output and painted UV correspondence; avoid freezing incidental field spellings as the only oracle. |
| Renderer failure and recovery | Host/status tests and existing lifecycle browser fixture | Scene-only failure has no observer, late startup revives a detached root, or waiting completes an action. Add zero-sized startup, callback replacement, canceled attempts, and late factory results. |
| Shorthand input and alpha | Existing native-pointer, capture-engine, and API pixel fixtures | Default input bypasses foreground objects or sampling/depth changes alter translucent handoffs and Controls. Input status does not prove target ownership; static pixels do not prove handoff coverage. |
| Installed guidance | Existing artifact staging and external-consumer checks | A required file is omitted or an example compiles only through workspace access. Structural file identity and package imports are the contract here. |

Extend existing cases before adding a new harness. Retain tests for these supported
contracts, not merely because they fail before a patch. Keep disposable design and
measurement scripts outside the checkout. Remove them before committing runtime
work after their useful assertions reach the owning checks.

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` for the
completed runtime change. Check discovered cases and command exit statuses.
Log long runs to files and inspect the command's own status.

| Browser or artifact check | Relevant acceptance |
|---|---|
| `probe:api-composition-check` and its existing fixture | Both context directions, direct Mesh, nested Surfaces, reserved scopes, focus membership, and retained identity |
| `probe:api-instance-check`, `probe:api-lifecycle`, and `probe:api-contracts` | Scene-only host observation, zero-size waiting, startup/loss/recovery, old attempts, explicit retry, callbacks, and Surface refresh acknowledgement |
| `gate:native-pointer` and `probe:api-native-pointer` | Opt-in trusted input and native controls in supported layouts; default relay foreground ownership; visible cursor inspection remains separate |
| `gate:capture-engines` plus the real captured-snapshot anchor case | Both engines' refresh and attachment recovery, coherent pixels/anchors, a rendered Surface.Anchor, and deliberate stale-geometry controls |
| `gate:idle-zero`, `gate:dom-surface-demand`, and `probe:api-capture-cost` | Quiet captures stop painting; a discrete refresh releases its work; current capture costs remain bounded |
| `probe:sharpness`, `gate:shaders`, and the new cases in an existing API pixel fixture | Translucent panels and handoffs, text edges, rounded roots, defined overlap, Controls, and custom materials |
| `gate:knobs-resize` and `gate:plume` | Correct hardware units, rendered anchors during resize, and actual ink release on normal supported snapDOM |
| Package build and an isolated installed consumer | Same-copy providers, declared bare imports, runtime exports, canonical guidance, example imports, and source provenance |

These commands are the existing owners. Add the new cases to those owners where
they can observe the claimed behavior. A green existing command does not prove a
case it has not discovered. Use `STRICT_CAPABILITY=1` for enhanced-path claims.
Verify a separate no-flag native profile and the installed snapDOM path. Record
browser, renderer, DPR, revision, and observed paths. A skip or incomplete capture
leaves that path unverified.

Use real native references and deliberate faults for pixel and provenance checks.
Keep accepted perceptual budgets with their measurement and decision. Current
state measurements, real pixels, and delivered input remain separate evidence.
Reuse passed checks for unchanged slices; rerun them after relevant changes.

Keep native-occlusion and cursor characterization separate from acceptance of the
opt-in route's supported layouts. A known overlap limitation cannot be counted as
correct native delivery, and a default change cannot rely on that diagnostic.

Finish with an external-consumer trial and an adversarial review of the final
diff. The trial must use the packed package, a local theme provider, an uncontrolled
form, a discrete capture update, and a custom material. Also mount an ordinary
interactive R3F scene using the generic Canvas defaults. Include a refreshed
SceneSurface label and startup observation with scene-only content. The result is complete
when the examples work, known failures are actionable, metadata has honest units
and provenance, and the required checks pass on the paths claimed.

Update this file with each slice's implementation status and acceptance evidence.
Implemented usage belongs in the README and types. Contract changes belong in
their owning tests and decision entries. Keep this document as the delivery plan.
