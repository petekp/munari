# Spike: one material, two Surfaces (the lens transition)

Measured 2026-08-22, Chrome 140 with `--enable-features=CanvasDrawElement`,
via a disposable page + puppeteer runner in `spikes/two-textures/` (two
Surfaces: A presenting in WebGL with a custom lens material, B a source with
no presentation at all). The apparatus is deleted; this report is the
artifact.

**Questions asked:**

1. Does a Surface's texture keep updating when it has no WebGL presenter of
   its own and is not composited on the page? (kill criterion — the lens
   needs a live destination view behind the outgoing one)
2. Can a material inside Surface A bind Surface B's texture through the
   published entries only?
3. Does arbitration object to B being sampled while A holds presentation —
   does B need its own crossing, or is a resident source enough?
4. Would a screen-space grab of a real B mesh behind A give the same
   picture, making the whole capability unnecessary?

**Verdict:** viable, and cheaper than expected. The capability is already
there in the runtime; what is missing is a way to name another Surface's
texture from a material. Gap 4 in `apps/lab/src/scenes/candidates/README.md`
is an ergonomics gap, not a capability gap.

## What we learned

**1. A Surface with no presentation is fully live. Yes.** B was declared as
`<Surface surface={b} size={[300,180]} source={<BContent/>} />` with no
`<Surface.DOM>` and no `<Surface.WebGL>`. Its content mutated every 16ms.
Its parked canvas repainted throughout: the byte sum over the full 300×180
capture moved 22,765,590 → 22,976,385 over 1.2s, while the control (Surface
A, static content) held at 30,293,301 exactly across the same window.

**2. B keeps its own GL texture, and uploads it. Yes — this is the finding
that matters.** A component rendered as a child of B reads
`useSurfaceTexture()` and gets a real `THREE.CanvasTexture` whose
`image.width` is 300. Its `version` climbed 175 → 318 over 1.2s (~145
uploads, ≈120/s). So the source runtime rasterizes, uploads, and versions a
texture for a Surface that nothing on screen presents. Identical numbers
under `frameloop="demand"` (175 → 318): a painting source claims work
through the host's reference-counted `setBusy`, so demand mode does not
starve it.

**3. Arbitration says nothing. Clean.** No warning, no error, no
readiness complaint across every run. A's crossing completed normally
(`targetView: 'webgl'`, `presentedView: 'webgl'`, `ready: true`) with B
sitting resident beside it. B stayed at `presentedView: 'dom'`,
`ready: false` — `ready` is a statement about registered WebGL presenters,
and B has none by design. Nothing in the protocol treats a
presentation-less Surface as a fault.

**4. A screen grab cannot produce this picture. Confirmed.** With the lens
material sampling B through a bulged UV, the composited GL canvas contained
**2,590 B-coloured pixels inside A's 300×180 rect and 0 anywhere else**
(the only other painted region was a 120×120 control mesh, 14,400px). B is
drawn nowhere in the scene — the scene graph holds exactly one Surface mesh,
A's. A framebuffer copy of that scene therefore contains zero B pixels by
construction. The correspondence is also content-space, not screen-space:
A samples B at an arbitrary UV, which is what a morph needs and what a
screen grab structurally cannot give.

## What surprised us

**The runtime already does the expensive half.** The expectation going in
was that a Surface with no presenter would be dormant — no raster, no
upload, possibly no runtime. All three exist and run. "One source, one
texture, any number of presenters" turns out to include *zero* presenters,
and nothing in the code treats that as a special case.

**`useSurfaceTexture()` throws on first render, not permanently.** Rendered
as an immediate child of B it threw `useSurfaceTexture() found no texture` —
`part.runtime` is null on the first commit. Mounted 600ms later it returned
the texture with no complaint. The error text says the hook is "only valid
inside a material passed to `<Surface.WebGL material={…}>`", which is
narrower than what the hook actually supports.

**An invalid `SurfaceView` string stalls silently.** `view="gl"` (the
crossing *phase* name, not the view name — the view is `"webgl"`) left the
Surface at `targetView: 'gl'`, `presentedView: 'dom'`, `isChanging: false`
with no warning in any mode, for as long as the page ran. The mesh mounted,
drew 2048 triangles, and contributed zero pixels. TypeScript catches this in
a typechecked consumer; nothing at runtime does.

**Re-sighting of candidates gap 1.** Number-valued uniforms written into a
memoized bag did not track — raising the mix uniform from 0.55 to 1.0
changed the B-pixel count by 7% (2,590 → 2,418) instead of filling the rect.
Already documented; noted here only because it cost time again.

## Still unknown

- **Two Surfaces both presenting, both live, in one crossing.** This spike
  had one presenter and one resident. A view transition wants both views
  crossing at once, which is where `crossingPresentation` exclusivity and
  atomic multi-surface commits actually get tested.
- **Pointer routing when B is sampled but not drawn.** B is invisible
  matter, so nothing can hit it. If the destination view should become
  grabbable partway through the transition, that is a real question and this
  spike did not touch it.
- **Cost at transition scale.** Two 300×180 sources is nothing; platform #5
  says ~96 concurrent painting sources hold 120Hz. A full-page pair at
  1440×900 was not measured.
- **Colour correctness of a two-capture composite.** Both textures are
  `SRGBColorSpace` and premultiplied, so the mix is premultiplied-correct in
  principle, but no reference comparison was made.

## Recommended approach

- **Add a hook that names another Surface's texture, keyed by handle.**
  Something like `useSurfaceTextureOf(handle)`, returning `THREE.Texture |
  null` — null before the runtime lands, so a material can mount and bind
  later rather than throwing. This needs a handle → runtime lookup; the
  public `SurfaceHandle` is `progress` only, so the lookup belongs beside
  `SurfaceStore`, which already reaches everything.
- **Do not add a second source, a second parked canvas, or a second
  texture.** The runtime's own texture is live and versioned. Sampling it is
  a read, not a new pipeline.
- **Let the destination Surface stay presentation-less.** No crossing, no
  readiness entry, no mesh. It is a resident source whose only consumer is
  another Surface's shader. Nothing in arbitration objects.
- **Do not build the screen-grab variant.** It cannot produce the picture,
  and it costs a full-screen render target per frame.
- **Fix the two silent stalls while in there:** `useSurfaceTexture()`'s
  error text should not claim the hook is material-only, and an unrecognised
  `view` value should warn in development.

## Cost signals

Small. One new hook in `packages/react/src/primitives/surface/`, a handle →
runtime lookup on the store or root registry, one export added to the
curated entry, and a conformance contract for "a source with zero presenters
still paints, uploads, and versions." No new dependency, no kernel change,
no migration. The hard part is not the plumbing — it is deciding whether the
lookup is by handle (identity, matches how scenes already think) or by name
(matches how the host registry already keys cross-tree wiring).
