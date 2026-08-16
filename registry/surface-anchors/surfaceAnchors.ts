// Surface anchors — named DOM boxes as UV coordinates, stamped by a paint.
//
// A scene that parks WebGL matter over a region of a DOM Surface needs that
// region's place in TEXTURE space, not on the page. The collector walks the
// live root for [data-munari-anchor] elements and publishes each box as a
// normalized, unmirrored source-UV rectangle (origin bottom-left), tied to
// the DomPaintReceipt that made the pixels. Keys, not selector order, define
// identity; a duplicate key, a missing required key, or a root whose size no
// longer matches the paint rejects the whole transaction — a receipt is all
// its anchors or nothing.
//
// A receipt is only valid against texture pixels from the same paint
// generation. Live layout, painted raster, uploaded texture, drawn frame,
// and presented framebuffer are different states; never infer one from
// another.
//
// This file is byte-welded to its twin (registry/surface-anchors ≡
// apps/lab/src/lib), pinned by tests/registry/surfaceAnchorsPack.test.ts.
// Edit both copies in the same commit.

import type { DomPaintReceipt } from '@petepetrash/munari'

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

/**
 * Collect named DOM boxes in normalized, unmirrored source-texture space.
 * The origin is bottom-left. Duplicate keys, missing required keys, and a
 * live root that does not match the successful paint are rejected as one
 * incomplete transaction.
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
  // untrusted input, checked below against `required` before it becomes a
  // record with known keys.
  const collected = new Map<string, SourceUvRect>()
  for (const node of root.querySelectorAll<HTMLElement>('[data-munari-anchor]')) {
    const key = node.dataset.munariAnchor
    if (!key || collected.has(key)) return null
    const box = node.getBoundingClientRect()
    collected.set(key, Object.freeze({
      uMin: (box.left - base.left) / base.width,
      vMin: 1 - (box.bottom - base.top) / base.height,
      uMax: (box.right - base.left) / base.width,
      vMax: 1 - (box.top - base.top) / base.height,
      cssWidth: box.width,
      cssHeight: box.height,
    }))
  }
  if (required.some((key) => !collected.has(key))) return null
  // SAFETY: the line above returns unless every required key is present, so
  // the entries carry at least K. This is the boundary the DOM's key
  // strings cross into the typed map the receipt promises.
  const anchors = Object.fromEntries(collected) as Record<K, SourceUvRect>
  return stampSurfaceAnchors(paint, anchors)
}

/** Stamp a previously validated immutable UV map with a newer paint. */
export function stampSurfaceAnchors<K extends string>(
  paint: DomPaintReceipt,
  anchors: Readonly<Record<K, SourceUvRect>>,
): SurfaceAnchorReceipt<K> {
  return Object.freeze({ paint, anchors: Object.freeze(anchors) })
}

/**
 * Project one source-space anchor into a Surface box. Position follows the
 * live Surface size. Physical dimensions remain the captured CSS dimensions.
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
