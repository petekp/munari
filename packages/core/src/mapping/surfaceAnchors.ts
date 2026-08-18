// Surface anchors — named DOM boxes as texture coordinates, stamped by the
// paint that made the pixels.
//
// The law: an anchor set is ONE TRANSACTION against ONE paint. Matter parked
// over a region of a captured source needs that region's place in texture
// space, and the only paint that region is true of is the one whose pixels
// are on the geometry right now. A duplicate key, a missing required key, or
// a live root whose box no longer matches the paint rejects the whole set —
// never the offending entry alone.
//
// All or nothing, because a partial set is worse than no set. Half the
// hardware standing on a panel placed from this paint and half from the
// last one is a picture nobody can read as wrong: every control is
// plausibly placed, and the ones that moved are exactly the ones the user
// was interacting with.
//
// Live layout, painted raster, uploaded texture, drawn frame, and presented
// framebuffer are five different states. This law converts the first into
// the second's coordinates and refuses to guess about the other three.
//
// Core owns the transaction and the projection. The binding owns which
// paint is currently drawn, and withholds an anchor's child until a
// complete set exists for that generation.

import type { DomPaintReceipt } from '../paint/htmlInCanvas'

/**
 * One anchor's box in normalized, unmirrored source-texture space, origin
 * bottom-left. `cssWidth`/`cssHeight` are the captured CSS dimensions,
 * which stay physical: a control keeps its real size when the panel it
 * stands on resizes, the same way a knob on a console does.
 */
export interface SourceUvRect {
  readonly uMin: number
  readonly vMin: number
  readonly uMax: number
  readonly vMax: number
  readonly cssWidth: number
  readonly cssHeight: number
}

export interface SurfaceAnchorReceipt<K extends string = string> {
  readonly paint: DomPaintReceipt
  readonly anchors: Readonly<Record<K, SourceUvRect>>
}

export interface SurfaceAnchorProjection {
  readonly x: number
  readonly y: number
  readonly cssWidth: number
  readonly cssHeight: number
}

/** The attribute an author writes to name a box. A string, because it is one. */
export const SURFACE_ANCHOR_ATTRIBUTE = 'data-munari-anchor'

/**
 * Collect every named box under `root` in the coordinates of `paint`.
 *
 * `null` means "not this paint" — the caller keeps the last complete set and
 * tries again on the next one. The one-pixel tolerance on the size
 * comparison is the fractional-layout allowance: a root measured at 640.5
 * and painted at 640 is the same root, and a whole pixel is far below the
 * smallest box anyone anchors to.
 */
export function collectSurfaceAnchors<K extends string>(
  root: HTMLElement,
  paint: DomPaintReceipt,
  required: readonly K[],
): SurfaceAnchorReceipt<K> | null {
  const base = root.getBoundingClientRect()
  const [paintedWidth, paintedHeight] = paint.paintedSize
  if (
    base.width <= 0 ||
    base.height <= 0 ||
    Math.abs(base.width - paintedWidth) > 1 ||
    Math.abs(base.height - paintedHeight) > 1
  ) {
    return null
  }

  // A Map while collecting, because the keys are whatever the DOM says —
  // untrusted input, checked against `required` below before it becomes a
  // record with known keys.
  const collected = new Map<string, SourceUvRect>()
  for (const node of root.querySelectorAll<HTMLElement>(`[${SURFACE_ANCHOR_ATTRIBUTE}]`)) {
    const key = node.dataset.munariAnchor
    if (!key || collected.has(key)) return null
    const box = node.getBoundingClientRect()
    collected.set(
      key,
      Object.freeze({
        uMin: (box.left - base.left) / base.width,
        vMin: 1 - (box.bottom - base.top) / base.height,
        uMax: (box.right - base.left) / base.width,
        vMax: 1 - (box.top - base.top) / base.height,
        cssWidth: box.width,
        cssHeight: box.height,
      }),
    )
  }
  if (required.some((key) => !collected.has(key))) return null
  // SAFETY: the line above returns unless every required key is present, so
  // the entries carry at least K. This is the boundary the DOM's key
  // strings cross into the typed map the receipt promises.
  const anchors = Object.fromEntries(collected) as Record<K, SourceUvRect>
  return stampSurfaceAnchors(paint, anchors)
}

/**
 * Re-stamp a validated set with a newer paint. The pixels moved on but the
 * boxes did not, which is the common case for a panel that repainted
 * without relayout — and re-collecting would pay a layout read per paint.
 */
export function stampSurfaceAnchors<K extends string>(
  paint: DomPaintReceipt,
  anchors: Readonly<Record<K, SourceUvRect>>,
): SurfaceAnchorReceipt<K> {
  return Object.freeze({ paint, anchors: Object.freeze(anchors) })
}

/**
 * Project one anchor into a Surface's current box. Position follows the live
 * size; physical dimensions stay the captured CSS dimensions.
 */
export function projectSurfaceAnchor(
  anchor: SourceUvRect,
  width: number,
  height: number,
  mirrorU = false,
): SurfaceAnchorProjection {
  const sourceU = (anchor.uMin + anchor.uMax) / 2
  const u = mirrorU ? 1 - sourceU : sourceU
  const v = (anchor.vMin + anchor.vMax) / 2
  return Object.freeze({
    x: u * width,
    y: (1 - v) * height,
    cssWidth: anchor.cssWidth,
    cssHeight: anchor.cssHeight,
  })
}

/**
 * Is a receipt still true of the generation currently drawn on the
 * geometry? An anchor set collected from a newer paint than the texture
 * carries places matter where the content is ABOUT to be — which during a
 * resize is a step ahead of the pixels underneath it.
 */
export function anchorReceiptMatchesDrawn(
  receipt: SurfaceAnchorReceipt,
  drawnSourceId: number,
  drawnGeneration: number,
): boolean {
  return (
    receipt.paint.frame.sourceId === drawnSourceId &&
    receipt.paint.frame.generation === drawnGeneration
  )
}
