// The native route — the parked canvas lifted over the renderer canvas,
// wearing the presented pose, so the browser hit-tests the real child itself.
//
// The rig, in full: the canvas goes `visibility: hidden`, takes a z-index
// above the renderer canvas, and wears the pose as a `matrix3d` from
// `transform-origin: 0 0`; the drawn child goes `visibility: visible` and is
// otherwise untouched — identity transform, its own layout box. The canvas
// keeps `pointer-events: none` while the child keeps `auto`. What comes back
// is a trusted click, a real `:hover` that self-paints into the capture, real
// focus, a real caret and real selection — none of which a synthetic dispatch
// can produce.
//
// Two laws, both measured 2026-09-02 on Chrome 151 (platform.md #20–#21).
// Invisibility is `visibility`, never `opacity`: an `opacity: 0` canvas
// captures blank and a static drawn root at `opacity: 0` bakes the blank into
// the paint record, while the visibility pair leaves the capture running and
// the child hit-testable without painting it (canvas children are fallback
// content and are never painted). And the POSE GOES ON THE CANVAS, never the
// child: a transform restyle on the drawn child costs one paint per restyle —
// a paint every frame the pose moves — while transform restyles on the canvas are
// paint-free after the first, and the capture and its replay scale never
// notice them.
//
// The same run measured the fault the whole shape answers: native
// hit-testing is CLIPPED to the canvas's box — the TRANSFORMED box. A canvas
// wearing the full pose therefore clips to exactly the projected quad
// (0.25px at a perspective edge), with the CSS box, and so the capture
// density, never changing size. Ink outside a mis-sized box is simply not
// hittable — no error, no warning, and the content still looks right because
// the pixels come from the texture — which is why the box is never grown and
// the pose is never split between canvas and child.
//
// Ownership: this module owns the DOM rig and the twins the browser's own
// events drive. It never decides whether to ride — `pointerRoute.ts` does —
// and it computes no geometry of its own: the matrix arrives from
// `surfacePose.ts` already resolved.

import { notePointerModality } from './forwardEvents'
import { isRelayed } from './relay'
import { ACTIVE_ATTR, HOVER_ATTR, swapChainAttr } from './twins'

/**
 * Every inline property the rig writes while the native route owns input,
 * as data. Nothing here is optional and nothing is conditional: a rig that
 * writes a different set on some path is a rig whose park cannot restore it.
 */
export interface SurfaceRideStyle {
  readonly canvasVisibility: string
  readonly canvasZIndex: string
  readonly canvasTransform: string
  readonly canvasTransformOrigin: string
  readonly rootVisibility: string
}

/** What the rig found before it rode, so park puts back exactly that. */
interface RideRestore {
  canvasVisibility: string
  canvasZIndex: string
  canvasTransform: string
  canvasTransformOrigin: string
  rootVisibility: string
}

export interface NativePointerRig {
  /** Wear the pose. Safe to call every frame; the first call captures. */
  ride: (style: SurfaceRideStyle) => void
  /** Put every written property back and drop everything the rig stamped. */
  park: () => void
  /** True while the rig is riding. */
  riding: () => boolean
}

/** The style patch for one frame of riding. */
export function nativeRideStyle(matrix3d: string, zIndex: number): SurfaceRideStyle {
  return {
    canvasVisibility: 'hidden',
    canvasZIndex: String(zIndex),
    canvasTransform: matrix3d,
    canvasTransformOrigin: '0 0',
    rootVisibility: 'visible',
  }
}

/**
 * One stacking step above everything between `el` and the document.
 *
 * The parked canvas is a `position: fixed` child of `document.body`, so it
 * competes in the root stacking context; the renderer canvas competes inside
 * whatever ancestor established one for it. Taking the tallest explicit
 * z-index on the chain is what makes the two comparable. The limit is real
 * and worth knowing: page chrome that sits above the renderer canvas with a
 * TALLER z-index than anything on that chain keeps its hits inside the
 * projected quad, and the pointer never reaches the content there.
 */
export function zIndexAbove(el: Element): number {
  let highest = 0
  const doc = el.ownerDocument
  const view = doc.defaultView
  if (!view) return 1
  for (let node: Element | null = el; node && node !== doc.documentElement; node = node.parentElement) {
    const parsed = Number.parseInt(view.getComputedStyle(node).zIndex, 10)
    if (Number.isFinite(parsed) && parsed > highest) highest = parsed
  }
  return highest + 1
}

/**
 * Build the rig for one source's parked canvas and drawn root.
 *
 * `cursorTarget` is the renderer canvas. The rig CLEARS its cursor when the
 * ride begins — a mirrored cursor the relay left there would otherwise stand
 * beside whatever the browser shows — and then leaves the cursor to the
 * browser: while the rig rides, the hit target is the real child, and the
 * cursor the user sees comes from the browser's own hit chain, not from
 * anything written on a canvas underneath it. Whether Chrome applies an
 * unpainted canvas child's `cursor` is not yet measured (decisions.md #39
 * carries the open question); if it does not, the fix is a probe first.
 */
export function createNativePointerRig(
  canvas: HTMLCanvasElement,
  root: HTMLElement,
  cursorTarget: HTMLElement,
): NativePointerRig {
  let restore: RideRestore | null = null
  let written: SurfaceRideStyle | null = null
  let hovered: Element | null = null
  let active: Element | null = null

  const clearTwins = () => {
    if (hovered) swapChainAttr(root, hovered, null, HOVER_ATTR)
    if (active) swapChainAttr(root, active, null, ACTIVE_ATTR)
    hovered = null
    active = null
  }

  // Every handler refuses a relayed event. The two routes are exclusive, so
  // one should never see the other's dispatch — but the pointer gate's own
  // clones are relayed too, and a rig that stamped from those would hold a
  // hover the browser has already dropped.
  const onOver = (e: Event) => {
    if (isRelayed(e)) return
    const target = e.target
    if (!(target instanceof Element)) return
    swapChainAttr(root, hovered, target, HOVER_ATTR)
    hovered = target
  }

  const onOut = (e: Event) => {
    if (isRelayed(e)) return
    // A move between descendants fires out-then-over. Clearing on the out
    // would drop the shared ancestors' twins for one style recalc, which is
    // long enough for a CSS transition on a card to restart mid-hover.
    const related = e instanceof PointerEvent ? e.relatedTarget : null
    if (related instanceof Node && root.contains(related)) return
    swapChainAttr(root, hovered, null, HOVER_ATTR)
    hovered = null
  }

  const onDown = (e: Event) => {
    if (isRelayed(e)) return
    const target = e.target
    if (!(target instanceof Element)) return
    notePointerModality()
    swapChainAttr(root, active, target, ACTIVE_ATTR)
    active = target
  }

  const onRelease = (e: Event) => {
    if (isRelayed(e)) return
    if (!active) return
    swapChainAttr(root, active, null, ACTIVE_ATTR)
    active = null
  }

  const listen = (on: boolean) => {
    const doc = root.ownerDocument
    if (on) {
      root.addEventListener('pointerover', onOver)
      root.addEventListener('pointerout', onOut)
      root.addEventListener('pointerdown', onDown)
      // The release is heard at the document because `:active` ends wherever
      // the button comes up — a press that drags off the content and lifts
      // over the page never fires pointerup on the root at all.
      doc.addEventListener('pointerup', onRelease, true)
      doc.addEventListener('pointercancel', onRelease, true)
      return
    }
    root.removeEventListener('pointerover', onOver)
    root.removeEventListener('pointerout', onOut)
    root.removeEventListener('pointerdown', onDown)
    doc.removeEventListener('pointerup', onRelease, true)
    doc.removeEventListener('pointercancel', onRelease, true)
  }

  return {
    riding: () => restore !== null,
    ride: (style) => {
      if (!restore) {
        restore = {
          canvasVisibility: canvas.style.visibility,
          canvasZIndex: canvas.style.zIndex,
          canvasTransform: canvas.style.transform,
          canvasTransformOrigin: canvas.style.transformOrigin,
          rootVisibility: root.style.visibility,
        }
        listen(true)
        cursorTarget.style.cursor = ''
      }
      // Written only where the value actually moved. A Surface at rest holds
      // one pose for as long as nobody touches it, and a style write that
      // sets a property to what it already says still invalidates style on
      // the parked subtree — a recalc, per frame, on content nothing changed.
      const last = written
      if (!last || last.canvasVisibility !== style.canvasVisibility)
        canvas.style.visibility = style.canvasVisibility
      if (!last || last.canvasZIndex !== style.canvasZIndex)
        canvas.style.zIndex = style.canvasZIndex
      if (!last || last.canvasTransform !== style.canvasTransform)
        canvas.style.transform = style.canvasTransform
      if (!last || last.canvasTransformOrigin !== style.canvasTransformOrigin)
        canvas.style.transformOrigin = style.canvasTransformOrigin
      if (!last || last.rootVisibility !== style.rootVisibility)
        root.style.visibility = style.rootVisibility
      written = style
    },
    park: () => {
      if (!restore) return
      // Twins first, styles second. Clearing the hover chain is a style
      // change on the content, and the content is still standing where the
      // user last saw it — dropping the transform first would move it, then
      // unhover it, and the capture would carry one frame of the panel back
      // at rest still wearing its hover.
      clearTwins()
      listen(false)
      canvas.style.visibility = restore.canvasVisibility
      canvas.style.zIndex = restore.canvasZIndex
      canvas.style.transform = restore.canvasTransform
      canvas.style.transformOrigin = restore.canvasTransformOrigin
      root.style.visibility = restore.rootVisibility
      restore = null
      written = null
    },
  }
}
