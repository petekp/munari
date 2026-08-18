// DOM-rect laws — turning a page box into the numbers a camera can match,
// and refusing the ancestors whose transforms it cannot.
//
// The law: a WebGL presentation may claim it matches a DOM box only when
// the box's own coordinates and its ancestor chain are both expressible as
// translation and positive scale. Everything else — rotation, skew, mirror,
// perspective, any 3D transform — changes the box's shape on the way to the
// screen, and a plane placed from `getBoundingClientRect` would sit where
// the AXIS-ALIGNED BOUND is rather than where the content is.
//
// That fault is invisible in review and cheap to ship: the bounding box of
// a rotated element is still a plausible rectangle, so the mesh lands
// somewhere reasonable, slightly too large, and only rotates out of
// agreement as the angle grows. Rejecting at the transform is how a
// consumer finds out at the seam instead of in a screenshot.
//
// Core owns the arithmetic and the admissibility test. The binding owns
// reading `getComputedStyle`, walking the ancestor chain, and the
// development diagnostic it prints when a chain is refused.

/** The fields of a `DOMRect` these laws read. */
export interface RectLike {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** The CSS-pixel viewport a rect's coordinates are relative to. */
export interface ViewportLike {
  readonly width: number
  readonly height: number
}

/** A rect in normalized device coordinates: centre, and half-extents, y-up. */
export interface NdcBox {
  readonly x: number
  readonly y: number
  readonly halfWidth: number
  readonly halfHeight: number
}

/**
 * A client rect in NDC. Client coordinates are y-down from the viewport's
 * top-left; NDC is y-up from its centre, spanning -1..1 on both axes.
 *
 * Fractional input stays fractional. A layout box is regularly at a
 * half-pixel — a centred flex child of an odd-width parent is the ordinary
 * case, not the pathological one — and rounding here would put the plane a
 * subpixel off its twin for the whole of a handoff, which reads as a
 * one-pixel shiver at the moment the two renderers swap.
 */
export function rectToNdc(rect: RectLike, viewport: ViewportLike): NdcBox {
  const halfWidth = rect.width / viewport.width
  const halfHeight = rect.height / viewport.height
  return {
    x: ((rect.left + rect.width / 2) / viewport.width) * 2 - 1,
    y: 1 - ((rect.top + rect.height / 2) / viewport.height) * 2,
    halfWidth,
    halfHeight,
  }
}

/** Is a rect worth matching? A zero or negative extent has no box to match. */
export function rectIsMeasurable(rect: RectLike): boolean {
  return rect.width > 0 && rect.height > 0
}

/**
 * Do two rects describe the same box within `epsilon` CSS pixels? The
 * binding compares a fresh measurement against the one the current
 * placement was computed from, and re-places only on a real difference —
 * `getBoundingClientRect` is a layout read, and scroll fires far more often
 * than a box actually moves.
 */
export function rectEquals(a: RectLike, b: RectLike, epsilon = 0.01): boolean {
  return (
    Math.abs(a.left - b.left) <= epsilon &&
    Math.abs(a.top - b.top) <= epsilon &&
    Math.abs(a.width - b.width) <= epsilon &&
    Math.abs(a.height - b.height) <= epsilon
  )
}

// ── admissible transforms ────────────────────────────────────────────────

/** A 2D affine transform in `matrix(a, b, c, d, e, f)` order. */
export interface Affine2D {
  readonly a: number
  readonly b: number
  readonly c: number
  readonly d: number
  readonly e: number
  readonly f: number
}

/** The identity — what an untransformed ancestor contributes. */
export const AFFINE_IDENTITY: Affine2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/**
 * Parse a computed `transform`. `none` is the identity; a `matrix(...)` is
 * read; a `matrix3d(...)` is REFUSED with `null` rather than flattened.
 *
 * Refused rather than flattened because the flattening is the bug. Dropping
 * the third row of a 3D matrix produces a perfectly well-formed 2D affine —
 * one that describes where the element would be with no perspective, which
 * for the `perspective()` + `rotateY()` card that motivates the question is
 * not where any of its pixels are.
 *
 * `null` therefore means "this chain is not matchable", and is the same
 * answer for an unparseable value: a transform this law cannot read is one
 * it must not claim to have checked.
 */
export function parseTransformMatrix(value: string): Affine2D | null {
  const text = value.trim()
  if (text === '' || text === 'none') return AFFINE_IDENTITY
  const match = /^matrix\(([^)]*)\)$/.exec(text)
  if (!match?.[1]) return null
  const parts = match[1].split(',').map((piece) => Number(piece))
  if (parts.length !== 6 || parts.some((piece) => !Number.isFinite(piece))) return null
  // SAFETY: the length check above admits exactly six entries and the
  // finite check rejects every non-number, so each index below is a real
  // number. `split` cannot carry either fact in its type.
  const [a, b, c, d, e, f] = parts as [number, number, number, number, number, number]
  return { a, b, c, d, e, f }
}

/**
 * May a DOM box under this transform be matched by a plane?
 *
 * Only translation and positive scale. `b` or `c` non-zero is rotation or
 * skew; a non-positive `a` or `d` is a mirror or a collapse. All four change
 * the relationship between the layout box and the painted pixels, which is
 * the relationship a matched plane is standing in for.
 */
export function affineIsMatchable(m: Affine2D): boolean {
  return m.b === 0 && m.c === 0 && m.a > 0 && m.d > 0
}

/**
 * Compose an ancestor chain, outermost first, into one transform — or
 * `null` the moment any link is unreadable or unmatchable.
 *
 * Composed rather than tested link by link because two matchable links can
 * only ever compose to a matchable transform, while two UNMATCHABLE links
 * can compose to a matchable one (two opposed rotations), and admitting
 * that pair would be admitting a chain whose intermediate boxes this law
 * never checked.
 */
export function composeMatchableChain(chain: readonly string[]): Affine2D | null {
  let out = AFFINE_IDENTITY
  for (const value of chain) {
    const link = parseTransformMatrix(value)
    if (!link || !affineIsMatchable(link)) return null
    out = {
      a: out.a * link.a,
      b: 0,
      c: 0,
      d: out.d * link.d,
      e: out.e + out.a * link.e,
      f: out.f + out.d * link.f,
    }
  }
  return out
}
