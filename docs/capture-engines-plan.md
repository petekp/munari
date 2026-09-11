# Capture engines: snapDOM alongside HTML-in-canvas

**BUILT, 2026-09-10.** [Decision #60](decisions.md#60) is the current record;
read it rather than this file for what shipped. This page is kept only for the
reasoning and the alternatives considered, and it is not maintained against the
code. Three things landed differently from the sketch below: `captureEngine()`
is non-nullable, hiding the host became `setHostPainted` on the source rather
than a field in the ride style, and `paint: 'always'` was deleted rather than
kept. Three of the open questions at the end are now answered:
`paint: 'always'` (deleted), the page hold under snapDOM (the host shows
whatever it holds, no engine branch), and compositor-only animation
([platform #22](platform.md)). The div-host hit test is still unmeasured,
which is exactly why `snapdomCaptureEngine` claims `native: false` and keeps
every presenter on the relay.

Read the [system model](system-model.md) and [decision #12 and #13](decisions.md#12)
before changing the paint layer.

## Decision being recorded

Munari will support two capture engines.

- **HTML-in-canvas** draws the live element. Chrome 151 needs
  `--enable-features=CanvasDrawElement`. It is the forward-looking engine:
  lower latency, browser-owned invalidation, native caret and selection paint,
  and a parked canvas the browser hit-tests through a transform.
- **snapDOM** copies the subtree, inlines styles, fonts and images, and
  rasterizes the copy through an SVG image. It runs in current Chrome,
  Firefox and Safari.

Neither engine is a superset of the other. The native path forbids
`mask-image` in the subtree and opacity or transform on the content root
([authoring](authoring.md)). Under snapDOM, Munari's change observer has no
signal for CSSOM edits, canvas redraws, video frames, font loads or theme
flips, so nothing asks for a capture; snapDOM captures canvas and video fresh
once asked and needs its `invalidate` option after a CSSOM edit. snapDOM
cannot paint a caret, and cross-origin iframes become placeholders (snapDOM
3.0.0-beta.0 README, Limitations).

Page-to-scene handoff is the same on both engines. It needs
`Element.moveBefore`, which Safari has not shipped (caniuse, September 2026).
snapDOM reaches Safari for scene-only surfaces, not for handoffs.

## Evidence

A copy of the checkout ran Knobs and Gallery under both engines behind a
`?capture=` switch. The texture path above `DomTextureSource` consumed either
source unchanged: uploads, the LOD ladder, materials, anchors and the pointer
relay. Measured 2026-09-09/10 in Chrome 151, headed, dpr 2:

| Measure | HTML-in-canvas | snapDOM, stock bundle | snapDOM, guards relaxed |
|---|---:|---:|---:|
| Input to texture, Knobs | 12 ms | 37 ms | not remeasured |
| Frames over 16.7 ms during a 3 s panel carry | 0 of 288 | 16 of 288 | 1 of 328 |
| Source fidelity vs the DOM, RGB MAE at dpr 1 | 0.052 | 0.052 | 0.052 |

The stock column is the shipping number. The relaxed column required editing
three guards in a beta bundle; one of them rejects the incremental path for
any document holding a `+`, `~` or `:has()` selector, which shadcn's `.peer`
utilities supply. See the rig's README for the guard list.

What the rig did not exercise, and the review found by reading the binding:

- A page-held `Surface.HTML` with `inScene` true. Gallery's timing is near
  zero, so the page hold never lasted. Under the rig's source that state
  shows a bitmap while the live DOM sits unreachable at the viewport origin.
- `pointerRoute="auto"`. Knobs uses the relay.
- `paint: 'always'`, which Knobs sets while resizing. On the rig's source it
  queues a capture every frame.

The spike reports are [snapDOM on Knobs](spikes/2026-09-08-snapdom-knobs.md),
[parity assessment](spikes/2026-09-08-snapdom-parity-assessment.md), and the
two direct-CSS reports, which record a third path that is parked.

## The model

A capture engine turns a live DOM subtree into pixels in a canvas, and parks
the subtree somewhere the browser lays it out. Those two things vary. Holds,
handoffs, provenance, LOD, materials, anchors and the pointer relay never
learn which engine ran.

Core already takes this stance for caller-owned canvases: the FrameSource
contract says custom producers implement it directly, core owns identity and
generations, the binding owns GPU receipts. Engines follow the same split.

The texture half of the source contract is already asynchronous. Native paint
trails the DOM by a frame. The source runtime calls `repaint()` as a request
and uploads on `paintCount()` deltas. A longer delay fits that model.

The parking half is not engine-neutral today. The binding docks, rides, clips
and claims the source **canvas** because native parks the element inside it.
Three sites depend on that: the page warm rig in `Surface.tsx`, the scene
native route in `surfaceNativeRoute.ts`, and the visibility swap that shows a
canvas child as fallback content. An engine that parks the element in a div
needs the binding to address the parked container, not the pixel canvas.

## The four pieces

Each piece has one owner, matching the ownership table in the system model.

**1. `host` on `DomTextureSource`, in core.** The element the engine parks
the content in. Native returns its canvas, so nothing changes for it. The
binding docks, rides, clips and claims by `host`. Pointer ownership and
canvas space stay keyed by the canvas; only the node that wears the pose
changes. This lands first because its absence fails silently.

**2. `CaptureEngine` and one setter, in core.** An engine has a name,
`available()` that never throws and answers `false` in Node, `native`
saying whether its host can be hit-tested through a transform and paints
nothing of its own, and `createSource()` with the signature of
`createDomTextureSource`. The existing factory becomes the HTML-in-canvas
engine with its behavior unchanged. `setCaptureEngine()` installs one engine;
there is no registry, no preference list, and no subscription.
`createDomTextureSource` asks the installed engine and refuses before
building anything, as decision #12 requires. The refusal names both fixes:
enable the flag, or install snapDOM and enable it.

**3. One shared source helper and an asynchronous source, in core.** About
120 lines of the native source are engine-independent: adoption, the paint
ledger, receipts, subscribe, store recut with carry-forward, and the size and
scale API. They move into one helper both sources use. The asynchronous
source is built from a rasterizer, a function from a laid-out element and a
density to a promise of pixels. It owns change detection (MutationObserver
plus input, focus, scroll, animation and font events), coalescing with one
capture in flight, and a fixed host at the viewport origin. Zero
dependencies. Its conformance suite runs in vitest with a fake rasterizer.

**4. A third published entry, `@petepetrash/munari/snapdom`.** The snapDOM
rasterizer and its engine object, about forty lines. `@zumer/snapdom` becomes
an optional peer dependency. Consumers who never import the entry never pay
for it. Four packaging edits: the entry in `tsdown.config.ts` and its
`neverBundle` list, `exports` plus `peerDependenciesMeta` in
`stage-manifest.mjs` (the script copies `peerDependencies` only today), the
allow-list in `tests/boundary.test.ts`, and the export pin in `index.test.ts`.

## Proposed API

Sketches, not implemented behavior.

```ts
// Once, at the app entry. Needs @zumer/snapdom installed.
import { enableSnapdomCapture } from '@petepetrash/munari/snapdom'
enableSnapdomCapture()                  // HTML-in-canvas when present, snapDOM otherwise
enableSnapdomCapture({ always: true })  // snapDOM even in a flagged Chrome; the lab's parity gates
```

```ts
// /advanced
interface CaptureEngine {
  readonly name: string            // 'html-in-canvas' | 'snapdom'
  readonly native: boolean         // the host hit-tests through a transform and paints nothing
  available(): boolean             // never throws; false in Node
  createSource(content, width, height, options): DomTextureSource
}
setCaptureEngine(engine: CaptureEngine | null): void   // null restores HTML-in-canvas
captureEngine(): CaptureEngine | null                  // the engine the next source would use, or null
```

- `supportsSurfaces()` and `useSurfaceSupport()` answer "can the installed
  engine make a source here." `detectHtmlInCanvas()` stays the raw platform
  probe and stops being the question the binding asks.
- A store resolves `supported` when first observed, not at creation. That is
  what lets a module-scope `createSurface()` and an SSR render coexist with
  a setter called at the app entry. A capability cannot change under a
  mounted page, so `useSurfaceSupport()` keeps its single settle.
  `setCaptureEngine()` after any source exists warns once in development.
- `useSurfaceStatus()` gains one field, `engine`, so a demo can badge it and
  documentation can attach limits to a name.
- The native pointer route reads `capable` from `captureEngine().native`,
  never from `supported`. Under snapDOM the route law answers `relay`.
- `DomTextureSource` gains `host`. `DomPaintReceipt` gains
  `changesDuringPaint`, the number of change signals that landed while the
  raster was being made; native reports 0.
- `refresh()` on element captures and `repaint()` on sources stay the escape
  hatch for changes an observer cannot see. `repaint()` forces one more
  paint. On an asynchronous engine it coalesces with the capture in flight
  and never queues more than one.

## Why these choices

**A setter, not a registry and not a React prop.** A prop on `SurfaceCanvas`
reaches a store the way renderer availability does, but `useElementCapture`
and `CaptureContent` have no host and would never see it. A registry with
preference order and store subscriptions needs new plumbing in the store, in
`useSurfaceSupport`, and in the runtime creation effect, plus tests for
registration order. Two engines is a list of two. One setter with lazy
resolution needs none of that, and the fallback rule lives in
`enableSnapdomCapture()`.

**`host`, not a canvas-shaped binding.** The binding's rides are the only
thing above the seam that knows how native parks. Naming the parked node on
the source removes that knowledge from six call sites and makes the native
ride an engine property the route law can read.

**Shared helper, not a second copy.** The rig duplicated recut and
carry-forward, receipts and the ledger. A helper keeps the paint laws pinned
once, and the asynchronous source stays about a hundred lines of what is
actually different: observation, coalescing, staleness, and a div host.
snapDOM sits at the edge, where a beta dependency belongs.

**The counter law, restated.** Native advances `paintCount()` on every
compositor paint, including a root transform restyle with identical pixels
and caret blink. The law both engines can keep is: a source requests no paint
without a change signal, and every completed paint advances the counter. The
idle-zero gate depends on exactly that. What differs is the cost of a change
and which changes signal: a compositor-only animation on a descendant never
paints natively and captures continuously under snapDOM.

**Parking geometry is two laws.** The relay's law is shared and already
pinned by `tests/conformance/mapping/parkingCoincidence.test.ts`: viewport
origin, exact CSS size, in-document and on-screen, pointer-events cascade
rooted at the element. The native ride's law is separate: the host hit-tests
its children through its own transform, clips hits to its own box, and
paints nothing of its own. A canvas gives that by platform #18 and #21. A div
at `opacity: 0` gives the first and third; the second is unmeasured. An
engine claims the law with `native: true`.

**Support stays two facts, and one of them already exists.** Status
`supported` already folds in `reason`, and `Surface.HTML` already sets the
`moveBefore` reason. Safari can capture and cannot hand off, and the status
says so today. What is new is the engine name.

**Engine choice is app-level.** No per-Surface engine prop. Two engines in
one document doubles the parking and hit-testing variants, and the lab's
override belongs at the app entry.

## Laws to pin per engine

The paint-layer conformance suite runs over every engine, against a fake
rasterizer for the asynchronous one.

1. A refused source owns no DOM (decision #12).
2. Adoption refuses a parented node and releases it on dispose (decision #13).
3. A source requests no paint without a change signal; every completed paint
   advances `paintCount()`. The idle-zero gate depends on this.
4. `repaint()` forces one more paint and coalesces with a paint in flight.
5. A receipt names the box its raster holds and, on an asynchronous engine,
   the number of change signals that landed while it was made.
6. Store sizing follows `storeForBox` carry-forward across resize and
   resettle, through the shared helper.
7. The relay's parking law, for both engines. The native ride's law, for any
   engine that claims `native: true`.
8. Output is premultiplied (decision #5).
9. A failed capture keeps the last receipt and texture. `onError` fires once
   per distinct message until a capture succeeds.

Browser gates: the Knobs key-to-draw, idle-zero and lifting-pointer
instruments run once per engine. `native-pointer` runs under HTML-in-canvas
and skips loudly under snapDOM. The rig's scripts are the seed. Adding them
to CI is a separate approval.

## Failure cases considered

- Both engines available in a flagged Chrome: `enableSnapdomCapture()` keeps
  HTML-in-canvas; `{ always: true }` forces snapDOM for the parity gates.
- snapDOM installed, a capture throws on a CORS image: the source keeps the
  last texture, `onError` fires once, `paintCount` does not advance.
- `enableSnapdomCapture()` called after a Surface mounted: a development
  warning; the mounted Surface keeps its engine.
- Server render: `useSurfaceSupport()` keeps its `false` server snapshot.
- A page-held `Surface.HTML` under snapDOM: the warm rig rides the host, so
  the live DOM is hit-testable at the page slot. Whether the slot shows the
  live DOM or the bitmap is an open question below.
- `pointerRoute="auto"` under snapDOM: the route law answers `relay` because
  the engine is not native.
- Ancestor context: under snapDOM the element stays in the same document, so
  theme classes on `<html>` and `:root` custom properties are live. The
  earlier direct-CSS spike lost these because it cloned into a separate
  document; this design does not.

## Non-goals

- No `if (engine === ...)` above the source. The binding reads `host` and
  `native`, both engine properties, and nothing else.
- No use of snapDOM's own experimental `engine: 'html-in-canvas'`. It paints
  a clone and needs a build flag the published bundle does not carry.
- No vendored or patched snapDOM. The incremental-path guards are an upstream
  fix. The upstream issue is filed before step 6 below, and this document and
  the README quote stock numbers until it lands.
- No capture optimization in this pass. The measured ceiling is recorded as a
  platform fact when the entry ships: 5 to 7 ms of preparation per capture
  even when incremental, and about 11 ms of main-thread SVG raster at dpr 2
  on a fresh decode.

## Sequencing

Each step lands on its own. The existing paint suite stays green and
unchanged through steps 1 to 4.

1. Core and binding: `host` on `DomTextureSource`; dock, ride, clip and claim
   by host; `capable` from the engine. Pinned by a binding test whose stub
   source has `host !== canvas`.
2. Core: `CaptureEngine`, `setCaptureEngine`, lazy `supported`. The native
   engine wraps the existing factory. `supportsSurfaces()`, the four binding
   call sites and both capture hooks read the engine.
3. Core: the shared source helper, with the native source re-expressed on it.
4. Core: the asynchronous source on the helper, with its fake-rasterizer
   suite and the laws above.
5. Runtime: settle `paint: 'always'`. Run `gate:knobs-resize` with `'auto'`
   first; native self-paints on layout change (platform #2), so the mode may
   be deletable. If it stays, it means "upload every frame" and calls
   `repaint()` only on a synchronous engine.
6. React: the `./snapdom` entry and the four packaging edits.
7. Lab and instruments: `?capture=` through `enableSnapdomCapture()`; the
   per-engine gates above.
8. Docs: README support section, authoring rules tagged by engine name with
   one per-engine limits table, a decision entry, platform facts for snapDOM.

## Open questions

Only a browser or Pete can settle these. Each names its smallest check.

- Does a div host at `opacity: 0` wearing a `matrix3d` hit-test its children
  and clip to its box like platform #21? Rerun the `cover-clip` spike rig
  with a div in place of the canvas: one perspective pose, one escaping child.
- On a page hold under snapDOM, show the live DOM or the bitmap? The live DOM
  gives a real caret and no capture lag; the bitmap matches native behavior.
- Is `paint: 'always'` still needed for Knobs resize under native? Step 5.
- Does `mask-image` render under snapDOM? One rig capture of a shadcn
  scroll-fade panel against a DOM screenshot.
- Does a compositor-only descendant animation capture continuously under
  snapDOM? One child with an opacity keyframe, `paintStats()` deltas over
  3 s. The rig's source predicts yes.
- Will stock snapDOM serve Tailwind and shadcn pages incrementally? Needs the
  upstream issue and a reply. Pete decides whether the entry ships first.
- Real Safari. WebKit automation showed 2.9 MAE on the direct-CSS path and no
  `moveBefore`; snapDOM on shipping Safari is unmeasured. One run of the
  rig's Knobs check in Safari Technology Preview.
- Whether the status field should carry more than the engine name. Latency
  and staleness stay in receipts and instruments until a consumer proves a
  need.
