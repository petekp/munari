// @petepetrash/munari/snapdom — the capture engine for browsers with no
// HTML-in-canvas.
//
// snapDOM copies the subtree, inlines its styles, fonts and images, and
// rasterizes the copy through an SVG image. It runs in current Chrome,
// Firefox and Safari, where the HTML-in-canvas trial does not.
//
// It is a SECOND engine, not a replacement, and neither is a superset of
// the other. Measured 2026-09-09/10, Chrome 151, dpr 2: input to texture
// 12 ms native against 37 ms here, and 16 of 288 frames over 16.7 ms during
// a three-second panel carry against 0 of 288. The native engine also paints
// a real caret and hands the browser a host it hit-tests through a
// transform, so a Surface under this engine keeps every presenter on the
// pointer relay. What this engine buys is the other three browsers.
//
// The ceiling, and the thing to weigh before choosing this engine for
// content that sits beside its own DOM: an SVG loaded as an IMAGE lays its
// HTML out at one device pixel per CSS pixel, whatever resolution it is
// rasterized to. At dpr 2 that quantizes away every half pixel the page
// resolves, so a `1.5px` border draws at `1px` and a rule sitting on a half
// pixel lands a whole one off. Only LAID-OUT lengths go: type keeps its
// fractions, and so does an SVG `stroke-width`. It is the image step rather
// than snapDOM — the same markup inline renders the fraction correctly, in
// every engine — so no capture option, no output resolution and no rival
// library escapes it (platform.md #28). What it obliges an author to do is
// in authoring.md; do not answer it here.
//
// `@zumer/snapdom` is an OPTIONAL peer dependency, and this entry is the
// only thing that imports it. A consumer who never imports this path never
// installs it and never pays for it.
//
// Ownership: this module owns the snapDOM call and the fallback rule.
// `@munari/core` owns the source, the ledger and the parking.

import { createInputRegionRasterizer, UnsupportedRegionCaptureError, type CaptureRegionOptions } from './snapdomInputRegions'
import { snapdom, type CaptureMeta, type SnapdomPlugin } from '@zumer/snapdom'
import { fieldPseudoElementPlugin } from './snapdomFieldPseudoElements'
import { fontEmbedPlugin, warmCaptureFonts } from './snapdomFonts'
import {
  createRasterizedSource,
  htmlInCanvasEngine,
  setCaptureEngine,
  type CaptureEngine,
} from '@munari/core'

export interface SnapdomCaptureOptions {
  /**
   * Install snapDOM even where HTML-in-canvas is available.
   *
   * Off by default: with both present, the native engine is faster on every
   * measure and is the only one that can paint a caret or hand the browser a
   * hit-testable host. Turn it on to compare the two in one browser — which
   * is what the parity gates do.
   */
  always?: boolean
  /**
   * Selector for text inputs whose value edits affect only their border box.
   * Call refresh() for external paint changes without DOM or browser signals.
   * Layout, focus, style and other content changes use a full capture.
   */
  isolatedTextInputs?: string
}

/**
 * Say a degradation out loud, once per kind.
 *
 * snapDOM reports what it could not reproduce on `result.warnings` and
 * throws nothing, so a capture that quietly lost a webfont, clamped a
 * raster or failed a backdrop filter looks exactly like a good one. A
 * Surface captures many times a second, so this says each kind once for
 * the life of the page and then stops.
 */
const announced = new Set<string>()
function announce(code: string, message: string): void {
  if (announced.has(code)) return
  announced.add(code)
  console.warn(`[munari] snapDOM capture degraded (${code}): ${message}`)
}

const fieldPlugin = fieldPseudoElementPlugin((fields) => {
  announce(
    'munari-field-pseudo-unplaced',
    `${fields.length} form field pseudo-element(s) are not absolutely ` +
      'positioned, so their boxes cannot be recovered and they are absent ' +
      'from the capture. Position them absolutely to have them drawn.',
  )
})
/**
 * Hand the frame loop a turn between the clone and the serialize.
 *
 * Those are the two synchronous halves of a capture, and run back to back
 * they are one block of main thread. Measured 2026-09-12 on a live window
 * (decisions.md #62): split, the typical block fell from 17 to 11 ms and
 * the scene's p99 frame from 48 to 41 ms in Safari at 30 fps, and from 22
 * to 14 ms in Chrome at 120 Hz with no frame over 20 ms, at the price of
 * one frame of capture latency. snapDOM's own WebKit font probe used to
 * yield here by accident, four frames per capture; this is the one turn
 * that was doing the good.
 */
const frameSplitPlugin: SnapdomPlugin = {
  name: 'munari-frame-split',
  pure: true,
  // A hidden tab fires no frame, so a capture begun there finishes when the
  // tab is shown again; the requests meanwhile coalesce behind it.
  afterClone: () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
}
// Module constants so the same identities reach snapDOM on every call: a
// fresh options object per capture changes the signature its repeat-capture
// memo is keyed on.
const fontPlugin = fontEmbedPlugin((href) => {
  announce(
    'munari-font-sheet-unreadable',
    `the stylesheet ${href} could not be read, so the fonts it declares are ` +
      'missing from captures and text set in them draws in a fallback face. ' +
      'Serve it with an Access-Control-Allow-Origin header to have them drawn.',
  )
})
const capturePlugins = [fontPlugin, frameSplitPlugin, fieldPlugin]
const parseRegionSvg = (url: string) => {
  const comma = url.indexOf(',')
  const header = url.slice(0, comma)
  if (comma < 0 || !header.startsWith('data:image/svg+xml') || header.includes(';base64')) return null
  try {
    const root = new DOMParser().parseFromString(decodeURIComponent(url.slice(comma + 1)), 'image/svg+xml').documentElement
    return root instanceof SVGSVGElement ? root : null
  } catch {
    return null
  }
}

const regionSvgElements = (svg: SVGSVGElement) => {
  const foreignObjects = svg.querySelectorAll('foreignObject')
  const foreign = foreignObjects[0]
  if (foreignObjects.length !== 1 || !(foreign instanceof SVGForeignObjectElement)) return null
  const wrappers = Array.from(foreign.children).filter((child) =>
    child.namespaceURI === 'http://www.w3.org/1999/xhtml' && child.localName === 'div')
  const wrapper = wrappers[0]
  if (wrappers.length !== 1 || !(wrapper instanceof HTMLElement)) return null
  let parent: Element | null = foreign.parentElement
  while (parent && parent !== svg) {
    if (parent.namespaceURI !== 'http://www.w3.org/2000/svg' || parent.localName !== 'g') return null
    parent = parent.parentElement
  }
  return parent === svg ? { foreign, wrapper } : null
}

const regionSvgFitsRoot = (
  svg: SVGSVGElement,
  layout: { width: number; height: number },
  clip: NonNullable<CaptureMeta['clip']>,
) => {
  const viewBox = svg.viewBox.baseVal
  return clip.x >= 0 && clip.y >= 0
    && clip.x + clip.width <= layout.width && clip.y + clip.height <= layout.height
    && viewBox.x === 0 && viewBox.y === 0 && viewBox.width === clip.width && viewBox.height === clip.height
    && Number(svg.getAttribute('width')) === clip.width && Number(svg.getAttribute('height')) === clip.height
}

const normalizeRegionLayout = (
  url: string,
  layout: { width: number; height: number },
  meta: Readonly<CaptureMeta>,
) => {
  const svg = parseRegionSvg(url)
  const elements = svg ? regionSvgElements(svg) : null
  const clip = meta?.clip
  if (!svg || !elements || !clip) throw new UnsupportedRegionCaptureError('munari: clipped SVG structure is unsupported')
  const { foreign, wrapper } = elements
  const zoom = wrapper.style.zoom ? Number(wrapper.style.zoom) : 1
  const width = Number.parseFloat(wrapper.style.width)
  const height = Number.parseFloat(wrapper.style.height)
  const sizes = [layout.width, layout.height, clip.width, clip.height, zoom, width, height]
  if (!sizes.every((value) => Number.isFinite(value) && value > 0)
    || !regionSvgFitsRoot(svg, layout, clip)
    || meta.contentX !== 0 || meta.contentY !== 0) {
    throw new UnsupportedRegionCaptureError('munari: clipped SVG geometry is unsupported')
  }
  if (Number(foreign.getAttribute('x')) !== -clip.x * zoom
    || Number(foreign.getAttribute('y')) !== -clip.y * zoom
    || Number(foreign.getAttribute('width')) !== width * zoom
    || Number(foreign.getAttribute('height')) !== height * zoom
    || (wrapper.style.padding !== 'initial' && wrapper.style.padding !== '0px')) {
    throw new UnsupportedRegionCaptureError('munari: clipped HTML viewport is unsupported')
  }
  // Cropping the HTML viewport changes CPU edge samples. Keep its original
  // layout coordinates and crop only through SVG viewBox (decisions.md #62).
  foreign.setAttribute('x', '0')
  foreign.setAttribute('y', '0')
  foreign.setAttribute('width', String(layout.width * zoom))
  foreign.setAttribute('height', String(layout.height * zoom))
  wrapper.style.width = `${layout.width}px`
  wrapper.style.height = `${layout.height}px`
  svg.setAttribute('viewBox', `${clip.x} ${clip.y} ${clip.width} ${clip.height}`)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`
}

/**
 * Ask snapDOM for `element` rendered at the requested per-axis scale.
 *
 * Without a clip, the target is the element's own box times the scale, not the backing
 * store: the raster is stretched to fill whatever size it is drawn at, while
 * the store is cut for the host's box and an element smaller than its host
 * has to land small. Measured 2026-09-11: a 260px element in a 300px host
 * asked for the store's 624px came back stretched across all 624 where the
 * native engine drew it in 541.
 *
 * A clip sizes the output window; the original root still supplies its layout.
 * Per-axis sizes rather than one `scale`, because the two axes differ. The
 * capture is an SVG, so drawing it at the asked-for size is a true render at
 * that size and not an upscale of a smaller one.
 */
const rasterize = async (
  element: HTMLElement,
  scaleX: number,
  scaleY: number,
  options: CaptureRegionOptions = {},
): Promise<HTMLImageElement> => {
  // Layout size, not `getBoundingClientRect()`: the parked host wears the
  // presented pose while a Surface is held on the page, and a rect read
  // through that matrix is the element's SCREEN size. Asking for a raster
  // sized by it makes the texture resize every frame the pose moves, which
  // is a visible jitter on a card being lifted (2026-09-11).
  //
  // The rounding in `offsetHeight` is deliberate, not tolerated: it is the
  // same rounding `setSize` applies, so the raster covers exactly the box
  // the backing store was cut for. Asking for the fractional box instead
  // returns a raster one row short of the store, leaving a cleared line
  // along the far edge (measured 2026-09-11).
  const layout = options.clip && options.retainRootLayout ? { width: element.offsetWidth, height: element.offsetHeight } : null
  const box = { width: options.clip?.width ?? element.offsetWidth, height: options.clip?.height ?? element.offsetHeight }
  const capture = await snapdom(element, {
    // `snapdomFonts` supplies the faces instead. snapDOM's own pass re-derives
    // and re-embeds them on every capture, and on WebKit it also waits out a
    // font probe of four animation frames per capture — 137 ms of wall time
    // at 30 fps against 14 ms with the faces supplied, same five faces and
    // the same 317 KB payload (2026-09-12, decisions.md #62). Setting this
    // false WITHOUT supplying the faces is a fidelity regression that reads
    // as a larger win: the payload collapses to 41 KB and text rasterizes
    // with fallback metrics.
    embedFonts: false,
    clip: options.clip,
    invalidate: options.invalidate,
    // The capture is the element's own box. Root shadows and outlines are
    // stripped by default, which is what keeps the raster the same size as
    // the box the texture is stretched over; a Surface's chrome is measured
    // separately and drawn by the material (`measureSurfaceChrome`).
    outerShadows: false,
    // Mount the clone once and pin every box that disagrees with the live
    // DOM. Without it snapDOM warns `reconcile-risk` on any subtree holding
    // inline or table-cell text — it keeps natural width and may re-wrap —
    // and a Surface is a copy of a page the user is looking at, so a re-wrap
    // is a visible difference between the two. Measured 2026-09-11 on
    // Flight's nine cards: 8-21 ms per capture either way, no separable cost.
    reconcile: true,
    plugins: capturePlugins,
  })
  for (const warning of capture.warnings ?? []) announce(warning.code, warning.message)

  // Draw the capture's own SVG at the target size instead of asking
  // `toCanvas` for it. `toCanvas` resamples in WebKit: measured 2026-09-11 on
  // a Flight card at dpr 2, its raster carried a third less edge energy than
  // the same DOM (0.65x) and differed from the browser's own render on 8.3%
  // of pixels, where drawing the SVG here lands 3.8% and matches Chromium's
  // sharpness exactly. Uniform across the card — a plain border softened as
  // much as the text — so it is a scale, not a text-rendering difference.
  // It is also cheaper: 6 ms to 1 ms in WebKit, unchanged in Chromium.
  //
  // `toRaw()` is the serialized SVG on the default engine and costs nothing
  // to read; the PNG encode its docs warn about belongs to snapDOM's
  // experimental html-in-canvas engine, which this module never selects.
  const width = Math.max(1, Math.round(box.width * scaleX))
  const height = Math.max(1, Math.round(box.height * scaleY))
  const image = new Image()
  const url = capture.toRaw()
  image.src = layout ? normalizeRegionLayout(url, layout, capture.meta) : url
  await image.decode()
  // Callers use these dimensions when drawing, including a store resize
  // that happened while the SVG was being captured.
  image.width = width
  image.height = height
  return image
}

/** The snapDOM engine, for a consumer installing it directly. */
export const snapdomCaptureEngine: CaptureEngine = {
  name: 'snapdom',
  // A plain container, not a canvas. Whether a div at `opacity: 0` wearing a
  // `matrix3d` hit-tests its children and clips them to its own box the way
  // platform.md #21 measured for a canvas is UNMEASURED, so this engine
  // claims nothing and every presenter stays on the pointer relay, which
  // already works. A wrong `true` here would move the hit region to wherever
  // a flat quad would have been, with the panel still drawing correctly from
  // its texture and no error anywhere.
  native: false,
  // snapDOM reads computed styles off a live document, so there is no
  // server-side answer — and asking for one must not throw. `in globalThis`
  // for the same reason the trial probe uses it: a Node process has no DOM
  // globals declared at all, and reading the name would be a ReferenceError.
  available: () => 'document' in globalThis,
  createSource: (content, width, height, options) =>
    createRasterizedSource(rasterize, 'snapdom', content, width, height, options),
  refusal:
    'munari: snapDOM capture needs a browser document. Server-render the page ' +
    'presentation and let useSurfaceSupport() report capability after hydration.',
}

/**
 * Install snapDOM as this app's capture engine.
 *
 * Call it once, at the app entry, before anything mounts — a Surface that
 * already built its source keeps the engine it was made with.
 *
 * With no options this prefers HTML-in-canvas wherever it exists and falls
 * back to snapDOM everywhere else, which is the rule an app almost always
 * wants: the same code runs in every browser and takes the faster engine
 * where the browser has one.
 */
export function enableSnapdomCapture(options: SnapdomCaptureOptions = {}): void {
  const selector = options.isolatedTextInputs
  const fallback: CaptureEngine = selector
    ? {
        ...snapdomCaptureEngine,
        createSource(content, width, height, sourceOptions) {
          let regions: ReturnType<typeof createInputRegionRasterizer> | null = null
          let live = sourceOptions?.live === true
          let refreshPending = false
          const source = createRasterizedSource(async (element, scaleX, scaleY) => {
            const invalidate = refreshPending
            refreshPending = false
            if (!regions && element.querySelector(selector)) {
              regions = createInputRegionRasterizer(element, selector, rasterize)
            }
            if (invalidate) regions?.invalidate()
            if (live) {
              regions?.invalidate()
              return rasterize(element, scaleX, scaleY, { invalidate })
            }
            return regions ? regions.rasterize(scaleX, scaleY) : rasterize(element, scaleX, scaleY, { invalidate })
          }, 'snapdom', content, width, height, sourceOptions)
          return {
            ...source,
            repaint(next) { refreshPending = true; regions?.invalidate(); source.repaint(next) },
            setLive(next) { live = next; regions?.invalidate(); source.setLive(next) },
            dispose() { source.dispose(); regions?.dispose() },
          }
        },
      }
    : snapdomCaptureEngine
  const engine = !options.always && htmlInCanvasEngine.available() ? htmlInCanvasEngine : fallback
  setCaptureEngine(engine)
  // Fetch and encode the document's faces now rather than inside the first
  // capture. A capture that beats the fetch embeds nothing and rasterizes that
  // one frame with fallback metrics.
  if (engine === fallback && 'document' in globalThis) warmCaptureFonts()
}
