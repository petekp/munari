# The platform, as measured: `texElementImage2D`

This file holds the measurements of `texElementImage2D`, the direct GL upload that Chrome 158 removed, and why the kernel does not use it. It is part of [the platform measurements](../platform.md), which lists every item and the table conventions.

| # | What the platform does | Evidence |
|---|------|---------|
| <a id="item-14"></a>14 | **`texElementImage2D` is drawElementImage's contract at the GL entry point, with one relaxation.** The element must be an immediate child of the SAME canvas whose GL context uploads (item 10's rule — a child of a different canvas is refused), the canvas needs `layoutsubtree` (the `layoutSubtree` property reflects it), and the first paint must have completed. But once painted, the call succeeds OUTSIDE `onpaint` — from plain rAF callbacks. Chrome 151's signature is the 3-arg `(target, internalformat, element)`. (measured 2026-09-02, Chrome 151) | before any paint: `InvalidStateError: No cached paint record for element`; other-canvas child and body element: `Only immediate children of the <canvas> element can be passed to texElementImage2D()`; no attribute: `requires the canvas to have the layoutsubtree attribute`; 210 uploads from rAF tasks, zero errors — `docs/spikes/texel-upload.md` |
| <a id="item-15"></a>15 | **`texElementImage2D` rasters at the canvas's backing/CSS ratio, per axis — item 8's auto-scale law, owned by the CANVAS.** Every child shares one density; the 3-arg signature has no scale parameter, page dpr is irrelevant, and a CSS `transform: scale(2)` on the element changes nothing. On a visible renderer canvas the ratio is pinned to dpr, so per-Surface density (the LOD ladder) cannot ride this path. (measured 2026-09-02, Chrome 151) | 200×100 child, 400px-CSS canvas: texture exactly [100,50]/[200,100]/[400,200]/[600,300] at backing 0.5×/1×/2×/3×; non-uniform canvas (512×512 backing over 2100×1600 CSS): the two axes raster at their two ratios ([25,26] from 100×80); `scale(2)` → size unchanged |
| <a id="item-16"></a>16 | **`texElementImage2D` uploads STRAIGHT alpha by default; `UNPACK_PREMULTIPLY_ALPHA_WEBGL` and `UNPACK_FLIP_Y_WEBGL` are honored.** Default orientation puts DOM-top at texture row 0, like every DOM upload. Decisions.md #5's premultiplied invariant survives this path only through the pixel-store flag. (measured 2026-09-02, Chrome 151) | `rgba(255,0,0,0.5)` element reads `[255,0,0,128]` bare, `[128,0,0,128]` with the premultiply flag — byte-identical to the 2D-canvas path's stored bytes; red-top/blue-bottom flips with the flip flag |

**Items 14–15 are why the kernel stays on the 2D-canvas path.** The direct
GL upload (three.js PR #31233's `HTMLTexture` route) was measured no faster
— both paths' main-thread cost is 0.1–0.2ms medians, flat from 640×480 to
2048×1536, so the copy it removes is a GPU-side blit — and adopting it
would parent every source to the one visible renderer canvas at one shared
dpr-pinned density. The parked 2D canvas is where per-Surface density,
paint receipts, and paint stats live; it is not overhead. Numbers and
apparatus: `docs/spikes/texel-upload.md`. Item 14's relaxation also casts
doubt on the "drawElementImage only succeeds inside onpaint" note in
`htmlInCanvas.ts` (recorded against Chrome 150) — unverified for
drawElementImage itself in 151.
