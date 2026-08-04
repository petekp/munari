// The shadow a card in passage casts back down onto the page it left.
//
// Not decoration. The overlay canvas is transparent and the page is real DOM
// behind it, so this quad is the only thing that says the card is ABOVE the
// document rather than pasted onto it. It is also the cue that makes the lift
// legible at all: the arc is only 150 px of z, which is a few percent of
// perspective scale and almost nothing on its own — but a shadow that
// separates, spreads and pales as the card rises reads as height immediately.
//
// Three things about it are physics rather than taste, and each one falls out
// of where the light is:
//
//   IT LIVES ON THE PAGE PLANE, not under the card. A shadow is cast onto a
//   surface, and the surface here is z ≈ 0. So the quad stays at the document
//   while the card climbs away from it, and the two separate in screen space
//   on their own — no offset curve is authored, perspective does it.
//
//   IT IS DEPTH-TESTED AND DRAWN AFTER THE CARD (archive decision #58). The
//   card writes depth; the shadow is farther from the eye; so every fragment
//   the card covers fails the test and is deleted. That is CSS's
//   outside-the-border-box clip, enforced by geometry. Blending cannot express
//   it: drawn first, the shadow's interior survives beneath the card and
//   leaks back through the border's antialiased column as a one-pixel dark
//   seam — which reads, maddeningly, as an extra border on one edge.
//
//   IT SOFTENS AND PALES WITH HEIGHT. Contact shadows are tight and dark;
//   a shadow 150 px up is wide and faint. Holding either constant is the
//   single most reliable way to make a floating thing look like a sticker.

export const SHADOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const SHADOW_FRAG = /* glsl */ `
precision highp float;

varying vec2 vUv;

/** Half-extent of the CARD, in CSS px — not of this quad, which is bigger. */
uniform vec2 uCardHalf;
/** Half-extent of this quad, in CSS px. The margin is the room the blur needs. */
uniform vec2 uQuadHalf;
/** Corner radius of the card, CSS px. */
uniform float uRadius;
/** Blur sigma, CSS px. Grows with height. */
uniform float uSigma;
/** Peak opacity. Falls with height. */
uniform float uAlpha;

/** Signed distance to a rounded box: negative inside, positive outside. */
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void main() {
  // This quad carries the blur margin, so its uv maps to a LARGER rectangle
  // than the card. Work in the card's own pixel space and the SDF stays the
  // card's shape no matter how much margin the blur asked for.
  vec2 p = (vUv - 0.5) * 2.0 * uQuadHalf;
  float d = sdRoundBox(p, uCardHalf, uRadius);

  // tanh is a close, cheap stand-in for the erf a true Gaussian would want,
  // and unlike smoothstep it has no hard support — the tail goes to zero
  // asymptotically rather than ending on a visible contour line, which is
  // exactly the artifact that gives a fake blur away.
  float a = uAlpha * (0.5 - 0.5 * tanh(1.15 * d / max(uSigma, 0.5)));

  // Premultiplied, matching every other surface in this scene and the
  // material contract the canvas is composited under.
  gl_FragColor = vec4(vec3(0.0), a);
}
`

/** Where the shadow is and what it looks like, for a card at height `z`. */
export interface ShadowFrame {
  /** World pose. x and y follow the card; z does NOT — see `shadowFrame`. */
  position: [number, number, number]
  /** Half-extent of the card itself, CSS px — the shape the SDF cuts. */
  cardHalf: [number, number]
  /** Half-extent of the quad, CSS px — the card plus room for the blur. */
  quadHalf: [number, number]
  sigma: number
  alpha: number
}

/**
 * How far in front of the document plane the shadow sits.
 *
 * Not zero, because a coplanar quad and the page's own z-fighting neighbours
 * are a coin toss; not far, because the separation from the card must come
 * from the card's height and nothing else.
 */
const SHADOW_Z = 1

/**
 * Where a card at `(x, y, z)` casts, and how soft and heavy the cast is.
 *
 * THE POSITION IS TWO THIRDS OF THE CARD'S OWN. x and y follow it, because a
 * shadow is cast by that card and not by the room; z does not, because it is
 * cast ONTO the document, which is down at the page plane. Getting that split
 * wrong is not subtle in the arithmetic and completely unreadable in the
 * pixels: authored at the origin, this drew a smear at the centre of the
 * VIEWPORT while the card flew off to the left, and the card's depth write
 * deleted exactly the overlapping half — leaving a hard-edged dark block
 * beside the card that looks for all the world like a shader bug.
 *
 * The separation between the two is then free, and is the entire reason the
 * lift reads at all: same world x and y, different z, so perspective pulls
 * them apart on screen by precisely the amount the height earns. Nobody
 * writes an offset curve.
 *
 * A contact shadow at z = 0 is tight (small sigma) and dark; height widens and
 * pales it. Both curves are linear in z and deliberately dull.
 *
 * The quad has to be big enough to contain the blur or the shadow ends on a
 * straight cut. Three sigma is the usual "all of it" bound for a Gaussian, and
 * this tail is thinner than a Gaussian's, so three is generous.
 */
export function shadowFrame(
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  lift: number,
): ShadowFrame {
  const t = Math.min(1, Math.max(0, z / Math.max(1, lift)))
  const sigma = 7 + 30 * t
  const margin = sigma * 3
  return {
    position: [x, y, SHADOW_Z],
    cardHalf: [w / 2, h / 2],
    quadHalf: [w / 2 + margin, h / 2 + margin],
    sigma,
    alpha: 0.5 - 0.22 * t,
  }
}
