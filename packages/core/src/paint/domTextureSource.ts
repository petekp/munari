// The DOM texture source — the contract every capture engine implements,
// and the parts none of them differ on.
//
// The law: a capture engine turns a live DOM subtree into pixels in a
// canvas and parks the subtree somewhere the browser lays it out. Those
// two things are all that vary. Adoption, the paint ledger, the receipt
// shape, the backing-store arithmetic and the size/scale API are the same
// whichever engine ran, so they live here and both sources are built on
// them.
//
// The fault that made this one module rather than two copies, 2026-09-10:
// the disposable snapDOM rig duplicated `recut`'s carry-forward, the
// receipt generation counter and the stats ledger. Each copy drifted in a
// different direction — one carried the old raster forward and one did
// not, so a resize under one engine kept its pixels and under the other
// flashed empty, with nothing in either file to say which was the law.
// A law with two homes is a law nobody can revise.
//
// Ownership: this module owns the canvas, the ledger and the arithmetic.
// An engine owns how pixels arrive and where the subtree is parked.

import { storeForBox } from './textureStorage'
import { allocateSourceId } from './sourceIdentity'
import type { FrameId } from './frameSource'

// ── the contract ─────────────────────────────────────────────────────────

export interface DomPaintReceipt {
  readonly frame: FrameId
  readonly paintedSize: readonly [number, number]
  readonly storeSize: readonly [number, number]
  /**
   * Change signals that landed while this raster was being made.
   *
   * Zero on a synchronous engine, where the browser rasterizes inside the
   * frame that asked. An asynchronous engine takes milliseconds to answer,
   * and anything the subtree did in that window is not in these pixels —
   * so a consumer blending a capture against live DOM can see how stale
   * the capture already was when it landed, rather than inferring it from
   * wall-clock time that says nothing about whether anything moved.
   */
  readonly changesDuringPaint: number
}

/**
 * One live DOM subtree, its pixels, and the node the engine parks it in.
 *
 * Every field here is engine-neutral. Nothing above this contract asks
 * which engine produced a source: the binding reads `host` to place the
 * parked node and `canvas` to make a texture, and that is the whole seam.
 */
export interface DomTextureSource {
  /** Stable identity shared with frame-backed sources. */
  readonly sourceId: number
  /** The 2D canvas receiving the rasterized DOM — feed this to CanvasTexture. */
  canvas: HTMLCanvasElement
  /**
   * The element the engine parks the content in — the node that wears the
   * presented pose, takes the page clip, and is docked next to the page
   * slot. The HTML-in-canvas engine parks the subtree INSIDE its canvas,
   * so there `host === canvas`; an engine that rasterizes a copy parks the
   * subtree in a plain container and its canvas is only pixel storage.
   *
   * The binding addresses this node and never the canvas, because the six
   * places that place a parked node have no other way to tell the two
   * apart — and a ride applied to a canvas that parks nothing moves pixels
   * the browser is not hit-testing, which looks correct and takes no input.
   */
  readonly host: HTMLElement
  /**
   * The live DOM element being rasterized. Mutate it; changes show up.
   * The source owns it — parsed from markup or adopted from the caller —
   * and `dispose()` takes it down with the host.
   */
  element: HTMLElement
  /**
   * Show or hide the host's own pixels, without disturbing layout, hit
   * testing, or capture.
   *
   * Which CSS property does that is the engine's business and nothing
   * else's: a canvas must use `visibility`, because an `opacity: 0` canvas
   * captures blank (platform.md #20); a container holding live DOM must
   * use `opacity`, because `visibility: hidden` would hide the subtree it
   * is parking. A source is born hidden — pixels a consumer did not ask
   * for landing at the viewport origin is a fault with no error attached.
   */
  setHostPainted: (painted: boolean) => void
  /** Force a repaint request (rarely needed — see paintCount). */
  repaint: () => void
  /**
   * Change whether the source follows what the content does on its own —
   * see `DomTextureSourceOptions.live`. Switching it on captures the state
   * the source stopped following at, so the picture is current from the
   * moment the flag is. An engine that follows everything for free ignores
   * it.
   */
  setLive: (live: boolean) => void
  /**
   * Treat the user's input on `root` as input on the content.
   *
   * A consumer that mirrors a page element into this source by hand — the
   * retained Surface keeps a copy of its page content current while the
   * page holds — has the user acting on a node the source's own element
   * never hears. Naming that node keeps the mirror's answer to the input
   * followed, exactly as a change on the element itself would be. Returns
   * the unlisten. An engine that follows everything for free ignores it.
   */
  hearInput: (root: HTMLElement) => () => void
  /**
   * The texture scale that was ASKED for, in backing-store px per CSS px.
   * The density actually delivered is `canvas.width / size()[0]`, which is
   * allowed to drift inside a band while the box is moving (`storeForBox`)
   * and is cut back to this on `resettle`. The ladder reasons about the
   * request; the canvas carries the drift.
   */
  scale: () => number
  /** Requested raster density on each axis; scale() is their maximum. */
  rasterScale: () => readonly [number, number]
  /** Current CSS size of the subtree's layout box. */
  size: () => readonly [number, number]
  /**
   * The CSS box (width, height) the subtree was laid out at when the last
   * COMPLETED paint replayed it — `[0, 0]` before any paint has succeeded.
   * Read at completion time, not at `setSize` time, and that ordering is
   * the whole point: `size()` reports the box a consumer just asked for,
   * this reports the box the delivered raster actually holds, and the gap
   * between the two IS the capture pipeline's lag (React state ->
   * `source.setSize` -> a paint request -> the engine's answer -> GL
   * upload). A consumer that blends the raster against live DOM has to know
   * the raster's own generation for exactly this reason. Blending a copy
   * from one layout generation over a page from a newer one reads as doubled
   * content, not as a soft mismatch —
   * observed as resize ghosting on 2026-08-08.
   */
  paintedSize: () => readonly [number, number]
  /** The last successful immutable paint receipt, or null before success. */
  currentPaint: () => DomPaintReceipt | null
  /** Subscribe to successful paints. Failed paints do not notify. */
  subscribePaint: (listener: (receipt: DomPaintReceipt) => void) => () => void
  /**
   * Re-rasterize the subtree at `width×k`/`height×k` backing-store pixels.
   * This is a true re-render at the new density (sharper glyphs), not an
   * upscale. The host's CSS size stays pinned, so the subtree never
   * relayouts and DOM state (focus, caret, selection) is untouched. The
   * repaint rides the normal completion path: paintCount advances, so
   * upload-on-paint consumers need no extra plumbing.
   */
  setScale: (k: number) => void
  setRasterScale: (x: number, y: number) => void
  /**
   * Re-layout the subtree at a new CSS size, moving the host's CSS box and
   * the backing store together so the effective raster scale is unchanged.
   * Unlike `setScale` this DOES relayout the subtree — that is the point: a
   * content-fitted Surface hugs whatever the DOM measured. Rides the same
   * completion path. Callers holding a GL texture must reallocate its storage
   * when the backing store moves — including here, and including a Surface
   * that resizes every frame, which is why the answer is a comparison at
   * upload time (`uploadNeedsRealloc`) rather than a mark taken here.
   */
  setSize: (w: number, h: number) => void
  /**
   * Re-cut the backing store to EXACTLY the current box and density,
   * ignoring the band `setSize` is allowed to drift inside.
   *
   * The band exists to keep a moving Surface's pixels alive across a resize;
   * it has no business surviving into rest, where a Surface can be left up to
   * 40% under-supplied with nothing to knock it back out of tolerance.
   * Callers settle a Surface once its box stops moving — motion is
   * approximate, rest is exact.
   */
  resettle: () => void
  /** True once at least one paint has succeeded. */
  painted: () => boolean
  /**
   * Number of completed paints. A source requests no paint without a change
   * signal, and every completed paint advances this counter — so while it is
   * still, the subtree is visually quiescent, and the idle-zero gate reads
   * exactly that.
   *
   * What differs by engine is which changes signal. The compositor fires by
   * itself for anything that enters a paint record — DOM mutations,
   * transitions, paint-property animations, caret blink — and is blind to
   * compositor-side properties (animated opacity/transform) which are
   * invisible to `drawElementImage` too. An engine driven by observers sees
   * a different set: it needs no signal for a compositor-only animation
   * (which it would otherwise capture forever) and has none for a CSSOM
   * edit (which `repaint()` is the escape hatch for).
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
  /**
   * Does the texture follow what the content does ON ITS OWN — a subtree
   * that animates, a ticker, a canvas redrawn from a clock?
   *
   * Every engine follows the user's input on the content, a layout resize,
   * a webfont or image landing, a transition or animation reaching its
   * ends, and an explicit `repaint()`. Whether it also follows a change
   * nobody asked for is the one thing an engine that pays tens of
   * milliseconds per capture cannot afford by default (decisions.md #60):
   * two self-animating subtrees took a scene from 60 fps to 51. Such an
   * engine leaves the picture as it was until told the content is `live`,
   * and then follows it at its own pace. The HTML-in-canvas engine follows
   * everything for free and ignores the flag. Default `false`.
   */
  live?: boolean
  /** Paint failures, normalized to an Error at the catch that produced
   *  them — so a consumer always has a message and a stack, whatever the
   *  platform threw. */
  onError?: (err: Error) => void
}

/**
 * Thrown when no installed capture engine can make a source here.
 *
 * The default engine rests on an origin trial, so "the trial is not here"
 * is a first-class answer and deserves a first-class error. Consumers that
 * want to degrade rather than crash should ask `supportsSurfaces()` (or
 * `captureEngine().available()`) BEFORE mounting a Surface — by the time
 * this throws, the honest answer was already available and simply never
 * requested.
 */
/**
 * Marks every engine's parked host, so a page-wide capture can leave it out.
 *
 * The parked node sits in `document.body` at the viewport origin holding a
 * live copy of a Surface's DOM. A `useElementCapture` of `document.body`
 * would otherwise copy it into its own snapshot — the Surface's content
 * appearing a second time, stacked at the corner of the page. The native
 * engine parks a `<canvas>`, which element capture already refuses on its
 * own; an engine that parks a plain container needs the marker to be
 * refused for the same reason.
 */
export const PARKED_HOST_ATTRIBUTE = 'data-munari-parked'

export class UnsupportedPlatformError extends Error {
  override readonly name = 'UnsupportedPlatformError'
}

// ── the paint-stats registry ─────────────────────────────────────────────

/** One live source's paint ledger, as `paintStats()` reports it. */
export interface PaintStats {
  label: string
  paints: number
  errors: number
  /** Current LOD texture scale (backing-store px per CSS px). */
  scale: number
  /** The engine that produced these paints. */
  engine: string
  lastError?: string
}

// Every live source registers here; dispose removes it. The registry holds
// the source's OWN ledger objects (paintCount() reads the same `paints`
// field), so there is exactly one counter per source and the two views can
// never disagree.
//
// Per-source paint counters are the only way to see multi-Surface paint
// behavior at all — parked hosts all stack at the same fixed position,
// occluding each other, and a source whose `paints` stalls while siblings
// advance is starved. `stats()` is a kernel seam: `[]` after a lifecycle is
// the canonical nothing-left-painting proof, and `paints` deltas are the
// idle-zero gate's raw feed. No `window.__threeUI`-style global exists —
// the kernel stamps nothing on `window`; consumers import `paintStats` and
// hang it wherever their console story wants it.
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

/** How many sources are alive — the dev warning for a late engine swap. */
export function liveSourceCount(): number {
  return registry.size
}

// ── adoption ─────────────────────────────────────────────────────────────

/**
 * The subtree a source will rasterize: markup gets parsed, an element gets
 * **adopted**.
 *
 * Markup is the convenient door and stays the common one. Adoption exists
 * because some subtrees cannot survive a round trip through `innerHTML`.
 * A detached tree can contain cloned elements, padding that avoids the
 * border-box clip (platform.md #9), and injected styles. Serializing it would
 * throw away the constructed tree, and parsing it again would create a
 * different tree than the one the consumer measured.
 *
 * **Adoption is one-way, and only an unparented node may cross.**
 * `host.appendChild` MOVES a node — it does not copy it. An element that
 * is still in the consumer's page would be silently torn out of it,
 * mid-frame, with their layout reflowing around the hole and no error
 * anywhere to say why. That is precisely the shape of bug this kernel
 * refuses to leave findable-by-debugging: requiring the node to be
 * parentless makes it unwritable instead. A consumer who wants to capture
 * something they are still displaying passes `node.cloneNode(true)`.
 *
 * Once adopted the node belongs to the source: it is restyled
 * (`pointer-events`, `visibility`), it is relaid out inside the host's box,
 * and `dispose()` removes the host with the subtree still inside it.
 */
export function adoptContent(content: string | HTMLElement): HTMLElement {
  if (content instanceof HTMLElement) {
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
  const first = host.firstElementChild
  return first instanceof HTMLElement ? first : host
}

// Sane bounds on the raw scale option — a caller error (negative, zero,
// absurdly large) shouldn't produce a degenerate or runaway canvas. Kept
// deliberately distinct from this package's paint/lodTier.ts `clampScale`:
// that one guards a *density* against a css-size-dependent texture-memory
// ceiling; this one just keeps the raw multiplier sane before anything
// has been measured. Named distinctly from that function since both
// live side by side under paint/ and both reach the same barrel.
export function clampRawScale(k: number): number {
  return Number.isFinite(k) ? Math.min(8, Math.max(0.1, k)) : 1
}

// ── the shared source body ───────────────────────────────────────────────

/** The canvas, the ledger and the arithmetic every engine's source shares. */
export interface CaptureCanvas {
  readonly sourceId: number
  readonly canvas: HTMLCanvasElement
  readonly element: HTMLElement
  size: () => readonly [number, number]
  scale: () => number
  rasterScale: () => readonly [number, number]
  paintedSize: () => readonly [number, number]
  currentPaint: () => DomPaintReceipt | null
  subscribePaint: (listener: (receipt: DomPaintReceipt) => void) => () => void
  painted: () => boolean
  paintCount: () => number
  /** Move the CSS box. Returns false when the size did not actually change. */
  setSize: (w: number, h: number) => boolean
  /** Move the requested density. Returns false when it did not change. */
  setRasterScale: (x: number, y: number) => boolean
  /**
   * Set both axes to a density the caller named. Same arithmetic as
   * `setRasterScale`, different reason: see `PaintReason`.
   */
  setScale: (k: number) => boolean
  /** Re-cut the store for the current box and density, exactly. */
  resettle: () => void
  /**
   * Record a completed paint: advance the ledger and publish a receipt.
   *
   * `paintedSize` is the CSS box this raster actually holds, which is the
   * box that was live when the engine STARTED — not when it finished. On a
   * synchronous engine those are the same instant; on an asynchronous one
   * the box can have moved twice in between, and a receipt naming the
   * current box would claim pixels that do not exist.
   */
  completePaint: (
    paintedSize: readonly [number, number],
    changesDuringPaint: number,
  ) => DomPaintReceipt
  /** Record a failed paint: count it and report through `onError`, once. */
  failPaint: (cause: unknown) => void
  dispose: () => void
}

/**
 * Why the body is asking for a paint.
 *
 * An engine whose captures are cheap can ignore this and repaint on all
 * four. One whose captures cost tens of milliseconds cannot, and the four
 * are not equally affordable:
 *
 * - `box` — a layout resize. The subtree relaid out, so carried pixels are
 *   the wrong content.
 * - `lod` — the ladder moved the supply while a Surface moves. Fires every
 *   frame; the carry in `recut` reproduces it, because the same element box
 *   at a different store size is exactly the error the band exists to spend.
 * - `density` — a caller NAMED a density (`setScale`). Always exact, never
 *   the band (decisions.md #44): the caller said how many texels it wants,
 *   and a scene that names one at a phase boundary is asking to arrive at
 *   that density, not to arrive at the last one resampled.
 * - `rest` — the settle, cutting the store exact.
 *
 * `lod` is the only one worth skipping and the only one safe to skip.
 */
export type PaintReason = 'box' | 'lod' | 'density' | 'rest'

export interface CaptureCanvasOptions extends DomTextureSourceOptions {
  /** The engine's name, for the stats ledger. */
  engine: string
  /**
   * Ask the engine for a paint. Called whenever the box or the store moved,
   * so an engine never has to notice a re-cut for itself.
   */
  requestPaint: (reason: PaintReason) => void
}

export function createCaptureCanvas(
  element: HTMLElement,
  width: number,
  height: number,
  options: CaptureCanvasOptions,
): CaptureCanvas {
  const sourceId = allocateSourceId()
  const { label = `source-${sourceSeq++}`, engine, onError, requestPaint } = options
  let scale = clampRawScale(options.scale ?? 1)
  let scaleX = scale
  let scaleY = scale

  const canvas = document.createElement('canvas')
  const born = storeForBox(width, height, scale, null)
  canvas.width = born.width
  canvas.height = born.height

  let ok = false
  let currentPaint: DomPaintReceipt | null = null
  const paintSubscribers = new Set<(receipt: DomPaintReceipt) => void>()
  const stats: PaintStats = { label, paints: 0, errors: 0, scale, engine }
  registry.add(stats)

  // The only place the backing store is allowed to move. Everything else —
  // a layout resize or density change — asks for a paint here. Layout resizes
  // use the density band; a new requested density supplies an exact store (#44).
  //
  // Writing `canvas.width` CLEARS the store, and the paint that refills it is
  // the engine's to deliver: it lands after the frame that asked. So a
  // re-cut always hands the old raster forward, stretched from the old store
  // to the new one. Both hold the same element box, so the stretch is exactly
  // the density change and nothing else — one frame of slightly-wrong
  // sharpness instead of one frame of nothing. (Copying through a scratch
  // canvas because a canvas cannot be drawn into itself across a resize: the
  // resize is what destroys the pixels being copied.)
  const recut = (exact: boolean, reason: PaintReason) => {
    const next = storeForBox(
      width * scaleX,
      height * scaleY,
      1,
      exact ? null : { width: canvas.width, height: canvas.height },
    )
    if (next.width !== canvas.width || next.height !== canvas.height) {
      let keep: HTMLCanvasElement | null = null
      // Carrying the raster forward is a picture, not a contract: under a DOM
      // stub with no rasterizer (happy-dom, where the conformance suite runs)
      // there are no pixels to save and no blitter to save them with. Skip it
      // there rather than make every caller carry a mock.
      const ctx = canvas.getContext('2d')
      if (ok && ctx && 'drawImage' in ctx) {
        const scratch = document.createElement('canvas')
        scratch.width = canvas.width
        scratch.height = canvas.height
        const kctx = scratch.getContext('2d')
        if (kctx && 'drawImage' in kctx) {
          kctx.drawImage(canvas, 0, 0)
          keep = scratch
        }
      }
      canvas.width = next.width
      canvas.height = next.height
      if (keep && ctx && 'drawImage' in ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.drawImage(keep, 0, 0, keep.width, keep.height, 0, 0, next.width, next.height)
      }
    }
    requestPaint(reason)
  }

  const setDensity = (x: number, y: number, reason: PaintReason) => {
    const nx = clampRawScale(x)
    const ny = clampRawScale(y)
    if (nx === scaleX && ny === scaleY) return false
    scaleX = nx
    scaleY = ny
    scale = Math.max(nx, ny)
    stats.scale = scale
    recut(true, reason)
    return true
  }

  return {
    sourceId,
    canvas,
    element,
    size: () => [width, height] as const,
    scale: () => scale,
    rasterScale: () => [scaleX, scaleY] as const,
    paintedSize: () => currentPaint?.paintedSize ?? ([0, 0] as const),
    currentPaint: () => currentPaint,
    painted: () => ok,
    paintCount: () => stats.paints,
    subscribePaint: (listener) => {
      paintSubscribers.add(listener)
      let subscribed = true
      return () => {
        if (!subscribed) return
        subscribed = false
        paintSubscribers.delete(listener)
      }
    },
    // Note `width = w` / `height = h`: the parameters are the closed-over
    // source of truth that setScale multiplies, so a resize that fails to
    // move them is silently undone by the very next LOD tier swap (measured
    // — the canvas snapped back to its birth size while its CSS box stayed
    // put, and the two stayed diverged for good).
    setSize: (w, h) => {
      const nw = Math.max(1, Math.round(w))
      const nh = Math.max(1, Math.round(h))
      if (nw === width && nh === height) return false
      width = nw
      height = nh
      recut(false, 'box')
      return true
    },
    setRasterScale: (x, y) => setDensity(x, y, 'lod'),
    setScale: (k) => setDensity(k, k, 'density'),
    resettle: () => recut(true, 'rest'),
    completePaint: (paintedSize, changesDuringPaint) => {
      ok = true
      stats.paints++
      // A success ends the run this message was suppressed over, so the same
      // failure returning later is reported again rather than swallowed.
      stats.lastError = undefined
      const generation = (currentPaint?.frame.generation ?? 0) + 1
      const receipt: DomPaintReceipt = Object.freeze({
        frame: Object.freeze({ sourceId, generation }),
        paintedSize: Object.freeze([paintedSize[0], paintedSize[1]] as const),
        storeSize: Object.freeze([canvas.width, canvas.height] as const),
        changesDuringPaint,
      })
      currentPaint = receipt
      for (const listener of paintSubscribers) listener(receipt)
      return receipt
    },
    failPaint: (cause) => {
      ok = false
      stats.errors++
      const message = String(cause)
      const repeat = message === stats.lastError
      stats.lastError = message
      // The catch IS the boundary: whatever the platform threw becomes an
      // Error here, once, so no consumer has to re-derive the shape.
      //
      // Once per distinct message, not once per failure. One unreachable
      // cross-origin image fails every capture an asynchronous engine makes,
      // which is a console line per frame for as long as the Surface is
      // mounted — the same sentence often enough to bury the next real one.
      // The counter in `paintStats()` still shows every failure.
      if (!repeat) onError?.(cause instanceof Error ? cause : new Error(message))
    },
    dispose: () => {
      paintSubscribers.clear()
      registry.delete(stats)
    },
  }
}
