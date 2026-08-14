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

  const anchors: Record<string, SourceUvRect> = {}
  for (const node of root.querySelectorAll<HTMLElement>('[data-munari-anchor]')) {
    const key = node.dataset.munariAnchor
    if (!key || anchors[key]) return null
    const box = node.getBoundingClientRect()
    anchors[key] = Object.freeze({
      uMin: (box.left - base.left) / base.width,
      vMin: 1 - (box.bottom - base.top) / base.height,
      uMax: (box.right - base.left) / base.width,
      vMax: 1 - (box.top - base.top) / base.height,
      cssWidth: box.width,
      cssHeight: box.height,
    })
  }
  if (required.some((key) => !anchors[key])) return null
  return stampSurfaceAnchors(paint, anchors as Record<K, SourceUvRect>)
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
