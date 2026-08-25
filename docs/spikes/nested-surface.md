# Spike: a Surface declared inside another Surface's source

Run 2026-08-23 in local Chrome 151.0.7922.170, React 19.2.7, Three
r185.1. The apparatus was standalone Puppeteer/Vite code in
`spikes/nested-surface/`. It was deleted.

**Status: a dated measurement.** Nothing here is a plan.

**Questions asked**

1. Does a `<Surface>` declared inside another Surface's source mount
   twice — once in the page copy, once in the parked source copy?
2. Does each mount create its own parked source host, so one written
   declaration becomes two capture containers?
3. What does the outer Surface's texture actually contain where the
   inner Surface sits?
4. Does anything throw, warn, or refuse?

**Verdict: it works, and it is not nesting.** The inner Surface renders
twice and captures twice, and the outer's texture holds a flat picture
of the inner's DOM copy. There is no containment at the capture layer
and no composition of the inner's own presentation. Two Surfaces stay
siblings however the JSX is arranged.

## The apparatus

An outer Surface, 320x160, its source a solid red div. Inside that div,
an inner Surface, 120x60, its source a solid blue div. One
`SurfaceCanvas`. The outer was handed to WebGL and its rect read back
with `readPixels` in the same task as the render.

Two variants, differing only in where the inner handle came from:

- **A** — `useSurface('inner')` called inside the nested component, the
  way someone would write it first.
- **B** — one `useSurface('inner')` above, passed down as a prop, so
  both copies of the source tree declare the same handle.

## What we learned

**1. Two mounts, source copy first.** Both variants recorded
`['inner:source', 'inner:page']`. The source tree exists twice — that
is what `useSurfaceInstance()` distinguishes — so a component declared
in it runs twice, and the parked copy's effects run before the page
copy's.

**2. Three parked canvases for two written Surfaces.** The DOM held two
source hosts named `inner` at 120x60 and one named `outer` at 320x160,
plus the `SurfaceCanvas` itself: four canvas elements. Both variants.
The duplicate is not an error — each host is keyed by its root's
`instanceId`, not by name — but one written `<Surface>` costs two
captures, and both run their own paint and upload.

**3. The outer texture holds the inner's DOM copy, exactly.** Reading
the outer's 320x160 rect off the WebGL canvas: 7,200 blue pixels,
44,000 red, 0 transparent, 0 anything else. 7,200 is 120 x 60 — the
inner box at full size, sharp, in the right place. The outer captured
the inner's page-side DOM, not its mesh, which is what the DOM tree
says should happen: the inner's presenter lives in a `SurfaceCanvas`
elsewhere in the scene graph and was never inside the outer's source.

**4. Variant A is silent; variant B is caught.** A produced no errors
and no warnings. B produced, once:

```
[munari] Error: Surface "inner" already has a controller. One handle is
declared by exactly one <Surface>; pass the handle to
<Surface.WebGL surface={…}> for the other tree instead.
```

The guard against two declarations of one handle already existed. It
fires here for a cause nobody wrote down — the second declaration is
not a second call site, it is the same call site running in the other
copy of the tree.

## What surprised us

The double mount is silent in variant A. Two paints and two uploads per
frame for one authored Surface, with nothing in the console saying so.
Whatever a nested Surface does — a live input, a video, an animation —
it does twice, and the copy in the parked tree is the one nobody is
looking at.

The outer's capture was perfect. Platform item 10 refuses a *descendant*
of a legitimate canvas child, so the expectation was some degradation
where the inner sat. There is none, because the inner's source was
portaled out to its own canvas and what stayed behind in the outer's
subtree was ordinary DOM.

## Still unknown

- Whether the inner Surface can be handed to WebGL *while* the outer
  is presenting. Not tested; the outer's texture would keep showing the
  inner's page copy, and the inner's mesh would draw on top in canvas
  space, but that is reasoning, not a measurement.
- What a nested Surface costs at scale. Two captures were free here at
  120x60 of flat colour. Nothing was measured under load.
- Whether the double mount breaks pointer relay into the inner. Not
  probed.

## What this means for composition

The primitive that composes two Surfaces already exists and is not
containment: `useSurfaceTextureOf(handle, part?)` (decisions.md #36)
lets one Surface's material name another's texture, and the sampled
Surface needs no presenter at all. Composition is by naming in the
shader. The DOM tree decides what is captured; it does not decide what
is composed.
