# Focus and spatial navigation

This guide describes the implemented focus API. Public types are in
[focusContext.ts](../packages/react/src/primitives/focusContext.ts), behavior is
in [FocusScene](../packages/react/src/primitives/FocusScene.tsx), and the
[Workspace](../apps/lab/src/scenes/workspace/Workspace.tsx) is the complete example.
The [focus-orbit recipe](../registry/focus-orbit/README.md) owns camera policy.

## The model

`FocusScene` groups two kinds of target:

- A composite is a Surface's live HTML subtree. Its controls keep native focus,
  text editing, form semantics, and interior Tab behavior.
- A leaf is a scene control represented by a real, invisible DOM proxy. The
  current leaf implementation supports slider semantics through `Dial`.

`FocusGroup` groups targets and can specify their order and projected object.
A Dial inside `Surface.Mesh` can join that Surface's group. Free-standing targets
use an explicit FocusGroup.

Focus is derived from `document.activeElement`. The levels are `page`, `scene`,
`unit`, and `interior`. Unit focus targets the group's source root with
`tabindex="-1"`; a leaf-only group uses its proxy as the unit. `data-focus` reports
unit/interior state on the root. `data-engaged` records an explicit Enter/F2
commitment, which cannot be inferred from the focused element alone.

## Tab model

| Input | Implemented behavior |
| --- | --- |
| Enter the canvas with Tab | Select the entry group and focus its first real control; read-only groups use their unit root |
| Tab / Shift+Tab inside a composite | Keep native traversal until a member boundary, then move in the group's authored order |
| Tab at a group boundary | Move to the next group's first control, or the previous group's last control |
| Enter / F2 on a unit | Engage it and restore a valid remembered interior target, otherwise its first control |
| Enter inside a control | Preserve the control's native behavior |
| Escape from an interior | Focus its unit; release engagement if present and clear its focus memory |
| Escape from an unengaged unit | Focus the scene canvas |
| Escape at scene level | Emit an event for application policy; do not move focus |

An engaged group wraps Tab within its own targets until Escape. A group entered
by ordinary Tab or pointer input does not become engaged. The scene's group ring
wraps; page-edge handoff is not implemented.

`initialFocus` selects the entry group. Without it, `entryPick` prefers the
fully visible group nearest the viewport center, then the most visible candidate;
entry falls back to ring order when projection supplies no candidate.

## Ordering and focus memory

Explicit group/member order takes precedence. Unordered groups use projected
screen-space reading order; equal candidates keep stable order. Unordered members
place composites before leaves so asynchronous source registration does not
reorder the intended controls.

Each group remembers interior elements in a stack. Recall skips elements that
are disconnected, disabled, hidden, no longer focusable, or no longer members.
Escape clears the stack. Removing a focused leaf proxy hands focus to its unit
or the scene canvas before removing the element. A general scene autofocus queue
and selection-based group restoration are not implemented.

The binding computes a composite's tabbable sequence when traversal needs it;
there is no persistent `paintCount` cache. Its boundary decision uses element
identity, not a count of key presses. [focusTree tests](../packages/react/src/lib/focusTree.test.ts)
pin ordering, entry, memory and boundary behavior.

## Directional navigation

At scene/unit level, unmodified arrows select a group using current projected
rectangles. Interior controls and engaged units retain their arrow behavior.
Alt/Ctrl/Meta combinations remain platform input.

The spatial law separates overlapping candidates from candidates beyond the
origin, applies its directional cone and alignment rules, and uses stable/depth
ties. Its actual constants and counterexamples live in
[spatialNav](../packages/react/src/lib/spatialNav.ts), its adjacent tests, and
[decisions #14–15](decisions.md). The browser-field replay test preserves the
measured projected arrangements that exposed the original scoring failures.

Opposite arrows retrace the directional history. Perpendicular navigation, Tab,
external focus changes and invalidated targets clear that history. This matters
because camera movement can change the geometry between two key presses.

### No-candidate ladder

When an arrow finds no candidate, the binding asks registered `NavPolicy`
handlers whether the camera can move in that direction. The first available
handler receives a nudge request. A nudge leaves focus and directional history
unchanged. Without a handler, the input is a no-op. The alternative visible-only
`auto` navigation policy and member-level grid navigation are not implemented.

## Proxy contract

FocusScene creates one DOM proxy layer beside the canvas. Proxies never live
inside a captured source: updating ARIA values must not repaint unrelated HTML.
They have real dimensions, `opacity:0`, and `pointer-events:none`; the actual
scene hit test owns pointer activation. They must remain focusable while mounted.

Dial exposes `role="slider"`, its label, min/max/current values, optional value
text, and orientation. Arrows apply calibrated impulses; Home/End jump to an
endpoint. ARIA values update at detent crossings and at rest. The current leaf
API does not offer generic button or switch roles.

The binding projects proxy rectangles on focus changes. The orbit recipe also
refreshes them after its own camera tween and after OrbitControls motion/damping
settles. Other camera or object-motion owners call `syncProxyRects()` when their
geometry requires a refresh. Behind-camera objects retain the last valid proxy
rectangle; hiding a focused proxy must not silently drop focus to the body.

The browser checks verify focus, key handling, and projected geometry. They do
not establish VoiceOver/TalkBack exploration or double-tap behavior on a device.
There is no built-in live-region activation announcer.

## Camera integration

| Public API | Responsibility |
| --- | --- |
| `onFocusChange(event)` / `useFocusSceneEvents(handler)` | Observe a semantic focus change and its cause |
| `useFocusReframe(handler)` | Fulfill requests to bring a focused object into view |
| `useFocusNavPolicy(policy)` | Supply camera limits and a nudge when navigation has no target |
| `useFocusScene()` | Read `focusUnit(groupId)` and `syncProxyRects()`; returns null outside FocusScene |

Focus events describe the current state. They are not cancelable pre-focus
callbacks, and there is no `onNoTarget` prop. Event handlers receive the registered
scene object so they do not need a second group-to-object registry.

### Reframe bridge

The binding requests a reframe when a focused object is less than half visible
and does not cover the viewport center. Pointer, scene Escape and release causes
skip this request. Registered application handlers own the response. With none
registered, a built-in fallback moves a bare perspective camera, bounded to one
viewport per request, and respects reduced motion.

`FocusOrbitRig` is a copyable recipe, not a package export. It handles
Enter/descend approach, Escape/release return, camera interruption, view nudges,
and reduced motion. Its pose laws keep endpoints within OrbitControls limits and
interpolate direction in yaw/pitch. The registry tests keep the recipe identical
to Workspace's implementation and pin the motion bounds.

## Surface markup and focus indication

- Keep positive tabindex values out of Surface content; they impose page-wide
  ordering that a local subtree cannot reproduce.
- Native editing hosts are tab stops even when their IDL `tabIndex` is -1.
  Explicit negative tabindex excludes them. Nested editors need an explicit
  tabindex to join the sequence; a noneditable island can contain a new host.
- Keep one radio checked per group. `<summary>` supplies a details element's
  native tab stop. Native media controls are outside the retained HTML contract.
- Style `data-focus` and `data-engaged` with paint properties such as outline,
  color and shadow. Border/padding changes alter layout during focus movement.
- Put root-state selectors on the root itself, such as `.panel[data-focus]`.
  Hover/active and pointer-focus rules are in [authoring](authoring.md) and the
  [package stylesheet](../packages/react/src/style.css).

The implemented native tab rules are pinned in
[tabbables tests](../packages/react/src/lib/tabbables.test.ts).

## Verification

`npm run probe:detail-focus` checks native editing hosts, Workspace focus recall,
first-input camera interruption, retained panel pose, and proxy placement after
orbiting. `npm run gate:lab-interactions` checks scene input and focus integration.
Run real keyboard input in Chrome; synthetic keydown dispatch does not exercise
native Tab traversal. The [instrument guide](../instruments/README.md) states
scope and limits.

### Historical Chrome 150 measurements

The following seven measurements informed the focus design. The old
`?focusprobe=1` / `window.__focusProbe` harness is no longer in this checkout;
that URL is not a current verification command. Restore its matching Git revision
when reproducing the original experiment. Current instruments above cover their
named cases and do not claim device screen-reader verification.

| # | Claim to verify | Expected | Result (Chrome 150) |
|---|---|---|---|
| 1 | Real Tab reaches focusables inside parked source canvases; order is document (mount) order | reach, doc order | **✓** full sweep: page-before → proxy-slider → proxy-off → page-after → a-btn → a-input → b-btn → b-input; past the last, Tab leaves to browser chrome (the scene-edge handoff exists natively) |
| 2 | Focusing a parked-subtree element self-paints the focus ring into the record (`paintCount` advances) | yes (platform.md self-paint table) | **✓** paints 1→2 on the focused source, neighbor untouched; blur paints too |
| 3 | Document-capture keydown sees Tab targeted inside a parked subtree; `preventDefault` suppresses the native move; `.focus({preventScroll:true})` re-routes without viewport jump | all yes | **✓** intercept entry `prevented:true`, focus landed on hop target, scroll pinned at base |
| 4 | `:focus-visible` matches after programmatic `.focus()` inside a Tab-key handler (heuristic credits keyboard) | yes, per spec heuristic | **✓** true on the hop target inside the handler and on every Tab-focused element in the sweep. (Observed: eval-context programmatic focus *also* got `:focus-visible` — don't rely on it; `data-focus-visible` mirroring stays the fallback) |
| 5 | An `opacity:0` fixed-position proxy (`role="slider"`, `tabindex="0"`) is Tab-reachable and receives arrow keydowns | yes | **✓** both proxies in the Tab ring; ArrowDown/ArrowUp/Home all delivered |
| 6 | Arrow keys on the focused proxy don't scroll the page; `aria-*` mutations on proxies never advance any Surface source's `paintCount` | yes / 0 paints | **✓** scroll pinned through all presses (handler preventDefaults per contract); 6 `aria-valuenow` writes → paint delta 0 on both sources |
| 7 | Focusing an offscreen fixed element with `preventScroll` leaves scroll untouched; without it, measure | untouched / measure | **✓** untouched **both ways** — fixed positioning sits outside scroll geometry entirely, so parked sources and the fixed proxy layer can never yank the viewport |
