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

## Where the rest lives

- `packages/react/src/style.css` — the CSS contract, both directions
- `docs/platform.md` — the measurements these rules come from
- `docs/focus.md` — focus units, traversal, and directional navigation
- `docs/decisions.md` — why each rule is shaped the way it is
