# Surface anchors

Copy `surfaceAnchors.ts` when WebGL objects must stay attached to named
regions of a DOM Surface.

The collector publishes normalized source UV rectangles with a successful
DOM paint receipt. Anchor keys define identity, regardless of selector
order. The collector rejects the whole receipt on a duplicate or missing
key. UV position follows the Surface; `cssWidth` and `cssHeight` keep
physical hardware dimensions independent.

Use the receipt only with texture pixels from the same paint generation.
Live layout, painted raster, uploaded texture, drawn frame, and presented
framebuffer are different states; do not infer one from another.

The registry file must stay byte-identical to the lab module;
`tests/registry/surfaceAnchorsPack.test.ts` fails if they differ.
