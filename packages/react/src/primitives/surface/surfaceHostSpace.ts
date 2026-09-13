// Host space — the coordinates of the block a parked host is fixed to, and
// the boxes a rig has to stand the host on inside it.
//
// The law: a rig writes a transform, and a transform composes with whatever
// block the host is fixed to, so every placement is stated in that block's
// coordinates. What the block does to the screen is measured from probes
// docked beside the page slot, never from the host itself — reading the
// host's own rect while it wears a pose returns the posed box, and the next
// frame's pose would be computed from the last one's.
//
// The fault, measured 2026-09-13 in the lab's logo scene, where every letter
// wears its own `rotate()`. One bounding rect was the whole measurement, and
// a rect reports an offset and an axis scale but never a turn: the rect of a
// turned box is a bigger upright box. So a crossing hid the page letters,
// showed the real ones in their place — and drew each one up to 12.5 CSS px
// off, upright, and stretched to its own bounding box, until the renderer
// took over and it snapped back to the page's tilt. That is the visible
// event a handoff exists to prevent, and it appeared on both capture
// engines, because the rig is engine-independent.
//
// Three points is what a turn costs: a block's map to the screen is an
// affine map, an affine map has six numbers, and a rect has four. The probes
// stand at the block's origin and 100 px along each of its axes, and each is
// a zero-size box, so its rect reports a position and nothing else — a point
// survives a turn where a box does not.
//
// Ownership: this module measures and converts. Which box a host is stood
// on, and when, belongs to the rig's caller.

/** The three probes standing in one marker: origin, one x axis, one y axis. */
type SpaceProbes = readonly [HTMLElement, HTMLElement, HTMLElement]
const probesByMarker = new WeakMap<HTMLElement, SpaceProbes>()
const markers = new WeakMap<HTMLElement, HTMLElement>()

/** The probe corners, in the block's own px. */
const PROBE_SPAN = 100

function probe(marker: HTMLElement, x: number, y: number): HTMLElement {
  const element = marker.ownerDocument.createElement('div')
  // `all:initial` first, so a page rule on plain elements cannot move a probe
  // or take its box away; everything after it is what the measurement needs.
  element.style.cssText =
    `all:initial;position:absolute;display:block;left:${x}px;top:${y}px;` +
    `width:0;height:0;visibility:hidden;pointer-events:none;`
  marker.appendChild(element)
  return element
}

/**
 * The probes standing in `marker`, docked on first use.
 *
 * They are the marker's own children, so nothing has to take them out again:
 * the marker is React's, and they leave with it. Docking them on demand is
 * what lets the page slot measure itself before a source exists to park.
 */
function probesOf(marker: HTMLElement): SpaceProbes {
  const standing = probesByMarker.get(marker)
  if (standing) return standing
  const docked: SpaceProbes = [probe(marker, 0, 0), probe(marker, PROBE_SPAN, 0), probe(marker, 0, PROBE_SPAN)]
  probesByMarker.set(marker, docked)
  return docked
}

/** Answer for `host` through `marker` until the returned unregister runs. */
export function registerHostSpace(host: HTMLElement, marker: HTMLElement) {
  markers.set(host, marker)
  return () => {
    if (markers.get(host) === marker) markers.delete(host)
  }
}

/**
 * The map from the block a marker stands in to client coordinates, or null
 * when the block has collapsed and there is no space to place anything in.
 */
export function markerSpace(marker: HTMLElement): DOMMatrix | null {
  const view = marker.ownerDocument.defaultView
  const Matrix = view?.DOMMatrix ?? DOMMatrix
  const [atOrigin, atX, atY] = probesOf(marker)
  const origin = atOrigin.getBoundingClientRect()
  const alongX = atX.getBoundingClientRect()
  const alongY = atY.getBoundingClientRect()
  const ax = (alongX.left - origin.left) / PROBE_SPAN
  const ay = (alongX.top - origin.top) / PROBE_SPAN
  const bx = (alongY.left - origin.left) / PROBE_SPAN
  const by = (alongY.top - origin.top) / PROBE_SPAN
  // A block flattened to a line or a point — `display:none` above it, a zero
  // scale — maps every pose onto itself and cannot be inverted.
  if (Math.abs(ax * by - ay * bx) < 1e-9) return null
  return new Matrix([ax, ay, bx, by, origin.left, origin.top])
}

/**
 * The map from the host's containing block to client coordinates.
 *
 * A host nobody registered a marker for is parked at the viewport, whose map
 * is the identity — that is the answer, not a missing one.
 */
export function hostSpace(host: HTMLElement | null): DOMMatrix | null {
  const marker = host ? markers.get(host) : null
  if (marker) return markerSpace(marker)
  const Matrix = host?.ownerDocument.defaultView?.DOMMatrix ?? DOMMatrix
  return new Matrix()
}

/**
 * Write a client-space map as a transform for a host standing in `space`.
 *
 * The browser renders the host at `space × transform`, so the transform that
 * lands it on `client` is `space⁻¹ × client`. `client` is a CSS matrix's
 * numbers: six for a 2D map, sixteen column-major for a projected one.
 *
 * Fixed notation, never `DOMMatrix.toString()`: that serializes a small
 * number as `1e-7`, and CSS parses no exponents — the whole transform would
 * be dropped and the host would stand unposed.
 */
export function inHostSpace(space: DOMMatrix, client: readonly number[]): string {
  // SAFETY: `space` is a DOMMatrix this module built, so its constructor is
  // that class — taken from the instance so the document's own realm is used.
  const Matrix = space.constructor as typeof DOMMatrix
  const m = space.inverse().multiply(new Matrix([...client]))
  const parts = [
    m.m11, m.m12, m.m13, m.m14,
    m.m21, m.m22, m.m23, m.m24,
    m.m31, m.m32, m.m33, m.m34,
    m.m41, m.m42, m.m43, m.m44,
  ]
  return `matrix3d(${parts.map((value) => value.toFixed(8)).join(',')})`
}

/** A box in the block's own px: what the host must be stood on. */
export interface HostSpaceBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** How long one of the block's own px is on screen, along each of its axes. */
export function hostSpaceScale(space: DOMMatrix): [number, number] {
  return [Math.hypot(space.a, space.b), Math.hypot(space.c, space.d)]
}

/** Is the block square to the screen, so a rect reports its boxes truly? */
export function hostSpaceUpright(space: DOMMatrix): boolean {
  return Math.abs(space.b) <= 1e-6 * Math.hypot(space.a, space.b) &&
    Math.abs(space.c) <= 1e-6 * Math.hypot(space.c, space.d)
}

/**
 * The border box of `element`, untransformed, in CSS px.
 *
 * Both engines resolve `width` to the box `box-sizing` names, measured
 * 2026-09-13 on Chrome 151 and Safari 18.6 against a block whose specified
 * border-box width was 80.5px: both answered `80.5px`. An inline element has
 * no box of its own to resolve and answers `auto`; `offsetWidth` reports its
 * border box instead, rounded to whole px.
 */
function untransformedBox(element: HTMLElement): [number, number] {
  const view = element.ownerDocument.defaultView
  const style = view?.getComputedStyle(element)
  if (!style) return [element.offsetWidth, element.offsetHeight]
  const px = (value: string) => Number.parseFloat(value) || 0
  const edges = style.boxSizing === 'border-box' ? 0 : 1
  const width = style.width.endsWith('px')
    ? px(style.width) + edges * (px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth))
    : element.offsetWidth
  const height = style.height.endsWith('px')
    ? px(style.height) + edges * (px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth))
    : element.offsetHeight
  return [width, height]
}

/**
 * Where `element` stands, in the coordinates of the block the parked host is
 * fixed to — the box a rig must put the host on for the two to coincide.
 *
 * A rect is the whole measurement while the block is square to the screen. A
 * turned block inflates every rect it reports, so the size is read from the
 * box's own CSS instead and the rect is used only to say where a box that
 * size has to be standing. The fault, measured 2026-09-13 in the lab's logo
 * scene: fed an inflated rect, the rig drew each letter upright and stretched
 * to its own bounding box for the length of the crossing, then the renderer
 * took over and the letter snapped back to the page's tilt.
 */
export function boxInHostSpace(element: HTMLElement, space: DOMMatrix): HostSpaceBox | null {
  const rect = element.getBoundingClientRect()
  const det = space.a * space.d - space.b * space.c
  if (det === 0) return null
  const [scaleX, scaleY] = hostSpaceScale(space)
  const [width, height] = hostSpaceUpright(space)
    ? [rect.width / scaleX, rect.height / scaleY]
    : untransformedBox(element)
  if (!(width > 0) || !(height > 0)) return null
  // The rect's own corner is the smallest corner of the block's image of a box
  // this size, which says where the box's origin has to be.
  const xs = [0, space.a * width, space.c * height, space.a * width + space.c * height]
  const ys = [0, space.b * width, space.d * height, space.b * width + space.d * height]
  const dx = rect.left - space.e - Math.min(...xs)
  const dy = rect.top - space.f - Math.min(...ys)
  return { x: (space.d * dx - space.c * dy) / det, y: (space.a * dy - space.b * dx) / det, width, height }
}
