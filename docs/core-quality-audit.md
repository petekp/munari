# Core engineering, performance, and API audit

Status: implemented and locally verified, 2026-10-11.
Review baseline: `2c893a9`.

## Scope and intended behavior

This pass covered the dependency-free kernel and the React integration that
carries its contracts into rendering. The fixes preserve retained DOM content,
input state, source identity, and evidence for each handoff. They address
unnecessary work, stale capture and placement, and conflicting state owners.

Lab scenes serve as integration consumers. Visual redesigns, dependencies,
CI configuration, deployment tooling, and npm publication are outside this pass.
Use supported dependency APIs and preserve unrelated work.

## Coverage

| Area | Owners and consumers | Failure hypotheses | Status |
|---|---|---|---|
| Capture and scheduling | Core paint sources; React source runtime | Overlapping work publishes stale frames; failed or cancelled captures lose wakeups; idle sources retain unnecessary work | Verified |
| Handoff and presentation | Core transfer laws; React handle and host | Late evidence survives a changed owner; repeated registration leaks work; reversals or cleanup lose a valid hold | Verified |
| Pointer delivery | Core event relay and route policy; React pointer ownership | Independent pointers interfere; route changes leave active state; cancellation delivers the wrong native outcome | Verified |
| Mapping, motion, and public design | Core geometry, physics, anchors, and exported consumers | Degenerate inputs break valid consumer flows; hot paths allocate or measure unnecessarily; callers must coordinate state that belongs to one owner | Verified |

Single-flight capture coalescing and the supported camera and physics paths
had no additional confirmed defect. Existing tests remain the owners of those
contracts. The retained new cases protect lifecycle, activation, or geometric
failures that the previous cases did not cover.

## Implementation and verification

All findings below are confirmed, with high confidence. Stale presentation
proof, discarded pixels, competing controllers, and wrong-control activation
were high-impact correctness defects. The remaining findings affected capture
freshness, interaction cleanup, placement, or unnecessary work.

| Finding | Evidence and consequence | Repair |
|---|---|---|
| Source replacement retains old presentation evidence | A two-presenter handoff released the page before the replacement source drew | Clear presentation evidence when source readiness restarts |
| A removed waiter can leave a handoff running forever | Removing an unpresented mesh or missing part left the page held and protocol work active after later valid draws | Recheck current coverage on each qualifying draw |
| A rejected controller still writes shared state | A second public Root changed intent, added another frame tick, and replaced the first Root's source | Require the controller claim for writes and resource registration while preserving native SSR content |
| Failed rasterization loses good pixels on a density change | Browser pixels changed from opaque red to transparent after a rejected capture and resolution change | Preserve complete pixels when failure occurs before canvas writes |
| Live snapDOM CSS motion stops updating | Native paints continued while snapDOM remained on an old color | Continue running motion through the existing paced scheduler and stop after its final frame |
| Canvas writes have no idle capture notification | A canvas changed from red to blue while snapDOM stayed red until explicit repaint | Add a source-owned Surface refresh hook; retain automatic DOM and CSS updates |
| Another pointer can prevent press cancellation | Foreign hover replaced the pointer identity used to cancel the active press | Track press identity independently from hover |
| Simultaneous Surface drags interfere | Starting a second Surface drag stopped the first stream | Track admitted pointer IDs separately and count shared camera-control claims |
| Release activates the wrong control | Sibling release clicked the sibling; right-button release generated a primary click | Match native primary-button and common-ancestor activation, preserving press-target focus |
| Anchors use the wrong nearest point | A point beyond a plane edge drifted along it; differently sized UV islands selected the farther triangle | Project onto the closest edge in UV coordinates after containment fails |
| Anchors ignore texture and topology changes | All 32 Knobs anchors stayed fixed after a horizontal UV flip | Include attribute identity and position, UV, and index versions in the placement cache |

The UV repair passed 3,000 comparisons against Three's independent triangle
projection. A local benchmark of 15,000 interior samples on 800 triangles
improved from a median 32.28 ms to 23.74 ms across seven alternating runs.
Reproduce it with `node instruments/knobs-resize/anchor-sampling.mjs 2c893a9`.
That measurement covers CPU sampling cost, not application frame rate.

| Verification | Result |
|---|---|
| Full unit suite | 124 files, 1,435 tests passed |
| Typecheck, lint, package build | All passed; all four TypeScript programs ran |
| React Doctor, changed scope | No diagnostics |
| API lifecycle | Both capture engines refreshed canvas pixels with unchanged HTML; initial scene entry, retained state/focus, renderer loss, and native fallback passed |
| FrameSurface | WebGPU and WebGL 2 passed presentation, source lifetime, retry, and pixel checks |
| Capture engines | Raster controls, pixel parity, capture pacing, motion holds, and idle checks passed |
| Native and lifting pointers | Trusted/native and relayed delivery, input during handoff, and focus passed |
| Idle zero | Frozen and live profiles had zero paints, requests, or callbacks; the recurring-paint fault was detected |
| Degraded and lab interactions | Native fallback and enhanced interactions passed |
| Knobs resize | Seven geometry-change cases covered 32 anchors; 14 resize steps passed with 12.6 px maximum marker drift |
| Independent review | No remaining actionable findings; `git diff --check` passed |

Negative controls failed for the intended reasons: source replacement and
departing waiters, duplicate controller/source writes, pointer admission and
control ownership, missing motion continuation, stale page-canvas snapshots,
and the old anchor cache. Error suppression was also checked after carrying a
last-good raster; only a new successful read resets a repeated capture error.

Browser evidence was collected serially in Chrome 155.0.8059.40 on this Mac.
The refresh fixture measures source pixels, not final framebuffer pixels;
the rendering gates own the latter. Physical mobile input and OS cursor
appearance were not measured. Page preparation still uses structural copies,
which do not clone script-created Web Animations. The new refresh hook does
not change that existing boundary or manufacture rendering proof.
