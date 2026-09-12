# Authoring for a Surface

A Surface draws a live DOM subtree. What you write is ordinary
markup — real layout, real focus, real text selection — and almost all
of it needs no special knowledge. This page is the short list of places
where the second renderer is visible, and what each one costs if you
ignore it.

Every rule here is a *measured* platform property, not a style
preference. `docs/platform.md` holds the measurements; this page holds
what to do about them.

## Which engine, and what it adds

Munari has two capture engines. Most of this page applies to both — a
content root still sizes itself, twins still carry hover and active state,
the mutation economy is still the mutation economy, and the rules below on
the content root's own opacity and transform hold either way. What differs:

| | HTML-in-canvas | snapDOM |
|---|---|---|
| Decorative motion inside the subtree | captured live | **frozen** at the first capture, unless it is a transition ([platform #22](platform.md)) |
| Caret and text selection | painted by the browser | not painted — the texture shows neither |
| `pointerRoute="auto"` | native: the browser hit-tests the real element through the pose | relay: pointer state arrives as twins |
| `mask-image` in the subtree ([below](#no-mask-image-anywhere-in-a-drawn-subtree)) | blacks out the capture | not measured — write as if the same rule applies |
| Block placement | exact | within ~2px on a rare subtree ([platform #26](platform.md)) |
| Pixel match with the same DOM | byte-identical | close, not exact: laid-out lengths snap to whole CSS pixels, so a fractional border loses weight and a rule on a half pixel lands one off ([platform #28](platform.md)) |
| Sharpness while a Surface moves | re-captured every frame | the last capture, resampled, until the box settles ([platform #27](platform.md)) |
| Handing off where `Element.moveBefore` is missing (Safari) | n/a — Chrome has it | works; a running CSS animation restarts at the crossing ([platform #29](platform.md)) |

Everything else matches. A form field's `::after` and `::placeholder` are
absent from a snapDOM clone upstream ([platform #24](platform.md)) and Munari
puts them back, so an `appearance: none` checkbox keeps its tick and a
placeholder keeps its `text-transform` and tracking. The one rule that shim
cannot follow: **a field's `::before`/`::after` has to be absolutely
positioned.** A pseudo-element cannot be measured, so its box is only
recoverable from `left`/`top` against the field's padding box; a statically
positioned one is skipped and the library says so once in the console.

The frozen-motion row is the one that will surprise you. An infinite keyframe
animation inside a snapDOM Surface signals `animationstart` once and nothing
after, so the capture holds one frame of it forever. A CSS *transition*
signals at both ends and lands its end state, which is why the ease-flat
recipe below works on both engines. Anything else that has to keep moving
needs `repaint()` on your own schedule, and each one costs a full raster.

The pixel-match row is the one to weigh before choosing snapDOM for content
that sits beside its own DOM, and it is the one row you can author around.

snapDOM gets your DOM into a canvas by serializing it to an SVG and loading
that SVG as an image — the only route a library has. Chrome lays out an SVG
image in an isolated document pinned to dpr 1, so at dpr 2 every half pixel
the page resolves is quantized away before anything is drawn. Raising the
output resolution does not help: the snap has already happened. Glyph runs
still land on the same texels and text is the right size and shape; what
moves is anything whose own box falls on a half pixel. **A `1.5px` border
draws at `1px`** — a third of its weight gone. Beside the same DOM that reads
as a stroke thinning as a Surface crosses.

Only **laid-out** lengths are affected, and the split is worth knowing,
because most fractional CSS is fine. Measured at dpr 2 through the image path:

| you wrote | Chromium | Firefox | WebKit |
|---|---|---|---|
| `font-size`, `letter-spacing`, `line-height` — any fraction | exact | exact | exact |
| SVG `stroke-width` — any fraction | exact | exact | exact |
| `opacity`, and colors with alpha | exact | exact | exact |
| `border-width: 1.5px` | **1px** | **1px** | **1px** |
| `padding`, `height`, `top` at `.5` | **rounds up** | exact | **rounds up** |
| `height: 0.25px` | **1px** | 0.5px | **drawn as nothing** |

Type keeps its fractions everywhere, so a `12.5px` font size or a `0.16em`
tracking needs no thought. What rounds is geometry: a border, a padding, a
box's own size or offset.

So the rule is not "avoid half pixels" — it is:

- **Express sub-pixel WEIGHT as alpha on a whole-pixel box, never as a
  fractional length.** `height: 1px; opacity: 0.25` deposits exactly the ink
  `height: 0.25px` does and every engine agrees, where the fractional height
  rounds up in two engines and vanishes in the third. The same trick covers
  borders: `2px` at 75% alpha is the ink of `1.5px`, portably.
- **Draw a fractional stroke in SVG if you want it as geometry.** `stroke-width`
  is resolution-independent and survives untouched.
- Otherwise **give laid-out lengths whole pixels.**

A fractional POSITION that falls out of layout on its own — a row that lands on
a half pixel because of what is above it — has no lever, and does not need one:
it moves a hairline by a single device pixel and is not visible beside the page.

None of this constrains HTML-in-canvas, which never goes through an image and
reproduces fractional lengths exactly. It is the primary engine, and on it half
pixels need no thought at all. Content that crosses in motion, or is never
shown beside the original, will not show any of this either.

The sharpness row costs you nothing to author for. A moving Surface's
texture drifts out of density inside the band `storeForBox` already allows,
and the frame it stops on is captured exactly. The reason is cost: a snapDOM
capture is tens of milliseconds of main thread, and re-capturing on every
density step of the LOD ladder drops frames on a card being dragged.

`useSurfaceStatus().engine` names the engine a Surface is using, so a
component that must adapt can ask rather than guess.

## The content root declares its own pixel size

An element is rasterized at its **own layout box**. A container whose
children are all `position: fixed` — every portal target, so every
floating layer — has nothing in flow to size it, measures zero, and
draws an empty rectangle with clean paint events and no error.

```html
<div style="width:400px;height:300px">…</div>
```

Measure with `offsetWidth`/`offsetHeight` if you measure at all. Never
`getBoundingClientRect()`: the rect includes any entrance transform and
bakes it into the texture.

## Never animate the content root's own opacity or transform

The root's transform does not enter its captured pixels, even though
restyling that transform can trigger another paint. A compositor-animated
root opacity can leave a stale captured state until an unrelated repaint;
a static `opacity: 0` is captured as transparent. Keep both properties stable
on the root and animate a descendant or the scene mesh instead.

On **descendants** both animate correctly. They cost one paint and one
upload per frame, which is a real budget (see the mutation economy
below), so for whole-panel motion prefer moving the mesh.

`platform.md` items 4 and 20 distinguish compositor animation from static
opacity and transform restyles.

## Idle motion must be able to ease flat

If page content moves on its own — a float, a shimmer, anything
decorative that runs while the user does nothing — a crossing
needs that motion GONE before the swap: the canvas twin holds the page's
resting geometry, and any offset still live at the swap frame is a
visible jump.

So drive the motion's *amplitude* through a registered custom property
and let the keyframes read it:

```css
@property --float {
  syntax: '<length>';
  inherits: true;
  initial-value: 0px;
}
.word { transition: --float 400ms ease; }
.letter { animation: float 3s infinite; }
@keyframes float {
  50% { transform: translateY(var(--float)); }
}
```

Registration is what makes this work. An unregistered custom property is
an untyped string — a transition on it flips discretely — while a
registered `<length>` interpolates, so setting `--float: 0` eases every
moving element to rest along its own path. (The keyframes animate a
descendant's transform, which is fine; the prohibition above is the
root's own.)

The crossing side of the contract: a Surface's `timing.settleMs`
must outlast the **slowest compositor-clocked transition the content
runs on its presented pixels** — not only the idle amplitude, but any
transform hop or color fade a state change can start just before the
lift (the default 450ms covers a 400ms ease plus a frame of slack).
Zero the amplitude when the crossing leaves rest, and the settle dwell
guarantees the page is done moving before the DOM releases.

There is a second way, for motion that should never stop: **carry it**
(`useCarriedMotion`, decisions.md #30). A carried motion's clock lives
in JS instead of the compositor — the page writes the carrier's
per-frame sample to a style, the mesh reads the same sample, and the
two sides agree in every frame by construction. Carried motion is
exempt from `settleMs` and crosses the threshold mid-flight, position
and velocity intact. The trade is honest: the motion rides the main
thread, giving up the compositor's immunity to jank, so carrying is a
per-motion declaration — the ease-flat pattern above remains the right
shape for anything you leave on the compositor's clock.

## No `mask-image` anywhere in a drawn subtree

A mask on **any** descendant of a drawn element blacks out the entire
capture — the panel rasterizes solid black except independently
composited descendants, with clean paint events and no error. Even a
mask computed to a fully opaque no-op gradient does it.

A Surface rendering black-except-a-few-widgets means grep the subtree
for masks first. Utility frameworks reach for masks in ordinary places
(scroll fades are the common one), so neutralize them at the framework
layer rather than per component — `apps/lab/src/shadcn.css` shows the
shape of that.

## Pointer and focus state needs attribute twins

Real hit-testing never reaches a parked subtree, so `Surface` mirrors
pointer state onto elements as `[data-hover]` and `[data-active]`. Any
`:hover` or `:active` rule that should work through a texture has to
match them too. `:focus-visible` needs the opposite adjustment: the
browser's ring verdict is fed only by trusted events, so focus
following a forwarded click reads as keyboard unless your rules exclude
`[data-pointer-focus]`.

`packages/react/src/style.css` states these as the things the library
asks of your CSS in return, with the two-line Tailwind form for each.
Read it once; it is short, and it is the authority.

## `cursor` belongs on the content, not on the canvas

The canvas wears whatever cursor your content computes under the
pointer: on every forwarded move the relay reads the hover target's
computed `cursor` and writes it onto the canvas as an inline style, so a
lifted `cursor: pointer` control still shows a hand.

That inline style beats any rule you wrote for the canvas. Selectors
rooted outside the content do not reach it either — the source host is a
child of the canvas element, so a rule scoped to your page wrapper never
matches the parked subtree at all.

So state the cursor you want inside the captured tree. A scene replacing
the OS pointer with a drawn one needs `cursor: none` on the content root
and its descendants; without it a plain `<button>` in the content
resolves to `default` and the arrow comes back over exactly the elements
the pointer is aimed at.

## Focus and state chrome: paint properties only

`FocusScene` stamps `[data-focus='unit' | 'interior']` and
`[data-engaged]` on a unit's root. Style them with outline, colour and
shadow — never border, padding, or anything else that changes layout. A
layout change relayouts the whole subtree on every focus move, and on a
vacated flight slot a 1.5px border marched the page 2px at every
liftoff.

Same rule for any transient pulse: transition `background-color`, not
size.

## The mutation economy

Uploads are driven by the compositor's own paint signal, so a quiescent
Surface costs nothing — idle sources measure 0 paints/s, and CI gates on
it (`instruments/idle-zero`). The budget is spent by things that paint
*continuously*.

Write feeds that mutate in bursts — one coalesced write per tick — and
then go quiet. A panel that updates twice a second is free between
updates; a panel that animates a descendant every frame is not.

On snapDOM the budget is enforced rather than advisory. A rasterized source
leaves 150 ms of quiet after each capture before it starts another
([decisions #60](decisions.md)), because a whole-panel raster is tens of
milliseconds of main thread and a subtree mutating every frame would otherwise
take all of it — measured 51.4 fps through a drag against 60.1 fps with the
gap. The gap runs from the END of a capture, so a subtree quiet for longer than
the gap captures at once and only continuous mutation is held back: DOM motion
inside a Surface steps about four times a second rather than the eleven the
raster cost alone allowed. The settle is the one exception and is never held.

Two consequences worth authoring around. A CSS transition signals at its two
ends rather than every frame, so it costs a couple of captures instead of a
steady stream — but this engine captures neither the frames between
([platform #22](platform.md)), so use one where only the end state has to be
right, and move motion that must be seen outside the drawn subtree. And the
gap paces input echo too: a keystroke or hover inside a Surface can take up to
~240 ms to appear in the texture, against ~90 ms before.

One honest exception: **a focused field is never idle-zero.** Caret
blink self-paints its source about twice a second. That is correct
behavior, not a leak — but a probe page that holds focus inside a
source can never measure idle.

## Keep texture attachments on one paint generation

A responsive hybrid has five distinct states:

1. Live layout is what the DOM measures now.
2. Painted raster is the source canvas content identified by its successful `DomPaintReceipt`.
3. Uploaded texture is the paint sampled at Three's upload boundary.
4. Drawn frame is the uploaded generation used by a presenter.
5. Presented framebuffer is the qualifying color-writing draw accepted at the presentation boundary.

Do not attach scene objects measured from live layout to an older texture.
Use `Surface.Anchor`, `useSurfaceAnchorRects()` and `useSurfacePaintedSize()`
for ordinary Surface content. The binding collects stable
`data-munari-anchor` keys against a successful paint and commits the anchor
transaction when it matches the drawn source and generation. Anchors are
normalized unmirrored source UVs; they are not fields of `DomPaintReceipt`.
Keys reject selector-order drift when controls are inserted or reordered.
Position follows the Surface projection; physical hardware size stays in
independent CSS or world units.

The lower-level DOM source offers `currentPaint()` and `subscribePaint()`.
`FrameSurface` offers `onFrameDrawn` and `onPresented` for caller-owned frame
sources. Ordinary `Surface` has semantic lifecycle callbacks, not an
`onPainted` or `onPresented` prop. Do not mix these interfaces when collecting
evidence. The [system model](system-model.md#keep-the-observable-facts-separate)
explains what each boundary establishes.

Custom capture pipelines can import `collectSurfaceAnchors` and its receipt
types from `/advanced`. The same core collector serves the binding; there is
no separate registry copy to maintain. It rejects duplicate or incomplete key
sets as one transaction and keeps the prior complete receipt usable.

## Where the rest lives

- `packages/react/src/style.css` — the CSS contract, both directions
- `docs/platform.md` — the measurements these rules come from
- `docs/focus.md` — focus units, traversal, and directional navigation
- `docs/decisions.md` — why each rule is shaped the way it is


## Retained HTML and capture sources

`Surface.HTML` retains one live instance. Page-owned preparation uses the source
bitmap and its native input rig so selection, caret, focus, hover and current text
remain visible. Its inert clone reserves layout. Keep content-root dimensions
honest; changing page parents uses a page target rather than remounting the content.
Position-only slot changes are observed separately from capture and handoff work.

`SceneSurface` has no page presentation. `useElementCapture` leaves its original
element native and copies visual state; `CaptureContent` owns separately authored
capture content. Captures reject unsupported media/custom elements unless excluded,
and attached/removed sources clear stale frames. Source textures are borrowed by
consumers and disposed only by their owner.

Numeric authored dimensions must be positive and finite. An unmeasured native
element waits for layout rather than being treated as invalid authored data.
Companions use `useSurfaceBeforeRender` after frame pose writers; the callback may
run for several cameras/targets in one animation frame. It updates companions,
not the simulation clock. Canvas-relative placement follows the GL canvas's live
client rectangle, including inset, scroll and supported positive scale.
