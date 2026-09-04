# Agent operating guide

**Status: current workflow, 2026-09-04.** The Surface API revision is implemented
and locally verified; [decision #40](decisions.md) records the evidence.
The [agent-system plan](agent-system-plan.md) contains unbuilt work. Read only
the route that fits the task; the [system model](system-model.md) explains the
ownership and evidence behind it.

## Establish the working context

In a checkout, read `AGENTS.md`, confirm the repository and branch, and inspect
the dirty files before editing. Preserve unrelated work. Use the local source
and public entries for this checkout, not an example from another revision.

In an installed package, start with its README, skill, `index.d.ts`, and
`advanced.d.ts`. The current staging script does not ship the full repository
docs or registry. If a required document is missing, obtain source matched to
that release or report the gap. A link to GitHub `main` does not establish a
version match. [P1](agent-system-plan.md#p1-version-local-package-guidance)
plans to close this gap; it is not fixed by this guide.

Choose the [presentation relationship](system-model.md#choose-the-presentation-relationship-first)
before copying code. Keep content and gestures native where the requested
effect does not need a handoff.

## Route the task to its owner

| Task | Start here | Control and completion | Smallest relevant evidence |
|---|---|---|---|
| First Surface or separated DOM/R3F trees | [Consumer setup](../README.md#your-first-surface), [public entries](../packages/react/src/index.ts), [compile-only examples](../tests/surfaceTypes.tsx) | A basic Surface needs no identity; use `useSurfaceHandle(name?)` or `createSurface(name?)` for separated trees. `renderIn`, timing and callbacks belong on `Surface` | Typecheck the consumer; check the real gesture and native fallback |
| Page ↔ canvas handoff | [API naming contract](api-naming-proposal.md), [crossing contracts](../tests/conformance/transfer/crossing.test.ts) | `renderIn="page" | "canvas"` requests; `useSurfaceState().presented` and `onPresentationChange` confirm the hold; `Surface.Scene` retains custom scene children | `gate:dom-surface-demand`; add `gate:lifting-pointer` when input ownership changes |
| Custom material or captured reflection | [Material context](../packages/react/src/primitives/surface/surfaceContext.ts), [Marble Hand](../apps/lab/src/scenes/marble-hand/MarbleHand.tsx) | `useSurfaceTexture()` inside `<Surface.Mesh>`; nullable `useSurfaceTextureOf(handle)` outside it | `gate:shaders`; the scene's visual gate for reflected content or appearance |
| DOM-aligned controls or responsive layout | [Anchor API](../packages/react/src/primitives/surface/SurfaceAnchor.tsx), [anchor recipe](../registry/surface-anchors/README.md), [Knobs](../apps/lab/src/scenes/knobs/Knobs.tsx) | Named anchors from the painted generation; manual hardware size remains scene-owned | Anchor contracts, then `gate:knobs-resize`; box agreement alone is not pixel proof |
| Deformation and pointer accuracy | [Deformation API](../packages/react/src/primitives/surface/surfaceDeform.ts), decision #35 | Move geometry through the public seam so raycast and drawn shape agree | The matching pointer gate, such as `gate:fisheye-pointer` or `gate:crystal-pointer` |
| Pixels from a caller-owned canvas | [FrameSurface](../packages/react/src/primitives/FrameSurface.tsx), [advanced entry](../packages/react/src/advanced.ts) | Publish a complete frame; distinguish frame-draw and presentation receipts | `gate:frame-surface` |
| Physical controls and focus | [Dial](../packages/react/src/primitives/controls/Dial.tsx), [focus contract](focus.md), [focus policy recipe](../registry/focus-orbit/README.md) | Semantic control/focus state; scene owns camera policy | Local control/focus tests, then the affected native keyboard and pointer paths |
| Particle or hand tuning | [Plume values](../apps/lab/src/scenes/plume/plumeTuning.ts), [hand values](../apps/lab/src/scenes/marble-hand/marbleHandTuning.ts) | Existing panel and state owner; verify stored units, replay/recapture, copy and reset | `gate:plume` or `gate:marble-hand`, with the real route |
| Idle cost, release or leaks | [Paint counters](../packages/core/src/paint/htmlInCanvas.ts), [instrument guide](../instruments/README.md) | Compare scoped counters before/after; observe final clearing draw and owned-resource cleanup | `gate:idle-zero`; add the lifecycle gate for the changed source |

The root entry is `@petepetrash/munari`. Use `/advanced` for a deliberate
lower-level need. Do not reach around either entry from the lab or registry.
An advanced manual presenter must report actual draw evidence; it is not a
shortcut for forcing a status. `SurfacePresentation` describes the current
hold (`page`, `canvas`, `both` or `none`); `SurfaceDestination` describes a
motion target (`page` or `canvas`).

The handle parameter is optional for state, progress, and driver reads; with
no handle, they use the nearest Surface identity across page and scene trees.
`Surface.Mesh presentation="manual"` keeps its proxy and pointer relay while
an advanced manual presenter supplies final draw evidence for every declared
part. It must report each part's actual final compositor draw.

## Run a small, decisive experiment

1. State the visible outcome and what must stay unchanged, such as text,
   caret, renderer hold, or an unrelated scene's settings.
2. Find the one state owner and read the relevant contract before editing.
3. Pick an observation that can distinguish success from the likely failure.
   Increasing paint counts does not prove that a reflection contains the H1.
4. Make the smallest complete change through that owner. For tuning, vary one
   cause at a time, record stored values, and use the real apply/reset path.
5. Wait for observable state or a qualifying receipt with a deadline. Do not
   use a fixed sleep as proof of readiness.
6. Check the outcome and its counterexample. Record what the test did not
   measure. Run the required broader checks before calling runtime work done.

For visual work, open the real `?scene=` route. Use `?bare` only when the
instrument's contract requires it; bare mode can remove content under test.
Read [the authoring rules](authoring.md) before changing captured markup.

Run the relevant browser gate with `STRICT_CAPABILITY=1` when claiming that
the HTML-in-canvas path passed. Check the no-flag path separately. Some gates
do not need this capability; [their contracts](../instruments/README.md) say so.

## Diagnose by the missing proof

| Observation | Next check |
|---|---|
| Capability absent | Test the native outcome; label the enhanced path untested |
| Source-only texture updates but `ready` is false | Confirm that `renderIn="none"` is intended; do not manufacture readiness |
| `ready` is true but a handoff waits | Check writing versus warm-up draws, required parts, source lifetime, and host presentation |
| Texture changes but the visible result does not | Check the consuming material, drawn generation, target framebuffer and scene pixels |
| Anchors align after settling but jump during resize | Compare the paint generation and placement in the same frame |
| Pointer misses a visible control | Check coordinate space, geometry, input hold and native event outcome |
| Motion finishes but old pixels remain | Check `Surface.Scene` cleanup duty, final post-removal draw and resource lifetime |
| Screencast reports a freeze | Check observer health before blaming rendering; see [platform item 13](platform.md) |
| A gate exits zero | Read its result: a capability skip is not behavior proof |

## Bound the cost

- Search the task route and owning symbols before reading long decision
  history. Fetch the cited decision only when the boundary needs explanation.
- Reuse a healthy dev server after verifying its cwd and port. Record any
  process, page, or capture session you create and clean up only those resources.
- Run GPU/browser gates in series. Parallel Chrome exhausted the CI runner;
  [.github/workflows/ci.yml](../.github/workflows/ci.yml) records the constraint.
  Parallel source reads and independent analysis remain useful.
- Start with the narrow test that can disprove the claim. Do not replace the
  [required checks](../AGENTS.md#verifying-changes) with that narrow result.
- For documentation-only work, check links, current symbols, status labels,
  and affected examples. Rerunning unrelated GPU scenes adds no evidence.
- Reuse a result only when revision, dirty scope, browser/capability, scene,
  settings, viewport/DPR, and tested claim still match. Otherwise recheck the
  changed boundary. Never reuse a stale receipt as authority for a new action.

## Finish with evidence that the next agent can use

Report the change, checks and their actual outcomes, limits, and the route or
artifact to inspect. Preserve a useful lesson in
[its existing canonical home](system-model.md#retain-the-smallest-useful-lesson).
Do not store a second API reference, a transcript dump, or an unexplained
number. A plan item closes only when its named acceptance evidence exists.

Available commands come from [package.json](../package.json). CI membership
comes from [the workflow](../.github/workflows/ci.yml). Instrument purpose and
limits come from [the instrument guide](../instruments/README.md). These have
different jobs; a copied gate count is not another source of truth.
