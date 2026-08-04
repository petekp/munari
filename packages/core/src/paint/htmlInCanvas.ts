// The DOM→canvas paint source — THE platform file: Chrome's "HTML in
// Canvas" origin trial (Chrome 148–150) turned into a texture-shaped
// API.
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
// Platform claims above are dated empiricism on a moving origin
// trial — re-verify against the current Chrome build before trusting
// them.
//
// This module is the source factory plus its two observation seams:
// the capability probe and the paint-stats registry, each present
// because a consumer proved the need. The probe: a library built
// entirely on an origin-trial API owes its consumer the question "is
// the API here at all?", answered honestly (false, never a throw) in
// any environment. The registry: per-source paint counters are the
// only way to see multi-Surface paint behavior at all — parked source
// canvases all stack at the same fixed position, occluding each
// other, and a source whose `paints` stalls while siblings advance is
// starved. `stats()` is a kernel seam: `[]` after a lifecycle is the
// canonical nothing-left-painting proof, and `paints` deltas are the
// idle-zero gate's raw feed. No `window.__threeUI`-style global
// exists — the kernel stamps nothing on `window`; consumers import
// `paintStats` and hang it wherever their console story wants it.

export interface HtmlInCanvasSupport {
  drawElementImage: boolean
  texElementImage2D: boolean
}

/**
 * Is the HTML-in-canvas trial surface present? Safe to call anywhere —
 * environments without the APIs (or without a DOM at all) report `false`,
 * they never throw. UIs gate their capability chips on this; `Surface`
 * itself does not (an absent API surfaces as a paint error, which
 * `onError` reports with more context than a boolean can).
 */
export function detectHtmlInCanvas(): HtmlInCanvasSupport {
  return {
    drawElementImage:
      typeof CanvasRenderingContext2D !== 'undefined' &&
      'drawElementImage' in CanvasRenderingContext2D.prototype,
    texElementImage2D:
      typeof WebGL2RenderingContext !== 'undefined' &&
      'texElementImage2D' in WebGL2RenderingContext.prototype,
  }
}

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
  /**
   * The live DOM element being rasterized. Mutate it; changes show up.
   * The source owns it — parsed from markup or adopted from the caller —
   * and `dispose()` takes it down with the canvas.
   */
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
   * as they do for `setScale`.
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
  /** Name for this source in the paint-stats registry — the key a
   *  diagnostics/instruments consumer reads it back by. */
  label?: string
  /** Initial texture scale (backing-store px per CSS px). Default 1. */
  scale?: number
  onError?: (err: unknown) => void
}

/** One live source's paint ledger, as `paintStats()` reports it. */
export interface PaintStats {
  label: string
  paints: number
  errors: number
  /** Current LOD texture scale (backing-store px per CSS px). */
  scale: number
  lastError?: string
}

// Every live source registers here; dispose removes it. The registry holds
// the source's OWN ledger objects (paintCount() reads the same `paints`
// field), so there is exactly one counter per source and the two views can
// never disagree.
const registry = new Set<PaintStats>()
let sourceSeq = 0

/**
 * Snapshot of every live source's paint ledger, as copies — mutating a
 * returned entry changes nothing. `[]` means nothing is left painting:
 * after a full lifecycle it is the proof of cleanup, and during idle it is
 * the proof of quiescence (paints deltas at zero are the idle-zero gate's
 * raw feed).
 */
export function paintStats(): PaintStats[] {
  return Array.from(registry, (s) => ({ ...s }))
}

/**
 * Thrown when the host browser has no HTML-in-canvas API at all.
 *
 * The whole library rests on an origin trial, so "the trial is not here" is a
 * first-class answer and deserves a first-class error. Consumers that want to
 * degrade rather than crash should ask `detectHtmlInCanvas()` BEFORE mounting
 * a Surface — by the time this throws, the honest answer was already
 * available and simply never requested.
 */
export class UnsupportedPlatformError extends Error {
  override readonly name = 'UnsupportedPlatformError'
}

/**
 * Mounts `content` as a live DOM subtree inside a hidden layout-canvas and
 * rasterizes it on every repaint() via drawElementImage.
 *
 * `content` is either markup to parse or an **unparented element to adopt**
 * — see `adoptContent` for why adoption refuses anything with a parent.
 *
 * @throws {UnsupportedPlatformError} when the origin trial is absent.
 * @throws {Error} when an element with a parent is handed over.
 */
export function createDomTextureSource(
  content: string | HTMLElement,
  width: number,
  height: number,
  options: DomTextureSourceOptions = {},
): DomTextureSource {
  // Refuse BEFORE building anything. Reaching `canvas.requestPaint()` on a
  // browser without the trial threw a bare "requestPaint is not a function"
  // out of every Surface at once, which unmounted the r3f tree and left a
  // solid black page with no DOM and no message (Chrome 150 without
  // --enable-features=CanvasDrawElement, 2026-08-03). It also appended the
  // parked canvas first, so each failure orphaned one in document.body.
  // Ordering the check ahead of construction fixes both: no half-built
  // source, nothing to clean up, and a sentence the consumer can act on.
  const support = detectHtmlInCanvas()
  if (!support.drawElementImage) {
    throw new UnsupportedPlatformError(
      'anamorph: this browser has no drawElementImage — the HTML-in-canvas ' +
        'API this library is built on. In Chrome, relaunch with ' +
        '--enable-features=CanvasDrawElement (a running Chrome ignores the ' +
        'flag, so quit it fully first). Call detectHtmlInCanvas() before ' +
        'mounting a Surface to branch on this instead of throwing.',
    )
  }

  // Resolve the subtree BEFORE building anything, for the same reason the
  // capability gate is ordered first: a refused source must own no DOM.
  // Parsing markup only touches a detached host div, and adoption only reads
  // `parentNode`, so nothing here is visible to the page if this throws.
  const element = adoptContent(content)

  const { label = `source-${sourceSeq++}`, onError } = options
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

  const stats: PaintStats = { label, paints: 0, errors: 0, scale }
  registry.add(stats)

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
      stats.paints++
    } catch (err) {
      ok = false
      stats.errors++
      stats.lastError = String(err)
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
      stats.scale = next
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
    paintCount: () => stats.paints,
    dispose: () => {
      canvas.onpaint = null
      canvas.remove()
      registry.delete(stats)
    },
  }
}

/**
 * The subtree a source will rasterize: markup gets parsed, an element gets
 * **adopted**.
 *
 * Markup is the convenient door and stays the common one. Adoption exists
 * because some subtrees cannot survive a round trip through `innerHTML` —
 * a plate in an exploded-paint teardown is a `cloneNode` of a live page
 * element, wrapped in padding to defeat the border-box clip (platform.md
 * #9) and carrying an injected neutralizing stylesheet. Serializing that
 * back to a string would throw away everything the consumer just built,
 * and re-parsing it would produce a *different* subtree than the one they
 * measured.
 *
 * **Adoption is one-way, and only an unparented node may cross.**
 * `canvas.appendChild` MOVES a node — it does not copy it. An element that
 * is still in the consumer's page would be silently torn out of it,
 * mid-frame, with their layout reflowing around the hole and no error
 * anywhere to say why. That is precisely the shape of bug this kernel
 * refuses to leave findable-by-debugging: requiring the node to be
 * parentless makes it unwritable instead. A consumer who wants to capture
 * something they are still displaying passes `node.cloneNode(true)`, which
 * is what a plate wanted in the first place.
 *
 * Once adopted the node belongs to the source: it is restyled
 * (`pointer-events`), it is relaid out inside the canvas's box, and
 * `dispose()` removes the canvas with the subtree still inside it.
 */
function adoptContent(content: string | HTMLElement): HTMLElement {
  if (typeof content !== 'string') {
    if (content.parentNode) {
      throw new Error(
        'anamorph: createDomTextureSource adopts only an unparented element — ' +
          'the one handed over is still in a tree. Appending it here would MOVE ' +
          'it out of that tree, not copy it. Pass node.cloneNode(true) instead, ' +
          'or remove the node from its parent first if you meant to give it up.',
      )
    }
    return content
  }
  const host = document.createElement('div')
  host.innerHTML = content
  return (host.firstElementChild ?? host) as HTMLElement
}

// Sane bounds on the raw scale option — a caller error (negative, zero,
// absurdly large) shouldn't produce a degenerate or runaway canvas. Kept
// deliberately distinct from this package's paint/lodTier.ts `clampScale`:
// that one guards a *density* against a css-size-dependent texture-memory
// ceiling; this one just keeps the raw multiplier sane before anything
// has been measured. Named distinctly from that function since both
// live side by side under paint/ and both reach the same barrel.
function clampRawScale(k: number): number {
  return Number.isFinite(k) ? Math.min(8, Math.max(0.1, k)) : 1
}
