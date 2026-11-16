# 3D wordmark

`MunariLogo` mounts this renderer for the homepage, scene navigation and wordmark bench. Each letter has its own morph clock and rest period. Its slot stays fixed while its outline, color and material change. Floating uses a continuous clock that stops while the page is hidden or the logo is offscreen. Reduced motion keeps the current letter shapes still.

`wordmarkAnimation.ts` owns the timing and motion values. `wordmarkMaterials.ts` owns the physical finishes. `wordmarkGeometry.ts` matches and repairs outlines, fits holes inside their letter, and limits bevels by edge clearance. It also supplies the rasterizer used to capture fonts. Consumers must dispose replaced geometries.

`wordmarkGlyphData.ts` contains generated contours for the letters in “munari.” They were rasterized in Chrome on a 224-pixel square, normalized to the font's x-height, and extracted with `rasterGlyph` and `contours`. Coordinates use that grid with y pointing down. These are font outlines, not hand-modeled letter meshes. The renderer uses them directly, so startup requires no font download or canvas text capture.

| Google Fonts face | Weight | Style |
|---|---|---|
| Bodoni Moda | 700 | Normal, optical size 96 |
| Shrikhand | 400 | Normal |
| Caveat | 700 | Normal |
| Silkscreen | 700 | Normal |
| Archivo | 900 | Normal |
| Courier Prime | 700 | Normal |
| Playfair Display | 900 | Italic |

The Silkscreen m is excluded because it resembles an H. Its undotted i is also excluded. Every i transition pairs its stem and dot separately.

The fonts use the SIL Open Font License. Copies are under `public/licenses/`, named for each family. `public/munari-wordmark.svg` and the opening cover use the generated starting outlines as a static fallback. A failed or lost WebGL context leaves that image visible. The surrounding link owns navigation and its accessible name; the canvas takes no pointer events.

Geometry repair does not understand letter strokes. Unfamiliar font pairs can still produce unattractive intermediate forms or abrupt changes in their fitted holes. The supported font set was checked for crossing outlines, contained holes, finite closed meshes and crossings at sampled bevel depths. Those checks do not establish correctness for every possible font.
