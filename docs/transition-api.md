# Capture transitions: the public call

**Status: built, 2026-11-22.** Shape A shipped. `useCaptureTransition` and
`CaptureTransition` are in `@petepetrash/munari`. The provisional effect hook
`useCaptureTransitionEffect` is in `@petepetrash/munari/advanced`. Decision #77
states the rule. Postcard and Distortion Wave use the package hooks.

## The problem

An app wants to swap one view of its HTML for another, such as a postcard with one
more stamp or a page in the light theme, with a shader effect drawn between the two
states. Before this change each lab demo wired a request queue, a before-and-after capture,
an upload check and a screen-draw check through lab-local helpers that no outside
project could import.

A *capture transition* is one such swap. The page keeps the live content the whole
time. The canvas draws a *cover*, which is a capture of a copy of the outgoing
state, over the target element. The app's update runs only after the cover has
reached the screen, so the user never sees the new state before the effect starts.
When the effect ends, the canvas stops drawing and the live page shows.

## Three shapes

Each sample shows the page-side code for two demos. Postcard runs one stamp wipe on
one card. Distortion Wave runs many overlapping waves, each with per-click options.

### A. A transition handle passed to an effect

The page creates a handle, the same way it creates a Surface or capture handle.
Triggers call `start`, and an effect component inside the canvas receives the handle.

```tsx
// Postcard
const stamps = useCaptureTransition()
<SurfaceCanvas><PostcardStamp transition={stamps} /></SurfaceCanvas>
onStamp={card => stamps.start(card, () => setStamps(n => n + 1))}
onName={value => { stamps.finish(); setName(value) }}

// Distortion Wave
const waves = useCaptureTransition<WaveOptions>()
<SurfaceCanvas><DistortionWaveEffect transition={waves} /></SurfaceCanvas>
const wave: WaveAction = (event, update) =>
  waves.start(waveTarget(event), update, waveOptions(event, { duration, palette }))
```

### B. Named effects behind a provider

A provider wraps the page and the canvas. Effects register under a name, and
triggers ask for an effect by that name.

```tsx
<CaptureTransitions>
  <SurfaceCanvas><DistortionWaveEffect name="wave" /></SurfaceCanvas>
  <WaveExamples />
</CaptureTransitions>

const start = useStartCaptureTransition()
start('wave', waveTarget(event), update, waveOptions(event, { duration, palette }))
start('stamp', card, () => setStamps(n => n + 1))
```

### C. A component that animates its own changes

A component wraps the target and runs the effect whenever a value changes. App state
updates as usual and never waits.

```tsx
<CaptureSwap transition={stamps} value={stampCount}>
  <PostcardCard stamps={stampCount} onStamp={() => setStamps(n => n + 1)} />
</CaptureSwap>
```

To hide the committed state, `CaptureSwap` would clone the old DOM before React
mutates it, in a class component's `getSnapshotBeforeUpdate`. It would lay the clone
over the target before the browser paints, then move the cover from that page clone
to the canvas.

## The chosen shape: A

`@petepetrash/munari` exports one hook and one type:

```ts
function useCaptureTransition<Options = void>(): CaptureTransition<Options>

interface CaptureTransition<Options> {
  /** Runs `update` once, behind a capture of `target` when an effect can draw it. */
  start(target: HTMLElement | null, update: () => void, ...options: Options extends void ? [] : [Options]): void
  /** Applies every waiting update in order and ends running effects. */
  finish(): void
}
```

The reasons for each choice:

- A handle matches `useSurfaceHandle` and `useCaptureHandle`. The owner creates it
  in the page tree and passes it into the scene, so an author learns one pattern.
- The handle exists before its canvas mounts. A `start` call with no effect connected
  applies the update at once, which is the right result on an unsupported browser.
- Each effect takes its own handle. Postcard's stamp shares a canvas with its
  Surface, and a canvas can host several transitions without names colliding.
- `start(target, update)` follows `document.startViewTransition(update)`, which web
  developers know. The update is a plain synchronous callback, so the app writes the
  same state change it would write with no effect.
- `Options` is declared by the effect and checked at every `start` call. Postcard's
  wipe takes none, so its call has two arguments.
- `finish()` follows `Animation.finish()`: jump to the end state now. Postcard calls
  it before typing and before a lift.
- `start` returns nothing. No demo needs a promise yet, and the kernel grows only
  for a consumer, per decisions.md #7.
- Fallback needs no app code. Reduced motion, a missing canvas, a disconnected target
  and a failed capture all apply the update. Postcard still applies a plain update
  while its card is in the scene, which is its own policy.
- Call `start` from an event handler or an effect, never during render. The update
  must be synchronous. An `async` callback or a React `startTransition` inside it
  does not commit before the after-capture.

`start` returning nothing has a cost. Work that needs the committed DOM, such as
moving focus, has no hook. `startViewTransition` returns `updateCallbackDone` and
`finished` promises for this. Neither demo nor the standalone consumer needs one yet.

Shape B was rejected because string names lose the `Options` type and turn a typo
or an unmounted effect into a silent immediate update. It also needs a provider
around both trees. Its one gain, triggers that need no prop, is available in shape A
by putting the handle in the app's own context.

Shape C was rejected for this step, though it is the most declarative. Its page-side
cover is a new handoff with no browser evidence. The clone would sit in page layout
over live input, and a translucent pixel shown by both the clone and the canvas
would darken (#27). Distortion Wave's per-click origin also needs an imperative call.
Shape C becomes worth measuring if deferred updates cause problems in apps.

A fourth shape keeps the handle and the effect hook in `/advanced` only, and ships
the stamp wipe and the wave as copyable `registry/` recipes. It keeps authoring off
the root entry and gives outside projects a working effect. It was not chosen because
the root entry admits a name a lab scene uses (#6), and both lab scenes use `start`.
The recipes are worth adding later either way. `registry/` is outside this step.

## Failure cases

Each row states what the package does. The queue is
`packages/react/src/primitives/captureTransition.ts` and the effect hook is
`captureTransitionEffect.ts` beside it.

| Case | What happens |
|---|---|
| Capture fails or is unsupported | The capture status turns `error` or `unsupported`. The run is cancelled: its update applies once, unless it already has, and the effect stops (`read` and `cancel`). An error while the cover waits for its draw is ignored until the timer fires. |
| No matching frame or cover draw arrives | Each capture request has a 1 s bound. The outgoing request's bound also covers the wait for the cover draw. The incoming capture gets a new bound (`request`). |
| The engine is snapDOM | Nothing branches on the engine (#60). The second upload for `drawTrailsPaint` applies only to HTML-in-canvas. The delay between a click and the update on snapDOM is unmeasured. |
| Requests overlap | Requests queue in order. Each effect captures one run at a time, and later requests wait until the effect accepts them. Updates apply in request order, including requests made during `finish()` and during another run's capture. |
| A request waits in the queue | Distortion Wave holds a request while three page waves run or no texture slot is free, and a page wave can last 3.6 s. Postcard holds the queue for each 320 ms wipe. When the first waiting request is older than 1 s, the queue calls `finish()` (#77). This also covers a canvas that stops rendering. |
| An update throws | The error is reported asynchronously. That run's effect stops, changes the callback already made stay, and later updates still run (8ba5c01). |
| The effect unmounts mid-run | The run's update applies without `flushSync`, then waiting updates apply in order. A lost renderer remounts the canvas (#73), so it takes this path. The effect connects once per mount, and a change in its callbacks does not reconnect it. |
| The target leaves the document | A request whose target is outside the document applies at once. During a capture the run is cancelled and its update applies if it has not. After the captures, the effect decides: Postcard calls `finish()`, which also flushes every waiting update, and the wave effect ends only that run. The wave also ends a run whose target changed size. |
| Reduced motion | `start` checks `prefers-reduced-motion`. When it matches, `start` finishes running effects and applies every waiting update, then this one. The effect hook also reads the preference each frame, and calls `finish()` when it turns on or while work is pending. Postcard also unmounts its effect under its own reduced-motion setting. An app with its own setting calls `finish()`. |
| Two effects connect to one handle | `connect` throws. One handle has one effect. |
| The update changes nothing | The effect still runs between two identical captures. |

One hazard stays with the app. An update waits until the cover is on screen, so a
state change the app makes directly in that window lands first. Postcard calls
`finish()` before typing for this reason. Functional updates such as
`n => n + 1` stay correct either way.

The cover hides the live update only where the outgoing capture is opaque. The wave
snapshot fills its box with the nearest opaque ancestor background, and the postcard
card paints an opaque paper background. A translucent target would show the live
update through its cover.

## The effect side is provisional

`@petepetrash/munari/advanced` exports `useCaptureTransitionEffect`, documented as
provisional: its shape may change in any release. An effect component inside the
canvas calls it with the handle and two callbacks.

```tsx
const { cover } = useCaptureTransitionEffect(transition, {
  accept: ({ target, options }) => {
    if (running.current) return 'wait'   // or 'skip' to apply the update with no effect
    return {
      before: snapshot(target),          // { element, size }, a detached copy
      after: () => snapshot(target),     // optional incoming capture; null ends the run
      copy: (frame, side) => copyInto(myTarget, frame.texture, side),
      ready: () => { startedAt.current = performance.now() },
      abort: () => { running.current = null },
    }
  },
  finish: () => { running.current = null },
})
return <mesh {...cover} material={wipe} />
```

The hook calls `accept` in a frame for the first waiting request while no capture
is pending. A returned run starts the outgoing capture. The hook owns the capture
phases and their 1 s bounds, frame matching by size, the upload check, and the
screen-draw check on the mesh that spreads `cover`. The effect owns admission,
snapshots, texture copies, drawing, timing and its own resources. An effect must
draw the run with the `before` copy in the first frame after `copy` returns,
because that draw releases the update. The hook keeps a `demand` frameloop rendering
through every capture phase. Distortion Wave draws every run from one instanced mesh,
so it spreads `cover` on that mesh.

Effects copy the borrowed frame themselves. The package does not copy each capture
into a texture it owns. Distortion Wave binds a fixed set of render targets into its
material and tiles the outgoing and incoming captures into one target per run.
Postcard tiles both captures into one atlas. A package-owned texture per capture would
add a GPU copy and a texture lifetime the package must manage, and both effects would
still copy into their own targets. The lab's copy pass lives in
`apps/lab/src/lib/captureCopy.ts`.

The package has no default snapshot. Each effect builds its own, because the two
demos need different CSS context. The wave snapshot clones the target's ancestors so
its selectors and inherited styles still match, and fills the box with the nearest
opaque background. The stamp snapshot wraps the card in its theme class and copies
the computed styles of its buttons and inputs. A generic default would match neither, and the kernel grows only for
a consumer (#7).

These stay internal: the request queue (`peek`, `take`, `connect`), the capture
phase machine, and the frame and upload checks. The upload check reads the capture
source's current paint through `CaptureConnection`, an internal handle, so the lab's
`setCaptureEngine` wrapper is not needed for transitions.

## Existing decisions

- #6 and #7: `useCaptureTransition` enters the root entry because two lab scenes use
  it. `packages/react/src/index.test.ts` gains the names.
- #32: a law with one consumer stays with it. The queue and capture logic now serve
  two demos and name neither one's modes, so they can move. Wave-only admission, such
  as its three-page-wave limit, stays in the wave effect.
- #24 and #25: the update waits for a cover draw to the default framebuffer with color
  writes on. The lab helpers read only the target and color writes in
  `onAfterRender`, which #25 says can run for draws that never reached the screen.
  The package adds the draw-count check the lab's `observeSurfaceDraw` uses.
- #27: the opacity rule above applies the same constraint to the cover.
- #43: the export, its types, examples, docs, the tracked skill, the README and the
  CHANGELOG changed together.
- #65 and #68: a run waits for evidence, with a bound for a source that stops
  answering. Its 1 s bound stays separate from the 500 ms lift bound.

Decision #77 records the rule. A capture transition applies its update once, in
request order. It waits for its cover to reach the screen, and every wait has a bound:
1 s per capture request, and 1 s for a request waiting in the queue. It changes no
other decision. The glossary in `CONTEXT.md` gains *capture transition* and *cover*. The name avoids "Surface" because no Surface takes part,
and `SurfaceStatus.isTransitioning` keeps its meaning of a handoff in progress.
