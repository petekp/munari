# Surface API proposal (2026-09-04)

> **HISTORICAL PROPOSAL — IMPLEMENTED AND LOCALLY VERIFIED, 2026-09-04.**
> This records the review that led to the refactor. The current contract is
> in the [README](../README.md) and published types; [decision #40](decisions.md)
> records the accepted design, implementation additions, and validation.
> The recommendations and implementation checklist below retain their
> proposal-time wording.

## Recommendation

Let the application declare content once and choose where to render it.
Munari owns preparing the replacement, transferring input, and retaining the
canvas content until it can be removed. A basic Surface needs no identity
hook, subscription hook, or mount flag.

Use `renderIn="page" | "canvas" | "both" | "none"` for that choice.
Use `Surface.DOM` and `Surface.Mesh` for the two presentations, with
`Surface.DOM` reading the root's source by default. Keep `SurfaceCanvas`
as the shared host. Separate observed presentation from motion and readiness.

This changes behavior and lifecycle ownership. Treat it as an API revision,
with naming changes included.

## What the API has to express

These are developer tasks, independent of the current public API:

| Task | Application declares | Munari handles |
| --- | --- | --- |
| Move a card between the page and a scene | Content and a destination | Preparation, transfer, reversal, return, cleanup |
| Keep a live panel in a scene | Content and a mesh presentation | Capture, placement, input, resource lifetime |
| Show content on the page and elsewhere in the scene | Both presentations | Consistent content without duplicate keyboard access |
| Sample live content in another material | A source with no own presentation | Texture availability without waiting for a presenter |
| Animate a custom object around captured content | A scene subtree and motion | Retaining the whole subtree through the handoff |
| Show a renderer-status indicator | An observation of presentation | Reporting the actual hold rather than the request |
| Work without capture support | A page presentation or scene-specific fallback | Preserving native content without starting an impossible transfer |

Optimize for predicting behavior from a small example. Reducing character
count is secondary to removing obligations and ambiguity.

## Findings

### 1. Removing the helper does not require a boolean request

The repeated toggle expression identifies an awkward example. It does not
establish the state space of a Surface. A card moving between two places has
a binary destination; a reflection and a simultaneous page/scene display
have different requirements.

`inCanvas` is a good name for the binary case. Its unresolved question is
what `false` and omission mean when there is a mesh but no page copy, or when
both copies should remain visible. Do not make omission select simultaneous
rendering while `false` selects a handoff. Passing an optional boolean would
then change the relationship between renderers.

**Recommendation:** one `renderIn` choice, defaulting to `page`:

| Value | Requested result |
| --- | --- |
| `page` | The declared page presentation is visible and interactive. |
| `canvas` | The declared mesh presentation is visible; any page presentation yields after a proven handoff. |
| `both` | Both declared presentations remain visible; the page remains the primary keyboard and accessibility presentation. |
| `none` | Neither presentation is shown. The source can still supply a texture to another material. |

This does not create presentations that were not declared. `page`, `canvas`,
and `both` require their corresponding declarations; a missing declaration
needs an actionable diagnostic, not an indefinite transition. Registration
order across React trees must not produce a false diagnostic. A declared
presenter still preparing is different from one that was never declared.

Use existing application state directly:

```tsx
<Surface renderIn={selected ? 'canvas' : 'page'} source={panel}>
  <Surface.DOM />
  <Surface.Mesh />
</Surface>
```

A toggle demonstration can use `setSelected(value => !value)`. Most consumers
should derive the request from selection, dragging, or another application
state instead of maintaining an additional renderer-state variable.

The tradeoff is one ternary at the boundary for binary interactions. In return,
one prop covers the complete request without a second mode prop or a hidden
meaning for `undefined`. If binary transfers are deliberately the only task
this component should support, keep `inCanvas` and give the other tasks an
explicit API of their own. That is a product-scope choice, not a rename.

### 2. Lifecycle ownership needs a component boundary

Deleting `mounted` does not let a child retain a parent that React removes.
The current home hero conditionally mounts an entire `HeroMesh` component;
the logo conditionally mounts a component containing its canvas. These are
larger lifetimes than the Surface mesh itself. The homepage prototype
(`Home.tsx`) remains separate work; the [logo](../apps/lab/src/scenes/logo/Logo.tsx)
is a tracked example.

**Recommendation:** an always-declared `Surface.Mesh` manages its own
presenter lifetime. For custom scene components, provide an always-declared
`Surface.Scene` boundary that mounts and retains its children. It represents
one Surface's contribution to an existing R3F scene; it creates no renderer.

```tsx
const card = useSurfaceHandle('card')

<Surface surface={card} source={panel} renderIn={selected ? 'canvas' : 'page'}>
  <Surface.DOM />
</Surface>

<SurfaceCanvas>
  <Surface.Scene surface={card}>
    <CardObject />
  </Surface.Scene>
</SurfaceCanvas>
```

`CardObject` may use R3F hooks, groups, custom motion, and `Surface.Mesh`.
Those hooks and effects belong below the boundary. Returning `null` from a
mesh does not stop its parent's frame subscriptions or effects.

The boundary mounts before readiness can be earned, retains the subtree
through reversal and return, then releases it after Munari's cleanup duty.
The shared `SurfaceCanvas` stays declared while its Surfaces can use it.
Keeping that host idle and destroying the renderer are separate policies.
A prop on a child cannot safely control an application-owned ancestor.

Remove the public mount obligation only after both an ordinary mesh and a
custom subtree have a proven replacement. Do not delete the helper first and
leave consumers to reconstruct its lifecycle.

### 3. A phase rename would misstate visibility and completion

The proposed direct mapping from `gl` to `canvas` is misleading.
[The crossing law](../packages/core/src/transfer/crossing.ts) enters `gl`
at progress zero, then performs the outward motion while still in `gl`.
[The binding](../packages/react/src/primitives/surface/surfaceHandle.ts)
releases the page only after the qualifying color-writing draw, which is
later than the phase change. A phase can therefore say `gl` while the page
still holds the visible content.

Executing the current law with one eligible presenter and the default timing
on 2026-09-04 produced:

```text
request                  lifting   ramp 0
450 ms, readiness met     gl        ramp 0
150 ms more              gl        ramp 0.25
```

These are raw ramp values from the pure law, not new browser evidence.

**Recommendation:** expose the answers consumers need:

| Question | Proposed observation |
| --- | --- |
| What did the application request? | Its own `renderIn` value |
| Which declared presentations currently hold the content? | `useSurfaceState(...).presented` and `onPresentationChange` |
| Has presenter preparation completed? | `ready` and `onReady`, distinct from presentation |
| How far has motion advanced? | The frame-readable progress API |
| Has motion reached its requested endpoint? | `onMotionComplete` |

`presented` uses `page`, `canvas`, `both`, or `none`. A source with no own
presentation reports `none`; it does not claim that the page is showing it.
These are protocol observations, not proof that arbitrary shaders or
occlusion leave content visible to the eye.

Do not add `useSurfacePhase` merely to power the lamp. The lamp needs
presentation. A public `entering` state, if introduced, must include
preparation and outward motion; `canvas` must have a stated completion
meaning. It cannot be a renamed copy of today's protocol phase.

Remove public flight vocabulary, while preserving the distinctions between
preparation, draw permission, presentation, motion, and release. An internal
protocol state and a consumer observation need not share an enum. Rename
conformance contracts when their terminology changes; change their behavior
only with the corresponding law and decision.

### 4. Declare content once; describe its instances accurately

The current first example declares `source={panel}` and repeats `panel`
inside `Surface.DOM`. A reader must learn what happens if they disagree.

**Recommendation:** `Surface.DOM` renders its part's source when no children
are provided. Explicit children remain an advanced override. An adopted
HTMLElement needs an explicitly authored page presentation; it cannot be
silently cloned with its state and listeners intact.

This removes duplicate authoring, not duplicate React instances. The capture
and page copies still need shared state above the Surface. Local state,
uncontrolled inputs, effects, and IDs are not automatically shared. The homepage prototype tutorial (`HomeTutorial.tsx`) said there was only
one element; that claim must go. That prototype remains separate work.
[React's state model](https://react.dev/learn/preserving-and-resetting-state)
associates state with a component's position in the rendered tree.

Do not require a handle just to declare a Surface. Recommend
`useSurfaceHandle(name?)` for separated trees or an external observer.
`useSurfaceState(handle?)` reads the explicit handle or nearest Surface
context. A name is a diagnostic label, not a global lookup key; two cards
named `card` must remain separate identities.

### 5. Neutral names do not establish renderer compatibility

`Surface.Mesh` describes the object a Three/R3F developer configures. That is
a stronger reason for the name than a prediction about WebGPU.
`SurfaceCanvas` remains a sensible shared-host name. The namespace rule is a
useful convention, not a theorem about dots and containment.

The current [material path](../packages/react/src/primitives/surface/surfaceMaterials.tsx)
uses `onBeforeCompile` and GLSL. Three's
[WebGPURenderer migration guide](https://threejs.org/manual/en/webgpurenderer)
says those material customizations require a different implementation.
Renaming components neither provides nor verifies that compatibility.

Use renderer-neutral names for presentation roles. Preserve specific names
for specific facilities, such as `SURFACE_RADIUS_GLSL`, and describe current
renderer requirements accurately. No renderer abstraction is needed here.

## Proposed first example

This example teaches support, a host, content, and its presentations. It
needs no Surface identity or lifecycle hook. These proposed symbols and
behaviors must be implemented and browser-verified before the example
replaces the live tutorial.

```tsx
import { useState } from 'react'
import { Surface, SurfaceCanvas, useSurfaceSupport } from '@petepetrash/munari'
import '@petepetrash/munari/style.css'

function Example() {
  const [selected, setSelected] = useState(false)
  const [count, setCount] = useState(0)
  const supported = useSurfaceSupport()
  const panel = (
    <div style={{ width: 320, height: 180 }}>
      <button onClick={() => setCount(value => value + 1)}>
        Pressed {count} times
      </button>
    </div>
  )

  return (
    <>
      <button disabled={!supported} onClick={() => setSelected(value => !value)}>
        {selected ? 'Show on the page' : 'Show in the canvas'}
      </button>
      {supported && (
        <SurfaceCanvas
          pointerMode="surfaces"
          frameloop="demand"
          style={{ position: 'fixed', inset: 0 }}
        />
      )}
      <Surface source={panel} renderIn={selected ? 'canvas' : 'page'}>
        <Surface.DOM />
        <Surface.Mesh />
      </Surface>
    </>
  )
}
```

The capability check gates the host and the canvas action. It does not
remove native content or toggle the host during an ordinary return.

`useSurfaceSupport()` returns a boolean: false on the server and through
hydration, then the capture-capability answer. It does not promise that a
particular renderer, material, or Surface is ready. Pair it with
`supportsSurfaces()` for event handlers and diagnostics. Keep the lower-level
capability report available for diagnostics.

An unsupported canvas request retains the declared page presentation,
reports `presented: 'page'`, and starts no transition or perpetual work claim.
Munari does not rewrite application state. An application that asks to enter
a canvas-only interaction must still branch at the gesture. A canvas-only
Surface has no page fallback unless the application supplies one.

## Implementation order and acceptance

1. **Finalize requests and observations.** Cover all four requests, defaults,
   unsupported behavior, and changes during a handoff. `both` cannot hide the
   page while the canvas prepares; `none` intentionally hides presentations
   but does not destroy a source sampled elsewhere. Define motion behavior
   when switching to or from these choices before implementing them.
2. **Implement declaration and lifetime ownership.** Add source inheritance
   for `Surface.DOM`, managed mesh lifetime, and the custom-scene boundary.
   Distinguish declared parts/presenters from mounted resources so deferred
   mounting cannot erase the all-parts readiness requirement.
3. **Migrate the complete contract and consumers.** Update components, props,
   exported types, state fields, callback values, driver inputs, support
   helpers, examples, and instrument assertions. Delete the helper after its
   obligations are covered. No compatibility aliases are needed for this
   private cutover.
4. **Prove behavior.** Preserve all-part handoffs and draw evidence. Exercise
   entry, return, reversal during preparation and motion, reversal during
   cleanup, source replacement, missing declarations, Strict Mode, separated
   trees, and a shared canvas. Verify a custom subtree stops frame work after
   release. Check controlled input continuity across page and capture copies.
5. **Update teaching material and record the decision.** Fold the accepted
   contract into the decision ledger, update the glossary and shipped skill,
   then mark this proposal historical. Teach support and shared content state
   before readers can build a gesture that strands them.

The migration extends beyond the landing page: flight, genie, logo, controls,
candidate, gallery, crystal, and other scene consumers; public-entry and
compile-only tests; affected registry copies and welds; the operating guide,
system model, README, and instruments. Historical proposals remain historical
rather than being rewritten as current API documentation.

After runtime changes, run `npm test`, `npm run typecheck`, `npm run lint`,
and `npm run build`. Run the demand-handoff, pointer-handoff, lifecycle/idle,
and affected scene gates serially with `STRICT_CAPABILITY=1`; verify native
fallback separately with `gate:degraded`. Include a real controlled input in
both paths. A renamed symbol or a zero-exit capability skip establishes none
of those behaviors.
