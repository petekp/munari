# The platform, as measured

These are dated measurements of the platform under each capture engine.
Items 1–21, 32, 33, 36 and 37 measure Chrome's HTML-in-canvas capability: the
library's default capture path uses `drawElementImage`; items 14–16 measure
`texElementImage2D`, an alternative that Chrome 158 removed. Items 22–31 measure
snapDOM, the optional second engine. Item 34 measures both engines. Recheck
the relevant measurements when changing browser versions or the mechanism that
depends on them.

The items are split by topic into the files below. Each file holds one table
with the columns `#`, "What the platform does" and "Evidence". The claim
opens with its finding in bold and ends with its measurement date and builds
in parentheses. The evidence gives the numbers and the instrument or spike
note that produced them. Notes that read several items together follow the
table. Each row's number carries an `item-N` anchor, so
`platform/capture.md#item-12` links to one item.

Item numbers are permanent. Code and docs cite items as `platform.md #N` or
`platform.md item N`, and the list below finds each one. Add a new item to its
topic's file with the next free number, and add it to the list.

## Files

- [HTML-in-canvas capture](platform/capture.md): items 1–12, 17, 32 and 37, and the baseline conditions of items 1–12.
- [`texElementImage2D`](platform/texture-upload.md): items 14–16.
- [Hit-testing and geometry of canvas children](platform/hit-testing.md): items 18–21, 33 and 36.
- [snapDOM](platform/snapdom.md): items 22–28 and 34.
- [Safari and WebKit](platform/webkit.md): items 29–31.
- [Chrome faults](platform/chrome-faults.md): items 13 and 35.

## Items

- [1](platform/capture.md#item-1). The capability APIs are present under the flag; Chrome 158 has `texElementSubImage2D`
- [2](platform/capture.md#item-2). The compositor self-paints on DOM mutation
- [3](platform/capture.md#item-3). A mutation resolves into the captured buffer, one self-paint each
- [4](platform/capture.md#item-4). Compositor-animated root opacity can leave a stale capture
- [5](platform/capture.md#item-5). Idle sources are free; throughput with 96 painting sources
- [6](platform/capture.md#item-6). Rescaling paints once per LOD tier crossed, and a focused field keeps its caret and value
- [7](platform/capture.md#item-7). A `mask-image` on any descendant blacks out the whole capture
- [8](platform/capture.md#item-8). Replay is position-aware: a capture at scale k lands at k× position and size
- [9](platform/capture.md#item-9). The capture is clipped to the drawn element's border box
- [10](platform/capture.md#item-10). Only immediate children of the canvas can be drawn
- [11](platform/capture.md#item-11). `@container` resolves against the parked subtree's own box; `@media` does not
- [12](platform/capture.md#item-12). A backing-store write clears the canvas, and the refill lands a frame late
- [13](platform/chrome-faults.md#item-13). The DevTools screencast goes dark for about 250ms after a return handoff
- [14](platform/texture-upload.md#item-14). `texElementImage2D` has `drawElementImage`'s contract, with one relaxation
- [15](platform/texture-upload.md#item-15). `texElementImage2D` rasters at the canvas's backing/CSS ratio
- [16](platform/texture-upload.md#item-16). `texElementImage2D` uploads straight alpha by default
- [17](platform/capture.md#item-17). `onpaint`'s `changedElements` names exactly the changed children
- [18](platform/hit-testing.md#item-18). Canvas children are hit-testable but never painted, and the hit region is clipped to the canvas
- [19](platform/hit-testing.md#item-19). Hit-testing of a matrix3d child agrees with GL rasterization within 1.25px
- [20](platform/hit-testing.md#item-20). Capture asymmetries of the drawn root: transform, opacity and visibility
- [21](platform/hit-testing.md#item-21). Hit-testing clips to the canvas's transformed box, and canvas transforms are paint-free
- [22](platform/snapdom.md#item-22). snapDOM freezes a compositor-only animation; HTML-in-canvas captures it live
- [23](platform/snapdom.md#item-23). snapDOM reproduces flat fills exactly, and a real page to within glyph antialiasing
- [24](platform/snapdom.md#item-24). snapDOM drops a form field's `::after` and `::placeholder`
- [25](platform/snapdom.md#item-25). snapDOM's `width`/`height` stretch the element; `drawElementImage` keeps the canvas's ratio
- [26](platform/snapdom.md#item-26). A snapDOM capture can place a block 2px off, even with `reconcile: true`
- [27](platform/snapdom.md#item-27). A drag re-captures for reasons that are not content
- [28](platform/snapdom.md#item-28). An SVG image lays out its HTML at one device pixel per CSS pixel
- [29](platform/webkit.md#item-29). WebKit lacks `moveBefore`, returns undefined `overflowClipMargin`, and throws on an unknown ResizeObserver box
- [30](platform/webkit.md#item-30). snapDOM's `toCanvas` resamples in WebKit; drawing its SVG directly does not
- [31](platform/webkit.md#item-31). Safari's frame-rate ceiling, and snapDOM's WebKit font pass
- [32](platform/capture.md#item-32). Native capture needs the canvas opt-in and a drawable source root
- [33](platform/hit-testing.md#item-33). Chrome 154–156 hit-test canvas children only after `updateElementGeometry`
- [34](platform/snapdom.md#item-34). Neither engine taints its canvas; cross-origin content is left out
- [35](platform/chrome-faults.md#item-35). Chrome's renderer crashes on `moveBefore` of fixed elements into a size container with a new `@font-face`
- [36](platform/hit-testing.md#item-36). On Chrome 157 and 158, a drawn child's `getBoundingClientRect` can be one float32 step off
- [37](platform/capture.md#item-37). Chrome 157 exposes `drawElementImage` with no flag
