# Focus — the design contract

What Tab, Enter, Escape and the arrow keys mean when the focusable
things are surfaces in space rather than boxes in a document.

The claim the library makes is that the DOM is load-bearing, not a
texture. Until focus works, that claim is mouse-only. The goal is
keyboard-complete operation of a 3D workspace with the browser's real
focus model underneath — nothing here invents a focus system; it
*routes* the browser's.

**Where the mechanism lives:** `packages/react/src/lib/` (`focusTree`,
`spatialNav`, `tabbables`) and `packages/react/src/primitives/`
(`FocusScene`), with vitest suites beside those modules. The orbit rig,
`arcLayout` and `cameraPose` left the package on 2026-08-17 and are
copyable recipes in `registry/focus-orbit/` (decisions.md #6, amended);
the workspace scene is the welded reference and the browser evidence.

**Where the evidence lives:** pure laws are pinned in the suites next
to their modules; full-field rect captures replay real browser picks
against the pure module (`spatialNav.field.test.ts`); the seven
platform probes are tabulated at the bottom and re-runnable via
`?focusprobe=1`.

## The model

A **focus tree**: scene → groups → targets. Two target kinds, one
distinction (the same one desktop toolkits and ARIA converged on):

- **Composite** — a Surface's live DOM subtree. Focus descends *into*
  it; the browser owns interior Tab, form semantics, `:focus-visible`,
  the screen-reader tree. We never reimplement any of that.
- **Leaf** — a WebGL-only control (Dial/Toggle/Slider, any app mesh),
  backed by a visually-hidden ARIA proxy element (`role="slider"`,
  `role="switch"`…). Keys operate it directly.

A **group** is a unit of co-located targets (a workspace screen plus
its satellite switch; a synth's knobs plus its display). Composites and
leaves are interchangeable members. Membership rides the scene graph —
a `<Dial>` nested under a `<Surface>` auto-joins via SurfaceContext; a
`<FocusGroup label="Synthesizer">` wrapper groups free-standing targets.

**The invariant: scene focus IS document focus.** Every focusable thing
is a real DOM element — Surface interiors natively, leaves via proxies,
a group-as-unit via real focus on a `tabindex="-1"` container. The
manager is a *router* of real browser focus plus a renderer of glows;
`document.activeElement` never lies, screen readers follow for free, and
there is no shadow-focus state to desynchronize. (This dissolves the
web's roving-tabindex vs `aria-activedescendant` schism on the side APG
favors; VoiceOver's activedescendant tracking is historically the weak
one.)

**The unit element is the Surface's source root**, carrying
`tabindex="-1"` — focusing it makes unit selection real document focus,
and the `[data-focus="unit"|"interior"]` attribute the manager stamps
lets authored CSS paint the state into the texture (paint properties
only).

The one deliberate exception to zero-shadow-state is **`data-engaged`**,
a gesture-latched DOM stamp on the unit root, set only inside
`descend()` and cleared on every release path and whenever focus leaves
the group. It is honest because the *gesture* is the source of truth —
`activeElement` cannot encode commitment — and the stamp doubles as the
CSS chrome hook and dies with its subtree.

## Tab model — a flat path through real controls

Tab must reach useful content on the first press. The canvas is the
page's entry element, but its focus event immediately routes to the
first real control in the entry group. The canvas never remains as a
visible stop. A group with no controls contributes its source root as
one unit stop, so read-only matter is still reachable.

- Inside a composite, the browser owns ordinary Tab order, form
  semantics, and `:focus-visible`.
- At the last control in a group, Tab moves to the first control in the
  next group. Shift+Tab performs the exact reverse move. A leaf proxy
  participates at its authored position in the same path.
- **Enter/F2 engages a focused unit.** This is useful for a read-only
  panel or for a unit selected with arrows or a pointer. The gesture
  latches `data-engaged`, emits `cause: 'descend'`, and lets an app move
  the camera. Enter on an interior control remains the control's own
  key.
- **Escape ascends**: interior → unit → scene. An engaged group releases
  its latch and emits `cause: 'release'`, which lets an app return the
  camera home.
- An engaged group wraps Tab inside its own members until Escape. A
  group entered by an ordinary click or Tab does not trap focus.
- **`interiorBoundary`** (`focusTree.ts`, vitest-pinned) decides native,
  member, and group-edge moves. It uses element identity, not a count of
  key presses.

**The scene ring is a closed loop.** Native edge handoff exists (probe
1), but parked subtrees still sit in the page's tab order, so a "hand
back to the browser" exit would immediately re-enter panel DOM. Real
page-embed handoff needs the proxy layer to own page-side stops.

## Focus memory — a stack, not a pointer

Per group, a stack of previously-focused members (Flutter's
`_focusedChildren`), because a single pointer ships two bugs:

- **Restore validates lazily.** On re-entry, pop entries whose target
  is unmounted or unfocusable; land on the *next-most-recent* valid
  one, not "first in order."
- **Explicit unfocus clears.** Escape-ascend clears the group's stack —
  otherwise Tab immediately after Escape re-focuses the thing you just
  left (Flutter documents exactly this bug in a source comment).
- Role nuance (APG): grid-like groups restore last-focused;
  *selection-bearing* groups (radio-like, tab-like) restore the
  **selected** member instead.
- Disposing a focused target restores from the stack (never drop focus
  to `<body>`).

## Ordering and entry

- **Within a group: authored order.** A synth's author knows cutoff
  precedes resonance; camera motion must not reshuffle a designed
  device. Escape hatch: explicit numeric order prop (Flutter's
  `OrderedTraversalPolicy`: ordered members first, stable-sorted, then
  unordered in secondary order).
- **Between groups: authored order first** (`FocusGroup order` →
  `sceneRing`) — a designed roster IS the intent, and the band
  algorithm is a fallback for unordered groups, not the primary. The
  first user test read the band algorithm's arc-projection output as
  scrambled. Unordered groups fall back to **screen-space reading
  order** via Flutter's band algorithm: take the topmost rect; form the
  infinite horizontal band spanning its vertical extent; every rect
  intersecting the band is a member; order members left-to-right;
  repeat with the remainder. **Ordered groups never project at all
  during a ring walk**, so mid-tween camera sampling cannot touch the
  authored case (settle-gating the geometric fallback is a watch item).
- **Registration order is a trap the tree absorbs.** React child
  effects run bottom-up, so members register BEFORE their FocusGroup —
  and a Surface's composite registers LATE, because its source element
  is async. `registerMember` therefore creates the group record
  implicitly, and unordered members default to
  composites-first-then-leaves so mount timing cannot reorder a designed
  device; explicit `order` is the escape hatch. The silent-drop version
  of this shipped once and cost a browser session to find: a dial sat in
  the proxy layer but not in its group's traversal.
- **Every sort stable** (Flutter treats this as contract): equal
  coordinates must not shuffle between keypresses.
- **Sample order at boundary-hop time, and at tween-settle** — never
  against a mid-tween camera (band near-ties flicker), never
  continuously (mid-sequence re-sorts make Tab nondeterministic).
- Traversal order lives in **no React state** — derived imperatively at
  keypress time (Flutter's `updateShouldNotify => false` discipline).
- Force-include the *current* target in sort input even if it just
  became disabled — else Tab away from a freshly-disabled control
  silently no-ops (Flutter).

**Entry policy.** With no live cursor, Tab/Enter selects the nearest
*fully-visible* unit to the viewport center (`entryPick`), falling back
to most-visible; `initialFocus` overrides. Mouse users who dollied in
manually get the same heuristic: the first Tab enters the group
dominating the viewport.

## Directional navigation (arrows, at scene/unit level)

**Shipped** (`packages/react/src/lib/spatialNav.ts`, pure +
vitest-pinned) at scene and unit level; arrows stop at unit edges
(Flutter's Tab-wraps/arrows-stop asymmetry, kept). Engaged units pass
arrows through to their interior untouched.

Geometry is **camera-projected screen-space AABBs, sampled per
keypress** — the spec's own frame (spatnav computes on final
post-transform layout; projection is the faithful 3D generalization).
Nothing is cached across keypresses except the history stack below.

**Two regimes, split before any scoring** (spatnav §8.4 — projected 3D
panels overlap constantly, and overlapping rects must never reach the
distance formula):

1. **Insiders** — candidates whose rect overlaps/contains the origin's,
   filtered by edge-progress in the direction (top edge below origin's
   top edge, for down), **and by the centroid cone** (decisions.md #14):
   the candidate's centroid displacement must lie in the direction's
   quarter-plane. Overlap alone is not insider status, because projected
   neighbors overlap by slivers (grab handles, perspective) and a ~3px
   sliver otherwise outranks the true neighbor. Rank by edge progress
   **plus centroid orthogonality** (`od·Wo`, decisions.md #15): at the
   arc's edge, projection bloat makes every neighbor an "insider", and
   raw minimal progress then hands the pick to whichever row leans
   nearest on screen. True stacks pay no penalty — a contained
   candidate's centroid is inside the band by definition — so the FPWD
   fix is law, refined: concentric stacks stay reachable from all four
   directions; an offset *contained* candidate is reachable via its
   dominant axis only. Tie-break by **depth** (our painting order).
2. **Outsiders** — candidates strictly past the origin's trailing edge.
   Score with the distance function; smallest wins; ties by tree order
   (stable).

**Distance function** — spatnav's structure, retuned constants:

```
distance = euclidean + orthogonalDisplacement·Wo − alignmentBonus·Wa
```

The spec's Wo = 30 horizontal / 2 vertical encodes *row-dominant text
layout*; a spatial workspace isn't one. Shipped symmetric (Wo ≈ 2 both
axes, Wa = 5). **`orthogonalDisplacement` is the candidate centroid's
distance outside the origin's cross-band — not band-to-band separation**
(decisions.md #15): band separation reads 0 for any sliver of
cross-overlap, and the projected arc's rows shear apart toward the edges
until a row-below neighbor's top grazes the origin's bottom — a 4px
sliver zeroed the penalty and its nearer edge beat the level neighbor.
The centroid says which row something is actually in; the band says only
whether the AABBs touch. Both regimes use this one measure
(`centroidOd`). The spec's −√overlapArea term is omitted: the regime
split guarantees outsiders share zero area with the origin, so the term
is structurally 0 here. The TAG-prototyped centroid-angle term (their
fix for the stock formula over-favoring 0°/90° candidates) did land — as
the insider *gate* above, not as a distance term.

Both defects that produced these two rules were found the same way, and
that method is the durable part: full-field rect captures, mirroring
`screenRect` against the registered groups, replay a browser pick
exactly in the pure module (`spatialNav.field.test.ts`). A pick that
replays is *lawful*, which convicts the formula rather than the
plumbing.

**Directional history — arrows must retrace.** The TAG flagged
spatnav's non-reciprocity (right-then-left doesn't return) as an
unresolved defect; Flutter's per-scope push/pop stack is the fix, and
for us it is load-bearing, not polish: **focus moves the camera, so the
geometry that chose the last target no longer exists by the next
keypress** — a pure geometric argmax cannot be reciprocal here even in
principle. Flutter's invalidation matrix is adopted wholesale: pop on
opposite direction; clear on perpendicular axis, on Tab, on external
focus change, on unmounted entry. External-change detection needs no
stamping atop a single router: `notify()` clears the trail whenever
`cause !== 'directional'` — Tab, Enter, Escape, pointer and disposal all
funnel through the same chokepoint. A retrace pops without
re-recording, so ping-pong cannot grow the stack; an invalid retrace
target clears the whole trail (it describes a world that's gone).

**Directional entry into a group** lands on the member nearest the
entry edge (spatnav's inner-distance rule), not authored-first — Enter
still uses authored-first/memory.

**The no-candidate ladder** (per level): visible candidate → focus it.
None, but the camera can still move that way → **tween one increment,
don't move focus** (repeated presses alternate tween…tween…focus as
targets come into view). Can't move → no-op. This ships as a mirror of
the reframe bridge — detect here, fulfill there: the library asks
registered `NavPolicy`s (`useFocusNavPolicy`) `canMove(dir)` and hands
the first taker a `nudge` request; nudges never move focus and never
record history. The **camera-bounds predicate** (the spec's "can be
manually scrolled" analog) is `viewPitchRoom` (`cameraPose.ts`): pitch
room to the polar-band edges, yaw unbounded for orbit rigs — without it
the ladder is ill-defined. A rigless scene registers nothing and simply
stops at the last projectable candidate. Of the spec's two per-group
philosophies — `auto` (only visible candidates, view nudges stepwise)
vs `focus` (offscreen candidates focusable, camera follows focus) —
`focus` is the shipped default.

## Proxy contract (leaves)

- **One imperative proxy layer** (`FocusScene.registerLeaf`): plain DOM
  appended beside the canvas. Inside the r3f reconciler a react-dom
  portal cannot reach, so no React touches proxies at all — which also
  closes react-three-a11y's root-per-proxy crash class by construction.
  **Never a React root per proxy** (their `createRoot`-per-element is an
  open React-19/StrictMode crash class).
- **Never inside a Surface's source canvas subtree** — proxy mutations
  (`aria-valuenow` during a physics settle) would be paint-record
  changes, storming repaints on an unrelated texture.
- **Positioned at the target's projected screen rect** — not decoration:
  VoiceOver/TalkBack one-finger exploration and double-tap dispatch
  touches at the element's screen position, and magnifiers track
  focused-element geometry. (react-three-a11y ships a fixed 50px disc;
  true rects are strictly stronger. Their per-proxy per-frame sync is
  also their open perf bug — 14 instances → 3fps.) Rects re-project on
  focus transitions plus `syncProxyRects()` at camera tween-settle and
  drag-end — **never per frame**.
- **Hiding recipe:** `opacity:0` + clipped box. Natively, opacity-zero
  elements are focusable and tabbable (tabbable's maintainers, verbatim
  in source). Never `display:none`, `visibility:hidden`, `inert`, or
  zero-area (the last is a flagged a11y anti-pattern) — all make the
  proxy unreachable. **Never `display:none` a focused proxy**
  (react-three-a11y's behind-camera culling silently drops focus to
  `<body>`): hand focus off before hiding. **Disposing a focused proxy
  hands focus up first** — own unit, else the canvas — never a silent
  drop to `<body>`.
- **Native semantics do the key handling.** A real `<button>` gives
  Enter/Space; `role="slider"` plus our keydown gives arrows. Zero
  synthetic events. APG slider contract: all four arrows (Up/Right
  increase), **Home/End mandatory as absolute jumps** — the physics
  layer needs a settle-to-extreme operation, not just impulses;
  optional PageUp/Down for large steps. `aria-valuenow/min/max`,
  `aria-valuetext` for human units, `aria-orientation` when vertical.
  Switch: `role="switch"`, `aria-checked`, Space (Enter optional).
- **Announce per detent crossing; settle stays authoritative.** A
  strict rest threshold fires ~2.7s after an arrow kick, because the
  ringdown must decay first — correct physics, unacceptable AT latency.
  `aria-valuenow` lands at each detent crossing (a handful of writes per
  second, paint-free per probe 6) and once more at true rest.
- **Keyboard input is force, calibrated by simulation.** Arrows inject
  impulses into the 1-DOF integrator; `hopImpulse` bisects the actual
  integrator (`flipImpulse`'s idiom) so one press from rest is exactly
  one detent at any tuning, and key repeat compounds impulses into
  momentum, as designed. Keyboard a11y that goes *through* the physics,
  not around it.
- **Leaf-only groups fall back to proxy-as-unit** — a free-standing
  control is its own stop.
- **Pointer-events decision:** proxies are `pointer-events:none`
  (react-three-a11y's hit-testable invisible discs are its largest bug
  class — stuck hover, event stealing). The trade, made consciously:
  mobile SR double-tap dispatches a click at the focused element's
  screen point, which now falls through to the GL canvas — the canvas
  raycast path MUST activate the control that owns SR focus (they
  coincide spatially because proxies sit at projected rects). Verify on
  device; if it fails, flip pointer-events on only while AT interaction
  is detected.
- **Announcer kit** (lifted nearly verbatim, expert-reviewed):
  `aria-live="polite"` + `aria-atomic="true"` sibling-of-canvas div,
  sr-only clip styling; clear-then-100ms-re-set to re-announce identical
  messages; announce *activation feedback only* — never what native
  semantics already convey.
- Focus hygiene: a window-level click listener blurs scene focus on
  real mouse clicks (`e.detail !== 0` — keyboard-synthesized clicks
  carry `detail === 0`).

## Camera integration

Focus changes emit events; **the manager never moves the camera**
(primitives over components, decisions.md #1). Two events mirroring
spatnav's, both cancelable:

- `onFocusChange(target, cause)` — before commit (their
  `navbeforefocus`). The scene's typical response: tween to frame the
  target. Canceling redirects/suppresses.
- `onNoTarget(direction, group)` — a direction exhausted a group (their
  `navnotarget`). App-level wrap-around or camera nudge lives here.

Spatnav removed its cancelable pre-scroll event for scroll-performance
reasons that don't apply to a camera tween — a cancelable pre-move
event is viable for us where it wasn't for them.

Descend fires the zoom: entering a group emits the focus event the
scene answers with a dolly-in (Tab, Tab, Enter, glide, then interior
Tab). The mode boundary is a keypress, never a camera-distance
threshold — no ambiguous mid-zoom band.

**Packaged rig.** Everything this section asks of a scene —
approach/home tweens with pose legality, the reframe fulfiller's
head-turn, the no-candidate nudge ladder, motion modes, live-aim
publishing — ships as one component, `FocusOrbitRig` (`home`, `approachDistance`,
`nudgeAngle`, `comfortFraction`, `apiRef`) — a copyable recipe in
`registry/focus-orbit/`, not a published name. The
grammar wiring (descend→approach, release→home-holding-the-unit,
scene-escape→home) lives inside it, fed by `FocusSceneEvent.object`:
resolved at the notify chokepoint from the registry the manager already
keeps, so a consumer supplies poses and nothing else.

**Reframe bridge.** DOM `focus()` carries an implicit obligation — the
scroll container brings the element into view (WCAG 2.4.11's floor).
Our `preventScroll:true` suppresses the page's fulfillment (correct:
panels aren't in page flow), so the obligation transfers to the camera —
which is APP state. So the library only *detects and requests*: after
every focus transition it caused (never `pointer`/`escape`/`release`),
if the focused unit or leaf projects <50% visible without covering the
viewport center, it emits `ReframeRequest {groupId, object, rect,
viewport, cause, level}` to registered fulfillers (`useFocusReframe` /
`registerReframeFulfiller`). The DOM precedent is exact: `focus()`
requests, the scroll container fulfills, `scroll-margin` tunes
(`reframeMargin` is its analog). XR is why the split is load-bearing —
a fulfiller may refuse to move the user's head and highlight instead. A
built-in minimal fulfiller (bare camera truck, clamped to one viewport
per event) keeps the invariant in rigless scenes and stands down while
any app fulfiller is registered. `'descend'` requests are emitted (the
rigless floor) but rigs ignore them — their approach ride already
centers the target.

**Fulfiller geometry.** Screen-space pixel deltas linearize
catastrophically for far-off-frame panels: a box straddling the camera
plane projects to an absurd rect, and a faithful truck flew the camera
to x ≈ −1058. The workspace rig's fulfiller is therefore a minimal
HEAD-TURN — rotate the view direction to a comfort cone, exact at any
angle and bounded by π — with elevation pre-clamped to OrbitControls'
polar limits so the settle handoff cannot pop the position (y 2→3.05
otherwise). The library's default fulfiller keeps pixel math but clamps
to one viewport per event.

**Pointer selection.** Clicking a Surface selects its unit — the
pointer analog of Tab, minus the camera: the click proves the panel
visible, so the `'pointer'` cause never reframes, and the ring cursor
updates so the next Tab continues from the clicked panel. Mechanics:
forwarded synthetic clicks bubble to a document-level capture listener
(capture because focus-follows-click is browser behavior, not an event
contract markup can `stopPropagation` away). The listener defers one
microtask — `forwardPointer` runs its focus fixup *after* dispatching
the click, including a blur when nothing focusable sat under the point,
which would immediately undo a focus set synchronously — then fills in
`focusUnit(id, 'pointer')` only if the group ended up without focus.
Clicks that land real focus (a button) therefore win; clicking dead
space in a panel selects it instead of dropping focus to nothing.
Click-in still never engages.

**Release aims home at the released panel.** Position comes home while
the view holds the panel Tab framed — a corner panel released to
dead-center NDC (0,0) is exactly where bare `home()` loses it
off-screen.

**Fast Tab interpolates continuously.** The rig publishes the live aim
into `controls.target` every tween frame, so mid-flight re-arms read the
rendered pose rather than the stale settle value (a 5-Tab burst peaks at
0.018 rad/frame with no snaps). Arming a new tween from the stale
settle-time target is what makes fast Tab jank.

**Motion.** The built-in fulfiller honors `prefers-reduced-motion` by
applying its correction as a jump cut — vestibular safety is a library
floor, not app policy. Rigs are expected to do the same
(`setMotion('animated' | 'instant' | 'auto')`, auto following the media
query).

**Two pose laws, pinned in `cameraPose.ts` tests**, for any fulfiller
that tweens `(position, target)` poses against OrbitControls:

1. **Arm only poses already legal under the controls' polar/distance
   limits.** Settle hands the pose to `update()`, which re-satisfies
   clamps by *moving the position* — a visible last-frame yank
   otherwise. With every armed pose pre-clamped legal
   (`clampOrbitPose`), the controls handoff is a no-op and a top-row
   approach lands phi exactly at the limit with zero tail movement.
2. **Interpolate gaze in yaw/pitch** — never by lerping the target
   point, whose straight path can sweep past the camera (measured 1.13
   rad in one frame), and not on the great circle either, where
   near-antiparallel horizontal aims arc over the zenith and `lookAt`'s
   up-vector degenerates (0.31 rad/frame of spin). Yaw/pitch is
   turning-in-place body grammar; its elevation never leaves the
   endpoints' band, so the pole is unreachable. It lands at the
   mathematical bound (0.052 rad/frame). All three schemes are pinned so
   the two rejected ones stay rejected for a stated reason.

## Surface markup rules (tab hygiene)

Boundary interception must compute a subtree's tab sequence (transcribe
tabbable's rules; it's the de-facto standard). To keep the computed
sequence and Chrome's actual behavior identical:

- **No positive `tabindex`** inside Surface markup (browser orders
  positives document-wide; any local computation diverges — and expert
  consensus bans them anyway).
- **Keep one radio checked per group** — with none checked, browsers
  disagree on which radios are tabbable.
- **No native media `controls`** in Surface markup (one element to the
  algorithm, multiple internal shadow-DOM stops to Chrome; media
  bypasses the DOM path anyway, decisions.md #5).
- `<details>`: the `<summary>` is the tab stop, not the details.
- `contenteditable` detection requires the attribute on the element
  itself.
- **Intercept on element identity, not press counting**: macOS settings
  make Safari-family browsers skip links while tabbing — "count N
  presses" desyncs. The rule is: focus is on the computed-last tabbable
  AND Tab arrives → intercept.
- **Cache the sequence per subtree, invalidate on `paintCount`** —
  tabbability checks force layout reflow (tabbable's known perf issue),
  and we uniquely own a free "subtree changed" signal.

## Autofocus

Deferred queue, resolved end-of-tick, first-valid-wins per group; a
request is valid only if the target is still mounted, still in the
group, and the group has no focused member (Flutter's `_Autofocus`
mechanics). Async-mounting Surfaces make this non-optional.

## Focus indication

APG requires a visible indicator on whatever holds focus, including the
`tabindex="-1"` group root. Interior focus: the browser's ring, painted
into the texture (self-paints per `platform.md`). Unit/leaf focus:
mesh-level treatment (rim glow, focus-as-light) — and because
compositor-owned properties are off-limits in markup (hard rule), any
DOM-side indication uses paint properties only. `:hover`-style mirroring
applies: if `:focus-visible` doesn't survive our programmatic routing
(probe 4), mirror as `data-focus-visible` exactly like `data-hover`.

**Survey and engaged chrome must differ** — a dim 2px inset at unit
level, a bright 3px ring plus brighter border while engaged. A caution
that cost a session: the stamped unit element IS the panel root, so a
descendant selector (`[data-focus] .panel`) never matches and all
visible "focus" comes from elsewhere. The self form
(`.panel[data-focus]`) is the correct one, and computed style is the
only way to tell the difference from a screenshot.

## Platform probes (the empirical gate)

Run via `?focusprobe=1` (`window.__focusProbe`), with real keys through
the automation CDP path — synthetic keydowns don't move focus.
Trial-flag evidence: parked sources' `paints > 0` in `stats()`.

| # | Claim to verify | Expected | Result (Chrome 150) |
|---|---|---|---|
| 1 | Real Tab reaches focusables inside parked source canvases; order is document (mount) order | reach, doc order | **✓** full sweep: page-before → proxy-slider → proxy-off → page-after → a-btn → a-input → b-btn → b-input; past the last, Tab leaves to browser chrome (the scene-edge handoff exists natively) |
| 2 | Focusing a parked-subtree element self-paints the focus ring into the record (`paintCount` advances) | yes (platform.md self-paint table) | **✓** paints 1→2 on the focused source, neighbor untouched; blur paints too |
| 3 | Document-capture keydown sees Tab targeted inside a parked subtree; `preventDefault` suppresses the native move; `.focus({preventScroll:true})` re-routes without viewport jump | all yes | **✓** intercept entry `prevented:true`, focus landed on hop target, scroll pinned at base |
| 4 | `:focus-visible` matches after programmatic `.focus()` inside a Tab-key handler (heuristic credits keyboard) | yes, per spec heuristic | **✓** true on the hop target inside the handler and on every Tab-focused element in the sweep. (Observed: eval-context programmatic focus *also* got `:focus-visible` — don't rely on it; `data-focus-visible` mirroring stays the fallback) |
| 5 | An `opacity:0` fixed-position proxy (`role="slider"`, `tabindex="0"`) is Tab-reachable and receives arrow keydowns | yes | **✓** both proxies in the Tab ring; ArrowDown/ArrowUp/Home all delivered |
| 6 | Arrow keys on the focused proxy don't scroll the page; `aria-*` mutations on proxies never advance any Surface source's `paintCount` | yes / 0 paints | **✓** scroll pinned through all presses (handler preventDefaults per contract); 6 `aria-valuenow` writes → paint delta 0 on both sources |
| 7 | Focusing an offscreen fixed element with `preventScroll` leaves scroll untouched; without it, measure | untouched / measure | **✓** untouched **both ways** — fixed positioning sits outside scroll geometry entirely, so parked sources and the fixed proxy layer can never yank the viewport |

Every load-bearing platform assumption of this design is confirmed. The
probe page stays as the re-verification harness for future Chrome
versions.

## Not built

Each of these is designed above but deliberately unshipped; none is
blocked on a discovery.

- **Page-edge handoff** — needs the proxy layer to own page-side stops,
  so the scene ring stays closed until then.
- **Member-level arrows** and per-group `grid` mode
  (aligned-candidates-first, axis-distance only).
- **The `auto` navigation philosophy** (only visible candidates, view
  nudges stepwise); `focus` is the shipped default.
- **Directional entry refinements** beyond the inner-distance rule.
- **The announcer**, specified above under the proxy contract.
- **Leaf-only groups** fall back to proxy-as-unit in code but are not
  browser-exercised.
- **Screen-reader verification** is manual (VoiceOver): proxy
  announcement ("Volume, slider, 4 of 11"), group labels
  (`role="group"`), one-finger exploration over projected rects,
  double-tap-through-canvas activation.

## Prior art (what we took, what we rejected)

- **react-three-a11y** (pmndrs): validated the proxy pattern +
  screen-rect positioning rationale (mobile AT); took the announcer kit,
  the `e.detail` click hygiene, native-semantics-over-key-handlers.
  Rejected its architecture: per-proxy React roots (crash class),
  per-frame sync (perf class), flat leaf list (no tree/groups/
  composites — its issue tracker requested sliders and grouping for five
  years).
- **Flutter focus system**: the tree architecture, memory-as-stack with
  lazy validation, `parentScope` edge behavior + guards, the band
  algorithm, ordered-policy mixing, the directional history stack and
  its invalidation matrix, autofocus queue, stable-sort discipline.
- **CSS spatial navigation** (css-nav-1 → css-spatial-nav-1;
  browser-unimplemented, quietly revived 2026-06): insiders/outsiders
  regime split, the distance-function structure (weights retuned —
  theirs were fitted to 2D text rows; TAG documented the defects), the
  no-candidate ladder incl. the scroll-boundary predicate,
  inner-distance group entry, per-container `action`/`function` knobs,
  both cancelable events. Its unsolved problems we sidestep by design:
  implicit descend (we have Enter/Escape), non-reciprocity (history
  stack), hostile iframes (single-origin scene).
- **APG + tabbable**: the one-stop-per-group reversal, Enter/F2/Escape
  semantics, single-widget-cell rule, memory-vs-selection restore
  nuance, roving-tabindex preference, slider/switch key+ARIA contracts,
  the full focusability rule set and its edge cases.

The seam nobody occupies: a focus tree whose composites are live DOM
and whose leaves are physical objects, ordered by a camera that focus
steers back. Flutter has the tree but no 3D; tvOS has spatial focus but
no DOM; react-three-a11y has proxies but no composites; spatnav scopes
Tab out entirely.
