# Opening

**Status: proposed, unbuilt. Updated 2026-10-23.**
Source baseline: `5a79523`. This specifies a first-load reporting API for
munari components. It does not describe behavior shipped in the package.

## Product contract

An app wraps a demo in `<Opening>`. The Opening calls `onOpened` once, from a
page animation frame, when nothing inside it is still waiting. The library
reports three things: when each library component inside first showed
complete content or settled on its fallback, which presentation and capture
engine it used, and what failed. The app decides what to cover, when to fall
back, and what to announce.

The library never hides, fades, suspends, or unmounts content, and it sends no
messages to a parent frame. Content stays mounted, laid out, and painted while
it prepares, because a capture needs live DOM. Covering it is app code.

```tsx
export function KnobsDemo() {
  const supported = useSurfaceSupport()
  return (
    <Opening onOpened={announceOpened} late={{ afterMs: 4000, onLate: chooseNative }}>
      <FontsWait />
      {supported ? <KnobsScene /> : <DegradedKnobs />}
    </Opening>
  )
}

function FontsWait() {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => { void document.fonts.ready.then(() => setLoaded(true)) }, [])
  useOpeningWait('fonts', loaded)
  return null
}
```

Library components inside the Opening join it on mount: Surfaces,
SceneSurfaces, SurfaceCanvases, captures, FrameSurfaces, and nested Openings.
The app adds what only it knows with `useOpeningWait`: a font, a model, a film
frame, or a renderer it created itself. A wait can go back to waiting. If its
condition stops holding before the opening completes, the opening resets.

The Opening sits above the branch that decides whether a canvas mounts. That
is how `DegradedKnobs`, which mounts no Surface, is covered. An Opening with
nothing to wait for opens after its first commit and one recheck frame.

Time never turns waiting into an error. `late` is a notice. It counts only
frame time the page actually ran, so a demo loaded in a background tab does
not downgrade itself. The current four-second limit does downgrade it
(`apps/lab/src/scenes/light/lightOpening.ts:20`).

| Situation | Required behavior |
|---|---|
| Every entry inside has settled | `onOpened` fires once, with a frozen report |
| An entry is waiting | The Opening stays open; `late` may fire once |
| An entry is in `error` | The Opening stays open until the entry recovers or leaves the tree |
| An entry joins after the opening | Status does not change; a development warning names it |
| The Opening unmounts first | No callback fires |

## Terms

**Shown** is the one new term. A Surface, SceneSurface, SurfaceCanvas, or
FrameSurface is shown when the presentation it settled on has put one complete
frame of its current content on screen. A Surface is shown with all of its
declared parts or not at all (`surfaceHandle.ts:764-771`; decision #37
records why a declared part with no presenter blocks).

- **Scene presentation.** Every registered presenter has made a qualified
  color-writing draw of the current source lifetime. That is the draw of
  boundary 5 in
  [the system model](system-model.md#keep-the-observable-facts-separate),
  without its transfer requirement.
  Two more conditions apply. The drawn paint was read with no document font
  load in progress, and any anchored children have drawn. A host frame
  containing those draws has finished.
- **Page presentation.** The page HTML is committed and holds the page, and
  one animation frame has run since that commit. The library does not observe
  the browser painting it. This is an inference, and it sits outside the
  five-boundary chain.

Shown resets when the source lifetime ends or the controller unmounts.

| Existing signal | What it proves | How Shown differs |
|---|---|---|
| Readiness: `sceneReady`, `onReady` | Presenters exist and made first eligible draws (`CONTEXT.md:107-109`). A write-free warm-up satisfies it (`SurfaceMesh.tsx:1078-1082`) | Shown needs color-writing draws that reached the canvas |
| `presentation`, `onPresentationChange` | Which presentation holds the content now | Shown is the first complete frame. `presentation` stays `'scene'` across a source replacement, because `present()` returns early once `canvasHeld` is set (`surfaceHandle.ts:763`, `:807-813`) |
| `PresentationReceipt` | A draw met one transfer's requirement (`packages/core/src/transfer/presentation.ts:16-33`) | Shown needs no transfer. It uses the same route law, `presentationRoute` and `hostTailPresents` |
| `CaptureStatus` `'ready'` | A paint, plus an upload armed but not yet run (`capture.tsx:100-115`) | A capture has no presentation of its own, so it is never shown. This spec renames the status to `'captured'` |

The evidence is recorded in JavaScript, in `onAfterRender` or at the end of a
host frame. A long synchronous pipeline compile in the GPU process delays the
real screen frame, not the record. `presentation` has the same limit today.

## Public API

All names are NEW unless marked. The root entry, `@petepetrash/munari`,
exports them.

```ts
// ── Opening ─────────────────────────────────────────────────────────────
export interface OpeningProps {
  readonly children?: ReactNode
  /** Once per mount, from a page animation frame, never inside gl.render. */
  readonly onOpened?: (report: OpeningReport) => void
  /** A notice after `afterMs` of page frame time without opening. Never an error. */
  readonly late?: {
    readonly afterMs: number
    readonly onLate: (report: OpeningReport) => void
  }
  /** True: an enclosing Opening does not wait for this one. Default false. */
  readonly independent?: boolean
}
export function Opening(props: OpeningProps): ReactNode

/** Waits while mounted. Made for a Suspense fallback, whose subtree cannot call hooks. */
export function OpeningPending(props: { readonly label: string }): null

/**
 * An app wait. `false` waits, `true` is done, an Error is an error.
 * Registered in the layout phase; unmounting removes it.
 */
export function useOpeningWait(label: string, state: boolean | Error): void

/** The nearest Opening's status. A stable snapshot, new only when something changed. */
export function useOpeningStatus(): OpeningStatus

// ── Status ──────────────────────────────────────────────────────────────
export type OpeningStatus =
  | { readonly status: 'waiting'; readonly entries: readonly OpeningEntry[] }
  | { readonly status: 'opened'; readonly entries: readonly OpeningEntry[] } // frozen

export interface OpeningReport {
  readonly entries: readonly OpeningEntry[]
  /** Frame time counted from the first commit, up to this report or to `onLate`. */
  readonly visibleMs: number
}

export type OpeningEntryKind =
  | 'surface'        // Surface.Root with page HTML: Exclusive
  | 'scene-surface'  // SceneSurface.Root: Resident
  | 'surface-canvas'
  | 'capture'        // useElementCapture, CaptureContent: Twin and Source-only
  | 'frame-surface'  // FrameSurface inside a SurfaceCanvas
  | 'opening'        // a nested Opening
  | 'wait'           // useOpeningWait, OpeningPending

export type OpeningWaitReason =
  | 'renderer'      // host unmounted or starting
  | 'source-frame'  // no usable paint or published frame yet
  | 'presenters'    // a declared part has no presenter
  | 'presentation'  // presenters registered; not every one has a qualified color draw
  | 'fonts'         // every drawn paint was read while a font load was in progress
  | 'anchors'       // required anchors not committed, or their children not yet drawn
  | 'host-frame'    // the frame holding the qualifying draws has not finished
  | 'out-of-view'   // development builds only; production reports 'presentation'
  | 'opening'       // a nested Opening has not opened
  | 'app'           // a wait is false

export type OpeningEntry = {
  readonly kind: OpeningEntryKind
  /** Surface name, canvas id, or wait label. Null when none was given. */
  readonly label: string | null
} & (
  | { readonly status: 'waiting'; readonly waitingFor: OpeningWaitReason }
  | {
      readonly status: 'shown'
      readonly presentation: 'scene'
      /** Capture engine, as `SurfaceStatus.engine`. Null for a canvas or frame. */
      readonly engine: string | null
      readonly backend: SurfaceRendererBackend
    }
  | {
      readonly status: 'shown'
      readonly presentation: 'page'
      /** Why the scene was ruled out. Null when the scene was not requested. */
      readonly reason: OpeningFallbackReason | null
    }
  | { readonly status: 'captured'; readonly engine: string }
  | { readonly status: 'done' }
  | { readonly status: 'unavailable'; readonly reason: OpeningFallbackReason }
  | { readonly status: 'error'; readonly error: Error }
)

export type OpeningFallbackReason =
  /** `SurfaceStatus.reason`: no capture engine, or unsupported content. */
  | { readonly cause: 'support'; readonly message: string }
  /** The renderer status that ruled the scene out, from the proposed union. */
  | { readonly cause: 'renderer'; readonly renderer: Extract<SurfaceRendererStatus, { status: 'error' | 'context-lost' }> }
  /** Source creation threw (`surfaceSourceHost.tsx:168-174`). */
  | { readonly cause: 'source'; readonly error: Error }
```

**PROPOSED, built here unchanged.** Renderer status comes from
[the WebGPU migration lifecycle contract](webgpu-migration-spec.md#renderer-lifecycle).
This spec consumes it and defines no second union.

```ts
type SurfaceRendererBackend = 'webgpu' | 'webgl2'
type SurfaceRendererStatus =
  | { readonly status: 'unmounted' | 'starting' }
  | { readonly status: 'ready'; readonly backend: SurfaceRendererBackend }
  | { readonly status: 'context-lost'; readonly backend: SurfaceRendererBackend }
  | { readonly status: 'error'; readonly error: Error; readonly backend: SurfaceRendererBackend | null }
// SurfaceCanvasProps.onRendererStatusChange, SurfaceStatus.renderer
```

**CHANGED, EXISTING names.**

```ts
// capture.tsx:17. Same shape; 'ready' becomes 'captured', because it meant
// a paint and an armed upload, not readiness.
export type CaptureStatus = {
  readonly status: 'waiting' | 'captured' | 'unsupported' | 'error'
  readonly error?: string
  readonly reason?: string
}

// packages/core/src/paint/domTextureSource.ts, DomPaintReceipt gains one field:
/** A document font load was in progress when this paint's read started or completed. */
readonly readWhileFontsLoading: boolean
```

Unchanged: `SurfaceStatus` keeps its current fields plus the proposed
`renderer`. `sceneReady` and `onReady` keep the readiness meaning.
`FrameSurface.onPresented` keeps its requirement.

Outside any Opening, `useOpeningWait` logs a development warning once and
does nothing. `useOpeningStatus` logs the same warning and returns
`{ status: 'waiting', entries: [] }`. Library components outside an Opening
join nothing and pay no cost.

The Opening reads `onOpened` and `late` from the latest props when it calls
them. A new `late` object with the same `afterMs` does not restart the count.

## How each entry settles

Each entry's status is derived on read from state the library already owns.
The Opening stores which entries exist, not what state they are in.

| Relationship | Joins through | Shown or settled when | Unavailable or error |
|---|---|---|---|
| Exclusive, `inScene={false}` | Controlling `SurfaceRoot` | `shown` page after the page commit and one animation frame | Never |
| Exclusive, scene requested | Controlling `SurfaceRoot` | `shown` scene, as described below. The page copy shown during lifting never counts | Ruled out: `shown` page with `reason`. Ambiguous host: `error` |
| Twin | The capture owner | The native element is page content and adds no entry. The capture entry follows the Source-only row | As Source-only |
| Resident, `SceneSurface` | Controlling `SurfaceRoot` | `shown` scene, as described below | Ruled out: `unavailable` with `reason`. There is no page to fall back to ([WebGPU lifecycle rule L8](webgpu-migration-spec.md#renderer-lifecycle)) |
| Source-only, `useElementCapture` or `CaptureContent` | The capture owner | `captured`: the first published frame whose paint has `readWhileFontsLoading` false | Engine missing or content unsupported: `unavailable`. `CaptureStatus` `'error'`: `error`, which recovers if a later paint succeeds (`capture.tsx:97`, `:113`) |
| Frame source, `FrameSurface` | The component, inside a SurfaceCanvas only | `shown` scene at the first pass of an uploaded frame routed `now`, or `tail` once the host closes it | `error`, through an error path this spec adds. Today oversize and taint failures only log a development `console.error` and withhold receipts (`FrameSurface.tsx:148-180`) |
| `SurfaceCanvas` | The component | `shown` scene once the renderer is `ready` and the first host frame after the scene children's commit has finished | `error` or final `context-lost`: `unavailable` |
| Nested `Opening` | Its parent Opening | `done` when it opens | Never. While open it reports `waiting` with `opening` |
| App wait | `useOpeningWait`, `OpeningPending` | `done` on `true` | `error` on an Error |

A Surface joins once per store, counted. Genie's page `Surface.Root` and its
`Surface.Scene` share one handle, so they make one entry. Strict Mode's second
registration also counts once. Scene-side entries reach a page-side Opening
through R3F 9.8.1's context bridge (`useBridge` in the installed
`events-9ce18a08.esm.js`). That is supported upstream behavior, so no patch is
needed.

A FrameSurface outside a SurfaceCanvas joins nothing and logs a development
warning. It renders through the default output pass into an internal target,
so it can never present (`FrameSurface.tsx:25-29`).

### When a Surface is shown on the scene

**The store gains a second set of presenter keys beside `presenting`.** It
holds the presenters whose draws count for the current source lifetime. It
clears when `readiness.lifetime` or the controller epoch changes. A new
`noteShown` call adds a presenter from `SurfaceMesh`'s after-render callback
when all of these hold:

- The route is `now`, or `tail` and the host later closes it.
- The runtime has uploaded, and `rasterReady` holds. These are the gates
  `present()` uses today (`SurfaceMesh.tsx:1062-1075`).
- The receipt of the uploaded generation has `readWhileFontsLoading` false.
  This reads the drawn generation's receipt, not `currentPaint()`, which can
  be newer.
- The part's runtime is still the one that drew. The tail route checks this
  today (`SurfaceMesh.tsx:1099`), but the `now` route does not (`:1088`).

This set does not depend on `canvasHeld`. `present()` returns early once the
hold has flipped (`surfaceHandle.ts:763`), so a latch placed there could not
see a second source lifetime.

A Surface is shown on the scene when every registered presenter is in the
set and no declared part is missing. For an Exclusive Surface, the hold must
also have flipped to the canvas. The anchor and host-frame conditions below
also apply.

**The set must reach subscribers.** `publish()` emits only when `requested`,
`presented`, `ready`, or `isChanging` changes (`surfaceHandle.ts:655-668`).
`getStatus()` caches on the identity of `state` (`:860`). The shown fact
therefore joins `SurfaceState` and that comparison.

**Fonts.** A paint read during a font load does not count. The source already
repaints on `loadingdone` (`packages/core/src/paint/domTextureSource.ts:420`),
so the library knows a corrected paint is coming. Core stamps the receipt when
the read starts and again when the paint completes. A synchronous engine can
start a font load inside its own read, and the second stamp catches that. A
re-report of carried pixels keeps the original read's value. This check covers
scene and capture entries only. Page fonts are an app wait, so no
document-wide font gate can block an app's fallback.

**Anchors.** A Surface whose meshes require anchors is shown only after:

1. Each anchor scope has committed a set for the drawn generation. This is the
   existing `noteDrawn` promotion (`surfaceAnchorScope.ts:95-110`).
2. Each consumer, `SurfaceAnchor` and `useSurfaceAnchorRects`, has committed a
   render with the committed boxes and reported it from a layout effect.
3. A host frame has finished after the last of those commits.

This covers the lag between Knobs' face and its dials. The research
filmstrips show it on both engines; no instrument records its size yet. What a consumer does with the rects
outside the scene tree, such as Knobs' page-side scroller, is app work.

**Registration moves to the layout phase.** Six registrations run in passive
effects today:

- `registerPresenter` (`SurfaceMesh.tsx:482`);
- `registerPartPresenter` and `expectManualPresenter` (`SurfaceMesh.tsx:496-500`);
- the sampled-part registrations (`SurfaceMesh.tsx:501-506`);
- `store.expectPart` (`surfaceSourceHost.tsx:281`);
- `SurfaceAnchor`'s `require` (`SurfaceAnchor.tsx:72`);
- `useSurfaceAnchorRects`' `require` (`SurfaceAnchor.tsx:225`).

The part registrations feed the missing-part check. Without the move, a part
ledger or an anchor scope with no keys yet would count as complete. The face could then be shown before
the dials declare themselves.

**Host frames.** The binding observes the end of each host frame through
R3F's exported `addAfterEffect`, which runs after every root has rendered.
Hooking the end of `pipeline.render` instead would fire early when a frame
makes several screen renders. While an entry waits on a host frame, the
binding calls `invalidate()` so a `demand` frameloop renders it. Otherwise a
commit that adds no object, such as anchored children appearing, may never get
a frame.

**Out of view.** A presenter outside the camera frustum stays owed. Three
skips its draw callbacks, so it never joins the set. The reason is that a
camera can bring it into view on the next frame, and a reveal before that
frame is the build-up this API exists to remove. Production builds cannot
tell a culled presenter from a stuck one, because `reportView` runs only in
development (`SurfaceMesh.tsx:485`). The opt-out is explicit: wrap that
Surface's root in `<Opening independent>`.

### Ruled out, and renderer status

An entry is derived from author intent, not from the rendered destination.
During SSR hydration, `useSurfaceSupport` returns false, which makes the
Surface render in the page (`Surface.tsx:200-216`). Author intent and the
store's own latched capture support (`surfaceHandle.ts:391`) do not flip.

The scene is ruled out when any of these is true:

- the author did not request the scene;
- the store's capture support is false;
- the content has an unsupported-content `reason`;
- the renderer status is `error`;
- the renderer status is `context-lost` and no automatic replacement remains.

`unmounted` and `starting` are not ruled out. They wait on `renderer`, because
a SurfaceCanvas can mount after the content, as it does in Light's graphics
phase. Until the Opening opens, every input is read live, so a reason that
clears returns the entry to waiting for the scene.

**Context loss needs one ordering change.** Today `onDeviceLost` notifies
every store (`SurfaceCanvas.tsx:472`) before it calls `handleRendererLost`
(`:475`). That handler decides the retry from the `replacement` ref and
`REPEATED_LOSS_MS` in the same task, then schedules the remount through React
state (`:613-620`). The bridge will move that decision ahead of the store
notification. It then publishes `context-lost`
and, when a replacement is scheduled, `starting` in the same task. Entries
read the snapshot at the next page frame, so a resting `context-lost` means
no automatic replacement remains. That matches [WebGPU lifecycle rule L6](webgpu-migration-spec.md#renderer-lifecycle): after that, recovery
is an explicit remount.

**Startup failure is observable today.** Installed Fiber 9.8.1 catches the
configure rejection and rethrows it during render
(`react-three-fiber.esm.js:61`, `:118`), so `RendererStartBoundary` sees it
(`SurfaceCanvas.tsx:155-186`). The statement in work package 7 of the
[React API plan](react-api-improvement-plan.md) that an error boundary cannot
observe it is out of date. This spec needs `componentDidCatch` to write
`error` into the host snapshot. Until that lands, a failed start reads as
`starting`, the entry waits, and only `late` reveals the failure.

### When the Opening opens

While it is open, the Opening runs one check per page animation frame and
adds that frame to its frame time. The per-frame loop stops at the later of
`late.afterMs` and 10 s of frame time. That matches the existing 10 s
development-warning delay (`surfaceValidation.ts:9`), which is wall-clock
(decision #40). After that, it checks only on the frame after an
entry joins, leaves, or changes, plus the recheck frame that follows a passing
check, and its frame time stops growing. A stalled Opening therefore does no
recurring work once its notices have fired.

It opens at a check when:

1. its own layout effect has run at least once;
2. no entry is `waiting` or `error`;
3. the previous check saw the same, with no join, leave, or change between.

Condition 3 is the next-frame recheck from decision #57, kept as policy. It
catches a wait added by a commit's passive effects, and a live condition that
stops holding. It is not evidence of a paint.

At the opening, `onOpened` runs inside that animation frame callback, and the
status freezes. A React update it schedules commits in a later task, so a
cover lifted from it disappears at the next frame or later.

**Errors keep the Opening open.** An entry in `error` blocks until it recovers
or leaves the tree. The app answers a failure by rendering its fallback in the
failed component's place, which removes the entry in the same commit. The
opening therefore cannot land between a failure and the fallback. The library
uses `error` only for faults with no first-class answer: an ambiguous host, a
capture error, a FrameSurface failure through its new error path, and an app
wait set to an Error.
A renderer failure is `unavailable`, because SurfaceCanvas already shows its
`fallback` prop (`SurfaceCanvas.tsx:622`) and Exclusive Surfaces already
return to the page ([WebGPU lifecycle rule L5](webgpu-migration-spec.md#renderer-lifecycle)).

**Frame time.** The Opening adds page frame deltas, each clamped to 1/30 s,
the clamp the crossing clock uses (`SurfaceCanvas.tsx:380`). A hidden tab runs
no frames, and a throttled or covered frame adds little. The hidden-tab gate
below checks whether this clamp is right.

**A development warning** names every waiting entry after 10 s of frame time.

## Semantics

| Situation | Required behavior |
|---|---|
| Exclusive at rest (`inScene={false}`) | `shown` page after the commit and one frame. Capture work continues, as today |
| Exclusive requesting the scene at mount | The page shows during lifting while the entry waits. `shown` scene at the hold flip, once the anchor and host-frame conditions hold. A page result here would reveal Postcard's swap |
| Exclusive, later crossings | The entry keeps its first result. `presentation` and `onMotionComplete` report later crossings |
| Twin | The native element adds nothing. The capture entry settles at `captured` |
| Resident | `shown` scene, or `unavailable`. No page is invented |
| Source-only | `captured` at its first font-stable published frame. The consumer's draw is unproven; an app that needs it adds a wait from that draw. Marble Hand's environment switch keys on whether a captured frame exists (`marbleHandEnvironment.tsx:394`, `:401`) |
| Frame source | `shown` scene at the first presented pass of an uploaded frame. A source that never publishes waits on `source-frame` |
| Native fallback: capture engine missing | Known at mount. Exclusive: `shown` page with the capture reason. Resident and capture: `unavailable` |
| Native fallback: unsupported content | Exclusive: `shown` page with the reason; Resident: `unavailable`. Read live until the opening, because a content change recomputes it (`Surface.tsx:467-498`) |
| SSR hydration | Entries read author intent and latched support, so they do not flip. The app's own `useSurfaceSupport` branch flips in a re-render; whether that lands before the first check is unmeasured |
| html-in-canvas path | `engine: 'html-in-canvas'`; the conditions as written |
| snapDOM path | `engine: 'snapdom'`. Live pacing near 250 ms delays the entry. A font fetch that fails embeds nothing (`snapdomFonts.ts:242-263`) while `document.fonts.status` reads `loaded`; the font check cannot see that |
| `DegradedKnobs`, or no library entries | Opens after the first commit and the recheck, once app waits are done |
| Hidden tab | Page frames and host frames stop, so nothing settles and frame time does not grow. On return, work resumes. Whether html-in-canvas `onpaint` runs while hidden is unmeasured |
| Tab hidden after the opening | Nothing changes |
| Component mounted before the opening | It joins and resets the recheck. A SurfaceCanvas's scene children commit before its first qualifying host frame, so they join first |
| Component mounted after the opening | Status stays frozen; a development warning names it. Gating content on `opened` causes this, and it brings back the build-up |
| Inner Suspense fallback | A suspended subtree registers nothing. The fallback must render `OpeningPending`. R3F lifts an uncaught canvas suspension to the nearest DOM boundary (`Block`, `events-9ce18a08.esm.js:97-105`); if that boundary is above the Opening, the Opening is hidden and pauses |
| Lazy route above the Opening | The Opening renders inside the lazily loaded module. Placed above `App.tsx`'s `<Suspense fallback={null}>` (`App.tsx:375`), it would open empty before the chunk loads |
| Entry unmounts | It leaves. The Opening may open after the recheck |
| Opening unmounts | Entries detach; no callback fires |
| Activity hidden, or a committed subtree re-suspends | React runs layout-effect cleanups, so those entries leave. An Opening inside the hidden subtree pauses |
| Strict Mode | Entries are counted. The Opening keeps its state across the simulated remount and pauses during it. `onOpened` fires once per component instance |
| Source replacement before the opening | The lifetime changes, the set of counted presenters clears, and the entry waits again |
| Context loss before the opening, replacement scheduled | `context-lost` then `starting` in one task. Entries wait on `renderer`; Exclusive Surfaces show the page meanwhile ([WebGPU lifecycle rule L5](webgpu-migration-spec.md#renderer-lifecycle)) |
| Context loss before the opening, no replacement left | Exclusive: `shown` page with the loss reason. Resident and canvas: `unavailable` |
| Context loss after the opening | The report stays frozen. Live status, `onRendererLost`, and `onError` report it |
| Renderer startup error | Exclusive: `shown` page. Resident and canvas: `unavailable`. Needs the `componentDidCatch` write above; until then it waits on `renderer` |
| Ambiguous host | `error`, from the existing `reportError` (`SurfaceRoot.tsx:215-250`). It blocks until the tree changes |
| Zero-sized canvas | The renderer can stay `starting` ([WebGPU lifecycle rule L2](webgpu-migration-spec.md#renderer-lifecycle)), so the entry waits. Covering by collapsing the canvas container holds the Opening |
| App wait never done | The Opening stays open. `late` fires once; the development warning names it. It never becomes an error |
| App wait set to an Error | `error`. The app renders its fallback, which removes the wait |
| Error inside an app renderer | Invisible to the library. The app sets its wait to the Error |
| Several canvases | Each is its own entry. Each Surface reads its own host's renderer status |
| Callback timing | `onOpened` and `onLate` run from a page animation frame. Store notifications never run app code inside `gl.render` |
| `compileAsync` adopted later | Three fires `onAfterRender` while it skips a draw whose pipeline is not ready. `noteShown` would then need a pipeline-ready check. three 0.186.1 compiles synchronously today |

## Ownership

| Owner | Owns | Does not own |
|---|---|---|
| Core | `DomPaintReceipt.readWhileFontsLoading`, stamped by `htmlInCanvas.ts` and `rasterizedSource.ts`. Optionally, the opening check and the frame-time step as pure functions. The existing route law and readiness law, unchanged | Membership, subscriptions, React, timers |
| Binding | `Opening`, `OpeningPending`, `useOpeningWait`, `useOpeningStatus`, entry derivation, the store's set of counted presenters, layout-phase registration, anchor consumer reports, the host-frame seam, FrameSurface's first presented pass, the capture entry, the renamed `CaptureStatus`, `SurfaceRendererStatus` with the loss ordering and startup error, development warnings | Covering, fading, `inert`, fallback policy, iframe messaging, app assets, app renderers |
| App | Waits for fonts, assets, and its own renderers; its fallback branches; `late` policy; covering; announcing to a parent frame | Proving library presentation |

**Core changes.** One field is required. It belongs in core because core
mints paint receipts. The opening check and the frame-time step are optional.
Core keeps pure protocol laws with conformance tests under
`tests/conformance/transfer/`, and these two follow that pattern. The simpler
alternative keeps them in the binding module. The only loss is that the
conformance suite would not own them. Entry derivation stays in the binding,
because it reads `SurfaceRendererStatus`, a binding type that core cannot
import.

**No second status registry.** The Opening stores a counted set of entries.
Each entry is a read over its store, capture model, or host snapshot. Waits
hold the state the app passes in. The frozen report is copied once, at the
opening.

## Lab adoption

This is a separate lab decision. It narrows #57, #58, and #75 to app policy
over the new signal.

- **Every demo** renders its own `<Opening onOpened={announceOpened}>` inside
  its lazily loaded module. `announceOpened` sets `data-page-ready` and posts
  to the shell. Today only Light and Postcard render `DemoHost`.
- **`CaptureStatus` rename.** Three lab readers of `'ready'` change in the
  same commit: `Selection.tsx:396`, `Veil.tsx:436`, and Marble Hand's page
  capture (`marbleHandPageCapture.tsx:32`, `:169`, `:182`), which feeds its
  reflection status display (`MarbleHand.tsx:568`, `:573`).
- **Light.** A lamp wait registers at mount. Its state comes from the existing
  `checkOpening` predicates. Its bulb condition becomes "the bulb drew"
  instead of "its renderer exists" (`LightLamp.tsx:340-341`). The lamp
  backdrop is a kernel source, so it stays inside that wait. `late` at 4 s of
  frame time selects native. Native unmounts the lamp, its wait leaves, and
  the Opening opens after the native commit and the recheck. A fonts wait
  replaces the `fonts` phase as the reveal condition. Graphics still wait for
  fonts before building glyph masks (#57).
- **Postcard.** Its `Surface.Root` at rest is `shown` page. The lamp wait is
  Light's.
- **Knobs and `DegradedKnobs`.** One Opening above the support branch. The
  canvas and SceneSurface entries cover the empty slab and the late dials.
  `DegradedKnobs` needs no code.
- **Marble Hand.** Waits for the background's first draw and for the hand's
  first draw. `OpeningPending` is the hand's Suspense fallback. The page
  capture is an entry. Wrap it in `<Opening independent>` if reflections
  should not delay the reveal.
- **Genie.** A film wait, set from the film controller through a `useState`
  setter, which stays stable under Strict Mode. FrameSurface flights mount
  after the opening and do not join it.
- **Flight.** A fonts wait that includes Courier Prime 700, which
  `apps/lab/index.html:47-51` does not preload.
- **Page shell.** The shell reveals on the demo's message instead of the
  iframe's `load` event (#75).

## Acceptance

**Conformance and unit tests.**

| Layer | Location | Claims |
|---|---|---|
| paint | `tests/conformance/paint/` | A read during a font load stamps true; a load starting inside a synchronous read stamps true; a carried re-report keeps the original value |
| transfer, if the opening check is in core | `tests/conformance/transfer/` | An empty Opening opens on the second check; a join, leave, or change resets the recheck; `error` blocks; the report freezes; frame time clamps each gap |
| binding | Beside each module | The set of counted presenters clears on source replacement and renderer loss, and the change reaches subscribers through `publish()`; the `now` route rejects a stale runtime; registration happens in the layout phase; Strict Mode counts once; loss publishes `starting` in the same task when a replacement is scheduled; no callback runs inside `gl.render` |

**Browser gate.** A new `instruments/opening/` with `gate:opening`. Runs are
headless and serial. `STRICT_CAPABILITY=1` claims the html-in-canvas path.
Forced snapDOM and no capture engine run separately. A zero-exit skip is not a
pass. The runner checks that it discovered every case.

At `onOpened`, the fixture sets the frameloop to `never` and stops captures.
The screenshot then shows the frame the opening reported. This avoids the
screencast clock, which does not align with the page clock. One second later
the fixture resumes and captures a settled reference under reduced motion.
The assertion is a per-tile maximum difference, not a whole-frame mean, so a
missing dial or numeral fails.

| Case | Assertion | Deliberate fault that must fail it |
|---|---|---|
| Every relationship on each engine | No tile changes between the opening frame and the settled reference | **Early signal:** a presenter counted on a warm-up draw |
| Knobs on both engines | Face and dial tiles present at the opening | Anchored-children check disabled |
| A SceneSurface that never presents | The Opening stays waiting; the warning names the entry; `late` fires | **Surface that never presents:** the entry treated as shown on registration |
| Marble Hand reflections | The capture entry blocks until `captured` | **Source-only capture left out:** capture registration removed |
| Background-tab load, foregrounded after 6 s | The page asserts it was hidden and ran no frames, otherwise the case fails. No `late` while hidden; Light reaches the lamp, not native | **Hidden-tab load:** a wall-clock `late` timer |
| An app wait that stays false | No opening; `late` fires once; no error status | **App wait never released:** a wait that counts as done on mount |
| Delayed font, both engines | Glyph tiles match the post-font reference | `readWhileFontsLoading` forced false |
| Suspense fallback inside the Opening | No opening while suspended | `OpeningPending` omitted |
| Context loss before the opening, then twice within 10 s | The replacement path shows the scene; the second loss settles on the page | `context-lost` read as final on the first loss |
| Demand frameloop | Anchored children appearing get a frame and settle | Host-frame seam without `invalidate()` |

**Measurements before building.** Each result goes to
[platform.md](platform.md):

- whether html-in-canvas `onpaint` runs in a hidden tab;
- whether a same-origin iframe that is covered or scaled keeps running
  animation frames;
- whether R3F runs after-effects on a `demand` frame;
- when React 19 commits a `useSyncExternalStore` hydration flip relative to
  the first animation frame;
- whether a source repaints after a failed font load, since it listens only
  to `loadingdone`.

**Decision entry.** #76 records Shown and its evidence for each relationship,
the font check, the recheck as policy, the frame-time clamp, out-of-view
presenters staying owed, and context-loss ordering. `CONTEXT.md` gains Shown.
The system model gains one row in "Keep the observable facts separate".

Adding `gate:opening` to CI changes `.github/workflows/ci.yml` and needs Pete's
separate approval.

## Rejected alternatives

- **Suspense.** A fallback unmounts the content that has to stay mounted,
  laid out, and painted to prepare.
- **A library-owned cover or fade.** Covering is app policy, and it touches
  authoring rules: no opacity or transform on a content root.
- **Library iframe messaging.** The shell and its origin checks are the app's.
- **A name with "ready".** Readiness, `CaptureStatus`, and the proposed
  renderer status already use it for three different facts.
- **A per-canvas "complete" signal.** It misses `DegradedKnobs` and every
  renderer an app creates itself.
- **A latched `shown` field on `SurfaceStatus` or a per-Surface `onShown`.**
  Beside the live `presentation`, it reads as live state, and no requirement
  needs it.
- **A module-scope handle or a document-global Opening.** It completes once
  per document, so later client-side routes report nothing.
- **"Out of view is not owed", a production frustum test, or forcing
  `frustumCulled` off.** The first reveals before a fly-in. The second adds
  per-frame work to make a guess. The third fights the reconciler.
- **A document-wide font gate.** It would block an app's fallback during any
  font load anywhere on the page.
- **`texture.onUpdate` as capture evidence.** Three fires it during warm-ups
  and offscreen bakes. Consumers that draw only after `captured` would
  deadlock.
- **A wall-clock timeout, or a timeout that becomes an error.** It downgrades
  background loads and breaks the plan's rule.

## Open questions

1. **Names.** `Opening`, `onOpened`, and the term Shown. "Opening" matches
   #57 and the lab's existing modules, which adoption replaces. The
   alternative is "Loading", which reads worse next to the window's `load`.
2. **Out-of-view presenters.** They are owed by default, with
   `<Opening independent>` as the opt-out. Should it be the reverse?
3. **Captures by default.** A capture entry settles at `captured`, which proves
   a paint, not the consumer's draw. Should captures join only when the app
   asks?