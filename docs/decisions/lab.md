# Decisions: lab and demos

Rules for the lab app: its design tokens, the demo catalog, the overview page, and the Light and postcard demos. Code cites each rule as `decisions.md #N`; the [index](../decisions.md) maps every number to its file.

<a id="23"></a>

## #23 — Tokens a lifted Surface reads live on `:root`

A custom property that a lifted Surface reads must be declared on `:root`. A lifted Surface renders its DOM in a parked canvas subtree under `<body>`. Class rules still match there, but scene ancestors are outside its chain, so only `:root` custom properties reach it and inherited properties do not. A lifted component declares its own `font` and pixel size. Webfonts are preloaded and use `font-display: block`, so a first capture never bakes in a fallback face.

<a id="50"></a>

## #50 — One light shades native type, controls and the postcard

The Light demo keeps the page's 2D look. Glyphs and raised controls cast shadows from thin surfaces at their own elevations (`lightLaw.ts`). One visibility result represents the one light, so overlapping casters never double-darken. Shadow fields are signed distance fields packed over ±256 CSS px and rebuilt only when layout changes. Rays come from a spherical bulb, sampled 64 times where coverage is partial.

The postcard stays in front of the headline in the page and in the scene, and native casters never darken it. The light's idle drift, 12 by 3 CSS px, stays in the gap above the headline. The lit receiver of a glyph sits 1.5 CSS px inside the opaque ink, so no bright fringe shows. A cheaper shadow field never justifies a blurrier content texture (#44). `probe:light` and `probe:heading-edges` check the demo.

<a id="51"></a>

## #51 — Paper geometry supplies appearance, input and shadow

The postcard is a 48 × 32 grid changed only through `deformSurfaceGeometry` (#35). Raycasts, the drawn picture and the shadow all read those vertices. Corner curls wrap strips, and the broad bend applies after them, which keeps local length within 4% of the printed sheet. Every deformation reaches exactly zero before presentation returns to the page. The reverse is unprinted stock in one double-sided pass, and a back-facing first hit relays no input. Pose publishes inside `Surface`'s pre-draw callback, never through React.

Lighting draws the page field at CSS density, copies it to a native-density multisampled canvas, and shades the paper's actual triangles over it, so the mesh edge keeps its antialiasing (`probe:postcard-edges`). The canvas shortens its offscreen band when Chrome allocates a smaller buffer than requested. Soft cast and self-shadow come from a fitted 1024 px floating-point depth map with 64 samples, and a planar shadow is the fallback.

<a id="52"></a>

## #52 — The lamp refracts the page through a hollow glass shell

The lamp ray-marches a pear-shaped signed distance field with a 1.15 px wall, Fresnel reflection and total internal reflection. The shader supplies silhouette coverage, because antialiasing the bounding box cannot smooth an implicit surface. It refracts a screen-space capture of the viewport, taken from an inert mirror of the page that excludes the lamp and lighting canvases, so the lamp never feeds back into its own capture. Without HTML-in-canvas the lamp keeps reflections and emission, and the page stays native.

The lamp follows the enclosing visual viewport and its zoom. It renders only the visible part with a camera view offset, and capture density follows the same zoom. Glare and halos draw over the glass. The cord has 28 points at 120 Hz, pinned at both ends. `probe:light-lamp` and `probe:lamp-quality` check the lamp.

<a id="56"></a>

## #56 — The headline demonstrates HTML, 3D and shaders

The visible heading shows `<html>` in native monospace, `3D` as beveled Archivo geometry and `Shaders` through a thin-film shader. The accessible heading keeps the exact tagline. Native text owns layout and selection. One transparent canvas beneath it draws the two enhanced words from the masthead's existing frame and sits behind the postcard. Each text run supplies its own font, spacing and baseline to the shadow mask.

Native text stays until the enhanced frame is ready and returns on context loss. The word treatments need WebGL but not HTML-in-canvas. Reduced motion freezes the material clock and removes ripple and tilt, and offscreen headings skip drawing. Edge contrast stays within 0.95 to 1.05 of native (`probe:light-headline`).

<a id="57"></a>

## #57 — The Light demo reveals together and falls back to native after four visible seconds

The Light demo appears only when fonts have settled and the shadow, headline and lamp have each drawn for the current layout. The lamp draw must have no backdrop capture pending. A recheck on the next frame rejects a layout change in between. There is no minimum wait. The page appears through one 120 ms fade, which reduced motion removes.

If graphics are not ready after 4 s of visible time (`GRAPHICS_DEADLINE_MS` in `lightOpening.ts`), the page shows native content for the visit and disposes the effects. The deadline pauses while the document is hidden.

Headline masks are reused when their native alpha bytes, size, density and rectangle are equal. The distance transform crops to painted bounds plus one raster pixel for antialiasing and the 256 CSS px saturation distance and matches the full-size reference byte for byte (`instruments/light-opening/mask-fidelity.mjs`). `probe:light-opening` checks the reveal.

<a id="75"></a>

## #75 — The overview leads with a running demo, and one catalog lists the demos

A lab scene exists to prove a claim no other scene proves, as a demo a reader can follow, and it uses only the published entries. A scene that proves nothing new, or whose claim a cheaper check already pins, is deleted. `DEMOS` in `sceneCatalog.ts` lists the promoted demos and is the one list read by the overview, the previous and next links, and the `App.tsx` routes. URL-only studies in `LAB_SCENES` stay beside them without promotion. Adding a demo takes one catalog entry, one `DEMO_PAGES` entry and `public/thumbs/<id>.jpg`.

The overview (`?scene=home`) opens with the tagline and one sentence about Munari. Below it the chosen demo runs live in an iframe, loaded as a framed, bare page and scaled from a 1100 px layout (720 px on narrow screens). The stage shows plain `--bench` while the demo loads. A thumbnail index, three summary statements, the install command and a guide link close the page. No demo renders inside the site document. The cover lifts when the overview's fonts are ready or a demo's iframe loads.
