# Keep texture attachments on one paint generation

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
