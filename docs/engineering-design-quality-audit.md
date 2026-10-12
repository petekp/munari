# Engineering and design quality fixes

Status: implemented and locally verified, 2026-10-11.
Integration bases: `e57d2d2` for the initial fixes; `d9ec0e2` for review findings.

The implementation addresses the eight assessment findings and four additional
review findings. It retains main's discarded FrameSurface receipt retry fix and
verifies it alongside the compositor changes.

## Changes and acceptance

| Finding | Change | Acceptance |
|---|---|---|
| Unrelated renders confirm presentation | Associate deferred receipts with the render targets displayed by an explicit output mesh | Valid composite passes; unrelated, empty, overridden, stale, and discarded draws cannot release a receipt |
| Discarded frames suppress retries | Retain main's existing delivery-time deduplication | The same stationary source can retry after its first output pass is discarded |
| Secondary-click Delete removes a Flight card | Guard pointer entries and preserve keyboard activation | Right/middle presses preserve cards; primary and keyboard actions still work |
| Flight cannot move tasks by keyboard | Native Move controls share the existing board update | Column/position changes retain content and return focus to the moved card |
| Flight ignores reduced motion | Follow the preference during the visit and preserve task outcomes | Reduced moves/deletes avoid physical travel; preference changes finish active handoffs |
| Navigation drops capture selection | One URL builder owns gallery, sidebar, Home, support, and frame links | Real navigation preserves auto/snapDOM selection and the destination engine |
| Resize CI can skip successfully | Require capability in the dedicated resize step | Missing browser/capability exits nonzero |
| Idle coverage omits live sources | Separate frozen/live windows and recurring-paint control | Both normal profiles stay at zero; real recurring live paints fail the same oracle |
| Native carry overrides keyboard Move | Finish the carry before Move commits | Later pointer movement and release preserve the committed order for the carried card and another card |
| Cancelled Move reopens after landing | Give each deferred request an identity and cancellation | Escape, outside press, repeat activation, and supersession leave controls and focus in the requested state |
| Cached bundle output stops confirming presentations | Require the final output mesh outside `BundleGroup` on both backends | Bundle output rejects proof with one diagnostic; pixels keep updating; moving outside restores receipts |
| Gallery links drop capture selection and nest the shell | Use `sceneUrl` and top-level navigation | Actual Gallery links preserve both capture modes and open one shell |

Direct screen presentation remains automatic. An advanced compositor must name
the render targets its final output displays. The binding checks the actual
eligible output draw; the compositor author owns shader inclusion, discard,
depth, and occlusion. Three.js cannot establish those from an arbitrary shader.
An unrelated screen draw does not establish that a deferred source appeared.
Cached bundle execution also omits the required mesh callbacks. The placement
guard reports the first observed draw inside a bundle; it cannot diagnose
handlers attached after that bundle was cached.

Flight uses native controls for Move because the browser already provides
keyboard selection and form behavior. The selected column and position feed
the same board mutation used by pointer movement. Reduced motion changes the
visual treatment while preserving move and delete outcomes.

## Verification

Strict browser runs set `STRICT_CAPABILITY=1`; missing capability fails the run.

| Check | Result |
|---|---|
| `npm test -- --maxWorkers=2` | 124 files and 1,409 tests passed |
| `npm run typecheck` | All four TypeScript programs passed |
| `npm run lint` | Passed |
| `npm run build` | Publishable package built |
| React Doctor, changed scope | No new issues |
| Strict `gate:frame-surface` | Actual WebGPU and WebGL 2 passed 22 host-output cases each, plus the existing lifecycle and fault controls |
| `gate:degraded` | Native fallback gestures passed in five scenes, including Move during two active carry cases |
| Strict `gate:lab-interactions` | Existing Flight cases and nine new carry, cancellation, and supersession cases passed |
| `node instruments/home-inline/run.mjs` | Native and enhanced input, Home and Gallery capture-mode navigation, and two-instance isolation passed |
| Strict `gate:idle-zero`, initial implementation | Both quiet profiles stayed at zero paints; recurring native callbacks produced 181 live paints and failed the same oracle |
| Strict `gate:knobs-resize`, initial implementation | 14 drag samples passed; maximum marker drift was 12.7px within the existing 24px limit |
| Independent review and `git diff --check` | Passed |

The presentation cases include nested renders, clears changed inside scene
callbacks, target reuse, stale sources, changed requirements, and unmount.
Receipt timing is checked against pixels after render. Shader inclusion,
overwrite, discard, depth, occlusion, and unobserved writes remain compositor
responsibilities. Source targets must remain intact until declared output.
Both bundle settings retain updated blue generation 2 pixels without receipts.
After moving the output outside the bundle, generation 2 receives its receipt
on frame 3 on both backends.

Flight's open controls were visually inspected. An airborne card returns to
the page before its Move form expands, so the form fits its native content
size. The keyboard check preserves the original note node and value, restores
visible focus, and announces the destination.

Browser checks ran serially in Chrome 155.0.8059.40 on this Mac. They do not
establish physical mobile-device behavior. The full unit suite passed with
two workers; assertions and timeouts were unchanged.

The approved CI change adds `STRICT_CAPABILITY: '1'` only to the dedicated
resize step. Dependencies and deployment tooling retain current main's
configuration. The original checkout's unrelated plans and investigation were
preserved. Publishing the npm package is outside this task.
