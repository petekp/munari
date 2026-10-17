# WebGPU migration specification

**Status: S0 is blocked on the observation integration. Runtime cutover is unimplemented.**

Migrate the published binding, lab, and registry to Three's `WebGPURenderer`.
Use one Three Shading Language implementation for its WebGPU and WebGL 2
backends. Retained HTML must keep its content, state, input, and accessibility.
A renderer change must preserve the evidence that permits each handoff.

The default prefers WebGPU and permits Three's WebGL 2 startup fallback.
Legacy `WebGLRenderer` integration and custom GLSL are retired at the final
cutover. Keeping two shader implementations would create two owners for masks,
alpha, deformation, and scene appearance. Forced WebGL 2 remains an acceptance
mode of the new renderer.

This document specifies behavior and release criteria. An unresolved dependency
gate blocks implementation that relies on it and blocks release. It cannot be
replaced with an optimistic callback, an elapsed timeout, or a successful skip.

| Baseline | Recorded value |
| --- | --- |
| Commit and branch | `9073983926173ece04cd307b67892ec952269581`, `pkp/browser-gate-recording` |
| Installed renderer | Three `0.185.1`, Three types `0.185.3` |
| Installed binding | Fiber `9.7.0`, React `19.2.8` |
| Current package | `@petepetrash/munari`, source version `0.3.0` |
| Existing evidence | [Migration investigation](webgpu-migration-investigation.md) |
| Meaning of MUST | Required for the scope's acceptance and final cutover |
| Meaning of pending | Required evidence or implementation does not exist yet |

The investigation proved a first native capture, standard WebGPU copy, and
off-screen node-material draw on Chrome 154 with an Apple Metal adapter.
It did not prove a Surface handoff. It found missing viewport and material
callbacks and a translucent-output mismatch in a naive node material.
That diagnostic is evidence for feasibility, not migration acceptance.

A subsequent real-renderer fault probe exercised the current source and
FrameSurface runtimes. A synchronously rejected copy, asynchronous copy
validation failure, and genuinely tainted caller canvas still produced stamped
upload/draw/presentation records. Counter deltas also counted zero-vertex and
unrelated custom draws; cached bundles rendered without those callbacks.
The harness supplied eligible-pass input and did not mount a full JSX handoff.
These are reproduced signal failures, not proof of a complete DOM transfer.
The source and observations are retained in the diagnostic appendix below.

**Completion means** the package, all routable scenes, both Glass modes, seven
Candidate studies, registry copies, and required acceptance tools meet this
specification. A migrated binding with an unmigrated lab is an intermediate
milestone. A working native GPU path with a broken WebGL 2 fallback is incomplete.

The scope includes renderer-specific types, materials, source uploads, derived
fields, frame receipts, scheduling, loss handling, consumer examples, packaging,
and verification. Core keeps zero runtime dependencies. DOM ownership, physics,
capture engine selection, retained identities, and CPU geometry remain with
their current owners.

The scope excludes a renderer-neutral framework, a new published package,
direct `HTMLTexture` adoption, GPU-only input deformation, general compute
rewrites, new artistic tuning, and unrelated performance repairs. The separate
[React API improvement plan](react-api-improvement-plan.md) remains proposed.
Its context transport, refresh, anchor-field removal, capability rename, and
helper-default changes are not prerequisites for this migration. Renderer
lifecycle work shared by both documents has one owner and one status interface.
This specification owns that shared proposal. Implemented public types become
the current API authority when the work lands.

## Required behavior and interfaces

**1. Renderer selection, types, and ownership**

| Requirement | Contract |
| --- | --- |
| R1 | The default `SurfaceCanvas` constructs and initializes `WebGPURenderer` before Fiber can render. Initialization is asynchronous; subsequent `render()` calls use the supported synchronous renderer API. |
| R2 | Every acceptance run records requested and actual backend. A requested WebGPU run that initializes WebGL 2 cannot pass its WebGPU row. `navigator.gpu` and `isWebGPURenderer` are insufficient backend evidence. |
| R3 | Preserve ordinary `frameloop`, camera, events, shadow policy, native DPR, pointer-mode, and canvas style ownership. Overlay recipes can select demand rendering and Surface-only input. The migration does not impose those defaults on arbitrary scenes. |
| R4 | Override inherited WebGL-specific `gl` typing. Accept supported new-renderer options, a compatible initialized instance, or a synchronous/asynchronous factory returning that renderer. Type `onCreated` with the actual renderer. Reject legacy renderers and unsupported WebGL-only options with a descriptive observed error before preparation. |
| R5 | A default or factory-created renderer is owned by the host/Fiber integration. A supplied instance remains caller-owned. Detach Munari listeners and wrappers from borrowed instances without disposing their devices, textures, or scene resources. A renderer belongs to one live driving root; its actual canvas and event/size mapping must match that host. Factories must return a renderer dedicated to the root. |
| R6 | Use one consistent Three installation and compatible import graph. `three/webgpu` supplies renderer-specific classes and `three/tsl` supplies nodes. Core imports neither. Peers and their subpaths remain external in the package. |

Keep `gl` as the renderer injection point. An additional backend selector prop
is unnecessary. Acceptance can pass `forceWebGL` through the compatible renderer
configuration or factory. Supply a typed `useSurfaceRenderer()` read for custom
consumers if the selected Fiber version still falsely types its store renderer
as WebGL. This hook returns the enclosing compatible renderer and validates its
kind. It does not construct a renderer or establish presentation readiness.

Use a narrow `SurfaceCanvasState` for `onCreated` when necessary. Preserve Fiber
state members and replace only the renderer type. Do not globally weaken Fiber
types, use `any` to conceal incompatibility, or require consumers to repeat casts.

For a supplied initialized instance, adopt `renderer.domElement` as the host's
actual draw, measurement, event, and R3F root canvas. Do not create a second
visible canvas or retarget an initialized context. The caller permits temporary
DOM adoption and remains the renderer/device owner. Record its prior placement;
detach and restore host-owned placement/style changes only while the matching
lease remains current. Cleanup cannot overwrite a newer caller or host change.
Factories use the actual canvas supplied by the chosen host shell.

A factory owns partial resources until it returns or resolves to a valid
renderer object. Rejection before that point must clean up its partial work;
the host cannot dispose an object it never received. Returning/resolving the
object transfers renderer ownership, including a late result accepted only for
cancellation cleanup. A synchronous factory may return an uninitialized object;
the host owns its remaining initialization and cleanup on failure. Validate an
already initialized result without initializing it again. A directly supplied
instance must already be initialized, usable and dedicated to this root. Reject detected duplicate
driving roots. No external root/animation loop driving that instance is a caller
precondition, not a promise of exhaustive detection.

Renderer ownership and native device ownership are separate. Disposing a
factory-created renderer follows Three's ownership of its internally created
device. A device supplied by the caller remains caller-owned. If the binding
creates a native device explicitly, it records and owns that device's cleanup.
Shared-device support must preserve each caller's error/loss subscriptions and
validation scopes; S0 must verify that arrangement or declare it unsupported.

The selected host shell must support this adoption contract. Existing Fiber
Canvas creates its own canvas, so passing it a preinitialized instance does not
by itself satisfy adoption. S0 compares a supported Canvas adoption/startup seam
with public `createRoot` on an owned or adopted canvas. Select one shell after
context, sizing, events, refs, Suspense, options, and cleanup parity pass.

The library owns observation inside plain-Canvas FrameSurface, not the caller's
outer Canvas startup. Its documented recipe must initialize/catch startup at a
supported caller-owned root or use a verified Fiber startup seam. Child callbacks
cannot report a failure that prevented the child from mounting. FrameSurface
reports its own admitted-source/draw failures through `onError(error)`; native
canvas presentation and business fallback remain caller policy.

**2. Lifecycle and failure authority**

<a id="renderer-lifecycle"></a>

Extend the current host lifecycle and project it through `SurfaceStatus.renderer`.
This section owns the proposed `SurfaceRendererStatus` and
`onRendererStatusChange` contracts. Add backend identity only when known.
The proposed public shape is:

```ts
type SurfaceRendererBackend = 'webgpu' | 'webgl2'

type SurfaceRendererStatus =
  | { readonly status: 'unmounted' | 'starting' }
  | { readonly status: 'ready'; readonly backend: SurfaceRendererBackend }
  | { readonly status: 'context-lost'; readonly backend: SurfaceRendererBackend }
  | { readonly status: 'error'; readonly error: Error;
      readonly backend: SurfaceRendererBackend | null }
```

`context-lost` describes loss of the usable renderer, including a WebGPU device.
It does not promise that WebGPU emits a context-restoration event. `ready` means
usable renderer initialization, not capture readiness or accepted presentation.

`SurfaceCanvas.onRendererStatusChange` receives the initial committed host
snapshot and subsequent changes independently of scene children. Replacing the
callback uses the latest callback without replaying an old transition. An
application callback exception retains its normal error path; it is not a
renderer startup failure.
Its proposed prop type is
`onRendererStatusChange?: (status: SurfaceRendererStatus) => void`.

The canonical snapshot belongs in `surfaceHostRegistry.ts`. `SurfaceCanvas.tsx`
owns creation/failure transitions and the callback. `surfaceStatus.ts` owns the
public union, `surfaceHandle.ts` derives associated Surface reads, and `index.ts`
exports the public types. There is no second mutable status registry.

| Requirement | Contract |
| --- | --- |
| L1 | Each mounted host attempt has a unique lifetime. Each usable renderer has a renderer epoch. Cleanup, replacement, retry, and loss invalidate earlier renderer evidence and asynchronous jobs. |
| L2 | `unmounted` means no host; `starting` means a mounted host awaiting usable layout or a real creation attempt. A zero-sized canvas may remain starting. Missing capture, missing parts and slow preparation do not become errors because time passed. |
| L3 | A rejected initialization reaches the host and associated Surfaces' existing `onError` once per failure episode. Callback replacement does not replay it. A Surface attached later can read the failure snapshot. There is no uncaught configure rejection. |
| L4 | A result arriving after cancellation is disposed if owned and cannot install a runtime, render into a detached root, acquire claims, publish status, or resume a loop. Test resolution after Fiber's delayed cleanup, not only immediate unmount. |
| L5 | Loss immediately invalidates pending receipts, releases input ownership, and restores each affected exclusive Surface's retained native presentation when the loss is observed. Hide the invalid scene representation after committing native coverage. Preserve author intent. |
| L6 | Recovery uses an explicit fresh host attempt, normally a keyed Canvas remount. The default performs no automatic retry loop and no silent device-loss switch to a legacy renderer. Fresh preparation and output evidence are required before another handoff. |
| L7 | Capture and material failures are scoped to the affected source/presenter when the renderer remains usable. They reject that evidence and reach its error owner. They do not erase another Surface's valid pixels or stop its work. A fatal renderer failure revokes all presentations on that host. |
| L8 | Waiting work retains the last accepted coherent frame where valid. An established failure of the current representation restores native content where available. Scene-only content uses its declared fallback; no page destination is fabricated. |
| L9 | `supported` and `reason` retain capture/content support meaning. The global capture checks retain their current names and purpose. `requestedInScene` survives failure. `sceneReady` and motion completion remain separate observations. |

Acquire a unique lease for each renderer/host attempt. Detach is idempotent and
identity-checked: an old cleanup cannot restore a method, remove a listener,
delete a root, or unconfigure a canvas now leased to another attempt. Wait for
actual root teardown acknowledgment before reacquiring a borrowed canvas and
renderer. An elapsed cleanup delay is not acknowledgment.

New owned attempts use distinct canvas elements. StrictMode replay on a retained
canvas coalesces its one initialization/root operation or drains it before
starting another. Cancellation must protect context side effects during init
and dispose, not only the returned status. S0 must demonstrate this under both
backends before choosing the shell's retry implementation.

After borrowed renderer/device loss, the caller supplies a fresh initialized,
usable replacement before a new host attempt. Remounting the same lost instance
does not establish recovery. The host does not dispose or recreate caller-owned
devices. Any supported fallback-context restoration must separately pass B10;
it cannot be inferred from a WebGPU device-loss event.

Renderer callbacks cannot complete business actions. A native fallback recipe
uses the application's active-action identity and commits that outcome at most
once. A failure before the action, after cancellation, or from an old attempt
commits no outcome. `onMotionComplete` only reports motion that reached its
endpoint. The host does not convert failure into a successful transition.

Retained state survives renderer retry when its source owner remains mounted.
An explicitly changed Surface key or destroyed scene-owned React root ends its
normal React lifetime. Document stable page/source declarations outside the
keyed renderer when persistence through renderer recreation is required.

**3. Capture, upload, and allocation**

Keep the two capture engines and their separate capability checks. Capture
produces a 2D canvas; renderer integration uploads it. WebGPU availability does
not enable HTML-in-canvas. Native capture keeps its parking canvas and native
input host. snapDOM retains its asynchronous raster and relay limitations.

| Requirement | Contract |
| --- | --- |
| C1 | Preserve live element identity, uncontrolled values, selection, scroll, focus, accessibility ownership, named parts, and page targets through each supported handoff. Capture-only consumers keep native presentation. |
| C2 | Preserve both engines' `live` law, explicit capture reasons, font/image/input updates, and zero idle capture. A backend change does not turn unsolicited updates into continuous capture. |
| C3 | An immutable copy request identifies the exact source, completed paint/frame generation, Three texture/source update versions, dimensions, format, texture view, allocation revision, and renderer epoch at the copy boundary. Acknowledgment reports success, synchronous rejection, asynchronous validation failure, or cancellation for that request. It cannot read a newer `currentFrame()` and attach it to older copied pixels. |
| C4 | Coalesced publications may upload the newest complete generation. Receipts name the actual uploaded generation. Older paint, upload, geometry, and anchor data cannot be combined under a newer label. |
| C5 | A dirty texture, `onUpdate`, or promise resolution alone is not successful-copy evidence. Rejected copies and GPU validation failures produce no accepted upload record. A valid previous allocation must not be relabeled as the new frame. |
| C6 | Resize and mip-count changes reallocate storage through the existing owner. Preserve backing-store density bands, exact settling, DPR/zoom updates, mirroring, filtering, and anisotropy policy. A growing or shrinking source cannot leave stale edges, blank coverage, or old dimensions. |
| C7 | Raw encoded and sRGB views keep independent allocation/version bookkeeping. Lit synchronization runs in a supported draw-preparation callback after raster sizing. It cannot depend on material `onBeforeRender`, which the measured new renderer did not call. |
| C8 | Borrowed captures remain owned by their capture runtime. Material or derived-effect cleanup disposes its own views, snapshots, listeners, and targets, never the borrowed capture texture or caller canvas. |
| C9 | Feature-detect the native capture API used by the supported Chrome versions. Test old and new drawable markup/API forms where supported. Keep this compatibility inside the native capture engine. |

Assign one immutable `copyRequestId` at each native copy invocation. Several
invocations may serve the same source generation/update version; each has its
own identity, allocation and outcome. Retrying creates a new request rather
than changing a completed outcome. Emit one terminal success/failure/cancellation
outcome per invocation. A later successful request can confirm that generation
only against its own valid allocation and live epoch.

Confirmed drawable bytes must remain stable while a candidate copy is being
validated. Stage a candidate allocation, or use a supported mechanism that
guarantees an unvalidated write cannot alter the allocation named by the active
record. A previous record attached to an overwritten texture is not a coherent
frame. Bound staged resources and measure their upload, memory, and handoff cost.
Commit or discard each candidate by its request identity; do not retain two
unbounded upload queues or count a failed candidate as a new frame.

Per source/renderer owner, retain one confirmed allocation set and at most one
in-flight candidate set. Required raw/sRGB views belong to these sets. Keep at
most one newest pending request without a GPU allocation until the candidate
slot is available. Replacement and delayed validation cannot grow a retired
pool. Release owned sets after their work is canceled or safely settled.

Source frames remain sRGB with the declared alpha interpretation. Wider gamut,
HDR capture, and arbitrary external GPU texture formats require a separate
contract. Existing scene HDR lighting/background modes remain in scope.
A producer using `FrameSource` completes its canvas write before
`publish()` and honors that source's fixed format. Writes without publication
are outside the producer contract.

**4. Materials, alpha, and custom shader authoring**

Remove custom GLSL programs and `onBeforeCompile` patches from the final
renderer path. Preserve existing pure laws and tuned values. TSL implementations
must reproduce their supported appearance on both new-renderer backends.

| Requirement | Contract |
| --- | --- |
| M1 | DOM uploads remain premultiplied. Corner coverage scales premultiplied RGB and alpha together. Four CSS corner radii, measured CSS size, mirroring, UV orientation, and current discard behavior remain correct. |
| M2 | Unlit output preserves source appearance and bypasses scene lighting and tone mapping. Its translucent edges and holes match the same native HTML over light, dark, and colored backgrounds within the owning pixel budgets. |
| M3 | Lit sampling filters encoded premultiplied channels, removes alpha safely, then decodes sRGB for lighting. Light, metalness, roughness, emission, transparency, depth, and side retain their supported meaning. Apply source and corner coverage once. |
| M4 | The node graph, blend factors, intermediate buffers, output transfer, and canvas alpha mode form one tested output policy. NodeMaterial's automatic premultiplication cannot apply coverage a second time. Disabling one flag without proving final compositing is not acceptance. |
| M5 | Material values follow the current texture, painted dimensions, and presenter-owned chrome without reconstructing a graph on every paint. Shared materials retain authored color/depth/stencil flags after each pass. |
| M6 | Built-in and custom depth/shadow materials use compatible nodes and matching geometry/discard rules. A visual material port cannot leave a stale WebGL-only depth material. |

Before admitting a managed presenter draw, validate its effective materials.
Reject ShaderMaterial, RawShaderMaterial, unsupported material kinds, and custom
`onBeforeCompile` hooks. Use Three's material-kind markers and hook identity
against the shared `Material.prototype.onBeforeCompile`, not source-string
inspection. Recheck replacements, array/group selection, overrides, depth
materials, and mutation of an existing hook at the admitted draw boundary.

Reject readiness/draw/output evidence for an invalid material. Report a
descriptive error through L7 once per invalid episode and retain/restore valid
native coverage or the declared fallback. The usable shared renderer stays
`ready` and other presenters continue. A compatible replacement needs fresh
evidence. Unrelated scene objects remain under Three's own material contract.

Replace `useSurfaceUniforms`, `SurfaceUniforms`, and `SURFACE_RADIUS_GLSL` with
one public `useSurfaceNodes` authoring helper. The final helper supplies live
presenter-owned size/radius nodes, radius coverage for a supplied UV, encoded
premultiplied sampling, and straight linear sampling for lighting. Name these
sampling domains explicitly. There is no unspecified `color` node.

The material owner MUST also provide working unlit, lit, and custom-output
recipes that apply the chosen output policy. The exact supported Three node
types and output operation are fixed in milestone S0 from composited pixel
evidence. No bulk shader port starts with a guessed alpha/output convention.
The simple diagnostic's transparent readback does not establish native
compositing over backgrounds or blending with ordinary scene objects.

Before comparing candidate policies, the material owner extends the existing
surface-texture fixture with native HTML over light, dark, and colored
backgrounds. Match viewport, DPR, geometry and coverage. Freeze regions,
exclusions, metric and tolerance from independent native-reference repeatability
and legacy cases independently validated against that reference. A known wrong
legacy result cannot define the tolerance. Record the evidence and decision before
candidate results are measured. Reuse a budget only when its observation method
supports this boundary. New budgets require independent measurement too.
Double premultiplication, straight-alpha misuse, incorrect decode/filter order,
and tone-mapped unlit output must fail this oracle. S0 cannot accept an output
policy while this comparison remains unspecified.

Keep the material slot and `useSurfaceTexture`/`useSurfaceTextureOf` source
reads. They return borrowed textures, not a GLSL program contract. Remove the
retired GLSL helper and uniform recipe at the coordinated consumer cutover.
Do not ship permanent parallel GLSL and TSL APIs.

Preserve `FrameSurface`'s existing format policy: premultiplied frame sources
use `material="none"`; the built-in `unlit` and `standard` modes still reject
them. Built-in straight-source `unlit` preserves color, while `standard`
deliberately applies lighting. Expanding this support is separate work.

**5. Draw and output evidence**

A paint names captured pixels. A successful upload names GPU storage containing
those pixels. An encoded draw names a presenter and uploaded inputs. Output
submission names the pass chain submitted to the visible canvas. GPU completion
and recorded compositor pixels are separate observations.

Maintain these facts privately in the binding. Core continues to judge source,
generation, transfer, revision, and lifetime using renderer-free values.

| Record | Required identity and authority |
| --- | --- |
| Upload | Source and generation at copy, format, dimensions, texture view/allocation revision, renderer epoch, and validated copy outcome |
| Draw | Exact presenter/part, Surface lifetime, transfer/preparation epoch, presentation revision, renderer epoch, frame/pass identity, actual draw camera and pose, material/pipeline revision, sampled uploads, write flags, and target attachment |
| Output | Exact submitted output pass and the same-frame input chain connecting each qualifying draw to that output; no renderer loss or rejected work |

Records are immutable observations. Public counters, author intent, guessed
current stamps, arbitrary timeouts, and user-authored booleans cannot mint them.
Do not append redundant GPU objects or mutable renderer state to core receipts.

| Requirement | Contract |
| --- | --- |
| E1 | Preparation can accept the registered visual presenter's real write-free draw with color, depth, and stencil disabled. Warming content contributes no shadow writes. A shadow-only pass, absent pipeline, empty/invalid draw parameters, or zero instances supplies no visual readiness evidence even if object callbacks ran. |
| E2 | Presentation requires a real color-writing draw of every required part and its declared sampled inputs. A proxy, off-screen draw alone, depth/shadow draw, or zero-draw callback cannot release the page. |
| E3 | Automatic presenters, FrameSurface, and manual compositors defer presentation until their qualifying output submission. This includes FrameSurface in an ordinary R3F Canvas using the compatible renderer. A SurfaceCanvas-only fix is incomplete. |
| E4 | An off-screen candidate qualifies only through its actual same-frame composition chain. Clearing/overwriting its target, omitting its sampling pass, or drawing an unrelated scene to the canvas cannot confirm it. Ping-pong targets and multiple output canvases retain separate provenance. |
| E5 | The requirement's transfer, source, presentation revision, Surface lifetime, renderer epoch, and part set must still match at acceptance. A newer generation can satisfy a minimum generation; a different source or epoch cannot. |
| E6 | Discard unused candidates at frame end/start, lost output, failure, source/presenter replacement, changed part set, and renderer teardown. Restoring a valid host does not revive old evidence. |
| E7 | Late asynchronous validation can request a fresh qualifying draw of a validated generation. It cannot turn a previous unsubmitted callback into presentation authority. Ordinary rendering does not await GPU completion each frame. |
| E8 | Queue submission proves submitted eligible work, not arbitrary shader visibility. Shader discard, depth, occlusion, and authored visual effects remain caller policy and need scene pixel evidence. The receipt must not claim per-pixel visibility. |

Concentrate the implementation in the current host/render integration, with
one private, renderer-keyed observation module shared by automatic and manual
paths. SurfaceCanvas and plain-Canvas FrameSurface acquire the same observer.
Reference-count registration and install its wrapper once per renderer.
Capture-only consumers acquire no renderer observer.

This module must distinguish actual copy success, actual nonempty draw encoding,
validation, and output membership. The installed CanvasTexture upload path has
no reliable success/error acknowledgment: its swallowed JavaScript exception
cannot be recovered by an outer GPU error scope. That is a blocker for the
current callback strategy, not proof that an upstream release is the only fix.
The draw/output interface must identify the actual object, effective material,
admitted draw parameters, sampled allocation revisions, attachment and submission.
It must not
depend on production monkey-patching of GPU queue prototypes, private backend
maps, or a maintained second renderer implementation.

S0 compares a supported Three acknowledgment interface with a binding-owned
validated uploader using public `ExternalTexture`. The latter can import native
WebGL/GPU texture handles; its suitability remains unverified. It must prove
public device/context access, both-backend allocation/mipmap/filter/color/state
and ownership parity, borrowed instances, and every consumer's texture contract.
Preserve capture canvases and source semantics whichever route is selected.
Choose one implementation after the comparison; do not maintain both upload
routes. Draw/output observations remain an independent requirement.

`setRenderObjectFunction` and counters are candidates, not assumed authority.
Nested/custom draws and cached bundles cannot count another object's work for
the watched presenter. Refuse detectable unsupported arrangements before they
can issue records: presenter BundleGroup ancestry, unapproved dispatch hooks,
and observed renderer/canvas mismatches. Ordinary unrelated scene objects can
still use compatible renderer features.

Initially support default dispatch, Three's tracked internal output conversion,
and the concrete migrated Munari compositor paths. Custom render-object dispatch,
BundleGroup ancestors containing presenters, raw GPU commands, opaque external
composers, and one renderer driving multiple output canvases are unsupported
unless their observation path passes B2/B3. Raw queue work and opaque external
routing cannot be exhaustively detected through these hooks; document them as
outside the supported contract and refuse uncertified observations. Do not
promise interception or universal detection. Refuse detected bundle use before
its first build. Independent compatible hosts remain supported.
Input declarations express intent; they do not prove output sampling. Track
actual input allocations and target writes in these bounded paths, including
clears, overwrites, and ping-pong revisions. A general render graph is unnecessary.

Manual presenters retain registration and part coverage, but their readiness
and presentation reports must consume binding-issued draw/output observations.
A custom compositor declares the inputs it samples and the output that draws
them. Naked `prove()`/`present()` calls that merely stamp current mutable state
are retired at this cutover. The observer issues an opaque record and verifies
its identity at runtime; copying fields cannot manufacture authority. An opaque
record does not improve a weak observation, so the issuer must meet C3–C5/E1–E4.

Keep the existing factory and method names. The proposed public shape is below;
the types are unavailable until implemented. Callbacks for current pass inputs
and target are evaluated at issue time so ping-pong legs refer to concrete
resources. They declare intent; only matched renderer observations can issue
evidence.

```ts
type SurfacePassInput =
  | { readonly kind: 'part'; readonly surface?: SurfaceHandle;
      readonly part?: SurfacePartId }
  | { readonly kind: 'frame'; readonly source: FrameSource }
  | { readonly kind: 'target'; readonly target: RenderTarget;
      readonly attachment?: number }

interface SurfaceManualPass {
  readonly id: string
  readonly object: Object3D
  readonly inputs: () => readonly SurfacePassInput[]
  readonly target: () => RenderTarget | null
}

interface SurfaceManualRegistration {
  readonly renderer: WebGPURenderer
  readonly parts: readonly SurfacePartId[]
  readonly passes: readonly SurfaceManualPass[]
  readonly output: string
  readonly onDraw: (record: SurfaceDrawObservation) => void
  readonly onOutput: (record: SurfaceOutputObservation) => void
}

interface SurfaceManualPresenter {
  register(options: SurfaceManualRegistration): () => void
  prove(record: SurfaceDrawObservation): void
  present(record: SurfaceOutputObservation): void
  canvasPresents(): boolean
  hearsPointer(): boolean
  holdsPage(): boolean
}
```

`surfaceManualPresenter(surface, key)` retains its Surface identity. A part
input defaults to that Surface and its unnamed part. A null pass target means
the registered renderer's canvas, including its tracked internal conversion.
`output` selects one declared terminal pass. It must reach that canvas, and its
actual same-frame input chain must include the reported part draws.

Registration acquires the shared observer and binds records to this registration,
issuer, Surface, renderer, source and allocation lifetimes. Every occurrence of
a repeated pass gets an operation identity. Clears, overwrites and ping-pong
revisions cannot be represented by a reused pass ID alone. `prove` accepts only
valid draw records; `present` only valid output records for this registration.
Release retires its observations and callbacks. Copied, foreign or stale records
are rejected. Registration/errors use the existing Surface error owner under L7;
associated renderer status remains in `useSurfaceStatus`. These methods do not
create another motion/transfer controller.

Before S1, S0 freezes the exact declarations, dynamic target/attachment details,
and needed cube-face/mip support. Typecheck direct-output and ping-pong examples
that acquire records, report preparation/output and handle errors. Current
intermediate targets and terminal blits must be expressible without caller
stamps or raw booleans. S5 verifies those already-selected types and recipes in
the packed consumer; it does not design the interface for the first time.

The selected production observation contract and any required supported
dependency changes are a hard S0 exit gate. Compare public integrations first.
If none can meet the contract, record the missing seam and obtain the supported
dependency change before dependent work ships. A package-only fork or an
unreviewed vendor patch is not a completed migration.

**6. Pass coordinates, companions, and input**

| Requirement | Contract |
| --- | --- |
| P1 | `SurfaceRenderFrame.renderTarget` and internal target types use common `RenderTarget`. Normalize active target dimensions, viewport origin/extent in physical pixels, DPR, output destination, camera coordinate system, and target orientation. |
| P2 | Raster alignment and companions read the projection and pose the draw actually uses, including the first frame. Synchronize the backend camera before these reads. Do not substitute logical `getViewport()` values for physical `getCurrentViewport()` values. |
| P3 | Preserve per-pass companion callbacks, including distinct cameras and targets within one display frame. Advance physics in the frame step. Companion callbacks do not advance time again. Restore borrowed matrices and flags on exception. |
| P4 | Preserve native and relay route eligibility, transformed hit regions, focus, caret, selection, pointer capture/cancel, hover/active twins, and overlay click-through. Input follows the accepted presentation, not raw motion or pending GPU work. |
| P5 | Preserve existing CPU-owned interactive deformation and bounds. A TSL warp cannot replace that CPU deformation while keeping its input claim. Preserve existing corrected lens routes and documented approximations. Flight currently bends/crumples in its vertex shader over unchanged CPU plane geometry; port that shader and current input policy. Exact CPU hit geometry for that warp requires a separate explicit design decision. |
| P6 | Camera depth-range, near-plane, viewport offset, zoom, mirrored UV, portal, non-unit geometry, and multiple-host checks must prove real pixels and input. Matrix agreement alone is insufficient. |

**7. Asynchronous scene fields and geometry**

Gallery currently asks Refraction's synchronous `apertureAt()` to choose the
live document under a pointer. WebGPU readback is asynchronous. The synchronous
raycast must read a committed CPU snapshot corresponding to the displayed field.

| Requirement | Refraction/Gallery snapshot contract |
| --- | --- |
| A1 | An active field owns immutable sampled GPU fields and matching CPU arrays. Identity includes logical document identity, source/part, captured generation/content read, `interactionLayoutRevision`, renderer epoch, field revision, target/source sizes, generating tuning, channel/row orientation, and filtering convention. |
| A2 | Build and read a candidate in separate owned resources. Retain/copy sampled input pixels as needed so another capture upload cannot mutate the inputs associated with the active field. Never dispose borrowed source textures. |
| A3 | Read every required field successfully before committing the candidate. Bind its GPU fields and synchronous CPU sampler together during preparation. Publish effective pointer ownership only with the associated submitted pose, motion/aperture sample, camera, and output. |
| A4 | Before the first coherent field, keep the outgoing/native content and its input. Resident content keeps its previous coherent field or its declared loading/fallback. A new aperture cannot appear with an old hit map. |
| A5 | Bound pending work: one active read job and one newest pending request per field owner. Coalesce requests and do not start another same-owner read concurrently. Cancel retired jobs and release owned resources where supported; otherwise reserve their bounded slot until settlement. Rapid replacement cannot create an unbounded retired-job pool. |
| A6 | Ordinary motion can continue on the active field using one submitted pose/aperture snapshot for both pixels and input. Source/tuning/size changes wait for their coherent candidate. Raycasts never await a promise or read live unsubmitted driver values. |
| A7 | Delayed and out-of-order completions after resize, source change, reverse motion, route change, unmount, or device loss cannot overwrite active routing or regain input. Preserve Gallery's currently documented meniscus approximation; do not claim its removal without evidence. |

Normalize the returned readback layout before constructing CPU fields or
contours. The installed WebGPU readback returns rows padded to 256 bytes;
width, component type and channel count determine the packed row length.
Do not index that buffer as a packed image. Exercise a width whose row length
needs padding and a deliberate packed-index fault in the field/contour owner.
A one-pixel diagnostic avoids padding; it does not verify bulk readback handling.

A newer paint of the same logical source/configuration does not automatically
invalidate a complete candidate. Generation `k` may commit atomically while
`k+1` is pending if the source, verified interaction-layout revision, field
configuration, owner, and renderer still match. Unknown revisions cannot compare
equal. Its sampled source pixels and CPU data remain paired
at `k`, and it must satisfy the transfer's minimum generation. Replacement
identity/configuration invalidates work. Once updates stop, the newest complete
generation must become active. Continuous capture cannot starve publication.

`interactionLayoutRevision` names semantic native targets, source-local hit
geometry, clipping/transform/scroll state, and input eligibility. It must change
when targets move, are replaced, or change pointer/disabled/inert eligibility.
Derive it from the same content read as the candidate and verify it against the
live native layout before commit and before continuing to route.

Current paint receipts expose generation, DOM-read identity, sizes and change
count, not this revision. Named anchors are partial and do not cover unnamed
controls. S0 must select a capture-coherent measurement/fingerprint or bounded
scene-owned equivalent for the supported layouts. A matching root/page-target
size, paint generation or anchor map alone does not establish equivalence.

When equivalence cannot be established, leave/restore a valid native presentation
and reject old-field scene routing. For a scene-only source, use its declared
fallback without inventing a page destination. Stable continuously changing
pixels may advance generations without changing a verified layout revision.
The progress guarantee applies while that equivalence is established; safety
does not require routing against unverified moving native geometry.

When document identity or native hit geometry changes, an older field cannot
keep routing into the new document/layout. Keep a valid outgoing/native
presentation while the replacement is prepared. A newer paint with unchanged
interaction layout can continue on the prior coherent field. B12 must exercise
both cases and observe the actual native target, not only a raycast boolean.

A CPU field can replace the readback only if it becomes the shared authoritative
input to both rendering and routing and independent pixels prove equivalence.
Maintaining an unverified second CPU implementation is not an accepted shortcut.

Logo and Wordmark need a separate contour transaction. Tag each asynchronous
alpha/outline job with source generation, glyph/font/style, dimensions, sampling
settings, renderer epoch, and owner lifetime. Each in-flight read owns its
buffer. Apply the same one-active/one-newest-pending queue per letter, cancellation
bound, generation-progress rule, and eventual newest-generation publication.
Retain immutable owned front-image storage alongside the matching contour;
the active image cannot be the mutable borrowed capture canvas/allocation.
Commit front texture, traced wall geometry, bounds, UVs, and pointer
geometry as one matching artifact. Retain the previous coherent artifact or
native glyph until ready. Reject stale jobs and free their owned resources.
No globally reused buffer may be overwritten while another job is reading it.
Include the verified interaction-layout revision when a contour artifact reuses
a native hit route. Other contour jobs retain their glyph/source/geometry keys;
they do not gain an unrelated universal native-layout requirement.

**8. Scheduling, cleanup, and module ownership**

Keep the current counted work claims and one host frame step. One Surface
settling cannot demote another's preparation. An `always` scene remains animated;
an idle demand scene returns to demand. Pending source/field work cannot cause
an unbounded zero-progress GPU loop. Wake for a meaningful completion or the
existing active motion requirement.

Production completes return/removal after a validated final output submission
excludes the removed representation. It does not inspect compositor pixels or
claim browser presentation. B11 separately observes old pixels disappearing and
rejects a suppressed clearing draw.
Detach subscriptions and wrappers in ownership order, discard evidence, stop
owned loops, then dispose owned GPU resources. Compatible caller instances,
canvas frames, DOM elements, and borrowed captures retain their owners.

| Module owner | Responsibilities |
| --- | --- |
| `packages/core` | Pure hold/transfer/receipt laws, source identity, paint/anchor correspondence, input mapping, physics; native capture compatibility stays in its platform module |
| `packages/react` | Renderer observation/lifecycle, uploads and texture views, material/node helpers, compatible target/camera reads, automatic/manual presenter integration, status projection |
| Scene modules | Visual laws, tuned node graphs, derived field/contour transactions, standalone renderer lifetime, scene-specific fallback and business outcomes |
| Registry | Copyable Glass and focus-orbit behavior and maintained file identity; no separate package |
| Instruments | Actual backend selection, diagnostics, pixels, native input, recording validity, and scoped performance evidence |

## Implementation and acceptance

**1. Milestones and dependencies**

S0 is blocked. S1–S6 are pending. Exit evidence names the tested revision,
dependency versions, requested/actual backend, capture engine, and owner.

The current tree passes `npm test`, `npm run typecheck`, `npm run lint`,
and `npm run build`. Vitest discovered 126 files and 1,448 tests.
The retained diagnostic also completed all eight intended cases with valid
setup controls. These checks establish source health and measurement validity.
They do not establish migration acceptance.

| Milestone | Work and owner | Depends on | Exit evidence |
| --- | --- | --- | --- |
| S0 | Compare supported startup/adoption and validated-upload integrations. Freeze manual-compositor types, layout-equivalence measurement, alpha oracle/budgets, staging limits and evidence locations. Owners: binding, materials, instruments. | Baseline investigation | Selected APIs pass binding-fixture B1–B4 and simple canvas/layout controls without later scene ports. Typed direct/ping-pong examples compile. Independent compositing method/tolerance fixed. Required dependency changes identified from the comparison. |
| S1 | Port compatible host types/lifecycle and built-in/node material helper on forced new WebGL 2. Owner: React binding. | S0 | Default, lit, custom material, all named parts, FrameSurface, manual compositor, and source-only fixtures pass without legacy shader support. |
| S2 | Enable actual WebGPU, pass coordinates, and presentation evidence. Owner: React binding/instruments. | S1 | Binding-fixture cases for B1–B11 and B14/B15 pass in X1–X7. Use simple sources, two passes/cameras, caller frames and native controls; this milestone does not depend on later scene shader ports. |
| S3 | Port a postcard, a lit control, Glass composition, and coherent Refraction/Gallery and Logo fields. Owners: their scene modules. | S2 | Real routes pass their scene-owned B5–B15 cases, appearance, input, composition faults, asynchronous stale-job controls, and existing budgets. |
| S4 | Port remaining scenes/helpers/registry and complete new-default selection, legacy removal, and coordinated consumer/API cutover. Owners: consumers and binding. | S3 | All route/study and scene-owned cases pass on both new backends. Registry checks pass. The unpublished branch contains the final default and no production legacy path. |
| S5 | Verify the exact cutover revision, docs/types, packed consumer, minimum peers and required environment profiles. Owners: package, docs, instruments. | S4 | Broad checks and external/platform cases pass on that final source tree and lockfile. Record the packed artifact/content digest and close every release blocker. |
| S6 | Publish or deploy the verified cutover artifact using explicitly authorized existing tooling. Owner: release. | S5 and release authorization | No default or runtime edits occur. The released content matches the tested artifact; deployed smoke and rollback verification complete. |

**S0 execution evidence, 2026-10-05**

The dependency comparison includes installed Three `0.185.1` and stable
Three `0.186.1`, released 2026-09-24. Upgrading alone does not provide immutable
draw results or retrospective native pipeline/binding descriptors. In both
versions `Backend.draw()` returns no outcome and `RenderObject` remains private.
`Inspector.finishRender()` observes a render tail, but does not identify the
qualifying input chain.

The comparison uses the released source for
[Three 0.185.1 Renderer](https://github.com/mrdoob/three.js/blob/2431a09f46f34c560bc8e44b33be0e567723d5b9/src/renderers/common/Renderer.js),
[Three 0.186.1 Renderer](https://github.com/mrdoob/three.js/blob/9b4a2ac29c63ccb43fd51c5661f2f873ac2c39b8/src/renderers/common/Renderer.js),
and its
[private RenderObject](https://github.com/mrdoob/three.js/blob/9b4a2ac29c63ccb43fd51c5661f2f873ac2c39b8/src/renderers/common/RenderObject.js).

| Integration | Observed result | Acceptance limit |
| --- | --- | --- |
| Public Fiber `createRoot` | Four bounded cases passed: owned and synchronous-factory renderers on actual WebGPU and forced new WebGL 2. Owned cases included native clicks, context updates, resize, and teardown acknowledgment before disposal. | This is R3F startup evidence. GPU pixels, complete borrowed teardown, delayed cancellation, caller-device survival, denied initialization and remaining shell parity are unverified. No production shell is selected. |
| Binding-owned uploader with public `ExternalTexture` | Native DOM capture passed on both new backends. Controlled copies preserved premultiplied bytes and distinct raw/sRGB sampling. Bounds, taint and GPU validation faults rejected candidates while retaining confirmed bytes. A changed source replaced its allocation. Uploader disposal left the renderer usable. | The experiment used a CPU Canvas2D mip chain and anisotropy 1. It did not establish production mip generation, performance, coalescing, size/loss races, delayed native validation, or JSX handoff authority. The upload route is feasible but unselected. |
| Native command observation from device creation | Seven WebGPU cases completed on Chrome 154 with Apple Metal. Fresh observation identified actual bound source storage and nonempty commands. Empty and invalid/skipped draws left the blue control intact. An unrelated nested draw stayed green while the watched geometry was empty and supplied no watched-source command. | The experiment tracked instance methods, preserved prototypes, and used no private Three maps. It did not establish visible-canvas output, full composition revisions, asynchronous pipeline coverage, or production lifetime/performance safety. |
| Observation after borrowed-renderer preparation | Before and after attaching the observer, a cached renderer drew the red source. One nonempty command was observed. Its cached pipeline and source binding metadata remained unknown. | Native objects provide no retrospective descriptor API. This route cannot certify the general initialized-instance contract. Unknown records must be refused. |
| Native compositing calibration | Eighteen repeated native comparisons were stable. Uniform, rounded, filtered-bar and source-nonce regions matched exactly. The gradient varied by at most one byte. | The bare legacy material differed by 55–56 bytes in half-alpha interiors and 41 in quarter-alpha interiors. That result cannot set a passing tolerance. No candidate policy or full composite budget is accepted. |
| Manual types and interaction layout | Compile-only direct-output and dynamic ping-pong declarations passed. A bounded HTML layout prototype covers identities, fractional rectangles, scrolling, clipping and eligibility; unsupported geometry returns unknown. | Declarations do not establish observation authority. The layout measurement still needs capture-read-coherent integration. Measuring at completion or matching the start/end layout cannot certify an asynchronous read. |

The startup experiment also identified a cleanup hazard in both Three versions.
Calling `dispose()` on an uninitialized renderer calls the asynchronous
`setAnimationLoop(null)`, which starts `init()`. Three `0.186.1` now awaits
backend disposal, but still leaves that setter unawaited. A disposal-call log
does not prove cancellation cleanup. The eighth retained case reproduced this
on Three `0.185.1`: pre-init disposal started real WebGL 2 initialization, and
the renderer then produced magenta pixels without an explicit `init()` call.
S0 needs a supported cleanup path for
uninitialized, initializing and failed-init owned results.

The public-root prototype also needs a supported context bridge. Its positive
cases used `its-fine`, which is currently only a transitive dependency.
Selecting that shell requires an explicit dependency decision. Compare existing
measurement helpers before adding `react-use-measure`. Fiber partial-configuration
teardown remains unverified; its callback cannot be treated as guaranteed after
an event-manager initializer throws.

The decisive native-command experiment is retained as a
[runnable local diagnostic](../instruments/webgpu-integration/README.md).
Its controlled readback uses a one-pixel region to avoid WebGPU row padding.
These observations are feasibility evidence, not B1–B15 or release acceptance.

**Required dependency boundary before S1**

Select a supported observation API that works for already initialized, cached
renderers. The smaller dependency change is an immutable renderer observation
interface. Its minimum facts are:

- An encoded/skipped draw outcome identifies the actual object, effective material,
  camera, pass, attachment, admitted counts, and native pipeline write policy.
- Bound texture observations identify the concrete allocation and version used
  by that command. Authored node/material declarations cannot substitute for them.
- Submission observations identify the output canvas and executed target revisions,
  including clears, overwrites, stores, resolves and copies. Apply revisions in
  submission order because a nested render can submit before its outer pass.
- Validation outcomes identify the affected operation/submission and renderer lifetime.
  A later failure revokes candidates; it cannot restamp an earlier callback.

Bound resources establish resource identity. Certified Munari materials and
compositor paths establish their allowed input chain. Shader visibility remains
caller policy under E8. This API need not expose private renderer maps or create
a general render graph.

A native forwarder installed before device/context use is a real alternative
for a narrower ownership contract. It needs a separate support, performance and
lifetime decision plus the missing output/revision coverage. It is not selected
for this specification because it cannot recover the cached borrowed state.
No runtime port can satisfy this gate by replacing these observations with
counters, material intent, or a callback that ran without drawing.

**Recommended continuation**

Prototype a small Three extension locally, then test it with one real Surface.
This is the next implementation task. A missing released API does not prevent
testing the required dependency change. Upstream acceptance and a usable
dependency distribution remain release gates.

The extension should expose actual draw outcomes and ordered pass/submission
operations, and make disposal safe before or during initialization. Three owns
the native pipeline and binding facts. Munari owns the bounded composition
provenance and Surface lifetime checks. Do not require Three to implement
Munari's handoff protocol or construct a general render graph.

1. Build the extension against one pinned Three source revision in an isolated
   prototype. Observe cached draws, admitted counts, actual bound allocations,
   effective write policy and target operations. Disposal must settle owned
   initialization work and release its resources without starting a new init.
2. Connect the validated uploader and public-root shell to one real retained
   Surface. Test direct output and one off-screen blit on both backends.
   Failed copies, empty/invalid pipelines, cleared targets, omitted blits and
   cancellation must keep native content usable. A valid changed source must
   then hand off with matching pixels and input. This determines whether the
   dependency change is sufficient before any bulk scene port.
3. When that fixture passes, freeze the selected API, cleanup path, material
   policy and support scope. Continue the unpublished migration through S1–S4.
   The final package must have a supported way to obtain the tested dependency;
   a successful local patch alone does not close S5 or authorize publication.

General cached-instance adoption is a proposed requirement, not a demonstrated
local consumer need. Current lab renderers are created by their owning scene or
SurfaceCanvas. If a small extension cannot support the required observation
boundary, the fallback proposal is an initial release with owned renderers and
factories that transfer control before initialization/preparation. Plain-Canvas
FrameSurface would use the same explicit renderer bootstrap before its first
draw. That changes external instance-injection support and requires a deliberate
contract decision. It does not relax upload, draw or output evidence.

Common target/camera types, standalone decorative TSL ports and material
experiments can proceed alongside the dependency prototype. Readiness and page
release must continue to use validated evidence. The alpha comparison, capture
layout coherence and lifecycle cases remain required work.

Portable pure-law, node, and scene work may proceed on isolated branches while
a supported integration is being resolved. Dependent readiness/presentation behavior
cannot be accepted using a temporary fake seam. A comparison baseline can remain
as an immutable source/build artifact during development; it does not become a
second supported production renderer.

S1–S4 run on an unpublished migration branch. S5 verifies the final default and
legacy removal, not only a forced test mode. Any artifact-affecting code,
dependency, manifest, documentation, asset or build-option edit after S5 returns
the affected work to S5. S6 authorizes publication, not an untested code cutover.

**2. Mandatory environment and ownership matrix**

| Row | Required path and assertion |
| --- | --- |
| X1 | Actual WebGPU plus capable native HTML-in-canvas; strict capture and backend identity. |
| X2 | Forced new-renderer WebGL 2 plus capable native capture; same node/material contracts. |
| X3 | Actual WebGPU plus explicitly selected snapDOM in no-trial Chrome; preserve its input and capture limitations. |
| X4 | Forced new-renderer WebGL 2 plus snapDOM; no native trial assumed. |
| X5 | WebGPU unavailable or denied, WebGL 2 available: actual startup fallback succeeds and reports `webgl2`. |
| X6 | Renderer available but native capture absent and snapDOM not installed: native-only scene behavior completes. A capability query alone cannot pass this row. |
| X7 | Both renderer backends unavailable or rejected: native exclusive content remains usable; scene-only fallback and error lifecycle behave correctly. |
| X8 | Supported Safari and Firefox configurations with snapDOM; require native WebGPU where claimed and separately verify forced fallback. Record actual browser/OS versions and renderer behavior. |
| X9 | Declared mobile support on actual devices, including DPR/zoom and real native controls. A narrow desktop viewport proves layout only. |

Exercise default owned renderer, sync factory, async factory, and borrowed
compatible instance. Cover plain R3F Canvas FrameSurface, named/shared
SurfaceCanvas, independent hosts, and supported manual composition. Cross every
renderer-specific contract with X1/X2; cross capture-specific contracts with
X1–X4. X5–X9 need their named real outcomes, not a blind Cartesian test count.
Every named scenario must state the matrix rows required for its evidence.

The target platform/peer coverage is fixed during S0 and before port acceptance.
Any necessary peer-floor change follows the supported dependency resolution.
An unavailable
mandatory adapter/device/capture path remains failed or unverified. It cannot
silently become a supported-platform omission after a red run. Local flags do
not prove origin-trial activation on the production origin.

Use `STRICT_CAPABILITY=1` when asserting a required native capture row.
Require an instrument backend-selection input and fail a requested/actual
mismatch. Actual WebGPU means the selected renderer backend; record whether
the adapter is hardware or software. Software-adapter functional evidence is
labeled and cannot establish physical-device performance. Reuse the current
instrument drivers and share profile selection where repeated runners need it.

Each case also has an execution location fixed in S0. The required location
cannot be changed after a failing run to close the case. A software-adapter
functional run does not substitute for a declared hardware/browser/device claim.

| Evidence | Required location |
| --- | --- |
| Current CI check and browser memberships | Hosted runner. Preserve the checks job and current browser subset: frame, idle, Genie reorder/restore/pose, demand capture, lifting pointer, shaders, degraded, and Knobs resize. Freeze the requested backend/capture profile for each. Missing required capability is unverified, not a green behavior result. |
| X1/X3 and hardware performance | Local physical desktop GPU with strict requested/actual WebGPU and capture identity. Record hardware/software adapter status. Hosted software results can add separately labeled functional evidence. |
| X2/X4 and X5–X7 | A named hosted or local functional profile selected in S0 for the case. Cases already in CI retain their hosted requirement as well as needed local hardware coverage. |
| X8/X9 | Declared browser/OS configurations and actual devices for claimed mobile/platform behavior. |
| Native capture production activation | Production-equivalent origin with verified capability. Local trial flags establish separate diagnostic evidence. |

Changes needed for hosted profiles require read-only runner investigation and
specific workflow/launch approval. Deployed smoke and rollback in S6 are release
operations; they cannot substitute for S5's pre-release evidence.

**3. Behavioral proof and deliberate faults**

Extend the strongest existing owner. Retain a new check only for a distinct
transport or lifecycle failure that the existing owner cannot exercise.
Fixtures may inject faults; they may not supply the successful receipts or
private state transitions the production owner should earn.

| ID | Observable acceptance and negative control | Primary existing owner |
| --- | --- | --- |
| B1 | Sync rejection, taint and async validation failure issue no accepted source record. Log each native request's source/version/destination/allocation and one terminal outcome. Delay validation: confirmed bytes stay intact and candidate/pending counts stay bounded. Recovery publishes distinguishable content and proves its watched-source pixels; a skipped/rejected recovery cannot pass on old storage. | FrameSurface and source-texture fixtures |
| B2 | Pending/failed pipelines, empty ranges and callbacks do not establish authority. Unrelated nested draws cannot count. Refuse detected bundles/custom dispatch before first misleading evidence. Exercise one-renderer/multiple-canvas mismatch; it is not a supported composition case. Document undetectable raw work separately. | Renderer case in composition/FrameSurface fixture |
| B3 | Discard/clear a Surface target, then draw an unrelated screen pass: native content stays held. The actual sampled chain qualifies. Cover ping-pong, internal conversion and parts. Multiple canvases use independent hosts; one host cannot confirm another's candidates. | Composition and Glass fixtures |
| B4 | Catch default/options and sync/async factory failures. Exercise partial factory cleanup, supplied-canvas adoption, StrictMode same-canvas replay, teardown acknowledgment and borrowed remount overlap. Late results/cleanup cannot revive or damage a replacement. The caller's renderer/device remains usable after detach. No unhandled error is hidden. | `probe:api-lifecycle` |
| B5 | Use the S0-frozen native compositing oracle plus existing coverage/color references. Wrong premultiplication, decode/filter order, tone mapping and coverage must fail. Check initial/replaced/subclass/array/override materials and changed hooks: unsupported GLSL kinds/custom hooks reject evidence with scoped errors; compatible replacement recovers. | `probe:surface-textures`, `gate:capture-engines`, `gate:frame-surface` |
| B6 | Coalesced publication labels actual pixels. Changed source/part/geometry/requirements reject old identity; newer matching generations can meet minima. Under delayed validation and repeated replacement, observe one confirmed set, at most one candidate, and one unallocated newest request. No accumulating retired pool remains. | FrameSurface, parts and API regression fixtures |
| B7 | Continuous resize, settle, DPR/display/zoom changes and mip transitions retain coverage and coherent anchors. One-pixel offsets, old-size allocation and deliberate under-resolution must fail the relevant pixel checks. | `gate:knobs-resize`, `probe:api-regressions`, sharpness and density probes |
| B8 | Two-camera/two-target callbacks use the submitted pose/physical viewport and advance physics once. Near-plane, offset, portal and depth-range controls catch stale reads. Throw after raster/companion preparation and during draw: restore borrowed matrices/update/material/target state, reject output, then prove valid rendering and input recover. A missing-restore control must fail. | `probe:api-render-passes`, postcard companion fixture |
| B9 | Real controls receive input only through the accepted route: typing, native select/checkbox, caret/selection, drag/cancel, hover/active, overlays, changing page targets, deformed and refracting geometry. Trusted-native outcomes are observed where supported. | Native/lifting, Gallery/Crystal/Fisheye/slider pointer gates |
| B10 | Exercise observed device loss after a scene hold and during preparation/readback. Distinguish intentional destruction after cleanup from loss/destruction while a host remains active; counters are not liveness. Observe native restoration after the handler and reject stale receipts. Forced fallback tests its own loss path. Recovery has fresh epochs and preparation. | Lifecycle and Genie loss fixtures |
| B11 | Return/unmount submits a frame with the child absent; old pixels disappear and resources/claims stop. Observe zero new submissions on an idle demand host after the final clearing draw and a later liveness wake. A repeated-render control must fail. Capture-only idle-zero remains separate. An unrelated caller `always` scene and another Surface's active work continue. | Genie return/pose and lifecycle submission fixture; `gate:idle-zero` for source paints only |
| B12 | Delay/coalesce field work and finish stale work after replacement: no new state is overwritten. Continuous pixels with verified stable layout publish and converge. Move an unnamed control inside a same-sized root, scroll/clip/transform it, replace it or disable input without changing doc/source IDs: old routing is refused or returns to native. Unknown layout stamps never compare equal. Injected false-equivalence/stale routing must fail. | Gallery pointer, Refraction and tuning fixtures |
| B13 | Change Logo font/style/glyph/size while reads are pending. A stale contour cannot replace newer front/side geometry or bounds. Multiple logo instances and concurrent jobs cannot overwrite buffers. Pixels and corrected raycast use the same artifact. | Logo/Wordmark routes and contour/browser fixtures |
| B14 | Show an ordinary peer behind a warming Surface on a shared host. Color, depth, stencil and shadow writes from warm-up change none of its visible pixels. Color-off/depth-on, leaking stencil and shadow-write controls must fail. Repeated warm-up restores shared material policy and leaves other Surfaces presenting. | Shared-host composition and shadow fixture; flag-only unit tests remain insufficient |
| B15 | Real depth/shadow pixels follow the material's supported geometry, alpha mask and deformation. Test ordinary/Marble Hand custom depth paths and shared-room shadows. A stale depth deformation or absent discard/mask must change the scored shadow/occlusion region and fail. | Added shadow case in material/shared-room fixture plus actual Marble Hand route |

The instrument discovers and reports intended cases and material states.
The shader gate must observe actual WGSL compilation, pipeline/validation
diagnostics, and required node programs on WebGPU. Its existing WebGL compile
hooks remain useful for the new renderer's WebGL 2 backend. Route loading and
an empty shader-error array are insufficient if the target program never ran.

Record version/dirty scope, requested/actual backend, capture engine, browser/OS,
adapter, flags, viewport/DPR, selected/completed cases, source/transfer/epoch,
output markers, measurements, faults, artifacts, and the command exit status.
GPU readback results retain their originating target/submission identity even
if later frames advance.

Where scored pixels could equal an earlier frame, establish fresh content
identity in the watched source, material output or derived field and read it
with those pixels. A separately drawn sentinel proves only its own draw. Existing
changed-source generation/resize patterns remain valid and need no blanket
replacement. A deliberately skipped or rejected watched draw must fail the same
freshness oracle. This is instrument verification; production authority comes
from validated copy/draw/output observations.

For continuity, require coverage of every page-frame marker in the claimed
interval using [screencastCoverage](../instruments/screencastCoverage.ts).
Timestamp gaps alone are not the current recording contract. Missing observation
leaves the interval unverified. Score the first eligible output and subsequent
distinct output frames. Known stale first pose, blank first pixels, and later
suppressed writes must be detected. Retry only the owner's typed incomplete
observation case within its existing retry limit.

**4. Complete consumer inventory**

The current route owner is [App](../apps/lab/src/App.tsx); the source map is
[ALL-DEMO-API](../ALL-DEMO-API.md). Include direct-URL studies, not only navigation.

| Routes | Required migration and actual behavior |
| --- | --- |
| `home` | Three standalone headline/light/bulb renderers, custom output and shadow passes, paper/postcard materials, PMREM, mask workers, startup/reveal, native input and page return. Extend the existing Home/postcard/startup/inline/light/edge/lamp checks. |
| `workspace` | All 33 scene-owned panels, focus/navigation/typing/Dial, shared host, room shadows and environment. Replace or validate the shared-room Drei `ContactShadows`, which contains GLSL blur/depth patches. |
| `glass` | Both `sdf` and `mtm` modes. Port scene/depth and ping-pong targets, final blit, ordering/ripples and manual records. Replace Drei `MeshTransmissionMaterial`'s GLSL patch with compatible node transmission. Observe both modes' pixels and native form input. |
| `flight` | Node card bend/crumple and shadow materials, existing input geometry policy, drag/throw/reversal, page-target changes, retained form input, continuous motion and cleanup. |
| `explode` | Default scene material compatibility and six Canvas2D/DOM paint plates. Observe collapsed layer reconstruction, spread/orbit and live restyling. |
| `genie` | DOM/window and film node materials, frame producer, actual generation and output transfer, shadow and input, reverse/return, loss and final clearing draw. Preserve caller-owned film canvas. |
| `fisheye` | Lens output and CPU-deformed geometry; existing corrected real-pointer gate and deliberate wrong-route control. |
| `slider` | Lens and thumb output, CPU deformation and actual HTML slider dragging, including fast drag, cancellation and return. |
| `veil` | Blur/downsample/upscale multipass renderer, capture-only article, scroll/resize and pointer hint. Add real effect contribution and native article behavior where current route smoke is insufficient. |
| `knobs` | Named parts, lit controls, PMREM, responsive anchors and native input. Port the custom corona RGB-additive blend that preserves destination alpha; compare with a wrong-alpha additive control so a black rectangle cannot pass. |
| `optics` | All six sources, off-screen collection, resolution pinning, high-resolution/fixed-raster sharpness, calculator input through the lens, custom programs, corrected input, lit modes, tuning and alpha pixels. |
| `logo` | Field passes, asynchronous alpha/contour work, front/side nodes, coordinated letter motion, pointer interaction and native fallback. |
| `selection` | Native selection/caret, captured text and selection glass output. Preserve selectability with and without native capture. |
| `candidates` | Every study below, including rapid reversal/cancellation, actual effects, and endpoint native behavior. Shared hosting does not substitute for each study's state coverage. |
| `refraction` | Named outgoing/incoming parts, custom field/compositor nodes, sampled coverage, coherent field publication and endpoint native content. |
| `gallery` | Five live items, Refraction fields, pointer partition and proxy; real destination clicks through the displayed aperture during both directions and rapid item changes. |
| `crystal` | Ray-traced glass nodes and the same last-submitted lens/pose used by its corrected CPU law. Retain corrected-versus-uncorrected pointer controls. |
| `controls` | Retained form, physical standard materials, compatible RoundedBox geometry, paint-matched hardware anchors, actual Save outcome and withdrawal. |
| `marble-hand` | Veining/tap/depth patches, outline/mask targets, PMREM/cube environment, standalone page background, reflection capture, shared published clock, input, reduced motion and loss. |
| `plume` | Capture-only native editor and immutable released ink, cloud/particle nodes, real contribution and no-effect control, focus/selection, idle and reduced motion. |
| `gravity` | Retained word Surfaces and the separate no-capture standalone renderer. Native paragraph reflow, multiple-word drag/drop/click-return, resize and cleanup. |
| `lamp` | Both standalone renderers, light/flame/transmission nodes, environment, native masks, loss, light/shadow input, resize and reduced motion. Home Lamp checks exercise different files and do not close this route. |
| `rain` | Standalone instanced drop/streak/water renderer, native glyph/layout masks, known motion/splash/pool pixels, resize, reduced motion, startup cancellation and cleanup. |
| `wordmark` | The reused MunariLogo at route and actual site-navigation scales, asynchronous fields, live font changes, multiple independent instances and native fallback. |

The Candidate roster is `ripple`, `billow`, `unroll`, `dissolve`, `analyze`,
`copy`, and `delete`. Observe respectively press/wave output, billowing,
opening/canceling a retained menu, two-part particle transfer, reading-material
output, a flying copy, and row retention until exit and clearing draw. Delete
must exercise `melt`, `shatter`, and `peel`; testing only its default mode is
incomplete.

Compatibility decisions for installed Drei helpers follow their actual branch.
`ContactShadows` and `MeshTransmissionMaterial` need ports/replacements.
Environment file loading, portal cube targets, `useFBO` allocation/resolve,
PMREM, controls and geometry each need their own source and runtime check.
Use compatible common-renderer PMREM/cube-target classes. No package-wide
claim that all Drei helpers work or fail is accepted.

Glass registry files change with their byte-identical lab references. If GLSL
files become node modules, rename both copies and update pack tests and copying
instructions in the same change. Focus-orbit camera/layout files keep their
Workspace weld. Flight-card remains documentation of its lab implementation;
extracting a new component/package is outside scope.

**5. Budgets and performance evidence**

Keep existing thresholds in their owning checks. The table is a planning index;
the executable owner determines the exact crop, interval, exclusions and setup.
A changed threshold needs independent measurement and a decision amendment.

| Existing contract | Budget and owner |
| --- | --- |
| Flat capture color | Worst channel difference within `4/255`, `gate:capture-engines` |
| Caller frame colors | Within one 8-bit RGB value, `gate:frame-surface`; wrong tone-mapping control fails |
| Lit alpha and weighted RGB | Half/quarter alpha within one byte of `128`/`64`; weighted RGB within two bytes, `probe:surface-textures` |
| Native translucent compositing | S0 material/instrument owner fixes matched native references, regions, metric and independently measured tolerance before candidate selection. Current framebuffer-alpha/color limits do not establish this boundary. Acceptance remains pending until the oracle and decision are recorded. |
| Stationary text | Native edge-energy ratio `0.95–1.05`, sharpness/postcard/scene-sharpness probes |
| Companion/preparation pixels | Mean channel error at most `0.5` in the specified 8-bit crop, postcard/preparation probes |
| Scrolling postcard | Relative drift at most `1.5` CSS pixels, `probe:postcard` |
| Companion traversal | p95 at most `1 ms`, maximum at most `4 ms`, `probe:api-render-passes` |
| Native snapshot copies | Controls/Selection/html/body: p95 at most `5 ms`, maximum at most `8 ms`, zero idle copies. Selection/html/body additionally require at most `26` copies for `24` bursts and zero consumer renders per paint; Controls is excluded from those two assertions. Owner: `probe:api-capture-cost`. |
| Moving anchors | At most `1` CSS pixel while moving, exact agreement when settled, `probe:api-regressions` |
| Quiet capture | Zero paints in the owner's quiet interval, followed by a successful liveness mutation, `gate:idle-zero` |

Preserve each other scene's perceptual floors and controls. The Knobs throughput
reference and historical diagnostic maxima are not new migration thresholds.

Benchmark an immutable legacy baseline, forced new WebGL 2, and actual WebGPU
on the same hardware/browser/power state, viewport, DPR, capture engine, content,
and tuning. Alternate runs; separate cold startup, warm startup, capture CPU,
uploads, preparation, submission, input-to-visible latency, idle and cleanup.
Use the real postcard, lit controls, Glass, Knobs and Marble Hand workloads and
the existing scaling probes. Optional GPU timestamps do not prove composition.

Use unprofiled runs for acceptance. Keep GPU runs serial and validate observer
and host load. Existing budget failures block release. A regression without a
pre-existing budget remains pending until the binding/material owner and Pete
fix its workload, baseline-repeatability method and acceptance bound. Set that
bound from independent baseline evidence and product requirements before judging
the migrated candidate. A candidate regression cannot define its own passing
budget. Include staging memory, upload work and input-to-visible latency. No
speedup, strict timing parity or arbitrary percentage is assumed. Baseline audit
findings do not automatically authorize unrelated fixes.

**6. Package, guidance, cutover, and rollback**

The package name and root, `/advanced`, `/snapdom`, and `/style.css` entries
remain. Core is bundled, never independently published. Three, Fiber, React and
React DOM remain peers; snapDOM remains optional. Verify externalization of
`three/webgpu` and `three/tsl`, coherent constructors and emitted declarations
in a packed external consumer, not only workspace imports.

Pin the migration's starting dependencies. Determine the first supported
Three/Fiber versions that satisfy S0, then set and test the peer floors. Current
wide ranges are not proof that older allowed versions support the new behavior.
Test the floor and the selected implementation version. A required supported
dependency fix is recorded with its version and evidence, not a blanket upgrade.

Before S5, migrate renderer injection, material helpers, manual evidence, target types,
default/lit/frame examples, all consumers and compile-only API cases together.
Use a versioned breaking release for the retired renderer/GLSL integration.
Update README, `llms.txt`, the shipped Munari skill, package/registry guides,
public types, authoring constraints affected by measured behavior, and owning
decisions. Preserve dated historical measurements as history. The lifecycle
section here owns the shared proposal; the API plan links to it rather than
publishing a second status union.

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`, plus
the named mandatory browser cases. Verify discovery, actual outcomes, package
contents and external consumers. Fix failures caused by the migration within
scope. Unrelated failures do not authorize unrelated changes or weakened checks.

Before S5, retain the last known-good package/build and its source
revision. Rollback pins/redeploys that complete artifact using existing tooling;
it does not hot-switch a live Surface to a different renderer. Normal reload
reestablishes the documented capture/backend path. Confirm rollback startup and
native behavior on the declared platform matrix. S5 records the exact final
source/lockfile and packed content digest. S6 publishes that verified content.
If existing tooling rebuilds or repackages, verify equivalent content before
external publication. Otherwise validate the resulting artifact again in S5;
do not infer equality from a common branch name or unchanged version string.

Existing CI runs several serial browser gates on Ubuntu without strict capture
or a native WebGPU assertion. A green job can contain capability skips. Inspect
the hosted adapter and observer before proposing a matrix/runner change.
Workflow, infrastructure, deployment and release-tooling changes require Pete's
explicit approval for each concrete change. Implementation approval alone does
not authorize them. Local strict acceptance can proceed while that approval is
pending. The execution-location table identifies required hosted cases; missing
evidence remains visible and blocks that release claim.

**7. Release blockers and final checklist**

| Blocker | Required resolution |
| --- | --- |
| Upload/draw/output authority | The selected supported upload route and observation interface pass B1–B3, including validation, detectable refusals and uncertified-record rejection. CanvasTexture callbacks alone remain insufficient. |
| Startup/adoption lifetime | The selected public-root or supported Canvas integration passes B4 without revived roots, canvas interference, lost caller ownership or uncaught promises. |
| Node compositing | Correct alpha/color/depth/shadow/output policy passes independent native and scene references; B5 passes. |
| Async input and contour fields | Coherent GPU/CPU field and texture/geometry artifacts pass B12/B13 with out-of-order completion. |
| Native WebGPU and fallback parity | Mandatory backend/capture/ownership/platform cases pass without mislabeled fallback or skipped required cases. |
| Whole-consumer coverage | All routes/studies, both Glass modes, standalone renderer paths, shared-room helpers and registry copies have their stated pixel/input/lifecycle evidence. |
| Package and minimum peers | Broad checks, declared floors, packed consumer, documentation and released artifact agree. |
| CI/production support claims | The fixed execution-location cases and production-equivalent origin/device proof pass; necessary tooling changes are specifically approved. |

Final acceptance requires every blocker closed, each requirement mapped to a
completed owner case, no surviving production legacy renderer/custom GLSL path,
no weakened perceptual or observer checks, and a verified rollback artifact.
The implementer records the final evidence next to each milestone in this file.
Until then, this specification remains a proposal.

Current implementation sources: [operating guide](agent-workflow.md),
[system model](system-model.md), [glossary](../CONTEXT.md),
[binding](../packages/react/src/primitives/surface/SurfaceCanvas.tsx),
[materials](../packages/react/src/primitives/surface/surfaceMaterials.tsx),
[FrameSurface](../packages/react/src/primitives/FrameSurface.tsx),
[presentation laws](../packages/core/src/transfer/presentation.ts),
[Refraction field](../apps/lab/src/scenes/refraction/refractionField.tsx),
[Logo fields](../apps/lab/src/scenes/logo/logoFields.ts),
[instrument contracts](../instruments/README.md), and
[API instrument contracts](../instruments/api-all-demos/README.md).
Upstream constraints: [Three migration guide](https://threejs.org/manual/pages/webgpurenderer),
[Fiber v9 renderer setup](https://r3f.docs.pmnd.rs/api/canvas#webgpu), and
[Chrome capture API changes](https://developer.chrome.com/blog/html-in-canvas-ot-changes).
The public native-texture candidate is defined by
[pinned ExternalTexture source](https://github.com/mrdoob/three.js/blob/2431a09f46f34c560bc8e44b33be0e567723d5b9/src/textures/ExternalTexture.js).


<details>
<summary>Reproduce the recorded renderer-evidence diagnostic</summary>

This is a dated diagnostic on the baseline source and dependency versions.
It is not a migrated implementation or a permanent acceptance harness.
It exercises real native copies and draws around the current source and
FrameSurface runtimes. It supplies eligible-pass input and does not mount
FrameSurface JSX or score a full DOM handoff. Expected fault diagnostics are
separate from unexpected page failures. The duplicate Three-build warning
in this temporary setup is not a packed-consumer result.

Save the four source blocks below under
`/private/tmp/munari-webgpu-evidence-probe`. Adjust checkout paths if needed.
Start the server in one terminal and read its URL from the log:

```sh
node /private/tmp/munari-webgpu-evidence-probe/server.mjs > /private/tmp/munari-webgpu-evidence-server.log 2>&1
```

The recorded run used port `5173`. The taint case's image URL must use
`localhost` and the server's actual port, while the page opens on `127.0.0.1`.
If the server chooses another port, update that image URL before opening the
page. This origin distinction creates the tainted-canvas control.

Use a dedicated browser session with the server URL:

```sh
agent-browser --session munari-webgpu-evidence --executable-path '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' --webgpu --args '--enable-features=CanvasDrawElement' --no-webmcp open <URL-from-log>
agent-browser --session munari-webgpu-evidence eval 'window.__webgpuEvidenceProbe' --json
agent-browser --session munari-webgpu-evidence close
```

Wait for `completed: true`. Verify the actual backend and that `unexpected`
is empty. Compare each deliberately faulty case's pixels, callback/counter
activity, validation outcome, and issued records with the successful control.
These faulty records are the reproduced defect, not a passing migration.
`deviceLostRender` deliberately destroys a supplied device. It does not prove
spontaneous device-loss handling. Stop the server with Ctrl-C afterward.

This code alters hooks and queue calls for controlled observation/faults.
Those alterations must not become the production observation interface.

`index.html`

```html
<!doctype html><html><head><meta charset="utf-8"><title>Munari WebGPU evidence probe</title></head><body><pre id="result">Running</pre><script type="module" src="/main.js"></script></body></html>
```

`taint.svg`

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>
```

`server.mjs`

```javascript
import { createServer } from '/Users/petepetrash/Code/munari/node_modules/vite/dist/node/index.js'
const server = await createServer({ configFile: false, root: '/private/tmp/munari-webgpu-evidence-probe', logLevel: 'warn', server: { host: '127.0.0.1', port: 0, fs: { allow: ['/private/tmp/munari-webgpu-evidence-probe', '/Users/petepetrash/Code/munari'] } } })
await server.listen()
console.log(JSON.stringify({ url: `http://127.0.0.1:${server.httpServer.address().port}`, pid: process.pid }))
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0) })
```

`main.js`

```javascript
import * as THREE from '/@fs/Users/petepetrash/Code/munari/node_modules/three/build/three.webgpu.js'
import { vec4, wgslFn } from '/@fs/Users/petepetrash/Code/munari/node_modules/three/build/three.tsl.js'
import { createCanvasFrameSource } from '/@fs/Users/petepetrash/Code/munari/packages/core/src/index.ts'
import { createFrameSurfaceRuntime } from '/@fs/Users/petepetrash/Code/munari/packages/react/src/primitives/FrameSurface.tsx'
import { createSurfaceSourceRuntime } from '/@fs/Users/petepetrash/Code/munari/packages/react/src/primitives/surface/surfaceSourceRuntime.ts'

const result = { browser: navigator.userAgent, cases: {}, unexpected: [] }
const camera = new THREE.OrthographicCamera(-1,1,1,-1,0.1,10)
camera.position.z=3
let renderer, device, target
const after = () => new Promise(resolve => requestAnimationFrame(resolve))
const resources=[]
let callbacks=[]
let hookCalls=[]
function mesh(label, material=new THREE.MeshBasicNodeMaterial({color:0xff0000,toneMapped:false})) {
  const geometry=new THREE.PlaneGeometry(2,2)
  const object=new THREE.Mesh(geometry, material)
  object.name=label
  object.onAfterRender=()=>callbacks.push(label)
  resources.push(geometry, material)
  return object
}
function observe(original) {
  renderer.setRenderObjectFunction((...args)=> {
    const before=renderer.info.render.drawCalls
    ;(original ?? renderer.renderObject.bind(renderer))(...args)
    hookCalls.push({object:args[0].name,before,after:renderer.info.render.drawCalls,delta:renderer.info.render.drawCalls-before})
  })
}
async function pixels() {
  const bytes=await renderer.readRenderTargetPixelsAsync(target,0,0,32,32)
  return Array.from(bytes.slice((16*32+16)*4,(16*32+16)*4+4))
}
async function renderCase(label,scene) {
  callbacks=[];hookCalls=[]
  renderer.info.reset()
  device.pushErrorScope('validation')
  renderer.render(scene,camera)
  const validation=await device.popErrorScope()
  const value={callbacks:[...callbacks],hooks:[...hookCalls],drawCalls:renderer.info.render.drawCalls,validation:validation?.message??null,pixel:await pixels()}
  result.cases[label]=value
  return value
}
try {
  const adapter=await navigator.gpu.requestAdapter()
  if(!adapter)throw Error('No adapter')
  result.adapter={vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description}
  device=await adapter.requestDevice()
  renderer=new THREE.WebGPURenderer({device,alpha:true,antialias:false})
  await renderer.init()
  if(!renderer.backend.isWebGPUBackend)throw Error('WebGPU fallback selected')
  result.actualWebGPU=true
  renderer.setSize(32,32)
  renderer.info.autoReset=false
  renderer.toneMapping=THREE.NoToneMapping
  renderer.setClearColor(0x0000ff,1)
  target=new THREE.RenderTarget(32,32,{type:THREE.UnsignedByteType,format:THREE.RGBAFormat,depthBuffer:true})
  renderer.setRenderTarget(target)
  observe(null)
  const basic=new THREE.Scene()
  const basicMesh=mesh('ordinary')
  basic.add(basicMesh)
  await renderCase('ordinary',basic)
  basicMesh.geometry.setDrawRange(0,0)
  await renderCase('zeroVertices',basic)
  basicMesh.geometry.setDrawRange(0,-1)
  await renderCase('negativeRange',basic)
  basicMesh.geometry.setDrawRange(0,6)

  const pendingScene=new THREE.Scene()
  const pendingMaterial=new THREE.MeshBasicNodeMaterial()
  pendingMaterial.fragmentNode=vec4(0.31,0.77,0.19,1)
  pendingScene.add(mesh('pending-pipeline',pendingMaterial))
  const nativeAsync=device.createRenderPipelineAsync.bind(device)
  let releasePipeline, beganPipeline
  const began=new Promise(resolve=>beganPipeline=resolve)
  const hold=new Promise(resolve=>releasePipeline=resolve)
  device.createRenderPipelineAsync=async (...args)=>{beganPipeline();const pipeline=await nativeAsync(...args);await hold;return pipeline}
  const compile=renderer.compileAsync(pendingScene,camera)
  await Promise.race([began,new Promise((_,reject)=>setTimeout(()=>reject(Error('compileAsync did not reach native pipeline creation')),5000))])
  await renderCase('pendingPipeline',pendingScene)
  releasePipeline()
  await compile
  device.createRenderPipelineAsync=nativeAsync
  await renderCase('readyPipeline',pendingScene)

  const badScene=new THREE.Scene()
  const badMaterial=new THREE.MeshBasicNodeMaterial()
  badMaterial.fragmentNode=wgslFn('fn badFragment() -> vec4f { return DOES_NOT_EXIST; }')()
  badScene.add(mesh('invalid-shader',badMaterial))
  await renderCase('invalidPipelineFirstRender',badScene)
  await after()
  await renderCase('invalidPipelineAfterValidation',badScene)

  const bundleScene=new THREE.Scene()
  const bundle=new THREE.BundleGroup()
  bundle.add(mesh('bundle-mesh'))
  bundleScene.add(bundle)
  await renderCase('bundleBuild',bundleScene)
  await renderCase('bundleReplay',bundleScene)

  const watchedScene=new THREE.Scene()
  const watched=mesh('watched')
  watched.geometry.setDrawRange(0,-1)
  const unrelated=mesh('unrelated')
  unrelated.updateMatrixWorld()
  watchedScene.add(watched)
  const custom=(object,scene,cam,geometry,material,group,lights,clip,pass)=>{
    renderer.renderObject(unrelated,scene,cam,unrelated.geometry,unrelated.material,null,lights,clip,pass)
    renderer.renderObject(object,scene,cam,geometry,material,group,lights,clip,pass)
  }
  observe(custom)
  await renderCase('customUnrelatedDraw',watchedScene)
  observe(null)

  for(const mode of ['success','synchronousCopyFailure','asynchronousCopyFailure']) {
    const canvas=document.createElement('canvas')
    canvas.width=32;canvas.height=32
    const ctx=canvas.getContext('2d')
    ctx.fillStyle='red';ctx.fillRect(0,0,32,32)
    const source=createCanvasFrameSource(canvas,{premultiplyAlpha:true})
    source.publish()
    const runtime=createFrameSurfaceRuntime(source,1,false,()=>{})
    runtime.texture.generateMipmaps=false
    const material=new THREE.MeshBasicNodeMaterial({map:runtime.texture,toneMapped:false})
    const object=mesh(mode,material)
    let draws=[],presentations=[]
    const requirement={transferId:7,frame:source.currentFrame(),presentationRevision:3}
    object.onBeforeRender=()=>runtime.beginPresentationPass(requirement,true,true)
    object.onAfterRender=()=>{callbacks.push(mode);draws.push(runtime.takeDrawReceipt());presentations.push(runtime.takePresentationReceipt())}
    const scene=new THREE.Scene()
    scene.add(object)
    const original=device.queue.copyExternalImageToTexture.bind(device.queue)
    let copyInvocations=0,syncThrown=null
    device.queue.copyExternalImageToTexture=(input,destination,size)=>{
      copyInvocations++
      try {
        if(mode==='synchronousCopyFailure')return original({...input,origin:{x:1024,y:0}},destination,size)
        if(mode==='asynchronousCopyFailure')return original(input,{...destination,mipLevel:128},size)
        return original(input,destination,size)
      } catch(error){syncThrown=String(error);throw error}
    }
    const value=await renderCase(mode,scene)
    device.queue.copyExternalImageToTexture=original
    value.copyInvocations=copyInvocations
    value.syncThrown=syncThrown
    value.drawReceipts=draws
    value.presentationReceipts=presentations
    runtime.dispose()
  }
  const crossOriginImage=new Image()
  await new Promise((resolve,reject)=>{
    crossOriginImage.onload=resolve
    crossOriginImage.onerror=()=>reject(Error('Cross-origin local image failed to load'))
    crossOriginImage.src='http://localhost:5173/taint.svg'
  })
  const taintedCanvas=document.createElement('canvas')
  taintedCanvas.width=32;taintedCanvas.height=32
  taintedCanvas.getContext('2d').drawImage(crossOriginImage,0,0)
  let taintCheck=null
  try{taintedCanvas.getContext('2d').getImageData(0,0,1,1)}catch(error){taintCheck=String(error)}
  if(!taintCheck)throw Error('Cross-origin control failed to taint the canvas')
  const taintedSource=createCanvasFrameSource(taintedCanvas,{premultiplyAlpha:true})
  taintedSource.publish()
  const taintedRuntime=createFrameSurfaceRuntime(taintedSource,1,false,()=>{})
  taintedRuntime.texture.generateMipmaps=false
  const taintedMaterial=new THREE.MeshBasicNodeMaterial({map:taintedRuntime.texture,toneMapped:false})
  const taintedMesh=mesh('tainted-canvas',taintedMaterial)
  const taintRequirement={transferId:9,frame:taintedSource.currentFrame(),presentationRevision:2}
  const taintReceipts=[]
  taintedMesh.onBeforeRender=()=>taintedRuntime.beginPresentationPass(taintRequirement,true,true)
  taintedMesh.onAfterRender=()=>{callbacks.push('tainted-canvas');taintReceipts.push({draw:taintedRuntime.takeDrawReceipt(),presentation:taintedRuntime.takePresentationReceipt()})}
  const taintedScene=new THREE.Scene()
  taintedScene.add(taintedMesh)
  const taintValue=await renderCase('taintedCanvas',taintedScene)
  taintValue.taintCheck=taintCheck
  taintValue.receipts=taintReceipts
  taintedRuntime.dispose()

  const element=document.createElement('div')
  element.style.cssText='width:32px;height:32px;background:red'
  const domRuntime=createSurfaceSourceRuntime({content:element,size:[32,32],resolution:1,live:false,mirrorU:false,pixelRatio:1,onError:error=>result.unexpected.push(String(error))})
  const deadline=performance.now()+5000
  while(!domRuntime.source.painted()&&performance.now()<deadline)await after()
  if(!domRuntime.source.painted())throw Error('DOM source did not paint')
  domRuntime.frame()
  const domScene=new THREE.Scene()
  const domMaterial=new THREE.MeshBasicNodeMaterial({map:domRuntime.texture(),toneMapped:false})
  domScene.add(mesh('DOM-runtime-failed-copy',domMaterial))
  const copy=device.queue.copyExternalImageToTexture.bind(device.queue)
  device.queue.copyExternalImageToTexture=(input,destination,size)=>copy({...input,origin:{x:1024,y:0}},destination,size)
  const priorGeneration=domRuntime.uploadedGeneration()
  const domValue=await renderCase('domRuntimeFailedCopy',domScene)
  domValue.priorGeneration=priorGeneration
  domValue.claimedUploadedGeneration=domRuntime.uploadedGeneration()
  domValue.currentPaintGeneration=domRuntime.currentPaint()?.frame.generation
  domValue.claimedAnyUpload=domRuntime.uploaded()
  device.queue.copyExternalImageToTexture=copy
  domRuntime.dispose()

  device.destroy()
  await device.lost
  renderer.setRenderTarget(null)
  callbacks=[];hookCalls=[]
  const beforeLost=renderer.info.render.drawCalls
  renderer.render(basic,camera)
  result.cases.deviceLostRender={before:beforeLost,after:renderer.info.render.drawCalls,callbacks:[...callbacks],hooks:[...hookCalls],targetIsNull:renderer.getRenderTarget()===null}
  result.completed=true
} catch(error) {
  result.failure=String(error)
} finally {
  renderer?.setRenderObjectFunction(null)
  for(const resource of resources)resource.dispose()
  target?.dispose()
  renderer?.dispose()
  device?.destroy()
  window.__webgpuEvidenceProbe=result
  document.querySelector('#result').textContent=JSON.stringify(result,null,2)
}
```

Recorded observations:

```json
{
  "actualWebGPU": true,
  "adapter": {
    "architecture": "metal-3",
    "description": "",
    "vendor": "apple"
  },
  "browser": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/154.0.0.0 Safari/537.36",
  "cases": {
    "asynchronousCopyFailure": {
      "callbacks": [
        "asynchronousCopyFailure"
      ],
      "copyInvocations": 1,
      "drawCalls": 1,
      "drawReceipts": [
        {
          "frame": {
            "generation": 1,
            "sourceId": 2
          },
          "surfaceEpoch": 1
        }
      ],
      "hooks": [
        {
          "after": 1,
          "before": 0,
          "delta": 1,
          "object": "asynchronousCopyFailure"
        }
      ],
      "pixel": [
        0,
        0,
        0,
        255
      ],
      "presentationReceipts": [
        {
          "frame": {
            "generation": 1,
            "sourceId": 2
          },
          "presentationRevision": 3,
          "surfaceEpoch": 1,
          "transferId": 7
        }
      ],
      "syncThrown": null,
      "validation": "MipLevel (128) is greater than the number of mip levels (1) in [Texture (unlabeled 32x32 px, TextureFormat::RGBA8UnormSrgb)].\n - While validating the TexelCopyTextureInfo for the destination\n - While validating CopyTextureForBrowser from [Texture \"IOSurface(Gles2Read|RasterRead|DisplayRead|Scanout|WebgpuRead|RasterWrite)\"] to [Texture (unlabeled 32x32 px, TextureFormat::RGBA8UnormSrgb)]\n"
    },
    "bundleBuild": {
      "callbacks": [
        "bundle-mesh"
      ],
      "drawCalls": 1,
      "hooks": [
        {
          "after": 1,
          "before": 0,
          "delta": 1,
          "object": "bundle-mesh"
        }
      ],
      "pixel": [
        255,
        0,
        0,
        255
      ],
      "validation": null
    },
    "bundleReplay": {
      "callbacks": [],
      "drawCalls": 0,
      "hooks": [],
      "pixel": [
        255,
        0,
        0,
        255
      ],
      "validation": null
    },
    "customUnrelatedDraw": {
      "callbacks": [
        "unrelated",
        "watched"
      ],
      "drawCalls": 1,
      "hooks": [
        {
          "after": 1,
          "before": 0,
          "delta": 1,
          "object": "watched"
        }
      ],
      "pixel": [
        255,
        0,
        0,
        255
      ],
      "validation": null
    },
    "deviceLostRender": {
      "after": 3,
      "before": 1,
      "callbacks": [
        "ordinary"
      ],
      "hooks": [
        {
          "after": 2,
          "before": 1,
          "delta": 1,
          "object": "ordinary"
        },
        {
          "after": 3,
          "before": 2,
          "delta": 1,
          "object": "Output Color Transform"
        }
      ],
      "targetIsNull": true
    },
    "domRuntimeFailedCopy": {
      "callbacks": [
        "DOM-runtime-failed-copy"
      ],
      "claimedAnyUpload": true,
      "claimedUploadedGeneration": 1,
      "currentPaintGeneration": 1,
      "drawCalls": 1,
      "hooks": [
        {
          "after": 1,
          "before": 0,
          "delta": 1,
          "object": "DOM-runtime-failed-copy"
        }
      ],
      "pixel": [
        0,
        0,
        0,
        255
      ],
      "priorGeneration": -1,
      "validation": null
    },
    "invalidPipelineAfterValidation": {
      "callbacks": [
        "invalid-shader"
      ],
      "drawCalls": 0,
      "hooks": [
        {
          "after": 0,
          "before": 0,
          "delta": 0,
          "object": "invalid-shader"
        }
      ],
      "pixel": [
        0,
        0,
        255,
        255
      ],
      "validation": null
    },
    "invalidPipelineFirstRender": {
      "callbacks": [
        "invalid-shader"
      ],
      "drawCalls": 1,
      "hooks": [
        {
          "after": 1,
          "before": 0,
          "delta": 1,
          "object": "invalid-shader"
        }
      ],
      "pixel": [
        79,
        196,
        48,
        255
      ],
      "validation": "Error while parsing WGSL: :21:39 error: unresolved value 'DOES_NOT_EXIST'\nfn badFragment (  ) -> vec4f { return DOES_NOT_EXIST; }\n                                      ^^^^^^^^^^^^^^\n\n\n - While calling [Device].CreateShaderModule([ShaderModuleDescriptor \"\"fragment\"\"]).\n"
    },
    "negativeRange": {
      "callbacks": [
        "ordinary"
      ],
      "drawCalls": 0,
      "hooks": [
        {
          "after": 0,
          "before": 0,
          "delta": 0,
          "object": "ordinary"
        }
      ],
      "pixel": [
        0,
        0,
        255,
        255
      ],
      "validation": null
    },
    "ordinary": {
      "callbacks": [
        "ordinary"
      ],
      "drawCalls": 1,
      "hooks": [
        {
          "after": 1,
          "before": 0,
          "delta": 1,
          "object": "ordinary"
        }
      ],
      "pixel": [
        255,
        0,
        0,
        255
      ],
      "validation": null
    },
    "pendingPipeline": {
      "callbacks": [
        "pending-pipeline"
      ],
      "drawCalls": 0,
      "hooks": [
        {
          "after": 0,
          "before": 0,
          "delta": 0,
          "object": "pending-pipeline"
        }
      ],
      "pixel": [
        0,
        0,
        255,
        255
      ],
      "validation": null
    },
    "readyPipeline": {
      "callbacks": [
        "pending-pipeline"
      ],
      "drawCalls": 1,
      "hooks": [
        {
          "after": 1,
          "before": 0,
          "delta": 1,
          "object": "pending-pipeline"
        }
      ],
      "pixel": [
        79,
        196,
        48,
        255
      ],
      "validation": null
    },
    "success": {
      "callbacks": [
        "success"
      ],
      "copyInvocations": 1,
      "drawCalls": 1,
      "drawReceipts": [
        {
          "frame": {
            "generation": 1,
            "sourceId": 0
          },
          "surfaceEpoch": 1
        }
      ],
      "hooks": [
        {
          "after": 1,
          "before": 0,
          "delta": 1,
          "object": "success"
        }
      ],
      "pixel": [
        255,
        0,
        0,
        255
      ],
      "presentationReceipts": [
        {
          "frame": {
            "generation": 1,
            "sourceId": 0
          },
          "presentationRevision": 3,
          "surfaceEpoch": 1,
          "transferId": 7
        }
      ],
      "syncThrown": null,
      "validation": null
    },
    "synchronousCopyFailure": {
      "callbacks": [
        "synchronousCopyFailure"
      ],
      "copyInvocations": 2,
      "drawCalls": 1,
      "drawReceipts": [
        {
          "frame": {
            "generation": 1,
            "sourceId": 1
          },
          "surfaceEpoch": 1
        }
      ],
      "hooks": [
        {
          "after": 1,
          "before": 0,
          "delta": 1,
          "object": "synchronousCopyFailure"
        }
      ],
      "pixel": [
        0,
        0,
        0,
        255
      ],
      "presentationReceipts": [
        {
          "frame": {
            "generation": 1,
            "sourceId": 1
          },
          "presentationRevision": 3,
          "surfaceEpoch": 1,
          "transferId": 7
        }
      ],
      "syncThrown": "OperationError: Failed to execute 'copyExternalImageToTexture' on 'GPUQueue': Copy rect is out of bounds of external image",
      "validation": null
    },
    "taintedCanvas": {
      "callbacks": [
        "tainted-canvas"
      ],
      "drawCalls": 1,
      "hooks": [
        {
          "after": 1,
          "before": 0,
          "delta": 1,
          "object": "tainted-canvas"
        }
      ],
      "pixel": [
        0,
        0,
        0,
        255
      ],
      "receipts": [
        {
          "draw": {
            "frame": {
              "generation": 1,
              "sourceId": 3
            },
            "surfaceEpoch": 1
          },
          "presentation": {
            "frame": {
              "generation": 1,
              "sourceId": 3
            },
            "presentationRevision": 2,
            "surfaceEpoch": 1,
            "transferId": 9
          }
        }
      ],
      "taintCheck": "SecurityError: Failed to execute 'getImageData' on 'CanvasRenderingContext2D': The canvas has been tainted by cross-origin data.",
      "validation": null
    },
    "zeroVertices": {
      "callbacks": [
        "ordinary"
      ],
      "drawCalls": 1,
      "hooks": [
        {
          "after": 1,
          "before": 0,
          "delta": 1,
          "object": "ordinary"
        }
      ],
      "pixel": [
        0,
        0,
        255,
        255
      ],
      "validation": null
    }
  },
  "completed": true,
  "unexpected": []
}
```

</details>
