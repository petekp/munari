# System model

**Status: current model, 2026-09-04.** The Surface API revision is implemented
and locally verified; [decision #40](decisions.md) records the evidence.
Use the [operating guide](agent-workflow.md) for a task and the
[delivery plan](agent-system-plan.md) for proposed tools.

## Purpose

An author supplies live content and a visual intent. Munari coordinates the
renderer handoff while the DOM retains content and interaction. An agent
needs to identify the owner of a change, use that owner's control, and obtain
evidence for the result. The same rule applies to a human author.

The useful unit of work is a verified change to an experience. A passing
script, a new parameter, or a rendered mesh supplies only part of that proof.
The [glossary](../CONTEXT.md) fixes the terms used below.

## The linked abstractions

Read this stack from intent toward pixels. Read evidence back toward intent.
These are levels of reasoning, not new packages or a proposed dependency tree.

```text
User intent and constraints
    ↓ choose the outcome, allowed changes, and required proof
Application or recipe
    ↓ owns content state, scene policy, gestures, and native fallback
Surface declaration
    ↓ binds content identity, parts, presentations, and requested destination
Handoff protocol and renderer binding
    ↓ coordinate sources, presenters, work claims, and qualified receipts
Browser layout → capture → texture upload → draw → eligible presentation
    ↑ observations tied to the same source, lifetime, and frame
Tests and browser gates → measured limits → decisions and reusable recipes
    ↺ reduce uncertainty in the next task
```

Evidence crosses the stack. It is not a final testing layer detached from
implementation. Each behavior needs an owner and a way to observe that owner.
A later frame cannot repair the evidence for an earlier handoff.

## One owner for each kind of state

| Owner | Owns | Boundary |
|---|---|---|
| Application and recipe | Content state, `inScene` request, visual treatment, gesture outcome, scene tuning | Does not declare a draw successful or force renderer release |
| Surface identity | A stable reference across independent trees | Does not own DOM, GPU resources, or public protocol-writing commands |
| Surface declaration | Controller claim, source and part registration, `inScene`, timing and callbacks | Does not own a scene's material or artistic policy |
| Source runtime | Capture, texture, painted dimensions, density, measured chrome | Does not own application state or a visible presenter |
| Mesh presenter | Mesh, material, placement, hit region, draw evidence | Does not own the source or decide the crossing law |
| Canvas host | Shared renderer boundary, registration, pending work and final presentation | Does not replace content state or scene motion policy |
| Core laws | Coordinate, paint, pointer, transfer, measurement, and physical-control contracts | Do not absorb a demo's visual settings |
| Instrument | A scoped measurement and its limits | Cannot grant itself permission to change the law to make a check pass |

The code homes remain those in [AGENTS.md](../AGENTS.md#shape): core has zero
runtime dependencies; the Three/R3F binding is the sole published package;
recipes stay copyable; the lab consumes public entries. No agent-specific
renderer, state store, or command bus sits beside these owners.

Source anchors: [handle and state](../packages/react/src/primitives/surface/surfaceHandle.ts),
[declaration](../packages/react/src/primitives/surface/SurfaceRoot.tsx),
[source runtime](../packages/react/src/primitives/surface/surfaceSourceRuntime.ts),
[presenter](../packages/react/src/primitives/surface/SurfaceMesh.tsx), and
[host](../packages/react/src/primitives/surface/surfaceHostRegistry.ts).

`Surface.HTML` retains one React/DOM instance and reserves its page layout while
its pixels appear in the scene. Page targets move that retained instance between
layout parents without remounting it. `Surface.Scene` retains custom scene children
through preparation, reversal, return, and cleanup. It does not own the shared
`SurfaceCanvas` lifetime. Multiple hosts need distinct IDs and explicit page-side
associations; scene-side declarations belong to their enclosing host.

State, progress, and driver hooks read the nearest Surface identity or an explicit
handle. A mesh with `presentation="manual"` supplies input mapping while an advanced
manual presenter owns its final draw evidence. It must cover every declared part
and report the actual compositor draw. `sampledParts` is draw coverage, separate
from the count of interactive scene poses sharing a source.

## Choose the presentation relationship first

| Intent | Relationship | Main consequence |
|---|---|---|
| Move page content into the scene and back | Exclusive | Request `inScene={false}` or `true`; keep the outgoing hold until the protocol accepts the incoming evidence |
| Show the page and a mesh version together | Twin | Use `useElementCapture` on the native element and render its captured frames; native HTML keeps keyboard and accessibility ownership |
| Present content only within the scene | Resident | Use `SceneSurface`; keep a real source for content and input |
| Sample page content in a reflection or another material | Source-only | Use `useElementCapture` or `CaptureContent`; capture readiness is independent of a Surface handoff |
| Use pixels produced by a caller-owned canvas | Frame source | Publish complete frames and distinguish upload/draw from presentation |

A resident has no page handoff delay or protocol frame loop. It still needs
presenter proof for readiness and separate evidence for actual presentation.

Marble Hand illustrates the fourth relationship: native page content supplies
reflections while a hand and shadow draw over it. Plume keeps native editing
outside its captured ink. Neither requires turning the visible page into a
WebGL replica. See their contracts in [the lab guide](../apps/lab/README.md).

## Keep the observable facts separate

| Question | Current read or signal | What it does not prove |
|---|---|---|
| Can this browser capture DOM? | `useSurfaceSupport()`, `supportsSurfaces()` | Permission to act, successful capture, or correct appearance |
| What did the app request? | `useSurfaceStatus().requestedInScene` / `inScene` | Current renderer hold |
| Which declared presentations hold the content? | `useSurfaceStatus().presentation`, `onPresentationChange` | Material quality or correct occlusion |
| Have required presenters made eligible first draws? | `sceneReady`, `onReady` | That a color-writing frame reached the presentation boundary |
| How far has motion moved? | `progress`, `onMotionComplete` | Presentation proof or completed teardown |
| Which pixels and boxes belong together? | Paint, frame and presentation receipts; painted size and anchors | That a live layout measurement matches an older texture |
| Is capture doing work? | `paintStats()` deltas from `/advanced` | Total GPU cost, visual quality, or input correctness |

`SurfaceStatus` reports `requestedInScene`, `presentation`, `sceneReady`,
`supported`, `reason`, and `isTransitioning`. `SurfacePresentation` is
`page | scene | null`; motion destinations are `page | scene`. Raw progress is
shared by handles, drivers, and advanced frame reads; an eased read is named
explicitly. These observations do not expose the private registration ledgers.
explanation view in [the plan](agent-system-plan.md#p3-bounded-read-only-explanation)
does not exist yet.

Receipt access depends on the layer. Ordinary `Surface` callbacks report
semantic lifecycle state through `onPresentationChange`, `onReady` and
`onMotionComplete`; they do not expose paint receipts. `FrameSurface` exposes
`onFrameDrawn` and `onPresented`. Lower-level DOM sources expose `currentPaint()`
and `subscribePaint()`. Use the existing painted-size and anchor hooks for
ordinary DOM-aligned scene work.

The evidence chain has five different boundaries:

1. The browser lays out the live content.
2. A successful paint supplies a raster and an immutable paint receipt.
3. The renderer uploads a particular source generation.
4. A presenter draws that uploaded generation.
5. A qualified color-writing presentation meets the transfer requirement.

Anchor measurements form a separate transaction. The binding stamps them
against a successful paint and commits them when their source and generation
match the presenter's drawn pixels.

A write-free warm-up can establish readiness. A cube-map draw can update a
reflection. Neither alone releases a native page hold. The binding can also
close a supported offscreen path at the host's final presentation boundary;
the offscreen callback itself is not that proof. Shader discard, depth and
occlusion still need scene evidence.

Read [authoring: one paint generation](authoring.md#keep-texture-attachments-on-one-paint-generation)
and decisions #24–27 in [the ledger](decisions.md) before changing these seams.

## Agent control and evidence form one loop

For a change, name the desired result, the state owner, the allowed action,
and the observation that will confirm it. Use a small counterexample to show
that the observation can fail. Keep the action and proof linked through the
same target and source lifetime.

For example, changing Plume type size requires new letter shapes and
paint-matched anchors. A slider value proves the request. Matching native and
capture styles prove layout agreement. A browser sample of the released ink
tests the visual result. Reset must preserve the native text. The
[Plume gate](../instruments/plume/run.mjs) checks these different claims.

An agent should read existing state through public observations or an
explicit instrument. It must not call private protocol writers to produce a
desired status. Capability and user authorization remain separate questions.

## Retain the smallest useful lesson

Preserve a failure as a reproducible claim, with its scope and invalidation
condition. Put the result in the existing owner:

| Finding | Durable home |
|---|---|
| Browser behavior and its conditions | [Platform measurements](platform.md), with a runnable instrument |
| General coordination law | [Conformance contract](../tests/conformance/README.md) and core implementation |
| React/Three lifecycle behavior | Test beside the binding module |
| HTML limitation | [Authoring rule](authoring.md), linked to the measurement |
| Scene policy or artistic tuning | Scene or registry, with its local tests and visible checks |
| Trade-off or rejected approach | A dated decision or amendment in [the ledger](decisions.md) |
| Work that does not exist yet | [Delivery plan](agent-system-plan.md), with an acceptance condition |

A reusable lesson must help a later agent find the owner, reproduce the claim,
or avoid a known failure. Update the existing rule before adding another
summary. Retain dated evidence from older revisions and browsers, but do not
reuse it as current proof without checking its applicability. Keep raw logs
and screenshots as scoped artifacts, not mandatory context for every task.

Decisions #21, #32, and #37 also permit removal: tests alone do not justify an
unused abstraction. Better accumulated knowledge can mean fewer modules and
less prose to load.
