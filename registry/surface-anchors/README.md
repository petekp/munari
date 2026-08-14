# Surface anchors

Copy `surfaceAnchors.ts` when WebGL matter must stay attached to named
regions of a DOM Surface.

The collector publishes normalized source UV rectangles with a successful
DOM paint receipt. Keys, not selector order, define identity. Duplicate or
missing keys reject the full transaction. UV position follows the Surface;
`cssWidth` and `cssHeight` keep physical hardware dimensions independent.

Use the receipt only with texture pixels from the same paint generation.
Live layout, painted raster, uploaded texture, drawn frame, and presented
framebuffer are different states. Do not infer one from another.

The registry file is byte-identical to the lab module and is pinned by
`tests/registry/surfaceAnchorsPack.test.ts`.
