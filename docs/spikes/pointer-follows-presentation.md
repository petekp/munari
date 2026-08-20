# Spike: pointer follows presentation (2026-08-19)

Trial fix for the lifting-phase pointer fault (`npm run probe:lifting-pointer`
confirmed 2026-08-19: 3/3 lifting clicks misrouted to the parked copy).

**Questions asked:**

1. Does declining the presenter's raycast while `!store.canvasPresents()` fix
   lifting routing without breaking the rest and gl baselines?
2. Is there a dead window at the presentation flip where a click lands on
   nobody?
3. What happens to a press held across the swap (down during lifting, up
   after)?
4. During 'landing', does input already follow presentation?

**Verdict: viable** — a one-guard filter at the presenter raycast fixes
routing in every phase with no dead window; the real law needs two additions
the filter alone does not give (hover clear at the edges, a defined fate for a
press held across the swap).

## What we learned

1. **Yes.** The patch was one live read at the top of `SurfacePresenter`'s
   raycast: `if (!store.canvasPresents()) return`. Because the pointer gate
   raycasts through the mesh's own `raycast`, starving it starves both the
   gate (canvas never goes solid) and r3f's relay in one place. Measured:
   rest → page, lifting +100/+350/+600ms → **page** (was 0/3, now 3/3),
   gl → source. Real `:hover` on the visible page copy during lifting went
   from false to true. `npm run probe:lifting-pointer`, `npm test` (1117),
   and `npm run gate:lab-interactions` all pass with the patch in.
2. **No dead window.** 14 trusted clicks fired ~35ms apart across the flip:
   14 heard (6 by the page copy, 8 by the source), 0 by nobody. The gate's
   `onDown` raycasts directly rather than waiting for an arming move, so the
   first post-flip click routes correctly with no hover priming.
3. **The press is dropped cleanly, not corrupted.** Down during lifting is
   heard by the page copy (real `:active` appears). At the swap the page copy
   goes `visibility: hidden` and the browser itself drops its `:active`; the
   later up and click are heard by nobody and no state sticks on either copy.
   So today-with-filter, a press across the swap is a silently lost gesture —
   acceptable as a floor, but the law should make the cancellation explicit
   (the page copy should receive a pointercancel-equivalent, and the design
   should decide whether an active press may instead delay the swap).
4. **Yes.** `canvasPresents()` is `crossingPresentation(phase).gl` for
   exclusive surfaces, which is true in 'landing' — a click at landing
   +100ms (presented=webgl) routed to the source. Landing is already
   input-follows-presentation under this filter; no separate case needed.

## What surprised us

- **Stale hover state survives the ownership flip in both directions.** After
  a gl-phase hover, `data-hover` stays stamped on the parked copy through the
  return to page phase (and a hidden page copy can keep reporting
  `:hover`) until the next real mouse move, because the relay's departure
  burst only fires on pointer motion. The filter changes who hears the NEXT
  event; it does not close out the LAST owner's hover story. The real fix
  needs a boundary burst (the out/leave protocol the relay already owns) fired
  at the phase edge itself, at the pointer's current position.
- No dead window even under a 35ms click burst — the flip is atomic from the
  input side because both the gate's down path and the page copy's hit test
  read the same frame's state.

## Still unknown

- Whether any lab scene relies on relayed pointer events DURING lifting
  (e.g. a drag that starts the lift and keeps steering it through mesh
  events). `gate:lab-interactions` passed, but the local-only genie gates
  were not run; the genie gesture rig drives the crossing from DOM events,
  so it should be unaffected. Run the genie gates before shipping.
- Where the pointer's current position comes from for the edge burst — the
  relay tracks the last forwarded sample; whether that is fresh enough at the
  flip, or the fix needs a document-level last-pointer cache, was not
  measured.

## Recommended approach

- Add the third crossing theorem to `packages/core/src/transfer/crossing.ts`:
  `crossingPointer(phase): SideFlags`, equal to `crossingPresentation` (input
  follows the eye), pinned by its own conformance contract in
  `tests/conformance/transfer/` walking every phase, with the exclusivity
  theorem (exactly one side hears) stated in the comments.
- Consume it where presentation is already consumed: the presenter raycast
  declines while the canvas side does not hold pointer ownership (the spike's
  one-line shape, but reading the new law, not `canvasPresents` directly —
  the two are equal today and the law name says why the raycast cares).
- At each ownership flip, close out the losing side: fire the relay's
  departure burst on the copy losing input (clears `data-hover`/`data-active`
  twins) and cancel any active relayed press (`forwardPointer` 'cancel').
  The mid-gesture-across-the-swap fate becomes a designed choice in
  decisions.md: cancel-at-the-edge is the floor the spike measured.
- Promote `instruments/lifting-pointer` from probe to gate in the same
  change: the lifting clicks flip from reported to judged (must reach the
  page copy), and the hover sample judges `pageRealHover === true`.

## Cost signals

- Core: one new theorem + conformance suite (small; mirrors
  crossingPresentation's contract).
- React: the raycast guard in `SurfaceWebGL.tsx`, plus the edge burst — the
  harder part, likely in the handle where phase transitions are announced,
  calling into the relay's existing clear/cancel machinery.
- Instruments: lifting-pointer probe → gate (assertions + CI wiring).
- Ledger: one decisions.md entry (the pointer-ownership law and the
  press-across-the-swap fate).
- No new dependencies. The spike patch itself is NOT the implementation —
  it read `canvasPresents` directly and did nothing at the edges.
