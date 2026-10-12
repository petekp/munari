# Engineering and design quality fixes

Status: implemented and verified, 2026-10-11.
Integration base: `e57d2d2`, refreshed from `origin/main`.

The implementation addresses the eight findings from the assessment at
`9073983` and completes its Home navigation check. Current main already fixes
discarded FrameSurface receipt retries. This work retains that implementation
and tests it alongside the remaining presentation repair.

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

Direct screen presentation remains automatic. An advanced compositor must name
the render targets its final output displays. The binding checks the actual
eligible output draw; the compositor author owns shader inclusion, discard,
depth, and occlusion. Three.js cannot establish those from an arbitrary shader.
An unrelated screen draw does not establish that a deferred source appeared.

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
| Strict `gate:frame-surface` | Actual WebGPU and WebGL 2 passed 19 host-output cases each, plus the existing lifecycle and fault controls |
| `gate:degraded` | Native fallback gestures passed in five scenes |
| Strict `gate:lab-interactions` | Final Flight keyboard, pointer, and reduced-motion cases passed |
| `node instruments/home-inline/run.mjs` | Native and enhanced input, capture-mode navigation, and two-instance isolation passed |
| Strict `gate:idle-zero` | Both quiet profiles stayed at zero paints; recurring native callbacks produced 181 live paints and failed the same oracle |
| Strict `gate:knobs-resize` | 14 drag samples passed; maximum marker drift was 12.7px within the existing 24px limit |
| Independent review and `git diff --check` | Passed |

The presentation cases include nested renders, clears changed inside scene
callbacks, target reuse, stale sources, changed requirements, and unmount.
Receipt timing is checked against pixels after render. Shader inclusion,
overwrite, discard, depth, occlusion, and unobserved writes remain compositor
responsibilities. Source targets must remain intact until declared output.

Flight's open controls were visually inspected. An airborne card returns to
the page before its Move form expands, so the form fits its native content
size. The keyboard check preserves the original note node and value, restores
visible focus, and announces the destination.

Browser checks ran serially in Chrome 155.0.8059.40 on this Mac. They do not
establish physical mobile-device behavior. The first unit run had two timeouts
in unchanged stress cases during concurrent work. The full rerun passed with
two workers; assertions and timeouts were unchanged.

The approved CI change adds `STRICT_CAPABILITY: '1'` only to the dedicated
resize step. Dependencies and deployment tooling retain current main's
configuration. The original checkout's unrelated plans and investigation were
preserved. Publishing the npm package is outside this task.
