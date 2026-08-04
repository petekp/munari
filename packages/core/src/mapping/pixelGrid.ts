// The phase law — where a card has to SIT for the texels it already has
// to land on the display's pixels.
//
// The third budget in `sharpness = supply × phase × transfer`, and the
// one nothing else can pay for. `texelDemand` answers how MANY texels a
// card needs; this answers where those texels must arrive. Get the count
// exactly right and put the card a third of a pixel off the grid, and
// every texel in it is read across two — one bilinear tap of blur,
// applied uniformly, to type that was rasterized to be read. More
// density does not help: the extra texels land off-grid too.
//
// A card's texture is a capture of its own box, so the texture's texel
// grid IS the card's pixel grid. That is what makes this a single
// correction to a single object rather than a per-glyph problem: the
// parts inside the card are at fractional positions too, and that is
// correct and must stay — a part's fraction is baked into the capture
// and its uv rect is `box / card` exactly, so it asks for precisely the
// texels it was drawn into. One grid per card, not one per word.
//
// Two corrections come out of that, and both are needed. Pinning the
// top-left corner to an integer device pixel fixes where the grid
// STARTS; pinning the projected footprint to the texture's exact texel
// count fixes its PITCH, because a card 514 CSS px wide magnified by
// 1.114 does not cover an integer number of device pixels and the phase
// drifts across its own width even with the corner nailed down.
//
// This is presentation, not physics. It moves a card by up to half a
// pixel from where its own trajectory says it is, and lies about its
// size by at most half a texel in each direction — the trade is not a
// close one, because half a pixel of displacement is invisible and half
// a pixel of blur is what gets reported. Consumers apply it where the
// pose is CONSUMED and leave the trajectory exact (the truth/presentation
// split the grounded damper is built on).
//
// The kernel owns the correction; the consumer owns WHEN it applies.
// Deciding a card is at rest is a scene's judgement — a flight blends on
// plate speed, a route transition on how far into the flight it is — and
// a quantized position on a moving card is just a way to make it move in
// steps.

/** What the snap needs to know about a card and the display it is on. */
export interface PixelGridInput {
  /** Card centre on its plane, world units (= CSS px at z = 0). */
  x: number
  y: number
  /** The card's CSS size — the box its texture was captured from. */
  width: number
  height: number
  /**
   * How much bigger the card's plane projects than z = 0:
   * `planeScale(camZ, z)`. Exactly 1 for a card lying on the page.
   */
  mag: number
  /** The viewport, CSS px. */
  viewW: number
  viewH: number
  /** The display's device pixel ratio. */
  dpr: number
  /**
   * Backing texels per CSS px the texture was actually cut at — normally
   * `texelDemand` at this card's altitude. It is the texture's own
   * dimensions that the footprint has to match, so this must be the
   * density the capture happened at, not the one it ideally wants.
   */
  density: number
}

/** The correction, in the two units the caller applies it in. */
export interface PixelGridSnap {
  /** World-unit offsets to ADD to the card's centre. */
  dx: number
  dy: number
  /** Multipliers on the card's rendered size, ~1 ± half a texel. */
  sx: number
  sy: number
}

/** `-0` is a delta a caller would otherwise have to know not to test for. */
function noNegZero(v: number): number {
  return v === 0 ? 0 : v
}

/**
 * Where this card has to be drawn for its texels to land on device pixels.
 *
 * The returned correction is at FULL strength: it assumes the caller has
 * already decided this card is somewhere a reader can stop. Blend it
 * yourself — `x + snap.dx * w`, `scale.x = 1 + w * (snap.sx - 1)` — so
 * that a card in motion is pure trajectory and nothing pops in between.
 *
 * A degenerate card (zero or negative width or height) has no grid to be
 * on and gets an identity correction rather than a NaN.
 */
export function pixelGridSnap(input: PixelGridInput): PixelGridSnap {
  const { x, y, width, height, viewW, viewH, density } = input
  const dpr = Math.max(1e-6, input.dpr)
  const mag = Math.max(1e-6, input.mag)

  // The texture's actual texel count — the capture rounds, so the
  // footprint has to be matched to the rounded number and not to the
  // real-valued demand that produced it.
  const tw = Math.round(width * density)
  const th = Math.round(height * density)

  // Pitch: cover exactly tw × th device pixels with tw × th texels.
  const sx = width > 0 && tw > 0 ? tw / (width * mag * dpr) : 1
  const sy = height > 0 && th > 0 ? th / (height * mag * dpr) : 1

  // Start: the top-left of that footprint, in device px, onto the integer
  // grid. World y runs up and screen y runs down, so the two corrections
  // are written out with opposite signs rather than one being negated.
  const left = (viewW / 2 + x * mag) * dpr - tw / 2
  const top = (viewH / 2 - y * mag) * dpr - th / 2

  return {
    dx: noNegZero((Math.round(left) - left) / (dpr * mag)),
    dy: noNegZero((top - Math.round(top)) / (dpr * mag)),
    sx,
    sy,
  }
}
