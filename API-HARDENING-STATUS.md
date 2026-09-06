# API hardening status

The retained-HTML API is implemented in `codex/api-hardening`, in
`/private/tmp/munari-api-resolution-worktree`. The active website checkout remains
separate. This work has not been published or deployed and changes no CI membership.

The public API is `Surface` with `inScene`, its explicit Root/HTML/Scene/Mesh form,
`SceneSurface`, and element capture. Public Proof suffixes, Surface.DOM/Part,
renderIn, and the optional Munari wrapper are removed. Existing lab consumers use
the adopted names. The canonical README and compile-only examples use those exports.

## Original findings

| Finding | Disposition and verification |
|---|---|
| 1. Resident hold changes | Fixed; repeated draw/tick regression preserves scene authority without permanent protocol claims. |
| 2. Raw/eased driver mismatch | Fixed; handles and drivers share raw progress, with an explicit eased() read. Binding tests pin the distinction. |
| 3. Source swap and native rig | Fixed; outgoing ownership releases before the replacement is acquired. Chrome source-swap/input check passes. |
| 4. Separated Surface.DOM | Retired with the old public export. Retained HTML and page-target tests cover the replacement contract. |
| 5. Inert input | Fixed in native eligibility; Chrome and binding tests cover inert/disabled sources. |
| 6. pointerEvents="none" | Fixed, including changes while demand rendering is idle. Page-owned preparation keeps native input. |
| 7. Position-only movement | Fixed with shared placement observation. A settled sibling move failed before the change; six layout/camera cases pass after it. |
| 8. Multiple pointer poses | Fixed by source-wide relay for multiple interactive presenters. The old tilted fixture misses the second button; the current fixture passes all seven input checks. |
| 9. Geometry provenance | Fixed; native eligibility checks geometry, position/UV attributes, index and draw range. Replacement/deformation regressions pass. |
| 10. Unrequested scene declaration | Deliberately quiet. An always-declared scene is valid before its first request. Decision 40 records the asymmetric diagnostic policy. |
| 11. Late/missing hosts | Fixed lifecycle wakeups and dormant waits. Dev-only ten-second diagnostics do not change state or call onError. Fake-clock and Chrome lifecycle checks pass. |
| 12. Stale names | Corrected public names, support/source-host comments, and decision 39. |
| 13. Controls return | Fixed; full, early and reversed return retain the original input and hand back at zero physical progress. |
| 14. Canonical link | Workflow now points to current README/types; historical proposals are labelled. |
| 15. Empty hit identity | Fixed the empty-ID fallback; diagnostic uses the tag name when needed. |

Fable's additional findings are addressed: canvas-relative projection; one status
and callback vocabulary; scene-side host conflicts; dormant missing-presenter/frame
waits; actual per-pass camera/target in companion callbacks; measured active costs;
and current Flight gesture/frameloop behavior. Milestone A was archived before the
public-name cutover; milestone B reconciles the website work in this isolated branch.

## Default sharpness

Canvas and capture defaults now follow native display density. Stationary flat
HTML meshes receive the existing pixel-grid correction at draw time. Per-axis
capture density and canvas scale compensation preserve text under non-uniform CSS
scale. Physics remains continuous; the postcard's soft shadow follows that physical
pose inside the same post-pose callback. Explicit quality limits remain available.
Density changes cut an exact backing size; layout resizing retains its existing band.

| Chrome comparison | Measured result |
|---|---|
| Default fullscreen and inset Surface, native DPR 2 | Native text edge energy ratio 1.000 |
| CSS scale(1.2, 0.85), native DPR 2 | Ratio 0.986; capture densities 2.4 / 1.7 |
| Explicit DPR 2.5 / 3 | Ratio approximately 1.000; DPR 3 crop has zero mean pixel error |
| Orthographic camera | Passes the same 0.95–1.05 contrast gate |
| SceneSurface label, native DPR 2 | Pixel-identical native/mesh crop |
| Real postcard at rest, native DPR 2 | Pixel-identical native/mesh crop; hiding the mesh fails the comparison |
| Preparation selection/focus, native DPR 2 | 35 sampled frames, zero crop error |
| Capture DPR 2 → 3 → 1 with resize | 400×240 → 600×360 → 200×120; same source, content and texture |

The alignment-disabled negative control loses contrast. The display-change check
uses CDP density plus a small viewport resize because Chrome 151's CDP override
changes media-query matches without delivering their change event. It does not
claim a physical multi-monitor test. Perspective filtering and authored shader
blur remain separate from stationary text clarity. The 4096-pixel texture guard
still applies.

## Verification

The latest full run passes 1,508 tests across 115 files, all four TypeScript
programs, lint, package build, and lab build. The lab retains its large-chunk build
warning; changing bundling is outside this task.

Chrome checks include all 31 route loads, Controls return/preparation/input,
stateful inset/scaled/perspective/orthographic cases, source replacement and shared
native/relay input, Strict Mode, late hosts, context loss/recovery, renderer creation
failure, a separate no-flag profile, and capture/composition lifetime. Maintained
Knobs, Gallery, lab interactions (including Flight), Genie film/shadow, Plume,
Marble Hand and degraded checks passed. The latest Knobs and lab reruns wait for
input eligibility rather than clicking a mounted mesh before its first visible frame.

The native-DPR postcard suite passes six cycles, zero handoff boundary error,
0.000109 maximum single-frame shadow spike, zero measured scroll drift, and desktop
1200px/mobile 390px form checks with retained field identity. The final unrecorded frame
period is 8.3ms and the maximum frame timestamp gap is 16.9ms, below the unchanged
18.6ms budget. Its maximum elapsed callback gap was 23.6ms; callback scheduling
within a frame is reported separately from frame timestamps, as the plan specifies. A separate DPR-1 recording also passes, with zero boundary error and
0.00247 maximum spike. Recorded timings are diagnostic, not the performance claim.

Active copy budgets remain p95 ≤5ms, maximum ≤8ms, at most 26 copies per 24 event
bursts, no idle copying, and no per-paint consumer React renders. Companion fixtures
cover two cameras/two targets and 260 nodes, with zero mismatches and matrix-work
budgets of p95 ≤1ms and maximum ≤4ms. These are named workloads, not arbitrary-page
performance guarantees.

React Doctor's final scan includes 159 changed/untracked files. It reports 67
issues and incomplete maintainability results; no clean score is claimed. The
Surface cleanup error is a false positive: both observers disconnect and the event
subscriptions abort. The other two errors concern the copied website's existing
render-time ref write and the lint tool's input-type guard; the repository's own
lint passes. New shared-state/DOM-mutation warnings were reviewed against retained
node ownership and lifecycle tests. Unrelated website/style refactors were not made.

## Evidence and remaining work

Evidence is local at `/private/tmp/munari-api-hardening-execution-20260906`.
`API-HARDENING-PLAN.md` records the approved scope; decisions 42–44 record the
runtime, adoption and sharpness contracts. The instrument guide gives runnable
commands, explicit source-version checks, negative controls, and measurement limits.
A stale pre-cutover capture server was rejected and its checks rerun against a fresh
server; that old server is not adoption evidence.

Final capture lifetime, grouped composition, two-source pixel, whole-document,
sharpness, active-cost and companion reruns pass. The ten current guides have no
broken local file links; public-name/type checks and git diff --check pass.
Milestones A and B are complete in the isolated worktree.
No release, deployment, CI change, or replacement of the active website checkout is
part of this completion.
