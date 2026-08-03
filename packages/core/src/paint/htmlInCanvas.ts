// The DOM→canvas paint source. Ported from three-ui@362c5a1
// src/lib/htmlInCanvas.ts (archive#10, archive#11, archive#16, archive#20,
// archive#22) — THE platform file: Chrome's "HTML in Canvas" origin trial
// (Chrome 148–150) turned into a texture-shaped API.
// https://developer.chrome.com/blog/html-in-canvas-origin-trial
//
// Empirically discovered contract (Chrome 150, --enable-features=CanvasDrawElement):
//   1. The source element must be a CHILD of the canvas you draw into, and the
//      canvas needs `canvas.layoutSubtree = true` so the child gets layout.
//   2. drawElementImage() only succeeds inside the canvas's `onpaint` callback,
//      scheduled via `canvas.requestPaint()`. Outside it you get
//      "No cached paint record for element".
//   3. The draw is DEFERRED to paint time: readback (getImageData/drawImage)
//      returns blank until the next paint completes, then works normally.
//      So a texture upload always trails the DOM by one frame.
//
// Platform claims above are dated empiricism on a moving origin trial —
// untrusted until the Phase 2 re-audit (three-ui/docs/seed/platform-
// reaudit.md); ported here as the mechanism's rationale, not re-verified by
// this flip.
//
// This module intentionally stops at the source factory. The oracle's
// `detectHtmlInCanvas` feature probe and its `window.__threeUI` paint-stats
// registry are devtools/instruments concerns, not contracted here, and are
// left for whoever lands `instruments/`.

interface TrialCanvas extends HTMLCanvasElement {
  layoutSubtree: boolean
  onpaint: (() => void) | null
  requestPaint: () => void
}

interface TrialContext2D extends CanvasRenderingContext2D {
  drawElementImage: (el: Element, x: number, y: number) => unknown
}

export interface DomTextureSource {
  /** The 2D canvas receiving the rasterized DOM — feed this to CanvasTexture. */
  canvas: HTMLCanvasElement
  /** The live DOM element being rasterized. Mutate it; changes show up. */
  element: HTMLElement
  /** Force a repaint request (rarely needed — see paintCount). */
  repaint: () => void
  /** Current texture scale (backing-store px per CSS px). */
  scale: () => number
  /** Current CSS size of the subtree's layout box. */
  size: () => readonly [number, number]
  /**
   * Re-rasterize the subtree at `width×k`/`height×k` backing-store pixels.
   * drawElementImage replays paint records — vector draw commands — so this
   * is a true re-render (sharper glyphs), not an upscale. The canvas's CSS
   * size stays pinned, so the subtree never relayouts and DOM state (focus,
   * caret, selection) is untouched. The repaint rides the normal onpaint
   * path: paintCount advances, so upload-on-paint consumers need no extra
   * plumbing.
   */
  setScale: (k: number) => void
  /**
   * Re-layout the subtree at a new CSS size, moving the canvas's CSS box and
   * its backing store together so the effective raster scale is unchanged.
   * Unlike `setScale` this DOES relayout the subtree — that is the point: a
   * content-fitted Surface hugs whatever the DOM measured. Rides the same
   * onpaint path, so callers holding a texture must mark the realloc exactly
   * as they do for `setScale` (archive#10).
   */
  setSize: (w: number, h: number) => void
  /** True once at least one paint has succeeded. */
  painted: () => boolean
  /**
   * Number of paints that have hit the canvas. The compositor fires onpaint
   * BY ITSELF whenever the subtree's paint record changes — DOM mutations,
   * transitions, paint-property CSS animations, caret blink — so this
   * counter advancing IS the "content changed" signal, and while it's
   * still, the subtree is visually quiescent. (Compositor-side properties
   * — animated opacity/transform — never enter the paint record and are
   * invisible here AND to drawElementImage itself.)
   */
  paintCount: () => number
  dispose: () => void
}

export interface DomTextureSourceOptions {
  /** Human-readable label for this source. The kernel itself does not act
   *  on it — it exists for a diagnostics/instruments consumer to key on. */
  label?: string
  /** Initial texture scale (backing-store px per CSS px). Default 1. */
  scale?: number
  onError?: (err: unknown) => void
}

/**
 * Mounts `markup` as a live DOM subtree inside a hidden layout-canvas and
 * rasterizes it on every repaint() via drawElementImage.
 */
export function createDomTextureSource(
  markup: string,
  width: number,
  height: number,
  options: DomTextureSourceOptions = {},
): DomTextureSource {
  const { onError } = options
  let scale = clampRawScale(options.scale ?? 1)
  const canvas = document.createElement('canvas') as TrialCanvas
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  canvas.layoutSubtree = true
  // Must stay in-document AND on-screen to get paint records — off-screen
  // (left:-10000px) canvases are skipped by the compositor and never paint.
  // Parking it behind the page (z-index:-1) keeps it painted but unseen.
  // CSS size is pinned to the layout size so backing-store changes
  // (setScale) never relayout the subtree — focus/caret/selection survive.
  canvas.style.cssText =
    `position:fixed;left:0;top:0;z-index:-1;pointer-events:none;` +
    `width:${width}px;height:${height}px;`

  const host = document.createElement('div')
  host.innerHTML = markup
  const element = (host.firstElementChild ?? host) as HTMLElement
  // Re-root the pointer-events cascade. The canvas above is `none` so real
  // hit-testing can never wander into a parked subtree — but that value
  // inherits, and the forwarder's own hit test reads the computed one. Left
  // alone, every element in every Surface would read as clear glass and
  // nothing would ever be hittable. A scene that wants a transparent root (a
  // floating layer) overrides this from onSource, which runs after.
  element.style.pointerEvents = 'auto'
  canvas.appendChild(element)
  document.body.appendChild(canvas)

  const ctx = canvas.getContext('2d') as TrialContext2D
  let ok = false
  let paints = 0

  canvas.onpaint = () => {
    try {
      // The replay is auto-scaled by the canvas's backing/CSS ratio, and any
      // CTM multiplies ON TOP of that (measured with position-marker dots:
      // effective = ratio × CTM at every k — platform.md #8). setScale sets
      // the ratio, so the CTM must stay identity here or the scale applies
      // twice (k² — the crop-to-top-left bug). Identity is still asserted
      // per paint because a resize resets context state.
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawElementImage(element, 0, 0)
      ok = true
      paints++
    } catch (err) {
      ok = false
      onError?.(err)
    }
  }
  canvas.requestPaint()

  return {
    canvas,
    element,
    repaint: () => canvas.requestPaint(),
    scale: () => scale,
    size: () => [width, height] as const,
    setScale: (k: number) => {
      const next = clampRawScale(k)
      if (next === scale) return
      scale = next
      // Resizing clears the backing store, but nothing uploads the blank:
      // consumers only upload after paintCount advances, which happens when
      // the requested paint below completes with the fresh raster.
      canvas.width = Math.max(1, Math.round(width * next))
      canvas.height = Math.max(1, Math.round(height * next))
      canvas.requestPaint()
    },
    // Note `width = w` / `height = h`: the parameters are the closed-over
    // source of truth that setScale multiplies, so a resize that fails to
    // move them is silently undone by the very next LOD tier swap (measured
    // — the canvas snapped back to its birth size while its CSS box stayed
    // put, and the two stayed diverged for good).
    setSize: (w: number, h: number) => {
      const nw = Math.max(1, Math.round(w))
      const nh = Math.max(1, Math.round(h))
      if (nw === width && nh === height) return
      width = nw
      height = nh
      canvas.style.width = `${nw}px`
      canvas.style.height = `${nh}px`
      canvas.width = Math.max(1, Math.round(nw * scale))
      canvas.height = Math.max(1, Math.round(nh * scale))
      canvas.requestPaint()
    },
    painted: () => ok,
    paintCount: () => paints,
    dispose: () => {
      canvas.onpaint = null
      canvas.remove()
    },
  }
}

// Sane bounds on the raw scale option — a caller error (negative, zero,
// absurdly large) shouldn't produce a degenerate or runaway canvas. Kept
// deliberately distinct from this package's paint/lodTier.ts `clampScale`:
// that one guards a *density* against a css-size-dependent texture-memory
// ceiling (archive#35); this one just keeps the raw multiplier sane before
// anything has been measured. Same name in the oracle (two different files
// in a flat src/lib/); renamed here since both now live side by side under
// paint/ and both reach the same barrel.
function clampRawScale(k: number): number {
  return Number.isFinite(k) ? Math.min(8, Math.max(0.1, k)) : 1
}
