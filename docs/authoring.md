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
| Content that changes on its own — an animation loop, a ticker, a clock, video frames, async prop updates | requires `live` ([decisions #64](decisions.md)); with `live`, captured every compositor paint | not followed, `live` or not ([decisions #64](decisions.md)); call `useSurfaceRefresh()` when a change must show |
| Decorative motion inside the subtree | paused in the scene unless `live` ([decisions #66](decisions.md)) | **frozen**: paused in the scene, `live` or not, and captured at its first frame unless it is a transition ([platform #22](platform.md)) |
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

The first row is the one to decide per Surface. snapDOM pays tens of
milliseconds of main thread for every capture, so it follows only what it can
afford by default: the user's own input on the content and the DOM changes that
answer it within 150 ms (a field re-rendering as it is typed in, a menu opening
on a click, a thumb following a drag), a layout resize, a webfont or image
landing, a transition or animation reaching its ends, and an explicit
`repaint()`. A change the content makes on its own — a bouncing element, a
clock, a feed, a canvas redrawn from a video — is not followed, and the texture
shows it as it was at the last capture. So is a change the app makes from
outside the Surface, which the source cannot tell from an animation: new props,
a store update, data that arrives after mount, a tweak panel or keyboard
shortcut elsewhere on the page writing into the content. Declare `live` on the `Surface`,
`Surface.HTML`, `SceneSurface` or `SceneSurface.HTML` whose content does that
and the scene must show it moving ([decisions #64](decisions.md)). HTML-in-canvas
then accepts every compositor paint. snapDOM ignores `live`, because each of its
captures is a full raster. A live Surface there holds still in the scene like any
other, and `useFreezeSurface()` turns true so your own clocks can stop with it.
Write once for both engines: add `live` where motion inside a Surface is the
point, and call `useSurfaceRefresh()` where an outside update must reach the
scene on snapDOM too.

The frozen-motion row is the one that will surprise you. An infinite keyframe
animation inside a snapDOM Surface signals `animationstart` once and nothing
after, so the capture holds one frame of it forever, `live` or not. A CSS
*transition* signals at both ends and lands its end state, which is why a
transition lands its end state on both engines. Anything else that has to keep
moving needs `live` on HTML-in-canvas. On snapDOM only `repaint()` on your own
schedule moves it, and each capture costs a full raster.

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
reproduces fractional lengths exactly. Content that crosses in motion, or is
never shown beside the original, will not show any of this either.

The sharpness row needs no special markup. A moving Surface's texture drifts
within the density band `storeForBox` allows, and the settled frame is captured
at target density; re-capturing every intermediate step on snapDOM would drop frames.

`useSurfaceStatus().engine` names the engine a Surface is using, so a
component that must adapt can ask rather than guess. It is `null` when no
engine can run, and `reason` then says what to enable.

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

## Motion in the content is frozen for you

If page content moves on its own — a float, a shimmer, anything
decorative that runs while the user does nothing — the two sides of a
crossing have to agree about where it is at the swap frame.

**The library holds declarative motion for you** (decisions.md #66). While a
canvas has the content, every CSS animation, CSS transition and Web Animation
in the subtree is paused, and on the return it resumes where it stopped, not
where it would have got to. So a self-animating subtree neither steps
backwards at the lift nor jumps forward at the return, and you do not have to
think about it. A source declared `live` is exempt: it asked for the motion,
and the canvas follows it.

**What the library cannot hold is a clock it does not own** — a
`requestAnimationFrame` loop writing styles, or a playing `<video>`. Neither
has a timeline the platform exposes. If your content runs its own clock, stop
it on `onFreezeChange(frozen)`, or read `useFreezeSurface()` as React state.
Both turn on the same frames the library pauses its CSS, starting before the
capture. `onPresentationChange` is too late for this: it turns after the
capture, so a clock stopped there runs into the picture. Genie's `scheda`
window is the worked example: its bounce simulation stops on
`useFreezeSurface`.

Nothing waits for motion to finish, and there is no dwell to size
(decisions.md #68). The page lets go as soon as the scene has drawn a capture
taken after the lift, and that capture shows the frozen pose. So do not start
motion because a crossing began, such as easing an amplitude to zero on
`onFreezeChange`: the hold has already paused what was running, and a
transition started after it is not held, so the page and the capture can
disagree about its pose.

There is a second way, for motion that should never stop: **carry it**
(`useCarriedMotion`, decisions.md #30). A carried motion's clock lives
in JS instead of the compositor — the page writes the carrier's
per-frame sample to a style, the mesh reads the same sample, and the
two sides agree in every frame by construction. A carried motion is not
frozen, and it crosses the threshold mid-flight with position and velocity
intact. Carry any motion the scene draws for itself instead of reading it
from the capture: the logo's letters hop on a carrier because each mesh
places itself from its letter's pose. The trade is honest: the motion rides
the main thread, giving up the compositor's immunity to jank, so carrying is
a per-motion declaration.

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

## Window listeners that follow a press need `capture: true`

With `pointerMode="surfaces"`, from a press on a Surface until its release, the
canvas pointer gate stops the browser's `pointermove`, `pointerup` and
`pointercancel` in the document's capture phase and sends R3F an untrusted
copy. A `window` pointer listener that must hear the browser's own events
while the canvas is armed adds itself with `{ capture: true }`
([custom scene content](scene-content.md)).

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

On snapDOM the budget is enforced rather than advisory, in two steps. A
Surface that is not `live` spends nothing on a subtree that changes on its
own: the change is not followed, and only the user's input, a resize, fonts,
images, a transition's ends and `repaint()` reach the rasterizer. A Surface's
`live` does not change that on snapDOM ([decisions #64](decisions.md)). A live
`useElementCapture` follows every change, and a rasterized source then leaves 150 ms of
quiet after each capture before it starts another
([decisions #60](decisions.md)), because a whole-panel raster is tens of
milliseconds of main thread and a subtree mutating every frame would otherwise
take all of it — measured 51.4 fps through a drag against 60.1 fps with the
gap. The gap runs from the END of a capture, so a subtree quiet for longer than
the gap captures at once and only continuous mutation is held back: DOM motion
inside a live capture steps about four times a second rather than the eleven
the raster cost alone allowed. Only the capture a lift asks for skips
it ([decisions #65](decisions.md)).

Two consequences worth authoring around. A CSS transition signals at its two
ends rather than every frame, so it costs a couple of captures instead of a
steady stream — but this engine captures neither the frames between
([platform #22](platform.md)), so use one where only the end state has to be
right, and move motion that must be seen outside the drawn subtree. And the
gap paces input echo too: a keystroke or hover inside a Surface that is already
re-capturing can take up to ~240 ms to appear in the texture, against ~90 ms on
a quiet one.

One honest exception: **a focused field is never idle-zero.** Caret
blink self-paints its source about twice a second. That is correct
behavior, not a leak — but a probe page that holds focus inside a
source can never measure idle.

## Cross-origin content needs CORS to appear in the scene

A Surface's 3D copy draws only what the page is allowed to read. An image,
CSS background or iframe from another origin without CORS is left out of the
capture, while the page still shows it. HTML-in-canvas leaves a transparent
hole there. snapDOM draws a gray placeholder for an image or iframe and nothing
for a background.

- Serve a cross-origin image with `Access-Control-Allow-Origin`, and give its
  `<img>` the `crossorigin` attribute. Both engines then draw it.
- Host CSS backgrounds on the page's origin. HTML-in-canvas leaves out a
  cross-origin background even when the server sends CORS headers.
- A cross-origin iframe never appears in the copy.

Neither engine taints its canvas, so missing content raises no error and no
failed upload (platform.md #34).

## Where the rest lives

- `packages/react/src/style.css` — the CSS contract, both directions
- `docs/platform.md` — the measurements these rules come from
- `docs/focus.md` — focus units, traversal, and directional navigation
- `docs/decisions.md` — why each rule is shaped the way it is
- `docs/paint-generation.md` — keeping texture attachments on one paint generation
- `docs/retained-html.md` — how a Surface keeps its one HTML instance and who
  owns each capture source
