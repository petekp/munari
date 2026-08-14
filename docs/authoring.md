# Authoring for a Surface

A Surface draws a live DOM subtree. What you write is ordinary
markup — real layout, real focus, real text selection — and almost all
of it needs no special knowledge. This page is the short list of places
where the second renderer is visible, and what each one costs if you
ignore it.

Every rule here is a *measured* platform property, not a style
preference. `docs/platform.md` holds the measurements; this page holds
what to do about them.

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

Changing the drawn element's *own* `opacity` or `transform` does not
invalidate its paint record, so nothing repaints. Keyframes freeze;
transitions leave a **stale end state** that self-heals on the next
unrelated repaint — an intermittent bug by construction, invisible in
review.

On **descendants** both animate correctly. They cost one paint and one
upload per frame, which is a real budget (see the mutation economy
below), so for whole-panel motion prefer moving the mesh.

This is the hinge that has cost the most; `platform.md` item 4 has the
numbers.

## Idle motion must be able to ease flat

If page content moves on its own — a float, a shimmer, anything
decorative that runs while the user does nothing — a custody crossing
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

The crossing side of the contract: `useCustodyCrossing`'s `settleMs`
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

One honest exception: **a focused field is never idle-zero.** Caret
blink self-paints its source about twice a second. That is correct
behavior, not a leak — but a probe page that holds focus inside a
source can never measure idle.

## Keep texture attachments on one paint generation

A responsive hybrid has five distinct states:

1. Live layout is what the DOM measures now.
2. Painted raster is the successful `DomPaintReceipt` now in the source canvas.
3. Uploaded texture is the paint sampled at Three's upload boundary.
4. Drawn frame is the uploaded generation named by `onFrameDrawn`.
5. Presented framebuffer is the qualifying default-framebuffer draw named by `onPresented`.

Do not attach WebGL matter measured from live layout to an older texture.
Collect stable `data-munari-anchor` keys when `onPainted` fires, store them
as normalized unmirrored source UVs, and draw them only with that paint
generation. Keys reject selector-order drift when controls are inserted or
reordered. Position follows the Surface projection; physical hardware size
stays in independent CSS or world units.

The copyable collector lives in `registry/surface-anchors`. It rejects a
duplicate or incomplete key set as one transaction and keeps the prior
complete receipt usable.

## Where the rest lives

- `packages/react/src/style.css` — the CSS contract, both directions
- `docs/platform.md` — the measurements these rules come from
- `docs/focus.md` — focus units, traversal, and directional navigation
- `docs/decisions.md` — why each rule is shaped the way it is
