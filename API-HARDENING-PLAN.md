# Plan: harden the public API

**Status: proposed, 2026-09-05.** This is the next implementation plan. The Chrome
checks below ran against the existing experiment; no API fixes were made while
preparing this plan. Revised 2026-09-06 after one read-only Claude Fable 5.1 review at xhigh
and independent source/test verification. Review suggestions are planning input,
not evidence that their implementation has shipped.

The goal is an API whose first example works, whose names explain its behavior,
and whose advanced cases have explicit ownership and regression tests. We can
reach that milestone with a representative sample of labs. Migrating every lab
is a later integration step.

## Current starting point

- The main checkout is `pkp/site-fit-and-finish` at `c9dc2f3`, with independent
  website, Flight, Knobs, and lint work in progress.
- The API experiment is in `/private/tmp/munari-api-resolution-worktree`. It
  contains useful implementations and broad demo adaptations, but its `Proof`
  exports coexist with the old API. Its copied website is not the latest site.
- The ordinary suite last passed 1,469 tests, typechecks, lint, and build. That
  is useful baseline evidence, not a hardening verdict: five original focused
  reproductions still fail, and the convenience-host checks expose two more
  composition gaps.
- The September 5 headed Chrome check found another regression: the compact starter
  reports a scene presentation but its counter is blank and unclickable when
  the canvas sits inside the page. `SurfaceMesh.placeOnDom` passes a client
  rectangle to `matchDomTransform` with canvas dimensions but no canvas origin.
  The old fullscreen examples did not expose this coordinate mismatch.

Start by preserving the experiment and its evidence, recording the exact
source baseline, and selecting the package changes plus the sample callers.
Do not copy its whole website snapshot over the active checkout. Compare each
sample against the current website and Flight/Knobs changes during integration.

Before accepting Flight as sample evidence, port the current main checkout's
`flightGestures.ts` capture-phase listener fix and its regrab/cancellation tests.
Also carry its explicit animation-lifetime policy into the experimental
`SurfaceCanvas`: physics keeps frames alive while a flight exists, then returns
to demand rendering after cleanup. Both checkouts already use `SurfaceCanvas`.
Do not copy an entire stale Flight file or assume the present experiment includes
those uncommitted fixes.

## 1. Make the smallest example a reliable contract

**Owners:** `SurfaceMesh.tsx`, `matchDom.ts`, the HTML binding, and HomeStarter.

Fix the inset-canvas placement defect first. Keep these three spaces explicit:

1. The page slot's client rectangle in viewport CSS pixels.
2. The GL renderer canvas's current client rectangle, including its origin and
   CSS scale. Measure it when placing or checking placement; a cached R3F size
   snapshot is not the authority for the current client-space position.
3. The parked capture canvas's coordinate space, represented by the existing
   marker and used by the native/warm input rigs. This is not the GL viewport.

Choose a binding-level conversion: subtract the GL canvas client origin from
the content's client rectangle and normalize against that canvas's client width
and height. Keep `ViewportLike` and `rectToNdc` as local-coordinate core laws;
no origin field or core behavior change is needed for this fix. Use consistent
coordinate facts for rendering and input. Preserve the documented restrictions
on unsupported transform chains.

The installed R3F measurement does observe scroll, with a debounce. The problem
is relying on a potentially stale snapshot and omitting the GL canvas origin,
not an absence of scroll observation in R3F.

Extend the existing `api-instance` one-instance fixture with a minimal stateful
child counter in an inset, scrolled, and scaled canvas. It must
work in a fullscreen canvas and an inset canvas, after scrolling, resizing,
and positive ancestor scaling, with perspective and orthographic cameras.
Verify all four corners and click the visible button. Assert original DOM
identity and child-local state after returning to HTML.

The current Chrome failure becomes a regression in its owning test/instrument.
A label saying “Drawn by the scene” is not sufficient evidence. The counter
must be visible in the expected box and respond there. Correct the nearby
tutorial prose that still describes two React instances.

**Exit:** the simplest copyable example passes a real Chrome pointer round trip
at desktop and mobile widths, with no blank interval, unexpected layout shift,
or duplicate live component. During delayed preparation, also inspect the visible
caret, focus ring, hover treatment, text, and selection. Moving or snapshotting
content must not itself introduce a visible discontinuity; intentional author
feedback remains allowed. This also validates the example we use to explain
the API to newcomers.

## 2. Settle the public vocabulary and component responsibilities

Keep these responsibilities unless a working sample demonstrates a simpler
equivalent:

| Job | Public shape |
|---|---|
| Hand one HTML instance between page and scene | `Surface inScene={boolean}` |
| Add custom scene code to that handoff | `Surface.Root`, `Surface.HTML`, `Surface.Scene`, `Surface.Mesh`, `Surface.Anchor` |
| Draw HTML that belongs in the scene | `SceneSurface` and its explicit composition form |
| Sample a native element that stays in place | `useElementCapture` |
| Supply separately authored capture content | `CaptureContent` |
| Own a renderer, camera, placement, and lights | `SurfaceCanvas` |

`Surface.Mesh` supplies a flat representation of the HTML. Application code
owns extrusion, deformation, lighting, and animation. The first example must
not imply that setting `inScene` generates a flight effect.

**Recommendation: leave the optional `Munari` wrapper out of the supported
public API for now.** The real sample callers already use `SurfaceCanvas`.
The wrapper adds another `scene` prop, settings object, and host identity rule,
and its default/scoped host behavior is currently inconsistent. Removing that
extra path is preferable to making newcomers learn two setup models. Preserve
its failing checks as the reason for removal; replace its instrument callers
with explicit canvases. If a later experiment earns the wrapper back, it must
create unique automatic identities and share exactly one host-resolution rule
with every Surface form.

For explicit canvases, retain the simple rule: one unnamed host is allowed;
multiple page-addressed hosts use unique IDs. Copyable reusable examples use
React `useId` within a shared client React runtime. Independently server-rendered
and hydrated roots need distinct, matching React `identifierPrefix` values or
explicit document-unique host IDs; test that setup rather than assuming IDs from
separate server renders are unique.

Page-side declarations use an explicit association when supplied. Scene-side
declarations belong to their enclosing canvas; a conflicting explicit `canvas`
prop must error instead of being ignored or attempting to move R3F children to
another renderer. Test matching, conflicting, and ambiguous associations, mount
order, nested canvases, and multiple React roots.

Unify the status contract. Recommended vocabulary:

- `requestedInScene`: the author's boolean intent, with the same meaning in
  every reader, including unsupported fallback.
- `presentation`: `page`, `scene`, or `null` when no presentation currently
  exists, including initial waiting and scene-only unavailability.
  The high-level API does not expose the old `both`/`none` request vocabulary.
- `sceneReady`: preparation evidence, separate from actual presentation.
- `isTransitioning`: a handoff in progress, not every decorative animation.
- Capability and an unavailable reason remain distinct from readiness.

An effective target can differ from author intent. Name it `targetInScene` in
the advanced frame read, while `requestedInScene` always retains author intent.
Both reads come from one controller. The postcard's advanced flight state
machine uses the effective target to reset motion and the accepted presentation
to start flight; it must not silently change to reading author intent when this
field is renamed. The beginner examples need neither internal targets nor rigs.

Apply the vocabulary to all public observations, not only the status hook:

| Surface API observation | Candidate meaning |
|---|---|
| `onPresentationChange`, status/frame `presentation` | `page`, `scene`, or `null` for no current presentation |
| `onMotionComplete` and destination types | `page` or `scene` |
| String-valued driver target | `page` or `scene` |
| Normalized motion-hook `position` and numeric `target` | Raw 0..1 value; 0 is page, 1 is scene |
| Motion-hook `scenePresented` | Accepted scene presentation, not a pointer-eligibility query |
| Frame draw permission | Permission for the impending pass, never a presentation receipt |

At the candidate boundary, legacy `page` maps to `page`, `canvas` to `scene`,
and a current absence (`none`) to `null`. A simultaneous legacy `both` hold has
no honest single-presentation mapping: keep it in the legacy reader and reject
mixing that handle into the candidate reader with a clear migration diagnostic.
Do not silently choose one side. Pin the before-first-presentation and
unsupported cases, and audit `useSurfaceState`, `useSurfaceProgress`,
`useSurfaceDriver`, `useSurfaceInstance`, their exported types, and handle reads
so overlapping old APIs do not leak back into the candidate contract. An
identity driver must preserve its raw input; eased reads must be named and
specified separately.

Rename the companion hook to **`useSurfaceBeforeRender`** if retaining its
current per-render-pass behavior. Its contract is: pose writers run, world
matrices update, the callback runs, then that scene is rendered. It can run
more than once in an animation frame. Physics advances in its own single frame
step; this callback updates companions from the resulting pose. Keep draw
permission separate from an accepted presentation receipt. Pass the actual draw
camera and render-target identity. The current implementation filters out every
camera except the R3F default; remove that limitation for a callback associated
with the scene containing the mesh, rather than publishing the wrong camera.
Test the default camera, a second camera, multiple targets/passes, and earlier
companion draw order. Measure the active-subscriber path: the current hook
updates world matrices before Three updates them again. Preserve the update
needed after companion mutations; do not remove it merely to reduce a count.

**Exit:** four complete examples can be explained from their code: basic
handoff, physical controls, scene-only HTML, and native-element capture.
Every helper is identified as library or application code. Type checks accept
those callers and reject conflicting source-input props, missing required sizes,
wrong tuple shapes, unsupported prop combinations, and manual proxies claiming
sampled-source draw evidence. Runtime tests enforce one source owner per capture
handle and validate dimension values; distinguish an unmeasured zero-area element
from invalid authored data. TypeScript cannot detect two components claiming the
same handle. Update `index.test.ts`, `tests/surfaceTypes.tsx`, and the instrument
callers with the wrapper removal. Record the vocabulary before the public rename.

## 3. Close the original correctness findings

**Owners:** Surface store/root/host registration, native route, presenter,
pointer conformance, and their existing browser instruments.

### Presentation and validation

- Retain the resident-hold and raw-driver fixes, and move their reproductions
  into permanent owner tests. Include repeated draws/ticks, reversal, driver
  removal, unmount, source-only cleanup, and zero resident protocol work.
- Replace the zero-delay host-mount guess with lifecycle-based validation.
  A supported request can wait for its host without a false missing-mesh error.
  Once the host and stable declarations are ready, real omissions still error.
- Implement the agreed **development-only, ten-second no-host warning**. Warn
  once per uninterrupted waiting episode; do not invoke `onError`, alter state,
  or stop waiting. Cancel on host mount, request change, and unmount. No timer
  in production or unsupported fallback, and no perpetual work claim. The ten
  seconds is a diagnostic policy, not a readiness or animation budget.
- Cover a second waiting state: host/runtime and a Scene declaration exist,
  but no presenter is registered, a declared part is uncovered, or the source
  has not produced a usable frame. The current controller can retain work
  indefinitely with no error. Classify this as waiting for preparation, not a
  missing declaration or successful presentation. Keep the page usable and
  wake on presenter/source/readiness changes; do not render or tick forever
  when those missing inputs are the only possible progress.
- Use a development-only warning after ten seconds of one uninterrupted
  preparation-wait episode, naming the missing evidence. It has the same
  non-disruptive semantics as the no-host warning: no forced readiness, no
  `onError` for legitimate deferred content, no state change, and cancellation
  when the blocking condition resolves or changes, the request changes, or the
  owner unmounts. Unrelated paints and React renders must not reset the deadline.
  Known capture failures still use their actual error/fallback path. Test a
  never-arriving presenter, a late presenter, and an unusable source.
- Account for both host claims and the HTML binding's independent rAF loop.
  A necessary placement observer is distinct from a progress-polling loop;
  document its purpose and cost instead of claiming that zero host claims
  alone proves the waiting surface is idle.
- Keep valid declared-but-unrequested scenes quiet. Document that asymmetric
  policy. Do not resurrect a warning that fires on every resting handoff.
- Use the new HTML/page-target wiring for separated layouts. Remove the old
  broken `Surface.DOM` contract atomically with its consumers during cutover;
  do not label that old exported behavior fixed while it still exists.

### Input ownership

- Include both native scene routing and the HTML binding's preparation-time
  warm rig in one per-source ownership/arbitration model. Park/release the old
  owner before changing rig, source, pose owner, or input mode. The warm rig is
  page-owned input while the visible page is an inert snapshot: it must preserve
  the original HTML's interactivity. A scene mesh's `pointerEvents="none"` does
  not disable the page button during preparation. Test that distinction, and
  check effective inertness for the presentation actually receiving input.
- Reacquire the native rider claim and refresh its lift-dependent state when
  the source canvas/root changes, even if the route name remains native.
- Decline native routing for a source the browser cannot interact with,
  including inert captures. Enforce `pointerEvents="none"` on every route.
- Track the actual library-created plane. Replaced or unknown geometry and
  authored hit policies use the conservative relay path.
- Reproduce original finding #8 in Chrome: two differently posed presenters,
  one shared source, native and relayed input. Measure actual clicked targets
  and coordinates. The conservative policy is source-wide relay for scene input
  whenever a part has multiple presenters. Verify the failing mixed-route case
  and the corrected case in Chrome before closing the finding. Restore native
  eligibility when one presenter remains. Do not apply this scene-input policy
  to the page-owned warm rig or introduce duplicate captures.
  Inventory part-registration counts before using them for arbitration:
  `sampledParts` adds coverage registrations, so a draw-evidence count is not
  automatically a count of independent interactive poses.
- Verify source replacement, held presses, hover, selection, focus, cleanup,
  context loss, and reattachment. Fix the unnamed-element diagnostic fallback
  so failures identify what the pointer actually hit.
- Add a new-binding variant of the native-pointer instrument before milestone A.
  The existing instrument uses legacy `Surface.DOM`, duplicated instance IDs,
  and a canvas directly under body; those assumptions do not test the retained
  live node, dock/marker space, or warm rig. Target actual element identity and
  the owned capture canvas. Exercise source swaps, multiple presenters, inert
  content, disabled scene input, and geometry replacement through the candidate
  API. Retain the legacy variant only as compatibility coverage until cutover.
- Port Flight's trusted gesture observer to window capture, including its main
  checkout regression tests. This rule applies to app-level observers that need
  the original event before CanvasPointerGate consumes it at document capture;
  ordinary HTML/React control handlers keep their usual event semantics.

### Layout movement

Reproduce original finding #7 separately from scrolling: move an unchanged-size
page slot by collapsing or animating a sibling while its canvas is settled and
uses demand rendering. The mesh must follow the slot without an unrelated event.

The preferred approach is shared placement observation while a page-aligned
presenter is visible, requesting a draw only when placement changes. Keep it
separate from transfer protocol work and measure its idle cost. ResizeObserver
alone cannot establish position tracking. Do not silently change ordinary
automatic placement into a contract requiring manual refresh after each layout
change.

**Exit:** the original runtime findings affecting the candidate have fixes and
owner tests, with #7/#8 still open until their specific Chrome cases run. The
obsolete #4 `Surface.DOM` export is an explicit milestone-B retirement item and
is not called closed at A. Documentation/diagnostic items are tracked through
stage 6. Permanent regression tests must distinguish the relevant old behavior
from the corrected implementation; a supported-path deferral is not a pass.

## 4. Harden content, capture, and frame lifetimes

**Owners:** the one-instance HTML binding, page targets, capture/frame modules,
and SurfaceCanvas scheduling. Split the experimental implementation along those
existing responsibilities; avoid adding a second controller or general renderer
layer.

- Preserve one live React/DOM instance through preparation, entry, reversal,
  return, moving page targets, Strict Mode, hydration, and teardown. Test child
  state, uncontrolled values, focus, and selection, not only controlled props.
- State the supported content boundary. Unsupported media/custom-element/form
  combinations must keep a usable native presentation and an accurate reason,
  without constructing a second live media player or custom element.
- Make capture replacement/removal clear stale frames immediately. Keep frame
  dimensions and anchors on the same painted generation. Shared textures are
  borrowed: removing one consumer cannot dispose another consumer's texture.
- Check first paint, font/image arrival, live text edits, resize, replacement,
  multiple consumers, and recovery. Ordinary paint updates wake their renderer
  without forcing React to render on every frame.
- Preserve manual-compositor and sampled-part receipt requirements. An invisible
  input proxy cannot prove that the visible result was presented.
- Measure preparation fidelity before claiming focus continuity: Controls-sized
  content must keep its visible caret, selection, focus ring, hover treatment,
  and text while the presenter is deliberately delayed. `activeElement` and
  selection offsets alone do not prove those pixels. Record per-keystroke
  cloning cost as well as the eventual handoff.
- Profile native-element capture under Selection hover/mutation bursts and an
  `html`/`body` source. Refresh events already coalesce into a pending rAF, but
  each resulting copy walks computed styles. Record source node count, copy
  count, p50/p95/max copy duration, frame gaps, and consumer React render count.
  Preserve coalescing and idle quiescence; use the measured workload to choose
  and record an active-copy budget before A, rather than inventing a universal
  whole-page capture cost or labelling every pointer event a full rebuild.
- Keep companions after the final pose for their render pass; test a later pose
  writer, an earlier-drawn companion, multiple passes, and listener removal.
  An unused hook must not add a frame loop or world-matrix traversal. For the
  used case, measure and record traversal count and p50/p95/max CPU cost on the
  representative scene sizes. Pin the accepted budget before A; preserve matrix
  correctness after callback mutations.
- Prewarm the first handoff's capture/material/upload work where possible, and
  keep unrelated React work out of the handoff path. Live typing, video, and
  intended content updates must still repaint during motion.

Do not impose a blanket layout freeze: inline reflow, resize, and page-target
movement are legitimate. Preserve the known-stable postcard slot and verify its
boundary. A fixed renderer and compositor scrolling are separate concerns;
page-bound effects should use a canvas placement that shares their scroll
transform, as the postcard and Veil require.

**Exit:** lifecycle fixtures and the selected real examples agree about content
identity, readiness, actual presentation, input ownership, and resource disposal.
There are no extra protocol claims, idle paints, or demand draws from inactive
surfaces or removed consumers. Active capture and companion-cost budgets are
measured and recorded, not left as an unspecified performance follow-up.

## 5. Polish and validate a representative sample

Update these six routes as the API changes. Use their existing appearance,
shaders, and tuning; this pass concerns API clarity and interaction continuity.

| Route | What it establishes |
|---|---|
| Home: counter and postcard | Smallest API, inset canvas, child-state continuity, scrolling, ordered shadow, mobile and reduced motion |
| Controls | Real form input, named anchors, native/relay behavior, preparation, early return, and reversal during retraction |
| Knobs | Scene-only HTML, responsive layout, paint-aligned anchors, and physical hardware |
| Selection | Native text selection with a separate live capture and shader |
| Flight | One instance across page targets, current capture-phase gesture fix, regrab/cancel, physics-frame lifetime, and deletion cleanup |
| Gallery | Multiple sampled sources, input proxies, actual compositor evidence, scrubbing, cancellation, and source reuse |

Use compact fixtures for inline reflow, authored CaptureContent, two captures
or canvases, host mount order, and source replacement. Keep existing Genie,
Plume, Veil, and Marble Hand gates as compatibility checks when their shared
mechanisms change; do not rewrite those labs just to grow the migration count.

Flight's sample starts with the main checkout gesture fix and tests. Prefer its
explicit `always`-while-flight / `demand`-after-cleanup policy over depending on a
handoff claim to sustain later physics. Verify the SurfaceHostBridge runtime
reinstallation when `frameloop` changes: active claims survive, settled physics
continues, and the empty canvas becomes quiet. Run the same mode-change regression
on the postcard, including rapid reversal and cleanup. Its prior successful
postcard run does not establish the Flight case.

Every sample must include its actual setup, content sizing, camera relationship,
state, material, and motion hookup. A complete example can factor its geometry
into a named application component, but it must show that component's contract
and source. Do not replace the important behavior with unexplained helpers.

Chrome validation uses a dedicated **headed Google Chrome** profile for visual
checks. Run capability-enabled and no-flag profiles separately, verify actual
capability, and keep GPU checks serial. Exercise pointer and keyboard input,
ordinary and interrupted transitions, desktop/mobile layout, and reduced motion.

Keep the postcard's existing measured budgets: six lift/return cycles, sampled
boundary/spike error at or below 0.5 of an 8-bit channel, scroll-marker drift at
or below 1.5 CSS px, and unrecorded animation-frame gaps within two observed
periods plus 2 ms near handoff. Treat screenshots and profiles as observers with
cost; do not use their timing as the unrecorded performance result. Preserve
negative controls, failures, browser/capability, viewport/DPR, and source revision.
Do not relax existing scene or conformance thresholds to make the migration pass.

**Exit:** a cold reader can identify what each component draws and who owns its
state. The tested interface has no blank handoff, lost input, duplicate content,
unexpected slot jump, trailing companion, or stale capture in the named scenarios.
Visual appearance and real clicks are checked alongside protocol state.

## 6. Finish the contract, then integrate deliberately

- At A, keep the canonical README and current public names consistent with the
  still-exported legacy API. Put candidate instructions in the clearly labelled
  API experiment guide and use its actual `Proof as intendedName` imports in
  every sample and displayed source. No README example may target names that
  do not yet exist. Remove `MunariProof` and update its pinned export/type
  consumers together; do not create another temporary public legacy alias.
- At A, also fix already-stale guidance that does not depend on the rename:
  decision #39's Mesh spelling, the support/source-host comments, the native
  hit diagnostic, and the workflow link that calls a historical proposal the
  current contract. Point that link to the current README/types; label the
  candidate guide separately. These items need not wait for B.
- At B, switch the canonical README, public exports/types, compile-only examples,
  agent workflow, authoring guidance, tracked Munari skill, and affected recipes
  in the same integration change. Update the two-instance statements in
  HomeTutorial and HomeSupport for the candidate samples at A; preserve their
  version label while the canonical package guide still describes legacy usage.
- Include exact stale sites: missing-presentation errors in `surfaceHandle.ts`,
  transform errors in `matchDom.ts`, `surfaceSupport.test.ts`, and the source-host
  fallback comment, as well as decision #39. Error messages must name components
  that exist in the API variant being used.
- Amend decision #39's current presenter spelling. Complete #40's missing
  diagnostic/asymmetric-policy rationale. Keep #41's experimental status and
  evidence accurate; add the next accepted API decision once the checks pass.
  That decision explicitly supersedes #40's two-React-instance statement for
  the new API, without rewriting it as though the old implementation never
  existed. Record the new preparation-warning policy and measured cost budgets.
- Change each behavioral law and its conformance contract in the same commit.
  Core tests live in `tests/conformance`; React and scene tests sit with their
  owners; registry welds and copies change together. Keep protocol receipts and
  debugging seams in the advanced/internal layers.
- Run `npm test`, all four typechecks, lint, package build, the relevant existing
  GPU gates, and the new focused regressions. Run a diff-scoped React review;
  record tool limitations and dispositions rather than claiming a clean score
  from incomplete output. Adversarial review must target combinations the
  happy-path demos omit.

**Milestone A: hardened API candidate.** The new contract is settled and implemented
in isolation, its sample and focused regressions pass, and no finding affecting
its supported behavior is deferred. Candidate docs compile using the actual
experimental aliases. Legacy API names remain for unmigrated consumers; #4's
old exported `Surface.DOM` behavior remains a known open legacy issue until B.
State that exception in the milestone report. A is not a release, an all-15-closed
claim, or a claim that the entire repository has switched over.

**Milestone B: repository-wide adoption.** Reconcile with the then-current site
work, mechanically migrate remaining consumers as needed, remove temporary
`Proof` names and obsolete public exports, and rerun package/type/boundary and
affected browser checks. Do not add a permanent legacy API merely to avoid
migrating private labs. Broader lab polish is optional and separate.

Use existing test and local instrument commands. This plan does not require a
CI, deployment, or release-tooling change; a later change to those systems needs
its own explicit approval. Publishing is a separate action from either local
implementation milestone.

## Original review closure checklist

| Findings | Planned disposition |
|---|---|
| #1, #2: resident hold and raw driver | Retain fixes; add permanent regression coverage in stage 3 |
| #3, #5, #6, #9: native ownership/eligibility | Repair and test in stage 3 |
| #4: separated Surface.DOM | New HTML/page-target contract in stage 4; atomic old-export removal in milestone B |
| #7: position-only movement | Chrome reproduction and placement policy in stage 3 |
| #8: native/relay shared source | Conservative source-wide scene relay policy; failing/corrected Chrome proof required before closure in stage 3 |
| #10: declared but unrequested mesh | Preserve the agreed no-warning policy; complete ledger rationale |
| #11: delayed host and preparation waits | Lifecycle wakeups, zero-presenter/unusable-source waits, both diagnostic deadlines, and host/binding work-accounting tests in stage 3 |
| #12, #14, #15: names, canonical links, diagnostics | Correct owned sites and verify references in stages 3 and 6 |
| #13: Controls physical return | Retain the driver-based fix and pin full/early/reversed return in Controls |

The newer wrapper/status/callback findings belong to stage 2. The September 5 inset
counter failure belongs to stage 1. The Fable review also adds the preparation
wait, candidate/legacy documentation split, full callback vocabulary, per-pass
camera behavior, active-cost probes, and current Flight integration prerequisites.
The six postcard observations are covered
by stages 4 and 5 with their explicit scope; they do not close original #7/#8.

## Chrome spot-checks used to prepare this plan

Google Chrome 151 on macOS, headed, separate owned profiles. The enhanced
profile reported `drawElementImage` available; the no-flag profile reported
it absent. These checks used the isolated prototype, not the in-app browser.

- **Controls passed:** full return, early return, and reversal during return;
  original input/value retained and page takeover recorded at zero progress.
  The scripted early/reversal triggers are distinct from the pointer-driven
  toggle and field-edit checks.
- **Selection passed:** native selection of 124 characters with a captured
  glass overlay; screenshot inspected and no page errors.
- **Mobile postcard passed:** 390 px viewport, scene/page round trip, original
  input and edited value retained; no page errors. This was a spot-check, not
  a rerun of its full performance/pixel instrument.
- **Native Controls passed:** edited original field retained after a scene
  request, actual page presentation, zero capture canvases.
- **Starter failed:** the page reports a scene presentation, but the counter
  is visually blank and a click at its measured visible slot does not increment.
  Fresh coordinates reproduced the failure, ruling out the first test's
  stale-coordinate suspicion. A temporary browser-only fullscreen-canvas
  comparison restored the visible counter and the same click incremented it,
  supporting the origin diagnosis.
  Returning to the page also restores the counter. No source fix was made.

The same inspected page still says page and capture are separate React
instances. That is stale tutorial prose and is part of the documentation pass.

Fresh evidence is retained at
`/private/tmp/munari-api-hardening-plan-20260905/evidence`. The prior full audit
and its runnable reproductions remain at
`/private/tmp/munari-confidence-20260905/assessment.md`.
