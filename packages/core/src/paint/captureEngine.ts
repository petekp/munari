// The capture engine — which machinery turns a DOM subtree into pixels,
// and the one place a source is built from it.
//
// The law: exactly one engine is installed per document, chosen at the app
// entry, and nothing above `createDomTextureSource` ever learns which one
// ran. Holds, handoffs, provenance, LOD, materials, anchors and the pointer
// relay read `host` and `native` — both engine properties — and nothing
// else. An `if (engine === …)` above this seam is the thing this module
// exists to make unnecessary.
//
// Why a setter and not a registry: two engines is a list of two. A registry
// with preference order and store subscriptions needs new plumbing in the
// Surface store, in the support hook, and in the runtime creation effect,
// plus tests for registration order — to answer a question that has one
// answer per app. The fallback rule lives in the engine package's own
// `enable…()` helper, where a consumer can read it.
//
// Why app-level and not a Surface prop: two engines in one document doubles
// the parking and hit-testing variants, and an app that wants both is an app
// comparing them, which the URL is a better door for than the component tree.
//
// Ownership: this module owns which engine is installed and the refusal
// when none can run here. Each engine owns its own source.

import { htmlInCanvasEngine } from './htmlInCanvas'
import {
  liveSourceCount,
  UnsupportedPlatformError,
  type DomTextureSource,
  type DomTextureSourceOptions,
} from './domTextureSource'

/**
 * One way of turning a live DOM subtree into a texture.
 *
 * An engine is a plain object, installed once. Everything a consumer of a
 * source needs to know about the difference between engines is on the
 * source itself (`host`, `setHostPainted`) or on these two fields.
 */
export interface CaptureEngine {
  /** Identifies the engine in status, diagnostics and documentation. */
  readonly name: string
  /**
   * True when this engine's `host` hit-tests its children through its own
   * transform, clips their hits to its own box, and paints nothing of its
   * own — the three properties the native pointer route rests on
   * (platform.md #18, #21). A false answer keeps every presenter on the
   * relay, which already works; a wrong `true` moves the hit region to
   * wherever a flat quad would have been, with the content still drawing
   * correctly from the texture and no error anywhere.
   */
  readonly native: boolean
  /** Can this engine make a source here? Never throws; false in Node. */
  available(): boolean
  /** Build a source. Called only after `available()` answered true. */
  createSource(
    content: string | HTMLElement,
    width: number,
    height: number,
    options?: DomTextureSourceOptions,
  ): DomTextureSource
  /** What to tell a consumer when `available()` is false. Names the fixes. */
  readonly refusal: string
}

let installed: CaptureEngine = htmlInCanvasEngine
let warnedAfterUse = false

/**
 * Install the capture engine every later source is built from.
 *
 * `null` restores the built-in HTML-in-canvas engine. Call it once, at the
 * app entry, before anything mounts: a Surface that has already built its
 * source keeps the engine it was built with, because swapping mid-life
 * would mean tearing down the live DOM subtree the source is holding —
 * focus, caret, selection, scroll and form state with it.
 */
export function setCaptureEngine(engine: CaptureEngine | null): void {
  const live = liveSourceCount()
  installed = engine ?? htmlInCanvasEngine
  // Once, not per call: a hot reload re-runs the app entry, and a warning
  // that repeats every time is one a reader stops reading.
  if (live > 0 && !warnedAfterUse) {
    warnedAfterUse = true
    console.warn(
      `[munari] setCaptureEngine("${installed.name}") ran after ${live} source(s) ` +
        'were already built. Those keep the engine they were made with — swapping ' +
        'one would destroy the live DOM it is holding, with focus, caret and form ' +
        'state. Install the engine at the app entry, before anything mounts.',
    )
  }
}

/** The engine the next source would be built from. Never null. */
export function captureEngine(): CaptureEngine {
  return installed
}

/**
 * Can the installed engine make a source in this environment?
 *
 * Resolved on every call rather than cached, because the answer changes
 * when an app entry installs an engine — and a module-scope `createSurface()`
 * runs before that line.
 */
export function captureAvailable(): boolean {
  return installed.available()
}

/**
 * Mount `content` as a live DOM subtree and rasterize it through the
 * installed capture engine.
 *
 * `content` is either markup to parse or an **unparented element to adopt**
 * — see `adoptContent` for why adoption refuses anything with a parent.
 *
 * @throws {UnsupportedPlatformError} when the installed engine cannot run here.
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
  // source, nothing to clean up, and a sentence the consumer can act on
  // (decisions.md #12).
  if (!installed.available()) throw new UnsupportedPlatformError(installed.refusal)
  return installed.createSource(content, width, height, options)
}
