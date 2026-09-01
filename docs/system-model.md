# System model

**Status: current model and design constraints.** Checked against source on
2026-08-31. This page explains the existing system; it does not add an API.
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
    ↓ binds content identity, parts, presentations, and requested view
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
| Application and recipe | Content state, requested view, visual treatment, gesture outcome, scene tuning | Does not declare a draw successful or force renderer release |
| Surface identity | A stable reference across independent trees | Does not own DOM, GPU resources, or public protocol-writing commands |
| Surface declaration | Controller claim, source and part registration, view and timing | Does not own a scene's material or artistic policy |
| Source runtime | Capture, texture, painted dimensions, density, measured chrome | Does not own application state or a visible presenter |
| WebGL presenter | Mesh, material, placement, hit region, draw evidence | Does not own the source or decide the crossing law |
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
[presenter](../packages/react/src/primitives/surface/SurfaceWebGL.tsx), and
[host](../packages/react/src/primitives/surface/surfaceHostRegistry.ts).

## Choose the presentation relationship first

| Intent | Relationship | Main consequence |
|---|---|---|
| Move page content into WebGL and back | Exclusive | Request `view`; keep the outgoing hold until the protocol accepts the incoming evidence |
| Show the page and a WebGL version together | Twin | Omit exclusive view control; the page does not release its presentation |
| Present content only within the scene | Resident | Keep a real source for content and input; no page presentation is required |
| Sample page content in a reflection or another material | Source-only | A working capture can have no presenter and `ready: false` |
| Use pixels produced by a caller-owned canvas | Frame source | Publish complete frames and distinguish upload/draw from presentation |

Marble Hand illustrates the fourth relationship: native page content supplies
reflections while a hand and shadow draw over it. Plume keeps native editing
outside its captured ink. Neither requires turning the visible page into a
WebGL replica. See their contracts in [the lab guide](../apps/lab/README.md).

## Keep the observable facts separate

| Question | Current read or signal | What it does not prove |
|---|---|---|
| Can this browser capture DOM? | `useSupportsDOMSurfaces()`, `supported` | Permission to act, successful capture, or correct appearance |
| What did the app request? | `targetView` | Current renderer hold |
| Who holds the exclusive presentation? | `presentedView`, `onPresentedViewChange` | Material quality or correct occlusion |
| Have required presenters made eligible first draws? | `ready`, `onReady` | That a color-writing frame reached the presentation boundary |
| How far has motion moved? | `progress`, `onMotionComplete` | Presentation proof or completed teardown |
| Must the WebGL side remain mounted? | `isWebGLMounted`, `useSurfaceView().mounted` | That its pixels should remain visible |
| Which pixels and boxes belong together? | Paint, frame and presentation receipts; painted size and anchors | That a live layout measurement matches an older texture |
| Is capture doing work? | `paintStats()` deltas from `/advanced` | Total GPU cost, visual quality, or input correctness |

`SurfaceState` is a supported semantic read. It is not a joined explanation
of the private part, presenter, source, and host ledgers. The bounded
explanation view in [the plan](agent-system-plan.md#p3-bounded-read-only-explanation)
does not exist yet.

Receipt access depends on the layer. Ordinary `Surface` callbacks report
semantic lifecycle state; there is no `Surface.onPainted` or `Surface.onPresented`
prop. `FrameSurface` exposes `onFrameDrawn` and `onPresented`. Lower-level DOM
sources expose `currentPaint()` and `subscribePaint()`. Use the existing
painted-size and anchor hooks for ordinary DOM-aligned scene work.

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
