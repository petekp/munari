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

import { storeForBox } from './textureStorage'

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
  /**
   * The texture scale that was ASKED for, in backing-store px per CSS px.
   * The density actually delivered is `canvas.width / size()[0]`, which is
   * allowed to drift inside a band while the box is moving (`storeForBox`)
   * and is cut back to this on `resettle`. The ladder reasons about the
   * request; the canvas carries the drift.
   */
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
   * onpaint path. Callers holding a GL texture must reallocate its storage
   * when the backing store moves — including here, and including a Surface
   * that resizes every frame, which is why the answer is a comparison at
   * upload time (`uploadNeedsRealloc`) rather than a mark taken here.
   */
  setSize: (w: number, h: number) => void
  /**
   * Re-cut the backing store to EXACTLY the current box and density,
   * ignoring the band `setSize`/`setScale` are allowed to drift inside.
   *
   * The band exists to keep a moving Surface's pixels alive across a resize;
   * it has no business surviving into rest, where a card can be left up to
   * 40% under-supplied with nothing to knock it back out of tolerance.
   * Callers settle a Surface once its box stops moving — motion is
   * approximate, rest is exact.
   */
  resettle: () => void
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
      'munari: this browser has no drawElementImage — the HTML-in-canvas ' +
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
  const born = storeForBox(width, height, scale, null)
  canvas.width = born.width
  canvas.height = born.height
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
      // effective = ratio × CTM at every k — platform.md #8). The ratio IS
      // the raster density, so the CTM must stay identity here or the scale
      // applies twice (k² — the crop-to-top-left bug). Identity is still
      // asserted per paint because a resize resets context state.
      //
      // This is also why the store may sit at a size the box did not ask for
      // (`storeForBox`): the element is replayed to FILL whatever store it
      // finds, so a store held across a resize simply rasters the new layout
      // at a slightly different density. The box is exact; the texels float.
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
  // The only place the backing store is allowed to move. Everything else —
  // a resize, a scale change — moves the CSS box and asks for a paint; the
  // store follows only when the density it supplies has drifted out of the
  // band (see `storeForBox`).
  //
  // Writing `canvas.width` CLEARS the store, and the paint that refills it is
  // the compositor's to schedule: it lands after the frame that asked. So a
  // re-cut always hands the old raster forward, stretched from the old store
  // to the new one. Both hold the same element box, so the stretch is exactly
  // the density change and nothing else — one frame of slightly-wrong
  // sharpness instead of one frame of nothing. (Copying through a scratch
  // canvas because a canvas cannot be drawn into itself across a resize: the
  // resize is what destroys the pixels being copied.)
  const recut = (exact = false) => {
    const next = storeForBox(
      width,
      height,
      scale,
      exact ? null : { width: canvas.width, height: canvas.height },
    )
    if (next.width !== canvas.width || next.height !== canvas.height) {
      let keep: HTMLCanvasElement | null = null
      // Carrying the raster forward is a picture, not a contract: under a DOM
      // stub with no rasterizer (happy-dom, where the conformance suite runs)
      // there are no pixels to save and no blitter to save them with. Skip it
      // there rather than make every caller carry a mock.
      if (ok && typeof ctx.drawImage === 'function') {
        const scratch = document.createElement('canvas')
        scratch.width = canvas.width
        scratch.height = canvas.height
        const kctx = scratch.getContext('2d')
        if (kctx && typeof kctx.drawImage === 'function') {
          kctx.drawImage(canvas, 0, 0)
          keep = scratch
        }
      }
      canvas.width = next.width
      canvas.height = next.height
      if (keep) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.drawImage(keep, 0, 0, keep.width, keep.height, 0, 0, next.width, next.height)
      }
    }
    canvas.requestPaint()
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
      recut()
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
      recut()
    },
    resettle: () => recut(true),
    painted: () => ok,
    paintCount: () => stats.paints,
    dispose: () => {
      canvas.onpaint = null
      canvas.remove()
      // Release the subtree. Custody was for the source's lifetime, and
      // adoption required the node to arrive unparented — so it leaves that
      // way, making adopt/dispose exactly invertible. Two things depend on
      // it: a React remount (StrictMode mounts, cleans up, mounts again)
      // re-adopts the same node and would otherwise be refused for being
      // parented to the canvas that just died; and a consumer holding a node
      // would hold its dead canvas through the parent pointer, leaking one
      // parked canvas per disposed plate.
      element.remove()
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
        'munari: createDomTextureSource adopts only an unparented element — ' +
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
