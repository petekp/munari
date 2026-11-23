# Spike: Chrome 157 exposes drawElementImage with no flag

Measured 2026-11-23 on Google Chrome 157.0.8103.80 (macOS, headless, fresh
profile, no `--enable-features`, no origin trial token). The page was a
disposable puppeteer-core script; the script is deleted and this report is the
artifact. It checks the README's statement that Chrome 157 needs no flag.

**Page:** `<canvas layoutsubtree content="drawable">` holding a 100×50 red
`div` with the `drawable` attribute.

**Result:**

- `'drawElementImage' in CanvasRenderingContext2D.prototype` was `true`.
- After the first paint, `drawElementImage(div, 0, 0)` left `[255, 0, 0, 255]`
  at pixel (10, 10).
- `'layoutSubtree' in HTMLCanvasElement.prototype` was `false`; the attribute
  form worked (platform.md #32).

**Limits:** one page load on one build. Later releases, headed windows and
other platforms are not measured. `texElementImage2D` was not drawn with.
