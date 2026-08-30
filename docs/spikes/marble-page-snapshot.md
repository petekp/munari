# Full-page snapshot check — 2026-08-30

Question: can a standard-browser snapshot include the real catalogue heading
and its webfonts, and is a repeated snapshot fast enough to remain useful?

The disposable probe used the real Marble Hand route in plain Chrome and
`html-to-image` 1.11.13, installed only in a temporary directory.

- First snapshot: 75.5 ms.
- Repeated snapshots: 37.2–38.3 ms.
- Ten embedded font faces, 261,200 bytes, including Bodoni.
- Removing the heading changed 18,160 snapshot pixels.
- Canvas readback remained origin-clean.
- The font loader emitted cross-origin stylesheet warnings.

The fallback was viable with those caveats. It was not selected: the user
chose an external Chrome instance with HTML-in-canvas enabled, so the demo
uses Munari's native full-page capture while the visible HTML stays native.

The prototype, temporary package, browser and server were removed. No probe
code was promoted and no snapshot dependency was added to the workspace.
