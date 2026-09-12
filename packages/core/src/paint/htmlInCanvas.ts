// The HTML-in-canvas engine — THE platform file: Chrome's "HTML in
// Canvas" origin trial (Chrome 148–151) turned into a capture engine.
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
// This engine parks the subtree INSIDE its own canvas, which is what makes
// `host === canvas` here and makes the ride paint-free: hit-testing clips
// to the canvas's TRANSFORMED box, and transform restyles on a canvas cost
// no paints after the first (platform.md #18, #21).
//
// Ownership: this module owns the trial API and the capability probe.
// `domTextureSource.ts` owns the canvas arithmetic and the paint ledger;
// `captureEngine.ts` owns which engine a source is built from.

import {
  adoptContent,
  createCaptureCanvas,
  PARKED_HOST_ATTRIBUTE,
  type CaptureCanvas,
  type DomTextureSource,
  type DomTextureSourceOptions,
} from './domTextureSource'
import type { CaptureEngine } from './captureEngine'

export interface HtmlInCanvasSupport {
  drawElementImage: boolean
  texElementImage2D: boolean
}

/**
 * Is the HTML-in-canvas trial surface present? Safe to call anywhere —
 * environments without the APIs (or without a DOM at all) report `false`,
 * they never throw.
 *
 * This is the RAW platform probe and reports both trial entry points. The
 * question a consumer usually means — "can a Surface capture here?" — is
 * `supportsSurfaces()`, which asks the installed engine and so answers
 * `true` on a browser with no trial but a capture engine installed.
 */
export function detectHtmlInCanvas(): HtmlInCanvasSupport {
  // Two questions, not one. `in` asks whether the name is DECLARED, which
  // is what keeps Node (no DOM globals at all) from throwing a
  // ReferenceError. Reading the value then asks whether anything is
  // actually there — a runner that stubs the global to `undefined` answers
  // yes to the first and no to the second, and the contract says that must
  // read as absence rather than blow up on `.prototype`.
  const context2d = 'CanvasRenderingContext2D' in globalThis ? CanvasRenderingContext2D : undefined
  const gl2 = 'WebGL2RenderingContext' in globalThis ? WebGL2RenderingContext : undefined
  return {
    drawElementImage: context2d !== undefined && 'drawElementImage' in context2d.prototype,
    texElementImage2D: gl2 !== undefined && 'texElementImage2D' in gl2.prototype,
  }
}

interface TrialCanvas extends HTMLCanvasElement {
  layoutSubtree: boolean
  onpaint: (() => void) | null
  requestPaint: () => void
}

interface TrialContext2D extends CanvasRenderingContext2D {
  /** Called for effect — the trial API's return value is not part of any
   *  contract this kernel relies on. */
  drawElementImage: (el: Element, x: number, y: number) => void
}

/**
 * Mounts `content` as a live DOM subtree inside a hidden layout-canvas and
 * rasterizes it on every repaint() via drawElementImage.
 *
 * Reached through `createDomTextureSource`, which checks availability and
 * refuses before anything is built (decisions.md #12).
 */
function createHtmlInCanvasSource(
  content: string | HTMLElement,
  width: number,
  height: number,
  options: DomTextureSourceOptions = {},
): DomTextureSource {
  // Resolve the subtree BEFORE building anything, for the same reason the
  // capability gate is ordered first: a refused source must own no DOM.
  // Parsing markup only touches a detached host div, and adoption only reads
  // `parentNode`, so nothing here is visible to the page if this throws.
  const element = adoptContent(content)

  // SAFETY: the trial members (layoutSubtree, onpaint, requestPaint) are
  // Chrome's HTML-in-canvas additions to a plain canvas element; no
  // TypeScript lib declares them yet. Absence is not a type error but a
  // paint error — every use below runs inside the try that reports through
  // onError, and the engine's `available()` is the gate that ran first.
  // Late-bound because the shared body is what creates the canvas, and it
  // takes the paint request as a constructor argument — the first re-cut it
  // could run happens long after this line.
  let trial: TrialCanvas | null = null
  const requestPaint = () => trial?.requestPaint()
  const body: CaptureCanvas = createCaptureCanvas(element, width, height, {
    ...options,
    engine: 'html-in-canvas',
    requestPaint,
  })
  // SAFETY: the trial members named on TrialCanvas are Chrome's additions to
  // a plain canvas element and no TypeScript lib declares them. Their absence
  // is not a type error but a paint error — every use runs inside the try
  // that reports through onError, and `available()` is the gate that ran
  // ahead of construction.
  const canvas = body.canvas as TrialCanvas
  trial = canvas
  canvas.layoutSubtree = true
  // Must stay in-document AND on-screen to get paint records — off-screen
  // (left:-10000px) canvases are skipped by the compositor and never paint.
  // Parking it behind the page (z-index:-1) keeps it painted but unseen, and
  // `visibility: hidden` keeps it from drawing over the page while the
  // capture stays fully alive (platform.md #20).
  // CSS size is pinned to the layout size so backing-store changes
  // (setScale) never relayout the subtree — focus/caret/selection survive.
  canvas.style.cssText =
    `position:fixed;left:0;top:0;z-index:-1;pointer-events:none;visibility:hidden;` +
    `width:${width}px;height:${height}px;`
  canvas.setAttribute(PARKED_HOST_ATTRIBUTE, '')

  // Re-root the pointer-events cascade. The canvas above is `none` so real
  // hit-testing can never wander into a parked subtree — but that value
  // inherits, and the forwarder's own hit test reads the computed one. Left
  // alone, every element in every Surface would read as clear glass and
  // nothing would ever be hittable. A consumer that wants a transparent root
  // overrides this from onSource, which runs after.
  element.style.pointerEvents = 'auto'
  // The visibility half of the same cascade: the host is hidden, so the
  // drawn root has to opt back in or it is neither painted nor hit-tested.
  element.style.visibility = 'visible'
  canvas.appendChild(element)
  document.body.appendChild(canvas)

  // SAFETY: same trial API as the canvas above — drawElementImage is
  // Chrome's addition to the 2d context. The '2d' context id cannot return
  // null for a canvas this function just created and has not asked for
  // another context on.
  const ctx = canvas.getContext('2d') as TrialContext2D

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
      // The current box, and zero changes during paint: the compositor
      // rasterizes inside the frame that asked, so there is no window for
      // the subtree to move in — `size()` at this instant IS what replayed.
      body.completePaint(body.size(), 0)
    } catch (cause) {
      body.failPaint(cause)
    }
  }

  const setSizeStyle = () => {
    const [w, h] = body.size()
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
  }
  requestPaint()

  return {
    sourceId: body.sourceId,
    canvas,
    host: canvas,
    element,
    setHostPainted: (painted) => {
      canvas.style.visibility = painted ? 'visible' : 'hidden'
    },
    repaint: requestPaint,
    // The compositor already paints for every change that enters a paint
    // record, at no cost this side of the seam, so there is nothing to
    // switch on or off.
    setLive: () => {},
    hearInput: () => () => {},
    scale: body.scale,
    rasterScale: body.rasterScale,
    size: body.size,
    paintedSize: body.paintedSize,
    currentPaint: body.currentPaint,
    subscribePaint: body.subscribePaint,
    setScale: (k) => body.setScale(k),
    setRasterScale: (x, y) => {
      body.setRasterScale(x, y)
    },
    setSize: (w, h) => {
      if (body.setSize(w, h)) setSizeStyle()
    },
    resettle: body.resettle,
    painted: body.painted,
    paintCount: body.paintCount,
    dispose: () => {
      canvas.onpaint = null
      canvas.remove()
      // Release the subtree. The hold was for the source's lifetime, and
      // adoption required the node to arrive unparented — so it leaves that
      // way, making adopt/dispose exactly invertible. Two things depend on
      // it: a React remount (StrictMode mounts, cleans up, mounts again)
      // re-adopts the same node and would otherwise be refused for being
      // parented to the canvas that just died; and a consumer holding a node
      // would hold its dead canvas through the parent pointer, leaking one
      // parked canvas per disposed source.
      element.remove()
      body.dispose()
    },
  }
}

/**
 * The engine Munari ships with: Chrome's HTML-in-canvas trial.
 *
 * `native: true` says the two things the pointer route needs: the host
 * hit-tests its children through its own transform and clips them to its
 * own box, and it paints nothing of its own (platform.md #18, #21). No
 * other engine may claim that without its own measurement.
 */
export const htmlInCanvasEngine: CaptureEngine = {
  name: 'html-in-canvas',
  native: true,
  available: () => detectHtmlInCanvas().drawElementImage,
  createSource: createHtmlInCanvasSource,
  refusal:
    'munari: this browser has no drawElementImage — the HTML-in-canvas ' +
    'API this library is built on. In Chrome, relaunch with ' +
    '--enable-features=CanvasDrawElement (a running Chrome ignores the ' +
    'flag, so quit it fully first). Or install @zumer/snapdom and call ' +
    'enableSnapdomCapture() from @petepetrash/munari/snapdom, which runs ' +
    'in any current browser. Call supportsSurfaces() before mounting a ' +
    'Surface to branch on this instead of throwing.',
}
